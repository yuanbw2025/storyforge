import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {createInitialInteractionState, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, applyChatNarrativeActionV1, requestChatNarrativeTriggerV1, interruptChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {parseChatNarrativeStateV1, parseChatNarrativePermissionsV1} from '../../src/lib/character-interaction/narrative-contract'
import {applyChatSituationV1, isChatSituationPreparedV1} from '../../src/lib/character-interaction/narrative-situations'
import {chatSituationConstructionRequestV1} from '../../src/lib/character-interaction/narrative-progression'
import {advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import * as harness from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitChatNarrativeAction, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatNarrativeFixture, chatActionReviewFixture, chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {isImportedCompletedInteractionRunV1} from '../../src/lib/character-interaction/runtime-run-recovery'
import {useCharacterInteractionPlayerStore as player} from '../../src/stores/character-interaction-player'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
const config = {provider: 'openai' as const, model: 'fixture', apiKey: 'fixture', temperature: .2, maxTokens: 4000}
const direction = '检查后门门闩，补足可以自己查看的局部线索，不预设铜印已经找到。'
function proposal(): ChatNarrativeActionV1 {
  return {kind: 'speak', text: '我想先独自检查后门门闩。你可以留在这里休息。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {threadKey: 'investigate', direction, evidenceFactKeys: ['lost'], evidenceExcerpt: '我想先独自检查后门门闩。'}}
}
function background(): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '后门的检查方向', location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'latch', kind: 'object', text: '后门门闩有一处松动。', audienceKeys: ['guard', 'player', 'artisan'], evidenceFactKeys: ['lost'], seedExcerpt: '检查后门门闩'}],
    newGoals: [], newThreads: [], possibilities: [{actorKey: 'guard', text: '可以查看门闩，也可以先询问修理师。', evidenceFactKeys: ['latch']}]}
}
function situationReview(draft = background()) {
  return {reviewedProposalJson: canonicalStringify(draft), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具，不是语义质量验收'}))}
}
function prepared(allow = true, limit = 1) {
  const content = chatNarrativeFixture()
  if (allow) content.chatNarrative!.permissions.allowActorSituationExpansion = true
  content.chatNarrative!.permissions.maxActionsPerTrigger = limit
  content.chatNarrative!.initialSituation.possibilities.push({actorKey: 'artisan', text: '先等待雨势减弱再处理山路。', evidenceFactKeys: ['road']})
  const state = createInitialInteractionState(content)
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(state, {sequence: 2, sourceEventSequence: 1, kind: 'scene-start', seed: null})
}
function proposed(action = proposal(), initial = prepared()) {
  return applyReviewedChatNarrativeActionV1(initial, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'direction', action, review: chatActionReviewFixture(action)})
}
function continuing() {return requestChatNarrativeTriggerV1(proposed(), {sequence: 4, sourceEventSequence: 3, kind: 'continue', seed: null})}

it('preserves historical permissions and prevents legacy actions from introducing an autonomous request', () => {
  const old = prepared(false).chatNarrative!.permissions
  expect(parseChatNarrativePermissionsV1(old)).toEqual(old)
  expect(Object.hasOwn(parseChatNarrativePermissionsV1(old), 'allowActorSituationExpansion')).toBe(false)
  expect(() => proposed(proposal(), prepared(false))).toThrow('权限')
  expect(() => applyChatNarrativeActionV1(prepared(), {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'legacy', action: proposal()})).toThrow('旧行动')
})

it('records a private reviewed intention without inventing facts or player input, and interrupt cancels it even after a complete trigger', () => {
  const state = proposed(), before = prepared()
  expect(state.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(state.chatNarrative!.triggers[0].status).toBe('complete')
  expect(state.chatNarrative!.pendingSituation).toMatchObject({actorKey: 'guard', goalKey: 'find-seal', sourceEventSequence: 3, direction})
  expect(JSON.stringify(interactionVisibilityView(state, 'guard'))).toContain(direction)
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).not.toContain(direction)
  expect(JSON.stringify(interactionVisibilityView(state, 'artisan'))).not.toContain(direction)
  expect(state.messages.map(m => m.role)).toEqual(['character'])
  interruptChatNarrativeTriggerV1(state, 4)
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
  expect(state.chatNarrative!.lastEventSequence).toBe(4)
  expect(state.messages).toHaveLength(1)
})

