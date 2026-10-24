import {expect, it} from 'vitest'
import {buildInteractionContextWindow, interactionRetrievalView, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {buildChatHistoryCoordinatorProjectionV1} from '../../src/lib/character-interaction/history-coordinator-context'
import {chatRelationshipHistoryRowsV1, chatRelationshipHistoryKeyV1} from '../../src/lib/character-interaction/relationship-history-context'
import {chatRelationshipHistoryFixture} from '../helpers/chat-relationship-history'

it('recalls a relevant older cause with exact source and expression while keeping current attitude unchanged', () => {
  const state = chatRelationshipHistoryFixture(), before = structuredClone(state)
  const old = buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v9', maxRecentMessages: 4})
  const view = buildInteractionContextWindow(state, 'guard', {maxRecentMessages: 4})
  expect(old.relationshipEvidence!.map(r => r.eventSequence)).toEqual([81])
  expect(old.messages.some(m => m.eventSequence === 70)).toBe(false)
  expect(view.relationshipEvidence!.map(r => r.eventSequence)).toEqual([71, 81])
  expect(view.messages.find(m => m.eventSequence === 70)?.text).toBe(state.messages.find(m => m.eventSequence === 70)!.text)
  expect(view.messages.find(m => m.eventSequence === 71)?.text).toBe(state.relationshipHistory[0].reason)
  expect(view.selection!.history!.find(r => r.key === chatRelationshipHistoryKeyV1(state.relationshipHistory[0]))).toMatchObject({kind: 'relationships', included: true, required: []})
  expect(view.relationships[0].value).toBe(2)
  expect(state).toEqual(before)
  expect(formatInteractionRuntimeContextV1(state.profiles[0], view)).not.toContain('柜台下')
})

it('retains the actual actor-delivered cause and its dialogue in independent review', () => {
  const state = chatRelationshipHistoryFixture(), view = buildInteractionContextWindow(state, 'guard')
  const projection = buildChatHistoryCoordinatorProjectionV1(state, {actorKey: 'guard', retrievalVersion: 'chat-relevance-v10', text: '现在愿意再次借出工具。'})
  const reviewed = JSON.parse(projection.text.slice(projection.text.indexOf('{')))
  for (const cause of view.relationshipEvidence!) expect(reviewed.relationshipEvidence).toContainEqual(cause)
  for (const sequence of [70, 71, 80, 81]) expect(reviewed.messages).toContainEqual(state.messages.find(m => m.eventSequence === sequence))
  expect(projection.selection.history.find(r => r.kind === 'messages' && r.key === 'relationship-player-70')?.required).toContain('actor-delivered')
  expect(projection.selection.history.find(r => r.kind === 'relationships' && r.key === chatRelationshipHistoryKeyV1(state.relationshipHistory[0]))?.required).toContain('actor-delivered')
})

it('ranks a relevant earlier cause ahead of unrelated later history under the existing budget', () => {
  const state = chatRelationshipHistoryFixture()
  for (let i = 0; i < 24; i++) {
    const source = 200 + i * 2, sequence = source + 1, reason = `第${i}次闲谈时，我更愿意听你说话。`
    state.messages.push({messageId: `unrelated-player-${i}`, eventSequence: source, role: 'player', speakerKey: 'player', audienceKeys: ['guard', 'player'],
      text: `第${i}次谈论餐具。` + '杯盘摆在桌子上，白布是素色的，窗外看不到树。'.repeat(70), replyToSequence: null, supersededBySequence: null},
    {messageId: `unrelated-actor-${i}`, eventSequence: sequence, role: 'character', speakerKey: 'guard', audienceKeys: ['guard', 'player'], text: reason, replyToSequence: source, supersededBySequence: null})
    state.relationshipHistory.push({...state.relationshipHistory[1], eventSequence: sequence, sourceEventSequence: source, before: i + 2, after: i + 3, reason})
  }
  state.messages.sort((a, b) => a.eventSequence - b.eventSequence)
  state.relationships[0].value = 26; state.relationships[0].lastChangedSequence = 247
  const view = buildInteractionContextWindow(state, 'guard', {maxRecentMessages: 4})
  expect(view.relationshipEvidence).toContainEqual(state.relationshipHistory[0])
  expect(view.relationshipEvidence).toContainEqual(state.relationshipHistory.at(-1))
  expect(view.selection!.history!.some(r => r.kind === 'relationships' && !r.included)).toBe(true)
  for (const change of view.relationshipEvidence!) {
    expect(view.messages.some(m => m.eventSequence === change.sourceEventSequence)).toBe(true)
    expect(view.messages.some(m => m.eventSequence === change.eventSequence)).toBe(true)
  }
})

it.each(['excluded-source', 'excluded-expression', 'wrong-speaker', 'unwitnessed', 'superseded'] as const)('does not retrieve historical raw dialogue through %s', variant => {
  const state = chatRelationshipHistoryFixture(), source = state.messages.find(m => m.eventSequence === 70)!, expression = state.messages.find(m => m.eventSequence === 71)!
  if (variant === 'excluded-source') state.chatNarrative!.excludedMessageIds = [source.messageId]
  if (variant === 'excluded-expression') state.chatNarrative!.excludedMessageIds = [expression.messageId]
  if (variant === 'wrong-speaker') expression.speakerKey = 'artisan'
  if (variant === 'unwitnessed') source.audienceKeys = ['artisan', 'player']
  if (variant === 'superseded') source.supersededBySequence = 501
  const view = buildInteractionContextWindow(state, 'guard', {maxRecentMessages: 4})
  expect(view.relationshipEvidence!.some(r => r.eventSequence === 71)).toBe(false)
  expect(view.messages.some(m => m.eventSequence === 70 || m.eventSequence === 71)).toBe(false)
  expect(view.relationships[0].value).toBe(2)
})

it('does not expose another role history and preserves inherited source identities after nested branch rebasing', () => {
  const state = chatRelationshipHistoryFixture(), other = buildInteractionContextWindow(state, 'artisan')
  expect(JSON.stringify(other)).not.toContain('靛蓝钥匙')
  const nested = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(state, 501), 0)
  const view = buildInteractionContextWindow(nested, 'guard', {maxRecentMessages: 4})
  expect(view.relationshipEvidence).toHaveLength(2)
  for (const row of chatRelationshipHistoryRowsV1(nested, 'guard', interactionRetrievalView(nested, 'guard').messages)) {
    expect(row.change.sourceEventSequence).toBeLessThan(0)
    expect(row.messages).toHaveLength(2)
    for (const message of row.messages) expect(view.messages).toContainEqual(message)
  }
})

