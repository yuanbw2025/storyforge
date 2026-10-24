import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {createInitialInteractionState, interactionRetrievalView} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, parseChatNarrativeActionV1, parseChatNarrativeActionReviewV1, previewChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {assertChatNarrativeOptionsPreviewableV1, bindChatNarrativeOptionsReviewV1, selectedChatNarrativeOptionV1} from '../../src/lib/character-interaction/narrative-options'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {readChatActionRevisionSourceV1} from '../../src/lib/character-interaction/action-revision'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewFixture, chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1, ChatNarrativeActionReviewV1} from '../../src/lib/types/chat-narrative'

const spoken = '我以前错怪过一个无辜的旅人，一直很后悔，所以这次想查清楚再说。'
const natural = (): ChatNarrativeActionV1 => ({kind: 'speak', text: spoken, goalKey: 'find-seal', evidenceFactKeys: ['regret'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [], disclosures: [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: spoken, wording: 'equivalent'}], threadUpdates: [], goalStatus: null})
const output = (passed = true) => ({...chatActionReviewOutputFixture(), disclosureChecks: [{factKey: 'regret', passed, reason: '工程判定夹具；自然含义正确性须另做真实模型反例。'}]})
const review = (action = natural(), passed = true): ChatNarrativeActionReviewV1 => ({...output(passed), reviewedActionJson: canonicalStringify(action)})
function state() {
  const s = createInitialInteractionState(chatNarrativeFixture())
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  s.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(s, {sequence: 2, sourceEventSequence: 1, kind: 'scene-start', seed: null})
}
const envelope = (action = natural()) => ({sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'natural', action})
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('preserves fact identity and text while updating only reviewed recipients, without mutating the preview source', () => {
  const before = state(), saved = structuredClone(before), fact = before.chatNarrative!.situation.facts.find(f => f.factKey === 'regret')!
  expect(spoken).not.toContain(fact.text)
  expect(() => previewChatNarrativeActionV1(before, envelope())).not.toThrow()
  expect(before).toEqual(saved)
  const after = applyReviewedChatNarrativeActionV1(before, {...envelope(), review: review()})
  expect(after.chatNarrative!.situation.facts.find(f => f.factKey === 'regret')).toEqual({...fact, audienceKeys: ['guard', 'player']})
  expect(after.chatNarrative!.situation.facts).toHaveLength(before.chatNarrative!.situation.facts.length)
  expect(after.messages.at(-1)?.text).toBe(spoken)
  expect(interactionRetrievalView(after, 'artisan').chatNarrative!.facts.some(f => f.factKey === 'regret')).toBe(false)
  expect(before).toEqual(saved)
})

it('keeps exact quotations backward compatible and rejects unreviewed or implicit paraphrase', () => {
  const s = state(), a = natural()
  expect(() => applyChatNarrativeActionV1(s, envelope(a))).toThrow('旧行动事件不可采用')
  delete a.disclosures[0].wording
  expect(() => previewChatNarrativeActionV1(s, envelope(a))).toThrow('逐字证据')
  a.text = s.chatNarrative!.situation.facts.find(f => f.factKey === 'regret')!.text
  a.disclosures[0].evidenceExcerpt = a.text
  expect(() => applyReviewedChatNarrativeActionV1(s, {...envelope(a), review: chatActionReviewFixture(a)})).not.toThrow()
})

it.each(['unknown', 'recipient', 'already-known', 'excerpt', 'mode'] as const)('refuses invalid %s before semantic review', invalid => {
  const s = state(), saved = structuredClone(s), a = natural()
  if (invalid === 'unknown') a.disclosures[0].factKey = 'secret'
  if (invalid === 'recipient') a.disclosures[0].toParticipantKeys = ['artisan']
  if (invalid === 'already-known') a.disclosures[0].toParticipantKeys = ['guard']
  if (invalid === 'excerpt') a.disclosures[0].evidenceExcerpt = '正文里没有这句话。'
  if (invalid === 'mode') Object.assign(a.disclosures[0], {wording: 'summary'})
  expect(() => previewChatNarrativeActionV1(s, envelope(a))).toThrow()
  expect(s).toEqual(saved)
})

