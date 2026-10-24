import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
const hold: ChatNarrativeActionV1 = {kind: 'pause', text: '我暂缓寻找铜印，先向你澄清我的判断。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'paused'}
const close: ChatNarrativeActionV1 = {kind: 'complete', text: '铜印还没找到。我先前只是猜测，没有依据指责任何人；寻找仍然暂缓。', goalKey: 'clarify', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'fulfilled'}
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function fixture(paused = true) {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 2, onlyGuard: true, additionalGuardGoal: true})
  if (paused) {
    const v = await readProductRuntimeStateVersion(f.sessionId)
    await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'initial-hold', baseSequence: v.sequence, baseStateHash: v.stateHash,
      kind: 'scene-start', sourceEventSequence: v.sequence, direction: {actorKey: 'guard', actionLimit: 2}})
    const saved = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
      objective: '工程夹具：保存有依据的旧目标暂停，另一个澄清目标保持活跃', runAI: withChatActionChoiceFixture(async () => JSON.stringify(hold)),
      runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.snapshot.run.id})
  }
  return f
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function trigger(f: Fixture) {
  const v = await readProductRuntimeStateVersion(f.sessionId)
  return requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'continue', sourceEventSequence: v.sequence, direction: {actorKey: 'guard', actionLimit: 2}})
}
async function finish(f: Fixture) {
  await trigger(f)
  const saved = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '工程夹具：完成澄清，保留暂停的搜查目标', runAI: withChatActionChoiceFixture(async () => JSON.stringify(close)),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.snapshot.run.id})
  return saved
}
async function resumeView(f: Fixture) {return readChatNarrativeTurnResumeV1(f.scope, f.sessionId, (await readProductRuntimeState(f.sessionId)).interaction!)}

it('stops the actual two-action loop after closing the active goal while preserving an older pause', async () => {
  const f = await fixture(), before = await readProductRuntimeState(f.sessionId)
  let calls = 0
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => {
    if (++calls > 1) throw Error('unexpected extra action after adopted goal closure')
    return generate({...input, runAI: withChatActionChoiceFixture(async () => JSON.stringify(close)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  })
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'continue', participantKey: 'guard',
    expectedSequence: before.lastSequence, actionLimit: 2, aiConfig: {} as never})
  const after = await readProductRuntimeState(f.sessionId), story = after.interaction!.chatNarrative!
  expect(spy).toHaveBeenCalledTimes(1)
  expect(story.situation.goals.find(g => g.goalKey === 'clarify')!.status).toBe('fulfilled')
  expect(story.situation.goals.find(g => g.goalKey === 'find-seal')).toEqual(before.interaction!.chatNarrative!.situation.goals.find(g => g.goalKey === 'find-seal'))
  expect(story.situation.threads).toEqual(before.interaction!.chatNarrative!.situation.threads)
  expect(story.triggers.at(-1)!.actionSequences).toHaveLength(1)
  expect(after.interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 3)
  expect(after.interaction!.messages.at(-1)!.text).toBe(close.text)
  expect(await resumeView(f)).toBeNull()
}, 60000)

it('keeps closure and paused goals across reload, nested branch and import without granting a leftover action', async () => {
  const f = await fixture(); await finish(f)
  const before = await readProductRuntimeState(f.sessionId)
  expect(await resumeView(f)).toBeNull()
  const exhausted = structuredClone(before.interaction!); exhausted.remainingDirectorBudget = 0
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, exhausted)).toBeNull()
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1')
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: before.lastSequence, aiConfig: {} as never})).rejects.toThrow('没有可以补齐')
  expect(spy).not.toHaveBeenCalled()
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: before.lastSequence, title: 'completed-goal-with-pause'})
  const childState = await readProductRuntimeState(child.id!)
  expect(await readChatNarrativeTurnResumeV1(f.scope, child.id!, childState.interaction!)).toBeNull()
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const copied = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => s.title === child.title)!
  const copiedScope = {projectId: imported, worldId: copied.worldId!, workId: copied.workId!}, copiedState = await readProductRuntimeState(copied.id!)
  expect(copiedState.interaction).toEqual(childState.interaction)
  expect(await readChatNarrativeTurnResumeV1(copiedScope, copied.id!, copiedState.interaction!)).toBeNull()
  expect(spy).not.toHaveBeenCalled()
  await trigger(f)
  expect(await resumeView(f)).toMatchObject({actorKey: 'guard', remainingActions: 2, blockedReason: null})
}, 60000)

it('continues a different active goal instead of treating one fulfilled goal as the end of every turn', async () => {
  const f = await fixture(false), before = await readProductRuntimeState(f.sessionId)
  let calls = 0
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(++calls === 1 ? close : hold)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}))
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'continue', participantKey: 'guard',
    expectedSequence: before.lastSequence, actionLimit: 2, aiConfig: {} as never})
  expect(spy).toHaveBeenCalledTimes(2)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.triggers.at(-1)!.actionSequences).toHaveLength(2)
}, 60000)

it.each(['unknown', 'rejected', 'cancelled'] as const)('does not hide a historical extra %s run behind the absence of active goals', async failure => {
  const f = await fixture(); await finish(f)
  let runId = 0
  await expect(generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '保留旧实现中已经发起的额外运行',
    onRunCreated: id => {runId = id; if (failure === 'cancelled') throw Error('interrupted before request')},
    runAI: withChatActionChoiceFixture(async () => {if (failure === 'unknown') throw Error('response unknown'); return JSON.stringify({...hold, goalStatus: null})}),
    runReviewAI: async () => {const review = chatActionReviewOutputFixture(); review.checks[0].passed = false; return JSON.stringify(review)},
  })).rejects.toThrow()
  if (failure === 'cancelled') await harness.cancelInteractionRuntimeRunV1({scope: f.scope, runId})
  const before = await readProductRuntimeState(f.sessionId), view = await resumeView(f)
  expect(view?.blockedReason).toContain(failure === 'unknown' ? '结果未知' : '尚未采用、失败或取消')
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1')
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: before.lastSequence, aiConfig: {} as never})).rejects.toThrow('本轮')
  expect(spy).not.toHaveBeenCalled()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
}, 60000)
