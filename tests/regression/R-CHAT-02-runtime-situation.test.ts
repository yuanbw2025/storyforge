import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {assembleContext} from '../../src/lib/registry/assemble-context'
import {captureRuntimeHarnessBoundaryV1, assertRuntimeHarnessFreshV1} from '../../src/lib/agent/run/runtime-scope'
import {applyChatSituationV1, isChatSituationPreparedV1, parseChatSituationDraftV1} from '../../src/lib/character-interaction/narrative-situations'
import {createInitialInteractionState, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {applyChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {branchProductRuntimeSession, commitChatSituation, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatNarrativeFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import type {ChatSituationDraftV1, ChatSituationReviewV1} from '../../src/lib/types/chat-narrative'
import {CHAT_SITUATION_REVIEW_CHECKS_V1} from '../../src/lib/types/chat-narrative'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

const seed = '门外传来敲门声。先不预设来人的身份。'
function draft(): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '门外的敲门声', location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['player', 'guard', 'artisan'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}],
    newGoals: [{goalKey: 'understand-knock', actorKey: 'guard', desire: '弄清门外的来意', concern: '不要轻率开门', boundary: '不要求玩家参与', evidenceFactKeys: ['knocking']}],
    newThreads: [{threadKey: 'door-visitor', title: '门外的来意', question: '是否应门、如何了解来意？', audienceKeys: ['player', 'guard', 'artisan'], participantKeys: ['guard', 'artisan'], evidenceFactKeys: ['knocking'], closureSignals: ['确认来意', '决定暂不应门']}],
    possibilities: [{actorKey: 'guard', text: '可以隔门询问，也可以先听一听。', evidenceFactKeys: ['knocking']}]}
}
function review(value = draft()): ChatSituationReviewV1 {
  return {reviewedProposalJson: canonicalStringify(value), checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程审查夹具，不是模型语义验收'}))}
}
function prepared() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(state, {sequence: 2, kind: 'player-seed', sourceEventSequence: 1, seed})
}
function apply(value = draft(), state = prepared(), checked = review(value)) {
  return applyChatSituationV1(state, {sequence: 3, triggerSequence: 2, draft: value, review: checked})
}

it('extends the background while retaining secrets, old goals and open threads, then permits role action', () => {
  const before = prepared(), state = apply(draft(), before)
  expect(isChatSituationPreparedV1(before)).toBe(false)
  expect(isChatSituationPreparedV1(state)).toBe(true)
  expect(state.messages).toEqual([])
  expect(state.chatNarrative!.situation.facts.slice(0, 4)).toEqual(before.chatNarrative!.situation.facts)
  expect(state.chatNarrative!.situation.goals.slice(0, 2)).toEqual(before.chatNarrative!.situation.goals)
  expect(state.chatNarrative!.situation.threads[0]).toEqual(before.chatNarrative!.situation.threads[0])
  expect(state.chatNarrative!.situation.facts[4]).toMatchObject({origin: 'runtime-situation', sourceEventSequence: 3})
  expect(state.chatNarrative!.situation.seed).toMatchObject({origin: 'player-request', sourceEventSequence: 2})
  expect(state.remainingDirectorBudget).toBe(98)
  const visible = JSON.stringify(interactionVisibilityView(state, 'guard'))
  expect(visible).toContain('门外传来敲门声')
  expect(visible).not.toContain('先不预设来人的身份')
  expect(visible).not.toContain('柜台下')
  expect(visible).not.toContain('天黑后不宜')
  const acted = applyChatNarrativeActionV1(state, {sequence: 4, triggerSequence: 2, actorKey: 'guard', messageId: 'ask', action: {
    kind: 'attempt', text: '我想先隔门问问。你愿意一起听吗？', goalKey: 'understand-knock', evidenceFactKeys: ['knocking'], audienceKeys: ['guard', 'player'], waitingForPlayer: true,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
  }})
  expect(acted.messages.map(message => message.role)).toEqual(['character'])
  expect(acted.chatNarrative!.triggers[0].status).toBe('waiting-player')
  expect(() => apply(draft(), state)).toThrow('已经构建')
})

