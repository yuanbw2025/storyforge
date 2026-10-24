import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {buildInteractionContextWindow, interactionRetrievalView} from '../../src/lib/character-interaction/runtime'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, deleteProductRuntimeSession, endInteractionScene, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, startInteractionScene} from '../../src/lib/character-interaction/runtime-api'
import {readChatActionRevisionSourceV1} from '../../src/lib/character-interaction/action-revision'
import {readChatMessageEditPlanV1, forkChatMessageEditV1} from '../../src/lib/character-interaction/narrative-edit'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_PROMISE_FIXTURE, chatPromiseActionFixture, chatFulfillActionFixture, chatCommitmentReviewOutputFixture} from '../helpers/chat-commitment-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const command = async (sessionId: number) => {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture()
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
function input(f: Awaited<ReturnType<typeof prepared>>, action = chatPromiseActionFixture()) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
    objective: '依据当前局面处理自己的约定', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatCommitmentReviewOutputFixture(action))}
}

it('recovers an exact reviewed promise, recalls it in a later scene, fulfills once and preserves portable branch evidence', async () => {
  const f = await prepared(), worlds = await db.worldReleases.toArray(), before = await readProductRuntimeState(f.sessionId)
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async messages => {
    calls++; expect(messages[0].content).toContain('commitmentEffects'); expect(messages[1].content).not.toContain('柜台下')
    return JSON.stringify(chatPromiseActionFixture())
  }), onNarrativeActionSaved: id => {runId = id; throw new Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    calls++; expect(messages[0].content).toContain('承诺专审'); expect(messages[0].content).toContain('effectIndex')
    return JSON.stringify(chatCommitmentReviewOutputFixture(chatPromiseActionFixture()))
  }})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const made = await readProductRuntimeState(f.sessionId), promise = made.interaction!.chatNarrative!.situation.goals[0].commitments![0]
  expect(calls).toBe(2); expect(made.interaction!.messages).toHaveLength(1)
  expect(promise).toMatchObject({terms: CHAT_PROMISE_FIXTURE, resolution: null, declared: {messageId: `message:harness:${runId}`}})
  const editPlan = await readChatMessageEditPlanV1(f.scope, f.sessionId, promise.declared.messageId)
  const editBranch = await forkChatMessageEditV1({scope: f.scope, plan: editPlan, text: '我先考虑一下。', title: '改写承诺之前'})
  expect((await readProductRuntimeState(editBranch.id!)).interaction!.chatNarrative!.situation.goals[0].commitments).toBeUndefined()
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.goals[0].commitments![0]).toEqual(promise)
  expect(JSON.stringify(interactionRetrievalView(made.interaction!, 'artisan'))).not.toContain(CHAT_PROMISE_FIXTURE)
  await endInteractionScene({...await command(f.sessionId), sceneId: 'inn.current', reason: '同一事项稍后继续'})
  const returned = await startInteractionScene({...await command(f.sessionId), sceneId: 'inn.return', sceneKey: 'inn'})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: returned.sequence})
  const fulfill = chatFulfillActionFixture(promise.commitmentKey)
  const generated = await generateInteractionRuntimeCandidateV1({...input(f, fulfill), runAI: withChatActionChoiceFixture(async messages => {
    calls++; expect(messages[1].content).toContain(CHAT_PROMISE_FIXTURE); expect(messages[1].content).toContain(promise.commitmentKey)
    expect(messages[1].content).not.toContain('柜台下'); return JSON.stringify(fulfill)
  }), runReviewAI: async messages => {
    calls++; expect(messages[1].content).toContain(CHAT_PROMISE_FIXTURE); return JSON.stringify(chatCommitmentReviewOutputFixture(fulfill))
  }})
  const inspectionBefore = await readChatContextInspectionV1(f.scope, f.sessionId, generated.snapshot.run.id)
  expect(inspectionBefore.available && inspectionBefore.commitments[0]).toMatchObject({terms: CHAT_PROMISE_FIXTURE, resolution: null})
  const beforeFulfill = await readProductRuntimeState(f.sessionId)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.messages).toHaveLength(2); expect(calls).toBe(4)
  expect(after.interaction!.chatNarrative!.situation.goals[0].commitments![0].resolution).toMatchObject({kind: 'fulfilled', excerpt: fulfill.text})
  expect(await readChatContextInspectionV1(f.scope, f.sessionId, generated.snapshot.run.id)).toEqual(inspectionBefore)
  const earlier = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: beforeFulfill.lastSequence, title: '尚未履约'})
  expect((await readProductRuntimeState(earlier.id!)).interaction!.chatNarrative!.situation.goals[0].commitments![0].resolution).toBeNull()
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '履约之后'})
  const childState = await readProductRuntimeState(child.id!)
  await deleteProductRuntimeSession(f.sessionId)
  expect(await readProductRuntimeState(child.id!)).toEqual(childState)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === child.title)!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(childState.interaction)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  await deleteProductRuntimeSession(imported.id!)
  expect(await db.productRuntimeEvents.where('sessionId').equals(imported.id!).count()).toBe(0)
})

