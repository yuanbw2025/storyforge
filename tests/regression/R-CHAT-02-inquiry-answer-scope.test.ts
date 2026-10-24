import {createHash} from 'node:crypto'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatInquiryEvidenceVersionForContractV1} from '../../src/lib/character-interaction/inquiry-evidence'
import {chatCoordinatorAudienceVersionV1} from '../../src/lib/character-interaction/coordinator-audience'
import {assertChatInquiryBindingV1} from '../../src/lib/character-interaction/narrative-inquiry'
import {chatInquiryReviewFixture} from '../helpers/chat-inquiry-output'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1, ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const producer = 'character.chat-situation-construction' as const
const originalSkill = skills.getAgentSkillV1
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
// Captured from the original V359 failed inquiry; never regenerate from current code.
const legacyGenerationHash = 'b26f5e933a0ba904f08283314f952b5ecc4c2aed5bd273e51777d30121dac137'
const unchangedReviewHash = 'dd9370ca7b096ea2c49aae9e3eeff58a91bc8740a142b68ef4ed97fc7fa9df06'
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function prepare() {
  const f = await seedChatNarrativeRuntimeFixture({inquiryResults: true, maxActionsPerTrigger: 1})
  const version = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'scope.question', baseSequence: version.sequence,
    baseStateHash: version.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence,
    direction: {actorKey: 'guard', actionLimit: 1, settleSituationVersion: 1}})
  const text = '叶岑问掌柜：“你上次用完铜印，当时放在哪里？”'
  const action: ChatNarrativeActionV1 = {kind: 'speak', text, goalKey: 'find-seal', audienceKeys: ['guard', 'player'],
    evidenceFactKeys: ['lost', 'clerk-present'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {purpose: 'inquiry-result', threadKey: 'investigate', direction: '回应已问出的上次收放经过，不预定结果。',
      evidenceFactKeys: ['lost', 'clerk-present'], evidenceExcerpt: text, respondentFactKey: 'clerk-present',
      respondentExcerpt: '掌柜在柜台另一端，可以当面交谈。', respondentName: '掌柜'}}
  const asked = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', narrativeTriggerSequence: trigger.sequence, objective: '工程实际问话',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: asked.snapshot.run.id})
  const before = await readProductRuntimeState(f.sessionId), story = before.interaction!.chatNarrative!, pending = story.pendingSituation!
  const draft: ChatSituationDraftV1 = {kind: 'chat-situation', title: story.situation.title, location: story.situation.location, timeLabel: story.situation.timeLabel,
    newFacts: [], newGoals: [], newThreads: [], possibilities: [], inquiryResult: {actorKey: 'guard', questionSequence: pending.sourceEventSequence,
      questionExcerpt: text, respondentFactKey: 'clerk-present', respondentExcerpt: '掌柜在柜台另一端，可以当面交谈。', respondentName: '掌柜',
      statementFactKey: 'last-storage-statement', answerKind: 'statement', answerText: '上次用后我放回了柜台的公物收存处。这只是当时的收放经过，当前位置仍须实际核对。',
      audienceKeys: ['guard', 'player'], evidenceFactKeys: ['lost', 'clerk-present'], discoveries: []}}
  return {...f, before, draft, input: {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: producer,
    narrativeTriggerSequence: trigger.sequence, objective: '结算同一个实际问题'}}
}

