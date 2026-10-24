import {assertInstanceBinding} from '../product/runtime-instances'
import type {WorkspaceScope} from '../types'
import {requireChatRetrievalMessageV1} from './narrative-retrieval'
import {readProductRuntimeState, readProductRuntimeStateVersion, setChatMessageRetrieval} from './runtime-api'

export interface ChatMessageRetrievalPlanV1 {
  sessionId: number
  messageId: string
  text: string
  excluded: boolean
  baseSequence: number
  stateHash: string
  /** Only directly linked, player-visible consequences; not hidden causality. */
  retained: {facts: number; threads: number; memories: number; relationships: number}
}

export async function readChatMessageRetrievalPlanV1(scope: WorkspaceScope, sessionId: number, messageId: string): Promise<ChatMessageRetrievalPlanV1> {
  const owner = await assertInstanceBinding(sessionId, scope)
  if (owner.kind !== 'character-interaction') throw new Error('消息排除只属于角色聊天。')
  const version = await readProductRuntimeStateVersion(sessionId)
  const state = (await readProductRuntimeState(sessionId)).interaction
  if (!state?.chatNarrative) throw new Error('消息排除需要主动叙事角色聊天存档。')
  const message = requireChatRetrievalMessageV1(state, messageId), sequence = message.eventSequence
  const visible = new Set(state.messages.filter(m => m.supersededBySequence == null && (m.role === 'player' || m.audienceKeys == null || m.audienceKeys.includes(state.playerKey))).map(m => m.eventSequence))
  return {sessionId, messageId, text: message.text, excluded: state.chatNarrative.excludedMessageIds?.includes(messageId) ?? false,
    baseSequence: version.sequence, stateHash: version.stateHash, retained: {
      facts: state.chatNarrative.situation.facts.filter(f => f.sourceEventSequence === sequence && f.audienceKeys.includes(state.playerKey)).length,
      threads: state.chatNarrative.situation.threads.filter(t => t.updatedSequence === sequence && t.audienceKeys.includes(state.playerKey)).length,
      memories: state.memories.filter(m => m.status === 'accepted' && m.sourceEventSequences.includes(sequence) && m.sourceEventSequences.every(s => visible.has(s))).length,
      relationships: state.relationshipHistory.filter(r => (r.eventSequence === sequence || r.sourceEventSequence === sequence) && r.toParticipantKey === state.playerKey && visible.has(r.eventSequence)).length,
    }}
}

export async function applyChatMessageRetrievalPlanV1(scope: WorkspaceScope, plan: ChatMessageRetrievalPlanV1) {
  const current = await readChatMessageRetrievalPlanV1(scope, plan.sessionId, plan.messageId)
  if (current.baseSequence !== plan.baseSequence || current.stateHash !== plan.stateHash || current.excluded !== plan.excluded) throw new Error('消息上下文影响已变化，请重新查看。')
  return setChatMessageRetrieval({sessionId: current.sessionId, commandId: `chat.retrieval:${crypto.randomUUID()}`,
    baseSequence: current.baseSequence, baseStateHash: current.stateHash, messageId: current.messageId, excluded: !current.excluded})
}
