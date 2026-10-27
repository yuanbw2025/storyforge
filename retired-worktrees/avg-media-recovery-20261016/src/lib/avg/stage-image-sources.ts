import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2, ProductBuildRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorStageV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { readAvgDraftMediaV1 } from './editor-service'
import { parseAvgAuthorMediaChoice } from './media-production-contract'
import { avgRawMediaArtifactKeyV1 } from './media-production-contract'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { verifyRetainedAvgRawImageArtifactV1, verifyAvgProcessedImageArtifactV1 } from '../product-production/artifact-store'
import { assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { avgProcessedImageArtifactKeyV1 } from './image-processing-contract'
import { inspectAvgProcessedImageSourceV1 } from './image-processing-source'
import { prepareAvgAdoptedGeneratedImageV1, readAvgAdoptedGeneratedImageV1 } from './media-generated-reference'
import type { AvgInheritedStageImageV1 } from './stage-image-source-contract'
import type { AvgVoiceRecoveryV1 } from './voice-recovery-contract'
import { assertAvgVoiceDraftV1 } from './voice-draft-contract'
import { assertAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { readAvgVoiceRecoveryReplacementV1, readAvgVoiceRecoverySourceV1 } from './voice-recovery'

const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
export async function readAvgInheritedStageImagesV1(input:{scope:WorkspaceScope;payload:AvgAuthorStageV1;productionKey:string;targetBuildNumber:number;worldContentHash:string}){
  const generated=new Map<string,{asset:FrozenRuntimeMediaAssetV2;blobObjectId:number}>()
  for(const entry of input.payload.inheritedImages??[]){
    const asset=input.payload.stage.assets.find(asset=>asset.assetKey===entry.assetKey)
    const image=await readAvgAdoptedGeneratedImageV1({scope:input.scope,source:entry.source})
    if(!asset||!same(asset,image.asset)||image.referenceOnly||image.sourceWorldContentHash!==input.worldContentHash
      ||image.source.productionKey===input.productionKey&&image.source.raw.buildNumber>=input.targetBuildNumber)throw new Error('[avg-media] 演出继承缺少准确的旧版公开图像来源，不能借用参考或当前版本')
    generated.set(entry.assetKey,{asset:image.asset,blobObjectId:image.blobObjectId})
  }
  return generated
}

/** Adds reviewable source declarations to the editable stage only. No old
 * image or author choice becomes accepted in the new Build until stage adopt. */
export async function prepareAvgInheritedStageDraftV1(input:{scope:WorkspaceScope;workspace:AvgAuthorWorkspaceV1;build:ProductBuildRecordV1;
  productionKey:string;targetBuildNumber:number;worldContentHash:string;voiceRecovery?:AvgVoiceRecoveryV1}){
  const next=parseAvgAuthorWorkspaceV1(input.workspace),entries:AvgInheritedStageImageV1[]=[...(next.presentation.inheritedImages??[])]
  const oldChoices=await db.productBuildArtifacts.where('buildId').equals(input.build.id!).filter(row=>row.status==='accepted'&&row.artifactKey.startsWith('avg.media.choice.')).limit(9).toArray()
  if(oldChoices.length>8)throw new Error('[avg-media] 旧图片选择超出冻结批次范围')
  for(const asset of next.presentation.stage.assets){
    if(entries.some(entry=>entry.assetKey===asset.assetKey))continue
    if (asset.kind === 'voice' && input.voiceRecovery && next.voiceProduction) {
      const { voice } = await assertAvgVoiceDraftV1(next.voiceProduction)
      const incoming = voice.batch.requirements.find(r => r.assetKey === asset.assetKey)
      if (incoming) {
        const row = await db.productProductionBriefs.where('[productionId+revision]').equals([input.build.productionId, input.build.briefRevision]).first()
        if (!row || row.briefHash !== input.build.briefHash || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' })) throw new Error('[avg-voice] 待重选配音缺少准确原始 Brief')
        const brief = parseProductProductionBriefV3(row.briefJson)
        if (brief.avgAssembly?.version !== 3 || brief.source.worldContentHash !== input.worldContentHash) throw new Error('[avg-voice] 待重选配音不能跨作品或冻结世界')
        const { assembly: source } = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly)
        const assembly = { ...source, voice: { ...voice, recovery: input.voiceRecovery } }
        const read = input.voiceRecovery.retained.some(r => r.requirementKey === incoming.requirementKey)
          ? readAvgVoiceRecoverySourceV1 : readAvgVoiceRecoveryReplacementV1
        const proved = await read({ scope: input.scope, productionId: input.build.productionId, assembly, requirementKey: incoming.requirementKey })
        if (!same(proved.asset, asset)) throw new Error('[avg-voice] 待重选配音与准确原音频元数据不一致')
        // An editable placeholder only. Current review/choice and stage adopt
        // are still mandatory; no import alias or inherited adoption is made.
        continue
      }
    }
    const matches=oldChoices.filter(row=>same(parseAvgAuthorMediaChoice(row.payloadJson).asset,asset))
    if(matches.length>1)throw new Error('[avg-media] 旧演出图像来源不唯一')
    if(matches[0]){
      if(!await assertRecordInScope(input.scope,'productBuildArtifacts',matches[0],{owner:'work'}))throw new Error('[avg-media] 旧演出来源跨作品')
      const image=await prepareAvgAdoptedGeneratedImageV1({scope:input.scope,choiceId:matches[0].id!})
      if(image.referenceOnly||image.sourceWorldContentHash!==input.worldContentHash)throw new Error('[avg-media] 不能把参考图或其他世界来源自动提升为演出图')
      entries.push({assetKey:asset.assetKey,source:image.source,declaration:'在此编辑草稿中保留准确旧图；待本版本作者核对演出、用途与来源后确认采用'})
    }else{
      // A rejected/revised author review invalidates its old choice while the
      // editable layout remains. Retain an exact producer-proved placeholder
      // only for a slot this new batch must freshly choose; it gains no old
      // image adoption and is never added to the inherited-image authority map.
      const incoming=next.mediaBatch?.requirements.find(r=>r.assetKey===asset.assetKey&&r.consumer.domain!=='reference')
      if(incoming&&['cancelled','failed','recovery-required'].includes(input.build.status)){
        const raw=(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([input.build.id!,avgRawMediaArtifactKeyV1(incoming.requirementKey)])
          .filter(row=>row.status==='accepted').limit(2).toArray())
        const derived=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([input.build.id!,avgProcessedImageArtifactKeyV1(incoming.requirementKey)])
          .filter(row=>row.status==='accepted').limit(2).toArray()
        const exactRaw=raw.length===1&&same(JSON.parse(raw[0].metadataJson),asset)
        const exactDerived=raw.length===1&&derived.length===1&&same(JSON.parse(derived[0].metadataJson),asset)
        if(exactRaw||exactDerived){
          const row=await db.productProductionBriefs.where('[productionId+revision]').equals([input.build.productionId,input.build.briefRevision]).first()
          if(!row||row.briefHash!==input.build.briefHash||!await assertRecordInScope(input.scope,'productProductionBriefs',row,{owner:'work'}))throw new Error('[avg-media] 待重选图片缺少准确原始 Brief')
          const brief=parseProductProductionBriefV3(row.briefJson),plan=parseProductProductionPlanV3(input.build.planJson,brief,input.build.briefHash)
          if(brief.source.worldContentHash!==input.worldContentHash)throw new Error('[avg-media] 待重选图片不能跨冻结世界')
          const proved=await verifyRetainedAvgRawImageArtifactV1({scope:input.scope,buildId:input.build.id!,expectedBuildRevision:input.build.stateRevision,
            expectedBriefHash:input.build.briefHash,expectedPlanHash:input.build.planHash,sourceControlEpoch:plan.controlEpoch,artifactKey:raw[0].artifactKey,version:raw[0].version,contentHash:raw[0].contentHash})
          if(exactDerived){
            const image=await verifyAvgProcessedImageArtifactV1({scope:input.scope,buildId:input.build.id!,expectedBuildRevision:input.build.stateRevision,
              expectedBriefHash:input.build.briefHash,expectedPlanHash:input.build.planHash,sourceControlEpoch:plan.controlEpoch,artifactKey:derived[0].artifactKey,version:derived[0].version,contentHash:derived[0].contentHash})
            if(!same((await inspectAvgProcessedImageSourceV1({scope:input.scope,brief,raw:proved.artifact,processed:image.artifact})).asset,asset))throw new Error('[avg-process] 待重选加工图来源已变化')
          }else if(!same((await assertAvgRawImageArtifactV1(brief,proved.artifact)).asset,asset))throw new Error('[avg-media] 待重选图片元数据已变化')
          continue
        }
      }
      await readAvgDraftMediaV1(input.scope,asset)
    }
  }
  if(entries.length)next.presentation.inheritedImages=entries
  await readAvgInheritedStageImagesV1({...input,payload:next.presentation})
  return next
}
