import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {applyChatMessageEditV1, forkChatMessageEditV1, readChatMessageContinuationPlanV1} from '../../src/lib/character-interaction/narrative-edit'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, proposeInteractionMemory, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, resolveInteractionMemory, updateChatMessageEditDraft} from '../../src/lib/character-interaction/runtime-api'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open(); store.setState({scope: null, selectedSessionId: null, busy: false})})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const generate = harness.generateInteractionRuntimeCandidateV1
const prefix = '我信你愿意核对。我把灯移到门边，门边亮了起来。'
const suffix = '我再推开窗，窗户现在开着。'
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
function expression(sequence: number, continued = false): ChatNarrativeActionV1 {
  return {kind: 'complete', text: prefix + (continued ? suffix : ''), goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'},
      ...(continued ? [{factKey: 'open-window', kind: 'observation' as const, text: '窗户现在开着。', evidenceFactKeys: ['lost'], evidenceExcerpt: '窗户现在开着。'}] : [])],
    disclosures: [], threadUpdates: [], goalStatus: null,
    relationshipUpdates: [{dimensionKey: 'trust', delta: 1, sourceEventSequence: sequence, playerExcerpt: '我来核对账簿。', evidenceExcerpt: '我信你愿意核对。'}]}
}
async function original() {
  const f = await seedChatNarrativeRuntimeFixture({relationships: true})
  const player = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'player', text: '我来核对账簿。'})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: player.sequence})
  const generated = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '原回复',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(expression(player.sequence))), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const message = (await readProductRuntimeState(f.sessionId)).interaction!.messages.at(-1)!
  await proposeInteractionMemory({...await command(f.sessionId), memoryId: 'light', participantKey: 'guard', kind: 'key-memory', content: '记住门边的光亮。', importance: 8,
    sourceEventSequences: [message.eventSequence], evidenceExcerpt: '门边亮了起来。'})
  await resolveInteractionMemory({...await command(f.sessionId), memoryId: 'light', resolution: 'accepted'})
  return {...f, message, runId: generated.snapshot.run.id}
}
async function fork(f: Awaited<ReturnType<typeof original>>) {
  const plan = await readChatMessageContinuationPlanV1(f.scope, f.sessionId, f.message.messageId)
  return forkChatMessageEditV1({scope: f.scope, plan, text: plan.text})
}
async function complete(f: Awaited<ReturnType<typeof original>>, sessionId: number, mutate?: (a: ChatNarrativeActionV1) => ChatNarrativeActionV1, rejectedReview = false) {
  const state = (await readProductRuntimeState(sessionId)).interaction!
  const sequence = state.chatNarrative!.triggers.at(-1)!.sourceEventSequence
  const seen: string[] = []
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(i => generate({...i, runAI: withChatActionChoiceFixture(async messages => {
    seen.push(JSON.stringify(messages)); const action = expression(sequence, true); return JSON.stringify(mutate ? mutate(action) : action)
  }), runReviewAI: async messages => {seen.push(JSON.stringify(messages)); const review = chatActionReviewOutputFixture(); if (rejectedReview) review.checks[0].passed = false; return JSON.stringify(review)}}))
  await applyChatMessageEditV1({scope: f.scope, sessionId, expectedSequence: (await readProductRuntimeStateVersion(sessionId)).sequence, text: prefix, aiConfig: {} as never})
  return seen
}

it('continues the exact current expression in a recoverable branch, reconciles all effects once and preserves original history/cost ownership', async () => {
  const f = await original(), parent = await readProductRuntimeState(f.sessionId), child = await fork(f)
  let state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.chatNarrative!.pendingEdit).toMatchObject({mode: 'continue', text: prefix, requestedSequence: 0, actorKey: 'guard'})
  expect(state.messages.map(m => m.text)).toEqual(['我来核对账簿。'])
  expect(state.relationshipHistory).toHaveLength(0); expect(state.memories).toHaveLength(0)
  db.close(); await db.open()
  const seen = await complete(f, child.id!)
  expect(seen).toHaveLength(2); expect(seen[0]).toContain(prefix); expect(seen[0]).toContain('mode=continue')
  expect(seen[0]).not.toContain('柜台下')
  state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.messages.map(m => m.text)).toEqual(['我来核对账簿。', prefix + suffix])
  expect(state.chatNarrative!.pendingEdit).toBeUndefined()
  expect(state.chatNarrative!.situation.facts.filter(fact => ['lit-door', 'open-window'].includes(fact.factKey))).toHaveLength(2)
  expect(state.relationshipHistory).toHaveLength(1)
  expect(state.relationships.find(r => r.fromParticipantKey === 'guard' && r.dimensionKey === 'trust')!.value).toBe(1)
  expect(state.chatNarrative!.triggers.at(-1)!.actionSequences).toHaveLength(1)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(parent)
  expect((await db.agentRuns.get(f.runId))!.productRuntimeSessionId).toBe(f.sessionId)
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(child.id!).count()).toBe(1)
})

