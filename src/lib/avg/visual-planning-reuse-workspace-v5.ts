import { avgPendingVisualWorldSourceV4 } from './visual-pending-source'
import { db } from '../db/schema'
import type { ProductBuildRecordV1,WorkspaceScope } from '../types'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { executeProductProductionCommand } from '../product-production/commands'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readAvgDraftV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { assertAvgVisualPlanningDraftMatchesV5 } from './visual-planning-workspace'
import { assertAvgVisualPlanningRestartKnownV4 } from './visual-planning-restart'
import { avgVisualPlanningExecutionReadyV5 } from './visual-planning-brief-v5'
import { avgVisualReuseDescriptorV5,readAvgVisualReuseHistoryV5 } from './visual-planning-reuse-v5'
import { avgVisualPlanningBudgetV5,avgVisualPlanningGateIdsV5 } from './visual-planning-policy-v5'
import { buildAvgVisualPlanningPlanV5 } from './visual-planning-plan-v5'
import { avgVisualPlanningTargetKeysV4,type AvgVisualArtifactRefV4,type AvgVisualProposalReuseSourceV5 } from './visual-planning-reuse-contract'

export interface AvgVisualReuseSelectionV5{buildNumber:number;buildRevision:number;artifact:AvgVisualArtifactRefV4}
async function sourceHistory(scope:WorkspaceScope,build:ProductBuildRecordV1,artifact:AvgVisualArtifactRefV4){
  const row=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
  if(!row)throw new Error('[avg-visual-reuse] V5 旧版本方案缺失')
  const brief=parseProductProductionBriefV3(row.briefJson),plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
  if(brief.avgVisualPlanning?.version!==5)throw new Error('[avg-visual-reuse] V5 来源版本错误')
  const [history]=await (await import('./author-artifacts')).readAvgHistoricalVisualArtifactsV5({scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,
    controlEpoch:plan.controlEpoch,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,artifacts:[artifact]})
  return history
}

export async function readAvgVisualReuseOptionsV5(input:{scope:WorkspaceScope;productionId:number;buildNumber:number;expectedBuildRevision:number}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.buildHistory.find(b=>b.buildNumber===input.buildNumber)
  if(!build||build.stateRevision!==input.expectedBuildRevision)throw new Error('[avg-visual-reuse] V5 来源版本已变化')
  const row=details.briefHistory.find(r=>r.revision===build.briefRevision&&r.briefHash===build.briefHash),brief=row?parseProductProductionBriefV3(row.briefJson):null
  if(brief?.avgVisualPlanning?.version!==5)throw new Error('[avg-visual-reuse] 来源不是 V5 专业视觉版本')
  const options=[]
  for(const artifactKey of avgVisualPlanningTargetKeysV4(brief.avgVisualPlanning.scope)){
    const rows=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,artifactKey]).filter(r=>r.status==='accepted').toArray()
    if(rows.length!==1){options.push({artifactKey,available:false as const,reason:'此岗位没有唯一已确认方案'});continue}
    try{
      const history=await sourceHistory(input.scope,build,{artifactKey,version:rows[0].version,contentHash:rows[0].contentHash}),source=avgVisualReuseDescriptorV5(history)
      if((history.candidate.version!==6&&history.candidate.version!==7)||!('visualProposalValidation' in history.candidate))throw new Error('[avg-visual-reuse] V5 作者版本缺少视觉采用回执')
      options.push({artifactKey,available:true as const,source,payload:history.payload,
        modelPayload:(await import('../product-production/model-json-object')).parseProductionModelJsonObjectV1(history.original.rawText,String(history.original.modelRequest.taskKey)),
        authorEdited:history.candidate.visualProposalValidation.authorEdited,
        selection:{buildNumber:build.buildNumber,buildRevision:build.stateRevision,artifact:history.artifact}})
    }catch(error){options.push({artifactKey,available:false as const,reason:error instanceof Error?error.message:'V5 历史证据不完整'})}
  }
  return {buildNumber:build.buildNumber,buildRevision:build.stateRevision,options}
}

