import { avgPendingVisualWorldSourceV4 } from './visual-pending-source'
import type { ProductProductionBriefV3,WorkspaceScope } from '../types'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { executeProductProductionCommand } from '../product-production/commands'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { avgVisualPlanningExecutionReadyV4 } from './visual-planning-brief'
import { readAvgDraftV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { assertAvgVisualPlanningDraftMatchesV4 } from './visual-planning-workspace'
import { assertAvgVisualPlanningRestartKnownV4 } from './visual-planning-restart'
import { readAvgVisualRawReuseSourceV4 } from './visual-image-reuse'
import { parseAvgVisualRawReuseSourcesV4,type AvgVisualRawReuseSourceV4 } from './visual-image-reuse-contract'
import { avgVisualPlanningBudgetV4,avgVisualPlanningGateIdsV4 } from './visual-planning-policy'

const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)

/** Original evidence and frozen non-design parameters before any new Run.
 * Actual adopted prompts/references are checked again after compilation. */
export async function assertAvgVisualRawReuseSourcesV4(scope:WorkspaceScope,productionId:number,brief:ProductProductionBriefV3,buildNumber:number){
  if(!brief.avgVisualPlanning?.rawReuse)return
  const details=await readProductProductionDetailsV1(scope,productionId,['avg'])
  for(const source of brief.avgVisualPlanning.rawReuse){
    const old=details.buildHistory.find(b=>b.buildNumber===source.raw.buildNumber)
    if(!old||source.productionKey!==details.production.productionKey||source.raw.buildNumber>=buildNumber
      ||source.sourceWorldContentHash!==brief.source.worldContentHash)throw new Error('[avg-visual-raw-reuse] 原图不是同制作、同世界的准确较早版本')
    await assertAvgVisualPlanningRestartKnownV4(scope,old)
    const history=await readAvgVisualRawReuseSourceV4({scope,source}),template=brief.avgVisualPlanning.scope.templates.find(t=>t.parameters.requirementKey===source.requirementKey)
    const {prompt:_p,negativePrompt:_n,invariants:_i,forbiddenDepictions:_f,references:_refs,revision:_r,...parameters}=history.payload.requirement
    const {revision:_current,...current}=template!.parameters
    if(!same(parameters,current))throw new Error('[avg-visual-raw-reuse] 原图用途、家族或像素参数已变化')
  }
}

/** Explicit reviewable source selection; no provider resolution, Run or old
 * author approval is copied. Empty selection clears only this new field. */
export async function prepareAvgVisualRawReuseV4(input:{scope:WorkspaceScope;productionId:number;expectedBriefHash:string;
  expectedDraftRevision:number;expectedBuildId:number;expectedBuildRevision:number;sources:AvgVisualRawReuseSourceV4[]}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build
  const brief=details.brief?parseProductProductionBriefV3(details.brief.briefJson):null,draft=await readAvgDraftV1(input.scope)
  if(!avgVisualPlanningExecutionReadyV4()||brief?.avgVisualPlanning?.version!==4||!build||build.id!==input.expectedBuildId||build.stateRevision!==input.expectedBuildRevision
    ||!['cancelled','failed','recovery-required'].includes(build.status)||build.previewHash||details.production.status!=='brief-ready'
    ||details.brief!.revision<=build.briefRevision||details.brief!.briefHash!==input.expectedBriefHash||draft.productionId!==input.productionId
    ||draft.revision!==input.expectedDraftRevision||!Array.isArray(input.sources))throw new Error('[avg-visual-raw-reuse] 尚未开始的新方案、父版本或草稿已变化')
  await assertAvgVisualPlanningRestartKnownV4(input.scope,build)
  await assertAvgVisualPlanningDraftMatchesV4(input.scope,parseAvgAuthorWorkspaceV1(draft.editorJson),brief)
  const sources=input.sources.length?parseAvgVisualRawReuseSourcesV4(input.sources,brief.avgVisualPlanning.scope.templates.map(t=>t.parameters.requirementKey)):[]
  const {rawReuse:_previous,...planning}=brief.avgVisualPlanning
  const next={...brief,source:avgPendingVisualWorldSourceV4(brief,details.brief!,draft.worldReleaseId),avgVisualPlanning:{...planning,...(sources.length?{rawReuse:sources}:{})},
    capabilityRequirements:brief.capabilityRequirements.map(c=>c.mediaClass==='image'?{...c,required:sources.length<planning.scope.templates.length}:c)}
  next.productionBudget=avgVisualPlanningBudgetV4(next)
  next.capabilityRequirements=next.capabilityRequirements.map(c=>({...c,maximumTotalCost:next.productionBudget.maximumCostUsd}))
  next.completionContract={...next.completionContract,requiredGateIds:avgVisualPlanningGateIdsV4(next)}
  const parsed=parseProductProductionBriefV3(next)
  await assertAvgVisualRawReuseSourcesV4(input.scope,input.productionId,parsed,1+Math.max(0,...details.buildHistory.map(b=>b.buildNumber)))
  const latest=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),currentDraft=await readAvgDraftV1(input.scope)
  if(currentDraft.revision!==draft.revision||!same(latest.build,build)||latest.production.stateRevision!==details.production.stateRevision
    ||latest.brief?.briefHash!==input.expectedBriefHash)throw new Error('[avg-visual-raw-reuse] 核对期间方案或草稿已变化')
  if(same(parsed,brief))return latest
  const receipt=await executeProductProductionCommand({scope:input.scope,productionId:input.productionId,command:{type:'save-brief-revision',
    commandId:`avg.visual.raw-reuse.${crypto.randomUUID()}`,expectedStateRevision:details.production.stateRevision,parentRevision:details.brief!.revision,brief:parsed}})
  if(!receipt.ok)throw new Error(String(receipt.result.message??receipt.errorCode))
  return readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
}
