import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatMemoryReconciliationCheckV1, ChatNarrativeActionReviewV1, ChatNarrativeStateV1} from '../types/chat-narrative'
import {chatMemoryReviewBindingV1, interactionMemoryForContextV1} from './memory-review-contract'

const LIMIT = 5000
function fail(message: string): never {throw new Error(`[chat-memory-reconciliation] ${message}`)}
function object(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.split(',').sort().join(',')) fail('修正核对字段无效')
  return value as Record<string, unknown>
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail('修正核对身份无效')
}
function sequence(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || value === 0) fail('修正核对需要真实事件')
}

export function validateChatMemoryReconciliationRecordsV1(story: ChatNarrativeStateV1, actors: readonly string[]): void {
  const records = story.memoryReconciliations
  if (records === undefined) return
  if (story.revision === 0 || !Array.isArray(records) || !records.length || records.length > LIMIT) fail('修正核对记录数量或初始状态无效')
  const seen = new Set<string>()
  for (const value of records) {
    const r = object(value, 'memoryId,sourceSequence,actorKey,messageId,sequence')
    id(r.memoryId); id(r.actorKey); id(r.messageId); sequence(r.sourceSequence); sequence(r.sequence)
    if (!actors.includes(r.actorKey) || seen.has(r.memoryId) || r.sourceSequence >= r.sequence || r.sequence > story.lastEventSequence) fail('修正核对角色、顺序或唯一性无效')
    seen.add(r.memoryId)
  }
}

/** Receipts bind the immutable correction identity to an actual action by its
 * owner. They remain valid after supersession, disabling and branch rebasing. */
export function assertChatMemoryReconciliationSourcesV1(state: CharacterInteractionRuntimeState): void {
  if (!state.chatNarrative?.memoryReconciliations) return
  const memories = new Map(state.memories.map(m => [m.memoryId, m])), messages = new Map(state.messages.map(m => [m.messageId, m]))
  for (const r of state.chatNarrative.memoryReconciliations) {
    const memory = memories.get(r.memoryId), message = messages.get(r.messageId)
    if (!memory || memory.authorship !== 'player-correction' || memory.participantKey !== r.actorKey || memory.proposalSequence !== r.sourceSequence
      || !message || message.role !== 'character' || message.speakerKey !== r.actorKey || message.eventSequence !== r.sequence || message.supersededBySequence != null) fail('修正核对缺少同一角色的修正记忆与真实行动来源')
  }
}

/** Only the owner's active, explicitly corrected summaries are pending.
 * Original messages are validated before a correction may enter a new input. */
export function pendingChatMemoryCorrectionsV1(state: CharacterInteractionRuntimeState, actorKey: string) {
  if (!state.chatNarrative) return []
  validateChatMemoryReconciliationRecordsV1(state.chatNarrative, state.profiles.map(p => p.participantKey))
  assertChatMemoryReconciliationSourcesV1(state)
  const done = new Set((state.chatNarrative.memoryReconciliations ?? []).map(r => r.memoryId))
  return state.memories.filter(m => m.participantKey === actorKey && m.authorship === 'player-correction'
    && m.status === 'accepted' && m.supersededByMemoryId == null && !done.has(m.memoryId)).map(m => {
    chatMemoryReviewBindingV1(state, m)
    return interactionMemoryForContextV1(m)
  })
}

export function parseChatMemoryReconciliationChecksV1(value: unknown): ChatMemoryReconciliationCheckV1[] {
  if (!Array.isArray(value) || value.length > LIMIT) fail('修正逐项核对数量无效')
  const seen = new Set<string>()
  for (const entry of value) {
    const r = object(entry, 'memoryId,sourceSequence,passed,reason')
    id(r.memoryId); sequence(r.sourceSequence)
    if (seen.has(r.memoryId) || typeof r.passed !== 'boolean' || typeof r.reason !== 'string' || !r.reason.trim() || r.reason.length > 2000) fail('修正逐项核对重复或结论无效')
    seen.add(r.memoryId)
  }
  return structuredClone(value) as ChatMemoryReconciliationCheckV1[]
}

