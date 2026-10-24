import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {applyChatMessageRetrievalPlanV1, readChatMessageRetrievalPlanV1} from '../../src/lib/character-interaction/narrative-retrieval-service'
import {forkChatMessageEditV1, readChatMessageContinuationPlanV1} from '../../src/lib/character-interaction/narrative-edit'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const action = (text = '我先独自核对账簿。'): ChatNarrativeActionV1 => ({kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
async function prepared(limit = 3, seed = false) {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: limit}), v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: seed ? 'player-seed' : 'scene-start', sourceEventSequence: v.sequence, ...(seed ? {seed: '门外传来敲门声。不要预先决定来者身份。'} : {})})
  return {...f, triggerSequence: trigger.sequence}
}
type Fixture = Awaited<ReturnType<typeof prepared>>
async function candidate(f: Fixture, value = action()) {
  return generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程夹具',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(value)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
}
async function partial(f: Fixture) {
  const first = await candidate(f, {...action('我把灯移到门边，门边亮了起来。'), kind: 'complete',
    newFacts: [{factKey: 'light', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}]})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: first.snapshot.run.id})
  return first
}
async function resume(f: Fixture, participantKey?: string) {
  return resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, participantKey, aiConfig: {} as never})
}
async function view(f: Fixture) {return readChatNarrativeTurnResumeV1(f.scope, f.sessionId, (await readProductRuntimeState(f.sessionId)).interaction!)}
function mockActions(value: () => ChatNarrativeActionV1 = () => action()) {
  return vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(value())), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}))
}

it('resumes only the two remaining actions after refresh, preserving the original actor, trigger, first fact and budget', async () => {
  const f = await prepared(); await partial(f)
  db.close(); await db.open()
  expect(await view(f)).toEqual({triggerSequence: f.triggerSequence, actorKey: 'guard', remainingActions: 2, blockedReason: null})
  let calls = 0
  const spy = mockActions(() => action(`我继续核对第 ${++calls} 项。`))
  await resume(f)
  expect(spy).toHaveBeenCalledTimes(2)
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.map(m => m.speakerKey)).toEqual(['guard', 'guard', 'guard'])
  expect(state.chatNarrative!.triggers).toHaveLength(1)
  expect(state.chatNarrative!.triggers[0]).toMatchObject({requestedSequence: f.triggerSequence, status: 'complete'})
  expect(state.chatNarrative!.triggers[0].actionSequences).toHaveLength(3)
  expect(state.chatNarrative!.situation.facts.filter(fact => fact.factKey === 'light')).toHaveLength(1)
  expect(state.remainingDirectorBudget).toBe(91)
  expect(await view(f)).toBeNull()
  await expect(resume(f)).rejects.toThrow('没有可以补齐')
  expect(spy).toHaveBeenCalledTimes(2)
})

it.each(['waiting', 'pause'] as const)('stops the unfinished turn at %s rather than exhausting its remaining actions', async kind => {
  const f = await prepared(), spy = mockActions(() => ({...action(), waitingForPlayer: kind === 'waiting', kind: kind === 'pause' ? 'pause' : 'attempt'}))
  await resume(f, 'guard')
  expect(spy).toHaveBeenCalledTimes(1)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(1)
  expect(await view(f)).toBeNull()
})

it('requires the durable candidate to be adopted before completing the rest, without generating it again', async () => {
  const f = await prepared(2), saved = await candidate(f), spy = mockActions()
  expect((await view(f))!.blockedReason).toContain('尚未采用')
  await expect(resume(f, 'guard')).rejects.toThrow('先恢复')
  expect(spy).not.toHaveBeenCalled()
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.snapshot.run.id})
  await resume(f)
  expect(spy).toHaveBeenCalledTimes(1)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(2)
})