it('omits an optional cause together with its oversized original dialogue and never changes saved old reader bytes', () => {
  const state = chatRelationshipHistoryFixture()
  state.messages.find(m => m.eventSequence === 70)!.text += '完整原话不可只摘取好看的部分。'.repeat(500)
  const old = formatInteractionRuntimeContextV1(state.profiles[0], buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v9', maxRecentMessages: 4}))
  const view = buildInteractionContextWindow(state, 'guard', {maxRecentMessages: 4, maxCharacters: 7000})
  expect(view.relationshipEvidence!.map(r => r.eventSequence)).toEqual([81])
  expect(view.messages.some(m => m.eventSequence === 70)).toBe(false)
  expect(view.selection!.history!.find(r => r.key === chatRelationshipHistoryKeyV1(state.relationshipHistory[0]))?.included).toBe(false)
  expect(formatInteractionRuntimeContextV1(state.profiles[0], buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'chat-relevance-v9', maxRecentMessages: 4}))).toBe(old)
})

it('stops if the current mandatory cause and its actual dialogue exceed the original budget', () => {
  const state = chatRelationshipHistoryFixture()
  state.messages.find(m => m.eventSequence === 80)!.text += '这一段是真实完整的玩家原话，不能删节。'.repeat(300)
  const before = structuredClone(state)
  expect(() => buildInteractionContextWindow(state, 'guard', {maxCharacters: 4000})).toThrow('超过预算')
  expect(state).toEqual(before)
})
