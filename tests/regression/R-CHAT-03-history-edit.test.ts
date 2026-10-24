import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {applyChatMessageEditV1, forkChatMessageEditV1, readChatMessageEditPlanV1} from '../../src/lib/character-interaction/narrative-edit'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, deleteProductRuntimeSession, proposeInteractionMemory, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, resolveInteractionMemory, updateChatMessageEditDraft} from '../../src/lib/character-interaction/runtime-api'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open(); store.setState({scope: null, selectedSessionId: null, busy: false})})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const realGenerate = harness.generateInteractionRuntimeCandidateV1
function action(text = '我把灯移到门边。门边亮了起来。'): ChatNarrativeActionV1 {
  return {kind: 'complete', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}], disclosures: [], threadUpdates: [], goalStatus: null}
}
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
async function history() {
  const f = await seedChatNarrativeRuntimeFixture()
  const player = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'player-old', text: '请先看门边。', audienceKeys: ['guard']})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: player.sequence})
  const generated = await realGenerate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '原路径',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action())), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  const committed = await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const message = (await readProductRuntimeState(f.sessionId)).interaction!.messages.at(-1)!
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'after-light', participantKey: 'guard', kind: 'key-memory', content: '我把灯移到门边。', importance: 8, sourceEventSequences: [committed.event!.sequence], evidenceExcerpt: '我把灯移到门边。'})
  await resolveInteractionMemory({...await command(f.sessionId), memoryId: 'after-light', resolution: 'accepted'})
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'future-message', text: '未来内容不应进入改写上下文。'})
  return {...f, player, message, oldRunId: generated.snapshot.run.id}
}

it('saves a player edit draft atomically with the branch and drops the entire later causal suffix', async () => {
  const f = await history(), parent = await readProductRuntimeState(f.sessionId), events = await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray()
  const plan = await readChatMessageEditPlanV1(f.scope, f.sessionId, 'player-old')
  expect(plan.removedMessageCount).toBe(3)
  const child = await forkChatMessageEditV1({scope: f.scope, plan, text: '不用看门边，我们先休息。'})
  let state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.messages).toEqual([])
  expect(state.memories).toEqual([])
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'lit-door')).toBe(false)
  expect(state.chatNarrative!.pendingEdit).toMatchObject({role: 'player', audienceKeys: ['player', 'guard'], text: '不用看门边，我们先休息。'})
  db.close(); await db.open()
  await applyChatMessageEditV1({scope: f.scope, sessionId: child.id!, expectedSequence: (await readProductRuntimeStateVersion(child.id!)).sequence, text: '不用看门边，我们先休息。'})
  state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.messages.map(m => [m.text, m.audienceKeys])).toEqual([['不用看门边，我们先休息。', ['player', 'guard']]])
  expect(state.chatNarrative!.pendingEdit).toBeUndefined()
  expect(state.totalPlayerTurns).toBe(1)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(parent)
  expect(await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray()).toEqual(events)
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(child.id!).count()).toBe(0)
  expect((await db.agentRuns.get(f.oldRunId))!.productRuntimeSessionId).toBe(f.sessionId)
})

it('reconciles exact edited character text through the existing action and review contract with no future evidence', async () => {
  const f = await history(), parent = await readProductRuntimeState(f.sessionId), text = '我先坐下听你说。'
  const child = await forkChatMessageEditV1({scope: f.scope, plan: await readChatMessageEditPlanV1(f.scope, f.sessionId, f.message.messageId), text})
  const seen: string[] = []
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(i => realGenerate({...i, runAI: withChatActionChoiceFixture(async messages => {
    seen.push(JSON.stringify(messages)); return JSON.stringify({...action(text), kind: 'pause', newFacts: [], goalStatus: 'paused', nextPossibilities: []})
  }), runReviewAI: async messages => {seen.push(JSON.stringify(messages)); return JSON.stringify(chatActionReviewOutputFixture())}}))
  await applyChatMessageEditV1({scope: f.scope, sessionId: child.id!, expectedSequence: (await readProductRuntimeStateVersion(child.id!)).sequence, text, aiConfig: {} as never})
  const state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.messages.map(m => m.text)).toEqual(['请先看门边。', text])
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'lit-door')).toBe(false)
  expect(state.memories).toEqual([])
  expect(state.chatNarrative!.pendingEdit).toBeUndefined()
  expect(seen).toHaveLength(2)
  expect(seen.every(s => s.includes(text) && !s.includes('未来内容') && !s.includes('门边亮了起来'))).toBe(true)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(parent)
})

