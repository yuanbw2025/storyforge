import {expect, it} from 'vitest'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import type {ChatNarrativeActionV1, ChatNarrativeActionReviewV1} from '../../src/lib/types/chat-narrative'
import {createInitialInteractionState, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, parseChatNarrativeActionReviewV1, previewChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {assertChatCommitmentReviewVersionV1} from '../../src/lib/character-interaction/narrative-commitments'
import {bindChatNarrativeOptionsReviewV1, selectedChatNarrativeOptionV1} from '../../src/lib/character-interaction/narrative-options'
import {chatActionReviewOutputFixture, chatNarrativeFixture} from '../helpers/chat-narrative-fixture'

const terms = '我答应检查后门后把结果告诉你，你不必跟过来。'
function state() {
  const s = createInitialInteractionState(chatNarrativeFixture())
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  s.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(s, {sequence: 2, sourceEventSequence: 1, kind: 'scene-start', seed: null})
}
const promise = (): ChatNarrativeActionV1 => ({kind: 'speak', text: terms, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null, commitmentEffects: [{kind: 'promise', terms, evidenceExcerpt: terms}]})
const output = (a = promise(), passed = true) => ({...chatActionReviewOutputFixture(),
  commitmentChecks: (a.commitmentEffects ?? []).map((_, effectIndex) => ({effectIndex, passed, reason: '工程审查夹具；含义正确性仍需真实独立模型验收。'}))})
const review = (a = promise(), passed = true): ChatNarrativeActionReviewV1 => ({...output(a, passed), reviewedActionJson: canonicalStringify(a)})
function apply(s = state(), a = promise(), r = review(a)) {
  return applyReviewedChatNarrativeActionV1(s, {sequence: s.chatNarrative!.lastEventSequence + 1, triggerSequence: s.chatNarrative!.triggers.at(-1)!.requestedSequence,
    actorKey: 'guard', messageId: `commitment:${s.chatNarrative!.lastEventSequence + 1}`, action: a, review: r})
}
function next(s: ReturnType<typeof state>) {
  return requestChatNarrativeTriggerV1(s, {sequence: s.chatNarrative!.lastEventSequence + 1, sourceEventSequence: s.chatNarrative!.lastEventSequence, kind: 'continue', seed: null})
}

it('previews without mutation and commits expression and exact promise evidence in one reviewed action', () => {
  const s = state(), before = structuredClone(s), a = promise()
  const preview = previewChatNarrativeActionV1(s, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'commitment:3', action: a})
  expect(s).toEqual(before)
  expect(parseInteractionState(preview)).toEqual(preview)
  const after = apply(s)
  expect(after.chatNarrative!.situation.goals[0].commitments).toEqual([{commitmentKey: 'commitment:3:promise', terms, audienceKeys: ['guard', 'player'],
    declared: {messageId: 'commitment:3', sequence: 3, excerpt: terms}, resolution: null}])
  expect(after.messages[0].text).toBe(terms)
  expect(after.remainingDirectorBudget).toBe(98)
  expect(s).toEqual(before)
})

it.each(['missing', 'wrong-index', 'duplicate', 'missing-reason', 'wrong-binding', 'rejected', 'extra-field', 'null'] as const)('rejects %s per-effect review without committing expression or consequence', kind => {
  const s = state(), before = structuredClone(s), r = review()
  if (kind === 'missing') delete r.commitmentChecks
  if (kind === 'wrong-index') r.commitmentChecks![0].effectIndex = 1
  if (kind === 'duplicate') r.commitmentChecks!.push(r.commitmentChecks![0])
  if (kind === 'missing-reason') r.commitmentChecks![0].reason = ''
  if (kind === 'wrong-binding') r.reviewedActionJson = canonicalStringify({...promise(), text: 'another'})
  if (kind === 'rejected') r.commitmentChecks![0].passed = false
  if (kind === 'extra-field') Object.assign(r.commitmentChecks![0], {approved: true})
  if (kind === 'null') Object.assign(r, {commitmentChecks: null})
  expect(() => apply(s, promise(), r)).toThrow()
  expect(s).toEqual(before)
})

