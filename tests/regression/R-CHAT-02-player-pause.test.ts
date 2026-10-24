import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import * as skills from '../../src/lib/agent/skill-registry'
import {createInitialInteractionState, parseInteractionState, interactionRetrievalView} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, parseChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {assertChatThreadFollowupReviewVersionV1} from '../../src/lib/character-interaction/narrative-thread-followup'
import {validateChatGoalPlayerPauseV1} from '../../src/lib/character-interaction/narrative-player-pause'
import {chatActionReviewPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, deleteProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {assertChatActionRevisionExpressionV1} from '../../src/lib/character-interaction/action-revision'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {chatCommitmentReviewOutputFixture} from '../helpers/chat-commitment-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const stop = '先别去检查山路，等我确认可以再去。'
const ack = '好，在你明确说可以之前，我先不去检查山路。'
const release = '现在可以去检查了，我留在这里。'
const audience = ['player', 'guard', 'artisan']
const msg = (text: string, eventSequence: number) => ({messageId: `player-${eventSequence}`, eventSequence, role: 'player' as const, speakerKey: 'player', audienceKeys: audience, text, replyToSequence: null, supersededBySequence: null})
function pauseAction(seq = 2): ChatNarrativeActionV1 {
  return {kind: 'speak', text: ack, goalKey: 'assess-road', evidenceFactKeys: ['road'], audienceKeys: audience, waitingForPlayer: true,
    newFacts: [], disclosures: [], threadUpdates: [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: ack}], goalStatus: 'paused', nextPossibilities: [],
    commitmentEffects: [{kind: 'promise', terms: ack, evidenceExcerpt: ack}],
    threadFollowupGoal: {threadKey: 'investigate', evidenceExcerpt: ack, pauseRequest: {playerEventSequence: seq, playerExcerpt: stop},
      goal: {goalKey: 'assess-road', desire: '判断自己能如何帮助恢复通行', concern: '天黑后处理倒树有危险', boundary: '等玩家明确确认再检查，不要求玩家同行', evidenceFactKeys: ['road']}}}
}
function initial() {
  const s = createInitialInteractionState(chatNarrativeFixture()), n = s.chatNarrative!
  Object.assign(n.permissions, {allowActorSituationExpansion: true, allowActorThreadFollowups: true})
  n.situation.goals[0].status = 'fulfilled'; n.situation.possibilities = []
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  s.remainingDirectorBudget = 100; s.messages.push(msg(stop, 2))
  return requestChatNarrativeTriggerV1(s, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
}
function apply(s = initial(), a = pauseAction(), sequence = 4, triggerSequence = 3) {
  return applyReviewedChatNarrativeActionV1(s, {sequence, triggerSequence, actorKey: 'guard', messageId: `action-${sequence}`, action: a,
    review: {reviewedActionJson: canonicalStringify(a), ...chatCommitmentReviewOutputFixture(a)}})
}
function resumeAction(seq = 5): ChatNarrativeActionV1 {
  const text = '我按你的确认查看了门外的山路，倒树仍挡在路上。'
  return {kind: 'complete', text, goalKey: 'assess-road', evidenceFactKeys: ['road'], audienceKeys: audience, waitingForPlayer: false,
    newFacts: [{factKey: 'road-checked', kind: 'observation', text, evidenceFactKeys: ['road'], evidenceExcerpt: text}], disclosures: [], goalStatus: 'fulfilled',
    threadUpdates: [{threadKey: 'investigate', status: 'open', evidenceExcerpt: text}], resumeGoal: {playerEventSequence: seq, playerExcerpt: release},
    commitmentEffects: [{kind: 'fulfill', commitmentKey: 'action-4:promise', evidenceExcerpt: text}]}
}
function resumeState(kind: 'player-response' | 'continue' | 'return' = 'player-response') {
  const s = apply(); s.messages.push(msg(release, 5))
  return requestChatNarrativeTriggerV1(s, {sequence: 6, kind, sourceEventSequence: 5, seed: null})
}
it('atomically preserves the old completion and records a fresh hold, then explicitly resumes without losing the promise', () => {
  const s = initial(), held = apply(s), goal = held.chatNarrative!.situation.goals.at(-1)!
  expect(held.chatNarrative!.situation.goals[0]).toEqual(s.chatNarrative!.situation.goals[0])
  expect(goal).toMatchObject({status: 'paused', playerPause: {threadKey: 'investigate', requested: {messageId: 'player-2', sequence: 2}, acknowledged: {messageId: 'action-4', sequence: 4}}})
  expect(goal.commitments![0].resolution).toBeNull(); expect(parseInteractionState(held)).toEqual(held)
  expect(JSON.stringify(interactionRetrievalView(held, 'artisan'))).not.toContain('playerPause')
  const resumed = apply(resumeState(), resumeAction(), 7, 6)
  expect(resumed.chatNarrative!.situation.goals.at(-1)).toMatchObject({status: 'fulfilled', commitments: [{resolution: {kind: 'fulfilled'}}]})
  expect(resumed.chatNarrative!.situation.goals.at(-1)).not.toHaveProperty('playerPause')
  expect(resumed.chatNarrative!.situation.threads[0].status).toBe('open')
})
it.each(['continue', 'wrong-source', 'old-message', 'hidden-message', 'excluded-message', 'extra-fields', 'wrong-excerpt', 'actual-progress', 'other-thread', 'not-paused', 'reused-goal', 'promise-fulfillment'] as const)('rejects invalid pause %s atomically', kind => {
  const s = initial(), a = pauseAction(), p = a.threadFollowupGoal!
  if (kind === 'continue') s.chatNarrative!.triggers[0].kind = 'continue'
  if (kind === 'wrong-source') p.pauseRequest!.playerEventSequence = 1
  if (kind === 'old-message') s.messages.push(msg('稍等，我再确认。', 3))
  if (kind === 'hidden-message') s.messages[0].audienceKeys = ['player', 'artisan']
  if (kind === 'excluded-message') s.chatNarrative!.excludedMessageIds = ['player-2']
  if (kind === 'extra-fields') Object.assign(p.pauseRequest!, {allowed: true})
  if (kind === 'wrong-excerpt') p.pauseRequest!.playerExcerpt = '不存在的许可'
  if (kind === 'actual-progress') a.newFacts = resumeAction().newFacts
  if (kind === 'other-thread') a.threadUpdates[0].threadKey = 'another'
  if (kind === 'not-paused') a.goalStatus = null
  if (kind === 'reused-goal') {a.goalKey = 'find-seal'; p.goal.goalKey = 'find-seal'}
  if (kind === 'promise-fulfillment') a.commitmentEffects = resumeAction().commitmentEffects
  const before = structuredClone(s); expect(() => apply(s, a)).toThrow(); expect(s).toEqual(before)
})
it.each(['continue', 'return', 'wrong-quote', 'no-release', 'other-goal', 'unchanged-status', 'no-hold'] as const)('rejects invalid resume %s even with injected passing review', kind => {
  let s = resumeState(kind === 'continue' || kind === 'return' ? kind : 'player-response'); const a = resumeAction()
  if (kind === 'wrong-quote') a.resumeGoal!.playerExcerpt = '可以强行推进'
  if (kind === 'no-release') a.resumeGoal = null
  if (kind === 'other-goal') {a.goalKey = 'find-seal'; a.goalUpdates = [{goalKey: 'assess-road', status: 'active', evidenceFactKeys: ['road'], evidenceExcerpt: a.text}]}
  if (kind === 'unchanged-status') a.goalStatus = null
  if (kind === 'no-hold') s = initial()
  const before = structuredClone(s); expect(() => apply(s, a, 7, kind === 'no-hold' ? 3 : 6)).toThrow(); expect(s).toEqual(before)
})
it('permits a quiet response without lifting the hold and refuses forged or initial pause evidence', () => {
  const s = resumeState('continue'), a: ChatNarrativeActionV1 = {kind: 'speak', text: '不急，我还在这里等。', goalKey: 'assess-road', evidenceFactKeys: [], audienceKeys: audience, waitingForPlayer: true, goalStatus: null, newFacts: [], disclosures: [], threadUpdates: []}
  const held = apply(s, a, 7, 6); expect(held.chatNarrative!.situation.goals).toEqual(s.chatNarrative!.situation.goals)
  const broken = structuredClone(held); broken.chatNarrative!.situation.goals.at(-1)!.playerPause!.requested.messageId = 'fake'
  expect(() => parseInteractionState(broken)).toThrow('消息依据')
  expect(() => validateChatGoalPlayerPauseV1(held.chatNarrative!.situation.goals.at(-1)!.playerPause, {initial: true, status: 'paused', updatedSequence: 4, threadKeys: ['investigate']})).toThrow()
})
it('keeps old serialized actions and review instructions, forbids old contracts and immutable resume retargeting', () => {
  const legacy = {...pauseAction(), threadFollowupGoal: null}; expect(parseChatNarrativeActionV1(legacy)).toEqual(legacy)
  for (const a of [pauseAction(), resumeAction(), {...legacy, resumeGoal: null}]) {
    expect(() => assertChatThreadFollowupReviewVersionV1([a], 'chat-narrative-action-review-v21')).toThrow('暂停')
    expect(() => assertChatThreadFollowupReviewVersionV1([a], 'chat-narrative-action-review-v22')).not.toThrow()
  }
  const args = {actions: [legacy], options: false, compact: false, threadFollowup: true}
  expect(chatActionReviewPromptRulesV1(args).join('\n')).not.toContain('玩家暂停及恢复专审')
  expect(chatActionReviewPromptRulesV1({...args, playerPause: true}).join('\n')).toContain('玩家暂停及恢复专审')
  const source = {runId: 1, actorKey: 'guard', triggerSequence: 6, candidateHash: 'a', reviewHash: 'b', action: resumeAction()}, altered = resumeAction(8)
  expect(() => assertChatActionRevisionExpressionV1(source, altered)).toThrow('恢复')
})

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const command = async (sessionId: number) => {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
async function freshMessage(sessionId: number, text: string) {
  const e = await commitInteractionPlayerMessage({...await command(sessionId), messageId: crypto.randomUUID(), text})
  await requestChatNarrativeTrigger({...await command(sessionId), kind: 'player-response', sourceEventSequence: e.sequence})
  return e.sequence
}
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture({actorThreadFollowup: true})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const a: ChatNarrativeActionV1 = {kind: 'speak', text: '我不再寻找铜印了。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: audience, waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'abandoned', nextPossibilities: []}
  const run = await generateInteractionRuntimeCandidateV1(candidate(f, a)); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: run.snapshot.run.id})
  const sequence = await freshMessage(f.sessionId, stop)
  return {...f, pause: pauseAction(sequence)}
}
function candidate(f: {scope: Awaited<ReturnType<typeof seedChatNarrativeRuntimeFixture>>['scope']; sessionId: number}, action: ChatNarrativeActionV1) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '工程注入：明确暂停或恢复自己的责任',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatCommitmentReviewOutputFixture(action))}
}
it('saves before review, recovers once, branches twice, deletes parent, imports and resumes the same held responsibility', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), world = await db.worldReleases.toArray(); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...candidate(f, f.pause), onNarrativeActionSaved: id => {runId = id; throw Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before); db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {expect(messages[0].content).toContain('玩家暂停及恢复专审'); return JSON.stringify(chatCommitmentReviewOutputFixture(f.pause))}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const first = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeState(f.sessionId)).lastSequence, title: '暂停分支'})
  const child = await branchProductRuntimeSession({parentSessionId: first.id!, throughSequence: (await readProductRuntimeState(first.id!)).lastSequence, title: '暂停继承'})
  const held = await readProductRuntimeState(child.id!); expect(held.interaction!.chatNarrative!.situation.goals.at(-1)!.playerPause!.requested.sequence).toBeLessThan(0)
  await deleteProductRuntimeSession(first.id!); await deleteProductRuntimeSession(f.sessionId)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === child.title)!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(held.interaction)
  const importedScope = {projectId, worldId: imported.worldId, workId: imported.workId}
  await freshMessage(imported.id!, '嗯。')
  const quiet: ChatNarrativeActionV1 = {kind: 'pause', text: '好，不急。', goalKey: 'assess-road', evidenceFactKeys: [], audienceKeys: audience, waitingForPlayer: true, goalStatus: null, newFacts: [], disclosures: [], threadUpdates: []}
  const response = await generateInteractionRuntimeCandidateV1(candidate({scope: importedScope, sessionId: imported.id!}, quiet))
  await adoptInteractionRuntimeCandidateV1({scope: importedScope, runId: response.snapshot.run.id})
  expect((await readProductRuntimeState(imported.id!)).interaction!.chatNarrative!.situation).toEqual(held.interaction!.chatNarrative!.situation)
  const seq = await freshMessage(imported.id!, release), a = resumeAction(seq)
  a.commitmentEffects![0] = {kind: 'fulfill', commitmentKey: held.interaction!.chatNarrative!.situation.goals.at(-1)!.commitments![0].commitmentKey, evidenceExcerpt: a.text}
  const next = await generateInteractionRuntimeCandidateV1(candidate({scope: importedScope, sessionId: imported.id!}, a))
  await adoptInteractionRuntimeCandidateV1({scope: importedScope, runId: next.snapshot.run.id})
  const after = await readProductRuntimeState(imported.id!); expect(after.interaction!.chatNarrative!.situation.goals.at(-1)).toMatchObject({status: 'fulfilled'})
  expect(after.interaction!.chatNarrative!.situation.goals.at(-1)).not.toHaveProperty('playerPause')
  expect((await readProductRuntimeState(child.id!)).interaction).toEqual(held.interaction); expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(world)
})
it('rejects weak assent semantically, old frozen reviewers before review, and stale release adoption', async () => {
  const f = await prepared(), original = skills.getAgentSkillV1; let calls = 0
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action-review' ? {...original(id), promptVersion: 'chat-narrative-action-review-v21'} : id === 'character.chat-narrative-action' ? {...original(id), promptVersion: 'chat-narrative-action-v45'} : original(id))
  await expect(generateInteractionRuntimeCandidateV1({...candidate(f, f.pause), runReviewAI: async () => {calls++; return JSON.stringify(chatCommitmentReviewOutputFixture(f.pause))}})).rejects.toThrow('旧审查合同')
  expect(calls).toBe(0); vi.restoreAllMocks()
  // A new explicit message creates a separate opportunity; keep the old blocked candidate.
  f.pause.threadFollowupGoal!.pauseRequest!.playerEventSequence = await freshMessage(f.sessionId, stop)
  const hold = await generateInteractionRuntimeCandidateV1(candidate(f, f.pause)); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: hold.snapshot.run.id})
  const weak = await freshMessage(f.sessionId, '嗯。'), a = resumeAction(weak); a.resumeGoal!.playerExcerpt = '嗯。'
  a.commitmentEffects![0] = {kind: 'fulfill', commitmentKey: `message:harness:${hold.snapshot.run.id}:promise`, evidenceExcerpt: a.text}
  const before = await readProductRuntimeState(f.sessionId), rejected = chatCommitmentReviewOutputFixture(a); rejected.checks.find(c => c.check === 'player-agency')!.passed = false
  await expect(generateInteractionRuntimeCandidateV1({...candidate(f, a), runReviewAI: async () => JSON.stringify(rejected)})).rejects.toThrow('语义审查')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const seq = await freshMessage(f.sessionId, release); a.resumeGoal = {playerEventSequence: seq, playerExcerpt: release}
  const approved = await generateInteractionRuntimeCandidateV1(candidate(f, a))
  await freshMessage(f.sessionId, '等等，还是先别去。')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: approved.snapshot.run.id})).rejects.toThrow()
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.goals.at(-1)!.status).toBe('paused')
})
