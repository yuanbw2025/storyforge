import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {parseChatNarrativeOptionsV1, bindChatNarrativeOptionsReviewV1, selectedChatNarrativeOptionV1} from '../../src/lib/character-interaction/narrative-options'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import * as harness from '../../src/lib/character-interaction/harness'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import {readChatNarrativeOptionsPreviewV1} from '../../src/lib/character-interaction/narrative-options-preview'
import {db} from '../../src/lib/db/schema'
import {adoptInteractionRuntimeCandidateV1, cancelInteractionRuntimeRunV1, generateInteractionRuntimeCandidateV1, readInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, commitInteractionPlayerMessage, branchProductRuntimeSession} from '../../src/lib/character-interaction/runtime-api'
import {readPendingChatNarrativeRunsV1} from '../../src/lib/character-interaction/narrative-turn'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

function options(): ChatNarrativeActionV1[] {
  const result: ChatNarrativeActionV1[] = ['我把灯移到门边。门边亮了起来。', '我先坐下听你说。'].map(text => ({kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'],
    waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}))
  result[0].kind = 'complete'
  result[0].newFacts = [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}]
  result[1].kind = 'pause'; result[1].goalStatus = 'paused'; result[1].nextPossibilities = []
  return result
}
function reviews() {return {options: ['option-2', 'option-1'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))}}

it('binds each reviewed alternative to its own exact expression and requires an explicit selection', () => {
  const actions = parseChatNarrativeOptionsV1(options()), review = bindChatNarrativeOptionsReviewV1(reviews(), actions)
  expect(selectedChatNarrativeOptionV1(actions, review, 'option-2').action.text).toBe('我先坐下听你说。')
  expect(() => selectedChatNarrativeOptionV1(actions, review, undefined)).toThrow('请选择')
  expect(() => selectedChatNarrativeOptionV1(actions, null, 'option-1')).toThrow('尚未')
  actions[1].text = '被改写的另一条表达。'
  expect(() => selectedChatNarrativeOptionV1(actions, review, 'option-2')).toThrow('另一份候选')
})
it('rejects duplicates, missing reviews, extra fields and a rejected selected action', () => {
  const actions = options()
  expect(() => parseChatNarrativeOptionsV1([actions[0]])).toThrow()
  expect(() => parseChatNarrativeOptionsV1([actions[0], actions[0]])).toThrow('相同表达')
  const source = reviews(); source.options[0].optionKey = 'option-1'
  expect(() => bindChatNarrativeOptionsReviewV1(source, actions)).toThrow('重复')
  expect(() => bindChatNarrativeOptionsReviewV1({...reviews(), ignored: true}, actions)).toThrow()
  const review = bindChatNarrativeOptionsReviewV1(reviews(), actions)
  review.optionReviews[0].review.checks[0].passed = false
  expect(() => selectedChatNarrativeOptionV1(actions, review, 'option-1')).toThrow('未通过')
})

beforeEach(async () => {db.close(); await db.delete(); await db.open(); store.setState({busy: false, scope: null, selectedSessionId: null})})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'compare', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return {...f, triggerSequence: trigger.sequence}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-options' as const,
    narrativeTriggerSequence: f.triggerSequence, objective: '比较两条互斥走向，等待玩家选择',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify({options: options()})), runReviewAI: async () => JSON.stringify(reviews())}
}

it('persists reviewed alternatives without consequences and commits only the explicit choice after refresh', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  let calls = 0
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async messages => {
    calls++; expect(JSON.stringify(messages)).not.toContain('柜台下'); return JSON.stringify({options: options()})
  }), runReviewAI: async messages => {
    calls++; const prompt = JSON.stringify(messages)
    expect(prompt).toContain('option-1'); expect(prompt).toContain('option-2'); expect(prompt).toContain('柜台下')
    return JSON.stringify(reviews())
  }})
  const runId = generated.snapshot.run.id
  expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
  expect(generated.snapshot.contract.acceptance.some(c => c.id === 'runtime.selection')).toBe(true)
  expect(generated.snapshot.contract.budget.maxModelCalls).toBe(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(await readPendingChatNarrativeRunsV1(f.scope, f.sessionId, before.interaction!)).toEqual([runId])
  await expect(generateInteractionRuntimeCandidateV1(input(f))).rejects.toThrow('已有行动运行')
  db.close(); await db.open()
  expect((await readInteractionRuntimeCandidateV1(f.scope, runId)).candidate).toEqual(generated.candidate)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow('请选择')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId, optionKey: 'option-2'})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.map(m => m.text)).toEqual(['我先坐下听你说。'])
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'lit-door')).toBe(false)
  expect(state.chatNarrative!.situation.goals.find(g => g.goalKey === 'find-seal')!.status).toBe('paused')
  expect(state.remainingDirectorBudget).toBe(98)
  const version = await readProductRuntimeStateVersion(f.sessionId)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId, optionKey: 'option-1'})).rejects.toThrow('另一条')
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(version)
  expect(calls).toBe(2)
})

