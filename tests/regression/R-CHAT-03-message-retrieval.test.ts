import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {applyChatMessageRetrievalPlanV1, readChatMessageRetrievalPlanV1} from '../../src/lib/character-interaction/narrative-retrieval-service'
import {buildInteractionContextWindow, interactionVisibilityView, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {chatSituationCoordinatorViewV1} from '../../src/lib/character-interaction/narrative-situations'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, deleteProductRuntimeSession, proposeInteractionMemory, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, resolveInteractionMemory, setChatMessageRetrieval} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const original = '检索标记甲：我把灯移到门边。门边亮了起来。'
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
function action(): ChatNarrativeActionV1 {
  return {kind: 'complete', text: original, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}], disclosures: [], threadUpdates: [], goalStatus: null}
}
async function history() {
  const f = await seedChatNarrativeRuntimeFixture()
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const candidate = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '原路径',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action())), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id})
  const message = (await readProductRuntimeState(f.sessionId)).interaction!.messages[0]
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'light', participantKey: 'guard', kind: 'key-memory', content: '记住门边的光亮。', importance: 8,
    sourceEventSequences: [message.eventSequence], evidenceExcerpt: '门边亮了起来。'})
  await resolveInteractionMemory({...await command(f.sessionId), memoryId: 'light', resolution: 'accepted'})
  return {...f, message}
}

it('omits only selected dialogue from both registered model views, retaining visible history and established consequences', async () => {
  const f = await history(), before = (await readProductRuntimeState(f.sessionId)).interaction!
  const plan = await readChatMessageRetrievalPlanV1(f.scope, f.sessionId, f.message.messageId)
  expect(plan.retained).toEqual({facts: 1, threads: 0, memories: 1, relationships: 0})
  await applyChatMessageRetrievalPlanV1(f.scope, plan)
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.messages).toEqual(before.messages)
  expect(after.knowledge).toEqual(before.knowledge); expect(after.memories).toEqual(before.memories)
  expect(after.relationships).toEqual(before.relationships); expect(after.relationshipHistory).toEqual(before.relationshipHistory)
  expect(after.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(after.chatNarrative!.triggers).toEqual(before.chatNarrative!.triggers)
  expect(after.remainingDirectorBudget).toBe(before.remainingDirectorBudget)
  expect(interactionVisibilityView(after, 'player').messages[0].text).toBe(original)
  const view = buildInteractionContextWindow(after, 'guard')
  expect(view.messages).toEqual([]); expect(view.excludedMessageCount).toBe(1); expect(view.omittedMessageCount).toBe(0)
  expect(chatSituationCoordinatorViewV1(after).messages).toEqual([])
  expect(buildInteractionContextWindow(after, 'artisan').excludedMessageCount).toBeUndefined()
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence})
  const seen: string[] = []
  const result = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '继续自己的调查',
    runAI: withChatActionChoiceFixture(async messages => {seen.push(JSON.stringify(messages)); return JSON.stringify({...action(), kind: 'speak', text: '灯仍在门边，我先检查桌下。', newFacts: []})}),
    runReviewAI: async messages => {seen.push(JSON.stringify(messages)); return JSON.stringify(chatActionReviewOutputFixture())}})
  expect(seen).toHaveLength(2)
  expect(seen.every(s => !s.includes('检索标记甲') && s.includes('lit-door'))).toBe(true)
  expect(seen[0]).toContain('用户排除对话=1')
  expect(result.snapshot.contract.permissions.contextSourceKeys).toContain('interactionRuntime')
})

it('restores dialogue without changing effects or spending a model call', async () => {
  const f = await history(), before = (await readProductRuntimeState(f.sessionId)).interaction!, runs = await db.agentRuns.count()
  await applyChatMessageRetrievalPlanV1(f.scope, await readChatMessageRetrievalPlanV1(f.scope, f.sessionId, f.message.messageId))
  await applyChatMessageRetrievalPlanV1(f.scope, await readChatMessageRetrievalPlanV1(f.scope, f.sessionId, f.message.messageId))
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.chatNarrative!.excludedMessageIds).toBeUndefined()
  expect(buildInteractionContextWindow(after, 'guard').messages).toEqual(before.messages)
  expect(after.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(await db.agentRuns.count()).toBe(runs)
})

