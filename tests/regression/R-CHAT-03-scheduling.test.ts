import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import {createChatScheduledDirectionV1, nextChatScheduledActorV1} from '../../src/lib/character-interaction/narrative-scheduling'
import {createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {parseChatTurnDirectionV1} from '../../src/lib/character-interaction/narrative-contract'
import {previewChatNarrativeActionV1} from '../../src/lib/character-interaction/narrative-actions'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {CHAT_SITUATION_REVIEW_CHECKS_V1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function command(sessionId: number) {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
const action = (key: string): ChatNarrativeActionV1 => ({kind: 'speak', text: key === 'guard' ? '我先核对铜印的保管记录。' : '我先检查山路的状况。',
  goalKey: key === 'guard' ? 'find-seal' : 'fix-road', evidenceFactKeys: [key === 'guard' ? 'lost' : 'road'], audienceKeys: ['guard', 'artisan', 'player'],
  waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
function mock(transform: (key: string, draft: ChatNarrativeActionV1) => ChatNarrativeActionV1 = (_key, draft) => draft) {
  return vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async messages => {
      const text = JSON.stringify(messages)
      if (input.participantKey === 'artisan') expect(text).not.toContain('无辜旅人')
      else expect(text).not.toContain('天黑后不宜')
      expect(text).not.toContain('柜台下')
      return JSON.stringify(transform(input.participantKey, action(input.participantKey)))
    }), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}))
}
function state() {
  const value = createInitialInteractionState(chatNarrativeFixture()), scene = value.sceneTemplates[0]
  value.activeScene = {...scene, sceneId: 'inn.current', activeParticipantKeys: [...scene.participantKeys], status: 'active', startedAtSequence: 0, endedAtSequence: null, playerTurns: 0}
  return value
}

it('chooses a mentioned role or relevant goal using only that role’s visible dialogue, and leaves the state intact', () => {
  const value = state()
  value.messages.push({messageId: 'ask', eventSequence: 1, role: 'player', speakerKey: 'player', audienceKeys: ['guard', 'artisan', 'player'], text: '程素，山路何时能恢复通行？', replyToSequence: null, supersededBySequence: null})
  const before = structuredClone(value)
  expect(createChatScheduledDirectionV1(value, {mode: 'natural', kind: 'player-response', sourceSequence: 1, actionLimit: 3}).actorKey).toBe('artisan')
  expect(value).toEqual(before)
  value.messages[0].text = '山路何时能恢复通行？'
  expect(createChatScheduledDirectionV1(value, {mode: 'natural', kind: 'player-response', sourceSequence: 1, actionLimit: 3}).actorKey).toBe('artisan')
  value.messages[0].audienceKeys = ['guard', 'player']
  expect(createChatScheduledDirectionV1(value, {mode: 'natural', kind: 'player-response', sourceSequence: 1, actionLimit: 3})).toMatchObject({actorKey: 'guard', scheduling: {participantKeys: ['guard']}})
  value.chatNarrative!.excludedMessageIds = ['ask']
  expect(() => createChatScheduledDirectionV1(value, {mode: 'natural', kind: 'player-response', sourceSequence: 1, actionLimit: 3})).toThrow('没有能听到')
})

it('validates the frozen schedule and preserves the historical manual shape', () => {
  expect(parseChatTurnDirectionV1({actorKey: 'guard', actionLimit: 2}, ['guard', 'artisan'], 3)).toEqual({actorKey: 'guard', actionLimit: 2})
  for (const scheduling of [{mode: 'free', participantKeys: ['guard']}, {mode: 'natural', participantKeys: ['artisan']}, {mode: 'natural', participantKeys: ['guard', 'guard']}, {mode: 'natural', participantKeys: ['guard', 'outsider']}]) {
    expect(() => parseChatTurnDirectionV1({actorKey: 'guard', actionLimit: 2, scheduling}, ['guard', 'artisan'], 3)).toThrow()
  }
})

it('advances one frozen round-robin turn in causal order with isolated role inputs and exact allowance', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3}), spy = mock()
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'scene-start', expectedSequence: f.sceneSequence, schedulingMode: 'round-robin', actionLimit: 3, aiConfig: {} as never})
  const value = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(value.messages.map(m => m.speakerKey)).toEqual(['guard', 'artisan', 'guard'])
  expect(spy).toHaveBeenCalledTimes(3)
  expect(value.chatNarrative!.triggers[0]).toMatchObject({status: 'complete', direction: {actionLimit: 3, scheduling: {mode: 'round-robin', participantKeys: ['guard', 'artisan']}}})
  expect(value.remainingDirectorBudget).toBe(91)
})

