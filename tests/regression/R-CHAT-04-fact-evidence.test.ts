import {expect, it} from 'vitest'
import {chatNarrativeFixture, chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import {createInitialInteractionState, interactionVisibilityView, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import type {ChatNarrativeStateV1} from '../../src/lib/types/chat-narrative'

import {chatFactEvidenceAction as action} from '../helpers/chat-fact-evidence'

function ready() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(state, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null})
}
const input = () => ({sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'record', action, review: chatActionReviewFixture(action)})
const accepted = () => applyReviewedChatNarrativeActionV1(ready(), {...input(), factEvidenceVersion: 1})

it('binds types and earlier same-event dependencies without duplicating facts, leaking private metadata or upgrading old events', () => {
  const original = ready(), legacy = applyReviewedChatNarrativeActionV1(original, input()), current = accepted()
  expect(original.chatNarrative!.factEvidence).toBeUndefined()
  expect(legacy.chatNarrative!.factEvidence).toBeUndefined()
  expect(current.chatNarrative!.situation).toEqual(legacy.chatNarrative!.situation)
  expect(current.chatNarrative!.factEvidence).toEqual({version: 1, records: [
    {factKey: 'record-card', kind: 'object', evidenceFactKeys: ['lost'], actorKey: 'guard', goalKey: 'find-seal', source: 'action'},
    {factKey: 'card-corner', kind: 'observation', evidenceFactKeys: ['record-card'], actorKey: 'guard', goalKey: 'find-seal', source: 'action'},
  ]})
  for (const viewer of ['player', 'guard', 'artisan']) expect(interactionVisibilityView(current, viewer).chatNarrative).not.toHaveProperty('factEvidence')
  expect(JSON.stringify(interactionVisibilityView(current, 'artisan'))).not.toContain('record-card')
  const branched = rebaseInteractionStateForBranch(current, 3), nested = rebaseInteractionStateForBranch(branched, 0)
  expect(nested.chatNarrative!.factEvidence).toEqual(current.chatNarrative!.factEvidence)
  expect(nested.chatNarrative!.situation.facts.at(-1)!.sourceEventSequence).toBeLessThan(0)
  expect(parseInteractionState(JSON.parse(JSON.stringify(nested)))).toEqual(nested)
  expect(() => applyChatNarrativeActionV1(original, {...input(), factEvidenceVersion: 1})).toThrow('旧行动事件')
})

it('fails malformed commit versions and negative reviews atomically, including an action without facts', () => {
  const original = ready(), before = structuredClone(original)
  for (const version of [null, 0, 2, '1', {}]) expect(() => applyReviewedChatNarrativeActionV1(original, {...input(), factEvidenceVersion: version})).toThrow('事实来源')
  const review = chatActionReviewFixture(action); review.checks[0].passed = false
  expect(() => applyReviewedChatNarrativeActionV1(original, {...input(), factEvidenceVersion: 1, review})).toThrow()
  const empty = {...action, kind: 'speak' as const, newFacts: []}
  expect(() => applyReviewedChatNarrativeActionV1(original, {...input(), action: empty, review: chatActionReviewFixture(empty), factEvidenceVersion: 2})).toThrow('事实来源')
  expect(original).toEqual(before)
})

const defects: Array<[string, (story: ChatNarrativeStateV1) => void]> = [
  ['unknown version', s => {s.factEvidence!.version = 2 as 1}],
  ['extra field', s => {Object.assign(s.factEvidence!, {unexpected: true})}],
  ['extra record field', s => {Object.assign(s.factEvidence!.records[0], {text: 'duplicate text'})}],
  ['missing target', s => {s.factEvidence!.records[0].factKey = 'missing'}],
  ['initial target', s => {s.factEvidence!.records[0].factKey = 'lost'}],
  ['duplicate target', s => {s.factEvidence!.records[1].factKey = 'record-card'}],
  ['unauthorized kind', s => {s.factEvidence!.records[0].kind = 'place'}],
  ['wrong path', s => {s.factEvidence!.records[0].source = 'situation'}],
  ['foreign actor', s => {s.factEvidence!.records[0].actorKey = 'outsider'}],
  ['missing actor', s => {s.factEvidence!.records[0].actorKey = null}],
  ['foreign goal', s => {s.factEvidence!.records[0].goalKey = 'fix-road'}],
  ['unknown evidence', s => {s.factEvidence!.records[0].evidenceFactKeys = ['missing']}],
  ['duplicate evidence', s => {s.factEvidence!.records[0].evidenceFactKeys = ['lost', 'lost']}],
  ['self evidence', s => {s.factEvidence!.records[0].evidenceFactKeys = ['record-card']}],
  ['future same-event cycle', s => {s.factEvidence!.records[0].evidenceFactKeys = ['card-corner']}],
  ['future event', s => {s.situation.facts.at(-2)!.sourceEventSequence = 4}],
  ['secret evidence', s => {s.factEvidence!.records[0].evidenceFactKeys = ['secret']}],
]
it.each(defects)('rejects corrupt restored provenance: %s', (_name, mutate) => {
  const state = accepted(); mutate(state.chatNarrative!); expect(() => parseInteractionState(state)).toThrow()
})
it('does not permit runtime metadata in frozen initial content', () => {
  const f = chatNarrativeFixture(); Object.assign(f.chatNarrative!, {factEvidence: accepted().chatNarrative!.factEvidence})
  expect(() => createInitialInteractionState(f)).toThrow()
})
