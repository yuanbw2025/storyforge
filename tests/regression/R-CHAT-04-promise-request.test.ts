import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {createInitialInteractionState, buildInteractionContextWindow, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatVisibleCommitmentsV1} from '../../src/lib/character-interaction/narrative-commitments'
import {assertChatPromiseRequestReviewVersionV1, supportsChatPromiseRequestPromptV1} from '../../src/lib/character-interaction/narrative-promise-request'
import {assertChatActionRevisionExpressionV1} from '../../src/lib/character-interaction/action-revision'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, deleteProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {chatPromiseActionFixture, chatCommitmentReviewOutputFixture} from '../helpers/chat-commitment-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const requestText = '找到新线索后，请先问过我，再决定是否告诉其他人。'
const terms = '找到新线索后，我会在告诉其他人之前先问你是否同意。'
const action = (sequence = 2): ChatNarrativeActionV1 => ({...chatPromiseActionFixture(terms), evidenceFactKeys: [], promiseRequest: {playerEventSequence: sequence, playerExcerpt: requestText}})
function initial() {
  const s = createInitialInteractionState(chatNarrativeFixture())
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  s.remainingDirectorBudget = 100
  s.messages.push({messageId: 'request', eventSequence: 2, role: 'player', speakerKey: 'player', audienceKeys: ['player', 'guard'], text: requestText, replyToSequence: null, supersededBySequence: null})
  return requestChatNarrativeTriggerV1(s, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
}
function apply(s = initial(), a = action(), passed = true) {
  return applyReviewedChatNarrativeActionV1(s, {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'promise', action: a,
    review: {...chatCommitmentReviewOutputFixture(a, passed), reviewedActionJson: canonicalStringify(a)}})
}
const promise = (s: ReturnType<typeof initial>) => s.chatNarrative!.situation.goals[0].commitments![0]

it.each([false, true])('binds the actual player request and declaration without inventing a world fact (waiting=%s)', waitingForPlayer => {
  const before = initial(), a = {...action(), waitingForPlayer}, out = apply(before, a)
  expect(promise(out)).toMatchObject({terms, requested: {messageId: 'request', sequence: 2, excerpt: requestText}, declared: {messageId: 'promise', sequence: 4, excerpt: terms}, resolution: null})
  expect(out.chatNarrative!.situation.facts).toEqual(before.chatNarrative!.situation.facts)
  expect(out.relationships).toEqual(before.relationships); expect(out.chatNarrative!.situation.possibilities).toEqual(before.chatNarrative!.situation.possibilities)
  expect(before.messages).toHaveLength(1); expect(chatVisibleCommitmentsV1(out, 'artisan')).toEqual([])
  expect(JSON.stringify(chatVisibleCommitmentsV1(out, 'player'))).not.toContain('担心再次错怪人')
  expect(parseInteractionState(out)).toEqual(out)
  out.chatNarrative!.excludedMessageIds = ['request']
  expect(parseInteractionState(out)).toEqual(out) // Later exclusion cannot erase the accepted duty.
  expect(buildInteractionContextWindow(out, 'guard', {maxCharacters: 20000, retrievalVersion: 'chat-relevance-v4'}).chatNarrative!.goals[0].commitments![0].requested!.excerpt).toBe(requestText)
})

it.each(['missing', 'null', 'old-source', 'future-source', 'wrong-quote', 'excluded', 'superseded', 'later-message', 'audience', 'continue', 'second-action', 'foreign-goal', 'closed-goal', 'complete', 'attempt', 'pause', 'with-facts', 'no-promise', 'fulfill', 'plan', 'fact', 'disclosure', 'goal-status', 'goal-update', 'thread', 'relation', 'belief', 'resume', 'new-goal'] as const)('rejects unsupported request binding %s atomically', kind => {
  const s = initial(), a = action(), story = s.chatNarrative!
  if (kind === 'missing') delete a.promiseRequest
  if (kind === 'null') a.promiseRequest = null
  if (kind === 'old-source') a.promiseRequest!.playerEventSequence = 1
  if (kind === 'future-source') a.promiseRequest!.playerEventSequence = 5
  if (kind === 'wrong-quote') a.promiseRequest!.playerExcerpt = '从未说过的话'
  if (kind === 'excluded') story.excludedMessageIds = ['request']
  if (kind === 'superseded') s.messages[0].supersededBySequence = 3
  if (kind === 'later-message') s.messages.push({...s.messages[0], messageId: 'later', role: 'character', speakerKey: 'guard', eventSequence: 3})
  if (kind === 'audience') a.audienceKeys.push('artisan')
  if (kind === 'continue') story.triggers[0].kind = 'continue'
  if (kind === 'second-action') {story.permissions.maxActionsPerTrigger = 3; story.triggers[0].actionSequences = [1]}
  if (kind === 'foreign-goal') a.goalKey = 'fix-road'
  if (kind === 'closed-goal') story.situation.goals[0].status = 'fulfilled'
  if (kind === 'complete' || kind === 'attempt' || kind === 'pause') a.kind = kind
  if (kind === 'with-facts') a.evidenceFactKeys = ['lost']
  if (kind === 'no-promise') a.commitmentEffects = []
  if (kind === 'fulfill') a.commitmentEffects = [{kind: 'fulfill', commitmentKey: 'old', evidenceExcerpt: a.text}]
  if (kind === 'plan') a.nextPossibilities = []
  if (kind === 'fact') a.newFacts = [{factKey: 'new', kind: 'observation', text: a.text, evidenceFactKeys: ['lost'], evidenceExcerpt: a.text}]
  if (kind === 'disclosure') a.disclosures = [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: a.text}]
  if (kind === 'goal-status') a.goalStatus = 'paused'
  if (kind === 'goal-update') a.goalUpdates = [{goalKey: 'find-seal', status: 'paused', evidenceFactKeys: ['lost'], evidenceExcerpt: a.text}]
  if (kind === 'thread') a.threadUpdates = [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: a.text}]
  if (kind === 'relation') a.relationshipUpdates = [{dimensionKey: 'trust', delta: 1, sourceEventSequence: 2, playerExcerpt: requestText, evidenceExcerpt: a.text}]
  if (kind === 'belief') a.beliefUpdates = [{beliefKey: 'borrowed', text: null, evidenceFactKeys: ['lost']}]
  if (kind === 'resume') a.resumeGoal = {...a.promiseRequest!}
  if (kind === 'new-goal') a.threadFollowupGoal = {threadKey: 'investigate', evidenceExcerpt: a.text, goal: {goalKey: 'new', desire: 'new', concern: 'new', boundary: 'new', evidenceFactKeys: ['lost']}}
  const before = structuredClone(s); expect(() => apply(s, a)).toThrow(); expect(s).toEqual(before)
})
it('rejects missing semantic approval and preserves legacy guards and revision source identity', () => {
  expect(() => apply(initial(), action(), false)).toThrow('语义审查')
  expect(() => applyChatNarrativeActionV1(initial(), {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'old', action: action()})).toThrow()
  expect(() => assertChatPromiseRequestReviewVersionV1([action()], 'chat-narrative-action-review-v24')).toThrow('旧审查')
  expect(() => assertChatPromiseRequestReviewVersionV1([action()], 'chat-narrative-action-review-v25')).not.toThrow()
  expect(() => assertChatPromiseRequestReviewVersionV1([chatPromiseActionFixture()], 'chat-narrative-action-review-v24')).not.toThrow()
  for (const version of ['chat-narrative-action-v32', 'chat-narrative-options-v22', 'chat-action-revision-v14']) expect(supportsChatPromiseRequestPromptV1(version)).toBe(true)
  expect(supportsChatPromiseRequestPromptV1('chat-narrative-action-v31')).toBe(false)
  const source = {runId: 1, actorKey: 'guard', triggerSequence: 3, candidateHash: 'hash', reviewHash: 'hash', action: action()}
  expect(() => assertChatActionRevisionExpressionV1(source, {...action(), promiseRequest: null})).toThrow('玩家请求依据')
  expect(() => assertChatActionRevisionExpressionV1({...source, action: chatPromiseActionFixture(terms)}, action())).toThrow('玩家请求依据')
})
it.each(['missing-message', 'role', 'speaker', 'audience', 'quote', 'identity', 'future', 'superseded'] as const)('rejects forged persisted request provenance %s', kind => {
  const s = apply(), p = promise(s)
  if (kind === 'missing-message') s.messages.shift()
  if (kind === 'role') s.messages[0].role = 'character'
  if (kind === 'speaker') s.messages[0].speakerKey = 'artisan'
  if (kind === 'audience') s.messages[0].audienceKeys = ['player', 'artisan']
  if (kind === 'quote') p.requested!.excerpt = '另一句话'
  if (kind === 'identity') p.requested!.messageId = 'foreign'
  if (kind === 'future') p.requested!.sequence = 5
  if (kind === 'superseded') s.messages[0].supersededBySequence = 3
  expect(() => parseInteractionState(s)).toThrow()
})

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const envelope = async (sessionId: number) => {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture(), message = await commitInteractionPlayerMessage({...await envelope(f.sessionId), messageId: 'request', text: requestText, audienceKeys: ['guard', 'player']})
  await requestChatNarrativeTrigger({...await envelope(f.sessionId), kind: 'player-response', sourceEventSequence: message.sequence})
  return {...f, action: action(message.sequence)}
}
const input = (f: Awaited<ReturnType<typeof prepared>>) => ({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '工程测试：玩家请求约定，不构成模型质量证据', runAI: withChatActionChoiceFixture(async () => JSON.stringify(f.action)), runReviewAI: async () => JSON.stringify(chatCommitmentReviewOutputFixture(f.action))})
it('recovers once and retains both sources through nested branching, parent deletion and repeated backup import', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray(); let id = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async messages => {calls++; expect(messages[0].content).toContain('promiseRequest 默认为 null'); expect(messages[1].content).toContain(requestText); return JSON.stringify(f.action)}), onNarrativeActionSaved: runId => {id = runId; throw Error('saved')}})).rejects.toThrow('saved')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before); db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId: id, runReviewAI: async messages => {calls++; expect(messages[0].content).toContain('玩家请求约定专审'); return JSON.stringify(chatCommitmentReviewOutputFixture(f.action))}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: id}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: id}); expect(calls).toBe(2)
  let parent = f.sessionId
  for (const title of ['branch', 'nested']) {
    const state = await readProductRuntimeState(parent), child = await branchProductRuntimeSession({parentSessionId: parent, throughSequence: state.lastSequence, title})
    await deleteProductRuntimeSession(parent); parent = child.id!
  }
  let expected = (await readProductRuntimeState(parent)).interaction!
  expect(promise(expected).requested!.sequence).toBeLessThan(0); expect(promise(expected).declared.sequence).toBeLessThan(0)
  expect(expected.messages.find(m => m.messageId === promise(expected).requested!.messageId)!.eventSequence).toBe(promise(expected).requested!.sequence)
  let projectId = f.scope.projectId
  for (let i = 0; i < 2; i++) {
    projectId = await importProjectJSON(await exportProjectJSON(projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === 'nested')!
    const state = (await readProductRuntimeState(session.id!)).interaction!
    expect(state).toEqual(expected); expected = state
  }
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
})
it('does not call an old reviewer or adopt a semantically rejected or stale request', async () => {
  const f = await prepared(), original = skills.getAgentSkillV1; let reviewCalls = 0
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action-review' ? {...original(id), promptVersion: 'chat-narrative-action-review-v24'} : id === 'character.chat-narrative-action' ? {...original(id), promptVersion: 'chat-narrative-action-v45'} : original(id))
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runReviewAI: async () => {reviewCalls++; return JSON.stringify(chatCommitmentReviewOutputFixture(f.action))}})).rejects.toThrow('旧审查')
  expect(reviewCalls).toBe(0); vi.restoreAllMocks()
  const rejected = await prepared(), before = await readProductRuntimeState(rejected.sessionId)
  await expect(generateInteractionRuntimeCandidateV1({...input(rejected), runReviewAI: async () => JSON.stringify(chatCommitmentReviewOutputFixture(rejected.action, false))})).rejects.toThrow('语义审查')
  expect(await readProductRuntimeState(rejected.sessionId)).toEqual(before)
  const stale = await prepared(), generated = await generateInteractionRuntimeCandidateV1(input(stale))
  await commitInteractionPlayerMessage({...await envelope(stale.sessionId), messageId: 'changed', text: '我改变主意了，先不要作约定。'})
  const latest = await readProductRuntimeState(stale.sessionId)
  await expect(adoptInteractionRuntimeCandidateV1({scope: stale.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(stale.sessionId)).toEqual(latest)
})
