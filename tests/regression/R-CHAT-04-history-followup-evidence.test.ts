import {expect, it} from 'vitest'
import actualFailure from '../fixtures/character-chat-history-followup.json'
import {sha256Text} from '../../src/lib/ai/chapter-memory/text-normalization'
import {buildInteractionContextWindow, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {chatActionContextVersionsV1} from '../../src/lib/character-interaction/context-selection'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {chatHistoryFollowupFixture} from '../helpers/chat-history-followup'

const view = (s: ReturnType<typeof chatHistoryFollowupFixture>, maxCharacters = 14_000) =>
  buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v13', maxCharacters})
const keys = (v: ReturnType<typeof view>) => v.chatNarrative!.facts.map(f => f.factKey)
const chain = ['observed-7', 'observed-18', 'observed-70']

it('retains later visible consequences with the selected old event, including nested branch identities', () => {
  const state = parseInteractionState(chatHistoryFollowupFixture())!, before = structuredClone(state)
  const legacy = buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v12', maxCharacters: 14_000})
  expect(keys(legacy)).toContain('observed-7'); expect(keys(legacy)).not.toContain('observed-70')
  const selected = view(state)
  for (const key of chain) expect(keys(selected)).toContain(key)
  expect(selected.historyContext!.omitted.facts).toBeGreaterThan(0)
  expect(formatInteractionRuntimeContextV1(state.profiles[0], selected)).toContain('角色现在双手空着')
  expect(state).toEqual(before)
  expect(buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v12', maxCharacters: 14_000})).toEqual(legacy)
  const nested = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(state, state.chatNarrative!.lastEventSequence), 0)
  const restored = parseInteractionState(JSON.parse(JSON.stringify(nested)))!
  for (const key of chain) expect(keys(view(restored))).toContain(key)
  expect(restored.chatNarrative!.situation.facts.find(f => f.factKey === 'observed-70')!.sourceEventSequence).toBeLessThan(0)
})

it('does not traverse private followups or expose their identifiers, counts or words', () => {
  const state = chatHistoryFollowupFixture()
  state.chatNarrative!.situation.facts.find(f => f.factKey === 'observed-70')!.audienceKeys = ['artisan']
  const selected = view(state)
  expect(keys(selected)).toContain('observed-7'); expect(keys(selected)).toContain('observed-18')
  expect(JSON.stringify(selected)).not.toMatch(/observed-70|角色现在双手空着/)
  const other = buildInteractionContextWindow(state, 'artisan', {retrievalVersion: 'chat-relevance-v13'})
  expect(keys(other)).toContain('observed-70')
  expect(JSON.stringify(other)).not.toMatch(/observed-7"|observed-18"|靛蓝地图背面/)
})

it('keeps the actor-delivered causal chain available to the independent reviewer', () => {
  const state = chatHistoryFollowupFixture(), selected = view(state)
  const text = selectChatCoordinatorContextV1(state, {retrievalVersion: 'chat-relevance-v13', actorKey: 'guard', text: '{"evidenceFactKeys":["observed-7"]}'})
  for (const key of chain) expect(text).toContain(`"factKey":"${key}"`)
  for (const fact of selected.chatNarrative!.facts) expect(text).toContain(fact.text)
  expect(estimateTokens(text)).toBeLessThanOrEqual(12_000)
})

it('omits an oversized optional causal component atomically and stops when the component is mandatory', () => {
  const state = chatHistoryFollowupFixture()
  state.chatNarrative!.situation.facts.find(f => f.factKey === 'observed-70')!.text = '后续有明确状态变化。'.repeat(700)
  const before = structuredClone(state), selected = view(state, 6500)
  for (const key of chain) expect(keys(selected)).not.toContain(key)
  expect(state).toEqual(before)
  state.chatNarrative!.situation.goals[0].evidenceFactKeys.push('observed-7')
  const required = structuredClone(state)
  expect(() => view(state, 6500)).toThrow('不会静默省略必要来源')
  expect(state).toEqual(required)
})

it.each([100, 300, 1000])('keeps unrelated histories optional at %s facts sharing an initial premise', count => {
  const state = parseInteractionState(chatHistoryFollowupFixture(count))!, selected = view(state)
  for (const key of chain) expect(keys(selected)).toContain(key)
  expect(keys(selected).length).toBeLessThan(50)
  expect(selected.historyContext!.omitted.facts).toBeGreaterThan(count - 50)
  const text = formatInteractionRuntimeContextV1(state.profiles[0], selected)
  expect(text.length).toBeLessThan(14_000); expect(estimateTokens(text)).toBeLessThan(8000)
})

it('binds new ordinary, options and revision runs to the new reader while preserving all old bindings', () => {
  for (const producer of ['chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-options-v35', 'chat-action-revision-v21'])
    expect(chatActionContextVersionsV1(producer)).toEqual({readerVersion: 'chat-narrative-runtime-view-v17', retrievalVersion: 'chat-relevance-v13'})
  expect(chatActionContextVersionsV1('chat-narrative-action-v55').readerVersion).toBe('chat-narrative-runtime-view-v16')
  for (const producer of ['chat-narrative-options-v34', 'chat-action-revision-v20'])
    expect(chatActionContextVersionsV1(producer).readerVersion).toBe('chat-narrative-runtime-view-v14')
})

it('reproduces the exact V295 omitted return, preserving historical input bytes while the new reader includes it', async () => {
  const state = parseInteractionState(actualFailure.state)!, actor = actualFailure.actorKey
  const profile = state.profiles.find(p => p.participantKey === actor)!
  const legacy = buildInteractionContextWindow(state, actor, {retrievalVersion: 'chat-relevance-v12'})
  expect(actualFailure.legacyReader).toBe('chat-narrative-runtime-view-v16')
  expect(await sha256Text(formatInteractionRuntimeContextV1(profile, legacy))).toBe(actualFailure.legacySourceHash)
  expect(keys(legacy)).toContain('observation.001'); expect(keys(legacy)).not.toContain('observation.004')
  const current = buildInteractionContextWindow(state, actor, {retrievalVersion: 'chat-relevance-v13'})
  expect(keys(current)).toContain('observation.001'); expect(keys(current)).toContain('observation.004')
  const text = formatInteractionRuntimeContextV1(profile, current)
  expect(text).toContain('叶岑将提灯放回柜台台面，没有打开或挪动木箱。')
  expect(estimateTokens(text)).toBeLessThan(8000)
  expect(state).toEqual(actualFailure.state)
})
