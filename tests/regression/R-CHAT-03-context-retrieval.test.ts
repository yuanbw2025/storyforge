import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {buildInteractionContextWindow, createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {selectChatCoordinatorContextV1, CHAT_COORDINATOR_SOURCE_TOKENS_V1} from '../../src/lib/character-interaction/coordinator-selection'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {commitInteractionPlayerMessage, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
function crowded() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  for (let n = 0; n < 30; n++) state.knowledge.push({knowledgeKey: `early-${n}`, participantKey: 'guard', content: '旧时的饮食与服饰记录。'.repeat(90), status: 'known', importance: 100, sourceEventSequence: 0})
  state.knowledge.push({knowledgeKey: 'late-map', participantKey: 'guard', content: '靛蓝地图的出口藏在北侧石墙中。', status: 'known', importance: 1, sourceEventSequence: 0})
  state.messages.push({messageId: 'ask', eventSequence: 1, role: 'player', speakerKey: 'player', audienceKeys: ['guard'], text: '靛蓝地图的出口在哪里？', replyToSequence: null, supersededBySequence: null})
  return state
}
function coordinatorState() {
  const state = crowded(), template = state.sceneTemplates[0]
  state.activeScene = {...template, sceneId: 'inn.current', status: 'active', activeParticipantKeys: [...template.participantKeys],
    startedAtSequence: 0, endedAtSequence: null, playerTurns: 1}
  return state
}
it('recalls a late low-importance Chinese clue under a fixed budget and keeps original state intact', () => {
  const state = coordinatorState(), original = structuredClone(state)
  expect(buildInteractionContextWindow(state, 'guard', {maxCharacters: 8500, retrievalVersion: 'legacy'}).knowledge.some(k => k.knowledgeKey === 'late-map')).toBe(false)
  const view = buildInteractionContextWindow(state, 'guard', {maxCharacters: 8500})
  expect(view.knowledge.some(k => k.knowledgeKey === 'late-map')).toBe(true)
  expect(view.selection!.knowledge.find(k => k.key === 'late-map')).toEqual({key: 'late-map', included: true, reason: 'dialogue'})
  expect(view.selection!.knowledge.some(k => !k.included)).toBe(true)
  expect(view.characterCount).toBeLessThanOrEqual(8500)
  expect(formatInteractionRuntimeContextV1(state.profiles[0], view)).toContain('靛蓝地图的出口藏在北侧石墙中')
  expect(state).toEqual(original)
})
it('uses active personal goals and known open threads even without a player supplying a query', () => {
  const state = crowded(); state.messages = []
  state.knowledge.at(-1)!.content = '铜印在保管册上登记了借用方向。'
  const view = buildInteractionContextWindow(state, 'guard', {maxCharacters: 8500})
  expect(view.knowledge.at(-1)!.knowledgeKey).toBe('late-map')
  expect(['goal', 'thread']).toContain(view.selection!.knowledge.at(-1)!.reason)
})
it('does not discard recent dialogue merely because optional background is large', () => {
  const state = crowded(), message = state.messages[0]
  state.messages = Array.from({length: 20}, (_, i) => ({...message, messageId: `recent-${i}`, eventSequence: i + 1}))
  const view = buildInteractionContextWindow(state, 'guard')
  expect(view.messages).toHaveLength(20)
  expect(view.knowledge.some(k => k.knowledgeKey === 'late-map')).toBe(true)
})
it('excludes omitted dialogue, backstage truth, other roles and proposed memories from query and candidates', () => {
  const state = crowded(); state.chatNarrative!.excludedMessageIds = ['ask']
  state.chatNarrative!.situation.seed.text = '靛蓝地图的出口在哪里？'
  state.knowledge.push({...state.knowledge.at(-1)!, knowledgeKey: 'other-only', participantKey: 'artisan', content: '靛蓝地图：另一角色私密线索。'})
  state.memories.push({memoryId: 'proposed', participantKey: 'guard', kind: 'scene-summary', content: '靛蓝地图未确认猜测', importance: 100,
    sourceEventSequences: [], evidenceExcerpt: '未确认', status: 'proposed', proposalSequence: 0, decisionSequence: null, supersededByMemoryId: null})
  const view = buildInteractionContextWindow(state, 'guard', {maxCharacters: 8500})
  expect(view.selection!.knowledge.find(k => k.key === 'late-map')).toMatchObject({key: 'late-map', reason: 'importance'})
  expect(view.selection!.knowledge.some(k => k.key === 'other-only')).toBe(false)
  expect(view.selection!.memories).toEqual([])
  expect(view.messages).toEqual([])
  expect(JSON.stringify(view)).not.toContain('另一角色私密线索')
})
it('keeps commitments and current fact provenance; insufficient essential budget stops visibly', () => {
  const state = crowded()
  state.memories.push({memoryId: 'promise', participantKey: 'guard', kind: 'commitment', content: '我答应把托管物品交还本人。'.repeat(150), importance: 1,
    sourceEventSequences: [], evidenceExcerpt: '我答应', status: 'accepted', proposalSequence: 0, decisionSequence: 0, supersededByMemoryId: null})
  const view = buildInteractionContextWindow(state, 'guard', {maxCharacters: 8500, retrievalVersion: 'chat-relevance-v1'})
  expect(view.memories.map(m => m.memoryId)).toContain('promise')
  expect(view.knowledge.map(k => k.knowledgeKey)).toContain('source.lost')
  expect(() => buildInteractionContextWindow(state, 'guard', {maxCharacters: 2000, retrievalVersion: 'chat-relevance-v1'})).toThrow('不会静默省略关键记忆')
})
it('retains original passage order after selection and leaves non-narrative runtime behavior unchanged', () => {
  const state = crowded()
  state.knowledge = ['2', '10', '11'].map(key => ({knowledgeKey: `source.${key}`, participantKey: 'guard', content: `靛蓝地图片段 ${key}`, status: 'known' as const, importance: 50, sourceEventSequence: 0}))
  expect(buildInteractionContextWindow(state, 'guard').knowledge.map(k => k.knowledgeKey)).toEqual(['source.2', 'source.10', 'source.11'])
  delete state.chatNarrative
  expect(buildInteractionContextWindow(state, 'guard')).toEqual(buildInteractionContextWindow(state, 'guard', {retrievalVersion: 'legacy'}))
})
it('bounds coordinator background while preserving hidden facts, every knower and negative branch consequences', () => {
  const state = coordinatorState(), original = structuredClone(state)
  const known = state.knowledge.find(k => k.knowledgeKey === 'source.lost')!
  state.knowledge.push({...known, participantKey: 'player'})
  state.knowledge.push({...known, knowledgeKey: 'branch-past', sourceEventSequence: -12, content: '上一分支已经交还托管物品。'})
  state.knowledge.push({...known, knowledgeKey: 'late-private', participantKey: 'artisan', content: '靛蓝地图背后藏着天青密钥。'})
  const text = selectChatCoordinatorContextV1(state, {text: '靛蓝地图背后的天青密钥', actorKey: 'guard'})
  const view = JSON.parse(text.slice(text.indexOf('{')))
  expect(estimateTokens(text)).toBeLessThanOrEqual(CHAT_COORDINATOR_SOURCE_TOKENS_V1)
  expect(text.length).toBeLessThanOrEqual(28_000)
  expect(view.selection.omittedKnowledgeEntries).toBeGreaterThan(0)
  expect(view.situation).toEqual(state.chatNarrative!.situation)
  expect(view.permissions).toEqual(state.chatNarrative!.permissions)
  expect(view.knowledge.find((k: {knowledgeKey: string}) => k.knowledgeKey === 'late-private').participantKeys).toEqual(['artisan'])
  expect(view.knowledge.find((k: {knowledgeKey: string}) => k.knowledgeKey === 'source.lost').participantKeys).toContain('player')
  expect(view.knowledge.some((k: {knowledgeKey: string}) => k.knowledgeKey === 'branch-past')).toBe(true)
  for (const item of buildInteractionContextWindow(state, 'guard').knowledge) expect(view.knowledge.some((k: {knowledgeKey: string}) => k.knowledgeKey === item.knowledgeKey)).toBe(true)
  expect(state.chatNarrative).toEqual(original.chatNarrative)
})
it('refuses to trim coordinator facts or accepted commitments even when source background could fit', () => {
  const state = coordinatorState()
  state.memories = Array.from({length: 8}, (_, i) => ({memoryId: `promise-${i}`, participantKey: 'guard', kind: 'commitment' as const, content: '已经承诺归还托管物品。'.repeat(300), importance: 1,
    sourceEventSequences: [], evidenceExcerpt: '已承诺', status: 'accepted' as const, proposalSequence: 0, decisionSequence: 0, supersededByMemoryId: null}))
  expect(() => selectChatCoordinatorContextV1(state, {text: '', retrievalVersion: 'chat-relevance-v1'})).toThrow('不能截断确定事实、承诺')
})
it('records the actual model selection and exposes only shared historical reasons and omissions', async () => {
  const f = await seedChatNarrativeRuntimeFixture({contextKnowledge: [
    ...Array.from({length: 35}, (_, i) => ({key: `old-${i}`, content: '公开饮食服饰记录。'.repeat(130), audienceKeys: ['guard', 'player', 'artisan']})),
    {key: 'late-map', content: '靛蓝地图的出口在北墙。', audienceKeys: ['guard', 'player']},
    {key: 'private-map', content: '靛蓝地图背面写着角色私密暗号。', audienceKeys: ['artisan']},
  ]})
  const envelope = async () => {const v = await readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
  const sent = await commitInteractionPlayerMessage({...await envelope(), messageId: 'query', text: '靛蓝地图的出口在哪里？', audienceKeys: ['guard', 'player']})
  await requestChatNarrativeTrigger({...await envelope(), kind: 'player-response', sourceEventSequence: sent.sequence})
  let calls = 0
  const result = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '按已知资料回应',
    runAI: withChatActionChoiceFixture(async messages => {calls++; const text = JSON.stringify(messages); expect(text).toContain('靛蓝地图的出口在北墙'); expect(text).not.toContain('私密暗号');
      return JSON.stringify({kind: 'speak', text: '我先核对地图，再决定怎样找铜印。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})}),
    runReviewAI: async messages => {calls++; const text = JSON.stringify(messages); expect(text).toContain('出口在北墙'); expect(text).toContain('柜台下'); expect(text).toContain('omittedKnowledgeEntries');
      return JSON.stringify(chatActionReviewOutputFixture())}})
  const inspected = await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)
  if (!inspected.available) throw new Error('missing exact selection evidence')
  expect(inspected.selection!.knowledge.find(k => k.content.includes('出口在北墙'))).toMatchObject({included: true, reason: 'dialogue'})
  expect(inspected.selection!.knowledge.some(k => !k.included)).toBe(true)
  expect(JSON.stringify(inspected)).not.toContain('私密暗号')
  db.close(); await db.open()
  expect(await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)).toEqual(inspected)
  expect(calls).toBe(2)
})