it.each([
  ['waiting', (a: ChatNarrativeActionV1) => {a.waitingForPlayer = true}],
  ['pause', a => {a.kind = 'pause'}],
  ['paused goal', a => {a.goalStatus = 'paused'}],
  ['unknown thread', a => {a.situationRequest!.threadKey = 'other'}],
  ['hidden evidence', a => {a.situationRequest!.evidenceFactKeys = ['secret']}],
  ['empty evidence', a => {a.situationRequest!.evidenceFactKeys = []}],
  ['invented expression', a => {a.situationRequest!.evidenceExcerpt = '我已经找到铜印。'}],
] as const)('rejects %s requests atomically', (_label, change) => {
  const action = proposal(), initial = prepared(), before = structuredClone(initial); change(action)
  expect(() => proposed(action, initial)).toThrow()
  expect(initial).toEqual(before)
})

it('constructs once from the own thread on explicit continuation and preserves other actors plans', () => {
  const state = continuing(), draft = background()
  expect(chatSituationConstructionRequestV1(state, 'guard')).toMatchObject({origin: 'continued-thread', text: direction, sourceThreadKey: 'investigate'})
  expect(chatSituationConstructionRequestV1(state, 'artisan')).toBeNull()
  expect(isChatSituationPreparedV1(state, 'guard')).toBe(false)
  const next = applyChatSituationV1(state, {sequence: 5, triggerSequence: 4, draft, review: situationReview(draft)})
  expect(next.chatNarrative!.pendingSituation).toBeUndefined()
  expect(next.chatNarrative!.situation.seed).toMatchObject({origin: 'continued-thread', sourceEventSequence: 4, sourceThreadKey: 'investigate'})
  expect(next.chatNarrative!.situation.facts.at(-1)).toMatchObject({factKey: 'latch', origin: 'runtime-situation', sourceEventSequence: 5})
  expect(next.chatNarrative!.situation.goals).toEqual(state.chatNarrative!.situation.goals)
  expect(next.chatNarrative!.situation.possibilities.find(p => p.actorKey === 'artisan')).toEqual(state.chatNarrative!.situation.possibilities.find(p => p.actorKey === 'artisan'))
  expect(next.messages).toEqual(state.messages)
  expect(isChatSituationPreparedV1(next)).toBe(true)
  expect(() => applyChatSituationV1(next, {sequence: 6, triggerSequence: 4, draft, review: situationReview(draft)})).toThrow('已经构建')
})

it.each([
  ['relocation', (d: ChatSituationDraftV1) => {d.location = '后山'}],
  ['time jump', d => {d.timeLabel = '次日'}],
  ['other role goal', d => {d.newGoals = [{goalKey: 'other', actorKey: 'artisan', desire: '去找铜印', concern: '担心丢失', boundary: '不要求玩家', evidenceFactKeys: ['lost']}]}],
  ['other role plan', d => {d.possibilities[0].actorKey = 'artisan'}],
  ['hidden truth', d => {d.newFacts[0].evidenceFactKeys = ['secret']}],
  ['unseen new fact', d => {d.newFacts[0].audienceKeys = ['player']}],
  ['unrelated direction', d => {d.newFacts[0].seedExcerpt = '随便添加一场火灾'}],
] as const)('rejects autonomous %s without changing current facts or plans', (_label, change) => {
  const state = continuing(), before = structuredClone(state), draft = background(); change(draft)
  expect(() => applyChatSituationV1(state, {sequence: 5, triggerSequence: 4, draft, review: situationReview(draft)})).toThrow()
  expect(state).toEqual(before)
})

it('rejects forged pending event references and a semantic review rejection', () => {
  const state = proposed(), action = proposal(), review = chatActionReviewFixture(action)
  review.checks[5].passed = false
  expect(() => applyReviewedChatNarrativeActionV1(prepared(), {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'reject', action, review})).toThrow('审查未通过')
  state.chatNarrative!.pendingSituation!.sourceEventSequence = 200
  expect(() => parseChatNarrativeStateV1(state.chatNarrative, {participantKeys: ['guard', 'artisan'], characterKeys: ['character:guard', 'character:artisan'], sceneKeys: ['inn']})).toThrow('已审查行动')
})

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it('keeps pending own direction through refresh, branch and export, and real player input cancels it', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})
  let v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'opening', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  v = await readProductRuntimeStateVersion(f.sessionId)
  const action = proposal()
  await commitChatNarrativeAction({sessionId: f.sessionId, commandId: 'propose', baseSequence: v.sequence, baseStateHash: v.stateHash, triggerSequence: trigger.sequence, actorKey: 'guard', messageId: 'proposal', action, review: chatActionReviewFixture(action)})
  const before = await readProductRuntimeState(f.sessionId)
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: before.lastSequence, title: 'pending direction'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!.chatNarrative!
  expect(branched.pendingSituation!.sourceEventSequence).toBeLessThan(0)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => s.title === branch.title)!
  expect((await readProductRuntimeState(restored.id!)).interaction!.chatNarrative).toEqual(branched)
  v = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'interrupt', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'rest', text: '先不要查后门，我想休息。', audienceKeys: null})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.pendingSituation).toBeUndefined()
})

