import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildRecordV1,ProductProductionBriefV3,ProductProductionPlanTaskV3,WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { parseAvgVisualProposalReuseSourceV5,type AvgVisualProposalReuseSourceV5 } from './visual-planning-reuse-contract'
import { readAvgHistoricalVisualArtifactsV5 } from './author-artifacts'
import { avgVisualRoleTargetV5,assertAvgVisualRoleProposalV5,isAvgVisualReuseTaskV5 } from './visual-role-proposal-v5'
import { validateAvgVisualSemanticV4 } from './visual-role-proposal'
import { AVG_VISUAL_PLANNING_ROLES_V5,avgVisualPlanningMethodV5 } from './visual-planning-roles-v5'
import { parseProductionModelJsonObjectV1 } from '../product-production/model-json-object'
import { hashAvgVisualExactTextV1 } from './visual-planning-evidence'
import { avgRecord } from './protocol-validation'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import type { AvgVisualProposalEvidenceV5 } from './visual-planning-evidence'

const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
const semanticKeys=['sourceInputHash','aspectRatio','subjects','requirements','references','visualDirection','sourceWorldContentHash'] as const
const lifecycleKeys=['taskKey','productionKey','buildNumber','controlEpoch','planHash','briefRevision','briefHash','sourcePlanHash','confirmedBriefHash','artifacts','taskBudget']
export type AvgVisualReusePathV5=readonly string[]

export function avgVisualReuseDescriptorV5(history:Awaited<ReturnType<typeof readAvgHistoricalVisualArtifactsV5>>[number]):AvgVisualProposalReuseSourceV5{
  return parseAvgVisualProposalReuseSourceV5({schema:'storyforge.avg.visual-proposal-reuse-source',version:2,
    productionKey:history.source.productionKey,buildNumber:history.source.buildNumber,buildRevision:history.source.buildRevision,
    controlEpoch:history.source.controlEpoch,briefHash:history.source.briefHash,planHash:history.source.planHash,
    artifact:history.artifact,authorReceiptHash:history.authorReceiptHash,proposal:history.original.artifact,
    producerReceiptHash:history.original.producerReceiptHash,requestSnapshotHash:history.original.quality.requestSnapshotHash,
    rawResponseHash:history.original.quality.rawResponseHash})
}

/** Re-prove a V5 author decision, original proposal Run, scope, route and
 * registered method. Reuse provides a fresh candidate only; adoption is new. */
type VisualReuseHistoryInputV5={scope:WorkspaceScope;build:ProductBuildRecordV1;brief:ProductProductionBriefV3;
  task:ProductProductionPlanTaskV3;source:AvgVisualProposalReuseSourceV5;path?:AvgVisualReusePathV5}
type VisualReuseHistoryV5=Awaited<ReturnType<typeof readAvgHistoricalVisualArtifactsV5>>[number]
export function readAvgVisualReuseHistoryV5(input:VisualReuseHistoryInputV5):Promise<VisualReuseHistoryV5>{
  return readVisualReuseHistoryV5(input,true)
}
async function readVisualReuseHistoryV5(input:VisualReuseHistoryInputV5,currentMethod:boolean):Promise<VisualReuseHistoryV5>{
  const source=parseAvgVisualProposalReuseSourceV5(input.source),path=input.path??[],planning=input.brief.avgVisualPlanning
  const identity=`${source.productionKey}:${source.buildNumber}:${source.artifact.artifactKey}`
  if(path.length>=32||path.includes(identity)||source.buildNumber>=input.build.buildNumber||planning?.version!==5
    ||!isAvgVisualReuseTaskV5(input.task)||avgVisualRoleTargetV5(input.task,planning.scope)!==source.artifact.artifactKey)throw new Error('[avg-visual-reuse] V5 来源循环、超界或岗位不准确')
  const production=await db.productProductions.get(input.build.productionId)
  const old=await db.productBuilds.where('[productionId+buildNumber]').equals([input.build.productionId,source.buildNumber]).first()
  if(!production||production.productionKey!==source.productionKey||!old||!await assertRecordInScope(input.scope,'productBuilds',old,{owner:'work'}))throw new Error('[avg-visual-reuse] V5 来源不是同作品、同制作的旧版本')
  const [history]=await readAvgHistoricalVisualArtifactsV5({scope:input.scope,buildId:old.id!,expectedBuildRevision:source.buildRevision,
    controlEpoch:source.controlEpoch,expectedBriefHash:source.briefHash,expectedPlanHash:source.planHash,artifacts:[source.artifact]},[...path,identity])
  if(!same(avgVisualReuseDescriptorV5(history),source)||!same(history.source.planning,planning.scope)
    ||history.source.sourceWorldContentHash!==input.brief.source.worldContentHash
    ||history.original.binding.bindingHash!==input.brief.capabilityRequirements.find(c=>c.requirementKey==='avg.visual.planning.text')?.capabilityHash)throw new Error('[avg-visual-reuse] V5 原作者回执、范围、世界或文本路由已变化')
  const key=source.artifact.artifactKey,kind=key==='avg.media.visual-bible'?null:planning.scope.templates.find(t=>key===`avg.media.${t.subjectKind}-brief.${t.parameters.family.subjectKey}`)?.subjectKind
  const role=AVG_VISUAL_PLANNING_ROLES_V5.find(r=>r.subjectKind===kind)
  if(!role)throw new Error('[avg-visual-reuse] V5 来源岗位无效')
  const skill=getAgentSkillV1(role.skillId),request=history.original.modelRequest
  if(currentMethod&&(!same(history.original.modelRun.contract.executionBindings,[{stepId:input.task.taskKey,...createAgentSkillExecutionBindingV1(skill)}])
    ||request.systemPrompt!==avgVisualPlanningMethodV5(role.subjectKind)||request.promptVersion!==skill.promptVersion
    ||request.maximumOutputTokens!==role.outputTokens))throw new Error('[avg-visual-reuse] V5 原模型岗位方法已变化，不能自动复用')
  return history
}

