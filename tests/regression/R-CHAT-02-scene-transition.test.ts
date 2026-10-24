import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import * as skills from '../../src/lib/agent/skill-registry'
import {createInitialInteractionState, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {assertChatActionRevisionExpressionV1} from '../../src/lib/character-interaction/action-revision'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, deleteProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, endInteractionScene, startInteractionScene} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {chatCommitmentReviewOutputFixture} from '../helpers/chat-commitment-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const request = '我们一起去后院看看，但今天不拆东西，也不买东西。'
const arrived = '我们已经一起走到后院。'
const audience = ['player', 'guard']
const msg = (text: string, eventSequence: number) => ({messageId: `player-${eventSequence}`, eventSequence, role: 'player' as const, speakerKey: 'player', audienceKeys: audience, text, replyToSequence: null, supersededBySequence: null})
function action(seq = 2): ChatNarrativeActionV1 {
  return {kind: 'complete', text: arrived, goalKey: 'find-seal', evidenceFactKeys: ['courtyard'], audienceKeys: audience, waitingForPlayer: false,
    newFacts: [{factKey: 'arrival-1', kind: 'observation', text: arrived, evidenceExcerpt: arrived, evidenceFactKeys: ['courtyard']}],
    disclosures: [], threadUpdates: [], goalStatus: null,
    sceneTransition: {destinationFactKey: 'courtyard', destinationExcerpt: '后院', arrivalFactKey: 'arrival-1', evidenceExcerpt: arrived, playerEventSequence: seq, playerExcerpt: request}}
}
function review(a = action()) {
  return {...chatCommitmentReviewOutputFixture(a), sceneTransitionCheck: {destinationFactKey: a.sceneTransition!.destinationFactKey,
    arrivalFactKey: a.sceneTransition!.arrivalFactKey, playerEventSequence: a.sceneTransition!.playerEventSequence, passed: true, reason: '工程注入：核对完整请求、既有地点和实际到达，不代替真实语义验收。'}}
}
function initial() {
  const frozen = chatNarrativeFixture()
  frozen.chatNarrative!.initialSituation.facts.push({factKey: 'courtyard', text: '后院就在驿站旁边，仍可通行。', audienceKeys: audience, origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  const s = createInitialInteractionState(frozen)
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  s.remainingDirectorBudget = 100; s.messages.push(msg(request, 2))
  return requestChatNarrativeTriggerV1(s, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
}
function apply(s = initial(), a = action(), sequence = 4, triggerSequence = 3, output: unknown = review(a)) {
  return applyReviewedChatNarrativeActionV1(s, {sequence, triggerSequence, actorKey: 'guard', messageId: `action-${sequence}`, action: a,
    review: {reviewedActionJson: canonicalStringify(a), ...output as object}})
}
it('atomically records a visit to an existing shared place without new-place permission or changing time, actors or secrets', () => {
  const s = initial(), after = apply(s), n = after.chatNarrative!
  expect(n.permissions.allowedNewFactKinds).not.toContain('place')
  expect(after.activeScene).toMatchObject({title: '后院', location: '后院', timeLabel: s.activeScene!.timeLabel, activeParticipantKeys: ['guard']})
  expect(n.situation).toMatchObject({title: '后院', location: '后院', timeLabel: s.chatNarrative!.situation.timeLabel})
  expect(n.situation.facts.slice(0, -1)).toEqual(s.chatNarrative!.situation.facts)
  expect(n.situation.goals).toEqual(s.chatNarrative!.situation.goals)
  expect(n.sceneTransitions).toEqual([{sceneKey: 'inn', actorKey: 'guard', fromLocation: '驿站', destinationFactKey: 'courtyard', destinationExcerpt: '后院', arrivalFactKey: 'arrival-1',
    requested: {messageId: 'player-2', sequence: 2, excerpt: request}, arrived: {messageId: 'action-4', sequence: 4, excerpt: arrived}}])
  expect(parseInteractionState(after)).toEqual(after); expect(s.activeScene!.location).toBe('驿站')
})
it.each(['wrong-source', 'newer-message', 'superseded', 'excluded', 'hidden-request', 'other-scene-request', 'return', 'scene-start', 'multiple-actors', 'waiting', 'attempt', 'speak', 'no-goal', 'paused-goal', 'private-place', 'newly-disclosed-place', 'invented-place', 'wrong-place', 'same-place', 'no-place-evidence', 'no-arrival', 'extra-result', 'place-kind', 'wrong-arrival', 'unexpressed-arrival', 'combined-pause'] as const)('rejects invalid transfer %s without mutation', kind => {
  const s = initial(), a = action(), t = a.sceneTransition!, facts = s.chatNarrative!.situation.facts, destination = facts.at(-1)!
  if (kind === 'wrong-source') t.playerEventSequence = 1
  if (kind === 'newer-message') s.messages.push(msg('先不去了。', 3))
  if (kind === 'superseded') s.messages[0].supersededBySequence = 3
  if (kind === 'excluded') s.chatNarrative!.excludedMessageIds = ['player-2']
  if (kind === 'hidden-request') s.messages[0].audienceKeys = ['player', 'artisan']
  if (kind === 'other-scene-request') s.activeScene!.startedAtSequence = 2
  if (kind === 'return' || kind === 'scene-start') s.chatNarrative!.triggers[0].kind = kind
  if (kind === 'multiple-actors') s.activeScene!.activeParticipantKeys.push('artisan')
  if (kind === 'waiting') a.waitingForPlayer = true
  if (kind === 'attempt' || kind === 'speak') a.kind = kind
  if (kind === 'no-goal') a.goalKey = null
  if (kind === 'paused-goal') s.chatNarrative!.situation.goals[0].status = 'paused'
  if (kind === 'private-place' || kind === 'newly-disclosed-place') {destination.audienceKeys = ['guard']; if (kind === 'newly-disclosed-place') a.disclosures.push({factKey: destination.factKey, toParticipantKeys: ['player'], evidenceExcerpt: destination.text})}
  if (kind === 'invented-place') facts.pop()
  if (kind === 'wrong-place') t.destinationExcerpt = '商店'
  if (kind === 'same-place') t.destinationExcerpt = '驿站'
  if (kind === 'no-place-evidence') a.evidenceFactKeys = ['lost']
  if (kind === 'no-arrival') a.newFacts = []
  if (kind === 'extra-result') a.newFacts.push({...a.newFacts[0], factKey: 'purchase', text: '已买到零件。'})
  if (kind === 'place-kind') a.newFacts[0].kind = 'place'
  if (kind === 'wrong-arrival') t.arrivalFactKey = 'lost'
  if (kind === 'unexpressed-arrival') a.text = '我们准备出发。'
  if (kind === 'combined-pause') a.pauseGoal = {threadKey: 'investigate', playerEventSequence: 2, playerExcerpt: request, evidenceExcerpt: arrived}
  const before = structuredClone(s); expect(() => apply(s, a)).toThrow(); expect(s).toEqual(before)
})
it('continues an unconsumed explicit trip request, but cannot replay it for a second destination', () => {
  const s = initial(); s.chatNarrative!.triggers[0].status = 'complete'
  const next = requestChatNarrativeTriggerV1(s, {sequence: 4, kind: 'continue', sourceEventSequence: 3, seed: null})
  const after = apply(next, action(), 5, 4)
  const again = requestChatNarrativeTriggerV1(after, {sequence: 6, kind: 'continue', sourceEventSequence: 5, seed: null})
  const a = action(); a.sceneTransition!.destinationExcerpt = '驿站'; a.sceneTransition!.arrivalFactKey = 'arrival-2'
  a.text = '我们已经回到驿站。'; a.newFacts[0] = {...a.newFacts[0], factKey: 'arrival-2', text: a.text, evidenceExcerpt: a.text}; a.sceneTransition!.evidenceExcerpt = a.text
  expect(() => apply(again, a, 7, 6)).toThrow('未消费')
})
it.each(['missing', 'foreign', 'rejected'] as const)('requires an independent matching semantic transition check: %s', kind => {
  const s = initial(), a = action(), output: Record<string, unknown> = review(a)
  if (kind === 'missing') delete output.sceneTransitionCheck
  else output.sceneTransitionCheck = {...review(a).sceneTransitionCheck, ...(kind === 'foreign' ? {playerEventSequence: 99} : {passed: false, reason: '只是在讨论，不授权出发。'})}
  const before = structuredClone(s); expect(() => apply(s, a, 4, 3, output)).toThrow(); expect(s).toEqual(before)
})
it('preserves the whole authorization even if the selected quote is shorter, including long conditions', () => {
  const s = initial(), a = action(); s.messages[0].text = request + '完整条件。'.repeat(1700); a.sceneTransition!.playerExcerpt = '一起去后院看看'
  const after = apply(s, a); expect(after.chatNarrative!.sceneTransitions![0].requested.excerpt).toBe(s.messages[0].text)
  expect(parseInteractionState(after)).toEqual(after)
})
it.each(['request-text', 'missing-message', 'wrong-role', 'future-arrival', 'duplicate-consent', 'location-mismatch', 'situation-mismatch'] as const)('rejects damaged restored transfer provenance: %s', kind => {
  const s = apply(), record = s.chatNarrative!.sceneTransitions![0]
  if (kind === 'request-text') record.requested.excerpt = '去后院'
  if (kind === 'missing-message') s.messages.shift()
  if (kind === 'wrong-role') record.actorKey = 'artisan'
  if (kind === 'future-arrival') record.arrived.sequence = 999
  if (kind === 'duplicate-consent') s.chatNarrative!.sceneTransitions!.push(structuredClone(record))
  if (kind === 'location-mismatch') s.activeScene!.location = '驿站'
  if (kind === 'situation-mismatch') s.chatNarrative!.situation.location = '驿站'
  expect(() => parseInteractionState(s)).toThrow()
})
it('does not grant legacy unreviewed events or consequence revisions new travel authority', () => {
  const a = action(), s = initial()
  expect(() => applyChatNarrativeActionV1(s, {action: a, actorKey: 'guard', sequence: 4, triggerSequence: 3, messageId: 'legacy'})).toThrow()
  const altered = {...a, sceneTransition: {...a.sceneTransition!, playerExcerpt: '一起去后院'}}
  expect(() => assertChatActionRevisionExpressionV1({runId: 1, actorKey: 'guard', triggerSequence: 3, candidateHash: 'a', reviewHash: 'b', action: a}, altered)).toThrow('转场')
})

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function prepared(privateConversation = false) {
  const f = await seedChatNarrativeRuntimeFixture({onlyGuard: true, knownDestination: true}), v = await readProductRuntimeStateVersion(f.sessionId)
  const message = await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'visit.player', messageId: 'visit.player-message', baseSequence: v.sequence, baseStateHash: v.stateHash, text: request, audienceKeys: privateConversation ? audience : null})
  const now = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'visit.trigger', baseSequence: now.sequence, baseStateHash: now.stateHash, kind: 'player-response', sourceEventSequence: message.sequence})
  return {...f, action: action(message.sequence)}
}
const input = (f: Awaited<ReturnType<typeof prepared>>) => ({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
  objective: '工程注入：完成玩家授权的已知地点转场', runAI: withChatActionChoiceFixture(async () => JSON.stringify(f.action)), runReviewAI: async () => JSON.stringify(review(f.action))})
