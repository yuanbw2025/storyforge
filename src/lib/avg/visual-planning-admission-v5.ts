import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { AVG_VISUAL_PLANNING_CONTEXT_V5,AVG_VISUAL_PLANNING_ROLES_V5,avgVisualPlanningMethodV5 } from './visual-planning-roles-v5'
import { assertAvgVisualRoleProposalV5,isAvgVisualReuseTaskV5 } from './visual-role-proposal-v5'
import { readAvgVisualProposalEvidenceV5 } from './visual-planning-evidence'
import { assertAvgVisualPlanningProposalV2 } from './media-source-v2'
import { parseAvgProfessionalArtifactV1 } from './artifact-contract'
import { parseAvgSystemPlan } from './system-contract'
import { AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 } from './visual-planning-plan'
import type { assertAvgVisualPlanningProducerAdmissionV4 } from './visual-planning-admission'

/** Runs inside the same sealed-producer transaction after the shared exact
 * root/child/checkpoint/ledger proof. No direct canonical content write. */
export async function assertAvgVisualPlanningProducerAdmissionV5(input:Parameters<typeof assertAvgVisualPlanningProducerAdmissionV4>[0]){
  const row=await db.productProductionBriefs.where('[productionId+revision]').equals([input.build.productionId,input.build.briefRevision]).first()
  if(!row||!await assertRecordInScope(input.scope,'productProductionBriefs',row,{owner:'work'})||row.status!=='authorized'
    ||row.briefHash!==input.build.briefHash||row.authorizedAt!==input.build.authorizedAt)throw new Error('[avg-visual-plan] 新原始方案缺少准确已授权 Brief')
  const brief=parseProductProductionBriefV3(row.briefJson),planning=brief.avgVisualPlanning,a=input.artifact,task=input.task
  const same=(l:unknown,r:unknown)=>canonicalProductProductionJsonV2(l)===canonicalProductProductionJsonV2(r)
  if(planning?.version!==5||await hashProductProductionValueV2(brief)!==input.build.briefHash||task.outputArtifactKeys.length!==1||task.outputArtifactKeys[0]!==a.artifactKey
    ||a.blobObjectId!==null||a.mimeType!==null||a.mediaKind!==null||a.metadataJson!=='{}'||task.maxAttempts!==1)throw new Error('[avg-visual-plan] 新方案不能借用媒资或其他输出写域')
  const assembled=await assembleContext({projectId:input.scope.projectId,scope:input.scope,productProductionId:input.build.productionId,
    productBuildId:input.build.id,productProductionTaskKey:task.taskKey,productArtifactKeys:task.inputArtifactKeys,
    sourceKeys:[AVG_VISUAL_PLANNING_CONTEXT_V5],inputBudgetTokens:task.budgetReservation.inputTokens,sourceTransformer:preserveProductProductionContextV1})
  if(assembled.overBudgetAfterTrim||assembled.segments.length!==1||!same(assembled.included,[AVG_VISUAL_PLANNING_CONTEXT_V5])
    ||!assembled.sourceEvidence?.length||assembled.sourceEvidence.some(s=>s.status!=='included'||s.delivery!=='full'))throw new Error('[avg-visual-plan] 新方案接收来源不完整')
  if(a.artifactKey.startsWith('avg.proposal.')){
    if(isAvgVisualReuseTaskV5(task)){
      if(a.kind!=='narrative'||!same(JSON.parse(a.rightsJson),{origin:'history-reuse',commercialUse:null}))throw new Error('[avg-visual-reuse] V5 复用必须保留历史来源及未知商业权利')
      const evidence=await readAvgVisualProposalEvidenceV5(input.scope,{...a,producerRunId:input.producerRunId})
      if(!evidence.reused||evidence.request.contextText!==assembled.text||evidence.snapshot.contract.runtimeBindingHash!==await hashAvgTaskRuntimeBindingV1({planHash:input.build.planHash,task,capabilityBindings:[]}))
        throw new Error('[avg-visual-reuse] V5 确定性复用输入不属于实际登记 Gateway')
      return
    }
    if(a.kind!=='narrative'||task.executionMode!=='model'||task.budgetReservation.modelCalls!==1||task.budgetReservation.mediaCalls!==0
      ||!same(JSON.parse(a.rightsJson),{origin:'model-proposal',commercialUse:null}))throw new Error('[avg-visual-plan] 新原始方案不是实际单次模型候选')
    const proposal=await assertAvgVisualRoleProposalV5(a.payloadJson,task,planning.scope),proof=await readAvgVisualProposalEvidenceV5(input.scope,{...a,producerRunId:input.producerRunId})
    const role=AVG_VISUAL_PLANNING_ROLES_V5.find(r=>r.skillId===task.skillId)!
    if(proof.request.contextText!==assembled.text||proof.request.sourceInputHash!==planning.scope.sourceInputHash
      ||proof.request.systemPrompt!==avgVisualPlanningMethodV5(role.subjectKind)||proof.request.maximumOutputTokens!==task.budgetReservation.outputTokens
      ||proof.quality.scopeHash!==proposal.scopeHash||proof.snapshot.contract.runtimeBindingHash!==await hashAvgTaskRuntimeBindingV1({planHash:input.build.planHash,task,capabilityBindings:[proof.binding]})){
      throw new Error('[avg-visual-plan] 新模型实际输入、岗位或路由与冻结 Harness 不一致')
    }
    return
  }
  if(a.artifactKey!==AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4||a.kind!=='asset-manifest'||task.kind!=='avg-v5-visual-requirements-compile'
    ||task.executionMode!=='deterministic'||task.skillId!==null||task.contextProfile!=='avg-visual-planning-v5'
    ||task.budgetReservation.modelCalls!==0||task.budgetReservation.mediaCalls!==0
    ||!same(JSON.parse(a.rightsJson),{origin:'deterministic-visual-compilation'}))throw new Error('[avg-visual-plan] 新需求编译不属于准确确定性任务')
  const packet=JSON.parse(assembled.segments[0].content) as {artifacts:Array<{artifactKey:string;version:number;contentHash:string}>}
  const rows=await db.productBuildArtifacts.where('buildId').equals(input.build.id).toArray()
  const deps=packet.artifacts.map(ref=>rows.find(r=>r.artifactKey===ref.artifactKey&&r.version===ref.version&&r.contentHash===ref.contentHash&&r.controlEpoch===input.build.controlEpoch&&r.status==='accepted')!)
  if(deps.some(r=>!r))throw new Error('[avg-visual-plan] 新编译的准确采用输入缺失')
  const rules=deps.find(r=>r.artifactKey==='avg.system.plan')!,parsed=deps.filter(r=>r!==rules).map(r=>parseAvgProfessionalArtifactV1(r.payloadJson))
  await assertAvgVisualPlanningProposalV2(a.payloadJson,{scope:planning.scope,visualBible:parsed.find(p=>p.schema==='storyforge.avg.visual-bible'),
    mediaBriefs:parsed.filter(p=>p.schema==='storyforge.avg.media-brief'),source:{systemPlan:parseAvgSystemPlan(rules.payloadJson),
      scripts:parsed.filter(p=>p.schema==='storyforge.avg.scene-script'),presentation:{aspectRatio:planning.scope.aspectRatio}}})
  if(!same(JSON.parse(a.qualityJson),{schema:'storyforge.avg.visual-compilation-evidence',version:2,scopeHash:await hashProductProductionValueV2(planning.scope),inputs:packet.artifacts}))throw new Error('[avg-visual-plan] 新编译来源不能冒充艺术或其他输入')
}
