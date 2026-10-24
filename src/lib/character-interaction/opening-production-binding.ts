import {CHAT_OPENING_REVIEW_RELATIONS_PRODUCER_V1} from './opening-review-relations'
import {CHAT_OPENING_REVIEW_PROOF_PRODUCER_V1} from './opening-review-proof-citations'
import {CHAT_OPENING_REVIEW_KEYED_PRODUCER_V1} from './opening-review-keyed'
import {CHAT_OPENING_REVIEW_REFERENCES_PRODUCER_V1, CHAT_OPENING_REVIEW_REFERENCES_SOURCE_V1} from './opening-review-references'
import {CHAT_OPENING_DEVELOPMENT_GATE_V3} from './opening-development'
import {readAgentRunV1} from '../agent/run/event-store'
import type {ProductProductionTaskExecutionInputV1} from '../product-production/scheduler'
import {CHAT_OPENING_AGENCY_GATE_V2} from './opening-agency'
import {CHAT_OPENING_REPAIR_GATE_V1} from './opening-repair'
import {CHAT_OPENING_REPAIR_GATE_V2} from './opening-repair-patch'
import {CHAT_OPENING_FACT_CATALOG_KEY, CHAT_OPENING_REFERENCE_GATE_V1, CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1} from './opening-source-references'
import {CHAT_OPENING_OPTION_REPAIR_GATE_V1} from './opening-option-repair'