it('refuses a private scene transfer even when its listeners equal the public audience', async () => {
  const f = await prepared(true), before = await readProductRuntimeState(f.sessionId)
  expect(before.interaction!.messages.find(m => m.role === 'player')).toMatchObject({playerConversation: 'private', audienceKeys: ['player', 'guard']})
  let calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(f.action)}), runReviewAI: async () => {calls++; return JSON.stringify(review(f.action))}})).rejects.toThrow('私聊不能改变整个场景')
  expect(calls).toBe(1); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})
it('resumes saved candidate once, adopts atomically, and preserves transfer through nested branches, deletion and repeated import', async () => {
  const f = await prepared(); let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async messages => {calls++; expect(messages[0].content).toContain('sceneTransition'); return JSON.stringify(f.action)}), onNarrativeActionSaved: id => {runId = id; throw Error('saved')}})).rejects.toThrow('saved')
  expect((await readProductRuntimeState(f.sessionId)).interaction!.activeScene!.location).toBe('驿站')
  db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {calls++; expect(messages[0].content).toContain('转场专审'); return JSON.stringify(review(f.action))}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(calls).toBe(2)
  const first = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeState(f.sessionId)).lastSequence, title: '转场分支'})
  const child = await branchProductRuntimeSession({parentSessionId: first.id!, throughSequence: (await readProductRuntimeState(first.id!)).lastSequence, title: '转场继承'})
  const expected = (await readProductRuntimeState(child.id!)).interaction!
  expect(expected.activeScene!.location).toBe('后院'); expect(expected.chatNarrative!.sceneTransitions![0].requested.sequence).toBeLessThan(0)
  await deleteProductRuntimeSession(f.sessionId); await deleteProductRuntimeSession(first.id!)
  let projectId = f.scope.projectId
  for (let i = 0; i < 2; i++) {
    projectId = await importProjectJSON(await exportProjectJSON(projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === child.title)!
    expect((await readProductRuntimeState(session.id!)).interaction).toEqual(expected)
  }
})
it.each(['semantic-rejection', 'old-review', 'old-producer'] as const)('retains %s without retry or partial location changes', async kind => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId); let calls = 0, runId = 0
  if (kind !== 'semantic-rejection') {
    const original = skills.getAgentSkillV1
    vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === (kind === 'old-review' ? 'character.chat-narrative-action-review' : 'character.chat-narrative-action') ? {...original(id), promptVersion: kind === 'old-review' ? 'chat-narrative-action-review-v27' : 'chat-narrative-action-v33'} : kind === 'old-review' && id === 'character.chat-narrative-action' ? {...original(id), promptVersion: 'chat-narrative-action-v45'} : original(id))
  }
  const output = review(f.action); output.sceneTransitionCheck.passed = false
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(f.action)}), runReviewAI: async () => {calls++; return JSON.stringify(output)}})).rejects.toThrow()
  expect(calls).toBe(kind === 'semantic-rejection' ? 2 : 1); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
})
it('rejects adopting an approved transfer after a newer refusal without another model request', async () => {
  const f = await prepared(); let calls = 0
  const candidate = await generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(f.action)}), runReviewAI: async () => {calls++; return JSON.stringify(review(f.action))}})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'visit.refuse', messageId: 'visit.refuse-message', baseSequence: v.sequence, baseStateHash: v.stateHash, text: '先不去了，留在这里。', audienceKeys: audience})
  const before = await readProductRuntimeState(f.sessionId)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before); expect(calls).toBe(2)
})
it('reviews alternatives from the same position and only consumes consent for the selected arrival', async () => {
  const f = await prepared(), first = f.action, second = structuredClone(first)
  second.text = '我放慢脚步。' + second.text
  second.newFacts[0].factKey = second.sceneTransition!.arrivalFactKey = 'arrival-2'
  let calls = 0
  const candidate = await generateInteractionRuntimeCandidateV1({...input(f), skillId: 'character.chat-narrative-options',
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify({options: [first, second]})}),
    runReviewAI: async () => {calls++; return JSON.stringify({options: [first, second].map((a, i) => ({optionKey: `option-${i + 1}`, ...review(a)}))})}})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.activeScene!.location).toBe('驿站')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id, optionKey: 'option-2'})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.sceneTransitions).toHaveLength(1)
  expect(state.chatNarrative!.sceneTransitions![0].arrivalFactKey).toBe('arrival-2')
  expect(state.chatNarrative!.situation.facts.some(f => f.factKey === 'arrival-1')).toBe(false)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id, optionKey: 'option-1'})).rejects.toThrow()
  expect(calls).toBe(2)
})
it('reopens the visited scene at its current location and cannot reuse a previous scene request', async () => {
  const f = await prepared(), candidate = await generateInteractionRuntimeCandidateV1(input(f))
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id})
  const arrived = (await readProductRuntimeState(f.sessionId)).interaction!, v = await readProductRuntimeStateVersion(f.sessionId)
  await endInteractionScene({sessionId: f.sessionId, commandId: 'visit.end', sceneId: arrived.activeScene!.sceneId, reason: '暂时离开会话', baseSequence: v.sequence, baseStateHash: v.stateHash})
  const ended = await readProductRuntimeStateVersion(f.sessionId)
  await startInteractionScene({sessionId: f.sessionId, commandId: 'visit.reopen', sceneId: 'inn.reopened', sceneKey: 'inn', baseSequence: ended.sequence, baseStateHash: ended.stateHash})
  const reopened = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(reopened.activeScene).toMatchObject({location: '后院', title: '后院', timeLabel: arrived.activeScene!.timeLabel})
  expect(reopened.chatNarrative!.sceneTransitions).toEqual(arrived.chatNarrative!.sceneTransitions)
  expect(reopened.sceneTemplates[0].location).toBe('驿站')
  const head = (await readProductRuntimeState(f.sessionId)).lastSequence
  const next = requestChatNarrativeTriggerV1(reopened, {sequence: head + 1, kind: 'continue', sourceEventSequence: head, seed: null})
  expect(() => apply(next, f.action, head + 2, head + 1)).toThrow('当前场景')
})
