import {expect, it} from 'vitest'
import {chatNarrativeFixture, chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import {chatResolutionActionFixture} from '../helpers/chat-resolution-evidence'
import {createInitialInteractionState, interactionVisibilityView, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import type {CharacterInteractionRuntimeState} from '../../src/lib/types'

function ready() {
  const f = chatNarrativeFixture(), story = f.chatNarrative!
  story.initialSituation.goals.push({...story.initialSituation.goals[0], goalKey: 'clarify', desire: '说明已核实的寻找结果'})
  story.initialSituation.facts.push({factKey: 'no-registration', text: '借用登记中没有记录铜印的去向。', audienceKeys: ['guard', 'artisan', 'player'], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  const state = createInitialInteractionState(f)
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(state, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null})
}
function input(action = chatResolutionActionFixture()) {
  return {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'closure', action, review: chatActionReviewFixture(action)}
}
const apply = (version: unknown = 1, action = chatResolutionActionFixture(), state = ready()) => applyReviewedChatNarrativeActionV1(state, {...input(action), resolutionEvidenceVersion: version})

it('retains distinct per-effect references, source ranges and terminal identities without duplicating prose or changing old event output', () => {
  const action = chatResolutionActionFixture(), alternate = structuredClone(action)
  alternate.goalUpdates![0].evidenceFactKeys = ['lost']; alternate.goalUpdates![0].evidenceExcerpt = '寻找先到这里，不再继续。'
  alternate.threadUpdates[0].evidenceExcerpt = action.text
  const legacy = applyReviewedChatNarrativeActionV1(ready(), input(action)), otherLegacy = applyReviewedChatNarrativeActionV1(ready(), input(alternate))
  expect(legacy).toEqual(otherLegacy); expect(legacy.chatNarrative!.resolutionEvidence).toBeUndefined()
  const current = apply(1, action), other = apply(1, alternate), records = current.chatNarrative!.resolutionEvidence!
  expect(current).not.toEqual(other)
  expect(current.chatNarrative!.situation).toEqual(legacy.chatNarrative!.situation)
  expect(current.messages).toEqual(legacy.messages)
  expect(records.goals.map(r => [r.targetKey, r.evidenceFactKeys])).toEqual([['clarify', ['lost', 'no-registration']], ['find-seal', ['no-registration']]])
  expect(records.threads[0].targetKey).toBe('investigate')
  expect(action.text.slice(records.goals[1].source.start, records.goals[1].source.end)).toBe(action.goalUpdates![0].evidenceExcerpt)
  expect(action.text.slice(records.threads[0].source.start, records.threads[0].source.end)).toBe(action.threadUpdates[0].evidenceExcerpt)
  expect(records.goals[0].source).toEqual({messageId: 'closure', start: 0, end: action.text.length})
  expect(JSON.stringify(records)).not.toContain('借用登记')
  for (const viewer of ['guard', 'artisan', 'player']) expect(interactionVisibilityView(current, viewer).chatNarrative).not.toHaveProperty('resolutionEvidence')
  const nested = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(current, 3), 0)
  expect(nested.chatNarrative!.resolutionEvidence).toEqual(records)
  expect(nested.messages.at(-1)!.eventSequence).toBe(nested.chatNarrative!.situation.goals[0].updatedSequence)
  expect(nested.messages.at(-1)!.eventSequence).toBeLessThan(0)
  expect(parseInteractionState(nested)).toEqual(nested)
})

it('records only terminal transitions and refuses malformed versions and unreviewed events without partial state changes', () => {
  const state = ready(), before = structuredClone(state), action = chatResolutionActionFixture()
  for (const version of [null, 0, 2, '1', {}]) expect(() => apply(version, action, state)).toThrow('收束依据')
  expect(() => applyChatNarrativeActionV1(state, {...input(action), resolutionEvidenceVersion: 1})).toThrow('旧行动事件')
  const review = chatActionReviewFixture(action); review.checks[0].passed = false
  expect(() => applyReviewedChatNarrativeActionV1(state, {...input(action), review, resolutionEvidenceVersion: 1})).toThrow()
  const paused = {...action, goalStatus: 'paused' as const, goalUpdates: [], threadUpdates: []}
  expect(apply(1, paused, state).chatNarrative!.resolutionEvidence).toBeUndefined()
  expect(state).toEqual(before)
})

const defects: Array<[string, (state: CharacterInteractionRuntimeState) => void]> = [
  ['version', s => {s.chatNarrative!.resolutionEvidence!.version = 2 as 1}],
  ['extra field', s => {Object.assign(s.chatNarrative!.resolutionEvidence!, {unknown: 1})}],
  ['empty', s => {s.chatNarrative!.resolutionEvidence = {version: 1, goals: [], threads: []}}],
  ['duplicate target', s => {s.chatNarrative!.resolutionEvidence!.goals[1].targetKey = 'clarify'}],
  ['missing target', s => {s.chatNarrative!.resolutionEvidence!.goals[1].targetKey = 'missing'}],
  ['active target', s => {s.chatNarrative!.situation.goals[0].status = 'active'}],
  ['initial target', s => {s.chatNarrative!.situation.goals[0].updatedSequence = 0}],
  ['foreign actor', s => {s.chatNarrative!.resolutionEvidence!.goals[1].actorKey = 'artisan'}],
  ['missing fact', s => {s.chatNarrative!.resolutionEvidence!.goals[1].evidenceFactKeys = ['missing']}],
  ['secret fact', s => {s.chatNarrative!.resolutionEvidence!.goals[1].evidenceFactKeys = ['secret']}],
  ['duplicate fact', s => {s.chatNarrative!.resolutionEvidence!.goals[1].evidenceFactKeys = ['lost', 'lost']}],
  ['future fact', s => {s.chatNarrative!.situation.facts.at(-1)!.sourceEventSequence = 4}],
  ['missing expression', s => {s.chatNarrative!.resolutionEvidence!.goals[1].source.messageId = 'missing'}],
  ['wrong event', s => {s.chatNarrative!.situation.goals[0].updatedSequence = 2}],
  ['wrong speaker', s => {s.messages.at(-1)!.speakerKey = 'artisan'}],
  ['shortened expression', s => {s.messages.at(-1)!.text = '说明。'}],
  ['wrong audience', s => {s.messages.at(-1)!.audienceKeys = ['guard', 'player']}],
  ['negative range', s => {s.chatNarrative!.resolutionEvidence!.goals[1].source.start = -1}],
  ['empty range', s => {s.chatNarrative!.resolutionEvidence!.goals[1].source.end = s.chatNarrative!.resolutionEvidence!.goals[1].source.start}],
  ['outside range', s => {s.chatNarrative!.resolutionEvidence!.goals[1].source.end = 2000}],
  ['fractional range', s => {s.chatNarrative!.resolutionEvidence!.goals[1].source.start = 0.5}],
]
it.each(defects)('rejects corrupt resolution provenance: %s', (_name, mutate) => {
  const state = apply(); mutate(state); expect(() => parseInteractionState(state)).toThrow()
})
it('keeps source binding when future retrieval excludes the expression, and rejects runtime metadata in initial content', () => {
  const state = apply(); state.chatNarrative!.excludedMessageIds = ['closure']
  expect(parseInteractionState(state)).toEqual(state)
  const f = chatNarrativeFixture(); Object.assign(f.chatNarrative!, {resolutionEvidence: state.chatNarrative!.resolutionEvidence})
  expect(() => createInitialInteractionState(f)).toThrow()
})
