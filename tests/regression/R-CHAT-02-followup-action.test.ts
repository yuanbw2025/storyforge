import {CHAT_HISTORY_CAPACITY_V1} from '../../src/lib/character-interaction/history-capacity'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {assertChatActionRevisionExpressionV1} from '../../src/lib/character-interaction/action-revision'
import {advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import {forkChatMessageEditV1, readChatMessageEditPlanV1} from '../../src/lib/character-interaction/narrative-edit'
import * as harness from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewFixture, chatActionReviewOutputFixture, chatNarrativeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {followupPlayerText, followupOwnAction, followupSituationReview, seedClosedChatFollowupFixtureV1} from '../helpers/chat-player-followup'
import type {ChatNarrativeActionV1, ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const action = (sequence = 2) => followupOwnAction(sequence)
function initial() {
  const state = createInitialInteractionState(chatNarrativeFixture()), story = state.chatNarrative!
  Object.assign(story.permissions, {allowActorSituationExpansion: true, allowPlayerFollowupSituations: true})
  story.situation.goals.filter(g => g.actorKey === 'guard').forEach(g => {g.status = 'fulfilled'})
  story.situation.possibilities = story.situation.possibilities.filter(p => p.actorKey !== 'guard')
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  state.remainingDirectorBudget = 100
  state.messages.push({messageId: 'request', eventSequence: 2, role: 'player', speakerKey: 'player', text: followupPlayerText, audienceKeys: ['guard', 'player'], replyToSequence: null, supersededBySequence: null})
  return requestChatNarrativeTriggerV1(state, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
}
function apply(state = initial(), candidate = action()) {
  return applyReviewedChatNarrativeActionV1(state, {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'checked-entry', action: candidate, review: chatActionReviewFixture(candidate)})
}
it('atomically accepts the own goal, first actual observation and pending result without new background', () => {
  const before = initial(), saved = structuredClone(before), result = apply(before), story = result.chatNarrative!
  expect(before).toEqual(saved)
  expect(story.situation.goals.at(-1)).toMatchObject({...action().followupGoal!.goal, actorKey: 'guard', status: 'active', updatedSequence: 4})
  expect(story.situation.threads.at(-1)).toMatchObject({participantKeys: ['guard'], audienceKeys: ['guard', 'player'], status: 'open', updatedSequence: 4})
  expect(story.situation.seed).toEqual(before.chatNarrative!.situation.seed)
  expect(story.situation.goals.slice(0, -1)).toEqual(before.chatNarrative!.situation.goals)
  expect(story.pendingSituation).toMatchObject({purpose: 'observation-result', goalKey: 'check-entry', sourceEventSequence: 4})
  expect(result.remainingDirectorBudget).toBe(before.remainingDirectorBudget - 2)
  expect(story.triggers.at(-1)?.actionSequences).toEqual([4])
})
it('the player already knows their own private request even when the recipient list names only the role', () => {
  const state = initial(); state.messages[0].audienceKeys = ['guard']
  expect(apply(state).chatNarrative!.situation.threads.at(-1)?.audienceKeys).toEqual(['guard', 'player'])
})
it.each(['permission', 'expansion', 'unfinished', 'not-first', 'continue', 'wrong-source', 'wrong-quote', 'wrong-expression', 'not-retrievable', 'superseded', 'private-request', 'secret', 'private-thread', 'old-goal', 'old-thread', 'other-owner', 'status-forgery', 'goal-mismatch', 'waiting', 'pause', 'background-request', 'thread-limit', 'goal-limit'] as const)('rejects %s atomically', kind => {
  const state = initial(), candidate = action(), proposal = candidate.followupGoal!, story = state.chatNarrative!
  if (kind === 'permission') delete story.permissions.allowPlayerFollowupSituations
  if (kind === 'expansion') story.permissions.allowActorSituationExpansion = false
  if (kind === 'unfinished') story.situation.goals[0].status = 'paused'
  if (kind === 'not-first') {story.permissions.maxActionsPerTrigger = 3; story.triggers[0].actionSequences.push(1)}
  if (kind === 'continue') story.triggers[0].kind = 'continue'
  if (kind === 'wrong-source') proposal.playerEventSequence = 1
  if (kind === 'wrong-quote') proposal.playerExcerpt = '我和你一起出门'
  if (kind === 'wrong-expression') proposal.evidenceExcerpt = '我同意了另一个目标'
  if (kind === 'not-retrievable') story.excludedMessageIds = ['request']
  if (kind === 'superseded') state.messages[0].supersededBySequence = 3
  if (kind === 'private-request') candidate.audienceKeys.push('artisan')
  if (kind === 'secret') proposal.goal.evidenceFactKeys = ['secret']
  if (kind === 'private-thread') proposal.thread.evidenceFactKeys = ['regret']
  if (kind === 'old-goal') {proposal.goal.goalKey = 'find-seal'; candidate.goalKey = 'find-seal'}
  if (kind === 'old-thread') proposal.thread.threadKey = 'investigate'
  if (kind === 'other-owner') Object.assign(proposal.goal, {actorKey: 'artisan'})
  if (kind === 'status-forgery') Object.assign(proposal.goal, {status: 'fulfilled'})
  if (kind === 'goal-mismatch') candidate.goalKey = null
  if (kind === 'waiting') candidate.waitingForPlayer = true
  if (kind === 'pause') candidate.kind = 'pause'
  if (kind === 'background-request') delete candidate.situationRequest!.purpose
  if (kind === 'thread-limit') story.permissions.maxActiveThreads = 1
  if (kind === 'goal-limit') while (story.situation.goals.length < CHAT_HISTORY_CAPACITY_V1.goals) story.situation.goals.push({...story.situation.goals[0], goalKey: `old-${story.situation.goals.length}`})
  const saved = structuredClone(state)
  expect(() => apply(state, candidate)).toThrow()
  expect(state).toEqual(saved)
})
it('requires independent review, preserves historical canonical actions and locks the goal in consequence-only revisions', () => {
  const state = initial(), candidate = action(), input = {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'checked-entry', action: candidate}
  expect(() => applyChatNarrativeActionV1(state, input)).toThrow('旧行动')
  const review = chatActionReviewFixture(candidate); review.checks.find(c => c.check === 'meaningful-direction')!.passed = false
  expect(() => applyReviewedChatNarrativeActionV1(state, {...input, review})).toThrow()
  const revisionSource = {runId: 1, actorKey: 'guard', triggerSequence: 3, candidateHash: 'a', reviewHash: 'b', action: candidate}
  const revision = structuredClone(candidate); revision.followupGoal!.goal.desire = '强迫旅人出门'
  expect(() => assertChatActionRevisionExpressionV1(revisionSource, revision)).toThrow()
  expect(() => assertChatActionRevisionExpressionV1(revisionSource, structuredClone(candidate))).not.toThrow()
})

const generate = harness.generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function send(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return commitInteractionPlayerMessage({sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: crypto.randomUUID(), text: followupPlayerText, audienceKeys: ['guard', 'player']})
}
it('uses seven requests including choice after the new goal, limited result and closure; preserves branch and backup state', async () => {
  const f = await seedClosedChatFollowupFixtureV1({maxActionsPerTrigger: 3}), source = await send(f.sessionId), calls: string[] = []
  const outcome: ChatSituationDraftV1 = {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'entry-result', kind: 'observation', text: '门槛内所见仅有浅水，门外远处仍看不清。', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['entry-observed'], seedExcerpt: '确认已经完成的门内观察所见'}], newGoals: [], newThreads: [], possibilities: []}
  const ending: ChatNarrativeActionV1 = {kind: 'complete', text: '门槛内所见仅有浅水，门外远处仍看不清。我就先查看到这里。', goalKey: 'check-entry', evidenceFactKeys: ['entry-result'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [], threadUpdates: [{threadKey: 'entry-condition', status: 'resolved', evidenceExcerpt: '我就先查看到这里。'}], goalStatus: 'fulfilled', nextPossibilities: []}
  let actions = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input, runAI: withChatActionChoiceFixture(async messages => {
    calls.push(input.skillId)
    if (input.skillId === 'character.chat-situation-construction') return JSON.stringify(outcome)
    expect(JSON.stringify(messages)).not.toContain('柜台下')
    expect(JSON.stringify(messages)).toContain('followupGoal')
    return JSON.stringify(actions++ === 0 ? action(source.sequence) : ending)
  }), runReviewAI: async () => {
    calls.push('review'); return JSON.stringify(input.skillId === 'character.chat-situation-construction' ? {checks: followupSituationReview(outcome).checks} : chatActionReviewOutputFixture())
  }}))
  const before = await readProductRuntimeState(f.sessionId)
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: source.sequence, kind: 'player-response', replyToSequence: source.sequence, participantKey: 'guard', actionLimit: 3, aiConfig: {} as never})
  expect(calls).toEqual(['character.chat-narrative-action', 'review', 'character.chat-situation-construction', 'review', 'character.chat-narrative-action', 'review'])
  const state = await readProductRuntimeState(f.sessionId), story = state.interaction!.chatNarrative!
  expect(story.situation.goals.at(-1)?.status).toBe('fulfilled')
  expect(story.situation.threads.at(-1)?.status).toBe('resolved')
  expect(story.triggers.at(-1)?.actionSequences).toHaveLength(2)
  expect(state.interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 7)
  db.close(); await db.open(); expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: state.lastSequence, title: 'own followup closure'})
  const branchState = (await readProductRuntimeState(branch.id!)).interaction!
  expect(branchState.chatNarrative!.situation.goals.at(-1)?.updatedSequence).toBeLessThan(0)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  expect((await readProductRuntimeState(restored.id!)).interaction).toEqual(branchState)
  expect((await readProductRuntimeState(f.sessionId))).toEqual(state)
  expect(calls).toHaveLength(6)
  const firstMessage = state.interaction!.messages.find(m => m.text === action().text)!
  const edited = await forkChatMessageEditV1({scope: f.scope, plan: await readChatMessageEditPlanV1(f.scope, f.sessionId, firstMessage.messageId), text: '我先休息一下。'})
  const editState = (await readProductRuntimeState(edited.id!)).interaction!
  expect(editState.chatNarrative!.situation.goals.some(g => g.goalKey === 'check-entry')).toBe(false)
  expect(editState.chatNarrative!.situation.threads.some(t => t.threadKey === 'entry-condition')).toBe(false)
  expect(editState.chatNarrative!.situation.facts.some(f => f.factKey === 'entry-observed')).toBe(false)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
})

