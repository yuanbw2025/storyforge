import {createHash} from 'node:crypto'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {chatSituationCharacterRulesV1, chatSituationCharacterReviewRulesV1} from '../../src/lib/character-interaction/situation-character-permissions'
import {assertChatInquiryBindingV1} from '../../src/lib/character-interaction/narrative-inquiry'
import {applyChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, branchProductRuntimeSession} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1, type ChatInquiryResultV1} from '../../src/lib/types/chat-narrative'

const skillId = 'character.chat-situation-construction' as const
const reviewSkill = 'character.chat-situation-review' as const
const direction = '只确认本次敲门后能听见什么，不预定有人回应。'
const review = () => ({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程注入审查，不是真实模型质量证据'}))})
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const releasedSituationVersions = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})
  const initial = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'knock.start', baseSequence: initial.sequence, baseStateHash: initial.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const text = '叶岑敲了两下后门，随即停手听门内外的声音。'
  const action: ChatNarrativeActionV1 = {kind: 'complete', text, goalKey: 'find-seal', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['road'], waitingForPlayer: false,
    newFacts: [{factKey: 'knocked', kind: 'observation', text, evidenceFactKeys: ['road'], evidenceExcerpt: text}], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {purpose: 'observation-result', threadKey: 'investigate', direction, evidenceFactKeys: ['road', 'knocked'], evidenceExcerpt: text}}
  const acted = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '实际敲门，不替任何人应答', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: acted.snapshot.run.id})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'knock.continue', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'continue', sourceEventSequence: v.sequence})
  return f
}
function response(): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newGoals: [], newThreads: [], possibilities: [],
    newFacts: [{factKey: 'sound-result', kind: 'observation', text: '敲门声停下后，叶岑听见门外持续的雨声；这次短暂倾听没有听见应答，不能据此确认附近是否有人。',
      audienceKeys: ['guard', 'player'], evidenceFactKeys: ['road', 'knocked'], seedExcerpt: direction}]}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId, objective: '结算实际敲门后的有限观察'}
}

it.each(releasedSituationVersions)('uses saved instructions without rewriting historical generation/review bytes (producer v%s)', async version => {
  const legacy = version === 8
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), original = skills.getAgentSkillV1
  // Every historical case must freeze its own pair, independently of today's registry default.
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === skillId ? {...original(id), promptVersion: `chat-situation-construction-v${version}`}
    : id === reviewSkill ? {...original(id), promptVersion: `chat-situation-review-v${version - 1}`} : original(id))
  let calls = 0
  const result = await generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: () => {vi.restoreAllMocks()}, runAI: withChatActionChoiceFixture(async messages => {
    calls++
    if (legacy) expect(digest(messages[0].content)).toBe('057a52f39ea9067d6607e5526e5bd0760118d109b53f86377090e5d353a9c2f2')
    if (version === 11) expect(digest(messages[0].content)).toBe('935f11738a6d643f6fd9120be118145b9d4255901d9f590a98a4faeeb044060b')
    if (version === 10) expect(digest(messages[0].content)).toBe('bd0c1ec245046132e6dc94799ad46bde6fe43f3d85ba6849538099d576b6cc1e')
    if (version === 9) expect(digest(messages[0].content)).toBe('d48c8a09ca633b20aca8100306893128ce03efb66c7217af377fe22c3eb7218d')
    expect(messages[0].content.includes(chatSituationCharacterRulesV1('chat-situation-construction-v9')[0])).toBe(!legacy)
    expect(messages[1].content).toContain(direction)
    return JSON.stringify(response())
  }), runReviewAI: async messages => {
    calls++
    if (legacy) expect(digest(messages[0].content)).toBe('2be4898f1ab2469e7ca5d1f3d238bc1dc399e32a1db18b532b2e3cc223bf3065')
    if (version === 11) expect(digest(messages[0].content)).toBe('b336e22b145ef3e56b12471527b452dbec6d970d23e0bd860bb1053a80d84bb8')
    if (version === 10) expect(digest(messages[0].content)).toBe('99d8060bb46a307dd0f6d88e9e983c17f77005946e059bdd8a118009feb25a16')
    if (version === 9) expect(digest(messages[0].content)).toBe('8933d2385dfab00bdd8aa2049b95b8d8508e415b09eea7d8e9f09cc3c65daf17')
    expect(messages[0].content.includes(chatSituationCharacterReviewRulesV1('chat-situation-review-v8')[0])).toBe(!legacy)
    return JSON.stringify(review())
  }})
  expect(result.snapshot.contract.executionBindings?.find(b => b.skillId === skillId)?.promptVersion).toBe(`chat-situation-construction-v${version}`)
  expect(result.snapshot.contract.executionBindings?.find(b => b.skillId === reviewSkill)?.promptVersion).toBe(`chat-situation-review-v${version - 1}`)
  expect(calls).toBe(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId), story = after.interaction!.chatNarrative!
  expect(story.pendingSituation).toBeUndefined()
  expect(story.situation.facts.find(f => f.factKey === 'sound-result')?.text).toBe(response().newFacts[0].text)
  expect(story.situation.facts.find(f => f.factKey === 'secret')?.audienceKeys).toEqual([])
  expect(story.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '有限观察恢复'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect(calls).toBe(2)
})