it.each([true, false])('keeps a rejected per-effect review without revision or adoption (consequences=%s)', async consequences => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), rejected = chatCommitmentReviewOutputFixture(chatPromiseActionFixture(), false)
  rejected.checks.find(c => c.check === 'consequences')!.passed = consequences
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => JSON.stringify(rejected)})).rejects.toThrow('语义审查未通过')
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId, actorKey: 'guard'})).toBeNull()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRunArtifacts.toArray()).some(a => a.content === JSON.stringify(rejected))).toBe(true)
})

it('refuses an older frozen reviewer before making a review call or adopting a retained candidate', async () => {
  const f = await prepared(), original = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = original(id)
    return id === 'character.chat-narrative-action-review' ? {...skill, promptVersion: 'chat-narrative-action-review-v18'} : id === 'character.chat-narrative-action' ? {...skill, promptVersion: 'chat-narrative-action-v45'} : skill
  })
  let runId = 0, reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => {reviews++; return JSON.stringify(chatCommitmentReviewOutputFixture(chatPromiseActionFixture()))}})).rejects.toThrow('旧审查合同')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow('旧审查合同')
  expect(reviews).toBe(0)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toEqual([])
})

it('stops stale saved commitments before review and does not duplicate the producer', async () => {
  const f = await prepared(); let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onNarrativeActionSaved: id => {runId = id; throw new Error('saved')}})).rejects.toThrow('saved')
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'new-direction', text: '先别答应，想清楚再说。'})
  await expect(resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return '{}'}})).rejects.toThrow()
  expect(calls).toBe(0)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.goals[0].commitments).toBeUndefined()
})

it('registers only the chosen alternative and exposes shared promises without private goals', async () => {
  const f = await prepared(), first = chatPromiseActionFixture(), second = chatPromiseActionFixture('我答应检查门闩后告诉你结果。')
  second.audienceKeys.push('artisan')
  const actions = [first, second]
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), skillId: 'character.chat-narrative-options', runAI: withChatActionChoiceFixture(async () => JSON.stringify({options: actions})),
    runReviewAI: async messages => {
      expect(messages[0].content).toContain('commitmentChecks')
      return JSON.stringify({options: actions.map((a, i) => ({optionKey: `option-${i+1}`, ...chatCommitmentReviewOutputFixture(a)}))})
    }})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(0)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, optionKey: 'option-2'})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.situation.goals[0].commitments).toHaveLength(1)
  const artisan = buildInteractionContextWindow(state, 'artisan')
  expect(artisan.sharedCommitments?.[0].terms).toBe(second.text)
  expect(JSON.stringify(artisan)).not.toContain('担心再次错怪人')
  expect(JSON.stringify(artisan)).not.toContain(CHAT_PROMISE_FIXTURE)
})

it('allows an unconditional promise while awaiting a different answer, never fulfillment while waiting', async () => {
  const f = await prepared(), a: ChatNarrativeActionV1 = {...chatPromiseActionFixture(), waitingForPlayer: true, text: CHAT_PROMISE_FIXTURE + '你想喝点热水吗？'}
  const generated = await generateInteractionRuntimeCandidateV1(input(f, a))
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.situation.goals[0].commitments![0].resolution).toBeNull()
  expect(state.chatNarrative!.triggers.at(-1)!.status).toBe('waiting-player')
})