it('persists exclusions through nested branches, parent deletion and export/import; siblings can restore independently', async () => {
  const f = await history()
  await applyChatMessageRetrievalPlanV1(f.scope, await readChatMessageRetrievalPlanV1(f.scope, f.sessionId, f.message.messageId))
  const first = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'first'})
  const child = await branchProductRuntimeSession({parentSessionId: first.id!, throughSequence: (await readProductRuntimeStateVersion(first.id!)).sequence, title: 'excluded child'})
  await applyChatMessageRetrievalPlanV1(f.scope, await readChatMessageRetrievalPlanV1(f.scope, first.id!, f.message.messageId))
  await deleteProductRuntimeSession(f.sessionId)
  const childState = (await readProductRuntimeState(child.id!)).interaction!
  expect(childState.messages[0].eventSequence).toBeLessThan(0)
  expect(buildInteractionContextWindow(childState, 'guard').messages).toEqual([])
  expect(buildInteractionContextWindow((await readProductRuntimeState(first.id!)).interaction!, 'guard').messages).toHaveLength(1)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === 'excluded child')!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(childState)
  db.close(); await db.open()
  await applyChatMessageRetrievalPlanV1({projectId, worldId: imported.worldId, workId: imported.workId}, await readChatMessageRetrievalPlanV1({projectId, worldId: imported.worldId, workId: imported.workId}, imported.id!, f.message.messageId))
  expect(buildInteractionContextWindow((await readProductRuntimeState(imported.id!)).interaction!, 'guard').messages).toHaveLength(1)
})

it('rejects stale previews and concurrent opposite writes; command retry is idempotent', async () => {
  const f = await history(), plan = await readChatMessageRetrievalPlanV1(f.scope, f.sessionId, f.message.messageId), envelope = await command(f.sessionId)
  const input = {...envelope, messageId: f.message.messageId, excluded: true}
  const event = await setChatMessageRetrieval(input)
  expect(await setChatMessageRetrieval(input)).toEqual(event)
  await expect(setChatMessageRetrieval({...envelope, commandId: 'other', excluded: false, messageId: f.message.messageId})).rejects.toThrow('已变化')
  await expect(applyChatMessageRetrievalPlanV1(f.scope, plan)).rejects.toThrow('影响已变化')
})

it('invalidates an already reviewed candidate when the user changes retrieval before adoption', async () => {
  const f = await seedChatNarrativeRuntimeFixture()
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'old', text: '检索标记乙。'})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence})
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '继续',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action())), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await applyChatMessageRetrievalPlanV1(f.scope, await readChatMessageRetrievalPlanV1(f.scope, f.sessionId, 'old'))
  const before = await readProductRuntimeState(f.sessionId)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('never silently responds to an excluded player input, including a previously authorized trigger', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), player = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'input', text: '先等等。'})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: player.sequence})
  await applyChatMessageRetrievalPlanV1(f.scope, await readChatMessageRetrievalPlanV1(f.scope, f.sessionId, 'input'))
  const runAI = vi.fn(), count = await db.agentRuns.count()
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '回应', runAI})).rejects.toThrow('玩家消息已排除')
  expect(runAI).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(count)
  const latest = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'next', text: '可以继续。'})
  await applyChatMessageRetrievalPlanV1(f.scope, await readChatMessageRetrievalPlanV1(f.scope, f.sessionId, 'next'))
  await expect(requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: latest.sequence})).rejects.toThrow('排除上下文')
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence})
  expect(buildInteractionContextWindow((await readProductRuntimeState(f.sessionId)).interaction!, 'guard').messages).toEqual([])
})

it('rejects foreign scopes, missing/hidden messages and malformed saved selections', async () => {
  const f = await history()
  await expect(readChatMessageRetrievalPlanV1({...f.scope, projectId: f.scope.projectId + 500}, f.sessionId, f.message.messageId)).rejects.toThrow()
  await expect(setChatMessageRetrieval({...await command(f.sessionId), messageId: 'absent', excluded: true})).rejects.toThrow('可见消息不存在')
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  state.messages[0].audienceKeys = ['guard']
  state.chatNarrative!.excludedMessageIds = [f.message.messageId]
  expect(() => parseInteractionState(state)).toThrow('可见消息不存在')
  state.messages[0].audienceKeys = ['player', 'guard']
  state.chatNarrative!.excludedMessageIds = [f.message.messageId, f.message.messageId]
  expect(() => parseInteractionState(state)).toThrow('重复')
  state.chatNarrative!.excludedMessageIds = ['absent']
  expect(() => parseInteractionState(state)).toThrow('可见消息不存在')
  state.chatNarrative!.excludedMessageIds = [42 as never]
  expect(() => parseInteractionState(state)).toThrow('内容无效')
})
