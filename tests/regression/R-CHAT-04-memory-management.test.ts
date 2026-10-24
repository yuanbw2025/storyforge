import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {seedChatRuntimeFixture} from '../helpers/character-chat-fixture'
import {applyChatMemoryManagementPlanV1, chatMemoryPlayerViewV1, readChatMemoryManagementPlanV1} from '../../src/lib/character-interaction/memory-management'
import {commitInteractionPlayerMessage, proposeInteractionMemory, readProductRuntimeState, readProductRuntimeStateVersion, resolveInteractionMemory} from '../../src/lib/character-interaction/runtime-api'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})
const state = async (id: number) => (await readProductRuntimeState(id)).interaction!
async function command(id: number) {const v = await readProductRuntimeStateVersion(id); return {sessionId: id, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
async function fixture(accepted = true) {
  const f = await seedChatNarrativeRuntimeFixture({maxMemoryEntries: 1})
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'friday', text: '我约好周五再来。'})
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'old', participantKey: 'guard', kind: 'commitment', content: '夹带秘密：担心再次错怪人。误记为周二再来。', importance: 90,
    sourceEventSequences: [message.sequence], evidenceExcerpt: '周五再来'})
  if (accepted) await resolveInteractionMemory({...await command(f.sessionId), memoryId: 'old', resolution: 'accepted'})
  return {...f, message, read: (id = 'old') => readChatMemoryManagementPlanV1(f.scope, f.sessionId, id)}
}

it('projects visible sources without unchecked body or reviewer proof and applies only explicit control and corrected text', async () => {
  const f = await fixture(), before = await state(f.sessionId), runs = await db.agentRuns.count()
  const plan = await f.read()
  expect(plan.memory.content).toBeNull()
  expect(JSON.stringify(plan)).not.toContain('担心再次错怪人')
  expect(plan.memory.sources[0].text).toBe('我约好周五再来。')
  await applyChatMemoryManagementPlanV1(f.scope, plan, {kind: 'disable'})
  expect(buildInteractionContextWindow(await state(f.sessionId), 'guard').memories).toEqual([])
  await applyChatMemoryManagementPlanV1(f.scope, await f.read(), {kind: 'correct', content: '玩家约好周五再来。', sourceEventSequences: [f.message.sequence], evidenceExcerpt: '周五再来', reason: '修正错误日期'})
  const current = await state(f.sessionId), replacement = current.memories[1]
  expect(current.memories[0].status).toBe('superseded')
  expect(replacement).toMatchObject({status: 'disabled', authorship: 'player-correction'})
  expect(chatMemoryPlayerViewV1(current, replacement)?.content).toBe('玩家约好周五再来。')
  expect(JSON.stringify(current.chatNarrative)).toBe(JSON.stringify(before.chatNarrative))
  expect(current.relationshipHistory).toEqual(before.relationshipHistory)
  await applyChatMemoryManagementPlanV1(f.scope, await f.read(replacement.memoryId), {kind: 'enable'})
  expect(buildInteractionContextWindow(await state(f.sessionId), 'guard').memories.map(m => m.content)).toEqual(['玩家约好周五再来。'])
  await applyChatMemoryManagementPlanV1(f.scope, await f.read(replacement.memoryId), {kind: 'revoke'})
  expect(buildInteractionContextWindow(await state(f.sessionId), 'guard').memories).toEqual([])
  await expect(applyChatMemoryManagementPlanV1(f.scope, await f.read(replacement.memoryId), {kind: 'enable'})).rejects.toThrow('已变化')
  expect(await db.agentRuns.count()).toBe(runs)
})

it('lets a player rewrite an unchecked proposal from actual sources and explicitly adopt their own correction', async () => {
  const f = await fixture(false), plan = await f.read()
  await expect(applyChatMemoryManagementPlanV1(f.scope, plan, {kind: 'accept'})).rejects.toThrow('尚未完成正文检查')
  await applyChatMemoryManagementPlanV1(f.scope, plan, {kind: 'correct', content: '玩家说约好周五再来。', sourceEventSequences: [f.message.sequence], evidenceExcerpt: '周五再来', reason: '根据原话重写'})
  const current = await state(f.sessionId)
  expect(current.memories.map(m => m.status)).toEqual(['superseded', 'accepted'])
  expect(current.memories[1].authorship).toBe('player-correction')
  expect(current.memories[1]).not.toHaveProperty('contentReview')
  expect(buildInteractionContextWindow(current, 'guard').memories[0].content).toBe('玩家说约好周五再来。')
})