it('makes a completed act resolve a promise, while a goal cannot discard its unresolved obligation', () => {
  const s = next(apply()), before = structuredClone(s), text = '叶岑检查后门，回来说：“门闩完好，没有撬动痕迹。”'
  const a: ChatNarrativeActionV1 = {...promise(), kind: 'complete', text, goalStatus: 'abandoned', nextPossibilities: [],
    commitmentEffects: [{kind: 'fulfill', commitmentKey: 'commitment:3:promise', evidenceExcerpt: text}]}
  const missing = {...a, commitmentEffects: []}
  expect(() => apply(s, missing)).toThrow('目标结束前')
  const done = apply(s, a)
  expect(done.chatNarrative!.situation.goals[0]).toMatchObject({status: 'abandoned', commitments: [{resolution: {kind: 'fulfilled', sequence: 5}}]})
  expect(parseInteractionState(done)).toEqual(done)
  expect(s).toEqual(before)
  const branch = rebaseInteractionStateForBranch(done, 5)
  expect(branch.chatNarrative!.situation.goals[0].commitments![0]).toMatchObject({declared: {sequence: -3}, resolution: {sequence: -1}})
})

it('requires review for both withdrawal and replacement and never silently alters terms', () => {
  const s = next(apply()), replacement = '我改为天亮后报告，这个新安排只约束我自己。', withdrawal = '我撤回检查后门后向你报告的约定。'
  const a: ChatNarrativeActionV1 = {...promise(), text: `${withdrawal}${replacement}`, commitmentEffects: [
    {kind: 'withdraw', commitmentKey: 'commitment:3:promise', evidenceExcerpt: withdrawal},
    {kind: 'promise', terms: replacement, evidenceExcerpt: replacement},
  ]}
  const partial = review(a); partial.commitmentChecks!.pop()
  expect(() => apply(s, a, partial)).toThrow('不完整')
  const after = apply(s, a)
  expect(after.chatNarrative!.situation.goals[0].commitments).toMatchObject([{terms, resolution: {kind: 'withdrawn'}}, {terms: replacement, resolution: null}])
  expect(after.chatNarrative!.persona).toEqual(s.chatNarrative!.persona)
  expect(after.relationshipHistory).toEqual(s.relationshipHistory)
})

it('binds alternatives separately and only the selected promise takes effect', () => {
  const s = state(), first = promise(), second = {...promise(), text: terms + '现在我先收好地图。'}
  const options = [first, second], r = bindChatNarrativeOptionsReviewV1({options: [
    {optionKey: 'option-1', ...output(first, false)}, {optionKey: 'option-2', ...output(second)},
  ]}, options)
  expect(() => selectedChatNarrativeOptionV1(options, r, 'option-1')).toThrow('未通过')
  const selected = selectedChatNarrativeOptionV1(options, r, 'option-2')
  const after = apply(s, selected.action, selected.review)
  expect(after.messages).toHaveLength(1)
  expect(after.messages[0].text).toBe(second.text)
  expect(after.chatNarrative!.situation.goals[0].commitments).toHaveLength(1)
  expect(s.messages).toEqual([])
})

it('preserves old canonical action/review bytes and rejects commitment data under old review contracts', () => {
  const a = promise(); delete a.commitmentEffects
  const r = {...chatActionReviewOutputFixture(), reviewedActionJson: canonicalStringify(a)}
  expect(JSON.stringify(parseChatNarrativeActionReviewV1(r, a))).toBe(JSON.stringify(r))
  expect(() => assertChatCommitmentReviewVersionV1([a], 'chat-narrative-action-review-v18')).not.toThrow()
  for (const old of [undefined, 'chat-narrative-action-review-v18', 'chat-narrative-options-review-v12']) {
    expect(() => assertChatCommitmentReviewVersionV1([promise()], old)).toThrow('旧审查合同')
    expect(() => assertChatCommitmentReviewVersionV1([{...a, commitmentEffects: []}], old)).toThrow('旧审查合同')
  }
  expect(() => assertChatCommitmentReviewVersionV1([promise()], 'chat-narrative-action-review-v19')).not.toThrow()
})
