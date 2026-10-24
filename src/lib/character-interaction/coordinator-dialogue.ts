import type {CharacterInteractionRuntimeState} from '../types'
import {createContextTextScorerV1} from '../context-gateway/lexical-query'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

/** A versioned read projection. Full messages and canonical consequences remain
 * in the runtime; this is neither an archive nor a second source of truth. */
export function planChatCoordinatorDialogueV1(state: CharacterInteractionRuntimeState, input: {
  text: string
  deliveredMessageIds: readonly string[]
}) {
  const story = state.chatNarrative!, scene = state.activeScene!
  const available = state.messages.filter(m => m.supersededBySequence == null && isChatMessageRetrievableV1(state, m))
  const current = available.filter(m => m.eventSequence > scene.startedAtSequence)
  const byId = new Map(available.map(m => [m.messageId, m]))
  const bySequence = new Map(available.map(m => [m.eventSequence, m]))
  const reasons = new Map<string, string[]>()
  const protect = (id: string, reason: string) => {
    if (!byId.has(id)) throw new Error('协调上下文缺少必需的原消息，已停止；不会用摘要或其它消息替代。')
    reasons.set(id, [...new Set([...(reasons.get(id) ?? []), reason])])
  }
  const protectSequence = (sequence: number, reason: string) => {
    const message = bySequence.get(sequence)
    if (!message) throw new Error('协调上下文的必需消息引用不存在或已被排除，已停止。')
    protect(message.messageId, reason)
  }
  // All current-scene player statements stay mandatory: an old refusal must
  // not disappear merely because subsequent character dialogue is verbose.
  for (const m of current) if (m.role === 'player') protect(m.messageId, 'current-player')
  if (current.length) protect(current[current.length - 1].messageId, 'latest-dialogue')
  for (const id of input.deliveredMessageIds) protect(id, 'actor-delivered')
  if (story.pendingSituation) {
    protectSequence(story.pendingSituation.sourceEventSequence, 'pending-action')
    if (story.pendingSituation.purpose === 'player-followup') protectSequence(story.pendingSituation.playerEventSequence, 'pending-player-request')
  }
  // A history-edit branch intentionally stops before the replaced message;
  // its complete pendingEdit draft is already mandatory coordinator material.
  // These fields are message references in the already validated candidate,
  // unlike baseSequence/revision/trigger sequences, which can be non-messages.
  const messageReferenceFields = new Set(['playerEventSequence', 'actionSequence', 'questionSequence'])
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (messageReferenceFields.has(key) && typeof child === 'number') protectSequence(child, 'candidate-reference')
      else visit(child)
    }
  }
  let candidate: unknown
  try {candidate = JSON.parse(input.text)} catch { /* A non-JSON search query has no structured references. */ }
  visit(candidate)
  const query = createContextTextScorerV1(input.text)
  const situation = createContextTextScorerV1(JSON.stringify({
    goals: story.situation.goals.filter(g => g.status === 'active' || g.status === 'paused').map(g => ({desire: g.desire, concern: g.concern, boundary: g.boundary})),
    threads: story.situation.threads.filter(t => t.status === 'open' || t.status === 'blocked').map(t => ({title: t.title, question: t.question})),
    player: [...current].reverse().find(m => m.role === 'player')?.text ?? '',
  }))
  const eligible = available.filter(m => m.eventSequence > scene.startedAtSequence || reasons.has(m.messageId))
  const required = eligible.filter(m => reasons.has(m.messageId))
  const optional = eligible.filter(m => !reasons.has(m.messageId)).map((item, index) => ({item, index,
    score: query(item.text) * 4 + situation(item.text)}))
    .sort((a, b) => b.score - a.score || b.index - a.index)
  return {eligible, required, optional,
    evidence: {version: 1 as const, totalMessageEntries: eligible.length, omittedMessageEntries: eligible.length - required.length,
      requiredMessages: required.map(m => ({messageId: m.messageId, reasons: reasons.get(m.messageId)!})),
      note: '当前场景玩家原话、行动者实际读到的对话、待结算动作及候选消息引用完整保留；其余场景对话按候选和当前事项相关性选择。省略只影响本轮读取，不撤销已发生事实、约定、拒绝或发现条件；缺少必要证据时停止，不据省略认定不存在。'}}
}
