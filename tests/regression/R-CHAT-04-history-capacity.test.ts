import {expect, it} from 'vitest'
import {CHAT_HISTORY_CAPACITY_V1, assertChatHistoryCapacityV1} from '../../src/lib/character-interaction/history-capacity'
import {createInitialInteractionState, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {chatHistorySelectionFixture} from '../helpers/chat-history-selection'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'

it('separates runtime history from initial authoring and unfinished limits without rewriting old state', () => {
  const old = createInitialInteractionState(chatNarrativeFixture())
  expect(parseInteractionState(old)).toEqual(old)
  const state = chatHistorySelectionFixture(220), story = state.chatNarrative!
  const closed = story.situation.goals.find(g => g.status === 'fulfilled')!
  while (story.situation.goals.length < 40) story.situation.goals.push({...closed, goalKey: `history-goal-${story.situation.goals.length}`})
  const thread = story.situation.threads.find(t => t.status === 'resolved')!
  while (story.situation.threads.length < 70) story.situation.threads.push({...thread, threadKey: `history-thread-${story.situation.threads.length}`})
  expect(parseInteractionState(state)).toEqual(state)
  const rebased = rebaseInteractionStateForBranch(state, 501)
  expect(parseInteractionState(rebased)).toEqual(rebased)
  expect(rebased.chatNarrative!.situation.facts).toHaveLength(224)
  const active = structuredClone(state)
  active.chatNarrative!.situation.goals.forEach(g => {g.status = 'paused'})
  expect(() => parseInteractionState(active)).toThrow('未完成或暂停目标')
  const frozen = chatNarrativeFixture()
  while (frozen.chatNarrative!.initialSituation.facts.length < 201) frozen.chatNarrative!.initialSituation.facts.push({...frozen.chatNarrative!.initialSituation.facts[0], factKey: `initial-${frozen.chatNarrative!.initialSituation.facts.length}`})
  expect(() => createInitialInteractionState(frozen)).toThrow('情境事实')
})
it('refuses a single excess history row atomically and retains the full bounded state', () => {
  const state = chatHistorySelectionFixture(200), facts = state.chatNarrative!.situation.facts
  while (facts.length < CHAT_HISTORY_CAPACITY_V1.facts) facts.push({...facts[4], factKey: `capacity-${facts.length}`})
  expect(parseInteractionState(state)).toEqual(state)
  facts.push({...facts[4], factKey: 'excess'})
  const before = JSON.stringify(state)
  expect(() => parseInteractionState(state)).toThrow('情境事实')
  expect(JSON.stringify(state)).toBe(before)
})
it('enforces aggregate text and commitment bounds independently of per-row counts', () => {
  const state = chatHistorySelectionFixture(), situation = state.chatNarrative!.situation
  const large = {...situation, facts: Array.from({length: 1100}, (_, i) => ({...situation.facts[4], factKey: `large-${i}`, text: '字'.repeat(7900)}))}
  expect(() => assertChatHistoryCapacityV1(large)).toThrow('完整故事历史已达存储容量')
  const countOnly = {...situation, goals: situation.goals.map(g => ({...g}))}
  // Aggregate admission is independent from per-record source validation.
  countOnly.goals[0].commitments = Array(CHAT_HISTORY_CAPACITY_V1.totalCommitments + 1).fill(null)
  expect(() => assertChatHistoryCapacityV1(countOnly)).toThrow('完整故事历史已达存储容量')
  expect(situation.goals[0].commitments).toBeUndefined()
})
