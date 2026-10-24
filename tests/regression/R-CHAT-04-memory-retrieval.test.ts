import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {buildInteractionContextWindow, createInitialInteractionState, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {applyChatMemoryManagementPlanV1, readChatMemoryManagementPlanV1} from '../../src/lib/character-interaction/memory-management'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, changeChatMemoryUse, commitInteractionPlayerMessage, correctChatMemory, deleteProductRuntimeSession, endInteractionScene, startInteractionScene, proposeInteractionMemory, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, resolveInteractionMemory} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})
function crowded() {
  const s = createInitialInteractionState(chatNarrativeFixture()), template = s.sceneTemplates[0]
  s.activeScene = {...template, sceneId: 'inn.current', status: 'active', activeParticipantKeys: [...template.participantKeys], startedAtSequence: 0, endedAtSequence: null, playerTurns: 1}
  s.messages.push({messageId: 'query', eventSequence: 1, role: 'player', speakerKey: 'player', audienceKeys: ['guard', 'player'], text: '靛蓝地图约定在哪里交还？', replyToSequence: null, supersededBySequence: null})
  s.memories = Array.from({length: 25}, (_, i) => ({memoryId: `old-${i}`, participantKey: 'guard', kind: 'commitment' as const, content: '海岸渔船每年刷漆的旧约定。'.repeat(90), importance: 100,
    sourceEventSequences: [1], evidenceExcerpt: '地图', status: 'accepted' as const, proposalSequence: 1, decisionSequence: 1, supersededByMemoryId: null}))
  s.memories.push({...s.memories[0], memoryId: 'relevant', content: '约好把靛蓝地图交还北侧石墙旁的主人。', importance: 1})
  return s
}
async function command(sessionId: number) {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
const state = async (id: number) => (await readProductRuntimeState(id)).interaction!

it('recalls a late low-importance commitment despite unrelated high-importance commitments and records omissions without deleting memory', () => {
  const s = crowded(), before = structuredClone(s)
  expect(() => buildInteractionContextWindow(s, 'guard', {maxCharacters: 8500, retrievalVersion: 'chat-relevance-v1'})).toThrow('不会静默省略关键记忆')
  const view = buildInteractionContextWindow(s, 'guard', {maxCharacters: 8500})
  expect(view.memories.map(m => m.memoryId)).toContain('relevant')
  expect(view.selection?.memories.find(m => m.key === 'relevant')).toMatchObject({included: true, reason: 'dialogue'})
  expect(view.selection?.memories.some(m => !m.included)).toBe(true)
  expect(view.knowledge.map(k => k.knowledgeKey)).toContain('source.lost')
  expect(view.characterCount).toBeLessThanOrEqual(8500)
  expect(estimateTokens(formatInteractionRuntimeContextV1(s.profiles[0], view))).toBeLessThanOrEqual(8000)
  expect(s).toEqual(before)
})

it('retrieves from a current goal and unfinished thread without a fresh player query, and excludes other roles and inactive memories', () => {
  const s = crowded(); s.messages = []
  s.memories.at(-1)!.content = '找回铜印时约好先核对借用登记。'
  s.memories.push({...s.memories.at(-1)!, memoryId: 'other', participantKey: 'artisan', content: '找回铜印的另一角色私密记忆。'})
  s.memories.push({...s.memories.at(-1)!, memoryId: 'disabled', participantKey: 'guard', status: 'disabled'})
  const view = buildInteractionContextWindow(s, 'guard', {maxCharacters: 8500})
  expect(view.memories.map(m => m.memoryId)).toContain('relevant')
  expect(['goal', 'thread']).toContain(view.selection?.memories.find(m => m.key === 'relevant')?.reason)
  expect(JSON.stringify(view)).not.toContain('另一角色私密记忆')
  expect(view.selection?.memories.some(m => m.key === 'disabled' || m.key === 'other')).toBe(false)
})

it.each([100, 300, 1000])('retains v7 retrieval of old commitments beyond %i messages without depending on the recent-message window', length => {
  const s = crowded(), template = s.messages[0]
  s.messages = Array.from({length}, (_, i) => ({...template, messageId: `past-${i}`, eventSequence: i + 1,
    text: i === 0 ? '约好把靛蓝地图交还北侧石墙旁的主人。' : '聊了几句沿途的风景。'}))
  s.messages.push({...template, messageId: 'now', eventSequence: length + 1})
  const view = buildInteractionContextWindow(s, 'guard', {maxCharacters: 8500, retrievalVersion: 'chat-relevance-v7'})
  expect(view.messages.some(m => m.messageId === 'past-0')).toBe(false)
  expect(view.memories.map(m => m.memoryId)).toContain('relevant')
  expect(view.omittedMessageCount).toBeGreaterThan(0)
  expect(view.characterCount).toBeLessThanOrEqual(8500)
})

it('protects explicit pins regardless of relevance and stops rather than silently truncating them', () => {
  const s = crowded(); s.memories[0].playerPinned = true
  let view = buildInteractionContextWindow(s, 'guard', {maxCharacters: 8500})
  expect(view.selection?.memories.find(m => m.key === 'old-0')).toMatchObject({included: true, reason: 'player-pin'})
  s.memories[0].content = '钴蓝旧信。'.repeat(1000)
  expect(() => buildInteractionContextWindow(s, 'guard', {maxCharacters: 5000})).toThrow('不会静默省略固定记忆')
  delete s.memories[0].playerPinned
  view = buildInteractionContextWindow(s, 'guard', {maxCharacters: 5000})
  expect(view.memories.map(m => m.memoryId)).toContain('relevant')
  expect(view.selection?.memories.find(m => m.key === 'old-0')?.included).toBe(false)
})

it('bounds coordinator memory while retaining backstage facts and every memory actually delivered to the actor', () => {
  const s = crowded()
  expect(() => selectChatCoordinatorContextV1(s, {text: '', retrievalVersion: 'chat-relevance-v1'})).toThrow('不能截断确定事实')
  const rendered = selectChatCoordinatorContextV1(s, {text: '按约定交还靛蓝地图', actorKey: 'guard'})
  const view = JSON.parse(rendered.slice(rendered.indexOf('{')))
  expect(view.selection.omittedMemoryEntries).toBeGreaterThan(0)
  expect(view.memories.some((m: {memoryId: string}) => m.memoryId === 'relevant')).toBe(true)
  for (const m of buildInteractionContextWindow(s, 'guard').memories) expect(view.memories.some((v: {memoryId: string}) => v.memoryId === m.memoryId)).toBe(true)
  expect(view.situation).toEqual(s.chatNarrative!.situation)
  expect(rendered).toContain('柜台下')
  expect(rendered.length).toBeLessThanOrEqual(28000)
  expect(estimateTokens(rendered)).toBeLessThanOrEqual(12000)
})

it('persists explicit pin choices through correction, disable, branches and portable import; never infers pins from old importance', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), sent = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'promise', text: '我约好周五交还地图。'})
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'promise', participantKey: 'guard', kind: 'commitment', content: '旧摘要', importance: 100, sourceEventSequences: [sent.sequence], evidenceExcerpt: '周五交还地图'})
  await resolveInteractionMemory({...await command(f.sessionId), memoryId: 'promise', resolution: 'accepted'})
  const original = await state(f.sessionId), oldPlan = await readChatMemoryManagementPlanV1(f.scope, f.sessionId, 'promise')
  expect(parseInteractionState(original)).toEqual(original)
  expect(original.memories[0]).not.toHaveProperty('playerPinned')
  await expect(applyChatMemoryManagementPlanV1(f.scope, oldPlan, {kind: 'pin'})).rejects.toThrow('先依据原消息修正')
  await correctChatMemory({...await command(f.sessionId), memoryId: 'promise', replacementMemoryId: 'player-copy', content: '周五交还地图。', sourceEventSequences: [sent.sequence], evidenceExcerpt: '周五交还地图', reason: '据原话修正'})
  const pinPlan = await readChatMemoryManagementPlanV1(f.scope, f.sessionId, 'player-copy')
  await applyChatMemoryManagementPlanV1(f.scope, pinPlan, {kind: 'pin'})
  await expect(applyChatMemoryManagementPlanV1(f.scope, pinPlan, {kind: 'unpin'})).rejects.toThrow('已变化')
  await correctChatMemory({...await command(f.sessionId), memoryId: 'player-copy', replacementMemoryId: 'corrected', content: '周五交还地图。', sourceEventSequences: [sent.sequence], evidenceExcerpt: '周五交还地图', reason: '据原话修正'})
  await changeChatMemoryUse({...await command(f.sessionId), memoryId: 'corrected', action: 'disable', reason: '暂时停用'})
  const parent = await state(f.sessionId)
  expect(parent.memories[2]).toMatchObject({playerPinned: true, status: 'disabled'})
  expect(parent.chatNarrative).toEqual(original.chatNarrative)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: '固定记忆分支'})
  await deleteProductRuntimeSession(f.sessionId)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === '固定记忆分支')!
  expect((await state(imported.id!)).memories[2]).toMatchObject({playerPinned: true, status: 'disabled'})
  await changeChatMemoryUse({...await command(imported.id!), memoryId: 'corrected', action: 'unpin', reason: '取消固定'})
  expect((await state(imported.id!)).memories[2]).not.toHaveProperty('playerPinned')
  expect((await state(child.id!)).memories[2].playerPinned).toBe(true)
  const malformed = structuredClone(parent); (malformed.memories[2] as {playerPinned?: unknown}).playerPinned = false
  expect(() => parseInteractionState(malformed)).toThrow('固定设置无效')
})

