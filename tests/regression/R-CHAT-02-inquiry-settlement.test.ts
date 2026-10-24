import Ajv from 'ajv'
import retained from '../fixtures/character-chat-natural-disclosure-v356.json'
import {chatActionRequestOptionsV1} from '../../src/lib/character-interaction/action-output-contract'
import {expect, it} from 'vitest'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {createInitialInteractionState, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, interruptChatNarrativeTriggerV1, parseChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {applyChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {chatHasPendingTurnSettlementV1, chatSituationConstructionBlockedV1, chatSituationConstructionRequestV1} from '../../src/lib/character-interaction/narrative-progression'
import {compileChatActionWireV1} from '../../src/lib/character-interaction/action-wire'
import {chatInquiryContextForVersionV1, parseChatInquiryEvidenceVersionV1} from '../../src/lib/character-interaction/inquiry-evidence'
import {chatActionReviewFixture, chatNarrativeFixture} from '../helpers/chat-narrative-fixture'
import {chatInquiryReviewFixture} from '../helpers/chat-inquiry-output'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const questionText = '叶岑向掌柜问：“你最后一次见到铜印是什么时候？”'
const respondentText = '掌柜在柜台另一端，可以当面交谈。'
function question(): ChatNarrativeActionV1 {
  return {kind: 'speak', text: questionText, goalKey: 'find-seal', evidenceFactKeys: ['lost', 'clerk-present'], audienceKeys: ['guard', 'player'],
    waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {purpose: 'inquiry-result', threadKey: 'investigate', direction: '结算刚才已向掌柜提出的问题，保留其无法确认或拒答的可能。',
      evidenceFactKeys: ['lost', 'clerk-present'], evidenceExcerpt: questionText, respondentFactKey: 'clerk-present', respondentExcerpt: respondentText, respondentName: '掌柜'}}
}
function afterBackground() {
  const content = chatNarrativeFixture(), story = content.chatNarrative!
  Object.assign(story.permissions, {allowActorSituationExpansion: true, allowInquiryResults: true, maxActionsPerTrigger: 2})
  story.initialSituation.facts.push({factKey: 'clerk-present', text: respondentText, audienceKeys: ['guard', 'player', 'artisan'], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  const initial = createInitialInteractionState(content)
  initial.activeScene = {...initial.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  initial.remainingDirectorBudget = 100
  const trigger = requestChatNarrativeTriggerV1(initial, {sequence: 2, sourceEventSequence: 1, kind: 'scene-start', seed: null,
    direction: {actorKey: 'guard', actionLimit: 2, settleSituationVersion: 1}})
  const direction: ChatNarrativeActionV1 = {...question(), text: '我打算先向掌柜询问铜印的情况。',
    situationRequest: {threadKey: 'investigate', direction: '准备向已有在场掌柜询问铜印的方向，不预写问题或答复。', evidenceFactKeys: ['lost', 'clerk-present'], evidenceExcerpt: '我打算先向掌柜询问铜印的情况。'}}
  const planned = applyReviewedChatNarrativeActionV1(trigger, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'plan', action: direction, review: chatActionReviewFixture(direction)})
  const draft: ChatSituationDraftV1 = {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newFacts: [], newGoals: [], newThreads: [],
    possibilities: [{actorKey: 'guard', text: '向掌柜询问铜印最后出现的时间。', evidenceFactKeys: ['clerk-present', 'lost']}]}
  return applyChatSituationV1(planned, {sequence: 4, triggerSequence: 2, draft, review: {reviewedProposalJson: canonicalStringify(draft),
    checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: 'Engineering fixture; not a model score.'}))}})
}
function asked(action = question(), initial = afterBackground()) {
  return applyReviewedChatNarrativeActionV1(initial, {sequence: 5, triggerSequence: 2, actorKey: 'guard', messageId: 'question', action, review: chatActionReviewFixture(action)})
}
function answer(): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newFacts: [], newGoals: [], newThreads: [], possibilities: [],
    inquiryResult: {actorKey: 'guard', questionSequence: 5, questionExcerpt: questionText, respondentFactKey: 'clerk-present', respondentExcerpt: respondentText,
      respondentName: '掌柜', statementFactKey: 'clerk-time', answerKind: 'uncertain', answerText: '我记得傍晚还看见过，具体时间没留意。',
      audienceKeys: ['guard', 'player'], evidenceFactKeys: ['lost', 'clerk-present'], discoveries: []}}
}
function settle(state = asked(), draft = answer(), ...version: unknown[]) {
  return applyChatSituationV1(state, {sequence: 6, triggerSequence: 2, draft, inquiryEvidenceVersion: version.length ? version[0] : 5,
    review: {reviewedProposalJson: canonicalStringify(draft), ...chatInquiryReviewFixture(draft)}})
}

