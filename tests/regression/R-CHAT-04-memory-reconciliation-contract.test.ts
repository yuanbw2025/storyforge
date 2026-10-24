import {expect, it} from 'vitest'
import {createInitialInteractionState, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, parseChatNarrativeActionReviewV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {bindChatNarrativeOptionsReviewV1, selectedChatNarrativeOptionV1} from '../../src/lib/character-interaction/narrative-options'
import {assertChatMemoryReconciliationReviewVersionV1, pendingChatMemoryCorrectionsV1, parseChatMemoryReconciliationChecksV1} from '../../src/lib/character-interaction/memory-reconciliation'
import {chatActionReviewFixture, chatNarrativeFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1, ChatNarrativeActionReviewV1} from '../../src/lib/types/chat-narrative'

function prepared() {
  const s = createInitialInteractionState(chatNarrativeFixture())
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  s.remainingDirectorBudget = 100
  s.messages.push({messageId: 'source', eventSequence: 1, role: 'player', speakerKey: 'player', text: '我只是暂借地图，没有答应帮忙寻找铜印。',
    audienceKeys: ['guard', 'player'], replyToSequence: null, supersededBySequence: null})
  s.memories.push({memoryId: 'corrected', participantKey: 'guard', kind: 'key-memory', content: '玩家只是暂借地图，没有答应帮忙。', importance: 1,
    sourceEventSequences: [1], evidenceExcerpt: '没有答应帮忙', status: 'accepted', proposalSequence: 2, decisionSequence: 2, supersededByMemoryId: null, authorship: 'player-correction'})
  s.chatNarrative!.revision = 1; s.chatNarrative!.lastEventSequence = 2
  return requestChatNarrativeTriggerV1(parseInteractionState(s)!, {sequence: 3, kind: 'scene-start', sourceEventSequence: 1, seed: null})
}
const action = (): ChatNarrativeActionV1 => ({kind: 'speak', text: '我自己去看看门口。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'],
  waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
const check = () => ({memoryId: 'corrected', sourceSequence: 2, passed: true, reason: '注入的工程检查，不是真实模型判定。'})
const review = (a = action()): ChatNarrativeActionReviewV1 => ({...chatActionReviewFixture(a), memoryChecks: [check()]})
const apply = (s = prepared(), r = review(), a = action()) => applyReviewedChatNarrativeActionV1(s, {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'acted', action: a, review: r})

it('keeps old state bytes and old reviewed actions unchanged, with no implicit acknowledgment', () => {
  const old = createInitialInteractionState(chatNarrativeFixture())
  expect(JSON.stringify(parseInteractionState(old))).toBe(JSON.stringify(old))
  const result = apply(prepared(), chatActionReviewFixture(action()))
  expect(result.chatNarrative).not.toHaveProperty('memoryReconciliations')
  expect(pendingChatMemoryCorrectionsV1(result, 'guard').map(m => m.memoryId)).toEqual(['corrected'])
})

it('acknowledges exactly the owner correction atomically with a reviewed message without retconning story state', () => {
  const before = prepared(), copy = structuredClone(before), result = apply(before)
  expect(result.chatNarrative!.memoryReconciliations).toEqual([{memoryId: 'corrected', sourceSequence: 2, actorKey: 'guard', messageId: 'acted', sequence: 4}])
  expect(result.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(result.memories).toEqual(before.memories)
  expect(result.relationships).toEqual(before.relationships)
  expect(result.relationshipHistory).toEqual(before.relationshipHistory)
  expect(result.messages).toHaveLength(2)
  expect(result.remainingDirectorBudget).toBe(before.remainingDirectorBudget - 2)
  expect(parseInteractionState(JSON.parse(JSON.stringify(result)))).toEqual(result)
  expect(pendingChatMemoryCorrectionsV1(result, 'guard')).toEqual([])
  expect(before).toEqual(copy)
})

it('only exposes active corrected memory to its own role, preserving disabled and superseded records', () => {
  const s = prepared()
  expect(pendingChatMemoryCorrectionsV1(s, 'artisan')).toEqual([])
  for (const status of ['disabled', 'revoked', 'superseded'] as const) {
    s.memories[0].status = status
    expect(pendingChatMemoryCorrectionsV1(s, 'guard')).toEqual([])
  }
  s.memories[0].status = 'accepted'; delete s.memories[0].authorship
  expect(pendingChatMemoryCorrectionsV1(s, 'guard')).toEqual([])
})

it.each([
  [], [{...check(), memoryId: 'other'}], [{...check(), sourceSequence: 1}], [check(), check()], [{...check(), passed: false}],
])('rejects missing, stale, foreign, duplicate or failed reconciliation coverage without writes (%j)', checks => {
  const s = prepared(), before = structuredClone(s)
  expect(() => apply(s, {...review(), memoryChecks: checks})).toThrow()
  expect(s).toEqual(before)
})

it.each([null, {}, [{...check(), sourceSequence: 0}], [{...check(), reason: ''}], [{...check(), passed: 'yes'}], [{...check(), extra: true}]])('rejects malformed new review data (%j)', checks => {
  expect(() => parseChatMemoryReconciliationChecksV1(checks)).toThrow('修正')
  expect(() => parseChatNarrativeActionReviewV1({...review(), memoryChecks: checks}, action())).toThrow()
})

it.each(['memory', 'actor', 'message', 'sequence', 'duplicate', 'initial'] as const)('rejects forged receipt sources or states: %s', kind => {
  const s = apply(), r = s.chatNarrative!.memoryReconciliations![0]
  if (kind === 'memory') r.memoryId = 'absent'
  if (kind === 'actor') r.actorKey = 'artisan'
  if (kind === 'message') s.messages[1].speakerKey = 'artisan'
  if (kind === 'sequence') r.sourceSequence = 1
  if (kind === 'duplicate') s.chatNarrative!.memoryReconciliations!.push({...r})
  if (kind === 'initial') {s.chatNarrative!.revision = 0; s.chatNarrative!.lastEventSequence = 0}
  expect(() => parseInteractionState(s)).toThrow()
})

it('rejects unavailable correction sources rather than acknowledging an empty or fabricated source', () => {
  const s = prepared(); s.messages[0].audienceKeys = ['player', 'artisan']
  expect(() => pendingChatMemoryCorrectionsV1(s, 'guard')).toThrow('共同可见')
})

it('retains stable correction identities through nested negative rebasing and later supersession', () => {
  const s = apply(), branch = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(s, 4), 1)
  expect(parseInteractionState(branch)).toEqual(branch)
  expect(branch.chatNarrative!.memoryReconciliations![0]).toMatchObject({memoryId: 'corrected', sourceSequence: -5, sequence: -3})
  expect(pendingChatMemoryCorrectionsV1(branch, 'guard')).toEqual([])
  branch.memories[0].status = 'superseded'; branch.memories[0].supersededByMemoryId = 'new-correction'
  branch.memories.push({...branch.memories[0], memoryId: 'new-correction', content: '再次根据原话修正。', status: 'accepted', proposalSequence: 2, decisionSequence: 2, supersededByMemoryId: null})
  expect(pendingChatMemoryCorrectionsV1(branch, 'guard').map(m => m.memoryId)).toEqual(['new-correction'])
  expect(parseInteractionState(branch)).toEqual(branch)
})

it('requires separate bound coverage for alternatives and only applies the selected reviewed action', () => {
  const first = action(), second = {...action(), text: '我先检查自己的行李。'}, actions = [first, second]
  const output = {options: actions.map((a, i) => ({optionKey: `option-${i + 1}`, checks: review(a).checks, memoryChecks: [check()]}))}
  const reviews = bindChatNarrativeOptionsReviewV1(output, actions)
  const selected = selectedChatNarrativeOptionV1(actions, reviews, 'option-2')
  const result = apply(prepared(), selected.review, selected.action)
  expect(result.messages[1].text).toBe(second.text)
  expect(result.chatNarrative!.memoryReconciliations).toHaveLength(1)
  output.options[0].memoryChecks[0].passed = false
  expect(() => selectedChatNarrativeOptionV1(actions, bindChatNarrativeOptionsReviewV1(output, actions), 'option-1')).toThrow('未通过')
})

it('rejects the new review field even when empty under an older frozen reviewer', () => {
  for (const version of [undefined, 'chat-narrative-action-review-v19', 'chat-narrative-options-review-v13']) {
    expect(() => assertChatMemoryReconciliationReviewVersionV1([review()], version)).toThrow('旧审查合同')
    expect(() => assertChatMemoryReconciliationReviewVersionV1([{...review(), memoryChecks: []}], version)).toThrow('旧审查合同')
  }
  expect(() => assertChatMemoryReconciliationReviewVersionV1([review()], 'chat-narrative-action-review-v20')).not.toThrow()
})
