import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as api from '../../src/lib/character-interaction/runtime-api'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {chatCommitmentReviewOutputFixture, chatPromiseActionFixture} from '../helpers/chat-commitment-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function setup() {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 10000, playerFollowup: true})
  const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
  let calls = 0
  const perform = async (action: ChatNarrativeActionV1, player?: string) => {
    const version = await api.readProductRuntimeStateVersion(f.sessionId)
    const source = player ? (await api.commitInteractionPlayerMessage({...await command(), messageId: crypto.randomUUID(), text: player})).sequence : version.sequence
    await api.requestChatNarrativeTrigger({...await command(), kind: player ? 'player-response' : source === f.sceneSequence ? 'scene-start' : 'continue', sourceEventSequence: source})
    if (action.followupGoal) action.followupGoal.playerEventSequence = source
    const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '持续后果容量工程注入；不计入剧情质量验收',
      runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(action)}), runReviewAI: async () => {calls++; return JSON.stringify(action.commitmentEffects ? chatCommitmentReviewOutputFixture(action) : chatActionReviewOutputFixture())}})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    return generated.snapshot.run.id
  }
  return {...f, command, perform, calls: () => calls}
}
const observation = (i: number): ChatNarrativeActionV1 => {
  const texts = [0, 1].map(j => i === 0 && j === 0 ? '靛蓝地图登记旁有杉木叶标记。' : `第${i * 2 + j}次核对登记留下了当次独立记录。`)
  return {kind: 'complete', text: texts.join('\n'), goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: texts.map((text, j) => ({factKey: `capacity-${i * 2 + j}`, kind: 'observation', text, evidenceFactKeys: ['lost'], evidenceExcerpt: text})), disclosures: [], threadUpdates: [], goalStatus: null}
}
it('adopts 100 consequential actions, recalls the first clue and preserves all 204 facts in a parentless portable branch', async () => {
  const f = await setup(), worlds = await db.worldReleases.toArray()
  const started = performance.now()
  for (let i = 0; i < 100; i++) {await f.perform(observation(i)); if ((i + 1) % 25 === 0) console.info('capacity adopted', i + 1, Math.round(performance.now() - started))}
  const before = (await api.readProductRuntimeState(f.sessionId)).interaction!
  expect(before.chatNarrative!.situation.facts).toHaveLength(204)
  expect(before.chatNarrative!.factEvidence!.records).toHaveLength(200)
  const stored = (await db.productRuntimeSessions.get(f.sessionId))!
  expect(stored.runtimeHeadSequence).toBe(before.chatNarrative!.lastEventSequence)
  expect((await api.readProductRuntimeState(f.sessionId, stored.runtimeHeadSequence!)).interaction).toEqual(before)
  const reply = {...observation(100), kind: 'speak' as const, text: '旧登记上的靛蓝地图旁有杉木叶标记。', evidenceFactKeys: ['capacity-0'], newFacts: []}
  await f.perform(reply, '以前靛蓝地图的杉木叶标记是什么？')
  const state = (await api.readProductRuntimeState(f.sessionId)).interaction!
  expect(buildInteractionContextWindow(state, 'guard').chatNarrative!.facts.some(f => f.factKey === 'capacity-0')).toBe(true)
  const branch = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: state.chatNarrative!.lastEventSequence, title: 'capacity-portable'})
  await api.deleteProductRuntimeSession(f.sessionId)
  const expected = (await api.readProductRuntimeState(branch.id!)).interaction!
  console.info('capacity parentless branch retained', Math.round(performance.now() - started))
  const backup = await exportProjectJSON(f.scope.projectId)
  console.info('capacity export completed', Math.round(performance.now() - started))
  const imported = await importProjectJSON(backup); db.close(); await db.open()
  const session = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(s => s.title === 'capacity-portable')!
  expect((await api.readProductRuntimeState(session.id!)).interaction).toEqual(expected)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  expect(f.calls()).toBe(202)
}, 600_000)
it('retains 18 actually fulfilled promises and reads the first disposition after the former limit', async () => {
  const f = await setup()
  for (let i = 0; i < 18; i++) {
    const text = i === 0 ? '我答应核对靛蓝地图的杉木叶标记。' : `我答应核对第${i}项登记。`
    const runId = await f.perform(chatPromiseActionFixture(text))
    const action = observation(i)
    action.commitmentEffects = [{kind: 'fulfill', commitmentKey: `message:harness:${runId}:promise`, evidenceExcerpt: action.text}]
    await f.perform(action)
  }
  const state = (await api.readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.situation.goals[0].commitments).toHaveLength(18)
  expect(state.chatNarrative!.situation.goals[0].commitments!.every(c => c.resolution?.kind === 'fulfilled')).toBe(true)
  const old = state.chatNarrative!.situation.goals[0].commitments![0]
  await f.perform({...chatPromiseActionFixture(), text: '靛蓝地图的杉木叶标记已核对过。', commitmentEffects: []}, '以前靛蓝地图的约定后来怎样了？')
  const view = buildInteractionContextWindow((await api.readProductRuntimeState(f.sessionId)).interaction!, 'guard')
  expect(view.chatNarrative!.goals[0].commitments!.some(c => c.commitmentKey === old.commitmentKey && c.resolution?.kind === 'fulfilled')).toBe(true)
  expect(f.calls()).toBe(74)
}, 90_000)
it('creates and closes 34 new goals and threads through formal reviewed followups', async () => {
  const f = await setup()
  const close = {...observation(0), newFacts: [], text: '本次寻找结束，不再寻找铜印。', goalStatus: 'abandoned' as const, nextPossibilities: []}
  await f.perform(close)
  for (let i = 0; i < 34; i++) {
    const text = `我已完成第${i}项登记的核对，这一项核对结束。`, goalKey = `check-${i}`, threadKey = `thread-${i}`
    const action: ChatNarrativeActionV1 = {...observation(i), text, goalKey, goalStatus: 'fulfilled',
      newFacts: [{factKey: `completed-${i}`, kind: 'observation', text, evidenceFactKeys: ['lost'], evidenceExcerpt: text}],
      threadUpdates: [{threadKey, status: 'resolved', evidenceExcerpt: text}],
      followupGoal: {playerEventSequence: 0, playerExcerpt: `请核对第${i}项登记`, evidenceExcerpt: text,
        goal: {goalKey, desire: `核对第${i}项登记`, concern: '不能把未核对的内容当作结果', boundary: '不代替玩家行动', evidenceFactKeys: ['lost']},
        thread: {threadKey, title: `第${i}项登记核对`, question: `第${i}项是否已核对？`, closureSignals: ['完成本项实际核对'], evidenceFactKeys: ['lost']}}}
    await f.perform(action, `请核对第${i}项登记。`)
  }
  const state = (await api.readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.situation.goals).toHaveLength(36)
  expect(state.chatNarrative!.resolutionEvidence!.goals).toHaveLength(35)
  expect(state.chatNarrative!.resolutionEvidence!.threads).toHaveLength(34)
  db.close(); await db.open()
  expect((await api.readProductRuntimeState(f.sessionId)).interaction).toEqual(state)
  expect(f.calls()).toBe(70)
}, 150_000)