it.each(['unknown', 'rejected', 'cancelled'] as const)('keeps a %s run blocked even if the event head changes', async failure => {
  const f = await prepared(); await partial(f)
  let runId = 0
  await expect(generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '失败夹具',
    onRunCreated: id => {runId = id; if (failure === 'cancelled') throw new Error('interrupted before request')},
    runAI: withChatActionChoiceFixture(async () => {if (failure === 'unknown') throw new Error('response unknown'); return JSON.stringify(action())}),
    runReviewAI: async () => {const review = chatActionReviewOutputFixture(); review.checks[0].passed = false; return JSON.stringify(review)},
  })).rejects.toThrow()
  if (failure === 'cancelled') await harness.cancelInteractionRuntimeRunV1({scope: f.scope, runId})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  const plan = await readChatMessageRetrievalPlanV1(f.scope, f.sessionId, state.messages[0].messageId)
  await applyChatMessageRetrievalPlanV1(f.scope, plan)
  const before = await readProductRuntimeState(f.sessionId), spy = mockActions()
  const status = await view(f)
  expect(status!.blockedReason).toContain(failure === 'unknown' ? '结果未知' : '尚未采用、失败或取消')
  await expect(resume(f)).rejects.toThrow(failure === 'unknown' ? '结果未知' : '尚未采用、失败或取消')
  expect(spy).not.toHaveBeenCalled()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('rejects stale state, another role, foreign scope and player interruption without a model call', async () => {
  const f = await prepared(); await partial(f)
  const spy = mockActions(), v = await readProductRuntimeStateVersion(f.sessionId)
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: v.sequence - 1, aiConfig: {} as never})).rejects.toThrow('已变化')
  await expect(resume(f, 'artisan')).rejects.toThrow('原行动角色')
  const foreign = await prepared()
  await expect(resumeChatNarrativeTurnV1({scope: foreign.scope, sessionId: f.sessionId, expectedSequence: v.sequence, aiConfig: {} as never})).rejects.toThrow()
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'interrupt', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'interrupt', text: '停一下，我想休息。'})
  expect(await view(f)).toBeNull()
  await expect(resume(f)).rejects.toThrow('没有可以补齐')
  expect(spy).not.toHaveBeenCalled()
})

it('preserves the unfinished allowance through branch and import, including verified completed run history', async () => {
  const f = await prepared(); await partial(f)
  const parent = await readProductRuntimeState(f.sessionId)
  await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: parent.lastSequence, title: 'unfinished branch'})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const sessions = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()
  const spy = mockActions(() => ({...action(), kind: 'pause'}))
  for (const session of sessions) {
    const imported = {...f, sessionId: session.id!, scope: {projectId, worldId: session.worldId, workId: session.workId}}
    expect(await view(imported)).toMatchObject({remainingActions: 2, actorKey: 'guard', blockedReason: null})
    await resume(imported)
    const state = (await readProductRuntimeState(session.id!)).interaction!
    expect(state.messages).toHaveLength(2)
    expect(state.chatNarrative!.triggers).toHaveLength(1)
    expect(state.chatNarrative!.situation.facts.filter(fact => fact.factKey === 'light')).toHaveLength(1)
  }
  expect(spy).toHaveBeenCalledTimes(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(parent)
})

it.each([false, true])('completes a player-seed turn once without repeating its already-prepared background (%s)', async alreadyPrepared => {
  const f = await prepared(1, true)
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async messages => {
      if (input.skillId === 'character.chat-situation-construction') return JSON.stringify({kind: 'chat-situation', title: '门外的声响', location: '驿站', timeLabel: '傍晚',
        newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['guard', 'player', 'artisan'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}],
        newGoals: [], newThreads: [], possibilities: [{actorKey: 'guard', text: '可以隔门询问。', evidenceFactKeys: ['knocking']}]})
      expect(JSON.stringify(messages)).toContain('门外传来敲门声。')
      expect(JSON.stringify(messages)).not.toContain('柜台下')
      return JSON.stringify({...action('我先隔门询问来意。'), evidenceFactKeys: ['knocking']})
    }), runReviewAI: async () => JSON.stringify(input.skillId === 'character.chat-situation-construction'
      ? {checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具'}))} : chatActionReviewOutputFixture()),
  }))
  if (alreadyPrepared) {
    const generated = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player',
      skillId: 'character.chat-situation-construction', objective: '构建后中断的工程夹具', aiConfig: {} as never})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    spy.mockClear()
  }
  await resume(f, 'guard')
  expect(spy.mock.calls.map(([input]) => input.skillId)).toEqual(alreadyPrepared ? ['character.chat-narrative-action'] : ['character.chat-situation-construction', 'character.chat-narrative-action'])
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers).toHaveLength(1)
  expect(state.messages.map(m => m.role)).toEqual(['character'])
  expect(state.chatNarrative!.situation.facts.filter(fact => fact.factKey === 'knocking')).toHaveLength(1)
  expect(state.remainingDirectorBudget).toBe(95)
})

it('does not bypass a pending edit or exhausted generation/review budget', async () => {
  const f = await prepared(); await partial(f)
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  const plan = await readChatMessageContinuationPlanV1(f.scope, f.sessionId, state.messages[0].messageId)
  const child = await forkChatMessageEditV1({scope: f.scope, plan, text: plan.text})
  const spy = mockActions()
  await expect(resume({...f, sessionId: child.id!})).rejects.toThrow('没有可以补齐')
  const small = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3, directorBudget: 3}), v = await readProductRuntimeStateVersion(small.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: small.sessionId, commandId: 'small', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: v.sequence})
  const limited = {...small, triggerSequence: trigger.sequence}
  await partial(limited)
  expect((await view(limited))!.blockedReason).toContain('额度不足')
  await expect(resume(limited)).rejects.toThrow('额度不足')
  expect(spy).not.toHaveBeenCalled()
})