it('one-step pace stops after the actual first action and restores the saved candidate without regeneration', async () => {
  const f = await seedClosedChatFollowupFixtureV1(), source = await send(f.sessionId)
  let requests = 0, runId = 0
  const v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'first-actual-action', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'player-response', sourceEventSequence: source.sequence})
  const before = await readProductRuntimeState(f.sessionId)
  await expect(generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', narrativeTriggerSequence: trigger.sequence,
    objective: '只做获准的一步', runAI: withChatActionChoiceFixture(async () => {requests++; return JSON.stringify(action(source.sequence))}),
    onNarrativeActionSaved: id => {runId = id; throw new Error('saved-before-review')},
  })).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  await harness.resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {requests++; return JSON.stringify(chatActionReviewOutputFixture())}})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, story = state.chatNarrative!
  expect(requests).toBe(2)
  expect(story.triggers.at(-1)).toMatchObject({status: 'complete', actionSequences: [trigger.sequence + 1]})
  expect(story.situation.goals.filter(g => g.goalKey === 'check-entry')).toHaveLength(1)
  expect(story.pendingSituation?.purpose).toBe('observation-result')
  expect(story.situation.facts.some(f => f.factKey === 'entry-result')).toBe(false)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, state)).toBeNull()
})

it.each(['unknown', 'interrupted', 'review-rejected'] as const)('keeps the entire new intention uncommitted after %s and never silently resends', async failure => {
  const f = await seedClosedChatFollowupFixtureV1({maxActionsPerTrigger: 3}), source = await send(f.sessionId)
  let generations = 0, reviews = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: async () => {
      generations++
      if (failure === 'unknown') throw new Error('dispatched-result-unknown')
      if (failure === 'interrupted') await send(f.sessionId)
      return JSON.stringify(action(source.sequence))
    }, runReviewAI: async () => {reviews++; const review = chatActionReviewOutputFixture(); review.checks.find(c => c.check === 'player-agency')!.passed = false; return JSON.stringify(review)},
  }))
  await expect(advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: source.sequence, kind: 'player-response', replyToSequence: source.sequence, participantKey: 'guard', actionLimit: 3, aiConfig: {} as never})).rejects.toThrow()
  const state = await readProductRuntimeState(f.sessionId)
  expect(state.interaction!.chatNarrative!.situation.goals.some(g => g.goalKey === 'check-entry')).toBe(false)
  expect(state.interaction!.chatNarrative!.situation.facts.some(f => f.factKey === 'entry-observed')).toBe(false)
  expect(generations).toBe(1)
  if (failure === 'unknown') {
    expect(reviews).toBe(0)
    await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: state.lastSequence, participantKey: 'guard', aiConfig: {} as never})).rejects.toThrow('结果未知')
    expect(generations).toBe(1)
  }
})