it.each(['missing', 'wrong-fact', 'duplicate', 'extra', 'missing-reason', 'wrong-action', 'rejected'] as const)('does not promote partial or invalid %s review to knowledge', invalid => {
  const s = state(), saved = structuredClone(s), r = review()
  if (invalid === 'missing') delete r.disclosureChecks
  if (invalid === 'wrong-fact') r.disclosureChecks![0].factKey = 'secret'
  if (invalid === 'duplicate') r.disclosureChecks!.push(r.disclosureChecks![0])
  if (invalid === 'extra') r.disclosureChecks!.push({factKey: 'lost', passed: true, reason: '不对应转述'})
  if (invalid === 'missing-reason') r.disclosureChecks![0].reason = ''
  if (invalid === 'wrong-action') r.reviewedActionJson = canonicalStringify({...natural(), text: '另一份表达'})
  if (invalid === 'rejected') r.disclosureChecks![0].passed = false
  expect(() => applyReviewedChatNarrativeActionV1(s, {...envelope(), review: r})).toThrow()
  expect(s).toEqual(saved)
})

it('requires the per-fact result on both alternatives without allowing an unknown-fact preview', () => {
  const s = state(), first = natural(), second = {...natural(), text: spoken + '我们慢慢来。'}
  expect(() => assertChatNarrativeOptionsPreviewableV1(s, [first, second])).toThrow('预览')
  const bound = bindChatNarrativeOptionsReviewV1({options: [{optionKey: 'option-1', ...output()}, {optionKey: 'option-2', ...output(false)}]}, [first, second])
  expect(selectedChatNarrativeOptionV1([first, second], bound, 'option-1').action.text).toBe(first.text)
  expect(() => selectedChatNarrativeOptionV1([first, second], bound, 'option-2')).toThrow('未通过')
  expect(() => parseChatNarrativeActionReviewV1({...review(), disclosureChecks: []}, natural())).toThrow('不完整')
  expect(() => parseChatNarrativeActionV1({...first, disclosures: [{...first.disclosures[0], extra: true}]})).toThrow()
})

async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'natural.start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
const input = (f: Awaited<ReturnType<typeof prepared>>) => ({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '自然地说明自己的顾虑', runAI: withChatActionChoiceFixture(async () => JSON.stringify(natural()))})

it('recovers only the saved candidate review, adopts once and preserves canonical knowledge through branch and backup import', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId); let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async messages => {
    calls++; expect(messages[0].content).toContain('wording:"equivalent"'); expect(messages[0].content).toContain('逐事实独立等义审查'); expect(messages[1].content).not.toContain('柜台下')
    return JSON.stringify(natural())
  }), onNarrativeActionSaved: id => {runId = id; throw new Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    calls++; expect(messages[0].content).toContain('含义双向等同'); expect(messages[0].content).toContain('disclosureChecks'); expect(messages[1].content).toContain('柜台下')
    return JSON.stringify(output())
  }})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.messages).toHaveLength(1); expect(calls).toBe(2)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: 'natural disclosure'})
  const branchState = await readProductRuntimeState(branch.id!)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  expect((await readProductRuntimeState(restored.id!)).interaction).toEqual(branchState.interaction)
  expect((await db.agentRunArtifacts.where('projectId').equals(projectId).toArray()).some(a => a.artifactKind === 'raw-response' && a.content === JSON.stringify(output()))).toBe(true)
})

it.each([true, false])('retains a per-fact rejection with consequencesPassing=%s, with no revision or adoption', async consequencesPassing => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId); let runId = 0
  const rejected = output(false)
  rejected.checks.find(c => c.check === 'consequences')!.passed = consequencesPassing
  // The per-fact failure independently forbids the consequence-only revision.
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runReviewAI: async () => JSON.stringify(rejected)})).rejects.toThrow('语义审查未通过')
  expect(await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId, actorKey: 'guard'})).toBeNull()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRunArtifacts.toArray()).some(a => a.content === JSON.stringify(rejected))).toBe(true)
})

it('rejects stale saved wording after a new player message without a review call', async () => {
  const f = await prepared(); let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onNarrativeActionSaved: id => {runId = id; throw new Error('saved')}})).rejects.toThrow('saved')
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'natural.interrupt', baseSequence: v.sequence, baseStateHash: v.stateHash, messageId: 'interrupt', text: '先等等。'})
  await expect(resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(output())}})).rejects.toThrow()
  expect(calls).toBe(0)
})
