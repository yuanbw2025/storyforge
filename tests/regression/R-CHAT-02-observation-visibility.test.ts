import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {buildInteractionContextWindow, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const skillId = 'character.chat-situation-construction' as const
const text = '叶岑在众人面前打开获准检查的木箱，独自俯身查看内部。'
const direction = '确认本次开箱与查看的有限结果，不推断经手者。'
const refusal = '先别再翻查，换个办法。'
const truth = '铜印在柜台下的木箱里。'
// These injected verdicts test the durable contract, not model judgement quality.
const report = (failed?: string) => ({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: check !== failed, reason: '工程注入；独立语义准确性另验收'}))})
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function command(sessionId: number) {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture({factDiscovery: true})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const action: ChatNarrativeActionV1 = {kind: 'complete', text, goalKey: 'find-seal', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['box'], waitingForPlayer: false,
    newFacts: [{factKey: 'inspected', kind: 'observation', text, evidenceFactKeys: ['box'], evidenceExcerpt: text}], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {purpose: 'observation-result', threadKey: 'investigate', direction, evidenceFactKeys: ['box', 'inspected'], evidenceExcerpt: text}}
  const acted = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '已完成且公开可见的动作与私下查看', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: acted.snapshot.run.id})
  const sent = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'refusal', text: refusal, audienceKeys: ['player', 'guard']})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: sent.sequence})
  return f
}
function draft(actionSequence: number, publicMechanics = false): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newGoals: [], newThreads: [], possibilities: [],
    newFacts: publicMechanics ? [{factKey: 'opened', kind: 'observation', text: '箱盖已经打开，露出箱口边沿。', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['box', 'inspected'], seedExcerpt: direction}] : [],
    discoveries: [{factKey: 'secret', actorKey: 'guard', actionSequence, evidenceFactKeys: ['lost', 'box', 'inspected'], evidenceExcerpt: text, result: 'discovered', reason: '本次独自查看确认箱内铜印；不推断经手者。'}]}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId, objective: '结算既有观察，不执行新调查'}}

it.each([false, true])('preserves private canonical discovery with optional shared mechanics (%s), frozen prompts and portable recovery', async publicMechanics => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  const value = draft(before.interaction!.chatNarrative!.pendingSituation!.sourceEventSequence, publicMechanics), original = skills.getAgentSkillV1
  let calls = 0
  const result = await generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: () => {
    vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === skillId ? {...original(id), promptVersion: 'chat-situation-construction-v11'}
      : id === 'character.chat-situation-review' ? {...original(id), promptVersion: 'chat-situation-review-v10'} : original(id))
  }, runAI: withChatActionChoiceFixture(async messages => {
    calls++; expect(messages[0].content).toContain('动作的听众与结果的知情者分别判断')
    expect(messages[0].content).toContain('newFacts 可以为 []')
    expect(messages[1].content).toContain('discoveryEvidence'); expect(messages[1].content).toContain(refusal)
    return JSON.stringify(value)
  }), runReviewAI: async messages => {
    calls++; expect(messages[0].content).toContain('newFacts=[] 本身不是 meaningful-direction 失败')
    expect(messages[0].content).toContain('不改候选或听众来放行')
    return JSON.stringify(report())
  }})
  vi.restoreAllMocks()
  expect(result.snapshot.contract.executionBindings?.find(b => b.skillId === skillId)?.promptVersion).toBe('chat-situation-construction-v21')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId), state = after.interaction!, story = state.chatNarrative!
  expect(story.pendingSituation).toBeUndefined()
  expect(story.situation.facts.filter(f => f.factKey === 'secret')).toEqual([{...before.interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!, audienceKeys: ['guard']}])
  expect(story.situation.facts.find(f => f.factKey === 'opened')?.audienceKeys).toEqual(publicMechanics ? ['guard', 'player'] : undefined)
  expect(JSON.stringify(buildInteractionContextWindow(state, 'guard'))).toContain(truth)
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).not.toContain(truth)
  expect(JSON.stringify(buildInteractionContextWindow(state, 'artisan'))).not.toContain(truth)
  expect(state.messages).toEqual(before.interaction!.messages)
  expect(story.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
  expect(await db.worldReleases.toArray()).toEqual(worlds)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: `私有发现-${publicMechanics}`})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect(calls).toBe(2)
})

it('keeps a concrete shared observation and an inconclusive private finding without inventing success', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), value = draft(before.interaction!.chatNarrative!.pendingSituation!.sourceEventSequence, true)
  value.discoveries![0].result = 'inconclusive'
  value.discoveries![0].reason = '测试注入有限结论，不宣称发现。'
  const result = await generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(value)), runReviewAI: async () => JSON.stringify(report())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual([])
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).toContain(value.newFacts[0].text)
  expect(state.chatNarrative!.discoveryHistory?.[0].result).toBe('inconclusive')
})

it.each(['indirect public disclosure', 'private semantic duplicate', 'unsupported discovery'] as const)('preserves independent rejection without narrowing or repairing: %s', async invalid => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), value = draft(before.interaction!.chatNarrative!.pendingSituation!.sourceEventSequence, true)
  if (invalid === 'indirect public disclosure') value.newFacts[0].text = '叶岑已完成对箱内铜印的目视核对。'
  if (invalid === 'private semantic duplicate') {value.newFacts[0].text = '木箱内部存放着那枚失踪的铜印。'; value.newFacts[0].audienceKeys = ['guard']}
  if (invalid === 'unsupported discovery') {value.newFacts = []; value.discoveries![0].reason = 'targets 列出此事实，所以必须发现。'}
  const denied = report(invalid === 'unsupported discovery' ? 'continuity' : 'visibility')
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(value)}),
    runReviewAI: async () => {calls++; return JSON.stringify(denied)}})).rejects.toThrow('语义审查未通过')
  expect((await db.agentRuns.get(runId))?.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const raw = (await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'raw-response').map(a => a.content)
  expect(raw).toContain(JSON.stringify(value)); expect(raw).toContain(JSON.stringify(denied))
  expect(calls).toBe(2)
})