export function readAvgVisualReuseContextPacketV5(text:string,reuse=false){
  const start=text.indexOf('{'),end=text.lastIndexOf('}')
  if(start<0||end<start)throw new Error('[avg-visual-reuse] V5 实际岗位输入缺少准确 JSON')
  const packet=avgRecord(JSON.parse(text.slice(start,end+1)),['schema','version',...semanticKeys,...lifecycleKeys,...(reuse?['operation','reuseSource']:[])],'V5 visual role context')
  if(packet.schema!=='storyforge.avg.visual-planning-inputs'||packet.version!==5||reuse&&packet.operation!=='reuse-confirmed-visual-proposal')throw new Error('[avg-visual-reuse] V5 实际岗位输入版本无效')
  return packet
}
export function assertAvgVisualReuseSemanticInputV5(contextText:string,history:Awaited<ReturnType<typeof readAvgVisualReuseHistoryV5>>,source:AvgVisualProposalReuseSourceV5){
  const current=readAvgVisualReuseContextPacketV5(contextText,true),original=readAvgVisualReuseContextPacketV5(String(history.original.modelRequest.contextText))
  if(!same(current.reuseSource,source)||semanticKeys.some(key=>!same(current[key],original[key])))throw new Error('[avg-visual-reuse] V5 当前语义输入或视觉基准与原模型输入不一致；未发送请求')
  return current
}

/** Deterministic child proof. The original model response and accepted edit
 * stay in their historical Run; this Build records only its own exact input. */
