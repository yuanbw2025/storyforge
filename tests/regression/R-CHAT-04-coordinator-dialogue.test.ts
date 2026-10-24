import {expect, it} from 'vitest'
import {createInitialInteractionState, buildInteractionContextWindow, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {planChatCoordinatorDialogueV1} from '../../src/lib/character-interaction/coordinator-dialogue'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {chatRetrievalVersionForReader} from '../../src/lib/character-interaction/context-selection'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'

/** Dialogue-only pressure tests, not consequence-bearing long-run acceptance. */
function crowded(length = 150) {
  const s = createInitialInteractionState(chatNarrativeFixture()), template = s.sceneTemplates[0]
  s.activeScene = {...template, sceneId: 'inn.current', status: 'active', activeParticipantKeys: [...template.participantKeys], startedAtSequence: 0, endedAtSequence: null, playerTurns: 1}
  s.messages = Array.from({length}, (_, i) => ({messageId: `line-${i}`, eventSequence: i + 1,
    role: 'character' as const, speakerKey: 'guard', audienceKeys: ['guard', 'player'],
    text: i === 3 ? '先核对铜印借用登记，再考虑谁接触过。' : `第${i}段闲谈。` + '窗外还在下雨，天色渐渐暗了。'.repeat(8),
    replyToSequence: null, supersededBySequence: null}))
  s.messages.unshift({messageId: 'boundary', eventSequence: -1, role: 'player', speakerKey: 'player', audienceKeys: ['guard', 'player'],
    text: '不要擅自打开我的包。', replyToSequence: null, supersededBySequence: null})
  s.activeScene.startedAtSequence = -2
  return s
}
function selected(s: ReturnType<typeof crowded>, text = '', actorKey?: string) {
  const rendered = selectChatCoordinatorContextV1(s, {text, actorKey, retrievalVersion: 'chat-relevance-v5'})
  return {rendered, view: JSON.parse(rendered.slice(rendered.indexOf('{')))}
}

it('selects old relevant dialogue without dropping current player boundaries, actor input or canonical facts', () => {
  const s = crowded(), before = structuredClone(s), actor = buildInteractionContextWindow(s, 'guard')
  expect(() => selectChatCoordinatorContextV1(s, {text: '铜印借用登记', actorKey: 'guard', retrievalVersion: 'chat-relevance-v4'})).toThrow('超过本轮预算')
  const {view, rendered} = selected(s, '铜印借用登记', 'guard')
  expect(view.messages).toContainEqual(s.messages[0])
  expect(view.messages).toContainEqual(s.messages.find(m => m.messageId === 'line-3'))
  for (const m of actor.messages) expect(view.messages).toContainEqual(m)
  expect(view.situation).toEqual(s.chatNarrative!.situation)
  expect(view.dialogueSelection.omittedMessageEntries).toBeGreaterThan(0)
  expect(view.messages.map((m: {eventSequence: number}) => m.eventSequence)).toEqual(view.messages.map((m: {eventSequence: number}) => m.eventSequence).sort((a: number, b: number) => a - b))
  expect(rendered.length).toBeLessThanOrEqual(28000)
  expect(estimateTokens(rendered)).toBeLessThanOrEqual(12000)
  expect(JSON.stringify(interactionVisibilityView(s, 'player'))).not.toContain('柜台下')
  expect(s).toEqual(before)
})

it('retains actor-delivered prior-scene messages and exact negative branch references without making the whole old scene current', () => {
  const s = crowded(40)
  s.messages[2].eventSequence = -5
  s.activeScene!.startedAtSequence = 30
  const plan = planChatCoordinatorDialogueV1(s, {text: JSON.stringify({actionSequence: -5}), deliveredMessageIds: ['line-3']})
  expect(plan.required.map(m => m.messageId)).toEqual([s.messages[2].messageId, 'line-3', 'line-39'])
  expect(plan.eligible.some(m => m.messageId === 'line-2')).toBe(false)
})

it.each(['missing', 'excluded', 'superseded'] as const)('refuses unavailable required references: %s', kind => {
  const s = crowded(10), source = s.messages[2]
  if (kind === 'missing') s.messages.splice(2, 1)
  if (kind === 'excluded') s.chatNarrative!.excludedMessageIds = [source.messageId]
  if (kind === 'superseded') source.supersededBySequence = 100
  expect(() => selected(s, JSON.stringify({questionSequence: source.eventSequence}))).toThrow('必需消息引用')
})

it('does not resurrect optional excluded messages and does not trim mandatory dialogue to force a fit', () => {
  const s = crowded(), before = structuredClone(s)
  s.chatNarrative!.excludedMessageIds = ['line-3']
  expect(selected(s, '铜印借用登记').view.messages.some((m: {messageId: string}) => m.messageId === 'line-3')).toBe(false)
  s.messages[0].text = '玩家的明确限制。'.repeat(5000)
  const failing = structuredClone(s)
  expect(() => selected(s)).toThrow('不能截断')
  expect(s).toEqual(failing)
  expect(before.messages).toHaveLength(s.messages.length)
})

it('preserves v4 through v7 actor bytes and identifies v8 history selection separately', () => {
  const s = crowded(4), old = buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v4'})
  const current = buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v7'})
  expect(formatInteractionRuntimeContextV1(s.profiles[0], current)).toBe(formatInteractionRuntimeContextV1(s.profiles[0], old))
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v8')).toBe('chat-relevance-v4')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v9')).toBe('chat-relevance-v5')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v10')).toBe('chat-relevance-v6')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v11')).toBe('chat-relevance-v7')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v12')).toBe('chat-relevance-v8')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v13')).toBe('chat-relevance-v9')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v999')).toBeNull()
  expect(buildInteractionContextWindow(s, 'guard').historyContext?.version).toBe(1)
  const legacy = selectChatCoordinatorContextV1(s, {text: '', retrievalVersion: 'chat-relevance-v4'})
  expect(legacy).toBe(selectChatCoordinatorContextV1(s))
  expect(legacy).not.toContain('dialogueSelection')
  expect(JSON.parse(legacy.slice(legacy.indexOf('{'))).messages).toEqual(s.messages)
})