it.each([
  ['world fact overwrite', (d: ChatSituationDraftV1) => {d.newFacts[0].factKey = 'lost'}],
  ['forged request evidence', d => {d.newFacts[0].seedExcerpt = '玩家已经开门'}],
  ['secret propagation', d => {d.newFacts[0].evidenceFactKeys = ['secret']}],
  ['unpermitted new person', d => {d.newFacts[0].kind = 'temporary-character'}],
  ['player goal', d => {d.newGoals[0].actorKey = 'player'}],
  ['invisible goal basis', d => {d.newGoals[0].evidenceFactKeys = ['secret']}],
  ['old goal replacement', d => {d.newGoals[0].goalKey = 'find-seal'}],
  ['old thread replacement', d => {d.newThreads[0].threadKey = 'investigate'}],
  ['unrequested time jump', d => {d.timeLabel = '次日清晨'}],
  ['unrequested relocation', d => {d.location = '城门'}],
  ['player future plan', d => {d.possibilities[0].actorKey = 'player'}],
] as const)('rejects %s without partial state changes', (_label, mutate) => {
  const state = prepared(), saved = structuredClone(state), value = draft()
  mutate(value)
  expect(() => apply(value, state)).toThrow()
  expect(state).toEqual(saved)
})

it('requires complete review of the exact candidate and preserves earlier open issues at the thread limit', () => {
  const value = draft(), failed = review(value)
  failed.checks[0].passed = false
  expect(() => apply(value, prepared(), failed)).toThrow('语义审查未通过')
  const stale = review(value); value.title = 'changed'
  expect(() => apply(value, prepared(), stale)).toThrow('另一份候选')
  const incomplete = review(value); incomplete.checks.pop()
  expect(() => apply(value, prepared(), incomplete)).toThrow('不完整')
  const state = prepared(); state.chatNarrative!.permissions.maxActiveThreads = 1
  expect(() => apply(draft(), state)).toThrow('活跃剧情线')
  expect(() => parseChatSituationDraftV1({...draft(), rewriteFacts: []})).toThrow('闭集')
})

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
it('uses a separately registered coordinator view and commits/replays/branches/exports the reviewed situation without world changes', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), version = await readProductRuntimeStateVersion(f.sessionId)
  const requested = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'seed', baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'player-seed', sourceEventSequence: version.sequence, seed})
  const boundary = await captureRuntimeHarnessBoundaryV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', view: 'chat-situation'})
  const assembled = await assembleContext({scope: f.scope, projectId: f.scope.projectId, productRuntimeSessionId: f.sessionId, sourceKeys: ['chatSituationRuntime']})
  expect(assembled.included).toEqual(['chatSituationRuntime'])
  expect(assembled.text).toContain('柜台下')
  expect(assembled.text).toContain('天黑后不宜')
  const role = await assembleContext({scope: f.scope, projectId: f.scope.projectId, productRuntimeSessionId: f.sessionId, sourceKeys: ['interactionRuntime'], interactionParticipantKey: 'guard'})
  expect(role.text).not.toContain('先不预设来人的身份')
  await expect(captureRuntimeHarnessBoundaryV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', view: 'chat-situation'})).rejects.toThrow('明确玩家请求')
  const worlds = await db.worldReleases.toArray(), v = await readProductRuntimeStateVersion(f.sessionId)
  const command = {sessionId: f.sessionId, commandId: 'construct', baseSequence: v.sequence, baseStateHash: v.stateHash, triggerSequence: requested.sequence, draft: draft(), review: review()}
  const event = await commitChatSituation(command)
  expect((await commitChatSituation(command)).sequence).toBe(event.sequence)
  await expect(assertRuntimeHarnessFreshV1({scope: f.scope, contractScope: boundary.scope, participantKey: 'player', view: 'chat-situation'})).rejects.toThrow('已经变化')
  const before = await readProductRuntimeState(f.sessionId)
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: before.lastSequence, title: 'new local direction'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  expect(isChatSituationPreparedV1(branched)).toBe(true)
  expect(branched.chatNarrative!.situation.facts[4].sourceEventSequence).toBeLessThan(0)
  const exported = await exportProjectJSON(f.scope.projectId)
  await expect(importProjectJSON(exported)).resolves.toBeGreaterThan(0)
  expect(await db.worldReleases.get(worlds[0].id!)).toEqual(worlds[0])
})

it('player interruption stales the uncommitted situation and leaves no background fragments', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'seed', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'player-seed', sourceEventSequence: v.sequence, seed})
  const base = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'changed-mind', baseSequence: base.sequence, baseStateHash: base.stateHash, messageId: 'hold', text: '先不用了。', audienceKeys: null})
  await expect(commitChatSituation({sessionId: f.sessionId, commandId: 'late', baseSequence: base.sequence, baseStateHash: base.stateHash, triggerSequence: trigger.sequence, draft: draft(), review: review()})).rejects.toThrow('状态已变化')
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.facts).toHaveLength(4)
})