it.each(['text', 'audience', 'review'])('rejects a %s mismatch without committing the edited expression or restoring old consequences', async mismatch => {
  const f = await history(), text = '我先坐下听你说。'
  const child = await forkChatMessageEditV1({scope: f.scope, plan: await readChatMessageEditPlanV1(f.scope, f.sessionId, f.message.messageId), text})
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(i => realGenerate({...i,
    runAI: withChatActionChoiceFixture(async () => JSON.stringify({...action(mismatch === 'text' ? text + '我又站起来。' : text), kind: 'pause', newFacts: [], audienceKeys: mismatch === 'audience' ? ['guard', 'player', 'artisan'] : ['guard', 'player']})),
    runReviewAI: async () => {const result = chatActionReviewOutputFixture(); result.checks[0].passed = false; return JSON.stringify(result)}}))
  await expect(applyChatMessageEditV1({scope: f.scope, sessionId: child.id!, expectedSequence: (await readProductRuntimeStateVersion(child.id!)).sequence, text, aiConfig: {} as never})).rejects.toThrow()
  const state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.messages.map(m => m.text)).toEqual(['请先看门边。'])
  expect(state.chatNarrative!.pendingEdit!.text).toBe(text)
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'lit-door')).toBe(false)
})

it('finds an inherited message through nested branches and preserves a pending edit through export and import', async () => {
  const f = await history()
  const first = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'first'})
  const second = await branchProductRuntimeSession({parentSessionId: first.id!, throughSequence: (await readProductRuntimeStateVersion(first.id!)).sequence, title: 'second'})
  const plan = await readChatMessageEditPlanV1(f.scope, second.id!, f.message.messageId)
  expect(plan.sourceSessionId).toBe(f.sessionId)
  const child = await forkChatMessageEditV1({scope: f.scope, plan, text: '先等一下。', title: 'edited'})
  const before = (await readProductRuntimeState(child.id!)).interaction!
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === 'edited')!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(before)
  await store.getState().load({projectId, worldId: imported.worldId, workId: imported.workId}, null, imported.id!)
  expect(store.getState().runtimeState.interaction!.chatNarrative!.pendingEdit!.text).toBe('先等一下。')
  await store.getState().cancelMessageEdit()
  expect(store.getState().runtimeState.interaction!.chatNarrative!.pendingEdit).toBeUndefined()
  expect(store.getState().runtimeState.interaction!.messages).toHaveLength(1)
})

it('rejects stale previews and invalid cut points before creating a child', async () => {
  const f = await history(), plan = await readChatMessageEditPlanV1(f.scope, f.sessionId, f.message.messageId), count = await db.productRuntimeSessions.count()
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'late', text: '稍等。'})
  await expect(forkChatMessageEditV1({scope: f.scope, plan, text: '修改'})).rejects.toThrow('时间线已变化')
  await expect(branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: plan.sourceSequence, title: 'wrong', intent: {kind: 'character-chat-message-edit', sourceMessageId: f.message.messageId, text: '修改'}})).rejects.toThrow('改写点')
  expect(await db.productRuntimeSessions.count()).toBe(count)
})

it('preserves inherited reading after ancestor deletion but refuses to invent the missing pre-message history', async () => {
  const f = await history(), child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'orphan'})
  const before = (await readProductRuntimeState(child.id!)).interaction
  await deleteProductRuntimeSession(f.sessionId)
  expect((await readProductRuntimeState(child.id!)).interaction).toEqual(before)
  await expect(readChatMessageEditPlanV1(f.scope, child.id!, f.message.messageId)).rejects.toThrow('原始时间线')
})

it('keeps a pending edit across another branch and cancels its uncommitted portion on player interruption', async () => {
  const f = await history(), child = await forkChatMessageEditV1({scope: f.scope, plan: await readChatMessageEditPlanV1(f.scope, f.sessionId, f.message.messageId), text: '先暂停。'})
  await updateChatMessageEditDraft({...await command(child.id!), text: '我在这里等。'})
  const nested = await branchProductRuntimeSession({parentSessionId: child.id!, throughSequence: (await readProductRuntimeStateVersion(child.id!)).sequence, title: 'pending nested'})
  expect((await readProductRuntimeState(nested.id!)).interaction!.chatNarrative!.pendingEdit!.requestedSequence).toBeLessThan(0)
  await commitInteractionPlayerMessage({...await command(nested.id!), messageId: 'interrupt', text: '换个话题。'})
  expect((await readProductRuntimeState(nested.id!)).interaction!.chatNarrative!.pendingEdit).toBeUndefined()
})