it('uses the formal bounded turn to propose, construct/review and then act without a player-authored seed', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true, maxActionsPerTrigger: 3})
  let roleCalls = 0, reviewCalls = 0, constructions = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async messages => {
      if (input.skillId === 'character.chat-situation-construction') {
        constructions++; expect(JSON.stringify(messages)).toContain(direction); return JSON.stringify(background())
      }
      roleCalls++
      expect(JSON.stringify(messages)).not.toContain('柜台下')
      if (roleCalls === 1) return JSON.stringify(proposal())
      expect(JSON.stringify(messages)).toContain('后门门闩有一处松动。')
      return JSON.stringify({...proposal(), kind: 'pause', text: '门闩确有松动，我先留意这一处，不打扰你休息。', evidenceFactKeys: ['latch'], situationRequest: null})
    }),
    runReviewAI: async () => {reviewCalls++; return JSON.stringify(input.skillId === 'character.chat-situation-construction'
      ? {checks: situationReview().checks} : chatActionReviewOutputFixture())},
  }))
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'scene-start', participantKey: 'guard', expectedSequence: v.sequence, aiConfig: config})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect([roleCalls, constructions, reviewCalls]).toEqual([2, 1, 3])
  expect(state.messages.map(m => m.role)).toEqual(['character', 'character'])
  expect(state.chatNarrative!.situation.seed.origin).toBe('continued-thread')
  expect(state.chatNarrative!.triggers[0].actionSequences).toHaveLength(2)
  expect(state.chatNarrative!.triggers[0].status).toBe('complete')
  expect(state.remainingDirectorBudget).toBe(92)
  db.close(); await db.open()
  expect((await readProductRuntimeState(f.sessionId)).interaction).toEqual(state)
})

function mockProgression(options: {keepProposing?: boolean; nextAction?: ChatNarrativeActionV1; beforeConstruction?: () => Promise<void>; beforeReview?: () => Promise<void>; rejectReview?: boolean} = {}) {
  const calls = {actions: 0, constructions: 0, reviews: 0}
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async () => {
      if (input.skillId === 'character.chat-situation-construction') {
        calls.constructions++; await options.beforeConstruction?.(); return JSON.stringify(background())
      }
      calls.actions++
      return JSON.stringify(calls.actions === 1 || options.keepProposing ? proposal()
        : options.nextAction ?? {...proposal(), kind: 'pause', text: '门闩的松动值得留意，我先停在这里。', evidenceFactKeys: ['latch'], situationRequest: null})
    }),
    runReviewAI: async () => {
      calls.reviews++
      if (input.skillId !== 'character.chat-situation-construction') return JSON.stringify(chatActionReviewOutputFixture())
      await options.beforeReview?.()
      const review = situationReview()
      if (options.rejectReview) review.checks.find(c => c.check === 'meaningful-direction')!.passed = false
      return JSON.stringify({checks: review.checks})
    },
  }))
  return calls
}
async function advance(f: Awaited<ReturnType<typeof seedChatNarrativeRuntimeFixture>>, kind: 'scene-start' | 'continue') {
  const v = await readProductRuntimeStateVersion(f.sessionId)
  return advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind, participantKey: 'guard', expectedSequence: v.sequence, aiConfig: config})
}

