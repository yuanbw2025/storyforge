import type {InteractionRuntimeMessage} from '../types'
import type {ChatNarrativeTriggerStateV1} from '../types/chat-narrative'
import type {InteractionVisibilityView} from './runtime'

/** Only already authorized, retrievable messages can establish a response
 * segment. Player inputs and actual turns containing visible actions provide
 * semantic boundaries, including explicit continue turns without player text.
 * Private turns with no delivered action cannot change this projection.
 */
export function planChatRecentDialogueV1(
  view: Pick<InteractionVisibilityView, 'activeScene' | 'messages'>,
  actorKey: string,
  triggers: readonly ChatNarrativeTriggerStateV1[] = [],
): Map<string, string[]> {
  const reasons = new Map<string, string[]>()
  const current = view.messages.filter(m => m.eventSequence > (view.activeScene?.startedAtSequence ?? -Infinity))
  const visibleSequences = new Set(current.map(m => m.eventSequence))
  const boundaries = new Map<number, ChatNarrativeTriggerStateV1 | undefined>()
  for (const message of current) if (message.role === 'player') boundaries.set(message.eventSequence, undefined)
  // A trigger is used only when its actual action is in the authorized view.
  // Never project its seed, direction, private action IDs or invisible count.
  for (const trigger of triggers) if (trigger.actionSequences.some(sequence => visibleSequences.has(sequence))) {
    boundaries.set(trigger.requestedSequence, trigger)
  }
  const ordered = [...boundaries].sort(([left], [right]) => left - right)
  const segments: Array<{messages: InteractionRuntimeMessage[]; trigger?: ChatNarrativeTriggerStateV1}> = []
  let boundary = -1
  for (const message of current) {
    const previous = boundary
    while (boundary + 1 < ordered.length && ordered[boundary + 1][0] <= message.eventSequence) boundary++
    if (!segments.length || boundary !== previous) segments.push({messages: [], trigger: boundary < 0 ? undefined : ordered[boundary][1]})
    segments[segments.length - 1].messages.push(message)
  }
  const byId = new Map(view.messages.map(message => [message.messageId, message]))
  const bySequence = new Map(view.messages.map((message, index) => [message.eventSequence, {message, index}]))
  function fail(): never {throw new Error('近期回应缺少可检索的明确消息依据，已停止；不会补回被排除或不可见的消息。')}
  const protect = (message: InteractionRuntimeMessage, reason: string) => {
    const existing = reasons.get(message.messageId) ?? []
    if (!existing.includes(reason)) reasons.set(message.messageId, [...existing, reason])
  }
  const protectSegment = (segment: typeof segments[number] | undefined, reason: string) => {
    if (!segment) return
    for (const message of segment.messages) protect(message, reason)
    if (segment.trigger?.kind === 'player-response') {
      const source = bySequence.get(segment.trigger.sourceEventSequence)
      if (!source || source.message.role !== 'player' || source.message.eventSequence >= segment.trigger.requestedSequence) fail()
      protect(source.message, 'response-player-source')
    }
  }
  protectSegment(segments[segments.length - 1], 'current-response')
  // Consecutive player inputs can leave empty response segments. Walk back to
  // an actual response; do not take a fixed message or two-player-input slice.
  const priorResponse = segments.slice(0, -1).reverse().find(segment => segment.messages.some(m => m.role !== 'player'))
  protectSegment(priorResponse, 'recent-response')
  const ownResponse = [...segments].reverse().find(segment => segment.messages.some(m => m.role === 'character' && m.speakerKey === actorKey))
  protectSegment(ownResponse, 'latest-own-response')
  const queue = [...reasons.keys()], visited = new Set<string>()
  while (queue.length) {
    const key = queue.pop()!
    if (visited.has(key)) continue
    visited.add(key)
    const message = byId.get(key)!
    if (message.replyToSequence == null) continue
    const source = bySequence.get(message.replyToSequence), currentMessage = bySequence.get(message.eventSequence)!
    if (!source || source.index >= currentMessage.index) fail()
    protect(source.message, 'reply-source')
    queue.push(source.message.messageId)
  }
  return reasons
}
