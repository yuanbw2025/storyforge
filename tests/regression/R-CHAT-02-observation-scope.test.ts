import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const skillId = 'character.chat-situation-construction' as const
const direction = '确认本次掀盖检查的结果：箱盖是否打开；若打开，仅确认此次可直接看见的箱内物品，不推断经手者。'
const objection = '这个箱子先别再翻查，换个办法吧。'
const review = (passed = true) => ({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check,
  passed: check !== 'meaningful-direction' || passed, reason: '工程注入审查；语义判断准确性另作真实模型验收'}))})
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function command(sessionId: number) {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
async function prepared(contents = false) {
  const f = await seedChatNarrativeRuntimeFixture({factDiscovery: true})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const text = contents ? '叶岑打开木箱，仔细查看并辨认箱内物件。' : '叶岑伸手试着掀起箱盖，检查能否打开查看。'
  const action: ChatNarrativeActionV1 = {kind: 'complete', text, goalKey: 'find-seal', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['box'], waitingForPlayer: false,
    newFacts: [{factKey: 'inspected', kind: 'observation', text, evidenceFactKeys: ['box'], evidenceExcerpt: text}], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {purpose: 'observation-result', threadKey: 'investigate', direction, evidenceFactKeys: ['box', 'inspected'], evidenceExcerpt: text}}
  const acted = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '结算范围测试的已完成动作', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: acted.snapshot.run.id})
  const sent = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'refusal', text: objection, audienceKeys: ['player', 'guard']})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: sent.sequence})
  return {...f, text}
}
function response(): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newGoals: [], newThreads: [], possibilities: [],
    newFacts: [{factKey: 'access-result', kind: 'observation', text: '箱盖顺利掀起，露出了盖内侧与箱口木沿，确认木箱可以打开查看；本次未辨认箱内物件，没有继续翻动。',
      audienceKeys: ['guard', 'player'], evidenceFactKeys: ['box', 'inspected'], seedExcerpt: direction}]}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId, objective: '确认已完成观察的实际范围'}}

it('keeps finite access results separate from further inspection, frozen truth and a later player objection through adoption and portable recovery', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  const original = skills.getAgentSkillV1
  let calls = 0
  const result = await generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: () => {
    // Registry changes after contract freeze must not silently select historical prompts.
    vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === skillId ? {...original(id), promptVersion: 'chat-situation-construction-v9'}
      : id === 'character.chat-situation-review' ? {...original(id), promptVersion: 'chat-situation-review-v8'} : original(id))
  }, runAI: withChatActionChoiceFixture(async messages => {
    calls++
    expect(messages[0].content).toContain('不能单独授权未做的查看')
    expect(messages[0].content).toContain('不能仅凭“尝试”否定已实施检查')
    expect(messages[0].content).not.toContain('不捏造箱内内容')
    expect(messages[1].content).toContain(f.text)
    expect(messages[1].content).toContain(objection)
    return JSON.stringify(response())
  }), runReviewAI: async messages => {
    calls++
    expect(messages[0].content).toContain('不能要求额外辨认内部')
    expect(messages[0].content).toContain('已明确查阅或辨认内容时')
    expect(messages[0].content).toContain('秘密仍按冻结发现条件处理')
    return JSON.stringify(review())
  }})
  expect(result.snapshot.contract.executionBindings?.find(b => b.skillId === skillId)?.promptVersion).toBe('chat-situation-construction-v21')
  expect(result.snapshot.contract.executionBindings?.find(b => b.skillId === 'character.chat-situation-review')?.promptVersion).toBe('chat-situation-review-v19')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId), story = after.interaction!.chatNarrative!
  expect(story.pendingSituation).toBeUndefined()
  expect(story.situation.facts.find(f => f.factKey === 'access-result')?.text).toBe(response().newFacts[0].text)
  expect(story.situation.facts.find(f => f.factKey === 'secret')).toEqual(before.interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'secret'))
  expect(story.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
  expect(after.interaction!.messages).toEqual(before.interaction!.messages)
  expect(await db.worldReleases.toArray()).toEqual(worlds)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '只结算既有掀盖动作'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect(calls).toBe(2)
})

it('retains rejection when actual content inspection is replaced by an unsupported no-result answer, without automatic repair or adoption', async () => {
  const f = await prepared(true), before = await readProductRuntimeState(f.sessionId), draft = response()
  draft.newFacts[0].text = '箱盖已经打开；输入没有提供内容，不能辨认任何箱内物件，仍需等待观察结果。'
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(draft)}),
    runReviewAI: async () => {calls++; return JSON.stringify(review(false))},
  })).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2)
  expect((await db.agentRuns.get(runId))?.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const raw = (await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'raw-response').map(a => a.content)
  expect(raw).toContain(JSON.stringify(draft)); expect(raw).toContain(JSON.stringify(review(false)))
})

it.each(['new object', 'hidden evidence', 'missing event evidence'] as const)('keeps structural constraints before semantic review: %s', async invalid => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), draft = response()
  if (invalid === 'new object') draft.newFacts[0].kind = 'object'
  if (invalid === 'hidden evidence') draft.newFacts[0].evidenceFactKeys.push('secret')
  if (invalid === 'missing event evidence') draft.newFacts[0].evidenceFactKeys = ['box']
  let reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)),
    runReviewAI: async () => {reviews++; return JSON.stringify(review())},
  })).rejects.toThrow()
  expect(reviews).toBe(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})