export async function assertAvgVisualProposalReuseSourcesV5(scope:WorkspaceScope,productionId:number,brief:ReturnType<typeof parseProductProductionBriefV3>,buildNumber:number){
  const planning=brief.avgVisualPlanning
  if(!planning||planning.version!==5||!planning.proposalReuse)return
  const details=await readProductProductionDetailsV1(scope,productionId,['avg'])
  const plan=buildAvgVisualPlanningPlanV5({brief:{...brief,avgVisualPlanning:planning},briefHash:'0'.repeat(64),buildNumber,controlEpoch:details.production.controlEpoch})
  const virtual={productionId,buildNumber} as ProductBuildRecordV1
  for(const source of planning.proposalReuse??[]){
    const old=details.buildHistory.find(b=>b.buildNumber===source.buildNumber)
    if(!old)throw new Error('[avg-visual-reuse] V5 准确旧版本缺失')
    await assertAvgVisualPlanningRestartKnownV4(scope,old)
    const task=plan.tasks.find(t=>t.outputArtifactKeys.includes(source.proposal.artifactKey))
    if(!task)throw new Error('[avg-visual-reuse] V5 冻结复用任务缺失')
    await readAvgVisualReuseHistoryV5({scope,build:virtual,brief,task,source})
  }
}

export async function prepareAvgVisualProposalReuseV5(input:{scope:WorkspaceScope;productionId:number;expectedBriefHash:string;
  expectedDraftRevision:number;expectedBuildId:number;expectedBuildRevision:number;selections:AvgVisualReuseSelectionV5[]}){
  const details=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),build=details.build
  const brief=details.brief?parseProductProductionBriefV3(details.brief.briefJson):null,draft=await readAvgDraftV1(input.scope)
  if(!avgVisualPlanningExecutionReadyV5()||brief?.avgVisualPlanning?.version!==5||!build||build.id!==input.expectedBuildId||build.stateRevision!==input.expectedBuildRevision
    ||!['cancelled','failed','recovery-required'].includes(build.status)||build.previewHash||details.production.status!=='brief-ready'
    ||details.brief!.revision<=build.briefRevision||details.brief!.briefHash!==input.expectedBriefHash||draft.productionId!==input.productionId
    ||draft.revision!==input.expectedDraftRevision||!Array.isArray(input.selections)||input.selections.length>9
    ||new Set(input.selections.map(s=>s.artifact.artifactKey)).size!==input.selections.length)throw new Error('[avg-visual-reuse] V5 尚未开始的新方案、草稿或完整选择已变化')
  await assertAvgVisualPlanningRestartKnownV4(input.scope,build)
  await assertAvgVisualPlanningDraftMatchesV5(input.scope,parseAvgAuthorWorkspaceV1(draft.editorJson),brief)
  const sources:AvgVisualProposalReuseSourceV5[]=[]
  for(const selected of input.selections){
    const old=details.buildHistory.find(b=>b.buildNumber===selected.buildNumber&&b.stateRevision===selected.buildRevision)
    if(!old)throw new Error('[avg-visual-reuse] V5 选中的旧版本已变化')
    sources.push(avgVisualReuseDescriptorV5(await sourceHistory(input.scope,old,selected.artifact)))
  }
  const {proposalReuse:_old,...planning}=brief.avgVisualPlanning
  const next={...brief,source:avgPendingVisualWorldSourceV4(brief,details.brief!,draft.worldReleaseId),avgVisualPlanning:{...planning,...(sources.length?{proposalReuse:sources}:{})},
    capabilityRequirements:brief.capabilityRequirements.map(c=>c.mediaClass==='text'?{...c,required:sources.length<avgVisualPlanningTargetKeysV4(planning.scope).length}:c)}
  next.productionBudget=avgVisualPlanningBudgetV5(next)
  next.capabilityRequirements=next.capabilityRequirements.map(c=>({...c,maximumTotalCost:next.productionBudget.maximumCostUsd}))
  next.completionContract={...next.completionContract,requiredGateIds:avgVisualPlanningGateIdsV5(next)}
  const parsed=parseProductProductionBriefV3(next),nextNumber=1+Math.max(...details.buildHistory.map(b=>b.buildNumber))
  await assertAvgVisualProposalReuseSourcesV5(input.scope,input.productionId,parsed,nextNumber)
  const latest=await readProductProductionDetailsV1(input.scope,input.productionId,['avg']),currentDraft=await readAvgDraftV1(input.scope)
  if(currentDraft.revision!==draft.revision||canonicalProductProductionJsonV2(latest.build)!==canonicalProductProductionJsonV2(build)
    ||latest.production.stateRevision!==details.production.stateRevision||latest.brief?.briefHash!==input.expectedBriefHash)throw new Error('[avg-visual-reuse] V5 核对期间新方案或草稿已变化')
  const receipt=await executeProductProductionCommand({scope:input.scope,productionId:input.productionId,command:{type:'save-brief-revision',
    commandId:`avg.visual.v5-reuse.${crypto.randomUUID()}`,expectedStateRevision:details.production.stateRevision,parentRevision:details.brief!.revision,brief:parsed}})
  if(!receipt.ok)throw new Error(String(receipt.result.message??receipt.errorCode))
  return readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
}
