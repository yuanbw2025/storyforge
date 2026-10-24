import {expect, it} from 'vitest'
import {createInitialInteractionState, parseInteractionState, rebaseInteractionStateForBranch, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {chatMemoryReviewBindingV1, hasChatMemoryContentReviewV1, parseChatMemoryReviewV1, parseChatMemoryReceiptV1, CHAT_MEMORY_CHECKS} from '../../src/lib/character-interaction/memory-review-contract'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'

function fixture() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.messages.push({messageId: 'public', eventSequence: 1, role: 'player', speakerKey: 'player', audienceKeys: ['guard'], text: '我周五再来。', replyToSequence: null, supersededBySequence: null})
  state.memories.push({memoryId: 'promise', participantKey: 'guard', kind: 'commitment', content: '玩家说周五再来。', importance: 80,
    sourceEventSequences: [1], evidenceExcerpt: '周五再来', status: 'accepted', proposalSequence: 2, decisionSequence: 3, supersededByMemoryId: null})
  return state
}

it('requires both readers, current actual messages and an actual excerpt before constructing review evidence', () => {
  const state = fixture(), memory = state.memories[0]
  expect(chatMemoryReviewBindingV1(state, memory)).toContain('我周五再来。')
  for (const value of [{...memory, sourceEventSequences: []}, {...memory, sourceEventSequences: [99]}, {...memory, evidenceExcerpt: '周二'}]) {
    expect(() => chatMemoryReviewBindingV1(state, value)).toThrow()
  }
  const privateState = structuredClone(state); privateState.messages[0].speakerKey = 'guard'
  expect(() => chatMemoryReviewBindingV1(privateState, memory)).toThrow('共同可见')
  state.messages[0].supersededBySequence = 4
  expect(() => chatMemoryReviewBindingV1(state, memory)).toThrow('已替代')
})

it('keeps proof on round-trip and branch rebasing while excluding full source snapshots from actor memory', () => {
  const state = fixture(), memory = state.memories[0]
  memory.contentReview = {version: 1, bindingJson: chatMemoryReviewBindingV1(state, memory), reviewHash: 'a'.repeat(64), passedChecks: [...CHAT_MEMORY_CHECKS]}
  expect(hasChatMemoryContentReviewV1(state, memory)).toBe(true)
  const parsed = parseInteractionState(JSON.parse(JSON.stringify(state)))!
  expect(parsed).toEqual(state)
  const rebased = rebaseInteractionStateForBranch(state, 3)
  expect(rebased.memories[0].sourceEventSequences[0]).toBeLessThan(0)
  expect(hasChatMemoryContentReviewV1(rebased, rebased.memories[0])).toBe(true)
  expect(interactionVisibilityView(state, 'guard').memories[0]).not.toHaveProperty('contentReview')
  expect(state.memories[0]).toHaveProperty('contentReview')
  memory.content = '玩家承诺周二再来。'
  expect(hasChatMemoryContentReviewV1(state, memory)).toBe(false)
})

it('rejects missing, duplicate, ambiguous and malformed semantic checks instead of manufacturing review approval', () => {
  const output = {checks: CHAT_MEMORY_CHECKS.map(check => ({check, passed: true, reason: '核对来源'}))}
  expect(parseChatMemoryReviewV1(output, '{}').checks).toHaveLength(3)
  for (const value of [{checks: []}, {checks: [...output.checks.slice(1), output.checks[1]]}, {...output, approved: true},
    {checks: output.checks.map(c => ({...c, passed: 'yes'}))}, {checks: output.checks.map(c => ({...c, reason: ''}))}]) {
    expect(() => parseChatMemoryReviewV1(value, '{}')).toThrow()
  }
  expect(parseChatMemoryReviewV1({checks: output.checks.map(c => ({...c, passed: false}))}, '{}').checks.every(c => c.passed)).toBe(false)
  expect(() => parseChatMemoryReceiptV1({version: 1, bindingJson: '{}', reviewHash: 1, passedChecks: CHAT_MEMORY_CHECKS})).toThrow()
})
