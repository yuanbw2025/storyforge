import * as lexical from '../../src/lib/context-gateway/lexical-query'
import {afterEach, expect, it, vi} from 'vitest'
import {createChatHistoryProjectionCacheV1} from '../../src/lib/character-interaction/history-context-cache'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {chatHistorySelectionFixture} from '../helpers/chat-history-selection'

afterEach(() => {vi.restoreAllMocks()})

it('retains complete large inputs only while actual key and projection fit the unchanged total byte bound', () => {
  const cache = createChatHistoryProjectionCacheV1<string>(), maximumBytes = 4 * 1024 * 1024
  const key = cache.key('x'.repeat(1_100_000))!
  expect(key).not.toBeNull(); expect(key.length * 2).toBeGreaterThan(maximumBytes / 2)
  cache.save(key, 'small projection'); expect(cache.read(key)).toBe('small projection')
  // JSON quotes count too. A value exactly at the combined bound is retained.
  const fitting = 'y'.repeat(maximumBytes / 2 - key.length - 2)
  cache.save(key, fitting); expect(cache.read(key)).toBe(fitting)
  // A non-fitting replacement cannot discard the previous proven projection.
  cache.save(key, fitting + 'y'); expect(cache.read(key)).toBe(fitting)
  const second = cache.key('z'.repeat(1_100_000))!
  cache.save(second, 'second'); expect(cache.read(key)).toBeUndefined()
  expect(cache.read(second)).toBe('second')
  expect(cache.key('z'.repeat(maximumBytes / 2))).toBeNull()
})

it('isolates stored projections from both caller mutations and changed complete inputs', () => {
  const cache = createChatHistoryProjectionCacheV1<{selected: string[]}>(), input = {state: {fact: 'one'}, reader: 'v9', actor: 'guard'}
  const key = cache.key(input), value = {selected: ['one']}
  cache.save(key, value); value.selected.push('mutated')
  const hit = cache.read(key)!; expect(hit).toEqual({selected: ['one']}); hit.selected.push('also-mutated')
  expect(cache.read(key)).toEqual({selected: ['one']})
  input.state.fact = 'two'; expect(cache.read(cache.key(input))).toBeUndefined()
  expect(cache.read(cache.key({...input, reader: 'v8'}))).toBeUndefined()
  expect(cache.key('x'.repeat(2 * 1024 * 1024))).toBeNull()
  for (let i = 0; i < 5; i++) cache.save(String(i), {selected: [String(i)]})
  expect(cache.read(key)).toBeUndefined(); expect(cache.read('0')).toBeUndefined(); expect(cache.read('4')).toEqual({selected: ['4']})
})
it('reuses exact actor output while visibility, reader, source facts and returned edits remain independent', () => {
  const state = chatHistorySelectionFixture()
  state.chatNarrative!.situation.title += ' cache-proof'
  const score = vi.spyOn(lexical, 'createContextTextScorerV1')
  const first = buildInteractionContextWindow(state, 'guard'), initialCalls = score.mock.calls.length
  expect(initialCalls).toBeGreaterThan(0)
  const pristine = structuredClone(first)
  first.chatNarrative!.facts[0].text = 'caller mutation'
  expect(buildInteractionContextWindow(structuredClone(state), 'guard')).toEqual(pristine)
  expect(score).toHaveBeenCalledTimes(initialCalls)
  const changed = structuredClone(state)
  changed.chatNarrative!.situation.facts.find(f => f.factKey === 'lost')!.text = '原始事实已在独立状态中变化。'
  expect(buildInteractionContextWindow(changed, 'guard').chatNarrative!.facts.find(f => f.factKey === 'lost')!.text).toContain('独立状态')
  const other = buildInteractionContextWindow(state, 'artisan')
  expect(other.chatNarrative!.goals.every(g => g.actorKey === 'artisan')).toBe(true)
  expect(buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v8'}).characterCount).not.toBe(pristine.characterCount)
})