it('cuts knowledge disclosures, relationship changes, goals, beliefs and plans at the same edit boundary', async () => {
  const f = await seedChatNarrativeRuntimeFixture({relationships: true})
  const player = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'evidence', text: '先核对证据。'})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: player.sequence})
  const project = (state: Awaited<ReturnType<typeof readProductRuntimeState>>) => ({
    facts: state.interaction!.chatNarrative!.situation.facts.map(f => [f.factKey, f.audienceKeys]),
    goals: state.interaction!.chatNarrative!.situation.goals.map(g => [g.goalKey, g.status]),
    threads: state.interaction!.chatNarrative!.situation.threads.map(t => [t.threadKey, t.status]),
    beliefs: state.interaction!.chatNarrative!.situation.beliefs.map(b => [b.beliefKey, b.text]),
    plans: state.interaction!.chatNarrative!.situation.possibilities,
    attitudes: state.interaction!.relationships.map(r => [r.dimensionKey, r.value]),
    attitudeHistoryCount: state.interaction!.relationshipHistory.length,
  })
  const before = project(await readProductRuntimeState(f.sessionId))
  const draft: ChatNarrativeActionV1 = {...action('铜印已经找到。寻找就此结束。我撤回借用猜测。我更愿意听取你的判断。叶岑曾误指控一位无辜旅人，始终后悔。'),
    newFacts: [{factKey: 'found', kind: 'observation', text: '铜印已经找到。', evidenceFactKeys: ['lost'], evidenceExcerpt: '铜印已经找到。'}],
    audienceKeys: ['guard', 'player', 'artisan'],
    disclosures: [{factKey: 'regret', toParticipantKeys: ['player', 'artisan'], evidenceExcerpt: '叶岑曾误指控一位无辜旅人，始终后悔。', wording: 'equivalent'}],
    goalStatus: 'fulfilled', threadUpdates: [{threadKey: 'investigate', status: 'resolved', evidenceExcerpt: '寻找就此结束。'}],
    nextPossibilities: [], beliefUpdates: [{beliefKey: 'borrowed', text: null, evidenceFactKeys: ['found']}],
    relationshipUpdates: [{dimensionKey: 'trust', delta: 1, sourceEventSequence: player.sequence, playerExcerpt: '先核对证据。', evidenceExcerpt: '我更愿意听取你的判断'}]}
  const run = await realGenerate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '原路径',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)), runReviewAI: async () => JSON.stringify({...chatActionReviewOutputFixture(), disclosureChecks: [{factKey: 'regret', passed: true, reason: '工程披露复核，不代表真实语义质量。'}]})})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: run.snapshot.run.id})
  const old = await readProductRuntimeState(f.sessionId)
  expect(project(old)).not.toEqual(before)
  const child = await forkChatMessageEditV1({scope: f.scope, plan: await readChatMessageEditPlanV1(f.scope, f.sessionId, old.interaction!.messages.at(-1)!.messageId), text: '我先坐下听你说。'})
  expect(project(await readProductRuntimeState(child.id!))).toEqual(before)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(old)
})

it('recovers the retained edited draft review without generating another expression or reusing old consequences', async () => {
  const f = await history(), text = '我先坐下听你说。'
  const child = await forkChatMessageEditV1({scope: f.scope, plan: await readChatMessageEditPlanV1(f.scope, f.sessionId, f.message.messageId), text})
  let calls = 0, runId = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(i => realGenerate({...i,
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify({...action(text), kind: 'pause', newFacts: []})}),
    onNarrativeActionSaved: id => {runId = id; throw new Error('crash-before-review')}}))
  await expect(applyChatMessageEditV1({scope: f.scope, sessionId: child.id!, expectedSequence: (await readProductRuntimeStateVersion(child.id!)).sequence, text, aiConfig: {} as never})).rejects.toThrow('crash-before-review')
  db.close(); await db.open(); await store.getState().load(f.scope, null, child.id!)
  expect(store.getState().pendingNarrativeReviewRunIds).toEqual([runId])
  const resume = harness.resumeChatNarrativeReviewV1
  vi.spyOn(harness, 'resumeChatNarrativeReviewV1').mockImplementation(i => resume({...i, runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())}}))
  await store.getState().resumeNarrativeReview(runId, {} as never)
  expect(calls).toBe(2)
  expect(store.getState().runtimeState.interaction!.messages.at(-1)!.text).toBe(text)
  expect(store.getState().runtimeState.interaction!.chatNarrative!.pendingEdit).toBeUndefined()
})

it('rejects a foreign scope and a role-generation request bound to another edit revision before a model call', async () => {
  const f = await history(), other = await seedChatNarrativeRuntimeFixture()
  await expect(readChatMessageEditPlanV1(other.scope, f.sessionId, f.message.messageId)).rejects.toThrow()
  const child = await forkChatMessageEditV1({scope: f.scope, plan: await readChatMessageEditPlanV1(f.scope, f.sessionId, f.message.messageId), text: '我先听你说。'})
  const runAI = vi.fn(async () => JSON.stringify({...action(), newFacts: []}))
  await expect(realGenerate({scope: f.scope, productRuntimeSessionId: child.id!, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: 'stale edit', narrativeEditSequence: 999, runAI})).rejects.toThrow('另一操作')
  expect(runAI).not.toHaveBeenCalled()
})
