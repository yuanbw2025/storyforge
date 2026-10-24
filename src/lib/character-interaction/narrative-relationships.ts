import type {CharacterInteractionRuntimeState, InteractionRuntimeRelationship} from '../types'
import type {ChatNarrativeActionV1} from '../types/chat-narrative'

function fail(message: string): never {throw new Error(`[chat-relationship] ${message}`)}
const normalizedMessage = (value: string) => value.normalize('NFKC').replace(/\s+/g, '')
export const chatRelationshipDeltaLimitV1 = (relationship: InteractionRuntimeRelationship) =>
  Math.min(2, relationship.largeChangeThreshold, (relationship.maximum - relationship.minimum) / 50)

/** Select evidence by current dimension and actual player input, before budget
 * trimming. The event history remains the sole durable source of truth. */
export function chatRelationshipEvidenceV1(state: CharacterInteractionRuntimeState, actorKey: string) {
  const history = state.relationshipHistory.filter(h => h.fromParticipantKey === actorKey && h.toParticipantKey === state.playerKey)
  const messages = new Map(state.messages.map(m => [m.eventSequence, m]))
  const latest = new Map<string, typeof history[number]>()
  for (const item of history) latest.set(item.dimensionKey, item)
  const player = state.messages.filter(m => m.role === 'player' && m.supersededBySequence == null
    && (m.audienceKeys == null || m.audienceKeys.includes(actorKey))).slice(-1)[0]
  return history.filter(item => {
    const source = messages.get(item.sourceEventSequence)
    return latest.get(item.dimensionKey) === item || player && (item.sourceEventSequence === player.eventSequence
      || source && source.eventSequence > (state.activeScene?.startedAtSequence ?? Infinity) && normalizedMessage(source.text) === normalizedMessage(player.text))
  })
}

/** Called only on an isolated action preview. No separate relationship event,
 * player feelings, off-screen penalties, or silent clamping is introduced. */
export function applyChatRelationshipEffectsV1(state: CharacterInteractionRuntimeState, input: {
  sequence: number; actorKey: string; action: ChatNarrativeActionV1
}): void {
  const effects = input.action.relationshipUpdates ?? []
  if (!effects.length) return
  const trigger = state.chatNarrative!.triggers.slice(-1)[0]!
  if (trigger.kind !== 'player-response') fail('关系变化只允许回应真实玩家消息，不能由继续、返回或开场触发')
  const source = state.messages.find(m => m.eventSequence === trigger.sourceEventSequence)
  if (!source || source.role !== 'player' || source.supersededBySequence != null
    || source.eventSequence <= state.activeScene!.startedAtSequence
    || source.audienceKeys != null && !source.audienceKeys.includes(input.actorKey)) fail('关系变化缺少当前角色可见的玩家依据')
  const changed = new Set<string>()
  const messages = new Map(state.messages.map(m => [m.eventSequence, m]))
  for (const effect of effects) {
    if (effect.sourceEventSequence !== source.eventSequence || !source.text.includes(effect.playerExcerpt)) fail('关系证据不是本轮玩家实际表达')
    if (!input.action.text.includes(effect.evidenceExcerpt)) fail('关系变化没有本次角色表达的依据')
    const target = state.relationships.find(r => r.fromParticipantKey === input.actorKey && r.toParticipantKey === state.playerKey && r.dimensionKey === effect.dimensionKey)
    if (!target || changed.has(effect.dimensionKey)) fail('关系维度不存在或重复修改')
    if (Math.abs(effect.delta) > chatRelationshipDeltaLimitV1(target)) fail('关系变化超出基础小幅影响授权')
    const duplicate = state.relationshipHistory.some(h => h.fromParticipantKey === input.actorKey
      && h.toParticipantKey === state.playerKey && h.dimensionKey === effect.dimensionKey
      && (h.sourceEventSequence === source.eventSequence || (() => {
        const message = messages.get(h.sourceEventSequence)
        return message && message.eventSequence > state.activeScene!.startedAtSequence && normalizedMessage(message.text) === normalizedMessage(source.text)
      })()))
    if (duplicate) fail('同一玩家依据或本场重复表达已经影响过该关系维度')
    const before = target.value, after = before + effect.delta
    if (after < target.minimum || after > target.maximum || after === before) fail('关系变化超出边界或没有实际差异')
    target.value = after; target.lastChangedSequence = input.sequence
    state.relationshipHistory.push({eventSequence: input.sequence, fromParticipantKey: input.actorKey, toParticipantKey: state.playerKey,
      dimensionKey: effect.dimensionKey, before, after, delta: effect.delta, reason: effect.evidenceExcerpt,
      ruleKey: 'chat.narrative.evidence.v1', sourceEventSequence: source.eventSequence, significantEventKey: null})
    changed.add(effect.dimensionKey)
  }
}