it('defers the default single action direction across refresh until an explicit continuation constructs and acts', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true}), calls = mockProgression()
  await advance(f, 'scene-start')
  const first = await readProductRuntimeState(f.sessionId)
  expect(first.interaction!.chatNarrative!.pendingSituation).toMatchObject({direction})
  expect(calls).toEqual({actions: 1, constructions: 0, reviews: 1})
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(first)
  expect(calls).toEqual({actions: 1, constructions: 0, reviews: 1})
  await advance(f, 'continue')
  const final = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(calls).toEqual({actions: 2, constructions: 1, reviews: 3})
  expect(final.chatNarrative!.pendingSituation).toBeUndefined()
  expect(final.chatNarrative!.situation.facts.some(f => f.factKey === 'latch')).toBe(true)
  expect(final.messages.map(m => m.role)).toEqual(['character', 'character'])
  expect(final.chatNarrative!.triggers.map(t => t.actionSequences.length)).toEqual([1, 1])
})

it('does not loop new construction when the second action proposes another direction in the same bounded trigger', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true, maxActionsPerTrigger: 3})
  const calls = mockProgression({keepProposing: true})
  await advance(f, 'scene-start')
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(calls).toEqual({actions: 2, constructions: 1, reviews: 3})
  expect(state.chatNarrative!.pendingSituation!.sourceEventSequence).toBe(state.messages.at(-1)!.eventSequence)
  expect(chatSituationConstructionRequestV1(state, 'guard')).toBeNull()
  expect(state.remainingDirectorBudget).toBe(92)
})

it('rejects an unaffordable continuation before consuming a trigger or making a provider request', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true, directorBudget: 5}), calls = mockProgression()
  await advance(f, 'scene-start')
  const before = await readProductRuntimeState(f.sessionId)
  expect(before.interaction!.remainingDirectorBudget).toBe(2)
  await expect(advance(f, 'continue')).rejects.toThrow('预算不足')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(calls).toEqual({actions: 1, constructions: 0, reviews: 1})
})

it.each(['construction', 'review'])('rejects late autonomous %s after a real player interruption', async boundary => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true, maxActionsPerTrigger: 3})
  const interrupt = async () => {
    const v = await readProductRuntimeStateVersion(f.sessionId)
    await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'stop', baseSequence: v.sequence, baseStateHash: v.stateHash,
      messageId: 'rest', text: '先停下，我还想问一句。', audienceKeys: ['guard']})
  }
  const calls = mockProgression(boundary === 'construction' ? {beforeConstruction: interrupt} : {beforeReview: interrupt})
  await expect(advance(f, 'scene-start')).rejects.toThrow()
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'latch')).toBe(false)
  expect(state.messages.map(m => m.role)).toEqual(['character', 'player'])
  expect(state.messages.at(-1)!.text).toBe('先停下，我还想问一句。')
  expect(calls.actions).toBe(1)
  expect(calls.constructions).toBe(1)
})

it('retains a rejected autonomous background and the previous direction without automatic retry or partial writes', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true, maxActionsPerTrigger: 3})
  const calls = mockProgression({rejectReview: true})
  await expect(advance(f, 'scene-start')).rejects.toThrow('语义审查未通过')
  const before = await readProductRuntimeState(f.sessionId)
  expect(before.interaction!.chatNarrative!.pendingSituation).toMatchObject({direction})
  expect(before.interaction!.chatNarrative!.situation.facts.some(f => f.factKey === 'latch')).toBe(false)
  expect(before.interaction!.messages).toHaveLength(1)
  const run = (await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).toArray()).at(-1)!
  expect((await readInstanceAgentRunV1(f.scope, run.id!)).projection.state).toBe('failed')
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content.includes('meaningful-direction') && a.content.includes('false'))).toBe(true)
  db.close(); await db.open()
  await expect(harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: run.id!})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(calls).toEqual({actions: 1, constructions: 1, reviews: 2})
})

it('recovers a saved autonomous background and reviews it once without regenerating or consuming player input', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})
  mockProgression()
  await advance(f, 'scene-start')
  vi.restoreAllMocks()
  const v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'continue', baseSequence: v.sequence,
    baseStateHash: v.stateHash, kind: 'continue', sourceEventSequence: v.sequence})
  let runId = 0, constructions = 0, reviews = 0
  await expect(generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player',
    skillId: 'character.chat-situation-construction', narrativeTriggerSequence: trigger.sequence, objective: '承接已审查角色方向',
    runAI: withChatActionChoiceFixture(async () => {constructions++; return JSON.stringify(background())}),
    onSituationDraftSaved: id => {runId = id; throw new Error('host-crashed')},
  })).rejects.toThrow('host-crashed')
  db.close(); await db.open()
  await harness.resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async () => {reviews++; return JSON.stringify({checks: situationReview().checks})}})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect([constructions, reviews]).toEqual([1, 1])
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
  expect(state.chatNarrative!.situation.facts.filter(f => f.factKey === 'latch')).toHaveLength(1)
  expect(state.messages.map(m => m.role)).toEqual(['character'])
  expect(state.remainingDirectorBudget).toBe(95)
})

