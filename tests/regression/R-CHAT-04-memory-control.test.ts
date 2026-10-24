import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {applyInteractionEvent, buildInteractionContextWindow, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, changeChatMemoryUse, commitInteractionPlayerMessage, correctChatMemory, deleteProductRuntimeSession, proposeInteractionMemory, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, resolveInteractionMemory} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
const state = async (id: number) => (await readProductRuntimeState(id)).interaction!
const oldContent = '记错了：玩家约定周二再来。'
const corrected = '约定是周五再来，不是周二。'
async function start() {
  const f = await seedChatNarrativeRuntimeFixture({maxMemoryEntries: 1})
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'friday', text: '我约好周五再来。'})
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'promise', participantKey: 'guard', kind: 'commitment', content: oldContent,
    importance: 95, sourceEventSequences: [message.sequence], evidenceExcerpt: '周五再来'})
  await resolveInteractionMemory({...await command(f.sessionId), memoryId: 'promise', resolution: 'accepted'})
  return {...f, message}
}
async function correction(f: Awaited<ReturnType<typeof start>>, memoryId = 'promise', replacementMemoryId = 'corrected') {
  return {...await command(f.sessionId), memoryId, replacementMemoryId, content: corrected, sourceEventSequences: [f.message.sequence], evidenceExcerpt: '周五再来', reason: '修正约定日期的摘要错误'}
}
async function control(sessionId: number, memoryId: string, action: 'disable' | 'enable' | 'revoke') {
  return changeChatMemoryUse({...await command(sessionId), memoryId, action, reason: '玩家明确调整这条记忆的使用'})
}
async function generated(f: Awaited<ReturnType<typeof start>>) {
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: v.sequence})
  return generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '记忆后续输入工程检查',
    runAI: withChatActionChoiceFixture(async messages => {
      expect(JSON.stringify(messages)).toContain(oldContent)
      return JSON.stringify({kind: 'speak', text: '我先继续查看门边。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
        audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
    }), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
}

it('disables and explicitly restores both actor and coordinator memory retrieval without changing facts, goals or relations', async () => {
  const f = await start(), before = await state(f.sessionId)
  expect(buildInteractionContextWindow(before, 'guard').memories.map(m => m.content)).toEqual([oldContent])
  await control(f.sessionId, 'promise', 'disable')
  const disabled = await state(f.sessionId)
  expect(buildInteractionContextWindow(disabled, 'guard').memories).toEqual([])
  expect(selectChatCoordinatorContextV1(disabled)).not.toContain(oldContent)
  expect(disabled.memories[0]).toMatchObject({status: 'disabled', content: oldContent})
  expect(disabled.chatNarrative).toEqual(before.chatNarrative)
  expect(disabled.relationships).toEqual(before.relationships)
  expect(disabled.messages).toEqual(before.messages)
  db.close(); await db.open()
  expect((await state(f.sessionId)).memories).toEqual(disabled.memories)
  await control(f.sessionId, 'promise', 'enable')
  expect(buildInteractionContextWindow(await state(f.sessionId), 'guard').memories.map(m => m.content)).toEqual([oldContent])
  await control(f.sessionId, 'promise', 'revoke')
  await expect(control(f.sessionId, 'promise', 'enable')).rejects.toThrow('已变化')
  expect((await state(f.sessionId)).memories[0]).toMatchObject({status: 'revoked', content: oldContent})
})

it('atomically corrects an entry at capacity, preserves its history and uses only the replacement in subsequent context', async () => {
  const f = await start(), before = await state(f.sessionId), input = await correction(f)
  const event = await correctChatMemory(input)
  expect((await correctChatMemory(input)).id).toBe(event.id)
  const after = await state(f.sessionId)
  expect(after.memories).toHaveLength(2)
  expect(after.memories[0]).toMatchObject({status: 'superseded', content: oldContent, supersededByMemoryId: 'corrected', decisionSequence: event.sequence})
  expect(after.memories[1]).toMatchObject({status: 'accepted', content: corrected, kind: 'commitment', importance: 95, authorship: 'player-correction', proposalSequence: event.sequence, decisionSequence: event.sequence})
  expect(buildInteractionContextWindow(after, 'guard').memories.map(m => m.content)).toEqual([corrected])
  expect(selectChatCoordinatorContextV1(after)).not.toContain(oldContent)
  expect(after.chatNarrative).toEqual(before.chatNarrative)
  expect(after.messages).toEqual(before.messages)
  expect(after.relationshipHistory).toEqual(before.relationshipHistory)
  expect(await db.productRuntimeEvents.where('[sessionId+commandId]').equals([f.sessionId, input.commandId]).count()).toBe(1)
  await expect(correctChatMemory({...input, commandId: crypto.randomUUID()})).rejects.toThrow('状态已变化')
})

it('keeps a corrected disabled entry disabled and enforces capacity when the player explicitly re-enables it', async () => {
  const f = await start()
  await control(f.sessionId, 'promise', 'disable')
  await correctChatMemory(await correction(f))
  expect((await state(f.sessionId)).memories[1].status).toBe('disabled')
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'other', participantKey: 'guard', kind: 'key-memory', content: '另一个已确认摘要', importance: 30,
    sourceEventSequences: [f.message.sequence], evidenceExcerpt: '周五再来'})
  await resolveInteractionMemory({...await command(f.sessionId), memoryId: 'other', resolution: 'accepted'})
  await expect(control(f.sessionId, 'corrected', 'enable')).rejects.toThrow('上限')
  await control(f.sessionId, 'other', 'disable')
  await control(f.sessionId, 'corrected', 'enable')
  expect(buildInteractionContextWindow(await state(f.sessionId), 'guard').memories.map(m => m.content)).toEqual([corrected])
})