it('reproduces the exhausted-turn inquiry delay without reinterpreting the old request', () => {
  const q = question(), {respondentFactKey: _fact, respondentName: _name, respondentExcerpt: _excerpt, purpose: _purpose, ...legacy} = q.situationRequest! as Extract<NonNullable<ChatNarrativeActionV1['situationRequest']>, {purpose: 'inquiry-result'}>
  q.situationRequest = legacy
  const before = afterBackground(), old = asked(q, before)
  expect(old.chatNarrative!.triggers.at(-1)).toMatchObject({status: 'complete', actionSequences: [3, 5]})
  expect(chatSituationConstructionBlockedV1(old)).toBe(true)
  expect(chatHasPendingTurnSettlementV1(old)).toBe(false)
  expect(chatSituationConstructionRequestV1(old)).toBeNull()
  expect(old.chatNarrative!.pendingSituation).not.toHaveProperty('purpose')
  expect(before.messages).toHaveLength(1)
})

it('settles the final actual inquiry in the same turn without a third action, new direction or extra player input', () => {
  const before = asked(), original = structuredClone(before), context = chatInquiryContextForVersionV1(before, 5)!
  expect(before.chatNarrative!.triggers.at(-1)).toMatchObject({status: 'ready', actionSequences: [3, 5]})
  expect(chatHasPendingTurnSettlementV1(before)).toBe(true)
  expect(context).toMatchObject({version: 5, questions: [{questionSequence: 5, respondentEvidenceFactKeys: ['clerk-present']}]})
  expect(chatInquiryContextForVersionV1(before, 4)).toBeNull()
  const after = settle(before)
  expect(after.chatNarrative!.triggers.at(-1)).toMatchObject({status: 'complete', actionSequences: [3, 5]})
  expect(after.chatNarrative!.pendingSituation).toBeUndefined()
  expect(after.messages).toEqual(before.messages)
  expect(after.chatNarrative!.situation.goals).toEqual(before.chatNarrative!.situation.goals)
  expect(after.chatNarrative!.situation.possibilities).toEqual(before.chatNarrative!.situation.possibilities)
  expect(after.chatNarrative!.situation.facts).toHaveLength(before.chatNarrative!.situation.facts.length + 1)
  expect(after.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual([])
  expect(after.remainingDirectorBudget).toBe(before.remainingDirectorBudget - 2)
  expect(chatSituationConstructionRequestV1(after)).toBeNull()
  expect(() => settle(after)).toThrow()
  expect(before).toEqual(original)
})

it.each(['ungranted', 'unseen person', 'new person', 'uncited person', 'wrong excerpt', 'player', 'main actor', 'unspoken question', 'waiting-player'] as const)('rejects an invalid completed inquiry (%s) atomically', variant => {
  const state = afterBackground(), candidate = question(), pending = candidate.situationRequest! as Extract<NonNullable<ChatNarrativeActionV1['situationRequest']>, {purpose: 'inquiry-result'}>
  if (variant === 'ungranted') state.chatNarrative!.permissions.allowInquiryResults = false
  if (variant === 'unseen person') state.chatNarrative!.situation.facts.find(f => f.factKey === 'clerk-present')!.audienceKeys = ['artisan']
  if (variant === 'new person') state.chatNarrative!.situation.facts.find(f => f.factKey === 'clerk-present')!.sourceEventSequence = 5
  if (variant === 'uncited person') pending.evidenceFactKeys = ['lost']
  if (variant === 'wrong excerpt') pending.respondentExcerpt = '掌柜已经同意回答所有问题。'
  if (variant === 'player' || variant === 'main actor') {
    const name = variant === 'player' ? state.chatNarrative!.persona.name : state.profiles[1].name
    pending.respondentName = name; pending.respondentExcerpt = `${name}在柜台旁。`
    state.chatNarrative!.situation.facts.find(f => f.factKey === 'clerk-present')!.text = pending.respondentExcerpt
  }
  if (variant === 'unspoken question') pending.evidenceExcerpt = '另一个从未问出的问题。'
  if (variant === 'waiting-player') candidate.waitingForPlayer = true
  const before = structuredClone(state)
  expect(() => asked(candidate, state)).toThrow()
  expect(state).toEqual(before)
})

it.each(['wrong question', 'wrong respondent', 'another question excerpt', 'extra direction', 'extra discovery'] as const)('does not use settlement to authorize %s', variant => {
  const state = asked(), before = structuredClone(state), draft = answer()
  if (variant === 'wrong question') draft.inquiryResult!.questionSequence = 3
  if (variant === 'wrong respondent') draft.inquiryResult!.respondentName = '另一名掌柜'
  if (variant === 'another question excerpt') draft.inquiryResult!.questionExcerpt = '铜印'
  if (variant === 'extra direction') draft.possibilities = [{actorKey: 'guard', text: '现在离开驿站。', evidenceFactKeys: ['road']}]
  if (variant === 'extra discovery') draft.inquiryResult!.discoveries = [{factKey: 'secret', answerExcerpt: '傍晚', reason: 'An ungranted inference.'}]
  expect(() => settle(state, draft)).toThrow()
  expect(state).toEqual(before)
})

it('does not accept generic background in place of a required answer or a rejected semantic review', () => {
  const state = asked(), draft = answer(), before = structuredClone(state)
  const other = {...draft}; delete other.inquiryResult; other.possibilities = [{actorKey: 'guard', text: '继续等候。', evidenceFactKeys: ['lost']}]
  expect(() => applyChatSituationV1(state, {sequence: 6, triggerSequence: 2, draft: other, review: {reviewedProposalJson: canonicalStringify(other), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: 'fixture'}))}})).toThrow('只能提供同一实际问题')
  const review = {reviewedProposalJson: canonicalStringify(draft), ...chatInquiryReviewFixture(draft)}
  review.inquiryReview.checks.find(c => c.check === 'meaningful-result')!.passed = false
  expect(() => applyChatSituationV1(state, {sequence: 6, triggerSequence: 2, draft, inquiryEvidenceVersion: 5, review})).toThrow()
  expect(state).toEqual(before)
})

