import type {CharacterInteractionRuntimeState, InteractionRuntimeMessage} from '../types'

function fail(message: string): never {throw new Error(`[chat-retrieval] ${message}`)}

export function isChatMessageRetrievableV1(state: CharacterInteractionRuntimeState, message: InteractionRuntimeMessage): boolean {
  return !state.chatNarrative?.excludedMessageIds?.includes(message.messageId)
}

export function requireChatRetrievalMessageV1(state: CharacterInteractionRuntimeState, messageId: unknown): InteractionRuntimeMessage {
  if (!state.chatNarrative || typeof messageId !== 'string') fail('消息排除需要主动叙事角色聊天存档')
  const message = state.messages.find(m => m.messageId === messageId && m.supersededBySequence == null
    && (m.role === 'player' || m.audienceKeys == null || m.audienceKeys.includes(state.playerKey)))
  if (!message || !['player', 'character'].includes(message.role)) fail('要设置上下文的可见消息不存在')
  return message
}

/** Dialogue selection only: consequences, memories, permissions and triggers
 * remain historical truth. Existing runs become stale through the event head. */
export function setChatMessageRetrievalV1(stateValue: CharacterInteractionRuntimeState, input: {sequence: number; messageId: unknown; excluded: unknown}): CharacterInteractionRuntimeState {
  const state = structuredClone(stateValue)
  const message = requireChatRetrievalMessageV1(state, input.messageId)
  if (typeof input.excluded !== 'boolean') fail('消息排除设置无效')
  const story = state.chatNarrative!, excluded = new Set(story.excludedMessageIds ?? [])
  if (excluded.has(message.messageId) === input.excluded) fail('消息上下文设置已变化，请刷新')
  if (input.excluded) excluded.add(message.messageId)
  else excluded.delete(message.messageId)
  if (excluded.size > 5000) fail('排除消息已达上限，请先恢复部分消息')
  if (excluded.size) story.excludedMessageIds = [...excluded]
  else delete story.excludedMessageIds
  story.revision++; story.lastEventSequence = input.sequence
  return state
}

/** A reply cannot consume an excluded input behind the user's back. Explicit
 * continue/new input can authorize a different action without changing history. */
export function assertChatResponseRetrievableV1(state: CharacterInteractionRuntimeState): void {
  const trigger = state.chatNarrative?.triggers.slice(-1)[0]
  if (trigger?.kind !== 'player-response' || trigger.status !== 'ready') return
  const source = state.messages.find(m => m.eventSequence === trigger.sourceEventSequence)
  if (source && !isChatMessageRetrievableV1(state, source)) fail('本轮玩家消息已排除，不能继续回应它。请恢复上下文、发送新消息或推进下一次行动')
}