it('does not adopt an action generated against the old memory after a correction', async () => {
  const f = await start(), result = await generated(f)
  const correctedEvent = await correctChatMemory(await correction(f))
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})).rejects.toThrow()
  expect((await state(f.sessionId)).messages.filter(m => m.role === 'character')).toEqual([])
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: v.sequence})
  let reads = 0
  const fresh = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '读取更正后的记忆',
    runAI: withChatActionChoiceFixture(async messages => {
      reads++
      expect(JSON.stringify(messages)).toContain(corrected)
      expect(JSON.stringify(messages)).not.toContain(oldContent)
      return JSON.stringify({kind: 'speak', text: '我先继续查看门边。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
    }), runReviewAI: async messages => {
      reads++
      expect(JSON.stringify(messages)).toContain(corrected)
      expect(JSON.stringify(messages)).not.toContain(oldContent)
      return JSON.stringify({...chatActionReviewOutputFixture(), memoryChecks: [{memoryId: 'corrected', sourceSequence: correctedEvent.sequence, passed: true, reason: '注入判定仅验证新修正输入与状态链路。'}]})
    }})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: fresh.snapshot.run.id})
  expect(reads).toBe(2)
  expect((await state(f.sessionId)).messages.filter(m => m.role === 'character')).toHaveLength(1)
})

it('rejects private sources, nonexistent evidence and duplicate replacement identities without partial state changes', async () => {
  const f = await start(), before = await state(f.sessionId), count = await db.productRuntimeEvents.count()
  // The current single-role v3 action path always includes the player. Test
  // the reducer boundary directly for private history without weakening that
  // separate contract or pretending such a private action was accepted.
  const privateState = structuredClone(before)
  privateState.messages.push({...before.messages[0], messageId: 'private', eventSequence: -1, role: 'character', speakerKey: 'guard', audienceKeys: ['guard'], text: '私下记下'})
  privateState.memories.push({...before.memories[0], memoryId: 'private', sourceEventSequences: [-1], evidenceExcerpt: '私下记下'})
  const base = await command(f.sessionId)
  const event = {projectId: f.scope.projectId, sessionId: f.sessionId, sequence: base.baseSequence + 1, actorKey: 'player', targetKey: 'private',
    commandId: base.commandId, baseSequence: base.baseSequence, baseStateHash: base.baseStateHash, createdAt: Date.now()}
  expect(() => applyInteractionEvent(structuredClone(privateState), {...event, type: 'interaction.narrative.memory-control.changed',
    payloadJson: JSON.stringify({...base, memoryId: 'private', action: 'disable', reason: '玩家操作'})})).toThrow('来源不可见')
  expect(() => applyInteractionEvent(structuredClone(privateState), {...event, type: 'interaction.narrative.memory.corrected',
    payloadJson: JSON.stringify({...base, memoryId: 'promise', replacementMemoryId: 'corrected', content: corrected,
      sourceEventSequences: [-1], evidenceExcerpt: '私下记下', reason: '玩家修正'})})).toThrow('玩家不可见')
  await expect(correctChatMemory({...await correction(f), evidenceExcerpt: '来源根本没有这句话'})).rejects.toThrow('无法在引用消息中验证')
  await expect(correctChatMemory({...await correction(f), sourceEventSequences: [999999]})).rejects.toThrow()
  await expect(correctChatMemory({...await correction(f), replacementMemoryId: 'promise'})).rejects.toThrow('ID 已使用')
  expect(await state(f.sessionId)).toEqual(before)
  expect(await db.productRuntimeEvents.count()).toBe(count)
})

it('preserves corrections and control history across branch rebasing, parent deletion and portable backup import', async () => {
  const f = await start(), worldBefore = await db.worldReleases.toArray()
  await correctChatMemory(await correction(f))
  await control(f.sessionId, 'corrected', 'disable')
  const parent = await state(f.sessionId)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'memory child'})
  const inherited = await state(child.id!)
  expect(inherited.memories[1]).toMatchObject({status: 'disabled', authorship: 'player-correction', content: corrected})
  expect(inherited.memories[1].sourceEventSequences[0]).toBeLessThan(0)
  await control(child.id!, 'corrected', 'enable')
  expect(await state(f.sessionId)).toEqual(parent)
  await deleteProductRuntimeSession(f.sessionId)
  expect((await state(child.id!)).memories[1].status).toBe('accepted')
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === 'memory child')!
  expect((await state(imported.id!)).memories).toEqual((await state(child.id!)).memories)
  await control(imported.id!, 'corrected', 'revoke')
  expect((await state(child.id!)).memories[1].status).toBe('accepted')
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worldBefore)
  await deleteProductRuntimeSession(imported.id!)
  expect(await db.productRuntimeEvents.where('sessionId').equals(imported.id!).count()).toBe(0)
})

it('keeps legacy memory serialization unchanged and rejects invented authorship', async () => {
  const f = await start(), original = await state(f.sessionId)
  expect(parseInteractionState(original)).toEqual(original)
  expect(original.memories[0]).not.toHaveProperty('authorship')
  expect(() => parseInteractionState({...original, memories: [{...original.memories[0], authorship: 'already-reviewed'}]})).toThrow('内容来源')
  const second = await seedChatNarrativeRuntimeFixture()
  await expect(control(second.sessionId, 'promise', 'disable')).rejects.toThrow('已变化')
  await db.productRuntimeSessions.update(f.sessionId, {kind: 'ai-town'})
  await expect(control(f.sessionId, 'promise', 'disable')).rejects.toThrow('只属于角色聊天')
})
