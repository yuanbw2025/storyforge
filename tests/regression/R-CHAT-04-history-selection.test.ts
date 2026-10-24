import {expect, it} from 'vitest'
import {buildInteractionContextWindow, interactionVisibilityView, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {chatHistorySelectionFixture} from '../helpers/chat-history-selection'

const role = (s: ReturnType<typeof chatHistorySelectionFixture>, maxCharacters = 14_000) => buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v8', maxCharacters})
it('selects related historical facts and terminal matters with original closure evidence while the previous policy reaches its limit', () => {
  const s = chatHistorySelectionFixture(), before = structuredClone(s)
  expect(() => buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v7'})).toThrow('超过预算')
  const v = role(s)
  expect(v.chatNarrative!.facts.some(f => f.factKey === 'observed-7')).toBe(true)
  expect(v.chatNarrative!.goals.some(g => g.goalKey === 'closed-7')).toBe(true)
  expect(v.chatNarrative!.threads.some(t => t.threadKey === 'closed-thread-7')).toBe(true)
  expect(v.historyContext!.resolutions.find(r => r.kind === 'goals' && r.key === 'closed-7')?.source.excerpt).toContain('杉木叶标记确认')
  expect(v.historyContext!.omitted.facts).toBeGreaterThan(0)
  expect(v.historyContext!.omitted.goals).toBeGreaterThan(0)
  expect(v.selection!.history!.some(d => !d.included && d.kind === 'facts')).toBe(true)
  expect(formatInteractionRuntimeContextV1(s.profiles[0], v).length).toBeLessThan(14_000)
  expect(estimateTokens(formatInteractionRuntimeContextV1(s.profiles[0], v))).toBeLessThan(8000)
  expect(s).toEqual(before)
})
it('expands recursive dependencies and protects unfinished matters, latest consequences and facts without classification', () => {
  const s = chatHistorySelectionFixture()
  s.chatNarrative!.factEvidence!.records[7].evidenceFactKeys = ['observed-6']
  s.chatNarrative!.factEvidence!.records[6].evidenceFactKeys = ['observed-5']
  s.chatNarrative!.factEvidence!.records = s.chatNarrative!.factEvidence!.records.filter(r => r.factKey !== 'observed-40')
  s.chatNarrative!.situation.goals[0].evidenceFactKeys.push('observed-42')
  const v = role(parseInteractionState(s)!)
  for (const key of ['observed-5', 'observed-6', 'observed-7', 'observed-40', 'observed-42', 'observed-79']) expect(v.chatNarrative!.facts.some(f => f.factKey === key)).toBe(true)
  expect(v.chatNarrative!.goals.some(g => g.goalKey === 'find-seal')).toBe(true)
  expect(v.chatNarrative!.threads.some(t => t.threadKey === 'investigate')).toBe(true)
})
it('keeps unknown legacy resolutions and durable new objects mandatory', () => {
  const s = chatHistorySelectionFixture()
  s.chatNarrative!.resolutionEvidence!.goals = s.chatNarrative!.resolutionEvidence!.goals.filter(g => g.targetKey !== 'closed-1')
  s.chatNarrative!.factEvidence!.records[45].kind = 'object'
  const v = role(parseInteractionState(s)!)
  expect(v.chatNarrative!.goals.some(g => g.goalKey === 'closed-1')).toBe(true)
  expect(v.chatNarrative!.facts.some(f => f.factKey === 'observed-45')).toBe(true)
})
it('preserves actual actor input and explicit candidate references in coordinator review with full hidden facts and source closure', () => {
  const s = chatHistorySelectionFixture(), delivered = buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v8'})
  const omitted = delivered.selection!.history!.find(d => d.kind === 'facts' && !d.included)!
  const text = selectChatCoordinatorContextV1(s, {retrievalVersion: 'chat-relevance-v8', actorKey: 'guard', text: JSON.stringify({evidenceFactKeys: [omitted.key], goalKey: 'closed-1'})})
  const c = JSON.parse(text.slice(text.indexOf('{')))
  for (const f of delivered.chatNarrative!.facts) expect(c.situation.facts).toContainEqual(f)
  expect(c.situation.facts.some((f: {factKey: string}) => f.factKey === omitted.key)).toBe(true)
  expect(c.situation.goals.some((g: {goalKey: string}) => g.goalKey === 'closed-1')).toBe(true)
  expect(text).toContain('柜台下'); expect(text.length).toBeLessThanOrEqual(28_000)
  expect(estimateTokens(text)).toBeLessThanOrEqual(12_000)
})
it('never exposes private history, counts or metadata to an uninformed actor or player view', () => {
  const s = chatHistorySelectionFixture()
  const v = buildInteractionContextWindow(s, 'artisan', {retrievalVersion: 'chat-relevance-v8'})
  expect(JSON.stringify(v)).not.toMatch(/observed-|closed-|靛蓝|担心再次错怪人|柜台下/)
  expect(v.historyContext!.omitted.facts).toBe(0)
  expect(interactionVisibilityView(s, 'player')).not.toHaveProperty('historyContext')
})
it('retains old source ranges and selection after nested rebasing, without requiring ancestor events', () => {
  const s = chatHistorySelectionFixture(), nested = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(s, 501), 0)
  const v = role(parseInteractionState(JSON.parse(JSON.stringify(nested)))!)
  expect(v.chatNarrative!.goals.some(g => g.goalKey === 'closed-7')).toBe(true)
  expect(v.historyContext!.resolutions.find(r => r.key === 'closed-7')!.source.sequence).toBeLessThan(0)
})
it('fails before sending if protected dependency closure does not fit, without mutating the source', () => {
  const s = chatHistorySelectionFixture(); delete s.chatNarrative!.factEvidence
  const before = structuredClone(s)
  expect(() => role(s)).toThrow('不会静默省略必要来源')
  expect(s).toEqual(before)
})
it('retains canonical closure evidence even when its dialogue was explicitly excluded', () => {
  const s = chatHistorySelectionFixture(); s.chatNarrative!.excludedMessageIds = ['closure-7']
  const v = role(s)
  expect(v.messages.some(m => m.messageId === 'closure-7')).toBe(false)
  expect(v.historyContext!.resolutions.find(r => r.key === 'closed-7')?.source.excerpt).toContain('杉木叶标记确认')
})
it('keeps facts supporting a pinned memory and a current relationship reason even when their wording is unrelated', () => {
  const s = chatHistorySelectionFixture()
  s.memories.push({memoryId: 'pinned-note', participantKey: 'guard', kind: 'key-memory', content: '保留这件旧事的准确依据。', importance: 1,
    sourceEventSequences: [42], evidenceExcerpt: '海岸旧家具', status: 'accepted', proposalSequence: 450, decisionSequence: 451, supersededByMemoryId: null, playerPinned: true})
  s.relationshipHistory.push({eventSequence: 46, sourceEventSequence: 47, fromParticipantKey: 'guard', toParticipantKey: 'player', dimensionKey: 'trust', before: 0, after: 1, delta: 1, reason: '共同经历', ruleKey: 'fixture', significantEventKey: null})
  const v = role(s)
  for (const key of ['observed-40', 'observed-44', 'observed-45']) expect(v.chatNarrative!.facts.some(f => f.factKey === key)).toBe(true)
  expect(v.memories.some(m => m.memoryId === 'pinned-note')).toBe(true)
})
it('does not reveal unknown dependency identities when a visible observation has private antecedents', () => {
  const s = chatHistorySelectionFixture()
  s.chatNarrative!.situation.facts.find(f => f.factKey === 'observed-7')!.audienceKeys.push('artisan')
  s.chatNarrative!.factEvidence!.records[7].evidenceFactKeys = ['observed-6']
  const v = buildInteractionContextWindow(s, 'artisan', {retrievalVersion: 'chat-relevance-v8'})
  expect(v.chatNarrative!.facts.some(f => f.factKey === 'observed-7')).toBe(true)
  expect(JSON.stringify(v)).not.toContain('observed-6')
})
it('keeps current player statements beyond the old count window, and fails honestly when those mandatory statements exceed budget', () => {
  const s = chatHistorySelectionFixture()
  for (let i = 0; i < 300; i++) s.messages.push({...s.messages[s.messages.length - 1], messageId: `player-${i}`, eventSequence: 502 + i, text: `第${i}次要求：未经我同意不要更改原安排。`})
  s.chatNarrative!.lastEventSequence = 801
  const before = structuredClone(s)
  expect(() => role(s, 8500)).toThrow('超过预算')
  expect(s).toEqual(before)
})
