import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {assembleContext} from '../../src/lib/registry/assemble-context'
import {chatDiscoveryEvidenceContextV1} from '../../src/lib/character-interaction/discovery-evidence-context'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatSituationReviewV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {buildInteractionContextWindow, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const skillId = 'character.chat-situation-construction' as const
const text = '叶岑打开获准检查的木箱并查看内部物件。'
const direction = '确认已完成的木箱检查所得，按原条件逐项判定，不推断经手者。'
const report = () => ({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程注入，非语义质量验收'}))})
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
    objective: '准备已经完成的物理检查', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: acted.snapshot.run.id})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: v.sequence})
  return f
}
function draft(actionSequence: number): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newGoals: [], newThreads: [], possibilities: [],
    newFacts: [{factKey: 'visible-result', kind: 'observation', text: '箱盖已经打开，箱内可见物件足以辨认；经手者仍未知。', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['box', 'inspected'], seedExcerpt: direction}],
    discoveries: [{factKey: 'secret', actorKey: 'guard', actionSequence, evidenceFactKeys: ['lost', 'box', 'inspected'], evidenceExcerpt: text, result: 'discovered', reason: '工程候选，不是独立语义结论'}]}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId, objective: '结算本次已完成检查'}}

it('derives committed evidence and potential targets without declaring truth or changing role/player views', async () => {
  const f = await prepared(), state = (await readProductRuntimeState(f.sessionId)).interaction!, before = structuredClone(state)
  const index = chatDiscoveryEvidenceContextV1(state)!
  expect(index.actionSequence).toBe(state.chatNarrative!.pendingSituation!.sourceEventSequence)
  expect(index.actionEvidenceFactKeys).toEqual(['inspected'])
  expect(index.allowedEvidenceFactKeys).toEqual(['lost', 'road', 'regret', 'box', 'inspected'])
  expect(index.targets).toEqual([{factKey: 'secret', requiredEvidenceFactKeys: ['lost', 'box']}])
  expect(JSON.stringify(index)).not.toContain('discovered')
  expect(selectChatCoordinatorContextV1(state)).not.toContain('discoveryEvidence')
  expect(selectChatCoordinatorContextV1(state, {text: '', discoveryEvidence: false})).toBe(selectChatCoordinatorContextV1(state))
  expect(selectChatCoordinatorContextV1(state, {text: '', discoveryEvidence: true})).toContain(JSON.stringify(index))
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).not.toContain('discoveryEvidence')
  expect(JSON.stringify(buildInteractionContextWindow(state, 'guard'))).not.toContain('discoveryEvidence')
  expect(state).toEqual(before)
})

it.each(['no permission', 'absent actor', 'superseded message', 'old action', 'missing message'] as const)('does not offer investigation references without actual eligibility: %s', async invalid => {
  const f = await prepared(), state = (await readProductRuntimeState(f.sessionId)).interaction!
  if (invalid === 'no permission') state.chatNarrative!.permissions.maxDiscoveriesPerSituation = 0
  if (invalid === 'absent actor') state.activeScene!.activeParticipantKeys = ['artisan']
  if (invalid === 'superseded message') state.messages.at(-1)!.supersededBySequence = 999
  if (invalid === 'old action') state.chatNarrative!.situation.facts.find(f => f.factKey === 'inspected')!.sourceEventSequence--
  if (invalid === 'missing message') state.messages = []
  expect(chatDiscoveryEvidenceContextV1(state)).toBeNull()
})

it.each(['known target', 'other scene', 'other actor', 'already judged', 'unknown prerequisite'] as const)('omits ineligible target: %s', async invalid => {
  const f = await prepared(), state = (await readProductRuntimeState(f.sessionId)).interaction!, story = state.chatNarrative!
  const target = story.situation.facts.find(f => f.factKey === 'secret')!
  if (invalid === 'known target') target.audienceKeys.push('guard')
  if (invalid === 'other scene') target.discovery!.sceneKey = 'elsewhere'
  if (invalid === 'other actor') target.discovery!.actorKeys = ['artisan']
  if (invalid === 'already judged') story.discoveryHistory = [{...draft(story.pendingSituation!.sourceEventSequence).discoveries![0], result: 'not-discovered', discoverySequence: story.lastEventSequence}]
  if (invalid === 'unknown prerequisite') story.situation.facts.find(f => f.factKey === 'box')!.audienceKeys = []
  expect(chatDiscoveryEvidenceContextV1(state)?.targets).toEqual([])
})

