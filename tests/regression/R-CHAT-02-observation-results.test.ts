import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {createInitialInteractionState, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, interruptChatNarrativeTriggerV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {applyChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {parseChatNarrativeStateV1} from '../../src/lib/character-interaction/narrative-contract'
import {chatSituationConstructionRequestV1} from '../../src/lib/character-interaction/narrative-progression'
import {advanceChatNarrativeTurnV1, readChatNarrativeTurnResumeV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import * as harness from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewFixture, chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const observationText = '叶岑俯身查看了后门门闩的外侧，没有打开后门。'
const direction = '确认这次外侧检查能否看出门闩有明显松动，不涉及门外情况。'
const action = (): ChatNarrativeActionV1 => ({kind: 'complete', text: observationText, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [{factKey: 'inspected', kind: 'observation', text: observationText, evidenceFactKeys: ['lost'], evidenceExcerpt: observationText}], disclosures: [], threadUpdates: [], goalStatus: null,
  situationRequest: {purpose: 'observation-result', threadKey: 'investigate', direction, evidenceFactKeys: ['lost', 'inspected'], evidenceExcerpt: observationText}})
const outcome = (): ChatSituationDraftV1 => ({kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚',
  newFacts: [{factKey: 'outside-checked', kind: 'observation', text: '这次检查没有在门闩外侧看出明显松动，门外情况仍未知。', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['inspected'], seedExcerpt: '这次外侧检查能否看出门闩有明显松动'}],
  newGoals: [], newThreads: [], possibilities: []})
const review = (draft: ChatSituationDraftV1) => ({reviewedProposalJson: canonicalStringify(draft), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具，不是模型验收'}))})
function prepared() {
  const content = chatNarrativeFixture(); content.chatNarrative!.permissions.allowActorSituationExpansion = true
  const state = createInitialInteractionState(content)
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(state, {sequence: 2, sourceEventSequence: 1, kind: 'scene-start', seed: null})
}
function inspected(candidate = action()) {return applyReviewedChatNarrativeActionV1(prepared(), {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'looked', action: candidate, review: chatActionReviewFixture(candidate)})}
function replied() {
  const state = inspected()
  state.messages.push({messageId: 'player-refuses', eventSequence: 4, role: 'player', speakerKey: 'player', audienceKeys: ['guard', 'player'], text: '我不动手，你自己决定。', replyToSequence: null, supersededBySequence: null})
  interruptChatNarrativeTriggerV1(state, 4, true)
  return requestChatNarrativeTriggerV1(state, {sequence: 5, sourceEventSequence: 4, kind: 'player-response', seed: null})
}

it('preserves an explicitly reviewed completed observation through player input, but never executes on input or refresh', () => {
  const state = inspected(), pending = structuredClone(state.chatNarrative!.pendingSituation)
  interruptChatNarrativeTriggerV1(state, 4, true)
  expect(state.chatNarrative!.pendingSituation).toEqual(pending)
  expect(chatSituationConstructionRequestV1(state)).toBeNull()
  expect(interactionVisibilityView(state, 'player').chatNarrative).not.toHaveProperty('pendingSituation')
  expect(interactionVisibilityView(state, 'artisan').chatNarrative).not.toHaveProperty('pendingSituation')
  const next = replied(), before = structuredClone(next)
  expect(chatSituationConstructionRequestV1(next, 'guard')).toMatchObject({text: direction, actorKey: 'guard'})
  expect(chatSituationConstructionRequestV1(next, 'artisan')).toBeNull()
  const draft = outcome(), result = applyChatSituationV1(next, {sequence: 6, triggerSequence: 5, draft, review: review(draft)})
  expect(result.chatNarrative!.pendingSituation).toBeUndefined()
  expect(result.chatNarrative!.situation.goals).toEqual(before.chatNarrative!.situation.goals)
  expect(result.chatNarrative!.situation.possibilities).toEqual(before.chatNarrative!.situation.possibilities)
  expect(result.chatNarrative!.situation.facts.at(-1)?.factKey).toBe('outside-checked')
  expect(result.messages).toEqual(before.messages)
  expect(next).toEqual(before)
})

it('keeps historical intent interruption unchanged, and explicit scene end or a new seed can discard pending results', () => {
  const legacy = action(); delete legacy.situationRequest!.purpose
  const state = inspected(legacy); interruptChatNarrativeTriggerV1(state, 4, true)
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
  const ended = inspected(); interruptChatNarrativeTriggerV1(ended, 4)
  expect(ended.chatNarrative!.pendingSituation).toBeUndefined()
  const seeded = requestChatNarrativeTriggerV1(inspected(), {sequence: 4, sourceEventSequence: 3, kind: 'player-seed', seed: '暂时只聊天。'})
  expect(seeded.chatNarrative!.pendingSituation).toBeUndefined()
  expect(seeded.chatNarrative!.situation.facts.at(-1)?.factKey).toBe('inspected')
})

it.each(['intent', 'no fact', 'not observation', 'uncited', 'incomplete quote', 'waiting'] as const)('rejects falsely marked completed observations (%s)', invalid => {
  const candidate = action()
  if (invalid === 'intent') candidate.kind = 'speak'
  if (invalid === 'no fact') candidate.newFacts = []
  if (invalid === 'not observation') candidate.newFacts[0].kind = 'object'
  if (invalid === 'uncited') candidate.situationRequest!.evidenceFactKeys = ['lost']
  if (invalid === 'incomplete quote') candidate.situationRequest!.evidenceExcerpt = '查看了后门门闩'
  if (invalid === 'waiting') candidate.waitingForPlayer = true
  expect(() => inspected(candidate)).toThrow()
})

it.each(['new goal', 'new thread', 'new plan', 'new object', 'no observation evidence', 'new title'] as const)('does not let a pending result authorize %s', invalid => {
  const state = replied(), before = structuredClone(state), draft = outcome()
  if (invalid === 'new goal') draft.newGoals = [{goalKey: 'open-door', actorKey: 'guard', desire: '开门', concern: '未知', boundary: '自己决定', evidenceFactKeys: ['inspected']}]
  if (invalid === 'new thread') draft.newThreads = [{threadKey: 'new-thread', title: '门外', question: '门外有谁', audienceKeys: ['guard', 'player'], participantKeys: ['guard'], evidenceFactKeys: ['inspected'], closureSignals: ['看清']}]
  if (invalid === 'new plan') draft.possibilities = [{actorKey: 'guard', text: '出去看看', evidenceFactKeys: ['inspected']}]
  if (invalid === 'new object') draft.newFacts[0].kind = 'object'
  if (invalid === 'no observation evidence') draft.newFacts[0].evidenceFactKeys = ['lost']
  if (invalid === 'new title') draft.title = '另一个故事'
  expect(() => applyChatSituationV1(state, {sequence: 6, triggerSequence: 5, draft, review: review(draft)})).toThrow()
  expect(state).toEqual(before)
})

it('rejects a forged persisted result marker lacking its own completed-event evidence', () => {
  const state = inspected(); state.chatNarrative!.pendingSituation!.evidenceFactKeys = ['lost']
  expect(() => parseChatNarrativeStateV1(state.chatNarrative, {participantKeys: ['guard', 'artisan'], characterKeys: ['character:guard', 'character:artisan'], sceneKeys: ['inn']})).toThrow('同一已完成行动')
})

const generate = harness.generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function command(sessionId: number) {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
async function runtime(directorBudget = 100) {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true, directorBudget})
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(i => generate({...i,
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action())), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}))
  await advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: f.sceneSequence, kind: 'scene-start', participantKey: 'guard', aiConfig: {} as never})
  const sent = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'refusal', text: '我不动手，你自己决定。', audienceKeys: ['player', 'guard']})
  return {...f, spy, sent}
}