it('freezes a private audience and rejects a forged wider scheduler before any model call', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  const sent = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'private', text: '只和守卫讨论铜印。', audienceKeys: ['guard', 'player']})
  await expect(requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: sent.sequence,
    direction: {actorKey: 'guard', actionLimit: 3, scheduling: {mode: 'natural', participantKeys: ['guard', 'artisan']}}})).rejects.toThrow('听不到')
  const spy = mock((_key, draft) => ({...draft, audienceKeys: ['guard', 'player']}))
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'player-response', replyToSequence: sent.sequence, expectedSequence: sent.sequence, schedulingMode: 'natural', actionLimit: 2, aiConfig: {} as never})
  expect(spy.mock.calls.map(([input]) => input.participantKey)).toEqual(['guard', 'guard'])
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages.every(message => !message.audienceKeys!.includes('artisan'))).toBe(true)
})

it('checks the computed next actor in both Harness generation and deterministic adoption', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence,
    direction: {actorKey: 'guard', actionLimit: 3, scheduling: {mode: 'round-robin', participantKeys: ['guard', 'artisan']}}})
  const value = (await readProductRuntimeState(f.sessionId)).interaction!, trigger = value.chatNarrative!.triggers[0]
  await expect(generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'artisan', skillId: 'character.chat-narrative-action', objective: 'wrong actor', runAI: withChatActionChoiceFixture(async () => {throw new Error('must not call')})})).rejects.toThrow('调度结果')
  expect(() => previewChatNarrativeActionV1(value, {sequence: value.chatNarrative!.lastEventSequence + 1, triggerSequence: trigger.requestedSequence, actorKey: 'artisan', messageId: 'forged', action: action('artisan')})).toThrow('调度结果')
  expect(await db.agentRuns.count()).toBe(0)
})

it('resumes the next role and the original allowance after refresh, nested branch and portable import', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence,
    direction: {actorKey: 'guard', actionLimit: 2, scheduling: {mode: 'round-robin', participantKeys: ['guard', 'artisan']}}})
  const candidate = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: 'saved first role',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action('guard'))), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id})
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'group child'})
  const nested = await branchProductRuntimeSession({parentSessionId: branch.id!, throughSequence: 0, title: 'nested group child'})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === nested.title)!
  const scope = {projectId, worldId: imported.worldId, workId: imported.workId}
  db.close(); await db.open()
  expect(await readChatNarrativeTurnResumeV1(scope, imported.id!, (await readProductRuntimeState(imported.id!)).interaction!)).toMatchObject({actorKey: 'artisan', remainingActions: 1, schedulingMode: 'round-robin', blockedReason: null})
  const spy = mock()
  await resumeChatNarrativeTurnV1({scope, sessionId: imported.id!, expectedSequence: 0, participantKey: 'guard', aiConfig: {} as never})
  expect(spy.mock.calls.map(([input]) => input.participantKey)).toEqual(['artisan'])
  expect((await readProductRuntimeState(imported.id!)).interaction!.messages.map(m => m.speakerKey)).toEqual(['guard', 'artisan'])
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(1)
})