it('retains semantic rejection of an invented worker hidden inside observation, without adopting or repairing', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), draft = response(), report = review()
  draft.newFacts[0].text = '敲门后，一名伙计应声说：“听见了，什么事？”他现在可以直接交谈。'
  report.checks.find(c => c.check === 'permissions')!.passed = false
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(draft)}),
    runReviewAI: async () => {calls++; return JSON.stringify(report)},
  })).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2)
  expect((await db.agentRuns.get(runId))?.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const raw = (await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'raw-response').map(a => a.content)
  expect(raw).toContain(JSON.stringify(draft)); expect(raw).toContain(JSON.stringify(report))
})

it('rejects a temporary character during result settlement even when ordinary context permits the type', async () => {
  const f = await prepared(), state = (await readProductRuntimeState(f.sessionId)).interaction!, draft = response()
  draft.newFacts[0].kind = 'temporary-character'
  state.chatNarrative!.permissions.allowedNewFactKinds.push('temporary-character')
  const before = structuredClone(state), triggerSequence = state.chatNarrative!.triggers.at(-1)!.requestedSequence
  expect(() => applyChatSituationV1(state, {sequence: triggerSequence + 1, triggerSequence, draft,
    review: {...review(), reviewedProposalJson: canonicalStringify(draft)}})).toThrow('已完成观察的结果只能补充有限观察')
  expect(state).toEqual(before)
})

it('rejects hidden-source evidence before independent review, retaining the completed action and pending result', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), draft = response()
  draft.newFacts[0].evidenceFactKeys = ['knocked', 'secret']
  let reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)), runReviewAI: async () => {reviews++; return JSON.stringify(review())}})).rejects.toThrow('不能传播不可知的依据')
  expect(reviews).toBe(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('accepts only exact released inquiry binding pairs, never cross-version or future identities', () => {
  const result = {} as ChatInquiryResultV1 // This guard checks capability only; full payload tests use actual inquiry fixtures.
  const releasedInquiryVersions = [...releasedSituationVersions, 20]
  for (const producer of releasedInquiryVersions) {
    for (const reviewProducer of releasedInquiryVersions) {
      const check = () => assertChatInquiryBindingV1(result, `chat-situation-construction-v${producer}`, `chat-situation-review-v${reviewProducer - 1}`)
      if (reviewProducer === producer) expect(check).not.toThrow()
      else expect(check).toThrow()
    }
  }
  // Adjacent numbers do not grant future contracts permission; only released pairs do.
  for (const [producer, reviewer] of [[7, 6], [7, 8], [21, 20], [999, 998], [999, 8], [9, 999]]) expect(() => assertChatInquiryBindingV1(result, `chat-situation-construction-v${producer}`, `chat-situation-review-v${reviewer}`)).toThrow()
  expect(() => assertChatInquiryBindingV1(result, undefined, 'chat-situation-review-v17')).toThrow()
  expect(() => assertChatInquiryBindingV1(result, 'chat-situation-construction-v18', undefined)).toThrow()
  expect(() => assertChatInquiryBindingV1(result, 'chat-situation-review-v18', 'chat-situation-construction-v17')).toThrow()
  for (const version of [undefined, 'chat-situation-construction-v8', 'chat-situation-construction-v999', 'chat-situation-review-v8']) expect(chatSituationCharacterRulesV1(version)).toEqual([])
  for (const version of [undefined, 'chat-situation-review-v7', 'chat-situation-review-v999', 'chat-situation-construction-v9']) expect(chatSituationCharacterReviewRulesV1(version)).toEqual([])
})
