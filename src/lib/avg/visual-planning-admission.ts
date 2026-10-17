import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { readAvgVisualProposalEvidenceV4 } from './visual-planning-evidence'
import { assertAvgVisualRoleProposalV4, isAvgVisualReuseTaskV4 } from './visual-role-proposal'
import { AVG_VISUAL_PLANNING_CONTEXT_V1, AVG_VISUAL_PLANNING_ROLES_V1, avgVisualPlanningMethodV1 } from './visual-planning-roles'
import { assertAvgVisualPlanningProposalV1 } from './media-source'
import { parseAvgProfessionalArtifactV1 } from './artifact-contract'
import { parseAvgSystemPlan } from './system-contract'
import { AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 } from './visual-planning-plan'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'

/** Invoked inside the existing sealed-producer transaction, after its exact
 * root/child/checkpoint/ledger/result proof. This grants no canonical write. */
export async function assertAvgVisualPlanningProducerAdmissionV4(input: {
  scope: WorkspaceScope; build: ProductBuildRecordV1 & { id: number }; task: ProductProductionPlanTaskV3; producerRunId: number
  artifact: Pick<ProductBuildArtifactRecordV1, 'artifactKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'qualityJson' | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize' | 'blobObjectId'>
}) {
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([input.build.productionId, input.build.briefRevision]).first()
  if (!row || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' }) || row.status !== 'authorized'
    || row.briefHash !== input.build.briefHash || row.authorizedAt !== input.build.authorizedAt) throw new Error('[avg-visual-plan] 原始方案缺少准确已授权 Brief')
  const brief = parseProductProductionBriefV3(row.briefJson), planning = brief.avgVisualPlanning, a = input.artifact, task = input.task
  const same = (l: unknown, r: unknown) => canonicalProductProductionJsonV2(l) === canonicalProductProductionJsonV2(r)
  if (!planning || await hashProductProductionValueV2(brief) !== input.build.briefHash || task.outputArtifactKeys.length !== 1 || task.outputArtifactKeys[0] !== a.artifactKey
    || a.blobObjectId !== null || a.mimeType !== null || a.mediaKind !== null || a.metadataJson !== '{}' || task.maxAttempts !== 1) throw new Error('[avg-visual-plan] 技术方案不能借用媒资或其他输出写域')
  const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope, productProductionId: input.build.productionId,
    productBuildId: input.build.id, productProductionTaskKey: task.taskKey, productArtifactKeys: task.inputArtifactKeys,
    sourceKeys: [AVG_VISUAL_PLANNING_CONTEXT_V1], inputBudgetTokens: task.budgetReservation.inputTokens, sourceTransformer: preserveProductProductionContextV1 })
  if (assembled.overBudgetAfterTrim || assembled.segments.length !== 1 || !assembled.sourceEvidence?.length
    || assembled.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')) throw new Error('[avg-visual-plan] 方案接收来源不完整')
  if (a.artifactKey.startsWith('avg.proposal.')) {
    if(isAvgVisualReuseTaskV4(task)){
      if(a.kind!=='narrative'||!same(JSON.parse(a.rightsJson),{origin:'history-reuse',commercialUse:null}))throw new Error('[avg-visual-reuse] 复用必须保留历史来源及未知商业权利')
      const evidence=await readAvgVisualProposalEvidenceV4(input.scope,{...a,producerRunId:input.producerRunId})
      if(!evidence.reused||evidence.request.contextText!==assembled.text)throw new Error('[avg-visual-reuse] 本次确定性输入不属于实际登记 Gateway')
      return
    }
    if (a.kind !== 'narrative' || task.executionMode !== 'model' || task.budgetReservation.modelCalls !== 1 || task.budgetReservation.mediaCalls !== 0
      || !same(JSON.parse(a.rightsJson), { origin: 'model-proposal', commercialUse: null })) throw new Error('[avg-visual-plan] 原始方案不是登记的单次模型候选')
    const proposal = await assertAvgVisualRoleProposalV4(a.payloadJson, task, planning.scope)
    const evidence = await readAvgVisualProposalEvidenceV4(input.scope, { ...a, producerRunId: input.producerRunId })
    const role = AVG_VISUAL_PLANNING_ROLES_V1.find(r => r.skillId === task.skillId)!
    if (evidence.request.contextText !== assembled.text || evidence.request.sourceInputHash !== planning.scope.sourceInputHash
      || evidence.request.systemPrompt !== avgVisualPlanningMethodV1(role.subjectKind) || evidence.request.maximumOutputTokens !== task.budgetReservation.outputTokens
      || evidence.quality.scopeHash !== proposal.scopeHash) throw new Error('[avg-visual-plan] 模型请求的实际输入与当前冻结来源不一致')
    const runtimeHash = await hashAvgTaskRuntimeBindingV1({ planHash: input.build.planHash, task, capabilityBindings: [evidence.binding] })
    if (evidence.snapshot.contract.runtimeBindingHash !== runtimeHash) throw new Error('[avg-visual-plan] 实际模型输入路由与冻结 Harness 绑定不一致')
    return
  }
  if (a.artifactKey !== AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 || a.kind !== 'asset-manifest' || task.kind !== 'avg-v4-visual-requirements-compile'
    || task.executionMode !== 'deterministic' || task.skillId !== null || task.contextProfile !== 'avg-visual-planning-v4'
    || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.mediaCalls !== 0
    || !same(JSON.parse(a.rightsJson), { origin: 'deterministic-visual-compilation' })) throw new Error('[avg-visual-plan] 需求编译不属于准确确定性任务')
  const packet = JSON.parse(assembled.segments[0].content) as { artifacts: Array<{ artifactKey: string; version: number; contentHash: string }> }
  const rows = await db.productBuildArtifacts.where('buildId').equals(input.build.id).toArray()
  const deps = packet.artifacts.map(ref => rows.find(r => r.artifactKey === ref.artifactKey && r.version === ref.version && r.contentHash === ref.contentHash
    && r.controlEpoch === input.build.controlEpoch && r.status === 'accepted')!)
  if (deps.some(r => !r)) throw new Error('[avg-visual-plan] 编译的准确采用输入缺失')
  const rules = deps.find(r => r.artifactKey === 'avg.system.plan')!
  const parsed = deps.filter(r => r.artifactKey !== 'avg.system.plan').map(r => parseAvgProfessionalArtifactV1(r.payloadJson))
  const visualBible = parsed.find(p => p.schema === 'storyforge.avg.visual-bible'), mediaBriefs = parsed.filter(p => p.schema === 'storyforge.avg.media-brief')
  const scripts = parsed.filter(p => p.schema === 'storyforge.avg.scene-script')
  await assertAvgVisualPlanningProposalV1(a.payloadJson, { scope: planning.scope, visualBible, mediaBriefs,
    source: { systemPlan: parseAvgSystemPlan(rules.payloadJson), scripts, presentation: { aspectRatio: planning.scope.aspectRatio } } })
  if (!same(JSON.parse(a.qualityJson), { schema: 'storyforge.avg.visual-compilation-evidence', version: 1,
    scopeHash: await hashProductProductionValueV2(planning.scope), inputs: packet.artifacts })) throw new Error('[avg-visual-plan] 编译来源证据不能冒充艺术或其他输入')
}