it('resolves a completed observation before the role replies after portable branch recovery, without leaking or repeating the action', async () => {
  const f = await runtime(), branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: f.sent.sequence, title: 'pending observation'})
  const branchState = (await readProductRuntimeState(branch.id!)).interaction!
  expect(branchState.chatNarrative!.pendingSituation!.sourceEventSequence).toBeLessThan(0)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  const scope = {projectId, workId: imported.workId, worldId: imported.worldId}, seen: string[] = []
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branchState)
  expect(f.spy).toHaveBeenCalledTimes(1)
  f.spy.mockImplementation(i => generate({...i, runAI: withChatActionChoiceFixture(async messages => {
    seen.push(i.skillId)
    if (i.skillId === 'character.chat-situation-construction') return JSON.stringify(outcome())
    expect(JSON.stringify(messages)).toContain('没有在门闩外侧看出明显松动')
    expect(JSON.stringify(messages)).not.toContain('柜台下')
    return JSON.stringify({...action(), kind: 'pause', text: '外侧没有明显松动，我会保留门外未知的判断。', newFacts: [], situationRequest: null})
  }), runReviewAI: async () => JSON.stringify(i.skillId === 'character.chat-situation-construction' ? {checks: review(outcome()).checks} : chatActionReviewOutputFixture())}))
  const source = branchState.messages.at(-1)!.eventSequence
  await advanceChatNarrativeTurnV1({scope, sessionId: imported.id!, expectedSequence: 0, kind: 'player-response', replyToSequence: source, participantKey: 'guard', aiConfig: {} as never})
  expect(seen).toEqual(['character.chat-situation-construction', 'character.chat-narrative-action'])
  const after = (await readProductRuntimeState(imported.id!)).interaction!
  expect(after.chatNarrative!.pendingSituation).toBeUndefined()
  expect(after.chatNarrative!.situation.facts.filter(f => f.factKey === 'inspected')).toHaveLength(1)
  expect(after.chatNarrative!.situation.facts.filter(f => f.factKey === 'outside-checked')).toHaveLength(1)
  expect(after.chatNarrative!.situation.possibilities).toEqual(branchState.chatNarrative!.situation.possibilities)
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(after)
  expect(f.spy).toHaveBeenCalledTimes(3)
})