it.each(['confirmation.recorded', 'runtime.candidate.adopted'])('recovers the selected action after a crash at %s without changing choice or repeating any effect', async boundary => {
  const f = await prepared(), result = await generateInteractionRuntimeCandidateV1(input(f)), runId = result.snapshot.run.id
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId, optionKey: 'option-1', onDurableBoundary: type => {if (type === boundary) throw new Error('host-crashed')}})).rejects.toThrow('host-crashed')
  db.close(); await db.open()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId, optionKey: 'option-2'})).rejects.toThrow('另一条')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.map(m => m.text)).toEqual([options()[0].text])
  expect(state.chatNarrative!.situation.facts.filter(f => f.factKey === 'lit-door')).toHaveLength(1)
  expect(state.remainingDirectorBudget).toBe(98)
})

it.each(['input', 'cancel'])('keeps all unchosen effects out after %s makes the batch unusable', async reason => {
  const f = await prepared(), result = await generateInteractionRuntimeCandidateV1(input(f)), runId = result.snapshot.run.id
  if (reason === 'cancel') await cancelInteractionRuntimeRunV1({scope: f.scope, runId})
  else {const v = await readProductRuntimeStateVersion(f.sessionId); await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'interrupt',
    baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'change', text: '等一下，先别动灯。'})}
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId, optionKey: 'option-1'})).rejects.toThrow()
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.some(m => m.role === 'character')).toBe(false)
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'lit-door')).toBe(false)
  expect(state.remainingDirectorBudget).toBe(100)
})

it('rejects the whole unapproved batch without selecting a fallback or showing rejected text', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), rejected = reviews()
  rejected.options[0].checks[0].passed = false
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runReviewAI: async () => JSON.stringify(rejected)})).rejects.toThrow('审查未通过')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content.includes('false'))).toBe(true)
})

it('serializes competing choices and preserves only the winner through branch and import', async () => {
  const f = await prepared(), result = await generateInteractionRuntimeCandidateV1(input(f)), runId = result.snapshot.run.id
  const outcomes = await Promise.allSettled(['option-1', 'option-2'].map(optionKey => adoptInteractionRuntimeCandidateV1({scope: f.scope, runId, optionKey})))
  expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  const state = await readProductRuntimeState(f.sessionId)
  expect(state.interaction!.messages).toHaveLength(1)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: state.lastSequence, title: 'chosen only'})
  const branched = await readProductRuntimeState(branch.id!)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => s.title === 'chosen only')!
  expect((await readProductRuntimeState(restored.id!)).interaction).toEqual(branched.interaction)
})


it('rejects alternatives hidden from the player before invoking the reviewer', async () => {
  const f = await prepared(), hidden = options(), review = vi.fn(async () => JSON.stringify(reviews()))
  hidden[0].audienceKeys = ['guard']
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify({options: hidden})), runReviewAI: review})).rejects.toThrow('对玩家可见')
  expect(review).not.toHaveBeenCalled()
})

it('projects only reviewed player expressions and disables choices after new input without exposing private review reasons', async () => {
  const f = await prepared(), source = reviews()
  source.options.forEach(o => o.checks.forEach(c => {c.reason = '幕后柜台下的秘密，只限审查。'}))
  const result = await generateInteractionRuntimeCandidateV1({...input(f), runReviewAI: async () => JSON.stringify(source)})
  const view = await readChatNarrativeOptionsPreviewV1(f.scope, f.sessionId, result.snapshot.run.id)
  expect(view.options.map(o => o.text)).toEqual(options().map(o => o.text))
  expect(JSON.stringify(view)).not.toContain('柜台下')
  expect(JSON.stringify(view)).not.toContain('find-seal')
  const other = await seedChatNarrativeRuntimeFixture()
  expect((await readChatNarrativeOptionsPreviewV1(other.scope, other.sessionId, result.snapshot.run.id)).options).toEqual([])
  await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().narrativeOptions).toEqual([view])
  expect(store.getState().recoverableRunIds).toEqual([])
  await store.getState().sendPlayerMessage('先等一下。')
  expect(store.getState().narrativeOptions[0].unavailableReason).toBeTruthy()
  await expect(store.getState().selectNarrativeOption(result.snapshot.run.id, 'option-1')).rejects.toThrow('当前没有')
  await store.getState().cancelPendingRun(result.snapshot.run.id)
  expect(store.getState().narrativeOptions).toEqual([])
})

