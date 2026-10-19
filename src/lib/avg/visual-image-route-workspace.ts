import { avgPendingVisualWorldSourceV4 } from './visual-pending-source'
import type { WorkspaceScope } from '../types'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { executeProductProductionCommand } from '../product-production/commands'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgDraftV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { avgVisualPlanningExecutionReadyV4 } from './visual-planning-brief'
import { avgVisualPlanningExecutionReadyV5 } from './visual-planning-brief-v5'
import { assertAvgVisualPlanningDraftMatchesV4,assertAvgVisualPlanningDraftMatchesV5 } from './visual-planning-workspace'
import { avgImageReferenceCapabilityV2,type AvgImageAdapterIdV4 } from './media-reference-contract'
import { resolveAvgImageExecutionCapabilityV4 } from './media-capability'
import { assertAvgVisualPlanningRestartKnownV4,assertAvgVisualPlanningOtherRequestsKnownV4 } from './visual-planning-restart'
import { assertAvgVisualProposalReuseSourcesV4 } from './visual-planning-reuse-workspace'
import { avgVisualPlanningBudgetV4,avgVisualPlanningGateIdsV4 } from './visual-planning-policy'
import { avgVisualPlanningBudgetV5,avgVisualPlanningGateIdsV5 } from './visual-planning-policy-v5'

/** Author-selected non-secret model binding for an unstarted V4 Brief only.
 * This resolves configuration, never account capability or provider output.
 * Old requests/receipts and semantic reuse sources are immutable. */
export async function prepareAvgVisualImageRouteV4(input:{
  scope:WorkspaceScope;productionId:number;expectedBriefHash:string;expectedDraftRevision:number
  expectedBuild:{id:number;revision:number}|null;adapterId:AvgImageAdapterIdV4
}){
  return prepareVisualImageRoute(input,4)
}
export function prepareAvgVisualImageRouteV5(input:Parameters<typeof prepareAvgVisualImageRouteV4>[0]){
  return prepareVisualImageRoute(input,5)
}
async function prepareVisualImageRoute(input:Parameters<typeof prepareAvgVisualImageRouteV4>[0],version:4|5){
  const selected=avgImageReferenceCapabilityV2(input.adapterId)
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build
  const brief=details.brief?parseProductProductionBriefV3(details.brief.briefJson):null,draft=await readAvgDraftV1(input.scope)
  if(!(version===5?avgVisualPlanningExecutionReadyV5():avgVisualPlanningExecutionReadyV4())||brief?.avgVisualPlanning?.version!==version||details.production.status!=='brief-ready'
    ||details.brief!.briefHash!==input.expectedBriefHash||draft.revision!==input.expectedDraftRevision||draft.productionId!==input.productionId
    ||(build?(!input.expectedBuild||build.id!==input.expectedBuild.id||build.stateRevision!==input.expectedBuild.revision
      ||!['cancelled','failed','recovery-required'].includes(build.status)||!!build.previewHash||details.brief!.revision<=build.briefRevision):input.expectedBuild!==null))throw new Error('[avg-visual-image] 尚未开始的方案、父版本或草稿已变化')
  if(build)await assertAvgVisualPlanningRestartKnownV4(input.scope,build)
  await assertAvgVisualPlanningOtherRequestsKnownV4(input.scope,build)
  await (version===5?assertAvgVisualPlanningDraftMatchesV5:assertAvgVisualPlanningDraftMatchesV4)(input.scope,parseAvgAuthorWorkspaceV1(draft.editorJson),brief)
  const existing=brief.capabilityRequirements.find(c=>c.requirementKey==='avg.media.image')!
  const requirement={...existing,capabilityHash:await hashProductProductionValueV2(selected)}
  const configured=await resolveAvgImageExecutionCapabilityV4({projectId:input.scope.projectId,requirement,adapterId:selected.adapterId})
  const next={...brief,source:avgPendingVisualWorldSourceV4(brief,details.brief!,draft.worldReleaseId),avgVisualPlanning:{...brief.avgVisualPlanning,imageBinding:{...configured.binding,endpointRouteHash:configured.endpointRouteHash}},
    capabilityRequirements:brief.capabilityRequirements.map(c=>c.requirementKey===requirement.requirementKey?requirement:c)}
  next.productionBudget=(version===5?avgVisualPlanningBudgetV5:avgVisualPlanningBudgetV4)(next)
  next.capabilityRequirements=next.capabilityRequirements.map(c=>({...c,maximumTotalCost:next.productionBudget.maximumCostUsd}))
  next.completionContract={...next.completionContract,requiredGateIds:(version===5?avgVisualPlanningGateIdsV5:avgVisualPlanningGateIdsV4)(next)}
  const parsed=parseProductProductionBriefV3(next)
  if(version===4)await assertAvgVisualProposalReuseSourcesV4(input.scope,input.productionId,parsed,1+Math.max(0,...details.buildHistory.map(b=>b.buildNumber)))
  const current=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),currentDraft=await readAvgDraftV1(input.scope)
  const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
  if(currentDraft.revision!==draft.revision||!same(current.build,build)||current.production.stateRevision!==details.production.stateRevision
    ||current.brief?.briefHash!==input.expectedBriefHash)throw new Error('[avg-visual-image] 核对图片配置期间来源已变化')
  if(same(parsed,brief))return current
  const receipt=await executeProductProductionCommand({scope:input.scope,productionId:input.productionId,command:{type:'save-brief-revision',
    commandId:`avg.visual.image-route.${crypto.randomUUID()}`,expectedStateRevision:details.production.stateRevision,parentRevision:details.brief!.revision,brief:parsed}})
  if(!receipt.ok)throw new Error(String(receipt.result.message??receipt.errorCode))
  return readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
}
