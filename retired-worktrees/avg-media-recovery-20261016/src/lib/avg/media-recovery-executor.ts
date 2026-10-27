import { db } from '../db/schema'
import type { ProductProductionBriefV3 } from '../types'
import { ProductProductionDraftRejectedErrorV1, type ProductProductionTaskExecutionInputV1, type ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertAvgImageProductionDefinitionV3 } from './media-production-definition'
import { readAvgImageRecoverySourceV1 } from './media-recovery'
import { readAvgImageTaskSourcesV2 } from './media-task-source'

export async function executeAvgImageRecoveryTaskV1(input:ProductProductionTaskExecutionInputV1,brief:ProductProductionBriefV3):Promise<ProductProductionTaskExecutionResultV1>{
  const started=Date.now()
  const usage=(storageBytes=0)=>({modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:Date.now()-started,storageBytes})
  try{
    const {assembly}=await assertAvgImageProductionDefinitionV3(brief)
    const recovery=assembly.imageRecovery,r=recovery?.retained.find(r=>input.task.taskKey===`avg.media.generate.${r.requirementKey}`)
    const build=await db.productBuilds.get(input.buildId)
    if(!recovery||!r||!build||build.parentBuildNumber!==recovery.sourceBuildNumber||input.task.kind!=='avg-media-image-reuse'
      ||input.task.executionMode!=='deterministic'||input.task.skillId!==null||input.task.budgetReservation.mediaCalls!==0
      ||input.task.maxAttempts!==1||input.attempt!==1||!input.contextText.trim())throw new Error('[avg-media] 原图复用不属于已冻结的零调用任务')
    if(input.signal.aborted)throw new Error('[avg-media] 原图复验已停止，未调用供应商')
    const source=await readAvgImageTaskSourcesV2(input,brief)
    const prior=await readAvgImageRecoverySourceV1({scope:input.scope,productionId:build.productionId,brief,requirementKey:r.requirementKey})
    await readAvgImageTaskSourcesV2(input,brief)
    if(input.signal.aborted)throw new Error('[avg-media] 原图复验已停止，未调用供应商')
    const quality={schema:'storyforge.avg.raw-image-revalidation',version:1,retainedOrigin:prior.proof,noProviderRequest:true,contentHashVerified:true,decoderVerified:false,
      sourceRule:source.artifact,sourceScripts:source.scripts.map(s=>s.artifact),sourceContextHash:await hashProductProductionValueV2(input.contextText)}
    const artifact={artifactKey:prior.artifact.artifactKey,requirementKey:prior.artifact.requirementKey,kind:'image' as const,mediaKind:prior.artifact.mediaKind,
      payload:prior.payload,metadata:prior.asset,quality,rights:JSON.parse(prior.artifact.rightsJson),contentHash:prior.artifact.contentHash,
      blobObjectId:prior.artifact.blobObjectId,mimeType:prior.artifact.mimeType,byteSize:prior.artifact.byteSize}
    return {artifacts:[artifact],passedGateIds:[...input.task.acceptanceGateIds],usage:usage(new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength)}
  }catch(error){throw new ProductProductionDraftRejectedErrorV1(error instanceof Error?error.message:'[avg-media] 原图复验失败',usage())}
}
