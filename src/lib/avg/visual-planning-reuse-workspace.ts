import { db } from '../db/schema'
import type { ProductBuildRecordV1, WorkspaceScope } from '../types'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { executeProductProductionCommand } from '../product-production/commands'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/model-json-object'
import { readAvgHistoricalVisualArtifactV4 } from './author-artifacts'
import { readAvgDraftV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { assertAvgVisualPlanningDraftMatchesV4 } from './visual-planning-workspace'
import { assertAvgVisualPlanningRestartKnownV4 } from './visual-planning-restart'
import { avgVisualPlanningExecutionReadyV4 } from './visual-planning-brief'
import { avgVisualReuseDescriptorV4, readAvgVisualReuseHistoryV4 } from './visual-planning-reuse'
import { avgVisualPlanningBudgetV4, avgVisualPlanningGateIdsV4 } from './visual-planning-policy'
import { buildAvgVisualPlanningPlanV4 } from './visual-planning-plan'
import { avgVisualPlanningTargetKeysV4, type AvgVisualArtifactRefV4 } from './visual-planning-reuse-contract'

export interface AvgVisualReuseSelectionV4 {buildNumber:number;buildRevision:number;artifact:AvgVisualArtifactRefV4}
async function sourceHistory(scope:WorkspaceScope,build:ProductBuildRecordV1,artifact:AvgVisualArtifactRefV4){
  const row=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
  if(!row)throw new Error('[avg-visual-reuse] 旧版本方案缺失')
  const brief=parseProductProductionBriefV3(row.briefJson),plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
  return readAvgHistoricalVisualArtifactV4({scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,controlEpoch:plan.controlEpoch,
    expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,artifact})
}

/** Read-only source options, including unavailable roles. Never substitute a
 * raw unadopted proposal or hide a changed scope behind an empty candidate. */
export async function readAvgVisualReuseOptionsV4(input:{scope:WorkspaceScope;productionId:number;buildNumber:number;expectedBuildRevision:number}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  const build=details.buildHistory.find(b=>b.buildNumber===input.buildNumber)
  if(!build||build.stateRevision!==input.expectedBuildRevision)throw new Error('[avg-visual-reuse] 来源版本已变化')
  const row=details.briefHistory.find(r=>r.revision===build.briefRevision&&r.briefHash===build.briefHash)
  const brief=row?parseProductProductionBriefV3(row.briefJson):null
  if(!brief?.avgVisualPlanning)throw new Error('[avg-visual-reuse] 来源不是专业视觉版本')
  const options=[]
  for(const artifactKey of avgVisualPlanningTargetKeysV4(brief.avgVisualPlanning.scope)){
    const rows=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,artifactKey]).filter(r=>r.status==='accepted').toArray()
    if(rows.length!==1){options.push({artifactKey,available:false as const,reason:'此岗位没有唯一已确认方案'});continue}
    try{
      const history=await sourceHistory(input.scope,build,{artifactKey,version:rows[0].version,contentHash:rows[0].contentHash})
      const source=avgVisualReuseDescriptorV4(history)
      options.push({artifactKey,available:true as const,source,payload:history.payload,
        modelPayload:parseProductionModelJsonObjectV1(history.original.rawText,String(history.original.modelRequest.taskKey)),authorEdited:history.candidate.visualProposalValidation.authorEdited,
        selection:{buildNumber:build.buildNumber,buildRevision:build.stateRevision,artifact:history.artifact}})
    }catch(error){options.push({artifactKey,available:false as const,reason:error instanceof Error?error.message:'历史证据不完整'})}
  }
  return {buildNumber:build.buildNumber,buildRevision:build.stateRevision,options}
}

/** Re-read actual source records at start as well as at execution/admission.
 * This preflight creates neither a Run nor a current author adoption. */
