import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {parseChatNarrativePermissionsV1, parseChatNarrativeStateV1} from '../../src/lib/character-interaction/narrative-contract'
import {applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {applyChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {chatSituationConstructionRequestV1} from '../../src/lib/character-interaction/narrative-progression'
import {advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import * as harness from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatNarrativeFixture, chatActionReviewFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {followupAction, followupDirection, followupPlayerText, followupResultAction, followupSituation, followupSituationReview, seedClosedChatFollowupFixtureV1} from '../helpers/chat-player-followup'

function initial() {
  const state = createInitialInteractionState(chatNarrativeFixture()), story = state.chatNarrative!
  Object.assign(story.permissions, {allowActorSituationExpansion: true, allowPlayerFollowupSituations: true})
  story.situation.goals.filter(g => g.actorKey === 'guard').forEach(g => {g.status = 'fulfilled'})
  story.situation.possibilities = story.situation.possibilities.filter(p => p.actorKey !== 'guard')
  const scene = state.sceneTemplates[0]
  state.activeScene = {...scene, sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  state.remainingDirectorBudget = 100
  state.messages.push({messageId: 'request', eventSequence: 2, role: 'player', speakerKey: 'player', text: followupPlayerText, audienceKeys: ['guard', 'player'], replyToSequence: null, supersededBySequence: null})
  return requestChatNarrativeTriggerV1(state, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
}
function apply(state = initial(), action = followupAction(2)) {
  return applyReviewedChatNarrativeActionV1(state, {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'followup', action, review: chatActionReviewFixture(action)})
}
it('preserves old release authority and accepts the reviewed intention without reopening completed goals', () => {
  const before = initial(), old = {...before.chatNarrative!.permissions}; delete old.allowPlayerFollowupSituations
  expect(parseChatNarrativePermissionsV1(old)).toEqual(old)
  expect(() => parseChatNarrativePermissionsV1({...old, allowPlayerFollowupSituations: true, allowActorSituationExpansion: false})).toThrow('授权')
  const result = apply(before)
  expect(result.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(result.chatNarrative!.pendingSituation).toMatchObject({purpose: 'player-followup', goalKey: null, threadKey: null, playerEventSequence: 2, sourceEventSequence: 4})
  expect(result.messages.at(-1)?.text).toBe(followupAction(2).text)
})
it.each(['no-permission', 'active-goal', 'old-source', 'invented-quote', 'hidden', 'private', 'excluded', 'waiting', 'pause', 'old-thread'] as const)('rejects unauthorized %s followup atomically', kind => {
  const state = initial(), action = followupAction(2), request = action.situationRequest!
  if (kind === 'no-permission') delete state.chatNarrative!.permissions.allowPlayerFollowupSituations
  if (kind === 'active-goal') state.chatNarrative!.situation.goals[0].status = 'active'
  if (kind === 'old-source' && request.purpose === 'player-followup') request.playerEventSequence = 1
  if (kind === 'invented-quote' && request.purpose === 'player-followup') request.playerExcerpt = '我保证陪你出门'
  if (kind === 'hidden') request.evidenceFactKeys = ['secret']
  if (kind === 'private') state.messages[0].audienceKeys = ['player', 'artisan']
  if (kind === 'excluded') state.chatNarrative!.excludedMessageIds = ['request']
  if (kind === 'waiting') action.waitingForPlayer = true
  if (kind === 'pause') action.kind = 'pause'
  if (kind === 'old-thread') Object.assign(request, {threadKey: 'investigate'})
  const before = structuredClone(state)
  expect(() => apply(state, action)).toThrow()
  expect(state).toEqual(before)
})
it('constructs a distinct own goal and preserves old results and other actors, once per trigger', () => {
  const proposed = apply(), before = structuredClone(proposed.chatNarrative!.situation)
  const ready = requestChatNarrativeTriggerV1(proposed, {sequence: 5, kind: 'continue', sourceEventSequence: 4, seed: null})
  expect(chatSituationConstructionRequestV1(ready, 'guard')).toMatchObject({origin: 'player-followup', actorKey: 'guard'})
  expect(chatSituationConstructionRequestV1(ready, 'artisan')).toBeNull()
  const draft = followupSituation(), result = applyChatSituationV1(ready, {sequence: 6, triggerSequence: 5, draft, review: followupSituationReview(draft)})
  expect(result.chatNarrative!.situation.goals.slice(0, before.goals.length)).toEqual(before.goals)
  expect(result.chatNarrative!.situation.threads.slice(0, before.threads.length)).toEqual(before.threads)
  expect(result.chatNarrative!.situation.facts).toEqual(before.facts)
  expect(result.chatNarrative!.situation.seed.origin).toBe('player-followup')
  expect(result.chatNarrative!.pendingSituation).toBeUndefined()
  expect(() => applyChatSituationV1(result, {sequence: 7, triggerSequence: 5, draft, review: followupSituationReview(draft)})).toThrow('已经构建')
})
it.each(['no-goal', 'no-thread', 'old-goal', 'other-actor', 'time-jump', 'leaked-fact', 'private-request-leak'] as const)('rejects an unusable or unauthorized new situation (%s)', kind => {
  const state = requestChatNarrativeTriggerV1(apply(), {sequence: 5, kind: 'continue', sourceEventSequence: 4, seed: null}), draft = followupSituation(), before = structuredClone(state)
  if (kind === 'no-goal') draft.newGoals = []
  if (kind === 'no-thread') draft.newThreads = []
  if (kind === 'old-goal') draft.newGoals[0].goalKey = 'find-seal'
  if (kind === 'other-actor') draft.newGoals[0].actorKey = 'artisan'
  if (kind === 'time-jump') draft.timeLabel = '明天'
  if (kind === 'private-request-leak') draft.newThreads[0].audienceKeys.push('artisan')
  if (kind === 'leaked-fact') draft.newGoals[0].evidenceFactKeys = ['secret']
  expect(() => applyChatSituationV1(state, {sequence: 6, triggerSequence: 5, draft, review: followupSituationReview(draft)})).toThrow()
  expect(state).toEqual(before)
})

const generate = harness.generateInteractionRuntimeCandidateV1
const config = {provider: 'openai' as const, model: 'fixture', apiKey: 'fixture', temperature: .2, maxTokens: 4000}
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function send(f: Awaited<ReturnType<typeof seedClosedChatFollowupFixtureV1>>, text = followupPlayerText) {
  const v = await readProductRuntimeStateVersion(f.sessionId)
  return commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: crypto.randomUUID(), text, audienceKeys: ['guard', 'player']})
}
async function turn(f: Awaited<ReturnType<typeof seedClosedChatFollowupFixtureV1>>, kind: 'player-response' | 'continue', source?: number, schedulingMode: 'manual' | 'natural' | 'round-robin' = 'manual', actionLimit?: number) {
  const v = await readProductRuntimeStateVersion(f.sessionId)
  return advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind, expectedSequence: v.sequence, replyToSequence: source, participantKey: 'guard', schedulingMode, actionLimit, aiConfig: config})
}
function mock(playerEventSequence: number, options: {interrupt?: () => Promise<void>; reject?: boolean} = {}) {
  const calls = {actions: 0, constructions: 0, reviews: 0}
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async messages => {
      if (input.skillId === 'character.chat-situation-construction') {
        calls.constructions++; expect(JSON.stringify(messages)).toContain(followupDirection)
        await options.interrupt?.(); return JSON.stringify({...followupSituation(), title: '暴雨驿站'})
      }
      expect(JSON.stringify(messages)).not.toContain('柜台下')
      calls.actions++; return JSON.stringify(calls.actions === 1 ? followupAction(playerEventSequence) : followupResultAction())
    }), runReviewAI: async messages => {
      calls.reviews++; const output = input.skillId === 'character.chat-situation-construction' ? {checks: followupSituationReview().checks} : chatActionReviewOutputFixture()
      expect(JSON.stringify(messages)).toContain('player-followup')
      if (options.reject) output.checks.find(c => c.check === 'meaningful-direction')!.passed = false
      return JSON.stringify(output)
    },
  }))
  return calls
}
it('retains a real pending direction through refresh, branch and import, then constructs and acts using remaining authority', async () => {
  const f = await seedClosedChatFollowupFixtureV1(), source = await send(f), calls = mock(source.sequence)
  await turn(f, 'player-response', source.sequence)
  const before = await readProductRuntimeState(f.sessionId), goal = structuredClone(before.interaction!.chatNarrative!.situation.goals[0])
  expect(calls).toEqual({actions: 1, constructions: 0, reviews: 1})
  db.close(); await db.open(); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: before.lastSequence, title: 'followup branch'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  const pending = branched.chatNarrative!.pendingSituation!
  expect(pending.purpose === 'player-followup' && pending.playerEventSequence).toBeLessThan(0)
  expect(pending.sourceEventSequence).toBeLessThan(0)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  expect((await readProductRuntimeState(restored.id!)).interaction).toEqual(branched)
  const imported = {...f, scope: {projectId, worldId: restored.worldId, workId: restored.workId}, sessionId: restored.id!}
  await turn(imported, 'continue')
  const final = (await readProductRuntimeState(restored.id!)).interaction!
  expect(calls).toEqual({actions: 2, constructions: 1, reviews: 3})
  expect(final.chatNarrative!.situation.goals[0]).toMatchObject({goalKey: goal.goalKey, status: goal.status, desire: goal.desire})
  expect(final.chatNarrative!.pendingSituation?.purpose).toBe('observation-result')
  expect(final.chatNarrative!.situation.facts.some(f => f.factKey === 'entry-observed')).toBe(true)
  expect((await readProductRuntimeState(f.sessionId))).toEqual(before)
})
it.each(['manual', 'natural', 'round-robin'] as const)('continues a bounded two-action turn from a closed role through a new reviewed situation (%s)', async mode => {
  const f = await seedClosedChatFollowupFixtureV1({maxActionsPerTrigger: 2}), source = await send(f), calls = mock(source.sequence)
  await turn(f, 'player-response', source.sequence, mode, 2)
  expect(calls).toEqual({actions: 2, constructions: 1, reviews: 3})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers.at(-1)?.actionSequences).toHaveLength(2)
  expect(state.messages.find(m => m.role === 'player')).toMatchObject({playerConversation: 'private', audienceKeys: ['player', 'guard']})
  expect(state.chatNarrative!.situation.title).toBe('暴雨驿站')
  expect(state.chatNarrative!.situation.goals[0].status).toBe('abandoned')
})
it('new player input cancels the unexecuted direction, and stale construction cannot write over it', async () => {
  const f = await seedClosedChatFollowupFixtureV1({maxActionsPerTrigger: 2}), source = await send(f)
  mock(source.sequence, {interrupt: async () => {await send(f, '先别看了，休息一下。')}})
  await expect(turn(f, 'player-response', source.sequence)).rejects.toThrow()
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
  expect(state.chatNarrative!.situation.goals.some(g => g.goalKey === 'check-entry')).toBe(false)
  expect(state.messages.at(-1)?.text).toBe('先别看了，休息一下。')
})
it('a semantic rejection leaves the player request and old completed story without adopting the new intent', async () => {
  const f = await seedClosedChatFollowupFixtureV1(), source = await send(f), calls = mock(source.sequence, {reject: true})
  await expect(turn(f, 'player-response', source.sequence)).rejects.toThrow('语义审查未通过')
  const before = await readProductRuntimeState(f.sessionId)
  expect(before.interaction!.chatNarrative!.pendingSituation).toBeUndefined()
  expect(before.interaction!.messages.at(-1)?.role).toBe('player')
  db.close(); await db.open(); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(calls).toEqual({actions: 1, constructions: 0, reviews: 1})
})
it('unknown construction remains blocked on resume without resending or losing the adopted direction', async () => {
  const f = await seedClosedChatFollowupFixtureV1(), source = await send(f); mock(source.sequence)
  await turn(f, 'player-response', source.sequence); vi.restoreAllMocks()
  let requests = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async () => {requests++; throw new Error('connection lost after dispatch')})}))
  await expect(turn(f, 'continue')).rejects.toThrow('connection lost')
  const state = await readProductRuntimeState(f.sessionId)
  const resume = await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, state.interaction!)
  expect(resume?.blockedReason).toContain('结果未知')
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: state.lastSequence, participantKey: 'guard', aiConfig: config})).rejects.toThrow('结果未知')
  expect(requests).toBe(1)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.pendingSituation?.purpose).toBe('player-followup')
})
it('recovers a saved new situation for review and adopts it once without regeneration', async () => {
  const f = await seedClosedChatFollowupFixtureV1(), source = await send(f); mock(source.sequence)
  await turn(f, 'player-response', source.sequence); vi.restoreAllMocks()
  const v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'followup.recovery', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'continue', sourceEventSequence: v.sequence})
  let runId = 0, generations = 0, reviews = 0
  await expect(generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: 'character.chat-situation-construction', narrativeTriggerSequence: trigger.sequence,
    objective: '承接已审查的新事项', runAI: withChatActionChoiceFixture(async () => {generations++; return JSON.stringify(followupSituation())}),
    onSituationDraftSaved: id => {runId = id; throw new Error('saved-before-host-exit')},
  })).rejects.toThrow('saved-before-host-exit')
  db.close(); await db.open()
  await harness.resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async () => {reviews++; return JSON.stringify({checks: followupSituationReview().checks})}})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect([generations, reviews]).toEqual([1, 1])
  expect(state.chatNarrative!.situation.goals.filter(g => g.goalKey === 'check-entry')).toHaveLength(1)
  expect(state.chatNarrative!.situation.goals[0].status).toBe('abandoned')
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
})
it('stops an unaffordable new-situation continuation before a trigger or provider request', async () => {
  const f = await seedClosedChatFollowupFixtureV1({directorBudget: 7}), source = await send(f), calls = mock(source.sequence)
  await turn(f, 'player-response', source.sequence)
  const before = await readProductRuntimeState(f.sessionId)
  expect(before.interaction!.remainingDirectorBudget).toBe(3)
  await expect(turn(f, 'continue')).rejects.toThrow('预算不足')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(calls).toEqual({actions: 1, constructions: 0, reviews: 1})
})
it('validates the extra player event provenance in persisted state', () => {
  const state = apply().chatNarrative!
  Object.assign(state.pendingSituation!, {playerEventSequence: 1000})
  expect(() => parseChatNarrativeStateV1(state, {participantKeys: ['guard', 'artisan'], characterKeys: ['character:guard', 'character:artisan'], sceneKeys: ['inn']})).toThrow('玩家回应')
})
