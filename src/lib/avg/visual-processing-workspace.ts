import { avgPendingVisualWorldSourceV4 } from './visual-pending-source'
import type { WorkspaceScope } from '../types'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { executeProductProductionCommand } from '../product-production/commands'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { avgVisualPlanningExecutionReadyV4 } from './visual-planning-brief'
import { avgVisualPlanningExecutionReadyV5 } from './visual-planning-brief-v5'
import { readAvgDraftV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { assertAvgVisualPlanningDraftMatchesV4,assertAvgVisualPlanningDraftMatchesV5 } from './visual-planning-workspace'
import { assertAvgVisualPlanningRestartKnownV4 } from './visual-planning-restart'
import { parseAvgImageProcessingPlanV1,type AvgImageProcessingPlanV1 } from './image-processing-contract'
import { avgVisualPlanningBudgetV4,avgVisualPlanningGateIdsV4 } from './visual-planning-policy'
import { avgVisualPlanningBudgetV5,avgVisualPlanningGateIdsV5 } from './visual-planning-policy-v5'

const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)

/** Explicit recipe for an unstarted actual V4 Brief. No mirrored legacy
 * media batch, provider resolution, Run, processing or author adoption. */
export async function prepareAvgVisualImageProcessingV4(input:{scope:WorkspaceScope;productionId:number;expectedBriefHash:string;
  expectedDraftRevision:number;expectedBuild:{id:number;revision:number}|null;plan:AvgImageProcessingPlanV1|null}){
  return prepareVisualProcessing(input,4)
}
export function prepareAvgVisualImageProcessingV5(input:Parameters<typeof prepareAvgVisualImageProcessingV4>[0]){
  return prepareVisualProcessing(input,5)
}
async function prepareVisualProcessing(input:Parameters<typeof prepareAvgVisualImageProcessingV4>[0],version:4|5){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build
  const brief=details.brief?parseProductProductionBriefV3(details.brief.briefJson):null,draft=await readAvgDraftV1(input.scope)
  if(!(version===5?avgVisualPlanningExecutionReadyV5():avgVisualPlanningExecutionReadyV4())||brief?.avgVisualPlanning?.version!==version||details.production.status!=='brief-ready'
    ||details.brief!.briefHash!==input.expectedBriefHash||draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId
    ||(build?(!input.expectedBuild||build.id!==input.expectedBuild.id||build.stateRevision!==input.expectedBuild.revision
      ||details.brief!.revision<=build.briefRevision):input.expectedBuild!==null))throw new Error('[avg-process] 尚未开始的专业方案、父版本或草稿已变化')
  if(build)await assertAvgVisualPlanningRestartKnownV4(input.scope,build)
  await (version===5?assertAvgVisualPlanningDraftMatchesV5:assertAvgVisualPlanningDraftMatchesV4)(input.scope,parseAvgAuthorWorkspaceV1(draft.editorJson),brief)
  const {imageProcessing:_previous,...planning}=brief.avgVisualPlanning
  const next={...brief,source:avgPendingVisualWorldSourceV4(brief,details.brief!,draft.worldReleaseId),avgVisualPlanning:{...planning,...(input.plan===null?{}:{imageProcessing:parseAvgImageProcessingPlanV1(input.plan)})}}
  next.productionBudget=(version===5?avgVisualPlanningBudgetV5:avgVisualPlanningBudgetV4)(next)
  next.capabilityRequirements=next.capabilityRequirements.map(c=>({...c,maximumTotalCost:next.productionBudget.maximumCostUsd}))
  next.completionContract={...next.completionContract,requiredGateIds:(version===5?avgVisualPlanningGateIdsV5:avgVisualPlanningGateIdsV4)(next)}
  const parsed=parseProductProductionBriefV3(next)
  const latest=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),currentDraft=await readAvgDraftV1(input.scope)
  if(currentDraft.revision!==draft.revision||latest.production.stateRevision!==details.production.stateRevision
    ||latest.brief?.briefHash!==input.expectedBriefHash||!same(latest.build,build))throw new Error('[avg-process] 核对期间方案或草稿已变化')
  if(same(parsed,brief))return latest
  const receipt=await executeProductProductionCommand({scope:input.scope,productionId:input.productionId,command:{type:'save-brief-revision',
    commandId:`avg.visual.process.${crypto.randomUUID()}`,expectedStateRevision:details.production.stateRevision,parentRevision:details.brief!.revision,brief:parsed}})
  if(!receipt.ok)throw new Error(String(receipt.result.message??receipt.errorCode))
  return readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
}