it.each(['legacy-v20', 'current-v21'] as const)('keeps the exact retained review, question, state boundary and two-call budget under %s', async mode => {
  const f = await prepare()
  if (mode === 'legacy-v20') vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === producer
    ? {...originalSkill(id), promptVersion: 'chat-situation-construction-v20'} : originalSkill(id))
  else expect(skills.getAgentSkillV1(producer).promptVersion).toBe('chat-situation-construction-v21')
  let calls = 0
  const result = await generateInteractionRuntimeCandidateV1({...f.input, runAI: async messages => {
    calls++
    if (mode === 'legacy-v20') expect(digest(messages[0].content)).toBe(legacyGenerationHash)
    else expect(messages[0].content).toContain('区分过去经过、通常做法和当前状态')
    expect(messages[1].content).toContain(f.draft.inquiryResult!.questionExcerpt)
    expect(messages[1].content).toContain('"version":5')
    return JSON.stringify(f.draft)
  }, runReviewAI: async messages => {
    calls++; expect(digest(messages[0].content)).toBe(unchangedReviewHash)
    return JSON.stringify(chatInquiryReviewFixture(f.draft))
  }})
  expect(calls).toBe(2)
  expect(result.snapshot.contract.budget.maxModelCalls).toBe(2)
  expect(chatInquiryEvidenceVersionForContractV1(result.snapshot.contract)).toBe(5)
  expect(chatCoordinatorAudienceVersionV1(result.snapshot.contract)).toBe(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(f.before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId), story = after.interaction!.chatNarrative!
  expect(after.interaction!.messages).toEqual(f.before.interaction!.messages)
  expect(story.situation.goals).toEqual(f.before.interaction!.chatNarrative!.situation.goals)
  expect(story.situation.threads).toEqual(f.before.interaction!.chatNarrative!.situation.threads)
  expect(story.situation.facts.find(fact => fact.factKey === 'secret')).toEqual(f.before.interaction!.chatNarrative!.situation.facts.find(fact => fact.factKey === 'secret'))
  expect(story.pendingSituation).toBeUndefined()
  expect(story.inquiryHistory).toHaveLength(1)
  db.close(); await db.open(); expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
})

it.each(['uncertain', 'declined'] as const)('still allows independently approved %s replies without inventing a discovery', async answerKind => {
  const f = await prepare()
  f.draft.inquiryResult!.answerKind = answerKind
  f.draft.inquiryResult!.answerText = answerKind === 'uncertain' ? '那次交接我没有在场，无法说明当时的放置过程。' : '这段交接涉及我已答应保密的住客信息，我不能转述。'
  const result = await generateInteractionRuntimeCandidateV1({...f.input, runAI: async () => JSON.stringify(f.draft), runReviewAI: async () => JSON.stringify(chatInquiryReviewFixture(f.draft))})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!
  expect(state.inquiryHistory?.[0]).toMatchObject({answerKind, discoveries: []})
  expect(state.situation.facts.find(fact => fact.factKey === 'secret')).toEqual(f.before.interaction!.chatNarrative!.situation.facts.find(fact => fact.factKey === 'secret'))
})

it.each(['meaningful-result', 'bounded-answer'] as const)('keeps independent %s rejection terminal and preserves the pending question', async failedCheck => {
  const f = await prepare(), report = chatInquiryReviewFixture(f.draft)
  f.draft.inquiryResult!.answerText = '现在是否还在原处不能保证，先容我核对再说上次放在哪里。'
  report.inquiryReview.checks.find(check => check.check === failedCheck)!.passed = false
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...f.input, onRunCreated: id => {runId = id},
    runAI: async () => {calls++; return JSON.stringify(f.draft)}, runReviewAI: async () => {calls++; return JSON.stringify(report)},
  })).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2)
  expect((await db.agentRuns.get(runId))?.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(f.before)
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === JSON.stringify(report))).toBe(true)
})

it('accepts the exact new generation binding while rejecting cross-paired or unknown inquiry contracts', async () => {
  const f = await prepare()
  expect(() => assertChatInquiryBindingV1(f.draft.inquiryResult, 'chat-situation-construction-v21', 'chat-situation-review-v19')).not.toThrow()
  for (const [generation, review] of [['chat-situation-construction-v21', 'chat-situation-review-v18'], ['chat-situation-construction-v22', 'chat-situation-review-v19']]) {
    expect(() => assertChatInquiryBindingV1(f.draft.inquiryResult, generation, review)).toThrow()
  }
})
