import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {createChatNarrativeSituationV1, advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import {commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {followupAction, followupResultAction, followupSituation as baseSituation, followupSituationReview, followupPlayerText, seedClosedChatFollowupFixtureV1} from '../helpers/chat-player-followup'
import type {ChatNarrativeActionV1, ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
const config = {provider: 'openai' as const, model: 'fixture', apiKey: 'fixture', baseUrl: 'https://chat-continuous.invalid/v1', temperature: .2, maxTokens: 4000}
const resultText = '门口浅水没有漫过门槛，远处路面仍未知。'
// This request is private: its own new thread must not rename the shared scene.
function followupSituation(): ChatSituationDraftV1 {return {...baseSituation(), title: '暴雨驿站'}}
function outcome(): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: followupSituation().title, location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'entry-result', kind: 'observation', text: resultText, audienceKeys: ['guard', 'player'], evidenceFactKeys: ['entry-observed'], seedExcerpt: '确认已经完成的门内观察所见'}],
    newGoals: [], newThreads: [], possibilities: []}
}
function resolution(): ChatNarrativeActionV1 {
  return {kind: 'complete', text: `${resultText}这次门口检查结束，我不再往外走。`, goalKey: 'check-entry', evidenceFactKeys: ['entry-result'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [], goalStatus: 'fulfilled', threadUpdates: [{threadKey: 'entry-condition', status: 'resolved', evidenceExcerpt: '这次门口检查结束'}], nextPossibilities: []}
}
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function scenario(options: {limit?: number; budget?: number; stop?: 'future' | 'waiting' | 'pause' | 'unknown' | 'crash'} = {}) {
  const f = await seedClosedChatFollowupFixtureV1({maxActionsPerTrigger: options.limit ?? 3, directorBudget: options.budget}), v = await readProductRuntimeStateVersion(f.sessionId)
  const source = await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'request', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'request', text: followupPlayerText, audienceKeys: ['guard', 'player']})
  const before = await readProductRuntimeState(f.sessionId), calls = {actions: 0, constructions: 0, reviews: 0}
  let resultRunId = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async () => {
    if (input.skillId === 'character.chat-situation-construction') return JSON.stringify(++calls.constructions === 1 ? followupSituation() : outcome())
    calls.actions++
    const action = calls.actions === 1 ? followupAction(source.sequence) : calls.actions === 2 ? followupResultAction() : resolution()
    if (calls.actions === 2 && options.stop === 'future') delete action.situationRequest!.purpose
    if (calls.actions === 2 && ['waiting', 'pause'].includes(options.stop ?? '')) {
      action.kind = options.stop === 'waiting' ? 'attempt' : 'pause'; action.waitingForPlayer = options.stop === 'waiting'
      action.text = options.stop === 'waiting' ? '你愿意一起看看吗？' : '我先暂停检查，在门内休息。'
      action.newFacts = []; action.situationRequest = null; action.goalStatus = options.stop === 'pause' ? 'paused' : null
    }
    return JSON.stringify(action)
  }), onSituationDraftSaved: async id => {
    if (calls.constructions === 2) {resultRunId = id; if (options.stop === 'crash') throw new Error('host-crashed-before-result-review')}
  }, runReviewAI: async () => {
    calls.reviews++
    if (input.skillId === 'character.chat-situation-construction' && calls.constructions === 2 && options.stop === 'unknown') throw new Error('result-review-response-lost')
    return JSON.stringify(input.skillId === 'character.chat-situation-construction' ? {checks: followupSituationReview().checks} : chatActionReviewOutputFixture())
  }}))
  return {f, before, calls, resultRunId: () => resultRunId, start: (schedulingMode: 'manual' | 'natural' | 'round-robin' = 'manual') => advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, kind: 'player-response', expectedSequence: before.lastSequence, replyToSequence: source.sequence, participantKey: 'guard', schedulingMode, actionLimit: options.limit ?? 3, aiConfig: config})}
}

it.each(['manual', 'natural', 'round-robin'] as const)('finishes a new request, completed observation and bounded result within three authorized actions (%s)', async schedulingMode => {
  const {f, before, calls, start} = await scenario()
  await start(schedulingMode)
  const after = (await readProductRuntimeState(f.sessionId)).interaction!, story = after.chatNarrative!
  expect(calls).toEqual({actions: 3, constructions: 2, reviews: 5})
  expect(after.messages.find(m => m.role === 'player')).toMatchObject({playerConversation: 'private', audienceKeys: ['player', 'guard']})
  expect(story.situation.title).toBe('暴雨驿站')
  expect(story.triggers.at(-1)).toMatchObject({status: 'complete', actionSequences: expect.any(Array)})
  expect(story.triggers.at(-1)?.actionSequences).toHaveLength(3)
  expect(story.situation.goals.find(g => g.goalKey === 'check-entry')?.status).toBe('fulfilled')
  expect(story.situation.threads.find(t => t.threadKey === 'entry-condition')?.status).toBe('resolved')
  expect(story.pendingSituation).toBeUndefined()
  expect(after.messages.at(-1)?.text).toBe(resolution().text)
  expect(before.interaction!.remainingDirectorBudget - after.remainingDirectorBudget).toBe(12)
  expect(story.situation.goals[0]).toEqual(before.interaction!.chatNarrative!.situation.goals[0])
  db.close(); await db.open()
  expect((await readProductRuntimeState(f.sessionId)).interaction).toEqual(after)
})

