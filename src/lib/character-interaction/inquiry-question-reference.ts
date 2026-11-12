import type { ChatNarrativeStateV1 } from '../types/chat-narrative'

export function projectChatInquiryQuestionReferenceV1(
  story: ChatNarrativeStateV1,
  pending: NonNullable<ChatNarrativeStateV1['pendingSituation']>,
  sceneKey: string,
  question: { messageId: string; eventSequence: number },
) {
  const known = new Set(story.situation.facts.filter(f => f.audienceKeys.includes(pending.actorKey)
    && (f.sourceEventSequence === 0 || f.sourceEventSequence <= question.eventSequence)).map(f => f.factKey))
  return {messageId: question.messageId, questionSequence: question.eventSequence,
    questionEvidenceFactKeys: pending.evidenceFactKeys.filter(key => known.has(key)),
    targets: story.permissions.maxDiscoveriesPerSituation ? story.situation.facts.filter(f => !f.audienceKeys.includes(pending.actorKey)
      && f.discovery?.sceneKey === sceneKey && f.discovery.actorKeys.includes(pending.actorKey)
      && f.discovery.prerequisiteFactKeys.every(key => known.has(key)))
      .map(f => ({factKey: f.factKey, requiredEvidenceFactKeys: [...f.discovery!.prerequisiteFactKeys]})) : []}
}