it('player comparison stops at one candidate batch even with three actions allowed and restores the selection controls', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3})
  await store.getState().load(f.scope, null, f.sessionId)
  const real = harness.generateInteractionRuntimeCandidateV1
  const generate = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(i => real({...i,
    runAI: withChatActionChoiceFixture(async () => JSON.stringify({options: options()})), runReviewAI: async () => JSON.stringify(reviews())}))
  await store.getState().advanceNarrative({kind: 'scene-start', compare: true, participantKey: 'guard', aiConfig: {} as never})
  const runId = store.getState().narrativeOptions[0].runId
  expect(generate).toHaveBeenCalledTimes(1)
  expect(store.getState().runtimeState.interaction!.messages).toEqual([])
  await store.getState().select(null)
  expect(store.getState().narrativeOptions).toEqual([])
  await store.getState().select(f.sessionId)
  expect(store.getState().narrativeOptions[0].runId).toBe(runId)
  await store.getState().selectNarrativeOption(runId, 'option-2')
  expect(store.getState().runtimeState.interaction!.messages.map(m => m.text)).toEqual([options()[1].text])
  expect(store.getState().narrativeOptions).toEqual([])
  expect(generate).toHaveBeenCalledTimes(1)
})

it('review recovery persists alternatives for selection and never auto-adopts one', async () => {
  const f = await prepared()
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onNarrativeActionSaved: id => {runId = id; throw new Error('crash-before-review')}})).rejects.toThrow('crash-before-review')
  await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().pendingNarrativeReviewRunIds).toEqual([runId])
  expect(store.getState().narrativeOptions).toEqual([])
  const resume = harness.resumeChatNarrativeReviewV1
  vi.spyOn(harness, 'resumeChatNarrativeReviewV1').mockImplementation(i => resume({...i, runReviewAI: async () => JSON.stringify(reviews())}))
  await store.getState().resumeNarrativeReview(runId, {} as never)
  expect(store.getState().pendingNarrativeReviewRunIds).toEqual([])
  expect(store.getState().narrativeOptions[0].options).toHaveLength(2)
  expect(store.getState().runtimeState.interaction!.messages).toEqual([])
  await store.getState().selectNarrativeOption(runId, 'option-1')
  expect(store.getState().runtimeState.interaction!.messages.map(m => m.text)).toEqual([options()[0].text])
})


it('explicitly develops the shared background before comparison and cancellation retains only that background', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})
  await store.getState().load(f.scope, null, f.sessionId)
  const real = harness.generateInteractionRuntimeCandidateV1, calls: string[] = []
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(i => real({...i,
    runAI: withChatActionChoiceFixture(async () => {
      calls.push(i.skillId)
      if (i.skillId === 'character.chat-narrative-action') return JSON.stringify({...options()[0], kind: 'speak', newFacts: [], text: '我想先独自检查后门门闩。',
        situationRequest: {threadKey: 'investigate', direction: '检查后门门闩，补足局部线索。', evidenceFactKeys: ['lost'], evidenceExcerpt: '我想先独自检查后门门闩。'}})
      if (i.skillId === 'character.chat-situation-construction') return JSON.stringify({kind: 'chat-situation', title: '门闩', location: '驿站', timeLabel: '傍晚',
        newFacts: [{factKey: 'latch', kind: 'object', text: '后门门闩有一处松动。', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['lost'], seedExcerpt: '检查后门门闩'}],
        newGoals: [], newThreads: [], possibilities: [{actorKey: 'guard', text: '可以继续查看，也可以暂停。', evidenceFactKeys: ['latch']}]})
      return JSON.stringify({options: options()})
    }), runReviewAI: async () => JSON.stringify(i.skillId === 'character.chat-narrative-options' ? reviews()
      : {checks: chatActionReviewOutputFixture().checks.filter(c => i.skillId !== 'character.chat-situation-construction' || c.check !== 'consequences')})}))
  await store.getState().advanceNarrative({kind: 'scene-start', participantKey: 'guard', aiConfig: {} as never})
  await store.getState().advanceNarrative({kind: 'continue', compare: true, participantKey: 'guard', aiConfig: {} as never})
  expect(calls).toEqual(['character.chat-narrative-action', 'character.chat-situation-construction', 'character.chat-narrative-options'])
  const before = store.getState().runtimeState
  expect(before.interaction!.chatNarrative!.situation.facts.some(f => f.factKey === 'latch')).toBe(true)
  expect(before.interaction!.chatNarrative!.situation.facts.some(f => f.factKey === 'lit-door')).toBe(false)
  expect(before.interaction!.messages).toHaveLength(1)
  await store.getState().cancelPendingRun(store.getState().narrativeOptions[0].runId)
  expect(store.getState().runtimeState).toEqual(before)
})


it('does not reveal a private known fact through an unchosen disclosure preview', async () => {
  const f = await prepared(), draft = options()
  draft[0] = {...draft[0], kind: 'speak', text: '叶岑曾误指控一位无辜旅人，始终后悔。', newFacts: [],
    disclosures: [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: '叶岑曾误指控一位无辜旅人，始终后悔。', wording: 'equivalent'}]}
  const review = vi.fn(async () => JSON.stringify(reviews()))
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify({options: draft})), runReviewAI: review})).rejects.toThrow('预览不能提前披露')
  expect(review).not.toHaveBeenCalled()
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'regret')!.audienceKeys).toEqual(['guard'])
})
