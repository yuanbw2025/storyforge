import {expect, it} from 'vitest'
import actualFailure from '../fixtures/character-chat-reading-recent-dialogue-v324.json'
import {sha256Text} from '../../src/lib/ai/chapter-memory/text-normalization'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {buildInteractionContextWindow, parseInteractionState, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {chatRetrievalVersionForReader} from '../../src/lib/character-interaction/context-selection'

// Exact isolated evaluation state before the rejected V324 run. Synthetic
// variants below exercise access/recovery boundaries, not model quality.
const state = () => parseInteractionState(actualFailure.state)!
type State = ReturnType<typeof state>
const actor = actualFailure.actorKey
const targetId = actualFailure.targetMessageId
const message = (s: State, id: string) => s.messages.find(m => m.messageId === id)!
const role = (s: State, options: {maxCharacters?: number; maxRecentMessages?: number} = {}) =>
  buildInteractionContextWindow(s, actor, {retrievalVersion: 'chat-relevance-v14', ...options})
const rendered = (s: State, view: ReturnType<typeof role>) =>
  formatInteractionRuntimeContextV1(s.profiles.find(p => p.participantKey === actor)!, view)
const ids = (view: ReturnType<typeof role>) => view.messages.map(m => m.messageId)
const requireTarget = (view: ReturnType<typeof role>) => {
  expect(ids(view)).toContain(targetId)
  const row = view.selection?.history?.find(item => item.kind === 'messages' && item.key === targetId)
  expect(row).toMatchObject({included: true})
  expect(row?.required.length ?? 0).toBeGreaterThan(0)
}
const addOtherRole = (s: State) => {
  s.profiles.push({...s.profiles[0], participantKey: 'fixture.other', characterKey: 'fixture.other-character', name: '另一位在场角色'})
  return 'fixture.other'
}

it('reproduces the exact v13 omission despite unused hard-budget capacity and preserves the historical source hash', async () => {
  const s = state(), before = structuredClone(s)
  expect(await sha256Text(JSON.stringify(s))).toBe(actualFailure.interactionStateHash)
  const old = buildInteractionContextWindow(s, actor, {retrievalVersion: 'chat-relevance-v13'})
  const text = rendered(s, old)
  expect(actualFailure.legacyReader).toBe('chat-narrative-runtime-view-v17')
  expect(await sha256Text(text)).toBe(actualFailure.legacySourceHash)
  expect(text.length).toBe(actualFailure.legacySourceCharacters)
  expect(estimateTokens(text)).toBeLessThan(8000)
  expect(message(s, targetId).eventSequence).toBe(39)
  expect(ids(old)).not.toContain(targetId)
  expect(old.selection!.history!.find(row => row.kind === 'messages' && row.key === targetId)).toEqual(actualFailure.legacyTargetSelection)
  expect(ids(old)).toContain(actualFailure.latestPlayerMessageId)
  expect(actualFailure.provenance.reviewerReceivedTargetMessage).toBe(true)
  expect(actualFailure.provenance.failedReviewChecks).toEqual(['meaningful-direction'])
  expect(s).toEqual(before)
})

it('retains the recent closing proposal with its actual player question and latest response request in v14', () => {
  const s = state(), before = structuredClone(s), selected = role(s)
  requireTarget(selected)
  expect(selected.messages.some(m => m.eventSequence === actualFailure.targetReplyToSequence)).toBe(true)
  expect(ids(selected)).toContain(actualFailure.latestPlayerMessageId)
  expect(rendered(s, selected)).toContain(JSON.stringify(message(s, targetId).text))
  expect(estimateTokens(rendered(s, selected)) + 200).toBeLessThanOrEqual(8000)
  expect(rendered(s, selected).length + 200).toBeLessThanOrEqual(24_000)
  expect(s).toEqual(before)
})

it('keeps the last actual response when consecutive player messages precede the new response', () => {
  const s = state(), originalPlayer = message(s, actualFailure.latestPlayerMessageId)
  for (const sequence of [42, 43, 44, 45]) s.messages.push({...originalPlayer,
    messageId: `fixture:consecutive-player:${sequence}`, eventSequence: sequence, text: '我还在听。'})
  s.chatNarrative!.lastEventSequence = 45
  const before = structuredClone(s), selected = role(s, {maxRecentMessages: 4})
  requireTarget(selected)
  expect(selected.messages.some(m => m.eventSequence === 37)).toBe(true)
  expect(ids(selected)).toContain('fixture:consecutive-player:45')
  expect(s).toEqual(before)
})

it('retains the actor own earlier response and the full intervening visible response segment across role changes', () => {
  const s = state(), other = addOtherRole(s), own = message(s, targetId)
  for (const sequence of [42, 43, 44, 45, 46, 47]) s.messages.push({...own,
    messageId: `fixture:other-response:${sequence}`, eventSequence: sequence, speakerKey: other,
    audienceKeys: ['player', actor, other], replyToSequence: 40, text: `另一位角色的第${sequence}项具体补充。`})
  s.messages.push({...message(s, actualFailure.latestPlayerMessageId), messageId: 'fixture:latest-player', eventSequence: 48, text: '请继续谈刚才的安排。'})
  s.chatNarrative!.lastEventSequence = 48
  const before = structuredClone(s), selected = role(s, {maxRecentMessages: 4})
  requireTarget(selected)
  for (const sequence of [42, 43, 44, 45, 46, 47]) expect(ids(selected)).toContain(`fixture:other-response:${sequence}`)
  expect(ids(selected)).toContain(actualFailure.latestPlayerMessageId)
  expect(ids(selected)).toContain('fixture:latest-player')
  expect(s).toEqual(before)
})

it('does not disclose unrelated private messages or their selection metadata while protecting the public response', () => {
  const s = state(), other = addOtherRole(s)
  s.messages.push({...message(s, targetId), messageId: 'fixture:private-unrelated', eventSequence: 42,
    speakerKey: other, audienceKeys: ['player', other], replyToSequence: null, text: '私聊隔离标记：不得从历史选择透露。'})
  s.chatNarrative!.lastEventSequence = 42
  const before = structuredClone(s), selected = role(s)
  requireTarget(selected)
  expect(JSON.stringify(selected)).not.toMatch(/fixture:private-unrelated|私聊隔离标记/)
  expect(s).toEqual(before)
})

it('does not resurrect an explicitly excluded response and instead preserves the preceding eligible response', () => {
  const s = state()
  s.chatNarrative!.excludedMessageIds = [targetId]
  const before = structuredClone(s), selected = role(s)
  expect(ids(selected)).not.toContain(targetId)
  expect(JSON.stringify(selected)).not.toContain(targetId)
  expect(selected.messages.some(m => m.eventSequence === 36)).toBe(true)
  expect(s).toEqual(before)
})

it('keeps a replacement response without restoring the superseded original', () => {
  const s = state(), original = message(s, targetId)
  original.supersededBySequence = 42
  s.messages.push({...original, messageId: 'fixture:replacement-response', eventSequence: 42,
    supersededBySequence: null, replyToSequence: 40, text: '替代后的回应：现在讨论的是另一项具体安排。'})
  s.chatNarrative!.lastEventSequence = 42
  const before = structuredClone(s), selected = role(s)
  expect(ids(selected)).toContain('fixture:replacement-response')
  expect(JSON.stringify(selected)).not.toContain(targetId)
  expect(s).toEqual(before)
})

it.each(['private', 'excluded', 'superseded', 'missing'] as const)('stops rather than recovering a %s explicit reply source behind the access boundary', mode => {
  const s = state(), source = s.messages.find(m => m.eventSequence === 37)!
  if (mode === 'private') {
    const other = addOtherRole(s)
    source.audienceKeys = ['player', other]
    source.playerConversation = 'private'
    source.text = 'PRIVATE-SOURCE-MARKER'
  } else if (mode === 'excluded') s.chatNarrative!.excludedMessageIds = [source.messageId]
  else if (mode === 'superseded') source.supersededBySequence = 40
  else s.messages = s.messages.filter(m => m !== source)
  const before = structuredClone(s)
  expect(() => role(s)).toThrow('近期回应缺少可检索的明确消息依据')
  try { role(s) } catch (error) { expect(String(error)).not.toContain('PRIVATE-SOURCE-MARKER') }
  expect(s).toEqual(before)
})

it('preserves original message identities and question closure after nested negative-sequence branch restoration', () => {
  const original = state()
  const nested = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(original, actualFailure.baseSequence), 0)
  const restored = parseInteractionState(JSON.parse(JSON.stringify(nested)))!, before = structuredClone(restored)
  const selected = role(restored, {maxRecentMessages: 4})
  requireTarget(selected)
  expect(message(restored, targetId).eventSequence).toBeLessThan(0)
  const parentSequence = message(restored, targetId).replyToSequence
  expect(parentSequence).toBeLessThan(0)
  expect(selected.messages.some(m => m.eventSequence === parentSequence)).toBe(true)
  expect(ids(selected)).toContain(actualFailure.latestPlayerMessageId)
  expect(restored).toEqual(before)
  expect(original).toEqual(state())
})

it('fails closed when the necessary recent response exceeds the hard budget instead of dropping or truncating it', () => {
  const s = state(), target = message(s, targetId)
  target.text += '\n' + '完整保留本次已说出的收尾建议。'.repeat(1000)
  expect(target.text.length).toBeLessThanOrEqual(20_000)
  const before = structuredClone(s)
  // The old recipe can fit by losing the same critical statement; the new one
  // must expose the lack of room, not raise the budget or shorten the original.
  expect(() => buildInteractionContextWindow(s, actor, {retrievalVersion: 'chat-relevance-v13', maxCharacters: 14_000})).not.toThrow()
  expect(() => role(s, {maxCharacters: 14_000})).toThrow('预算')
  expect(s).toEqual(before)
})

it('maps the new reader explicitly while leaving the frozen v17 reader on v13', () => {
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v18')).toBe('chat-relevance-v14')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v17')).toBe('chat-relevance-v13')
})
