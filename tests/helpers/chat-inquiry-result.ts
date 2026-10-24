import {type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {commitInteractionPlayerMessage, requestChatNarrativeTrigger, readProductRuntimeState, readProductRuntimeStateVersion} from '../../src/lib/character-interaction/runtime-api'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from './chat-narrative-fixture'

export {inquiryReassurance, inquiryQuestion, inquiryAnswer, inquiryTruth, inquiryPurpose, chatInquiryReviewFixture} from './chat-inquiry-output'
import {inquiryReassurance, inquiryQuestion, inquiryAnswer} from './chat-inquiry-output'
/** Synthetic reviewers and frozen inquiry authority; not a real-model quality result. */
export async function prepareChatInquiryFixture(options: {conversationMode?: 'present' | 'private'; questionEvidenceFactKeys?: string[]; splitQuestion?: boolean; reassuranceAudienceKeys?: string[]; playerInterjection?: string} = {}) {
  const f = await seedChatNarrativeRuntimeFixture({inquiryResults: true, factDiscovery: true, ...(options.splitQuestion ? {maxActionsPerTrigger: 2} : {})})
  let v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'inquiry.start', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence,
    ...(options.conversationMode ? {direction: {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: options.conversationMode === 'private' ? ['guard'] : ['guard', 'artisan'], conversationMode: options.conversationMode}} : {})})
  const evidenceFactKeys = options.questionEvidenceFactKeys ?? ['lost', 'clerk-present', 'box']
  const action: ChatNarrativeActionV1 = {kind: 'speak', text: inquiryQuestion, goalKey: 'find-seal', audienceKeys: ['guard', 'player'],
    evidenceFactKeys, waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    ...(!options.splitQuestion || options.playerInterjection ? {situationRequest: {threadKey: 'investigate', direction: '承接刚才向掌柜提出的具体位置问题，保留其可能拒答或无法确认的空间。',
      evidenceFactKeys, evidenceExcerpt: inquiryQuestion}} : {})}
  const asked = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '工程实际询问，不预写回答', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: asked.snapshot.run.id})
  if (options.playerInterjection) {
    v = await readProductRuntimeStateVersion(f.sessionId)
    const message = await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'inquiry.player', baseSequence: v.sequence, baseStateHash: v.stateHash,
      messageId: 'inquiry.player', text: options.playerInterjection, audienceKeys: ['guard']})
    v = await readProductRuntimeStateVersion(f.sessionId)
    await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'inquiry.player-response', baseSequence: v.sequence, baseStateHash: v.stateHash,
      kind: 'player-response', sourceEventSequence: message.sequence})
  }
  if (options.splitQuestion || options.playerInterjection) {
    const followup: ChatNarrativeActionV1 = {...action, text: inquiryReassurance, audienceKeys: options.reassuranceAudienceKeys ?? ['guard', 'player'],
      situationRequest: {threadKey: 'investigate', direction: '承接刚才向掌柜提出的具体位置问题，保留其可能拒答或无法确认的空间。', evidenceFactKeys, evidenceExcerpt: inquiryReassurance}}
    const continued = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
      objective: '工程补充说明，引用之前实际问话', runAI: withChatActionChoiceFixture(async () => JSON.stringify(followup)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: continued.snapshot.run.id})
  }
  v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'inquiry.continue', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'continue', sourceEventSequence: v.sequence,
    ...(options.conversationMode ? {direction: {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: options.conversationMode === 'private' ? ['guard'] : ['guard', 'artisan'], conversationMode: options.conversationMode}} : {})})
  return f
}
export async function chatInquiryDraftFixture(sessionId: number, audienceKeys = ['guard', 'player']): Promise<ChatSituationDraftV1> {
  const state = (await readProductRuntimeState(sessionId)).interaction!, story = state.chatNarrative!
  return {kind: 'chat-situation', title: story.situation.title, location: story.situation.location, timeLabel: story.situation.timeLabel,
    newFacts: [], newGoals: [], newThreads: [], possibilities: [], inquiryResult: {
      actorKey: 'guard', questionSequence: state.messages.find(m => m.speakerKey === 'guard' && m.text === inquiryQuestion)!.eventSequence, questionExcerpt: inquiryQuestion,
      respondentFactKey: 'clerk-present', respondentExcerpt: '掌柜在柜台另一端，可以当面交谈。', respondentName: '掌柜', statementFactKey: 'clerk-statement',
      answerKind: 'statement', answerText: inquiryAnswer, audienceKeys, evidenceFactKeys: ['lost', 'clerk-present', 'box'],
      discoveries: [{factKey: 'secret', answerExcerpt: '铜印仍在柜台下的木箱里', reason: '工程条件专门授权保管人确认此独立位置事实，不确认用途'}],
    }}
}
export function chatInquiryInputFixture(f: {scope: Awaited<ReturnType<typeof seedChatNarrativeRuntimeFixture>>['scope']; sessionId: number}) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: 'character.chat-situation-construction' as const, objective: '实际询问的有限答复'}
}
