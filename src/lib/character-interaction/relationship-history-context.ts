import type {CharacterInteractionRuntimeState, InteractionRuntimeMessage} from '../types'
import {chatRelationshipEvidenceV1} from './narrative-relationships'
import type {ChatHistoryPlanV1} from './history-selection'

/** Projection identities are local to this event timeline, never new stored facts. */
export const chatRelationshipHistoryKeyV1 = (row: CharacterInteractionRuntimeState['relationshipHistory'][number]) =>
  JSON.stringify([row.fromParticipantKey, row.toParticipantKey, row.dimensionKey, row.eventSequence])

/** Search only this role's witnessed, retrievable expressions. An excluded
 * message cannot re-enter through relationship retrieval. Existing attitude
 * and its mandatory latest cause remain canonical even when dialogue is hidden. */
export function chatRelationshipHistoryRowsV1(state: CharacterInteractionRuntimeState, actorKey: string,
  messages: readonly InteractionRuntimeMessage[]) {
  const mandatory = new Set(chatRelationshipEvidenceV1(state, actorKey).map(chatRelationshipHistoryKeyV1))
  const bySequence = new Map(messages.filter(m => m.supersededBySequence == null
    && (m.audienceKeys == null || m.audienceKeys.includes(actorKey))).map(m => [m.eventSequence, m]))
  return state.relationshipHistory.flatMap(change => {
    if (change.fromParticipantKey !== actorKey || change.toParticipantKey !== state.playerKey) return []
    const key = chatRelationshipHistoryKeyV1(change), required = mandatory.has(key)
    const source = bySequence.get(change.sourceEventSequence), expression = bySequence.get(change.eventSequence)
    const witnessed = change.ruleKey === 'chat.narrative.evidence.v1' && source?.role === 'player'
      && source.speakerKey === state.playerKey && expression?.role === 'character' && expression.speakerKey === actorKey
      && expression.text.includes(change.reason)
    if (!required && !witnessed) return []
    return [{key, change, required, messages: witnessed ? [source, expression] : []}]
  })
}

export function addChatRelationshipHistoryV1(plan: ChatHistoryPlanV1, rows: ReturnType<typeof chatRelationshipHistoryRowsV1>) {
  for (const row of rows) {
    plan.add('relationships', row.key, [row.change.reason, ...row.messages.map(m => m.text)].join('\n'),
      row.required ? ['current-relationship-cause'] : [])
    for (const message of row.messages) {
      // Callers add these exact authorized messages before creating links.
      if (!plan.entries.has(`messages:${message.messageId}`)) throw new Error('关系历史缺少原话，已停止读取；不会用摘要补足原因。')
      plan.link('relationships', row.key, 'messages', message.messageId)
    }
  }
}