it('imports a completed run as history and continues its saved direction without replaying or revalidating old actions', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true}), calls = mockProgression()
  await advance(f, 'scene-start')
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
  const scope = {projectId, worldId: session.worldId!, workId: session.workId!}
  const imported = {scope, sessionId: session.id!, sceneSequence: f.sceneSequence}
  const row = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray())[0]
  const snapshot = await readInstanceAgentRunV1(scope, row.id!)
  const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray()
  expect(snapshot.projection.state).toBe('running')
  expect(isImportedCompletedInteractionRunV1(snapshot, events)).toBe(true)
  expect(isImportedCompletedInteractionRunV1(snapshot, [])).toBe(false)
  expect(isImportedCompletedInteractionRunV1(snapshot, events.map(e => ({...e, sessionId: f.sessionId})))).toBe(false)
  const tampered = structuredClone(snapshot), last = tampered.events.at(-1)!
  if (last.type !== 'verification.staled') throw new Error('missing import invalidation')
  last.payload.reason = 'a-different-stale-reason'
  expect(isImportedCompletedInteractionRunV1(tampered, events)).toBe(false)
  await player.getState().load(scope, null, session.id!)
  expect(player.getState().recoverableRunIds).toEqual([])
  expect(player.getState().pendingNarrativeRunIds).toEqual([])
  expect(await db.agentRuns.get(row.id!)).toEqual(row)
  expect(calls).toEqual({actions: 1, constructions: 0, reviews: 1})
  await advance(imported, 'continue')
  const state = (await readProductRuntimeState(imported.sessionId)).interaction!
  expect(state.messages.map(m => m.role)).toEqual(['character', 'character'])
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
  expect(state.chatNarrative!.situation.facts.filter(f => f.factKey === 'latch')).toHaveLength(1)
  expect(calls).toEqual({actions: 2, constructions: 1, reviews: 3})
  expect(await db.agentRuns.get(row.id!)).toEqual(row)
})

it('settles the last reviewed direction in a versioned one-action turn, so a short refusal can receive actual progress', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})
  const nextAction: ChatNarrativeActionV1 = {...proposal(), kind: 'complete', text: '你不用动手。我独自拧紧松动的门闩，门扇现在可以合上。',
    evidenceFactKeys: ['latch'], situationRequest: null, newFacts: [{factKey: 'door-fixed', kind: 'observation', text: '门扇现在可以合上。', evidenceFactKeys: ['latch'], evidenceExcerpt: '门扇现在可以合上。'}]}
  const calls = mockProgression({nextAction}), world = JSON.stringify(await db.worldReleases.toArray())
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'scene-start', participantKey: 'guard', expectedSequence: v.sequence, aiConfig: config, actionLimit: 1, settleSituation: true})
  const first = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(calls).toEqual({actions: 1, constructions: 1, reviews: 2})
  expect(first.messages).toHaveLength(1)
  expect(first.chatNarrative!.triggers[0]).toMatchObject({status: 'complete', direction: {settleSituationVersion: 1, actionLimit: 1}})
  expect(first.chatNarrative!.pendingSituation).toBeUndefined()
  expect(first.chatNarrative!.situation.facts.some(fact => fact.factKey === 'latch')).toBe(true)
  const head = await readProductRuntimeStateVersion(f.sessionId)
  const message = await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'settled-short-reply', baseSequence: head.sequence,
    baseStateHash: head.stateHash, messageId: 'short-reply', text: '我在听，还是不参与调查。'})
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'player-response', replyToSequence: message.sequence,
    participantKey: 'guard', expectedSequence: message.sequence, aiConfig: config, actionLimit: 1, settleSituation: true})
  const final = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(calls).toEqual({actions: 2, constructions: 1, reviews: 3})
  expect(final.chatNarrative!.situation.facts.some(fact => fact.factKey === 'door-fixed')).toBe(true)
  expect(final.messages.filter(m => m.role === 'player').map(m => m.text)).toEqual(['我在听，还是不参与调查。'])
  expect(JSON.stringify(await db.worldReleases.toArray())).toBe(world)
  db.close(); await db.open()
  expect((await readProductRuntimeState(f.sessionId)).interaction).toEqual(final)
})