export async function assertAvgVisualProposalReuseSourcesV4(scope:WorkspaceScope,productionId:number,brief:ReturnType<typeof parseProductProductionBriefV3>,buildNumber:number){
  if(!brief.avgVisualPlanning?.proposalReuse)return
  const details=await readProductProductionDetailsV1(scope,productionId,['avg'])
  const plan=buildAvgVisualPlanningPlanV4({brief:{...brief,avgVisualPlanning:brief.avgVisualPlanning},briefHash:'0'.repeat(64),buildNumber,controlEpoch:details.production.controlEpoch})
  const virtual={productionId,buildNumber} as ProductBuildRecordV1
  for(const source of brief.avgVisualPlanning.proposalReuse){
    const old=details.buildHistory.find(b=>b.buildNumber===source.buildNumber)
    if(!old)throw new Error('[avg-visual-reuse] 准确旧版本缺失')
    await assertAvgVisualPlanningRestartKnownV4(scope,old)
    const task=plan.tasks.find(t=>t.outputArtifactKeys.includes(source.proposal.artifactKey))!
    await readAvgVisualReuseHistoryV4({scope,build:virtual,brief,task,source})
  }
}

export async function prepareAvgVisualProposalReuseV4(input:{scope:WorkspaceScope;productionId:number;expectedBriefHash:string;
  expectedDraftRevision:number;expectedBuildId:number;expectedBuildRevision:number;selections:AvgVisualReuseSelectionV4[]}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build
  const brief=details.brief?parseProductProductionBriefV3(details.brief.briefJson):null,draft=await readAvgDraftV1(input.scope)
  if(!avgVisualPlanningExecutionReadyV4()||!brief?.avgVisualPlanning||!build||build.id!==input.expectedBuildId||build.stateRevision!==input.expectedBuildRevision
    ||!['cancelled','failed','recovery-required'].includes(build.status)||build.previewHash||details.production.status!=='brief-ready'
    ||details.brief!.revision<=build.briefRevision||details.brief!.briefHash!==input.expectedBriefHash||draft.productionId!==input.productionId
    ||draft.revision!==input.expectedDraftRevision||!Array.isArray(input.selections)||input.selections.length>9
    ||new Set(input.selections.map(s=>s.artifact.artifactKey)).size!==input.selections.length)throw new Error('[avg-visual-reuse] 尚未开始的新方案、草稿或完整选择已变化')
  await assertAvgVisualPlanningRestartKnownV4(input.scope,build)
  await assertAvgVisualPlanningDraftMatchesV4(input.scope,parseAvgAuthorWorkspaceV1(draft.editorJson),brief)
  const sources=[]
  for(const selected of input.selections){
    const old=details.buildHistory.find(b=>b.buildNumber===selected.buildNumber&&b.stateRevision===selected.buildRevision)
    if(!old)throw new Error('[avg-visual-reuse] 选中的旧版本已变化')
    sources.push(avgVisualReuseDescriptorV4(await sourceHistory(input.scope,old,selected.artifact)))
  }
  const {proposalReuse:_old,...planning}=brief.avgVisualPlanning
  const next={...brief,avgVisualPlanning:{...planning,...(sources.length?{proposalReuse:sources}:{})},
    capabilityRequirements:brief.capabilityRequirements.map(c=>c.mediaClass==='text'?{...c,required:sources.length<avgVisualPlanningTargetKeysV4(planning.scope).length}:c)}
  next.productionBudget=avgVisualPlanningBudgetV4(next)
  next.capabilityRequirements=next.capabilityRequirements.map(c=>({...c,maximumTotalCost:next.productionBudget.maximumCostUsd}))
  next.completionContract={...next.completionContract,requiredGateIds:avgVisualPlanningGateIdsV4(next)}
  const parsed=parseProductProductionBriefV3(next),nextNumber=1+Math.max(...details.buildHistory.map(b=>b.buildNumber))
  await assertAvgVisualProposalReuseSourcesV4(input.scope,input.productionId,parsed,nextNumber)
  const latest=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),currentDraft=await readAvgDraftV1(input.scope)
  if(currentDraft.revision!==draft.revision||canonicalProductProductionJsonV2(latest.build)!==canonicalProductProductionJsonV2(build)
    ||latest.production.stateRevision!==details.production.stateRevision||latest.brief?.briefHash!==input.expectedBriefHash)throw new Error('[avg-visual-reuse] 核对期间新方案或草稿已变化')
  const receipt=await executeProductProductionCommand({scope:input.scope,productionId:input.productionId,command:{type:'save-brief-revision',
    commandId:`avg.visual.reuse.${crypto.randomUUID()}`,expectedStateRevision:details.production.stateRevision,parentRevision:details.brief!.revision,brief:parsed}})
  if(!receipt.ok)throw new Error(String(receipt.result.message??receipt.errorCode))
  return readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
}
