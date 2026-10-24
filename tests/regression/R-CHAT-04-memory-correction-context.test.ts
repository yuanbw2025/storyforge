import {expect, it} from 'vitest'
import {buildInteractionContextWindow, createInitialInteractionState, interactionVisibilityView, rebaseInteractionStateForBranch} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {chatRetrievalVersionForReader} from '../../src/lib/character-interaction/context-selection'
import {chatNarrativeFixture} from '../helpers/chat-narrative-fixture'

function prepared() {
  const s = createInitialInteractionState(chatNarrativeFixture())
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  s.messages.push({messageId: 'source', eventSequence: 1, role: 'player', speakerKey: 'player', text: '我只是暂借地图，没有答应帮忙寻找铜印。',
    audienceKeys: ['guard', 'player'], replyToSequence: null, supersededBySequence: null})
  s.memories.push({memoryId: 'corrected', participantKey: 'guard', kind: 'key-memory', content: '玩家只是暂借地图，没有答应帮忙。', importance: 1,
    sourceEventSequences: [1], evidenceExcerpt: '没有答应帮忙', status: 'accepted', proposalSequence: 2, decisionSequence: 2, supersededByMemoryId: null, authorship: 'player-correction'})
  s.chatNarrative!.revision = 1; s.chatNarrative!.lastEventSequence = 2
  return s
}

it.each([100, 300, 1000])('keeps a low relevance correction and its exact shared source beyond %i synthetic messages', length => {
  const s = prepared()
  for (let i = 0; i < length; i++) s.messages.push({...s.messages[0], messageId: `past-${i}`, eventSequence: i + 3, text: '沿途风景和海边渔船。'})
  s.chatNarrative!.lastEventSequence = length + 2
  s.memories.push(...Array.from({length: 20}, (_, i) => ({...s.memories[0], memoryId: `background-${i}`, authorship: undefined,
    importance: 100, content: '沿途风景和海边渔船。'.repeat(80)})))
  const before = structuredClone(s)
  const view = buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v4', maxCharacters: 8500})
  expect(view.messages.some(m => m.messageId === 'source')).toBe(false)
  expect(view.memoryCorrections).toEqual([{memoryId: 'corrected', sourceSequence: 2, actorKey: 'guard', content: s.memories[0].content,
    evidenceExcerpt: '没有答应帮忙', sources: [{messageId: 'source', eventSequence: 1, speakerKey: 'player', text: s.messages[0].text}]}])
  expect(view.selection?.memories).toContainEqual({key: 'corrected', included: true, reason: 'pending-correction'})
  expect(view.selection?.version).toBe(4)
  expect(view.selection?.memories.some(m => !m.included)).toBe(true)
  expect(formatInteractionRuntimeContextV1(s.profiles[0], view)).toContain(s.messages[0].text)
  expect(s).toEqual(before)
})

it('does not retrofit old readers or ordinary visibility hashes', () => {
  const s = prepared()
  for (const version of ['legacy', 'chat-relevance-v1', 'chat-relevance-v2', 'chat-relevance-v3'] as const) {
    const view = buildInteractionContextWindow(s, 'guard', {retrievalVersion: version})
    expect(view).not.toHaveProperty('memoryCorrections')
    expect(formatInteractionRuntimeContextV1(s.profiles[0], view)).not.toContain('【尚待本次行动核对')
  }
  expect(interactionVisibilityView(s, 'guard')).not.toHaveProperty('memoryCorrections')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v8')).toBe('chat-relevance-v4')
  expect(chatRetrievalVersionForReader('chat-narrative-runtime-view-v7')).toBe('chat-relevance-v3')
})

it('preserves the evidence when dialogue is excluded, without leaking it to another role', () => {
  const s = prepared(); s.chatNarrative!.excludedMessageIds = ['source']
  const view = buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v4'})
  expect(view.messages).toEqual([])
  expect(view.memoryCorrections![0].sources[0].text).toBe(s.messages[0].text)
  const other = buildInteractionContextWindow(s, 'artisan', {retrievalVersion: 'chat-relevance-v4'})
  expect(other.memoryCorrections).toEqual([])
  expect(JSON.stringify(other)).not.toContain('没有答应帮忙')
})

it.each(['missing', 'private', 'superseded'] as const)('fails closed on %s original evidence', kind => {
  const s = prepared()
  if (kind === 'missing') s.messages = []
  if (kind === 'private') Object.assign(s.messages[0], {role: 'character', speakerKey: 'guard', audienceKeys: ['guard']})
  if (kind === 'superseded') s.messages[0].supersededBySequence = 2
  expect(() => buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v4'})).toThrow()
})

it('does not silently truncate corrections or their source messages to meet either role or review budgets', () => {
  const s = prepared(); s.messages[0].text += '这是不可裁剪的原话依据。'.repeat(1500)
  const before = structuredClone(s)
  expect(() => buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v4'})).toThrow('修正')
  expect(() => selectChatCoordinatorContextV1(s, {text: '', actorKey: 'guard', retrievalVersion: 'chat-relevance-v4'})).toThrow('修正')
  expect(s).toEqual(before)
})

it('keeps exact pending evidence in review and rebases source versions without acknowledging delivery', () => {
  const s = rebaseInteractionStateForBranch(rebaseInteractionStateForBranch(prepared(), 2), 0)
  const view = buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v4'})
  const text = selectChatCoordinatorContextV1(s, {text: '', actorKey: 'guard', retrievalVersion: 'chat-relevance-v4'})
  expect(JSON.parse(text.slice(text.indexOf('{'))).memoryCorrections).toEqual(view.memoryCorrections)
  expect(view.memoryCorrections![0]).toMatchObject({memoryId: 'corrected', sourceSequence: -2, sources: [{messageId: 'source', eventSequence: -3}]})
  expect(s.chatNarrative).not.toHaveProperty('memoryReconciliations')
})

it.each(['disabled', 'revoked'] as const)('does not read %s corrections', status => {
  const s = prepared(); s.memories[0].status = status
  expect(buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v4'}).memoryCorrections).toEqual([])
})
