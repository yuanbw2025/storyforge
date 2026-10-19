import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { AVG_SOUND_CONTEXT_V1 } from './sound-production-brief'
import { AVG_SOUND_COMPILED_KEY_V1, AVG_SOUND_PLAN_KEY_V1, AVG_SOUND_PROPOSAL_KEY_V1 } from './sound-production-plan'
import { assertAvgSoundRoleProposalV1 } from './sound-role-proposal'
import { readAvgSoundProposalEvidenceV1 } from './sound-planning-evidence'
import { avgSoundPlanningMethodV1 } from './sound-planning-role'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { compileAvgSoundRequirementsV1 } from './sound-requirements'
import { assertAvgSoundRawProducerAdmissionV1 } from './sound-production-admission'

/** Inside the existing sealed producer transaction, after actual root/child,
 * checkpoint, candidate, ledger and terminal proof. No canonical author write. */
export async function assertAvgSoundPlanningProducerAdmissionV1(input: {
  scope: WorkspaceScope; build: ProductBuildRecordV1 & { id: number }; task: ProductProductionPlanTaskV3; producerRunId: number
  artifact: Pick<ProductBuildArtifactRecordV1, 'artifactKey' | 'kind' | 'mediaKind' | 'payloadJson' | 'metadataJson' | 'qualityJson' | 'rightsJson' | 'contentHash' | 'mimeType' | 'byteSize' | 'blobObjectId'>
}) {
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([input.build.productionId, input.build.briefRevision]).first()
  if (!row || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' }) || row.status !== 'authorized'
    || row.briefHash !== input.build.briefHash || row.authorizedAt !== input.build.authorizedAt) throw new Error('[avg-sound-plan] 缺少准确已授权声音Brief')
  const brief = parseProductProductionBriefV3(row.briefJson), planning = brief.avgSoundPlanning, a = input.artifact, task = input.task
  const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
  if (a.artifactKey.startsWith('avg.sound.raw.')) {
    if (!planning || await hashProductProductionValueV2(brief) !== input.build.briefHash) throw new Error('[avg-sound] 原声音需要准确完整授权Brief')
    return assertAvgSoundRawProducerAdmissionV1(input, brief)
  }
  if (!planning || await hashProductProductionValueV2(brief) !== input.build.briefHash || task.outputArtifactKeys.length !== 1 || task.outputArtifactKeys[0] !== a.artifactKey
    || a.blobObjectId !== null || a.mimeType !== null || a.mediaKind !== null || a.metadataJson !== '{}' || task.maxAttempts !== 1) throw new Error('[avg-sound-plan] 声音方案不能借用媒资/其他写域')
  const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope, productProductionId: input.build.productionId,
    productBuildId: input.build.id, productProductionTaskKey: task.taskKey, productArtifactKeys: task.inputArtifactKeys,
    sourceKeys: [AVG_SOUND_CONTEXT_V1], inputBudgetTokens: task.budgetReservation.inputTokens, sourceTransformer: preserveProductProductionContextV1 })
  if (assembled.overBudgetAfterTrim || assembled.segments.length !== 1 || !same(assembled.included, [AVG_SOUND_CONTEXT_V1])
    || !assembled.sourceEvidence?.length || assembled.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')) throw new Error('[avg-sound-plan] 接收来源投影不完整')
  if (a.artifactKey === AVG_SOUND_PROPOSAL_KEY_V1) {
    if (a.kind !== 'narrative' || task.executionMode !== 'model' || task.budgetReservation.modelCalls !== 1 || task.budgetReservation.mediaCalls !== 0
      || !same(JSON.parse(a.rightsJson), { origin: 'model-proposal', commercialUse: null })) throw new Error('[avg-sound-plan] 方案不是单次登记模型候选')
    const proposal = await assertAvgSoundRoleProposalV1(a.payloadJson, task, planning.scope)
    const proof = await readAvgSoundProposalEvidenceV1(input.scope, { ...a, producerRunId: input.producerRunId })
    if (proof.request.contextText !== assembled.text || proof.request.sourceInputHash !== planning.scope.sourceInputHash
      || proof.request.systemPrompt !== avgSoundPlanningMethodV1() || proof.request.maximumOutputTokens !== task.budgetReservation.outputTokens
      || proof.quality.scopeHash !== proposal.scopeHash || proof.snapshot.contract.runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1({
        planHash: input.build.planHash, task, capabilityBindings: [proof.binding] })) throw new Error('[avg-sound-plan] 实际模型输入/路由与冻结Harness不一致')
    return
  }
  if (a.artifactKey !== AVG_SOUND_COMPILED_KEY_V1 || a.kind !== 'asset-manifest' || task.kind !== 'avg-sound-requirements-compile'
    || task.executionMode !== 'deterministic' || task.skillId !== null || task.contextProfile !== 'avg-sound-planning-v1'
    || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.mediaCalls !== 0
    || !same(JSON.parse(a.rightsJson), { origin: 'deterministic-sound-compilation' })) throw new Error('[avg-sound-plan] 不是准确零调用编译任务')
  const packet = JSON.parse(assembled.segments[0].content) as { artifacts: Array<{ artifactKey: string; version: number; contentHash: string }>; soundPlan: unknown }
  if (!packet.artifacts.some(r => r.artifactKey === AVG_SOUND_PLAN_KEY_V1)
    || !same(JSON.parse(a.payloadJson), await compileAvgSoundRequirementsV1(planning.scope, packet.soundPlan))
    || !same(JSON.parse(a.qualityJson), { schema: 'storyforge.avg.sound-compilation-evidence', version: 1,
      scopeHash: await hashProductProductionValueV2(planning.scope), inputs: packet.artifacts })) throw new Error('[avg-sound-plan] 编译结果或实际采用来源被替换')
}
