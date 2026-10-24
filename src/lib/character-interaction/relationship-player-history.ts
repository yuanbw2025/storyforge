import type {CharacterInteractionRuntimeState, InteractionRuntimeMessage} from '../types'

/** Player inspection is independent of model retrieval: excluded dialogue is
 * still readable here. Only original, jointly visible expressions can explain
 * a change; legacy reasons without this evidence are not exposed as dialogue. */
export function chatPlayerRelationshipHistoryV1(state: CharacterInteractionRuntimeState) {
  const messages = new Map(state.messages.map(message => [message.eventSequence, message]))
  const jointlyVisible = (message: InteractionRuntimeMessage, actorKey: string) => message.supersededBySequence == null
    && (message.audienceKeys == null || [actorKey, state.playerKey].every(key => key === message.speakerKey || message.audienceKeys!.includes(key)))
  return state.relationships.filter(relationship => relationship.toParticipantKey === state.playerKey
    && state.profiles.some(profile => profile.participantKey === relationship.fromParticipantKey)).map(relationship => {
    const actorKey = relationship.fromParticipantKey
    const history = state.relationshipHistory.flatMap(change => {
      if (change.fromParticipantKey !== actorKey || change.toParticipantKey !== state.playerKey
        || change.dimensionKey !== relationship.dimensionKey || change.ruleKey !== 'chat.narrative.evidence.v1') return []
      const source = messages.get(change.sourceEventSequence), expression = messages.get(change.eventSequence)
      if (!source || source.role !== 'player' || source.speakerKey !== state.playerKey
        || !expression || expression.role !== 'character' || expression.speakerKey !== actorKey
        || !jointlyVisible(source, actorKey) || !jointlyVisible(expression, actorKey)
        || !expression.text.includes(change.reason)) return []
      return [{change, source, expression}]
    })
    return {relationship, actorName: state.profiles.find(profile => profile.participantKey === actorKey)!.name, history}
  })
}