it('preserves the pending record on readback while explicit interruption cancels only the unanswered result', () => {
  const state = asked()
  expect(parseInteractionState(structuredClone(state))).toEqual(state)
  const forged = structuredClone(state); forged.messages.find(m => m.messageId === 'question')!.text = '没有实际问话。'
  expect(() => parseInteractionState(forged)).toThrow('问题原文')
  const before = structuredClone(state.messages)
  interruptChatNarrativeTriggerV1(state, 6, true)
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
  expect(state.messages).toEqual(before)
  expect(chatSituationConstructionRequestV1(state)).toBeNull()
})

it('keeps old output and inquiry-result contracts unable to interpret the new marker', () => {
  for (const producer of [undefined, 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-options-v41', 'chat-action-revision-v24']) {
    expect(() => compileChatActionWireV1(question(), producer)).toThrow('旧输出合同')
  }
  for (const version of [undefined, 1, 2, 3, 4]) expect(() => settle(asked(), answer(), version)).toThrow()
  expect(() => parseChatInquiryEvidenceVersionV1(6)).toThrow('版本无效')
  const malformed = {...question(), situationRequest: {...question().situationRequest, respondentFactKey: 'not a stable key'}}
  expect(() => parseChatNarrativeActionV1(malformed)).toThrow()
})

it.each([['chat-narrative-action-v70', 'chat-narrative-action-v69'], ['chat-narrative-options-v42', 'chat-narrative-options-v41'], ['chat-action-revision-v25', 'chat-action-revision-v24']])('limits completed inquiries to the new %s transport', (current, old) => {
  const action: Record<string, unknown> = {...structuredClone(retained.response.action), expressionMode: 'speech', text: questionText,
    disclosures: [], newFacts: [], goalStatus: null, threadUpdates: [], situationRequest: question().situationRequest}
  if (!current.startsWith('chat-narrative-action-')) delete action.turnCompletion
  const value = current.startsWith('chat-narrative-action-') ? {outcome: 'action', action, handoff: null}
    : current.startsWith('chat-narrative-options-') ? {options: [action, structuredClone(action)]} : action
  for (const provider of ['codex', 'agnes'] as const) {
    expect(new Ajv().compile(chatActionRequestOptionsV1(current, provider)!.jsonSchema!.schema)(value)).toBe(true)
    expect(new Ajv().compile(chatActionRequestOptionsV1(old, provider)!.jsonSchema!.schema)(value)).toBe(false)
  }
})