it.each(['future', 'waiting', 'pause'] as const)('keeps the original stop boundary for %s instead of creating more situations', async stop => {
  const {f, calls, start} = await scenario({stop})
  await start()
  expect(calls).toEqual({actions: 2, constructions: 1, reviews: 3})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'entry-result')).toBe(false)
  if (stop === 'future') expect((await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, state))?.blockedReason).toContain('新的角色方向')
})

it('preserves a pending result at the two-action limit without spending a third action', async () => {
  const {f, calls, start} = await scenario({limit: 2})
  await start()
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(calls).toEqual({actions: 2, constructions: 1, reviews: 3})
  expect(state.chatNarrative!.pendingSituation?.purpose).toBe('observation-result')
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, state)).toBeNull()
})

it('requires the complete result, review and reply budget before starting the second construction', async () => {
  const {f, calls, before, start} = await scenario({budget: 11})
  await expect(start()).rejects.toThrow('预算不足')
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(calls).toEqual({actions: 2, constructions: 1, reviews: 3})
  expect(state.chatNarrative!.pendingSituation?.purpose).toBe('observation-result')
  expect(state.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 7)
})

it('does not resend a result review with unknown outcome during same-turn recovery', async () => {
  const {f, calls, start} = await scenario({stop: 'unknown'})
  await expect(start()).rejects.toThrow('result-review-response-lost')
  const state = await readProductRuntimeState(f.sessionId), previous = {...calls}
  db.close(); await db.open()
  expect((await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, state.interaction!))?.blockedReason).toContain('结果未知')
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: state.lastSequence, aiConfig: config})).rejects.toThrow('结果未知')
  expect(calls).toEqual(previous)
  expect((await readProductRuntimeState(f.sessionId))).toEqual(state)
})

it('recovers the saved result, resumes only the third action and retains the outcome after backup import', async () => {
  const {f, calls, resultRunId, start} = await scenario({stop: 'crash'})
  await expect(start()).rejects.toThrow('host-crashed-before-result-review')
  db.close(); await db.open()
  let reviews = 0
  await harness.resumeChatSituationReviewV1({scope: f.scope, runId: resultRunId(), runReviewAI: async () => {reviews++; return JSON.stringify({checks: followupSituationReview().checks})}})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: resultRunId()})
  const before = await readProductRuntimeState(f.sessionId)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, before.interaction!)).toMatchObject({remainingActions: 1, blockedReason: null})
  await resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: before.lastSequence, aiConfig: config})
  expect(calls).toEqual({actions: 3, constructions: 2, reviews: 4}); expect(reviews).toBe(1)
  const final = (await readProductRuntimeState(f.sessionId)).interaction!
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), session = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
  expect((await readProductRuntimeState(session!.id!)).interaction).toEqual(final)
})

it('also resolves an observation after a player seed without rebuilding the seed or losing prepared-state validity', async () => {
  const f = await seedClosedChatFollowupFixtureV1({maxActionsPerTrigger: 2}), v = await readProductRuntimeStateVersion(f.sessionId)
  let actions = 0, constructions = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async () => {
    if (input.skillId === 'character.chat-situation-construction') return JSON.stringify(++constructions === 1 ? followupSituation() : outcome())
    return JSON.stringify(++actions === 1 ? followupResultAction() : resolution())
  }), runReviewAI: async () => JSON.stringify(input.skillId === 'character.chat-situation-construction' ? {checks: followupSituationReview().checks} : chatActionReviewOutputFixture())}))
  await createChatNarrativeSituationV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: v.sequence, seed: '雨停了，角色准备从门内检查门口积水。', participantKey: 'guard', actionLimit: 2, aiConfig: config})
  expect({actions, constructions}).toEqual({actions: 2, constructions: 2})
  const story = (await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!
  expect(story.triggers.at(-1)).toMatchObject({kind: 'player-seed', status: 'complete'})
  expect(story.situation.goals.find(g => g.goalKey === 'check-entry')?.status).toBe('fulfilled')
  expect(story.pendingSituation).toBeUndefined()
})
