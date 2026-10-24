import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {previewChatNarrativeActionV1} from '../../src/lib/character-interaction/narrative-actions'
import {advanceChatNarrativeTurnV1, createChatNarrativeSituationV1, readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const action = (text = '我先独自核对账簿。'): ChatNarrativeActionV1 => ({kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
function mock(value: () => ChatNarrativeActionV1 = () => action()) {
  return vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(value())), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}))
}

it.each([1, 2, undefined])('executes the explicit %s action limit and freezes the current public audience', async limit => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3}), spy = mock()
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: f.sceneSequence, kind: 'scene-start', participantKey: 'guard', actionLimit: limit, aiConfig: {} as never})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, trigger = state.chatNarrative!.triggers[0]
  expect(spy).toHaveBeenCalledTimes(limit ?? 3)
  expect(trigger.actionSequences).toHaveLength(limit ?? 3)
  expect(trigger.status).toBe('complete')
  expect(trigger.direction).toEqual({actorKey: 'guard', actionLimit: limit ?? 3, audienceParticipantKeys: ['guard', 'artisan'], conversationMode: 'present'})
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, state)).toBeNull()
})

it('retains an absent historical direction when reading or resuming its saved trigger', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  db.close(); await db.open()
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers[0]).not.toHaveProperty('direction')
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, state)).toMatchObject({remainingActions: 3})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.triggers[0]).not.toHaveProperty('direction')
})

it.each([0, -1, 4, 1.5, NaN])('rejects invalid limit %s before creating a trigger or model call', async actionLimit => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3}), before = await readProductRuntimeState(f.sessionId), spy = mock()
  await expect(advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: f.sceneSequence, kind: 'scene-start', participantKey: 'guard', actionLimit, aiConfig: {} as never})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(spy).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0)
})

it('binds the chosen role before the first call and rejects role changes on generation or resume', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 2}})
  const view = await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, (await readProductRuntimeState(f.sessionId)).interaction!)
  expect(view).toMatchObject({actorKey: 'guard', remainingActions: 2})
  const state = await readProductRuntimeState(f.sessionId)
  expect(() => previewChatNarrativeActionV1(state.interaction!, {sequence: state.lastSequence + 1, triggerSequence: state.lastSequence, actorKey: 'artisan', messageId: 'wrong-role',
    action: {...action(), goalKey: 'fix-road', evidenceFactKeys: ['road'], audienceKeys: ['artisan', 'player']}})).toThrow('明确选择')
  await expect(generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'artisan', skillId: 'character.chat-narrative-action', objective: '错误角色',
    runAI: withChatActionChoiceFixture(async () => {throw new Error('must not call')})})).rejects.toThrow('明确选择')
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, participantKey: 'artisan', aiConfig: {} as never})).rejects.toThrow('沿用原行动角色')
  expect(await db.agentRuns.count()).toBe(0)
})

it('persists direction before constructing a player-seeded situation and retains it when construction has not started', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockRejectedValue(new Error('stop before construction'))
  await expect(createChatNarrativeSituationV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: f.sceneSequence, seed: '门外出现了陌生的敲门声。',
    participantKey: 'guard', actionLimit: 2, aiConfig: {} as never})).rejects.toThrow('stop before construction')
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers[0]).toMatchObject({kind: 'player-seed', direction: {actorKey: 'guard', actionLimit: 2}, status: 'ready'})
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, state)).toMatchObject({actorKey: 'guard', remainingActions: 2, blockedReason: null})
  expect(state.messages).toHaveLength(0)
  expect(await db.agentRuns.count()).toBe(0)
})

it('keeps the selected role and remaining quota after refresh, branch and import', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 2}})
  const candidate = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程夹具',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action())), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id})
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'bounded child'})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === child.title)!
  const scope = {projectId, worldId: imported.worldId, workId: imported.workId}
  db.close(); await db.open()
  expect(await readChatNarrativeTurnResumeV1(scope, imported.id!, (await readProductRuntimeState(imported.id!)).interaction!)).toMatchObject({actorKey: 'guard', remainingActions: 1})
  const spy = mock()
  await resumeChatNarrativeTurnV1({scope, sessionId: imported.id!, expectedSequence: 0, aiConfig: {} as never})
  expect(spy).toHaveBeenCalledTimes(1)
  const state = (await readProductRuntimeState(imported.id!)).interaction!
  expect(state.messages).toHaveLength(2)
  expect(state.chatNarrative!.triggers[0]).toMatchObject({direction: {actorKey: 'guard', actionLimit: 2}, status: 'complete'})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(1)
})

it.each(['wait', 'pause', 'interrupt'] as const)('stops bounded direction at %s without consuming the rest', async stop => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  const controller = new AbortController()
  const spy = mock(() => ({...action(), ...(stop === 'wait' ? {kind: 'attempt' as const, waitingForPlayer: true} : stop === 'pause' ? {kind: 'pause' as const} : {})}))
  const adopt = harness.adoptInteractionRuntimeCandidateV1
  if (stop === 'interrupt') vi.spyOn(harness, 'adoptInteractionRuntimeCandidateV1').mockImplementation(async input => {
    const result = await adopt(input)
    await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'interrupt', text: '先等等，我有新的想法。'})
    controller.abort()
    return result
  })
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: f.sceneSequence, kind: 'scene-start', participantKey: 'guard', actionLimit: 3, aiConfig: {} as never, signal: controller.signal})
  expect(spy).toHaveBeenCalledTimes(1)
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers[0].status).toBe(stop === 'wait' ? 'waiting-player' : stop === 'pause' ? 'complete' : 'cancelled')
  expect(state.chatNarrative!.triggers[0].actionSequences).toHaveLength(1)
})

it('rejects a non-hearing chosen role and unknown direction fields without changing state', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'private', text: '我只对叶岑说。', audienceKeys: ['guard']})
  const before = await readProductRuntimeState(f.sessionId)
  for (const direction of [{actorKey: 'artisan', actionLimit: 1}, {actorKey: 'guard', actionLimit: 1, automaticForever: true}, {actorKey: 'player', actionLimit: 1}]) {
    await expect(requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: message.sequence, direction})).rejects.toThrow()
  }
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})