it.each(['review', 'unknown'] as const)('retains the adopted action after %s final settlement failure and never resends', async failure => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true}), calls = mockProgression(failure === 'review' ? {rejectReview: true} : {beforeConstruction: async () => {throw new Error('unknown fixture outcome')}})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await expect(advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'scene-start', participantKey: 'guard', expectedSequence: v.sequence,
    aiConfig: config, actionLimit: 1, settleSituation: true})).rejects.toThrow()
  const state = await readProductRuntimeState(f.sessionId)
  expect(state.interaction!.messages).toHaveLength(1)
  expect(state.interaction!.chatNarrative!.situation.facts.some(fact => fact.factKey === 'latch')).toBe(false)
  expect(state.interaction!.chatNarrative!.pendingSituation).toMatchObject({direction})
  const resume = await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, state.interaction!)
  expect(resume).toMatchObject({remainingActions: 0, pendingSituation: true})
  expect(resume!.blockedReason).toContain(failure === 'review' ? '失败或取消' : '结果未知')
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: state.lastSequence, aiConfig: config})).rejects.toThrow(failure === 'review' ? '失败或取消' : '结果未知')
  expect(calls).toEqual({actions: 1, constructions: 1, reviews: failure === 'review' ? 2 : 1})
})

it('cancels in-flight final settlement on new player input without losing the already adopted action', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})
  const calls = mockProgression({beforeReview: async () => {
    const v = await readProductRuntimeStateVersion(f.sessionId)
    await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'stop-settlement', baseSequence: v.sequence,
      baseStateHash: v.stateHash, messageId: 'stop', text: '先停下，我不想继续调查。'})
  }})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await expect(advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'scene-start', participantKey: 'guard', expectedSequence: v.sequence,
    aiConfig: config, actionLimit: 1, settleSituation: true})).rejects.toThrow()
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.map(m => m.role)).toEqual(['character', 'player'])
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
  expect(state.chatNarrative!.triggers[0].status).toBe('cancelled')
  expect(state.chatNarrative!.situation.facts.some(fact => fact.factKey === 'latch')).toBe(false)
  expect(calls).toEqual({actions: 1, constructions: 1, reviews: 2})
})

it('recovers only unfinished final settlement after branch/import without granting another action', async () => {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true}), calls = mockProgression()
  const v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'settle-recovery', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 1, settleSituationVersion: 1}})
  const generated = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId,
    skillId: 'character.chat-narrative-action', participantKey: 'guard', narrativeTriggerSequence: trigger.sequence, objective: '工程中断检查点', aiConfig: config})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const first = await readProductRuntimeState(f.sessionId)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, first.interaction!)).toMatchObject({pendingSituation: true, remainingActions: 0, blockedReason: null})
  expect(() => applyReviewedChatNarrativeActionV1(first.interaction!, {sequence: first.lastSequence + 1, triggerSequence: trigger.sequence,
    actorKey: 'guard', messageId: 'extra', action: proposal(), review: chatActionReviewFixture(proposal())})).toThrow()
  await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: first.lastSequence, title: 'pending-settlement'})
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const branch = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => s.title === 'pending-settlement')!
  const scope = {projectId: branch.projectId, worldId: branch.worldId!, workId: branch.workId!}
  db.close(); await db.open()
  const restored = await readProductRuntimeState(branch.id!)
  expect(calls).toEqual({actions: 1, constructions: 0, reviews: 1})
  expect(await readChatNarrativeTurnResumeV1(scope, branch.id!, restored.interaction!)).toMatchObject({pendingSituation: true, remainingActions: 0, blockedReason: null})
  await resumeChatNarrativeTurnV1({scope, sessionId: branch.id!, expectedSequence: restored.lastSequence, aiConfig: config})
  const final = (await readProductRuntimeState(branch.id!)).interaction!
  expect(calls).toEqual({actions: 1, constructions: 1, reviews: 2})
  expect(final.messages).toHaveLength(1)
  expect(final.chatNarrative!.triggers.slice(-1)[0].status).toBe('complete')
  expect(final.chatNarrative!.pendingSituation).toBeUndefined()
  expect((await readProductRuntimeState(f.sessionId)).interaction).toEqual(first.interaction)
})
