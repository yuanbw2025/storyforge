import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import * as skills from '../../src/lib/agent/skill-registry'
import {createInitialInteractionState, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {assertChatExistingGoalPauseReviewVersionV1} from '../../src/lib/character-interaction/narrative-player-pause'
import {assertChatActionRevisionExpressionV1} from '../../src/lib/character-interaction/action-revision'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, deleteProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {chatCommitmentReviewOutputFixture} from '../helpers/chat-commitment-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const stop = '先别找铜印，等我明确说可以再继续。'
const ack = '好，在你明确同意前，我暂停寻找铜印。'
const release = '现在可以继续寻找铜印了。'
const audience = ['player', 'guard']
const msg = (text: string, eventSequence: number) => ({messageId: `player-${eventSequence}`, eventSequence, role: 'player' as const, speakerKey: 'player', audienceKeys: audience, text, replyToSequence: null, supersededBySequence: null})
function action(seq = 2): ChatNarrativeActionV1 {
  return {kind: 'speak', text: ack, goalKey: 'find-seal', evidenceFactKeys: [], audienceKeys: audience, waitingForPlayer: true,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'paused', nextPossibilities: [],
    commitmentEffects: [{kind: 'promise', terms: ack, evidenceExcerpt: ack}],
    pauseGoal: {threadKey: 'investigate', playerEventSequence: seq, playerExcerpt: stop, evidenceExcerpt: ack}}
}
function initial() {
  const s = createInitialInteractionState(chatNarrativeFixture())
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  s.remainingDirectorBudget = 100; s.messages.push(msg(stop, 2))
  return requestChatNarrativeTriggerV1(s, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
}
function apply(s = initial(), a = action(), sequence = 4, triggerSequence = 3) {
  return applyReviewedChatNarrativeActionV1(s, {sequence, triggerSequence, actorKey: 'guard', messageId: `action-${sequence}`, action: a,
    review: {reviewedActionJson: canonicalStringify(a), ...chatCommitmentReviewOutputFixture(a)}})
}
it.each(['active', 'paused'] as const)('binds a real player hold to the existing %s goal without creating a new responsibility', status => {
  const s = initial(), a = action(), beforeGoal = s.chatNarrative!.situation.goals[0]
  beforeGoal.status = status; if (status === 'paused') a.goalStatus = null
  const held = apply(s, a), goal = held.chatNarrative!.situation.goals[0]
  expect(goal).toMatchObject({goalKey: beforeGoal.goalKey, desire: beforeGoal.desire, status: 'paused', updatedSequence: 4,
    playerPause: {threadKey: 'investigate', requested: {messageId: 'player-2', sequence: 2, excerpt: stop}, acknowledged: {messageId: 'action-4', sequence: 4, excerpt: ack}}})
  expect(held.chatNarrative!.situation.goals).toHaveLength(2); expect(held.chatNarrative!.situation.goals[1]).toEqual(s.chatNarrative!.situation.goals[1])
  expect(held.chatNarrative!.situation.threads).toEqual(s.chatNarrative!.situation.threads)
  expect(goal.commitments![0].resolution).toBeNull(); expect(parseInteractionState(held)).toEqual(held)
})
it('can report an already completed observation while pausing future action, without inventing results', () => {
  const a = action(); a.text += '铜印失踪。'; a.evidenceFactKeys = ['lost']
  const s = initial(), held = apply(s, a)
  expect(held.chatNarrative!.situation.facts).toEqual(s.chatNarrative!.situation.facts)
  expect(held.messages.at(-1)!.text).toBe(a.text)
})
it('records the hold without duplicating or replacing an existing independent promise', () => {
  const s = initial(), promised = {...action(), text: '找到铜印后我会把它归还。', evidenceFactKeys: ['lost'], goalStatus: null, pauseGoal: null,
    commitmentEffects: [{kind: 'promise' as const, terms: '找到铜印后我会把它归还。', evidenceExcerpt: '找到铜印后我会把它归还。'}]}
  const before = apply(s, promised), original = structuredClone(before.chatNarrative!.situation.goals[0].commitments)
  before.messages.push(msg(stop, 5))
  const next = requestChatNarrativeTriggerV1(before, {sequence: 6, kind: 'player-response', sourceEventSequence: 5, seed: null})
  const hold = action(5); hold.commitmentEffects = []
  const after = apply(next, hold, 7, 6), goal = after.chatNarrative!.situation.goals[0]
  expect(goal.playerPause!.requested.sequence).toBe(5); expect(goal.commitments).toEqual(original)
  expect(goal.commitments![0].resolution).toBeNull(); expect(after.chatNarrative!.situation.goals).toHaveLength(2)
})
it.each(['wrong-source', 'wrong-excerpt', 'excluded', 'hidden-request', 'not-player-response', 'second-action', 'no-actor-thread', 'closed-thread', 'other-goal', 'finished-goal', 'not-waiting', 'actual-action', 'new-result', 'new-plan', 'other-goal-change', 'old-promise-resolution', 'combined-request', 'wrong-ack', 'unreferenced-disclosure', 'unknown-fact'] as const)('rejects invalid existing-goal hold %s atomically', kind => {
  const s = initial(), a = action(), p = a.pauseGoal!
  if (kind === 'wrong-source') p.playerEventSequence = 1
  if (kind === 'wrong-excerpt') p.playerExcerpt = '我没有说过的话'
  if (kind === 'excluded') s.chatNarrative!.excludedMessageIds = ['player-2']
  if (kind === 'hidden-request') s.messages[0].audienceKeys = ['player', 'artisan']
  if (kind === 'not-player-response') s.chatNarrative!.triggers[0].kind = 'continue'
  if (kind === 'second-action') {s.chatNarrative!.permissions.maxActionsPerTrigger = 2; s.chatNarrative!.triggers[0].actionSequences.push(2)}
  if (kind === 'no-actor-thread') s.chatNarrative!.situation.threads[0].participantKeys = ['artisan']
  if (kind === 'closed-thread') s.chatNarrative!.situation.threads[0].status = 'resolved'
  if (kind === 'other-goal') a.goalKey = 'fix-road'
  if (kind === 'finished-goal') s.chatNarrative!.situation.goals[0].status = 'fulfilled'
  if (kind === 'not-waiting') a.waitingForPlayer = false
  if (kind === 'actual-action') a.kind = 'complete'
  if (kind === 'new-result') a.newFacts.push({factKey: 'new', kind: 'observation', text: ack, evidenceExcerpt: ack, evidenceFactKeys: ['lost']})
  if (kind === 'new-plan') a.nextPossibilities = [{text: '马上去找', evidenceFactKeys: ['lost']}]
  if (kind === 'other-goal-change') a.goalUpdates = [{goalKey: 'fix-road', status: 'paused', evidenceFactKeys: ['road'], evidenceExcerpt: ack}]
  if (kind === 'old-promise-resolution') a.commitmentEffects = [{kind: 'withdraw', commitmentKey: 'old', evidenceExcerpt: ack}]
  if (kind === 'combined-request') a.promiseRequest = {playerEventSequence: 2, playerExcerpt: stop}
  if (kind === 'wrong-ack') p.evidenceExcerpt = '没有说出的确认'
  if (kind === 'unreferenced-disclosure') a.disclosures = [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: ack}]
  if (kind === 'unknown-fact') a.evidenceFactKeys = ['secret']
  const before = structuredClone(s); expect(() => apply(s, a)).toThrow(); expect(s).toEqual(before)
})
it.each(['continue', 'return'] as const)('does not lift the player hold on %s or ordinary acknowledgement', kind => {
  const held = apply(), n = held.chatNarrative!, waiting = {...action(), pauseGoal: null, commitmentEffects: [], goalStatus: null, text: '还在等待你的明确确认。'}
  const next = requestChatNarrativeTriggerV1(held, {sequence: 5, kind, sourceEventSequence: 4, seed: null})
  const after = apply(next, waiting, 6, 5)
  expect(after.chatNarrative!.situation).toEqual(n.situation)
  expect(() => apply(next, {...waiting, kind: 'complete', waitingForPlayer: false, goalStatus: 'active'}, 6, 5)).toThrow('暂停')
  expect(() => apply(next, {...waiting, resumeGoal: {playerEventSequence: 2, playerExcerpt: stop}, goalStatus: 'active'}, 6, 5)).toThrow()
})
it('resumes only from a later explicit source and keeps the fulfilled waiting promise history', () => {
  const held = apply(); held.messages.push(msg(release, 5))
  const next = requestChatNarrativeTriggerV1(held, {sequence: 6, kind: 'player-response', sourceEventSequence: 5, seed: null})
  const text = '你已经明确允许继续，我结束这次等待。'
  const a: ChatNarrativeActionV1 = {...action(), pauseGoal: null, kind: 'complete', text, evidenceFactKeys: ['lost'], waitingForPlayer: false, goalStatus: 'active',
    resumeGoal: {playerEventSequence: 5, playerExcerpt: release}, commitmentEffects: [{kind: 'fulfill', commitmentKey: 'action-4:promise', evidenceExcerpt: text}]}
  const after = apply(next, a, 7, 6), goal = after.chatNarrative!.situation.goals[0]
  expect(goal.status).toBe('active'); expect(goal.playerPause).toBeUndefined(); expect(goal.commitments![0].resolution?.kind).toBe('fulfilled')
  expect(after.messages).toContainEqual(held.messages[0])
})
it('retains old unbound pauses and rejects new fields under old contracts, legacy events and revision substitutions', () => {
  const s = initial(), a = action(); a.pauseGoal = null; a.commitmentEffects = []; a.evidenceFactKeys = ['lost']
  expect(apply(s, a).chatNarrative!.situation.goals[0]).not.toHaveProperty('playerPause')
  for (const version of [undefined, 'chat-narrative-action-review-v26', 'chat-narrative-options-review-v20']) expect(() => assertChatExistingGoalPauseReviewVersionV1([action()], version)).toThrow('旧审查')
  expect(() => assertChatExistingGoalPauseReviewVersionV1([action()], 'chat-narrative-action-review-v27')).not.toThrow()
  expect(() => applyChatNarrativeActionV1(s, {action: action(), actorKey: 'guard', sequence: 4, triggerSequence: 3, messageId: 'legacy'})).toThrow()
  expect(() => assertChatActionRevisionExpressionV1({runId: 1, actorKey: 'guard', triggerSequence: 3, candidateHash: 'a', reviewHash: 'b', action: a}, action())).toThrow('暂停')
})

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  const message = await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'hold.player', messageId: 'hold.player-message', baseSequence: v.sequence, baseStateHash: v.stateHash, text: stop, audienceKeys: audience})
  const now = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'hold.trigger', baseSequence: now.sequence, baseStateHash: now.stateHash, kind: 'player-response', sourceEventSequence: message.sequence})
  return {...f, action: action(message.sequence)}
}
const input = (f: Awaited<ReturnType<typeof prepared>>) => ({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
  objective: '工程注入：暂停已有责任并保留真实来源', runAI: withChatActionChoiceFixture(async () => JSON.stringify(f.action)), runReviewAI: async () => JSON.stringify(chatCommitmentReviewOutputFixture(f.action))})
