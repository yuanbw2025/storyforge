import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { verifyRetainedAvgRawImageArtifactV1 } from '../product-production/artifact-store'
import { assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { parseAvgImageRecoveryV1, parseAvgRetainedRawProofV1 } from './media-recovery-contract'
import { assertAvgOriginalImageResponseV1 } from './media-response-proof'
import { readAvgImageDefinitionV3 } from './media-production-definition'

const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
const MAXIMUM_RECOVERY_LINEAGE=64

export async function readAvgImageRecoverySourceV1(input:{scope:WorkspaceScope;productionId:number;brief:Pick<ProductProductionBriefV3,'avgAssembly'>;requirementKey:string}, visited:number[]=[]){
  const a=readAvgImageDefinitionV3(input.brief)
  if(!a.imageRecovery)throw new Error('[avg-media] 缺少冻结原图复用方案')
  const recovery=parseAvgImageRecoveryV1(a.imageRecovery,a.mediaBatch),ref=recovery.retained.find(r=>r.requirementKey===input.requirementKey)
  if(!ref||visited.length>=MAXIMUM_RECOVERY_LINEAGE||visited.includes(recovery.sourceBuildNumber))throw new Error('[avg-media] 原图复用链缺失、成环或超限')
  const build=await db.productBuilds.where('[productionId+buildNumber]').equals([input.productionId,recovery.sourceBuildNumber]).first()
  if(!build?.id||!await assertRecordInScope(input.scope,'productBuilds',build,{owner:'work'})||build.stateRevision!==recovery.sourceBuildRevision)throw new Error('[avg-media] 原图复用来源 Build 已变化')
  const briefRow=await db.productProductionBriefs.where('[productionId+revision]').equals([input.productionId,build.briefRevision]).first()
  if(!briefRow||!await assertRecordInScope(input.scope,'productProductionBriefs',briefRow,{owner:'work'})||briefRow.briefHash!==recovery.sourceBriefHash)throw new Error('[avg-media] 原图复用缺少准确来源 Brief')
  const sourceBrief=parseProductProductionBriefV3(briefRow.briefJson),source=readAvgImageDefinitionV3(sourceBrief)
  if(!same(source.mediaBatch,a.mediaBatch)||!same(source.imageBinding,a.imageBinding)
    ||recovery.sourceBatchHash!==await hashProductProductionValueV2(a.mediaBatch))throw new Error('[avg-media] 图片需求、来源或路由已改变，不能复用旧原图')
  const proved=await verifyRetainedAvgRawImageArtifactV1({scope:input.scope,buildId:build.id,expectedBuildRevision:recovery.sourceBuildRevision,
    expectedBriefHash:recovery.sourceBriefHash,expectedPlanHash:recovery.sourcePlanHash,sourceControlEpoch:recovery.sourceControlEpoch,
    artifactKey:ref.proof.artifactKey,version:ref.proof.artifactVersion,contentHash:ref.proof.contentHash})
  if(!same(parseAvgRetainedRawProofV1(proved.provenance),ref.proof))throw new Error('[avg-media] 原图复用证明已变化')
  await assertAvgRawImageOriginV1({scope:input.scope,productionId:input.productionId,brief:sourceBrief,build,artifact:proved.artifact,
    requirementKey:input.requirementKey,taskKey:ref.proof.taskKey},[...visited,build.buildNumber])
  return {artifact:proved.artifact,proof:parseAvgRetainedRawProofV1(proved.provenance),...(await assertAvgRawImageArtifactV1(sourceBrief,proved.artifact))}
}

/** Shared read-only origin check for recovery and later generated references. */
export async function assertAvgRawImageOriginV1(input:{scope:WorkspaceScope;productionId:number;brief:ProductProductionBriefV3;
  build:ProductBuildRecordV1;artifact:ProductBuildArtifactRecordV1;requirementKey:string;taskKey:string},visited:number[]=[]){
  const a=readAvgImageDefinitionV3(input.brief),quality=JSON.parse(input.artifact.qualityJson) as Record<string,unknown>
  if(a.imageRecovery?.retained.some(r=>r.requirementKey===input.requirementKey)){
    if(input.build.parentBuildNumber!==a.imageRecovery.sourceBuildNumber||a.imageRecovery.sourceBuildNumber>=input.build.buildNumber)throw new Error('[avg-media] 原图复用谱系不可验证')
    const prior=await readAvgImageRecoverySourceV1(input,visited)
    if(quality.schema!=='storyforge.avg.raw-image-revalidation'||quality.version!==1||quality.noProviderRequest!==true||!same(quality.retainedOrigin,prior.proof)
      ||input.artifact.contentHash!==prior.artifact.contentHash||input.artifact.payloadJson!==prior.artifact.payloadJson
      ||input.artifact.metadataJson!==prior.artifact.metadataJson||input.artifact.rightsJson!==prior.artifact.rightsJson)throw new Error('[avg-media] 原图复用链不能替换旧像素、需求或权利')
  }else{
    if(quality.received!==true||quality.rawResponseRecorded!==true)throw new Error('[avg-media] 原图缺少原始接收证据')
    await assertAvgOriginalImageResponseV1(input.scope,input.artifact.producerRunId!,input.taskKey,quality)
  }
}

/** Unknown results stay held, including earlier ancestors; no resend authority
 * can be inferred from a stopped Build or an unlimited cash policy. */
export async function assertAvgKnownImageRetriesV1(scope:WorkspaceScope,source:ProductBuildRecordV1,keys:string[]){
  if(!keys.length)return
  let build:ProductBuildRecordV1|undefined=source
  const visited=new Set<number>()
  while(build){
    if(visited.size>=MAXIMUM_RECOVERY_LINEAGE||visited.has(build.buildNumber)||!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-media] 重做来源谱系不可验证')
    visited.add(build.buildNumber)
    const ledger=JSON.parse(build.budgetLedgerJson) as {attempts?:Array<{taskKey:string;usageKnown?:boolean}>}
    if(!Array.isArray(ledger.attempts)||ledger.attempts.some(a=>typeof a.taskKey!=='string'||typeof a.usageKnown!=='boolean'))throw new Error('[avg-media] 原调用记账证据不完整，不能推断可重做')
    if(ledger.attempts?.some(a=>keys.some(k=>a.taskKey===`avg.media.generate.${k}`)&&a.usageKnown===false))throw new Error('[avg-media] 图片仍有结果/费用未知的调用，请先明确封账；不能重发')
    const parent:number|null=build.parentBuildNumber
    build=parent===null?undefined:await db.productBuilds.where('[productionId+buildNumber]').equals([source.productionId,parent]).first()
    if(parent!==null&&!build)throw new Error('[avg-media] 重做来源缺少祖先 Build，不能忽略未知调用')
  }
}

export async function prepareAvgImageRecoveryV1(input:{scope:WorkspaceScope;productionId:number;expectedBuildId:number;expectedBuildRevision:number;retainedRequirementKeys:string[];declaration:string}){
  const build=await db.productBuilds.get(input.expectedBuildId)
  if(!build?.id||build.productionId!==input.productionId||build.stateRevision!==input.expectedBuildRevision||build.previewHash
    ||!['cancelled','failed','recovery-required'].includes(build.status)||!await assertRecordInScope(input.scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-media] 请先明确停止或处理失败，再准备未封存图片恢复方案')
  const briefRow=await db.productProductionBriefs.where('[productionId+revision]').equals([input.productionId,build.briefRevision]).first()
  if(!briefRow||!await assertRecordInScope(input.scope,'productProductionBriefs',briefRow,{owner:'work'}))throw new Error('[avg-media] 图片恢复来源不存在')
  const brief=parseProductProductionBriefV3(briefRow.briefJson),a=readAvgImageDefinitionV3(brief)
  const plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
  const retained=[]
  for(const requirementKey of input.retainedRequirementKeys){
    const row=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,`avg.media.raw.${requirementKey}`]).filter(r=>r.status==='accepted'&&r.controlEpoch===plan.controlEpoch).first()
    if(!row)throw new Error('[avg-media] 选定需求没有可保留的准确原图')
    const proof=await verifyRetainedAvgRawImageArtifactV1({scope:input.scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
      expectedPlanHash:build.planHash,sourceControlEpoch:plan.controlEpoch,artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
    retained.push({requirementKey,proof:parseAvgRetainedRawProofV1(proof.provenance)})
  }
  const recovery=parseAvgImageRecoveryV1({schema:'storyforge.avg.image-recovery',version:1,sourceBuildNumber:build.buildNumber,sourceBuildRevision:build.stateRevision,
    sourceBriefHash:build.briefHash,sourcePlanHash:build.planHash,sourceControlEpoch:plan.controlEpoch,sourceBatchHash:await hashProductProductionValueV2(a.mediaBatch),
    retained,rerunRequirementKeys:a.mediaBatch.requirements.filter(r=>!input.retainedRequirementKeys.includes(r.requirementKey)).map(r=>r.requirementKey),declaration:input.declaration},a.mediaBatch)
  await assertAvgKnownImageRetriesV1(input.scope,build,recovery.rerunRequirementKeys)
  for(const r of recovery.retained)await readAvgImageRecoverySourceV1({scope:input.scope,productionId:input.productionId,brief:{avgAssembly:{...a,imageRecovery:recovery}},requirementKey:r.requirementKey})
  return {recovery,sourceBrief:brief}
}

export async function validateAvgImageRecoveryV1(input:{scope:WorkspaceScope;productionId:number;brief:ProductProductionBriefV3;targetBuild?:ProductBuildRecordV1}){
  const stored=input.brief.avgAssembly
  if(!stored||stored.version===1||stored.version===3&&!stored.image)return
  const a=readAvgImageDefinitionV3(input.brief)
  if(!a.imageRecovery)return
  if(input.targetBuild&&input.targetBuild.parentBuildNumber!==a.imageRecovery.sourceBuildNumber)throw new Error('[avg-media] 当前 Build 与图片恢复父版本不一致')
  const source=await db.productBuilds.where('[productionId+buildNumber]').equals([input.productionId,a.imageRecovery.sourceBuildNumber]).first()
  if(!source)throw new Error('[avg-media] 图片恢复父版本不存在')
  await assertAvgKnownImageRetriesV1(input.scope,source,a.imageRecovery.rerunRequirementKeys)
  for(const r of a.imageRecovery.retained)await readAvgImageRecoverySourceV1({...input,requirementKey:r.requirementKey})
}
