import { db } from '../db/schema'
import type { ProductProductionBriefV3 } from '../types'
import type { ProductProductionTaskExecutionInputV1 } from '../product-production/scheduler'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import { assertAvgMediaConsumerDeclarationsV1, validateAvgVisualProductionBatchSourceV1 } from './media-source'
import { assertAvgImageProductionDefinitionV3 } from './media-production-definition'
import { validateAvgVoiceRecoveryV1 } from './voice-recovery'

/** Same actual adopted source proof for a new request and zero-call reuse. */
export async function readAvgImageTaskSourcesV2(input:ProductProductionTaskExecutionInputV1,brief:ProductProductionBriefV3){
  const {assembly}=await assertAvgImageProductionDefinitionV3(brief)
  const batch=assembly.mediaBatch,build=await db.productBuilds.get(input.buildId)
  if(!build||!await assertRecordInScope(input.scope,'productBuilds',build,{owner:'work'})||build.status!=='building'
    ||build.controlEpoch!==input.controlEpoch||build.planHash!==input.planHash||build.briefHash!==await hashProductProductionValueV2(brief))throw new Error('[avg-media] 图片任务来源已 stale')
  await validateAvgVoiceRecoveryV1({ scope: input.scope, productionId: input.productionId, brief, targetBuild: build, checkProspectiveRequests: false })
  const accepted=await readAvgSystemPlanForCompilationV1({scope:input.scope,buildId:input.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:input.controlEpoch,includeSceneScripts:true})
  await validateAvgVisualProductionBatchSourceV1(batch,{systemPlan:accepted.plan,scripts:accepted.scripts.map(s=>s.payload),presentation:{aspectRatio:batch.aspectRatio}})
  assertAvgMediaConsumerDeclarationsV1(batch,accepted.plan)
  const refs=[accepted.artifact,...accepted.scripts.map(s=>s.artifact)]
  const actual=input.inputArtifacts.map(row=>({artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash}))
  const sort=(rows:typeof refs)=>[...rows].sort((a,b)=>a.artifactKey<b.artifactKey?-1:a.artifactKey>b.artifactKey?1:0)
  if(canonicalProductProductionJsonV2(sort(refs))!==canonicalProductProductionJsonV2(sort(actual)))throw new Error('[avg-media] Harness 输入不是准确的已采用来源')
  return accepted
}
