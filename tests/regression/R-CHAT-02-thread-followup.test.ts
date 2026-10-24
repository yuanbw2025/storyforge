import {CHAT_HISTORY_CAPACITY_V1} from '../../src/lib/character-interaction/history-capacity'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createInitialInteractionState, interactionRetrievalView} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, parseChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatCanFollowThreadV1, assertChatThreadFollowupReviewVersionV1} from '../../src/lib/character-interaction/narrative-thread-followup'
import {createChatScheduledDirectionV1} from '../../src/lib/character-interaction/narrative-scheduling'
import {chatActionPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {parseChatNarrativePermissionsV1} from '../../src/lib/character-interaction/narrative-contract'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import * as runtimeHarness from '../../src/lib/character-interaction/harness'
import {advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1} from '../../src/lib/character-interaction/narrative-turn'
import {assertChatActionRevisionExpressionV1} from '../../src/lib/character-interaction/action-revision'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewFixture, chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const own = (): ChatNarrativeActionV1 => ({kind: 'speak', text: '寻找的事情已经放下。我先判断山路有没有自己能处理的部分。', goalKey: 'assess-road',
  evidenceFactKeys: ['road'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
  nextPossibilities: [{text: '从当前已知路况考虑可以独立处理的办法。', evidenceFactKeys: ['road']}],
  threadFollowupGoal: {threadKey: 'investigate', evidenceExcerpt: '我先判断山路有没有自己能处理的部分。',
    goal: {goalKey: 'assess-road', desire: '判断自己能如何帮助恢复通行', concern: '天黑后处理倒树有危险', boundary: '不要求旅人参与', evidenceFactKeys: ['road']}}})
function initial() {
  const s = createInitialInteractionState(chatNarrativeFixture()), n = s.chatNarrative!
  Object.assign(n.permissions, {allowActorSituationExpansion: true, allowActorThreadFollowups: true})
  n.situation.goals[0].status = 'abandoned'; n.situation.possibilities = []
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  s.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(s, {sequence: 2, kind: 'continue', sourceEventSequence: 1, seed: null})
}
function apply(s = initial(), action = own()) {
  return applyReviewedChatNarrativeActionV1(s, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'own-next-step', action, review: chatActionReviewFixture(action)})
}
it('accepts one own goal within the existing thread, preserving old goals, history, ownership and quota', () => {
  const s = initial(), before = structuredClone(s), result = apply(s)
  expect(result.chatNarrative!.situation.goals.slice(0, -1)).toEqual(s.chatNarrative!.situation.goals)
  expect(result.chatNarrative!.situation.goals.at(-1)).toMatchObject({actorKey: 'guard', status: 'active', goalKey: 'assess-road', updatedSequence: 3})
  expect(result.chatNarrative!.situation.threads).toEqual(s.chatNarrative!.situation.threads)
  expect(result.chatNarrative!.situation.facts).toEqual(s.chatNarrative!.situation.facts)
  expect(result.remainingDirectorBudget).toBe(98)
  expect(result.chatNarrative!.triggers[0].actionSequences).toEqual([3]); expect(s).toEqual(before)
})
it.each(['missing-permission', 'expansion-off', 'active-goal', 'paused-goal', 'paused-thread', 'resolved-thread', 'abandoned-thread', 'other-participant', 'unknown-thread', 'not-first', 'scene-start', 'secret-evidence', 'wrong-excerpt', 'old-key', 'old-desire', 'waiting', 'other-owner', 'forged-status', 'new-thread', 'goal-limit'] as const)('rejects %s without partial writes', kind => {
  const s = initial(), n = s.chatNarrative!, a = own(), p = a.threadFollowupGoal!
  if (kind === 'missing-permission') delete n.permissions.allowActorThreadFollowups
  if (kind === 'expansion-off') n.permissions.allowActorSituationExpansion = false
  if (kind === 'active-goal') n.situation.goals[0].status = 'active'
  if (kind === 'paused-goal') n.situation.goals[0].status = 'paused'
  if (kind === 'paused-thread') n.situation.threads[0].status = 'paused'
  if (kind === 'resolved-thread') n.situation.threads[0].status = 'resolved'
  if (kind === 'abandoned-thread') n.situation.threads[0].status = 'abandoned'
  if (kind === 'other-participant') n.situation.threads[0].participantKeys = ['artisan']
  if (kind === 'unknown-thread') p.threadKey = 'missing'
  if (kind === 'not-first') {n.permissions.maxActionsPerTrigger = 3; n.triggers[0].actionSequences = [1]}
  if (kind === 'scene-start') n.triggers[0].kind = 'scene-start'
  if (kind === 'secret-evidence') p.goal.evidenceFactKeys = ['secret']
  if (kind === 'wrong-excerpt') p.evidenceExcerpt = '不存在的表达'
  if (kind === 'old-key') {p.goal.goalKey = 'find-seal'; a.goalKey = 'find-seal'}
  if (kind === 'old-desire') p.goal.desire = n.situation.goals[0].desire
  if (kind === 'waiting') a.waitingForPlayer = true
  if (kind === 'other-owner') Object.assign(p.goal, {actorKey: 'artisan'})
  if (kind === 'forged-status') Object.assign(p.goal, {status: 'fulfilled'})
  if (kind === 'new-thread') Object.assign(p, {thread: {threadKey: 'new'}})
  if (kind === 'goal-limit') while (n.situation.goals.length < CHAT_HISTORY_CAPACITY_V1.goals) n.situation.goals.push({...n.situation.goals[0], goalKey: `old-${n.situation.goals.length}`})
  const before = structuredClone(s); expect(() => apply(s, a)).toThrow(); expect(s).toEqual(before)
})
it('offers manual and scheduled continuation only with the opt-in and permits declining without a fabricated goal', () => {
  const s = initial(); s.activeScene!.activeParticipantKeys = ['guard']
  expect(chatCanFollowThreadV1(s, 'guard', s.chatNarrative!.triggers[0])).toBe(true)
  for (const mode of ['natural', 'round-robin'] as const) expect(createChatScheduledDirectionV1(s, {kind: 'continue', sourceSequence: 1, actionLimit: 1, mode}).actorKey).toBe('guard')
  const a = {...own(), kind: 'pause' as const, goalKey: null, text: '天色不合适，今天先休息。', threadFollowupGoal: null, nextPossibilities: []}
  const after = apply(s, a); expect(after.chatNarrative!.situation.goals).toEqual(s.chatNarrative!.situation.goals)
  expect(after.chatNarrative!.situation.threads).toEqual(s.chatNarrative!.situation.threads)
  delete s.chatNarrative!.permissions.allowActorThreadFollowups
  expect(() => createChatScheduledDirectionV1(s, {kind: 'continue', sourceSequence: 1, actionLimit: 1, mode: 'natural'})).toThrow()
  expect(() => apply(s, a)).toThrow()
})
it('does not enlarge legacy permissions, action events, reviewers or immutable revision intent', () => {
  const p = {...initial().chatNarrative!.permissions}; delete p.allowActorThreadFollowups
  expect(parseChatNarrativePermissionsV1(p)).toEqual(p)
  expect(() => parseChatNarrativePermissionsV1({...p, allowActorThreadFollowups: true, allowActorSituationExpansion: false})).toThrow()
  expect(() => parseChatNarrativePermissionsV1({...p, allowActorThreadFollowups: 'yes'})).toThrow()
  expect(parseChatNarrativeActionV1(own())).toEqual(own())
  expect(() => applyChatNarrativeActionV1(initial(), {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'old', action: own()})).toThrow()
  expect(() => assertChatThreadFollowupReviewVersionV1([own()], 'chat-narrative-action-review-v20')).toThrow()
  expect(() => assertChatThreadFollowupReviewVersionV1([own()], 'chat-narrative-action-review-v21')).not.toThrow()
  const source = {runId: 1, actorKey: 'guard', triggerSequence: 2, candidateHash: 'a', reviewHash: 'b', action: own()}, altered = own()
  altered.threadFollowupGoal!.threadKey = 'another'
  expect(() => assertChatActionRevisionExpressionV1(source, altered)).toThrow('接续')
})
it('uses only the acting role view for eligibility and preserves the ordinary closure rules', () => {
  const s = initial(), before = chatActionPromptRulesV1(interactionRetrievalView(s, 'guard')).join('\n')
  expect(before).toContain('结构为 {threadKey:'); expect(before).toContain('个人目标完成与整条事项解决分别判断')
  s.chatNarrative!.situation.goals[1].desire = '另一个角色的秘密'
  s.chatNarrative!.situation.facts[2].text = '幕后真相改变'
  expect(chatActionPromptRulesV1(interactionRetrievalView(s, 'guard')).join('\n')).toBe(before)
})

const generateActual = generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function ready() {
  const f = await seedChatNarrativeRuntimeFixture({actorThreadFollowup: true, onlyGuard: true})
  let v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const action: ChatNarrativeActionV1 = {kind: 'speak', text: '我不再找铜印了。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'abandoned', nextPossibilities: []}
  const first = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程夹具：结束个人寻找，不结束尚含离开需求的事项', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: first.snapshot.run.id})
  v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'next', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'continue', sourceEventSequence: v.sequence, direction: {actorKey: 'guard', actionLimit: 1}})
  return f
}
it('recovers the new candidate without regenerating, atomically adopts once and preserves branch/import lineage', async () => {
  const f = await ready(), before = await readProductRuntimeState(f.sessionId); let runId = 0, calls = 0
  expect((await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, before.interaction!))?.blockedReason).toBeNull()
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '接续原事项', runAI: withChatActionChoiceFixture(async messages => {
    calls++; expect(messages[0].content).toContain('threadFollowupGoal'); expect(messages[1].content).not.toContain('柜台下'); return JSON.stringify(own())
  }), onNarrativeActionSaved: id => {runId = id; throw Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {calls++; expect(messages[0].content).toContain('若含 threadFollowupGoal'); return JSON.stringify(chatActionReviewOutputFixture())}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const after = await readProductRuntimeState(f.sessionId)
  expect(calls).toBe(2); expect(after.interaction!.chatNarrative!.situation.goals.filter(g => g.goalKey === 'assess-road')).toHaveLength(1)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '接续后分支'})
  expect((await readProductRuntimeState(branch.id!)).interaction!.chatNarrative!.situation.goals.at(-1)?.desire).toBe(own().threadFollowupGoal!.goal.desire)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), sessions = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()
  for (const session of sessions) expect((await readProductRuntimeState(session.id!)).interaction!.chatNarrative!.situation.goals.at(-1)?.goalKey).toBe('assess-road')
})
it('retains a semantic rejection and rejects stale adoption without introducing the goal', async () => {
  const f = await ready(), before = await readProductRuntimeState(f.sessionId), report = chatActionReviewOutputFixture()
  report.checks.find(c => c.check === 'meaningful-direction')!.passed = false
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '拒绝无意义接续', runAI: withChatActionChoiceFixture(async () => JSON.stringify(own())), runReviewAI: async () => JSON.stringify(report)})).rejects.toThrow('语义审查')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'interrupt', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'stop', text: '先别继续。'})
  let head = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'explicit-next', baseSequence: head.sequence, baseStateHash: head.stateHash, kind: 'continue', sourceEventSequence: head.sequence})
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '新的隔离工程候选', runAI: withChatActionChoiceFixture(async () => JSON.stringify(own())), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  head = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'later-stop', baseSequence: head.sequence, baseStateHash: head.stateHash, messageId: 'later-stop', text: '这次也先停下。'})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.goals.some(g => g.goalKey === 'assess-road')).toBe(false)
})

it.each(['manual', 'natural', 'round-robin'] as const)('reaches the actual bounded turn entry after personal closure using %s scheduling', async schedulingMode => {
  const f = await ready(), state = await readProductRuntimeState(f.sessionId); let calls = 0
  // Isolate the closed-goal actor so all three real turn paths must admit it.
  vi.spyOn(runtimeHarness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generateActual({...input,
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(own())}),
    runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())},
  }))
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: state.lastSequence, kind: 'continue', participantKey: 'guard', schedulingMode, actionLimit: 1, aiConfig: {} as never})
  expect(calls).toBe(2)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.goals.at(-1)?.goalKey).toBe('assess-road')
  expect((await readProductRuntimeState(f.sessionId)).lastSequence).toBe(state.lastSequence + 2)
})