it('does not bypass active capacity when a proposed memory is manually corrected and accepted', async () => {
  const f = await fixture()
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'proposal', participantKey: 'guard', kind: 'commitment', content: '另一条提议', importance: 40, sourceEventSequences: [f.message.sequence], evidenceExcerpt: '周五再来'})
  const before = await state(f.sessionId)
  await expect(applyChatMemoryManagementPlanV1(f.scope, await f.read('proposal'), {kind: 'correct', content: '玩家说周五再来', sourceEventSequences: [f.message.sequence], evidenceExcerpt: '周五再来', reason: '重写'})).rejects.toThrow('上限')
  expect(await state(f.sessionId)).toEqual(before)
})

it('supports existing non-narrative chat memory controls without changing its frozen package or granting another product access', async () => {
  const f = await seedChatRuntimeFixture(), initial = await state(f.sessionId)
  expect(initial.chatNarrative).toBeUndefined()
  const text = initial.messages.find(m => m.eventSequence === f.playerSequence)!.text
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'legacy', participantKey: 'aria', kind: 'key-memory', content: '旧摘要', importance: 60, sourceEventSequences: [f.playerSequence], evidenceExcerpt: text})
  await resolveInteractionMemory({...await command(f.sessionId), memoryId: 'legacy', resolution: 'accepted'})
  const read = () => readChatMemoryManagementPlanV1(f.scope, f.sessionId, 'legacy')
  await applyChatMemoryManagementPlanV1(f.scope, await read(), {kind: 'disable'})
  expect((await state(f.sessionId)).memories[0].status).toBe('disabled')
  await applyChatMemoryManagementPlanV1(f.scope, await read(), {kind: 'enable'})
  expect((await state(f.sessionId)).memories[0].status).toBe('accepted')
  expect((await state(f.sessionId)).chatNarrative).toBeUndefined()
  await db.productRuntimeSessions.update(f.sessionId, {kind: 'ai-town'})
  await expect(read()).rejects.toThrow('角色聊天')
})

it('rejects stale or cross-Work plans and invalid evidence without changing stored memory', async () => {
  const f = await fixture(), plan = await f.read()
  const other = await seedChatNarrativeRuntimeFixture()
  await expect(applyChatMemoryManagementPlanV1(other.scope, plan, {kind: 'disable'})).rejects.toThrow()
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'later', text: '先等等。'})
  const before = await state(f.sessionId)
  await expect(applyChatMemoryManagementPlanV1(f.scope, plan, {kind: 'disable'})).rejects.toThrow('已变化')
  for (const extra of [{sourceEventSequences: [999999], evidenceExcerpt: '周五'}, {sourceEventSequences: [f.message.sequence], evidenceExcerpt: '从未说过'}]) {
    await expect(applyChatMemoryManagementPlanV1(f.scope, await f.read(), {kind: 'correct', content: '新摘要', reason: '纠正', ...extra})).rejects.toThrow()
  }
  expect(await state(f.sessionId)).toEqual(before)
})

it('omits private history and still exposes shared replaced sources for stopping use, never for new corrections', async () => {
  const f = await fixture(), current = await state(f.sessionId), memory = current.memories[0]
  current.messages[0].speakerKey = 'guard'; current.messages[0].audienceKeys = ['guard']
  expect(chatMemoryPlayerViewV1(current, memory)).toBeNull()
  current.messages[0].audienceKeys = ['guard', 'player']; current.messages[0].supersededBySequence = 50
  expect(chatMemoryPlayerViewV1(current, memory)?.sources[0]).toMatchObject({replaced: true, text: '我约好周五再来。'})
  expect(chatMemoryPlayerViewV1(current, memory)?.content).toBeNull()
})
