import type {CharacterInteractionRuntimeState} from '../types'
import {chatInquiryContinuityContextV1} from './inquiry-continuity'

/** Reuse the original continuity proof: only the asking actor's own actions
 * may intervene, with no later discovery, reply or hidden dialogue. This lets
 * us prove which existing facts that actor knew when the question was asked.
 * Eligibility is not proof that a fact describes a present, willing person. */
export function chatInquiryContactEvidenceContextV1(state: CharacterInteractionRuntimeState) {
  const prior = chatInquiryContinuityContextV1(state)
  if (!prior) return null
  const facts = state.chatNarrative!.situation.facts
  return {...prior, version: 4 as const, questions: prior.questions.map(question => ({...question,
    respondentEvidenceFactKeys: facts.filter(f => f.audienceKeys.includes(prior.actorKey)
      && (f.sourceEventSequence === 0 || f.sourceEventSequence <= question.questionSequence)).map(f => f.factKey),
  }))}
}

/** Only advertise contact references whose full text was actually selected.
 * Keep omission counts visible; missing detail is never proof of no contact. */
export function projectChatInquiryContactEvidenceV1(context: (Omit<NonNullable<ReturnType<typeof chatInquiryContactEvidenceContextV1>>, 'version'> & {version: 4 | 5}) | null, included: (key: string) => boolean) {
  if (!context) return null
  return {...context, questions: context.questions.map(question => {
    const respondentEvidenceFactKeys = question.respondentEvidenceFactKeys.filter(included)
    return {...question, respondentEvidenceFactKeys,
      omittedRespondentEvidenceCount: question.respondentEvidenceFactKeys.length - respondentEvidenceFactKeys.length}
  })}
}