it.each(['changed-prefix', 'empty-suffix', 'audience', 'review'])('retains the draft and commits no expression/effects on %s failure', async kind => {
  const f = await original(), child = await fork(f), before = (await readProductRuntimeState(child.id!)).interaction!
  await expect(complete(f, child.id!, action => {
    if (kind === 'changed-prefix') action.text = '改动开头。' + action.text
    if (kind === 'empty-suffix') action.text = prefix
    if (kind === 'audience') action.audienceKeys.push('artisan')
    return action
  }, kind === 'review')).rejects.toThrow()
  const after = (await readProductRuntimeState(child.id!)).interaction!
  expect(after.messages).toEqual(before.messages); expect(after.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(after.relationshipHistory).toEqual(before.relationshipHistory)
  expect(after.chatNarrative!.pendingEdit).toMatchObject({mode: 'continue', text: prefix})
})

it('rejects player/older messages, tampered prefix, stale preview and no remaining text budget before creating a child', async () => {
  const f = await original(), plan = await readChatMessageContinuationPlanV1(f.scope, f.sessionId, f.message.messageId), count = await db.productRuntimeSessions.count()
  await expect(readChatMessageContinuationPlanV1(f.scope, f.sessionId, 'player')).rejects.toThrow('最后一条角色回复')
  await expect(forkChatMessageEditV1({scope: f.scope, plan, text: '更换原文'})).rejects.toThrow('保留完整原文')
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'later', text: '停一下。'})
  await expect(readChatMessageContinuationPlanV1(f.scope, f.sessionId, f.message.messageId)).rejects.toThrow('最后一条角色回复')
  await expect(forkChatMessageEditV1({scope: f.scope, plan, text: prefix})).rejects.toThrow()
  expect(await db.productRuntimeSessions.count()).toBe(count)
  const source = await seedChatNarrativeRuntimeFixture()
  await requestChatNarrativeTrigger({...await command(source.sessionId), kind: 'scene-start', sourceEventSequence: source.sceneSequence})
  const action: ChatNarrativeActionV1 = {...expression(0), text: '我'.repeat(1600), newFacts: [], relationshipUpdates: []}
  const generated = await generate({scope: source.scope, productRuntimeSessionId: source.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '长度边界',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await harness.adoptInteractionRuntimeCandidateV1({scope: source.scope, runId: generated.snapshot.run.id})
  const message = (await readProductRuntimeState(source.sessionId)).interaction!.messages[0]
  await expect(readChatMessageContinuationPlanV1(source.scope, source.sessionId, message.messageId)).rejects.toThrow('长度上限')
})

it('keeps the prefix immutable through draft updates, nested branch and export/import, and cancels without a model call', async () => {
  const f = await original(), child = await fork(f)
  const v = await readProductRuntimeStateVersion(child.id!)
  await expect(updateChatMessageEditDraft({...await command(child.id!), text: prefix + suffix})).rejects.toThrow('续写起点不能改写')
  expect(await readProductRuntimeStateVersion(child.id!)).toEqual(v)
  await updateChatMessageEditDraft({...await command(child.id!), text: prefix})
  const nested = await branchProductRuntimeSession({parentSessionId: child.id!, throughSequence: (await readProductRuntimeStateVersion(child.id!)).sequence, title: 'continued nested'})
  const before = (await readProductRuntimeState(nested.id!)).interaction!
  expect(before.chatNarrative!.pendingEdit!.requestedSequence).toBeLessThan(0)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === 'continued nested')!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(before)
  const runs = await db.agentRuns.count()
  await store.getState().load({projectId, worldId: imported.worldId, workId: imported.workId}, null, imported.id!)
  await store.getState().cancelMessageEdit()
  expect(store.getState().runtimeState.interaction!.chatNarrative!.pendingEdit).toBeUndefined()
  expect(store.getState().runtimeState.interaction!.messages.map(m => m.text)).toEqual(['我来核对账簿。'])
  expect(await db.agentRuns.count()).toBe(runs)
})

it('recovers a saved continuation without regenerating text or applying original effects twice', async () => {
  const f = await original(), child = await fork(f), state = (await readProductRuntimeState(child.id!)).interaction!
  let calls = 0, runId = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(i => generate({...i,
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(expression(state.chatNarrative!.triggers.at(-1)!.sourceEventSequence, true))}),
    onNarrativeActionSaved: id => {runId = id; throw new Error('crash-before-review')}}))
  await expect(applyChatMessageEditV1({scope: f.scope, sessionId: child.id!, expectedSequence: (await readProductRuntimeStateVersion(child.id!)).sequence, text: prefix, aiConfig: {} as never})).rejects.toThrow('crash-before-review')
  db.close(); await db.open(); await store.getState().load(f.scope, null, child.id!)
  expect(store.getState().pendingNarrativeReviewRunIds).toEqual([runId])
  const resume = harness.resumeChatNarrativeReviewV1
  vi.spyOn(harness, 'resumeChatNarrativeReviewV1').mockImplementation(i => resume({...i, runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())}}))
  await store.getState().resumeNarrativeReview(runId, {} as never)
  expect(calls).toBe(2)
  expect(store.getState().runtimeState.interaction!.messages.at(-1)!.text).toBe(prefix + suffix)
  expect(store.getState().runtimeState.interaction!.relationshipHistory).toHaveLength(1)
  expect(store.getState().runtimeState.interaction!.chatNarrative!.pendingEdit).toBeUndefined()
})
