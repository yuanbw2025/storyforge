import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, previewChatNarrativeActionV1} from '../../src/lib/character-interaction/narrative-actions'
import {createChatScheduledDirectionV1, nextChatScheduledActorV1} from '../../src/lib/character-interaction/narrative-scheduling'
import {readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import * as harness from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import {chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const reply: ChatNarrativeActionV1 = {kind: 'speak', text: '可以，我们先聊会儿，眼下这里安全。', goalKey: null,
  evidenceFactKeys: ['road'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
function state() {
  const value = createInitialInteractionState(chatNarrativeFixture()), scene = value.sceneTemplates[0], story = value.chatNarrative!
  value.activeScene = {...scene, sceneId: 'inn.current', activeParticipantKeys: [...scene.participantKeys], status: 'active', startedAtSequence: 0, endedAtSequence: null, playerTurns: 1}
  value.remainingDirectorBudget = 100
  story.situation.goals[0].status = 'fulfilled'
  story.situation.possibilities = []
  story.permissions.maxActionsPerTrigger = 3
  value.messages.push({messageId: 'new-topic', eventSequence: 1, role: 'player', speakerKey: 'player', audienceKeys: ['guard', 'player'], text: '我们先聊点别的吧。', replyToSequence: null, supersededBySequence: null})
  story.triggers.push({kind: 'player-response', sourceEventSequence: 1, requestedSequence: 2, seed: null, status: 'ready', actionSequences: [], direction: {actorKey: 'guard', actionLimit: 3}})
  story.lastEventSequence = 2
  return value
}
const input = (action: ChatNarrativeActionV1 = reply) => ({sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'reply', action})

it('permits a reviewed conversational reply once without reopening goals, spending the rest of the turn or learning secrets', () => {
  const value = state(), before = structuredClone(value), result = previewChatNarrativeActionV1(value, input())
  expect(result.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(result.chatNarrative!.triggers.at(-1)).toMatchObject({status: 'complete', actionSequences: [3]})
  expect(result.messages.at(-1)).toMatchObject({text: reply.text, replyToSequence: 1})
  expect(result.remainingDirectorBudget).toBe(before.remainingDirectorBudget - 1)
  expect(() => previewChatNarrativeActionV1(result, {...input(), sequence: 4, messageId: 'extra'})).toThrow('触发')
  expect(() => applyChatNarrativeActionV1(value, input())).toThrow('必须通过行动及后果审查')
  expect(value).toEqual(before)
})

it.each(['scene-start', 'continue', 'return', 'player-seed', 'active', 'paused', 'second-action', 'private', 'excluded'] as const)('rejects a goal-free reply outside its exact authority (%s)', invalid => {
  const value = state(), story = value.chatNarrative!, trigger = story.triggers[0]
  if (['scene-start', 'continue', 'return', 'player-seed'].includes(invalid)) trigger.kind = invalid as typeof trigger.kind
  if (invalid === 'active' || invalid === 'paused') story.situation.goals[0].status = invalid
  if (invalid === 'second-action') trigger.actionSequences.push(1)
  if (invalid === 'private') value.messages[0].audienceKeys = ['artisan', 'player']
  if (invalid === 'excluded') story.excludedMessageIds = ['new-topic']
  const before = structuredClone(value)
  expect(() => previewChatNarrativeActionV1(value, input())).toThrow(invalid === 'private' ? '看不到' : invalid === 'excluded' ? '排除' : invalid === 'player-seed' ? '情境构建' : '无目标回应')
  expect(value).toEqual(before)
})

it.each([
  {goalStatus: 'active'}, {goalKey: 'find-seal'},
  {goalUpdates: [{goalKey: 'find-seal', status: 'active', evidenceFactKeys: ['road'], evidenceExcerpt: reply.text}]},
  {threadUpdates: [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: reply.text}]},
  {nextPossibilities: [{text: '再找一次铜印。', evidenceFactKeys: ['lost']}]},
  {situationRequest: {threadKey: 'investigate', direction: '重新寻找', evidenceFactKeys: ['lost'], evidenceExcerpt: reply.text}},
] as Partial<ChatNarrativeActionV1>[])('rejects invented goal or thread work atomically (%j)', change => {
  const value = state(), before = structuredClone(value)
  expect(() => previewChatNarrativeActionV1(value, input({...reply, ...change}))).toThrow()
  expect(value).toEqual(before)
})

it.each(['natural', 'round-robin'] as const)('schedules only an audible role for a new message after closure (%s)', mode => {
  const value = state(), trigger = value.chatNarrative!.triggers[0]
  trigger.direction = createChatScheduledDirectionV1(value, {mode, kind: 'player-response', sourceSequence: 1, actionLimit: 3})
  expect(trigger.direction).toMatchObject({actorKey: 'guard', scheduling: {participantKeys: ['guard']}})
  expect(nextChatScheduledActorV1(value, trigger)).toBe('guard')
  const result = previewChatNarrativeActionV1(value, input())
  expect(result.chatNarrative!.triggers[0].status).toBe('complete')
  expect(nextChatScheduledActorV1(result, result.chatNarrative!.triggers[0])).toBeNull()
})

const generate = harness.generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open(); store.setState({busy: false, generatingRunId: null, scope: null, selectedSessionId: null})})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function closedSession() {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  await store.getState().load(f.scope, null, f.sessionId)
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(i => generate({...i,
    runAI: withChatActionChoiceFixture(async () => JSON.stringify({...reply, kind: 'pause', goalKey: 'find-seal', goalStatus: 'abandoned', text: '我决定不再寻找铜印，也不再邀请你参与。', nextPossibilities: []})),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}))
  await store.getState().advanceNarrative({kind: 'scene-start', participantKey: 'guard', aiConfig: {} as never})
  spy.mockImplementation(i => generate({...i, runAI: withChatActionChoiceFixture(async messages => {
    const text = JSON.stringify(messages)
    expect(text).toContain('自身无 active/paused'); expect(text).not.toContain('柜台下')
    return JSON.stringify(reply)
  }), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}))
  return {...f, spy}
}

it.each(['manual', 'natural', 'round-robin'] as const)('replies through the player store after real closure, preserving refresh, branch and import (%s)', async mode => {
  const f = await closedSession(), before = store.getState().runtimeState.interaction!
  const sent = await store.getState().sendPlayerMessage('我们先聊点别的吧。', ['guard', 'player'])
  await store.getState().generateReplies({aiConfig: {} as never, replyToSequence: sent, preferredParticipantKey: 'guard', schedulingMode: mode, actionLimit: 3})
  expect(f.spy).toHaveBeenCalledTimes(2)
  const after = store.getState().runtimeState.interaction!
  expect(after.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(after.messages.at(-1)).toMatchObject({text: reply.text, replyToSequence: sent})
  expect(after.chatNarrative!.triggers.at(-1)).toMatchObject({status: 'complete', actionSequences: [expect.any(Number)]})
  await store.getState().generateReplies({aiConfig: {} as never, replyToSequence: sent, preferredParticipantKey: 'guard'})
  await expect(store.getState().advanceNarrative({kind: 'continue', participantKey: 'guard', aiConfig: {} as never})).rejects.toThrow('当前目标已结束')
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: `post-closure-${mode}`})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  expect(branched.messages.map(m => m.text)).toEqual(after.messages.map(m => m.text))
  expect(branched.chatNarrative!.situation.goals.map(g => g.status)).toEqual(after.chatNarrative!.situation.goals.map(g => g.status))
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().runtimeState.interaction).toEqual(after)
  expect(f.spy).toHaveBeenCalledTimes(2)
})

it('resumes an unstarted player reply after closure, but never resends an unknown request', async () => {
  const f = await closedSession()
  const sent = await store.getState().sendPlayerMessage('我们先聊点别的吧。', ['guard', 'player'])
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'prepared-closure', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'player-response', sourceEventSequence: sent, direction: {actorKey: 'guard', actionLimit: 3}})
  db.close(); await db.open()
  const current = await readProductRuntimeState(f.sessionId)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, current.interaction!)).toMatchObject({actorKey: 'guard', blockedReason: null, remainingActions: 3})
  f.spy.mockImplementation(i => generate({...i, runAI: withChatActionChoiceFixture(async () => {throw new Error('provider outcome unknown')})}))
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: current.lastSequence, aiConfig: {} as never})).rejects.toThrow('provider outcome unknown')
  const failed = await readProductRuntimeState(f.sessionId)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, failed.interaction!)).toMatchObject({blockedReason: expect.stringContaining('结果未知')})
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: failed.lastSequence, aiConfig: {} as never})).rejects.toThrow('结果未知')
  expect(f.spy).toHaveBeenCalledTimes(2)
})
