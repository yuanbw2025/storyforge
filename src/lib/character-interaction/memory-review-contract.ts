import {canonicalStringify} from '../agent/run/hash'
import type {CharacterInteractionRuntimeState, InteractionRuntimeMemory} from '../types'
import type {ChatMemoryCheckV1, ChatMemoryReviewReceiptV1, ChatMemoryReviewV1} from '../types/chat-memory'
import {interactionMessageVisibleTo} from './message-visibility'

export const CHAT_MEMORY_REVIEW_STEP = 'interaction:memory-review'
export const CHAT_MEMORY_REVIEW_SKILL = 'character.interaction-memory-review'
export const CHAT_MEMORY_CHECKS: ChatMemoryCheckV1[] = ['source-fidelity', 'player-visibility', 'no-private-inference']
export type ChatMemoryBodyV1 = Pick<InteractionRuntimeMemory, 'participantKey' | 'kind' | 'content' | 'importance' | 'sourceEventSequences' | 'evidenceExcerpt'>
function fail(message: string): never {throw new Error(`[chat-memory] ${message}`)}

/** Stable message identities and exact text survive branch sequence rebasing.
 * This is evidence, not a second source of facts. Never send the receipt body
 * as model memory or expose reviewer reasoning in the player interface. */
export function chatMemoryReviewBindingV1(state: CharacterInteractionRuntimeState, memory: ChatMemoryBodyV1): string {
  if (!state.profiles.some(p => p.participantKey === memory.participantKey) || !memory.sourceEventSequences.length) fail('记忆缺少角色或真实来源')
  const sources = memory.sourceEventSequences.map(sequence => {
    const message = state.messages.find(m => m.eventSequence === sequence)
    if (!message || message.supersededBySequence != null || !interactionMessageVisibleTo(message, memory.participantKey)
      || !interactionMessageVisibleTo(message, state.playerKey)) fail('记忆来源不存在、已替代或不是角色与玩家共同可见')
    return {messageId: message.messageId, speakerKey: message.speakerKey, text: message.text,
      audienceKeys: message.audienceKeys == null ? null : [...message.audienceKeys].sort()}
  })
  if (!sources.some(s => s.text.includes(memory.evidenceExcerpt)) || !memory.evidenceExcerpt.trim()) fail('记忆摘录不是实际来源文字')
  const binding = canonicalStringify({version: 1, participantKey: memory.participantKey, kind: memory.kind, content: memory.content,
    importance: memory.importance, evidenceExcerpt: memory.evidenceExcerpt, sources})
  if (binding.length > 96_000) fail('记忆审查来源超过容量，不能截断证据')
  return binding
}

export function parseChatMemoryReviewV1(value: unknown, bindingJson: string): ChatMemoryReviewV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'checks') fail('记忆审查输出字段无效')
  const checks = (value as {checks: unknown}).checks
  if (!Array.isArray(checks) || checks.length !== CHAT_MEMORY_CHECKS.length) fail('记忆审查项目不完整')
  const result = checks.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'check,passed,reason'
      || !CHAT_MEMORY_CHECKS.includes(row.check) || typeof row.passed !== 'boolean' || typeof row.reason !== 'string'
      || !row.reason.trim() || row.reason.length > 2_000) fail('记忆审查项目无效')
    return {check: row.check as ChatMemoryCheckV1, passed: row.passed, reason: row.reason.trim()}
  })
  if (new Set(result.map(r => r.check)).size !== CHAT_MEMORY_CHECKS.length) fail('记忆审查项目重复')
  return {version: 1, bindingJson, checks: result}
}

export function parseChatMemoryReceiptV1(value: unknown): ChatMemoryReviewReceiptV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'bindingJson,passedChecks,reviewHash,version') fail('记忆审查凭据无效')
  const row = value as ChatMemoryReviewReceiptV1
  if (row.version !== 1 || typeof row.bindingJson !== 'string' || !row.bindingJson || row.bindingJson.length > 96_000
    || typeof row.reviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.reviewHash) || !Array.isArray(row.passedChecks)
    || [...row.passedChecks].sort().join(',') !== [...CHAT_MEMORY_CHECKS].sort().join(',')) fail('记忆审查凭据不完整')
  return structuredClone(row)
}

export function hasChatMemoryContentReviewV1(state: CharacterInteractionRuntimeState, memory: InteractionRuntimeMemory): boolean {
  try {
    return !!memory.contentReview && parseChatMemoryReceiptV1(memory.contentReview).bindingJson === chatMemoryReviewBindingV1(state, memory)
  } catch {return false}
}

/** Strip proof snapshots from model input. The model reads the accepted summary;
 * exact quoted sources remain available to the dedicated reviewer and player. */
export function interactionMemoryForContextV1(memory: InteractionRuntimeMemory): InteractionRuntimeMemory {
  const {contentReview: _proof, ...visible} = memory
  return visible
}