it('preserves the unresolved observation after a failed adjudication and blocks an unknown-call resend', async () => {
  const f = await runtime(), before = (await readProductRuntimeState(f.sessionId)).interaction!
  f.spy.mockImplementation(i => generate({...i, runAI: withChatActionChoiceFixture(async () => {throw new Error('observation response unknown')})}))
  await expect(advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: f.sent.sequence, kind: 'player-response', replyToSequence: f.sent.sequence, participantKey: 'guard', aiConfig: {} as never})).rejects.toThrow('observation response unknown')
  const failed = await readProductRuntimeState(f.sessionId)
  expect(failed.interaction!.chatNarrative!.pendingSituation).toEqual(before.chatNarrative!.pendingSituation)
  expect(await readChatNarrativeTurnResumeV1(f.scope, f.sessionId, failed.interaction!)).toMatchObject({blockedReason: expect.stringContaining('结果未知')})
  await expect(resumeChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: failed.lastSequence, participantKey: 'guard', aiConfig: {} as never})).rejects.toThrow('结果未知')
  expect(f.spy).toHaveBeenCalledTimes(2)
})

it('retains an empty-result candidate rejected by semantic review without erasing the pending observation or generating a reply', async () => {
  const f = await runtime(), before = (await readProductRuntimeState(f.sessionId)).interaction!
  const draft = outcome()
  draft.newFacts[0].text = '检查已经完成，但检查没有提供结果，仍需等待检查结果。'
  const rejected = {checks: review(draft).checks.map(check => check.check === 'meaningful-direction'
    ? {...check, passed: false, reason: '工程审查夹具：没有具体观察限制，只重复缺少结果。'} : check)}
  f.spy.mockImplementation(i => generate({...i, runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)), runReviewAI: async () => JSON.stringify(rejected)}))
  await expect(advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: f.sent.sequence,
    kind: 'player-response', replyToSequence: f.sent.sequence, participantKey: 'guard', aiConfig: {} as never})).rejects.toThrow('情境语义审查未通过')
  db.close(); await db.open()
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.chatNarrative!.pendingSituation).toEqual(before.chatNarrative!.pendingSituation)
  expect(after.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(after.messages).toEqual(before.messages)
  expect((await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'raw-response').map(a => a.content)).toContain(JSON.stringify(rejected))
  expect(f.spy.mock.calls.slice(1).map(([input]) => input.skillId)).toEqual(['character.chat-situation-construction'])
})

it('does not start adjudication without its construction, review and reply allowance', async () => {
  const f = await runtime(5), before = await readProductRuntimeState(f.sessionId)
  await expect(advanceChatNarrativeTurnV1({scope: f.scope, sessionId: f.sessionId, expectedSequence: f.sent.sequence, kind: 'player-response', replyToSequence: f.sent.sequence, participantKey: 'guard', aiConfig: {} as never})).rejects.toThrow('预算不足')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(f.spy).toHaveBeenCalledTimes(1)
})