it('recovers once and preserves existing-goal pause through nested branches, parent deletion and repeated import', async () => {
  const f = await prepared(); let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async messages => {calls++; expect(messages[0].content).toContain('pauseGoal'); return JSON.stringify(f.action)}), onNarrativeActionSaved: id => {runId = id; throw Error('saved')}})).rejects.toThrow('saved')
  db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {calls++; expect(messages[0].content).toContain('已有目标暂停专审'); return JSON.stringify(chatCommitmentReviewOutputFixture(f.action))}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(calls).toBe(2)
  const first = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeState(f.sessionId)).lastSequence, title: '已有目标暂停分支'})
  const child = await branchProductRuntimeSession({parentSessionId: first.id!, throughSequence: (await readProductRuntimeState(first.id!)).lastSequence, title: '已有目标暂停继承'})
  const expected = (await readProductRuntimeState(child.id!)).interaction!
  expect(expected.chatNarrative!.situation.goals[0].playerPause!.requested.sequence).toBeLessThan(0)
  await deleteProductRuntimeSession(f.sessionId); await deleteProductRuntimeSession(first.id!)
  let projectId = f.scope.projectId
  for (let i = 0; i < 2; i++) {
    projectId = await importProjectJSON(await exportProjectJSON(projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === child.title)!
    expect((await readProductRuntimeState(session.id!)).interaction).toEqual(expected)
  }
})
it.each(['semantic-rejection', 'old-review'] as const)('retains %s without adopting or silently retrying a pause', async kind => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId); let calls = 0, runId = 0
  if (kind === 'old-review') {const original = skills.getAgentSkillV1; vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action-review' ? {...original(id), promptVersion: 'chat-narrative-action-review-v26'} : id === 'character.chat-narrative-action' ? {...original(id), promptVersion: 'chat-narrative-action-v45'} : original(id))}
  const review = chatCommitmentReviewOutputFixture(f.action); review.checks.find(c => c.check === 'player-agency')!.passed = false
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(f.action)}), runReviewAI: async () => {calls++; return JSON.stringify(review)}})).rejects.toThrow()
  expect(calls).toBe(kind === 'old-review' ? 1 : 2); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
})

it('rejects adoption of a saved pause after another player message without an extra model call', async () => {
  const f = await prepared(); let calls = 0
  const candidate = await generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(f.action)}), runReviewAI: async () => {calls++; return JSON.stringify(chatCommitmentReviewOutputFixture(f.action))}})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'hold.new-player', messageId: 'hold.new-player-message', baseSequence: v.sequence, baseStateHash: v.stateHash, text: '这次先只听你说。', audienceKeys: audience})
  const before = await readProductRuntimeState(f.sessionId)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before); expect(calls).toBe(2)
})
