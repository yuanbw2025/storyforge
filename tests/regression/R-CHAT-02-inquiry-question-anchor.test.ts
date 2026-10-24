import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {readProductRuntimeState, readProductRuntimeStateVersion} from '../../src/lib/character-interaction/runtime-api'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {previewChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {chatInquiryQuestionEvidenceContextV1, chatInquiryEvidenceVersionForContractV1} from '../../src/lib/character-interaction/inquiry-evidence'
import {prepareChatInquiryFixture, chatInquiryDraftFixture, chatInquiryInputFixture, chatInquiryReviewFixture, inquiryQuestion, inquiryReassurance} from '../helpers/chat-inquiry-result'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('binds the actual earlier question without admitting another turn, speaker or changed knowledge', async () => {
  const f = await prepareChatInquiryFixture({splitQuestion: true, questionEvidenceFactKeys: ['clerk-present', 'box']})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, draft = await chatInquiryDraftFixture(f.sessionId)
  const questionAt = draft.inquiryResult!.questionSequence, requestAt = state.chatNarrative!.pendingSituation!.sourceEventSequence
  const input = {sequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence + 1,
    triggerSequence: state.chatNarrative!.triggers.at(-1)!.requestedSequence, draft, inquiryEvidenceVersion: 2}
  const basis = chatInquiryQuestionEvidenceContextV1(state)!
  expect(questionAt).toBeLessThan(requestAt)
  expect(basis.requestSequence).toBe(requestAt)
  expect(basis.questions.map(q => q.questionSequence)).toEqual([questionAt, requestAt])
  const original = structuredClone(state)
  expect(previewChatSituationV1(state, input).chatNarrative!.inquiryHistory![0].questionSequence).toBe(questionAt)
  expect(state).toEqual(original)
  for (const version of [undefined, 1]) expect(() => previewChatSituationV1(state, {...input, inquiryEvidenceVersion: version})).toThrow('实际询问')
  const mutations: Array<[string, (copy: typeof state) => void]> = [
    ['another speaker', s => {s.messages.find(m => m.eventSequence === questionAt)!.speakerKey = 'artisan'}],
    ['previous scene', s => {s.activeScene!.startedAtSequence = requestAt}],
    ['superseded question', s => {s.messages.find(m => m.eventSequence === questionAt)!.supersededBySequence = requestAt}],
    ['previous turn', s => {s.chatNarrative!.triggers.find(t => t.actionSequences.includes(requestAt))!.actionSequences = [requestAt]}],
    ['future question', s => {s.messages.find(m => m.eventSequence === questionAt)!.eventSequence = requestAt + 1}],
    ['intervening actor', s => {s.messages.find(m => m.eventSequence === requestAt)!.speakerKey = 'artisan'}],
    ['intervening player', s => {s.messages.push({...s.messages.find(m => m.eventSequence === questionAt)!, role: 'player', speakerKey: 'player', messageId: 'interruption', eventSequence: questionAt + 1})}],
    ['later action', s => {s.chatNarrative!.triggers.at(-1)!.actionSequences.push(requestAt + 1)}],
    ['later discovery', s => {s.chatNarrative!.discoveryHistory = [{discoverySequence: requestAt, factKey: 'secret', actorKey: 'guard', actionSequence: questionAt, evidenceFactKeys: ['box'], evidenceExcerpt: inquiryQuestion, result: 'inconclusive', reason: 'later knowledge settlement'}]}],
    ['already answered', s => {s.chatNarrative!.inquiryHistory = [{...draft.inquiryResult!, resultSequence: requestAt, sceneKey: 'inn'}]}],
  ]
  for (const [label, change] of mutations) {
    const copy = structuredClone(state); change(copy)
    const before = structuredClone(copy)
    expect(chatInquiryQuestionEvidenceContextV1(copy)?.questions.some(q => q.questionSequence === questionAt) ?? false, label).toBe(false)
    expect(() => previewChatSituationV1(copy, input), label).toThrow()
    expect(copy, label).toEqual(before)
  }
  for (const key of ['lost', 'clerk-present']) {
    const copy = structuredClone(state)
    copy.chatNarrative!.situation.facts.find(fact => fact.factKey === key)!.sourceEventSequence = requestAt
    expect(() => previewChatSituationV1(copy, input)).toThrow()
  }
})

it('keeps an earlier private question private even when the later reassurance is public', async () => {
  const f = await prepareChatInquiryFixture({splitQuestion: true, reassuranceAudienceKeys: ['guard', 'player', 'artisan']})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, draft = await chatInquiryDraftFixture(f.sessionId, ['guard', 'player', 'artisan'])
  const input = {sequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence + 1,
    triggerSequence: state.chatNarrative!.triggers.at(-1)!.requestedSequence, draft, inquiryEvidenceVersion: 2}
  expect(state.messages.find(m => m.text === inquiryReassurance)!.audienceKeys).toContain('artisan')
  expect(() => previewChatSituationV1(state, input)).toThrow('答复听众')
  draft.inquiryResult!.audienceKeys = ['guard', 'player']
  expect(previewChatSituationV1(state, input).chatNarrative!.inquiryHistory![0].audienceKeys).toEqual(['guard', 'player'])
  expect(state.chatNarrative!.inquiryHistory).toBeUndefined()
})

it('retains both utterances for independent semantic review and never adopts a rejected question', async () => {
  const f = await prepareChatInquiryFixture({splitQuestion: true}), draft = await chatInquiryDraftFixture(f.sessionId)
  const before = await readProductRuntimeState(f.sessionId), review = chatInquiryReviewFixture(draft)
  const check = review.inquiryReview.checks.find(c => c.check === 'actual-question')!
  check.passed = false; check.reason = '模拟审查判定原问题不再适用，不能因结构允许就采用'
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), onRunCreated: id => {runId = id},
    runAI: async () => {calls++; return JSON.stringify(draft)}, runReviewAI: async messages => {
      calls++; expect(messages[0].content).toContain('后句若撤回、改变问题或改变对象')
      expect(messages[1].content).toContain(inquiryQuestion); expect(messages[1].content).toContain(inquiryReassurance)
      expect(messages[1].content).toContain('"version":3')
      return JSON.stringify(review)
    }})).rejects.toThrow()
  expect(calls).toBe(2)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('derives the evidence version from an exact frozen producer/reviewer pair', () => {
  const pair = (producer: number, reviewer: number) => ({executionBindings: [
    {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-situation-construction', promptVersion: `chat-situation-construction-v${producer}`},
    {stepId: 'interaction:situation-review', skillId: 'character.chat-situation-review', promptVersion: `chat-situation-review-v${reviewer}`},
  ]})
  expect(chatInquiryEvidenceVersionForContractV1(pair(12, 11))).toBeUndefined()
  expect(chatInquiryEvidenceVersionForContractV1(pair(13, 12))).toBe(1)
  expect(chatInquiryEvidenceVersionForContractV1(pair(14, 13))).toBe(2)
  expect(chatInquiryEvidenceVersionForContractV1(pair(15, 14))).toBe(3)
  for (const [producer, reviewer] of [[15, 13], [14, 14], [13, 14], [14, 12], [13, 13], [12, 13]]) expect(() => chatInquiryEvidenceVersionForContractV1(pair(producer, reviewer))).toThrow('合同不一致')
  const repeated = pair(14, 13); repeated.executionBindings.push(repeated.executionBindings[0])
  expect(() => chatInquiryEvidenceVersionForContractV1(repeated)).toThrow('合同不一致')
})
