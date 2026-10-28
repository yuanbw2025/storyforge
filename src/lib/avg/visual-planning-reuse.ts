import { db } from '../db/schema'
import type { ProductBuildRecordV1, ProductProductionBriefV3, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { readAvgHistoricalVisualArtifactV4 } from './author-artifacts'
import { avgRecord } from './protocol-validation'
import { parseAvgVisualProposalReuseSourceV4, type AvgVisualProposalReuseSourceV4, type AvgVisualReusePathV4 } from './visual-planning-reuse-contract'
import { avgVisualRoleTargetV4, assertAvgVisualRoleProposalV4, isAvgVisualReuseTaskV4, validateAvgVisualSemanticV4 } from './visual-role-proposal'
import { AVG_VISUAL_PLANNING_ROLES_V1, avgVisualPlanningMethodV1 } from './visual-planning-roles'
import { parseProductionModelJsonObjectV1 } from '../product-production/model-json-object'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { hashAvgVisualExactTextV1, type AvgVisualProposalEvidenceV4 } from './visual-planning-evidence'

const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
const semanticKeys=['schema','version','sourceInputHash','aspectRatio','subjects','requirements','references','visualDirection','sourceWorldContentHash'] as const
const lifecycleKeys=['taskKey','productionKey','buildNumber','controlEpoch','planHash','briefRevision','briefHash','sourcePlanHash','confirmedBriefHash','artifacts','taskBudget']

/** A positive codec: a future packet or new semantic field cannot silently be
 * erased to make an incompatible old model request appear reusable. */
export function readAvgVisualRoleContextPacketV4(text:string,reuse=false){
  const start=text.indexOf('{'),end=text.lastIndexOf('}')
  if(start<0||end<start)throw new Error('[avg-visual-reuse] 实际岗位输入缺少准确 JSON')
  const packet=avgRecord(JSON.parse(text.slice(start,end+1)),[...semanticKeys,...lifecycleKeys,...(reuse?['operation','reuseSource']:[])],'visual role context')
  if(packet.schema!=='storyforge.avg.visual-planning-inputs'||packet.version!==4
    ||reuse&&packet.operation!=='reuse-confirmed-visual-proposal')throw new Error('[avg-visual-reuse] 实际岗位输入版本无效')
  return packet
}

export function avgVisualReuseDescriptorV4(history:Awaited<ReturnType<typeof readAvgHistoricalVisualArtifactV4>>):AvgVisualProposalReuseSourceV4{
  return parseAvgVisualProposalReuseSourceV4({schema:'storyforge.avg.visual-proposal-reuse-source',version:1,
    productionKey:history.source.productionKey,buildNumber:history.source.buildNumber,buildRevision:history.source.buildRevision,
    controlEpoch:history.source.controlEpoch,briefHash:history.source.briefHash,planHash:history.source.planHash,
    artifact:history.artifact,authorReceiptHash:history.authorReceiptHash,proposal:history.original.artifact,
    producerReceiptHash:history.original.producerReceiptHash,requestSnapshotHash:history.original.quality.requestSnapshotHash,
    rawResponseHash:history.original.quality.rawResponseHash})
}

/** Every invocation proves the actual old adoption, original Run artifacts and
 * portable logical locators. No descriptor or cached UI row grants authority. */
type VisualReuseHistoryInputV4={scope:WorkspaceScope;build:ProductBuildRecordV1;
  brief:ProductProductionBriefV3;task:ProductProductionPlanTaskV3;source:AvgVisualProposalReuseSourceV4;path?:AvgVisualReusePathV4}
export function readAvgVisualReuseHistoryV4(input:VisualReuseHistoryInputV4){return readVisualReuseHistoryV4(input,true)}
async function readVisualReuseHistoryV4(input:VisualReuseHistoryInputV4,currentMethod:boolean){
  const source=parseAvgVisualProposalReuseSourceV4(input.source),path=input.path??[]
  const identity=`${source.productionKey}:${source.buildNumber}:${source.artifact.artifactKey}`
  if(path.length>=32||path.includes(identity)||source.buildNumber>=input.build.buildNumber||input.brief.avgVisualPlanning?.version!==4
    ||avgVisualRoleTargetV4(input.task,input.brief.avgVisualPlanning.scope)!==source.artifact.artifactKey)throw new Error('[avg-visual-reuse] 来源循环、超界或不早于本版本')
  const production=await db.productProductions.get(input.build.productionId)
  const build=await db.productBuilds.where('[productionId+buildNumber]').equals([input.build.productionId,source.buildNumber]).first()
  if(!production||production.productionKey!==source.productionKey||!build||!await assertRecordInScope(input.scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-visual-reuse] 来源不是同作品、同制作的旧版本')
  const history=await readAvgHistoricalVisualArtifactV4({scope:input.scope,buildId:build.id!,expectedBuildRevision:source.buildRevision,
    controlEpoch:source.controlEpoch,expectedBriefHash:source.briefHash,expectedPlanHash:source.planHash,artifact:source.artifact},[...path,identity])
  if(!same(avgVisualReuseDescriptorV4(history),source)||!same(history.source.planning,input.brief.avgVisualPlanning.scope)
    ||history.source.sourceWorldContentHash!==input.brief.source.worldContentHash
    ||history.original.binding.bindingHash!==input.brief.capabilityRequirements.find(c=>c.requirementKey==='avg.visual.planning.text')?.capabilityHash)throw new Error('[avg-visual-reuse] 原回执、冻结范围、世界或文本路由已变化')
  const target=source.artifact.artifactKey,kind=target==='avg.media.visual-bible'?null:input.brief.avgVisualPlanning.scope.templates.find(t=>
    target===`avg.media.${t.subjectKind}-brief.${t.parameters.family.subjectKey}`)?.subjectKind
  const role=AVG_VISUAL_PLANNING_ROLES_V1.find(r=>r.subjectKind===kind)
  if(!role)throw new Error('[avg-visual-reuse] 来源岗位无效')
  const skill=getAgentSkillV1(role.skillId),request=history.original.modelRequest
  if(currentMethod&&(!same(history.original.modelRun.contract.executionBindings,[{stepId:input.task.taskKey,...createAgentSkillExecutionBindingV1(skill)}])
    ||request.systemPrompt!==avgVisualPlanningMethodV1(role.subjectKind)||request.promptVersion!==skill.promptVersion
    ||request.maximumOutputTokens!==role.outputTokens))throw new Error('[avg-visual-reuse] 原模型岗位方法已变化，不能自动复用')
  return history
}

export function assertAvgVisualReuseSemanticInputV4(contextText:string,history:Awaited<ReturnType<typeof readAvgVisualReuseHistoryV4>>,
  source:AvgVisualProposalReuseSourceV4){
  const current=readAvgVisualRoleContextPacketV4(contextText,true),original=readAvgVisualRoleContextPacketV4(String(history.original.modelRequest.contextText))
  if(!same(current.reuseSource,source)||semanticKeys.some(key=>!same(current[key],original[key])))throw new Error('[avg-visual-reuse] 当前实际输入或已确认视觉基准与原模型输入不一致；未发送请求')
  return current
}

/** The new producer stores only its own deterministic input. The original
 * response bytes and model request remain in the actual original model Run. */
export async function readAvgVisualReuseEvidenceV4(scope:WorkspaceScope,row:{producerRunId:number;qualityJson:string;payloadJson:string},path:AvgVisualReusePathV4):Promise<AvgVisualProposalEvidenceV4>{
  const q=avgRecord(JSON.parse(row.qualityJson),['schema','version','requestSnapshotHash','rawResponseHash','scopeHash','capabilityBindingHash','source'],'visual reuse evidence')
  if(q.schema!=='storyforge.avg.visual-proposal-reuse-evidence'||q.version!==1)throw new Error('[avg-visual-reuse] 复用证据版本无效')
  const source=parseAvgVisualProposalReuseSourceV4(q.source),snapshot=await readAgentRunV1(scope,row.producerRunId),boundary=snapshot.contract.scope.productProduction
  const build=boundary?await db.productBuilds.get(boundary.productBuildId):null
  if(!build||!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'}))throw new Error('[avg-visual-reuse] 当前 producer 缺少准确 Build')
  const briefRow=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
  if(!briefRow||!await assertRecordInScope(scope,'productProductionBriefs',briefRow,{owner:'work'})||briefRow.briefHash!==build.briefHash
    ||briefRow.authorizedAt!==build.authorizedAt||!['authorized','superseded'].includes(briefRow.status))throw new Error('[avg-visual-reuse] 当前 producer 缺少准确授权 Brief')
  const brief=parseProductProductionBriefV3(briefRow.briefJson),plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
  const task=plan.tasks.find(t=>t.taskKey===boundary!.taskKey)
  if(!task||!isAvgVisualReuseTaskV4(task)||brief.avgVisualPlanning?.version!==4||await hashProductProductionValueV2(brief)!==build.briefHash
    ||await hashProductProductionValueV2(plan)!==build.planHash||boundary!.planHash!==build.planHash||boundary!.buildNumber!==build.buildNumber
    ||boundary!.controlEpoch!==plan.controlEpoch||snapshot.contract.executionBindings?.length
    ||snapshot.events.some(e=>e.type==='model.requested'||e.type==='tool.called')
    ||snapshot.contract.runtimeBindingHash!==await hashAvgTaskRuntimeBindingV1({planHash:build.planHash,task,capabilityBindings:[]})
    ||!same(brief.avgVisualPlanning.proposalReuse?.find(r=>r.artifact.artifactKey===source.artifact.artifactKey),source))throw new Error('[avg-visual-reuse] 当前零调用 producer 或冻结选择不闭合')
  const events=snapshot.events.filter(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='source-snapshot'
    &&e.payload.stepId===task.taskKey&&e.payload.attempt===1&&e.payload.contentHash===q.requestSnapshotHash)
  if(events.length!==1||snapshot.events.some(e=>e.type==='evidence.artifact.recorded'&&e.payload.artifactKind==='raw-response'))throw new Error('[avg-visual-reuse] 复用不能伪造当前模型返回')
  const requestText=await readAgentRunArtifactExactV1({projectId:scope.projectId,artifactKind:'source-snapshot',contentHash:String(q.requestSnapshotHash)})
  if(await hashAvgVisualExactTextV1(requestText)!==q.requestSnapshotHash)throw new Error('[avg-visual-reuse] 本次确定性输入字节损坏')
  const request=avgRecord(JSON.parse(requestText),['schema','version','taskKey','targetArtifactKey','scopeHash','sourceInputHash','contextText','source','originalRequestHash','rawResponseHash'],'visual reuse input')
  // Reading a completed zero-call producer proves its frozen method. Only
  // preparing/executing another reuse must match today's tool schema.
  const history=await readVisualReuseHistoryV4({scope,build,brief,task,source,path},false)
  const packet=assertAvgVisualReuseSemanticInputV4(String(request.contextText),history,source)
  if(request.schema!=='storyforge.avg.visual-reuse-input'||request.version!==1||request.taskKey!==task.taskKey
    ||request.targetArtifactKey!==source.artifact.artifactKey||request.scopeHash!==await hashProductProductionValueV2(brief.avgVisualPlanning.scope)
    ||request.scopeHash!==q.scopeHash||request.sourceInputHash!==brief.avgVisualPlanning.scope.sourceInputHash||!same(request.source,source)
    ||request.originalRequestHash!==await hashAvgVisualExactTextV1(history.original.modelRequestText)||request.rawResponseHash!==source.rawResponseHash
    ||q.rawResponseHash!==source.rawResponseHash||q.capabilityBindingHash!==history.original.binding.bindingHash
    ||packet.taskKey!==task.taskKey||packet.productionKey!==source.productionKey||packet.buildNumber!==build.buildNumber
    ||packet.controlEpoch!==plan.controlEpoch||packet.planHash!==build.planHash||packet.briefHash!==build.briefHash
    ||packet.briefRevision!==build.briefRevision||packet.sourcePlanHash!==briefRow.sourcePlanHash||packet.confirmedBriefHash!==briefRow.confirmedBriefHash
    ||!same(packet.taskBudget,task.budgetReservation))throw new Error('[avg-visual-reuse] 当前输入、原模型字节或准确版本不闭合')
  const proposal=await assertAvgVisualRoleProposalV4(row.payloadJson,task,brief.avgVisualPlanning.scope)
  const modelPayload=validateAvgVisualSemanticV4(parseProductionModelJsonObjectV1(history.original.rawText,task.taskKey),brief.avgVisualPlanning.scope,source.artifact.artifactKey)
  if(proposal.version!==2||!same(proposal.payload,history.payload)||!same(proposal.modelPayload,modelPayload))throw new Error('[avg-visual-reuse] 历史改稿或原模型内容不一致')
  return {reused:true,source,rawText:history.original.rawText,requestText,request,quality:q,snapshot,
    modelRequest:history.original.modelRequest,modelRequestText:history.original.modelRequestText,modelRun:history.original.modelRun,binding:history.original.binding}
}