export function assertChatMemoryReconciliationCoverageV1(state: CharacterInteractionRuntimeState, actorKey: string, value: unknown) {
  const checks = parseChatMemoryReconciliationChecksV1(value), pending = pendingChatMemoryCorrectionsV1(state, actorKey)
  if (checks.length !== pending.length || checks.some(c => !pending.some(m => m.memoryId === c.memoryId && m.proposalSequence === c.sourceSequence))) fail('修正逐项核对与当前角色待处理记忆不一致')
  return checks
}

/** Called only on the isolated, fully reviewed action preview. No historical
 * fact, goal, belief, promise or relationship is changed by acknowledgment. */
export function applyChatMemoryReconciliationsV1(before: CharacterInteractionRuntimeState, result: CharacterInteractionRuntimeState,
  input: {actorKey: string; messageId: string; sequence: number; review: ChatNarrativeActionReviewV1}): void {
  if (input.review.memoryChecks === undefined) return // Exact historical replay.
  const checks = assertChatMemoryReconciliationCoverageV1(before, input.actorKey, input.review.memoryChecks)
  if (checks.some(c => !c.passed)) fail('记忆修正未通过逐项核对')
  if (!checks.length) return
  const proposed = structuredClone(result)
  if (!proposed.chatNarrative) fail('修正核对需要主动叙事状态')
  proposed.chatNarrative.memoryReconciliations = [...(proposed.chatNarrative.memoryReconciliations ?? []),
    ...checks.map(c => ({memoryId: c.memoryId, sourceSequence: c.sourceSequence, actorKey: input.actorKey, messageId: input.messageId, sequence: input.sequence}))]
  validateChatMemoryReconciliationRecordsV1(proposed.chatNarrative, proposed.profiles.map(p => p.participantKey))
  assertChatMemoryReconciliationSourcesV1(proposed)
  result.chatNarrative!.memoryReconciliations = proposed.chatNarrative.memoryReconciliations
}

/** New fields cannot be smuggled through older frozen reviewer contracts. */
export function supportsChatMemoryReconciliationV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v20', 'chat-narrative-options-review-v14', 'chat-narrative-action-review-v21', 'chat-narrative-options-review-v15', 'chat-narrative-action-review-v22', 'chat-narrative-options-review-v16', 'chat-narrative-action-review-v23', 'chat-narrative-options-review-v17', 'chat-narrative-action-review-v24', 'chat-narrative-options-review-v18', 'chat-narrative-action-review-v25', 'chat-narrative-options-review-v19', 'chat-narrative-action-review-v26', 'chat-narrative-options-review-v20', 'chat-narrative-action-review-v27', 'chat-narrative-options-review-v21', 'chat-narrative-action-review-v28', 'chat-narrative-options-review-v22', 'chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')
}

export function assertChatMemoryReconciliationReviewVersionV1(reviews: readonly (ChatNarrativeActionReviewV1 | null)[], version: string | undefined): void {
  if (reviews.some(r => r?.memoryChecks !== undefined) && !supportsChatMemoryReconciliationV1(version)) fail('旧审查合同不支持记忆修正核对；保留原候选，不自动换约或重发')
}

/** Live approval/adoption gate, deliberately separate from historical replay.
 * Empty reviews check admission before any reviewer request is made. */
export function assertChatMemoryReconciliationReviewsV1(state: CharacterInteractionRuntimeState, actorKey: string,
  reviews: readonly (ChatNarrativeActionReviewV1 | null)[], version: string | undefined): void {
  assertChatMemoryReconciliationReviewVersionV1(reviews, version)
  const pending = pendingChatMemoryCorrectionsV1(state, actorKey)
  if (pending.length && !supportsChatMemoryReconciliationV1(version)) fail('旧审查合同不能处理待核对的记忆修正，请取消后明确发起新行动；原候选保留，不自动换约或重发')
  for (const review of reviews) {
    if (review?.memoryChecks === undefined) {
      if (pending.length) fail('行动审查缺少待处理记忆修正的逐项核对')
    } else assertChatMemoryReconciliationCoverageV1(state, actorKey, review.memoryChecks)
  }
}

export function isChatActionReviewOutputV1(value: unknown, extraRequired: string[] = []): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && ['checks', ...extraRequired].every(k => Object.prototype.hasOwnProperty.call(value, k))
    && Object.keys(value).every(k => ['checks', 'disclosureChecks', 'commitmentChecks', 'memoryChecks', 'sceneTransitionCheck', ...extraRequired].includes(k))
}
