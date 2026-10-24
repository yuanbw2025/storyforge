import type {CharacterInteractionRuntimeState} from '../types'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

/** v3 keeps unanswered dialogue across player turns without reconstructing
 * earlier knowledge from a changed projection. The complete intervening span
 * is mandatory input: structural eligibility never means the question is
 * still wanted, directed at this respondent, or semantically answerable. */
export function chatInquiryContinuityContextV1(state: CharacterInteractionRuntimeState) {
  const story = state.chatNarrative, pending = story?.pendingSituation, scene = state.activeScene
  if (!story || !pending || pending.purpose !== undefined || !scene || !story.permissions.allowInquiryResults
    || !story.permissions.allowActorSituationExpansion || !scene.activeParticipantKeys.includes(pending.actorKey)) return null
  const actions = new Set(story.triggers.flatMap(t => t.actionSequences))
  const request = state.messages.find(m => m.eventSequence === pending.sourceEventSequence && m.role === 'character'
    && m.speakerKey === pending.actorKey && m.supersededBySequence == null && isChatMessageRetrievableV1(state, m))
  if (!request || !actions.has(request.eventSequence) || request.eventSequence < scene.startedAtSequence) return null
  const questions = state.messages.filter(m => m.role === 'character' && m.speakerKey === pending.actorKey
    && m.supersededBySequence == null && isChatMessageRetrievableV1(state, m) && actions.has(m.eventSequence)
    && m.eventSequence >= scene.startedAtSequence && m.eventSequence <= request.eventSequence
    && !story.inquiryHistory?.some(r => r.questionSequence === m.eventSequence))
    .filter(question => ![...actions].some(at => at > question.eventSequence && (at > request.eventSequence
      || !state.messages.some(m => m.eventSequence === at && m.role === 'character' && m.speakerKey === pending.actorKey)))
      && !story.discoveryHistory?.some(d => d.discoverySequence > question.eventSequence)
      && !story.inquiryHistory?.some(i => i.resultSequence > question.eventSequence)
      // An excluded withdrawal cannot silently disappear from this proof.
      && !state.messages.some(m => m.eventSequence > question.eventSequence
        && (m.supersededBySequence != null || !isChatMessageRetrievableV1(state, m))))
    .map(question => {
      const known = new Set(story.situation.facts.filter(f => f.audienceKeys.includes(pending.actorKey)
        && (f.sourceEventSequence === 0 || f.sourceEventSequence <= question.eventSequence)).map(f => f.factKey))
      return {messageId: question.messageId, questionSequence: question.eventSequence,
        questionEvidenceFactKeys: pending.evidenceFactKeys.filter(key => known.has(key)),
        targets: story.permissions.maxDiscoveriesPerSituation ? story.situation.facts.filter(f => !f.audienceKeys.includes(pending.actorKey)
          && f.discovery?.sceneKey === scene.sceneKey && f.discovery.actorKeys.includes(pending.actorKey)
          && f.discovery.prerequisiteFactKeys.every(key => known.has(key)))
          .map(f => ({factKey: f.factKey, requiredEvidenceFactKeys: [...f.discovery!.prerequisiteFactKeys]})) : []}
    })
  const first = Math.min(...questions.map(q => q.questionSequence))
  const dialogueMessageIds = state.messages.filter(m => m.eventSequence >= first)
    .map(m => m.messageId)
  return {schema: 'storyforge.chat-inquiry-evidence', version: 3 as const, actorKey: pending.actorKey,
    requestSequence: request.eventSequence, questions, dialogueMessageIds}
}