it('uses frozen generation/review contexts after registry changes, with reviewed adoption, branch references and portable recovery', async () => {
  const f = await prepared(), parent = await readProductRuntimeState(f.sessionId)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: parent.lastSequence, title: '证据清单分支'})
  const current = {...f, sessionId: branch.id!}, before = await readProductRuntimeState(current.sessionId), index = chatDiscoveryEvidenceContextV1(before.interaction!)!
  expect(index.actionSequence).toBeLessThan(0)
  const value = draft(index.actionSequence), original = skills.getAgentSkillV1, worlds = await db.worldReleases.toArray()
  let runId = 0, generated = 0, reviewed = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(current), onRunCreated: () => {
    vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === skillId ? {...original(id), promptVersion: 'chat-situation-construction-v10'}
      : id === 'character.chat-situation-review' ? {...original(id), promptVersion: 'chat-situation-review-v9'} : original(id))
  }, runAI: withChatActionChoiceFixture(async messages => {
    generated++; expect(messages[1].content).toContain(JSON.stringify(index)); expect(messages[0].content).toContain('本次 newFacts 尚未审查和采纳')
    return JSON.stringify(value)
  }), onSituationDraftSaved: id => {runId = id; throw new Error('crash-before-review')}})).rejects.toThrow('crash-before-review')
  expect(await readProductRuntimeState(current.sessionId)).toEqual(before)
  db.close(); await db.open()
  await expect(resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async () => {reviewed++; return JSON.stringify(report())}}))
    .rejects.toThrow('生成配置或功能版本已变化')
  expect(reviewed).toBe(0)
  vi.restoreAllMocks()
  const reviewedResult = await resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    reviewed++; expect(messages[1].content).toContain(JSON.stringify(index)); expect(messages[0].content).toContain('不把出现在 targets 当作应当 discovered')
    return JSON.stringify(report())
  }})
  expect(reviewedResult.snapshot.contract.executionBindings?.find(b => b.skillId === skillId)?.promptVersion).toBe('chat-situation-construction-v21')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const after = await readProductRuntimeState(current.sessionId)
  expect(after.interaction!.chatNarrative!.discoveryHistory).toHaveLength(1)
  expect(after.interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual(['guard'])
  expect(after.interaction!.messages).toEqual(before.interaction!.messages)
  expect(await db.worldReleases.toArray()).toEqual(worlds)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(after.interaction)
  expect([generated, reviewed]).toEqual([1, 1])
})

it.each(['same candidate', 'hidden fact', 'wrong event'] as const)('retains structural rejection without deleting references or retrying: %s', async invalid => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), value = draft(before.interaction!.chatNarrative!.pendingSituation!.sourceEventSequence)
  if (invalid === 'same candidate') value.discoveries![0].evidenceFactKeys.push('visible-result')
  if (invalid === 'hidden fact') value.discoveries![0].evidenceFactKeys.push('secret')
  if (invalid === 'wrong event') value.discoveries![0].actionSequence--
  let generated = 0, reviewed = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {generated++; return JSON.stringify(value)}),
    runReviewAI: async () => {reviewed++; return JSON.stringify(report())}})).rejects.toThrow('chat-discovery')
  expect([generated, reviewed]).toEqual([1, 0]); expect((await db.agentRuns.get(runId))?.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'raw-response').map(a => a.content)).toContain(JSON.stringify(value))
})

it('does not let inclusion in the target index override an independent negative semantic verdict', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), index = chatDiscoveryEvidenceContextV1(before.interaction!)!
  expect(index.targets.map(t => t.factKey)).toContain('secret')
  const value = draft(index.actionSequence), denied = report()
  denied.checks.find(c => c.check === 'visibility')!.passed = false
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(value)}),
    runReviewAI: async () => {calls++; return JSON.stringify(denied)}})).rejects.toThrow('语义审查未通过')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(calls).toBe(2); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('rejects using another instance producer to obtain the registered evidence view', async () => {
  const f = await prepared(), other = await prepared()
  let calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: async id => {
    await expect(assembleContext({projectId: other.scope.projectId, scope: other.scope, productRuntimeSessionId: other.sessionId,
      sourceKeys: ['chatSituationRuntime'], chatSituationConstructionRunId: id})).rejects.toThrow()
    throw new Error('end isolated scope check')
  }, runAI: withChatActionChoiceFixture(async () => {calls++; return ''})})).rejects.toThrow('end isolated scope check')
  expect(calls).toBe(0)
})