it('delivers selected memory through the registered Harness and shows only reviewed or player-authored historical selection evidence', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxMemoryEntries: 40})
  const sent = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'memory-source', text: '我约好交还靛蓝地图，地点是北侧石墙。'})
  for (let i = 0; i < 25; i++) {
    await proposeInteractionMemory({...await command(f.sessionId), memoryId: `old-${i}`, participantKey: 'guard', kind: 'commitment', content: 'PRIVATE-UNCHECKED 海岸渔船刷漆的约定。'.repeat(90), importance: 100, sourceEventSequences: [sent.sequence], evidenceExcerpt: '靛蓝地图'})
    await resolveInteractionMemory({...await command(f.sessionId), memoryId: `old-${i}`, resolution: 'accepted'})
  }
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'new', participantKey: 'guard', kind: 'commitment', content: '旧的未检查摘要', importance: 1, sourceEventSequences: [sent.sequence], evidenceExcerpt: '靛蓝地图'})
  const corrected = await correctChatMemory({...await command(f.sessionId), memoryId: 'new', replacementMemoryId: 'relevant', content: '约好在北侧石墙交还靛蓝地图。', sourceEventSequences: [sent.sequence], evidenceExcerpt: '北侧石墙', reason: '据原话填写'})
  await endInteractionScene({...await command(f.sessionId), sceneId: 'inn.current', reason: '暂别后返回'})
  const returned = await startInteractionScene({...await command(f.sessionId), sceneId: 'inn.return', sceneKey: 'inn'})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: returned.sequence})
  let calls = 0
  const result = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '依据承诺继续演绎',
    runAI: withChatActionChoiceFixture(async messages => {calls++; expect(JSON.stringify(messages)).toContain('约好在北侧石墙交还靛蓝地图'); return JSON.stringify({kind: 'speak', text: '我先核对靛蓝地图，再继续找铜印。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})}),
    runReviewAI: async messages => {calls++; expect(JSON.stringify(messages)).toContain('约好在北侧石墙交还靛蓝地图'); return JSON.stringify({...chatActionReviewOutputFixture(), memoryChecks: [{memoryId: 'relevant', sourceSequence: corrected.sequence, passed: true, reason: '注入的工程判定。'}]})}})
  const inspected = await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)
  expect(inspected.available).toBe(true)
  if (inspected.available) expect(inspected.selection?.memories).toContainEqual({content: '约好在北侧石墙交还靛蓝地图。', included: true, reason: 'pending-correction'})
  expect(JSON.stringify(inspected)).not.toContain('PRIVATE-UNCHECKED')
  expect(calls).toBe(2)
})