it.each(['wait', 'pause', 'cancel'] as const)('stops the whole schedule at %s without spending another role call', async stop => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3}), controller = new AbortController()
  const spy = mock((_key, draft) => ({...draft, ...(stop === 'wait' ? {waitingForPlayer: true} : stop === 'pause' ? {kind: 'pause' as const} : {})}))
  if (stop === 'cancel') {
    const adopt = harness.adoptInteractionRuntimeCandidateV1
    vi.spyOn(harness, 'adoptInteractionRuntimeCandidateV1').mockImplementation(async input => {const result = await adopt(input); controller.abort(); return result})
  }
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'scene-start', expectedSequence: f.sceneSequence, schedulingMode: 'natural', actionLimit: 3, aiConfig: {} as never, signal: controller.signal})
  expect(spy).toHaveBeenCalledTimes(1)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(1)
})

it('does not revive paused or concluded goals to fill a schedule', () => {
  const value = state()
  value.chatNarrative!.situation.goals[0].status = 'fulfilled'
  value.chatNarrative!.situation.goals[1].status = 'paused'
  expect(() => createChatScheduledDirectionV1(value, {mode: 'natural', kind: 'continue', sourceSequence: 0, actionLimit: 3})).toThrow('没有能听到')
  expect(nextChatScheduledActorV1(value, {kind: 'continue', sourceEventSequence: 0, requestedSequence: 1, seed: null, status: 'ready', actionSequences: [],
    direction: {actorKey: 'guard', actionLimit: 3, scheduling: {mode: 'round-robin', participantKeys: ['guard', 'artisan']}}})).toBeNull()
})

it('lets a reviewed role direction construct once before the next eligible role acts on its visible result', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 2, actorSituationExpansion: true})
  const actors: string[] = []; let constructions = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async messages => {
      if (input.skillId === 'character.chat-situation-construction') {
        constructions++
        return JSON.stringify({kind: 'chat-situation', title: '门闩的线索', location: '驿站', timeLabel: '傍晚',
          newFacts: [{factKey: 'latch', kind: 'object', text: '后门门闩有一处松动。', audienceKeys: ['guard', 'artisan', 'player'], evidenceFactKeys: ['lost'], seedExcerpt: '检查后门门闩'}],
          newGoals: [], newThreads: [], possibilities: [{actorKey: 'guard', text: '可以检查门闩或请教修理师。', evidenceFactKeys: ['latch']}]})
      }
      actors.push(input.participantKey)
      if (actors.length === 1) return JSON.stringify({...action('guard'), text: '我想先独自检查后门门闩。',
        situationRequest: {threadKey: 'investigate', direction: '检查后门门闩，不预设已经找到铜印。', evidenceFactKeys: ['lost'], evidenceExcerpt: '我想先独自检查后门门闩。'}})
      expect(JSON.stringify(messages)).toContain('后门门闩有一处松动')
      expect(JSON.stringify(messages)).not.toContain('无辜旅人')
      return JSON.stringify({...action(input.participantKey), kind: 'pause'})
    }), runReviewAI: async () => JSON.stringify(input.skillId === 'character.chat-situation-construction'
      ? {checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具，不是叙事质量证明'}))} : chatActionReviewOutputFixture())}))
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'scene-start', expectedSequence: f.sceneSequence, schedulingMode: 'round-robin', actionLimit: 2, aiConfig: {} as never})
  expect(actors).toEqual(['guard', 'artisan'])
  expect(constructions).toBe(1)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.seed.origin).toBe('continued-thread')
})

it('keeps an unknown second role request blocked on resume without replaying the first role or skipping ahead', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3}); let calls = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async () => {calls++; if (input.participantKey === 'artisan') throw new Error('provider outcome unknown'); return JSON.stringify(action(input.participantKey))}),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}))
  await expect(advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'scene-start', expectedSequence: f.sceneSequence,
    schedulingMode: 'round-robin', actionLimit: 3, aiConfig: {} as never})).rejects.toThrow('provider outcome unknown')
  const current = await readProductRuntimeState(f.sessionId)
  expect(current.interaction!.messages.map(m => m.speakerKey)).toEqual(['guard'])
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, current.interaction!)).toMatchObject({actorKey: 'artisan', remainingActions: 2, blockedReason: expect.stringContaining('结果未知')})
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: current.lastSequence, participantKey: 'guard', aiConfig: {} as never})).rejects.toThrow('结果未知')
  expect(calls).toBe(2)
})
