import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { assertAvgRawImageArtifactFromDefinitionV2,assertAvgRawImageReceptionV2 } from './media-raw-contract-v2'
import { assertAvgOriginalImageResponseV1 } from './media-response-proof'

/** Preserve the original V5 Brief and exact accepted compilation; imported or
 * stopped histories cannot gain current author authority through this read. */
export async function readAvgImageConsumptionDefinitionV5(input:{scope:WorkspaceScope;buildId:number;brief:ProductProductionBriefV3}){
  if(input.brief.avgVisualPlanning?.version!==5)throw new Error('[avg-visual-image] 新版消费要求准确 V5 Brief')
  const build=await db.productBuilds.get(input.buildId)
  if(!build)throw new Error('[avg-visual-image] 新版图片消费缺少准确 Build')
  const load=()=>import('./visual-planning-image-definition-v5')
  const {readAvgCompiledImageDefinitionV5}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
  return readAvgCompiledImageDefinitionV5({...input,expectedBrief:input.brief,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,
    purpose:build.packageHash||build.previewHash?'frozen-verification':'assembly'})
}

/** Semantic/original-response proof only. The author command separately
 * verifies the actual accepted producer, Work Blob and current Plan inputs. */
export async function assertAvgConsumedRawImageV5(input:{scope:WorkspaceScope;brief:ProductProductionBriefV3;row:ProductBuildArtifactRecordV1}){
  const d=await readAvgImageConsumptionDefinitionV5({...input,buildId:input.row.buildId})
  if(d.planning.rawReuse?.some(source=>source.requirementKey===input.row.artifactKey.slice('avg.media.raw.'.length))){
    const load=()=>import('./visual-image-revalidation-v5')
    const {readAvgVisualRawReuseEvidenceV5}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
    const evidence=await readAvgVisualRawReuseEvidenceV5({scope:input.scope,compiled:d,artifact:{artifactKey:input.row.artifactKey,
      version:input.row.version,contentHash:input.row.contentHash}})
    return {payload:evidence.payload,asset:evidence.asset,requirement:evidence.requirement,compiled:d,rawProof:evidence.provenance,original:evidence.original}
  }
  const raw=await assertAvgRawImageArtifactFromDefinitionV2({...d.definition,capability:d.capability,qualityProfile:d.brief.qualityProfile},input.row)
  const q=assertAvgRawImageReceptionV2(input.row.qualityJson,{request:raw.payload.request,rule:d.source.artifact,
    scripts:d.source.scripts.map(s=>s.artifact),compilation:d.definition.compilation})
  const task=d.plan.tasks.find(t=>t.taskKey===`avg.media.generate.${raw.payload.requirement.requirementKey}`)
  if(!task||task.kind!=='avg-media-image-generate'||input.row.producerRunId===null||input.row.controlEpoch!==d.build.controlEpoch)throw new Error('[avg-visual-image] 新版消费缺少准确原始图片任务')
  await assertAvgOriginalImageResponseV1(input.scope,input.row.producerRunId,task.taskKey,q)
  return {...raw,requirement:raw.payload.requirement,compiled:d}
}
