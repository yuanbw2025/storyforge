import type {CharacterInteractionRuntimeState} from '../types'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

/** Only the final action of an explicitly versioned turn can leave background
 * settlement pending. It grants no additional action or construction cycle. */
export function chatHasPendingTurnSettlementV1(state: CharacterInteractionRuntimeState): boolean {
  const story = state.chatNarrative, trigger = story?.triggers.slice(-1)[0]
  return !!(trigger?.direction?.settleSituationVersion === 1 && trigger.status === 'ready'
    && trigger.actionSequences.length === trigger.direction.actionLimit
    && story?.pendingSituation?.sourceEventSequence === trigger.actionSequences.slice(-1)[0]
    && chatSituationConstructionRequestV1(state))
}

/** A reviewed new direction keeps its exact player source through save/branch.
 * Later player input interrupts it; mere elapsed time never executes it. */
export function chatHasPendingPlayerFollowupV1(state: CharacterInteractionRuntimeState, actorKey: string): boolean {
  const story = state.chatNarrative, pending = story?.pendingSituation
  if (!story || pending?.purpose !== 'player-followup' || pending.actorKey !== actorKey
    || story.permissions.allowPlayerFollowupSituations !== true || story.permissions.allowActorSituationExpansion !== true
    || pending.goalKey !== null || story.situation.goals.some(g => g.actorKey === actorKey && ['active', 'paused'].includes(g.status))) return false
  const source = state.messages.find(m => m.role === 'player' && m.eventSequence === pending.playerEventSequence)
  return !!source && isChatMessageRetrievableV1(state, source) && (source.audienceKeys == null || source.audienceKeys.includes(actorKey))
    && source.text.includes(pending.playerExcerpt)
    && !state.messages.some(m => m.role === 'player' && m.supersededBySequence == null && m.eventSequence > pending.sourceEventSequence)
}

/** A new direction can expand once per turn. A later, actually completed
 * observation can still resolve its result within that turn's remaining actions.
 * Consuming the pending result is atomic; it grants no new direction or action. */
export function chatSituationConstructionBlockedV1(state: CharacterInteractionRuntimeState): boolean {
  const story = state.chatNarrative, trigger = story?.triggers.slice(-1)[0]
  if (!story || !trigger || story.situation.seed.sourceEventSequence !== trigger.requestedSequence
    || !['player-request', 'continued-thread', 'player-followup'].includes(story.situation.seed.origin)) return false
  const pending = story.pendingSituation
  const completedResult = pending?.purpose === 'observation-result' || pending?.purpose === 'inquiry-result'
  return !completedResult || !pending || !trigger.actionSequences.includes(pending.sourceEventSequence)
    || pending.sourceEventSequence !== trigger.actionSequences.slice(-1)[0]
}

/** Only an already reviewed intention or completed observation may request
 * construction. No offline or mount work and no extra autonomous-action quota. */
export function chatSituationConstructionRequestV1(state: CharacterInteractionRuntimeState, actorKey?: string) {
  const story = state.chatNarrative, trigger = story?.triggers.slice(-1)[0]
  if (!story || !state.activeScene || !trigger || trigger.status !== 'ready') return null
  if (chatSituationConstructionBlockedV1(state)) return null
  if (trigger.kind === 'player-seed' && !trigger.actionSequences.length) return trigger.seed
    ? {text: trigger.seed, origin: 'player-request' as const, actorKey: null, sourceThreadKey: null} : null
  const pending = story.pendingSituation
  if (pending?.purpose === 'player-followup') {
    if (actorKey != null && pending.actorKey !== actorKey || !state.activeScene.activeParticipantKeys.includes(pending.actorKey)
      || !chatHasPendingPlayerFollowupV1(state, pending.actorKey)
      || !['continue', 'return'].includes(trigger.kind) && !trigger.actionSequences.includes(pending.sourceEventSequence)) return null
    const source = state.messages.find(m => m.role === 'player' && m.eventSequence === pending.playerEventSequence)!
    return {text: pending.direction, origin: 'player-followup' as const, actorKey: pending.actorKey, sourceThreadKey: null,
      audienceKeys: source.audienceKeys ?? [state.playerKey, ...state.activeScene.activeParticipantKeys]}
  }
  const observationResult = pending?.purpose === 'observation-result'
  if (!pending || story.permissions.allowActorSituationExpansion !== true
    || actorKey != null && pending.actorKey !== actorKey
    || !state.activeScene.activeParticipantKeys.includes(pending.actorKey)
    || !['continue', 'return'].includes(trigger.kind) && !(observationResult && trigger.kind === 'player-response') && !trigger.actionSequences.includes(pending.sourceEventSequence)
    || !story.situation.goals.some(g => g.goalKey === pending.goalKey && g.actorKey === pending.actorKey && g.status === 'active')
    || !story.situation.threads.some(t => t.threadKey === pending.threadKey && ['open', 'blocked'].includes(t.status))
    || !observationResult && state.messages.some(m => m.role === 'player' && m.supersededBySequence == null && m.eventSequence > pending.sourceEventSequence)) return null
  return {text: pending.direction, origin: 'continued-thread' as const, actorKey: pending.actorKey, sourceThreadKey: pending.threadKey}
}