export async function readAvgVisualReuseEvidenceV5(scope:WorkspaceScope,row:{producerRunId:number;qualityJson:string;payloadJson:string},path:AvgVisualReusePathV5=[]):Promise<Extract<AvgVisualProposalEvidenceV5,{reused:true}>>{
  const q=avgRecord(JSON.parse(row.qualityJson),['schema','version','requestSnapshotHash','rawResponseHash','scopeHash','capabilityBindingHash','source'],'V5 visual reuse evidence')
  if(q.schema!=='storyforge.avg.visual-proposal-reuse-evidence'||q.version!==2)throw new Error('[avg-visual-reuse] V5 复用证据版本无效')
  const source=parseAvgVisualProposalReuseSourceV5(q.source),snapshot=await readAgentRunV1(scope,row.producerRunId),boundary=snapshot.contract.scope.productProduction
  const build=boundary?await db.productBuilds.get(boundary.productBuildId):null
  if(!build||!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-visual-reuse] V5 当前 producer 缺少准确 Build')
  const briefRow=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
  if(!briefRow||!await assertRecordInScope(scope,'productProductionBriefs',briefRow,{owner:'work'})||briefRow.briefHash!==build.briefHash
    ||briefRow.authorizedAt!==build.authorizedAt||!['authorized','superseded'].includes(briefRow.status))throw new Error('[avg-visual-reuse] V5 当前 producer 缺少准确授权 Brief')
  const load=()=>Promise.all([import('../product-production/contracts'),import('../product-production/plan')])
  const [{parseProductProductionBriefV3},{parseProductProductionPlanV3}]=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
  const brief=parseProductProductionBriefV3(briefRow.briefJson),plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash),task=plan.tasks.find(t=>t.taskKey===boundary!.taskKey)
  if(!task||!isAvgVisualReuseTaskV5(task)||brief.avgVisualPlanning?.version!==5||await hashProductProductionValueV2(brief)!==build.briefHash
    ||await hashProductProductionValueV2(plan)!==build.planHash||boundary!.planHash!==build.planHash||boundary!.buildNumber!==build.buildNumber
    ||boundary!.controlEpoch!==plan.controlEpoch||snapshot.contract.executionBindings?.length
    ||snapshot.events.some(e=>e.type==='model.requested'||e.type==='tool.called')
    ||snapshot.contract.runtimeBindingHash!==await hashAvgTaskRuntimeBindingV1({planHash:build.planHash,task,capabilityBindings:[]})
    ||!same(brief.avgVisualPlanning.proposalReuse?.find(r=>r.artifact.artifactKey===source.artifact.artifactKey),source))throw new Error('[avg-visual-reuse] V5 当前零调用 producer 或冻结选择不闭合')
  const events=snapshot.events.filter(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='source-snapshot'&&e.payload.stepId===task.taskKey
    &&e.payload.attempt===1&&e.payload.contentHash===q.requestSnapshotHash)
  if(events.length!==1||snapshot.events.some(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='raw-response'))throw new Error('[avg-visual-reuse] V5 复用不能伪造当前模型返回')
  const requestText=await readAgentRunArtifactExactV1({projectId:scope.projectId,artifactKind:'source-snapshot',contentHash:String(q.requestSnapshotHash)})
  if(await hashAvgVisualExactTextV1(requestText)!==q.requestSnapshotHash)throw new Error('[avg-visual-reuse] V5 当前确定性输入字节损坏')
  const request=avgRecord(JSON.parse(requestText),['schema','version','taskKey','targetArtifactKey','scopeHash','sourceInputHash','contextText','source','originalRequestHash','rawResponseHash'],'V5 reuse input')
  // This producer already completed under its own frozen contract. Re-prove
  // those exact bytes, not today's tool catalog; new reuse still uses the
  // strict public reader above before it can receive execution authority.
  const history=await readVisualReuseHistoryV5({scope,build,brief,task,source,path},false),packet=assertAvgVisualReuseSemanticInputV5(String(request.contextText),history,source)
  if(request.schema!=='storyforge.avg.visual-reuse-input'||request.version!==2||request.taskKey!==task.taskKey||request.targetArtifactKey!==source.artifact.artifactKey
    ||request.scopeHash!==await hashProductProductionValueV2(brief.avgVisualPlanning.scope)||request.scopeHash!==q.scopeHash
    ||request.sourceInputHash!==brief.avgVisualPlanning.scope.sourceInputHash||!same(request.source,source)
    ||request.originalRequestHash!==await hashAvgVisualExactTextV1(history.original.modelRequestText)||request.rawResponseHash!==source.rawResponseHash
    ||q.rawResponseHash!==source.rawResponseHash||q.capabilityBindingHash!==history.original.binding.bindingHash
    ||packet.taskKey!==task.taskKey||packet.productionKey!==(await db.productProductions.get(build.productionId))?.productionKey||packet.buildNumber!==build.buildNumber||packet.controlEpoch!==plan.controlEpoch
    ||packet.planHash!==build.planHash||packet.briefHash!==build.briefHash||packet.briefRevision!==build.briefRevision
    ||packet.sourcePlanHash!==briefRow.sourcePlanHash||packet.confirmedBriefHash!==briefRow.confirmedBriefHash||!same(packet.taskBudget,task.budgetReservation))throw new Error('[avg-visual-reuse] V5 当前输入、原模型字节或准确版本不闭合')
  const proposal=await assertAvgVisualRoleProposalV5(row.payloadJson,task,brief.avgVisualPlanning.scope)
  const modelPayload=validateAvgVisualSemanticV4(parseProductionModelJsonObjectV1(history.original.rawText,task.taskKey),brief.avgVisualPlanning.scope,source.artifact.artifactKey)
  if(proposal.version!==4||!same(proposal.payload,history.payload)||!same(proposal.modelPayload,modelPayload))throw new Error('[avg-visual-reuse] V5 历史改稿或原模型内容不一致')
  return {reused:true as const,source,rawText:history.original.rawText,requestText,request,quality:q,snapshot,modelRequest:history.original.modelRequest,
    modelRequestText:history.original.modelRequestText,modelRun:history.original.modelRun,binding:history.original.binding}
}
