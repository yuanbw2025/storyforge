import {expect, it} from 'vitest'
import {buildInteractionContextWindow, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {chatRetrievalVersionForReader} from '../../src/lib/character-interaction/context-selection'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {chatCommitmentHistoryStateFixture, historyTerms} from '../helpers/chat-commitment-history-fixture'

it('recalls a relevant resolved promise with both source excerpts while preserving open and latest dispositions', () => {
  const s = chatCommitmentHistoryStateFixture(), before = structuredClone(s)
  expect(() => buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v2'})).toThrow('超过预算')
  const view = buildInteractionContextWindow(s, 'guard', {maxCharacters: 10_000, retrievalVersion: 'chat-relevance-v7'})
  const retained = view.chatNarrative!.goals[0].commitments!
  for (const i of [7, 14, 15]) expect(retained).toContainEqual(s.chatNarrative!.situation.goals[0].commitments![i])
  expect(view.selection?.commitments).toContainEqual({key: 'promise-7:promise', included: true, reason: 'dialogue'})
  expect(view.selection?.commitments).toContainEqual({key: 'promise-14:promise', included: true, reason: 'latest-resolution'})
  expect(view.selection?.commitments).toContainEqual({key: 'promise-15:promise', included: true, reason: 'open-commitment'})
  expect(view.selection?.commitments?.some(c => !c.included)).toBe(true)
  expect(view.characterCount).toBeLessThanOrEqual(10_000)
  expect(estimateTokens(formatInteractionRuntimeContextV1(s.profiles[0], view))).toBeLessThanOrEqual(8000)
  expect(s).toEqual(before)
})

it('stops visibly when mandatory obligations cannot fit, without dropping them or changing state', () => {
  const s = chatCommitmentHistoryStateFixture(), before = structuredClone(s)
  expect(() => buildInteractionContextWindow(s, 'guard', {maxCharacters: 3000})).toThrow('不会静默省略')
  expect(s).toEqual(before)
})

it('does not expose a promise to an uninformed role or use private goals in shared selection', () => {
  const s = chatCommitmentHistoryStateFixture()
  const unknown = buildInteractionContextWindow(s, 'artisan')
  expect(unknown.selection?.commitments).toEqual([])
  expect(JSON.stringify(unknown)).not.toContain(historyTerms(15))
  for (const c of s.chatNarrative!.situation.goals[0].commitments!) c.audienceKeys.push('artisan')
  for (const m of s.messages.filter(m => m.role === 'character')) m.audienceKeys!.push('artisan')
  const shared = buildInteractionContextWindow(s, 'artisan', {maxCharacters: 10_000, retrievalVersion: 'chat-relevance-v7'})
  expect(shared.sharedCommitments?.some(c => c.commitmentKey === 'promise-15:promise')).toBe(true)
  expect(shared.sharedCommitments?.some(c => c.commitmentKey === 'promise-14:promise')).toBe(true)
  expect(JSON.stringify(shared)).not.toMatch(/担心再次错怪人|无辜旅人|柜台下/)
})

it('keeps every actor-delivered promise and exact candidate reference in the coordinator, plus hidden facts', () => {
  const s = chatCommitmentHistoryStateFixture()
  const role = buildInteractionContextWindow(s, 'guard'), omitted = role.selection!.commitments!.find(c => !c.included)!
  expect(omitted).toBeDefined()
  const text = selectChatCoordinatorContextV1(s, {text: JSON.stringify({commitmentKey: omitted.key}), actorKey: 'guard'})
  const coordinator = JSON.parse(text.slice(text.indexOf('{')))
  const retained = coordinator.situation.goals.flatMap((g: {commitments?: unknown[]}) => g.commitments ?? [])
  for (const c of role.chatNarrative!.goals[0].commitments!) expect(retained).toContainEqual(c)
  expect(retained).toContainEqual(s.chatNarrative!.situation.goals[0].commitments!.find(c => c.commitmentKey === omitted.key))
  expect(coordinator.selection.omittedCommitmentEntries).toBeGreaterThan(0)
  expect(text).toContain('柜台下')
  expect(estimateTokens(text)).toBeLessThanOrEqual(12_000)
  expect(text.length).toBeLessThanOrEqual(28_000)
  expect(() => selectChatCoordinatorContextV1(s, {text: '', retrievalVersion: 'chat-relevance-v2'})).toThrow('超过本轮预算')
})

it.each([100, 300, 1000])('retains the v7 historical policy beyond %i messages and nested branch rebases', length => {
  const s = chatCommitmentHistoryStateFixture(), query = s.messages.pop()!
  for (let i = 0; i < length; i++) s.messages.push({...query, messageId: `past-${i}`, eventSequence: 42 + i, text: '谈过沿途的风景。'})
  s.messages.push({...query, eventSequence: 42 + length})
  s.chatNarrative!.lastEventSequence = 42 + length
  const branch = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(s, 42 + length), 0)
  const view = buildInteractionContextWindow(branch, 'guard', {maxCharacters: 10_000, retrievalVersion: 'chat-relevance-v7'})
  expect(view.chatNarrative!.goals[0].commitments!.find(c => c.commitmentKey === 'promise-7:promise')?.resolution?.sequence).toBeLessThan(0)
  expect(view.messages.some(m => m.messageId === 'promise-7')).toBe(false)
  expect(view.selection?.commitments?.find(c => c.key === 'promise-7:promise')?.included).toBe(true)
})

it('retains the explicit historical reader mappings', () => {
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v5')).toBe('chat-relevance-v1')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v6')).toBe('chat-relevance-v2')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v7')).toBe('chat-relevance-v3')
  expect(chatRetrievalVersionForReader('unknown')).toBeNull()
})

it('refuses review when all explicitly referenced promise evidence cannot fit instead of dropping a candidate reference', () => {
  const s = chatCommitmentHistoryStateFixture(), before = structuredClone(s)
  const text = JSON.stringify(s.chatNarrative!.situation.goals[0].commitments!.map(c => ({commitmentKey: c.commitmentKey})))
  expect(() => selectChatCoordinatorContextV1(s, {text})).toThrow('不能截断确定事实、未处理约定')
  expect(s).toEqual(before)
})