/** Select prompt/output semantics from this durable attempt, never the live registry. */
export async function readChatOpeningProductionVersionV1(input: ProductProductionTaskExecutionInputV1): Promise<{groundedAgency: boolean; targetedRepair?: true; patchRepair?: true; sourceReferences?: true; optionRepair?: true; completeSourceFacts?: true; meaningfulContinuation?: true; scopedReview?: true; independentReview?: true; flatReview?: true; authoredBackground?: true; developmentProof?: true; compactReview?: true; referenceReview?: true; keyedReview?: true; proofCitationReview?: true; relationalReview?: true; reviewOutputLimit?: 10_000}> {
  if (input.taskRunId == null) throw new Error('开场制作缺少冻结任务运行，不能选择提示版本')
  const snapshot = await readAgentRunV1(input.scope, input.taskRunId)
  const binding = snapshot.contract.executionBindings?.find(b => b.stepId === input.task.taskKey && b.skillId === input.task.skillId)
  const scope = snapshot.contract.scope.productProduction
  if (!scope || scope.productBuildId !== input.buildId || scope.buildNumber !== input.buildNumber || scope.controlEpoch !== input.controlEpoch || scope.planHash !== input.planHash || scope.taskKey !== input.task.taskKey || !binding) throw new Error('开场制作提示绑定不属于本次任务')
  if (!['character.chat-situation-production', 'character.chat-opening-review'].includes(input.task.skillId ?? '')) throw new Error('不是开场制作或审查任务')
  const production = input.task.skillId === 'character.chat-situation-production'
  // Only pre-change versions with independently verified prompt bytes are executable.
  const allowed = production ? ['chat-situation-production-v5', 'chat-situation-production-v6', 'chat-situation-production-v7', 'chat-situation-production-v8', 'chat-situation-production-v9', 'chat-situation-production-v10', 'chat-situation-production-v11', 'chat-situation-production-v12', 'chat-situation-production-v13', 'chat-situation-production-v14'] : ['chat-opening-review-v1', 'chat-opening-review-v2', 'chat-opening-review-v3', 'chat-opening-review-v4', 'chat-opening-review-v5', 'chat-opening-review-v6', 'chat-opening-review-v7', 'chat-opening-review-v8', 'chat-opening-review-v9', 'chat-opening-review-v10', CHAT_OPENING_REVIEW_REFERENCES_PRODUCER_V1, CHAT_OPENING_REVIEW_KEYED_PRODUCER_V1, CHAT_OPENING_REVIEW_PROOF_PRODUCER_V1, CHAT_OPENING_REVIEW_RELATIONS_PRODUCER_V1]
  if (!allowed.includes(binding.promptVersion)) throw new Error('无法执行未支持的冻结开场提示版本')
  // Keep room for the complete source/candidates in the conservative Codex
  // window. Keep the v8+ request cap and all historical billable reserves.
  const relationalReview = !production && binding.promptVersion === CHAT_OPENING_REVIEW_RELATIONS_PRODUCER_V1
  const proofCitationReview = relationalReview || !production && binding.promptVersion === CHAT_OPENING_REVIEW_PROOF_PRODUCER_V1
  const keyedReview = proofCitationReview || !production && binding.promptVersion === CHAT_OPENING_REVIEW_KEYED_PRODUCER_V1
  const referenceReview = keyedReview || !production && binding.promptVersion === CHAT_OPENING_REVIEW_REFERENCES_PRODUCER_V1
  if (referenceReview && (snapshot.contract.permissions.contextSourceKeys.length !== 1 || !snapshot.contract.permissions.contextSourceKeys.includes(CHAT_OPENING_REVIEW_REFERENCES_SOURCE_V1))) throw new Error('冻结开场审查缺少专用引用来源，不能自动换约')
  const compactReview = referenceReview || !production && binding.promptVersion === 'chat-opening-review-v10'
  const developmentProof = compactReview || binding.promptVersion === (production ? 'chat-situation-production-v14' : 'chat-opening-review-v9')
  if (input.task.acceptanceGateIds.includes(CHAT_OPENING_DEVELOPMENT_GATE_V3) !== developmentProof) throw new Error('冻结开场合同的发展依据版本不匹配，不能自动换约')
  const boundedReviewOutput = !production && (developmentProof || binding.promptVersion === 'chat-opening-review-v8')
  const authoredBackground = developmentProof || boundedReviewOutput || binding.promptVersion === (production ? 'chat-situation-production-v13' : 'chat-opening-review-v7')
  const flatReview = !production && (authoredBackground || binding.promptVersion === 'chat-opening-review-v6')
  const independentReview = flatReview || !production && binding.promptVersion === 'chat-opening-review-v5'
  const scopedReview = independentReview || !production && binding.promptVersion === 'chat-opening-review-v4'
  const meaningfulContinuation = authoredBackground || scopedReview || binding.promptVersion === (production ? 'chat-situation-production-v12' : 'chat-opening-review-v3')
  const groundedAgency = meaningfulContinuation || binding.promptVersion === (production ? 'chat-situation-production-v6' : 'chat-opening-review-v2')
    || production && ['chat-situation-production-v7', 'chat-situation-production-v8', 'chat-situation-production-v9', 'chat-situation-production-v10', 'chat-situation-production-v11'].includes(binding.promptVersion)
  if (input.task.acceptanceGateIds.includes(CHAT_OPENING_AGENCY_GATE_V2) && !groundedAgency) throw new Error('冻结开场合同不支持当前行动机会验收，不能自动换约')
  const legacyRepair = input.task.acceptanceGateIds.includes(CHAT_OPENING_REPAIR_GATE_V1)
  const patchRepair = input.task.acceptanceGateIds.includes(CHAT_OPENING_REPAIR_GATE_V2)
  const sourceReferences = input.task.acceptanceGateIds.includes(CHAT_OPENING_REFERENCE_GATE_V1)
  const optionRepair = input.task.acceptanceGateIds.includes(CHAT_OPENING_OPTION_REPAIR_GATE_V1)
  const completeSourceFacts = input.task.acceptanceGateIds.includes(CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1)
  if (completeSourceFacts !== (production && ['chat-situation-production-v11', 'chat-situation-production-v12', 'chat-situation-production-v13', 'chat-situation-production-v14'].includes(binding.promptVersion))) throw new Error('冻结开场合同缺少完整来源事实授权，不能自动换约')
  if (optionRepair !== (production && ['chat-situation-production-v10', 'chat-situation-production-v11', 'chat-situation-production-v12', 'chat-situation-production-v13', 'chat-situation-production-v14'].includes(binding.promptVersion))) throw new Error('冻结开场合同缺少失败开场修复授权，不能自动换约')
  if (sourceReferences !== (production && ['chat-situation-production-v9', 'chat-situation-production-v10', 'chat-situation-production-v11', 'chat-situation-production-v12', 'chat-situation-production-v13', 'chat-situation-production-v14'].includes(binding.promptVersion))
    || sourceReferences && (!patchRepair || !input.task.inputArtifactKeys.includes(CHAT_OPENING_FACT_CATALOG_KEY))) throw new Error('冻结开场合同缺少引用目录授权，不能自动换约')
  const targetedRepair = legacyRepair || patchRepair
  if (production && ['chat-situation-production-v7', 'chat-situation-production-v8', 'chat-situation-production-v9', 'chat-situation-production-v10', 'chat-situation-production-v11', 'chat-situation-production-v12', 'chat-situation-production-v13', 'chat-situation-production-v14'].includes(binding.promptVersion) && !targetedRepair) throw new Error('冻结开场计划未授权定向修复，不能自动换约')
  if (targetedRepair && (!production || legacyRepair && patchRepair
    || binding.promptVersion !== (developmentProof ? 'chat-situation-production-v14' : authoredBackground ? 'chat-situation-production-v13' : meaningfulContinuation ? 'chat-situation-production-v12' : completeSourceFacts ? 'chat-situation-production-v11' : optionRepair ? 'chat-situation-production-v10' : sourceReferences ? 'chat-situation-production-v9' : patchRepair ? 'chat-situation-production-v8' : 'chat-situation-production-v7')
    || input.task.budgetReservation.modelCalls !== 2 || input.task.maxAttempts !== 2)) throw new Error('冻结开场合同不支持定向修复，不能自动换约')
  return {groundedAgency, ...(relationalReview ? {relationalReview: true as const} : {}), ...(proofCitationReview ? {proofCitationReview: true as const} : {}), ...(keyedReview ? {keyedReview: true as const} : {}), ...(referenceReview ? {referenceReview: true as const} : {}), ...(compactReview ? {compactReview: true as const} : {}), ...(developmentProof ? {developmentProof: true as const} : {}), ...(targetedRepair ? {targetedRepair: true as const} : {}), ...(patchRepair ? {patchRepair: true as const} : {}), ...(sourceReferences ? {sourceReferences: true as const} : {}), ...(optionRepair ? {optionRepair: true as const} : {}), ...(completeSourceFacts ? {completeSourceFacts: true as const} : {}), ...(meaningfulContinuation ? {meaningfulContinuation: true as const} : {}), ...(scopedReview ? {scopedReview: true as const} : {}), ...(independentReview ? {independentReview: true as const} : {}), ...(flatReview ? {flatReview: true as const} : {}), ...(authoredBackground ? {authoredBackground: true as const} : {}), ...(boundedReviewOutput ? {reviewOutputLimit: 10_000 as const} : {})}
}
