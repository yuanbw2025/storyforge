import {createHash} from 'node:crypto'
import {chatActionChoiceFixture} from '../helpers/chat-action-outcome'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, readProductRuntimeState} from '../../src/lib/character-interaction/runtime-api'
import {CHAT_TURN_END_CONTROL_CHECKS_V1, CHAT_TURN_END_CONTROL_REVIEW_RULES_V1, CHAT_TURN_END_CHOICE_DRAFT_REVIEW_RULES_V1, chatTurnEndControlReviewRulesV1, chatTurnEndReviewerForProducerV1} from '../../src/lib/character-interaction/turn-end-control'
import {chatActionChoiceVersionForContractV1} from '../../src/lib/character-interaction/action-choice-budget'
import {chatActionReviewPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {seedChatTurnEndRuntimeFixture, chatTurnEndRuntimeRequest} from '../helpers/chat-turn-end-runtime'
import {chatTurnEndActionFixture, chatTurnEndReviewFixture} from '../helpers/chat-turn-end-control'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const originalSkill = skills.getAgentSkillV1

it('keeps historical turn-end review bytes and limits the draft distinction to the registered reviewer', () => {
  const historicalHash = createHash('sha256').update(JSON.stringify(CHAT_TURN_END_CONTROL_REVIEW_RULES_V1)).digest('hex')
  expect(historicalHash).toBe('0e4d8f9cdd94b8c539c0a41e27d6cbbb3ff16081c3c295eb3abf3dff1e9a761c')
  for (const version of ['chat-narrative-action-review-v36', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v43'])
    expect(chatTurnEndControlReviewRulesV1(version)).toEqual(CHAT_TURN_END_CONTROL_REVIEW_RULES_V1)
  for (const version of ['chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42']) expect(chatTurnEndControlReviewRulesV1(version)).toEqual([
    CHAT_TURN_END_CONTROL_REVIEW_RULES_V1[0], ...CHAT_TURN_END_CHOICE_DRAFT_REVIEW_RULES_V1, ...CHAT_TURN_END_CONTROL_REVIEW_RULES_V1.slice(1),
  ])
})

it.each([false, true])('leaves ordinary action and autonomous-pause review instructions unchanged (pause=%s)', pause => {
  const action = {...chatTurnEndActionFixture(), ...(pause ? {kind: 'pause' as const, goalStatus: 'paused' as const} : {})}
  const input = {actions: [action], options: false, compact: false, naturalDisclosure: true, commitments: true, memoryReconciliation: true,
    threadFollowup: true, playerPause: true, conversationEvidence: true, promiseRequest: true, knownFactReview: true, existingGoalPause: true,
    sceneTransition: true, replanning: true, spokenInquiry: true, playerDecision: true}
  expect(chatActionReviewPromptRulesV1({...input, reviewerVersion: 'chat-narrative-action-review-v40'}))
    .toEqual(chatActionReviewPromptRulesV1({...input, reviewerVersion: 'chat-narrative-action-review-v39'}))
})

it('binds the new producer/reviewer pair while retaining the historical pair and rejecting mixed or future contracts', () => {
  const contract = (producer: string, reviewer: string) => ({executionBindings: [
    {stepId: 'interaction:action-choice', skillId: 'character.chat-narrative-action', promptVersion: producer},
    {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-narrative-action', promptVersion: producer},
    {stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: reviewer},
  ], budget: {maxModelCalls: 3, maxAttemptsPerStep: 1}})
  for (const [producer, reviewer] of [['chat-narrative-action-v64', 'chat-narrative-action-review-v39'], ['chat-narrative-action-v65', 'chat-narrative-action-review-v40'], ['chat-narrative-action-v66', 'chat-narrative-action-review-v41']]) {
    expect(chatTurnEndReviewerForProducerV1(producer)).toBe(reviewer)
    expect(chatActionChoiceVersionForContractV1(contract(producer, reviewer))).toBe(1)
  }
  for (const [producer, reviewer] of [['chat-narrative-action-v64', 'chat-narrative-action-review-v40'], ['chat-narrative-action-v65', 'chat-narrative-action-review-v39'], ['chat-narrative-action-v65', 'chat-narrative-action-review-v41'], ['chat-narrative-action-v66', 'chat-narrative-action-review-v40']])
    expect(() => chatActionChoiceVersionForContractV1(contract(producer, reviewer))).toThrow()
})

function draftPause(f: Awaited<ReturnType<typeof seedChatTurnEndRuntimeFixture>>) {
  return {directions: [{id: 'unadopted-pause', kind: 'pause', action: '工程草稿：暂缓寻找铜印。',
    evidenceFactKeys: ['lost'], evidenceMessageIds: [f.handoff.source.messageId], changes: '工程草稿：暂停寻找。', playerDependency: null, unconfirmedConditions: []}],
  selectedId: 'unadopted-pause', decisionSummary: '工程草稿选择暂停，但最终表达可以采用不同的本轮结束结果。'}
}

it.each([false, true])('reviews the actual turn disposition and never commits the discarded pause (historical=%s)', async historical => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), before = await readProductRuntimeState(f.sessionId)
  if (historical) vi.spyOn(skills, 'getAgentSkillV1').mockImplementation((id, ...args) => {
    const skill = originalSkill(id, ...args)
    return {...skill, promptVersion: id === 'character.chat-narrative-action' ? 'chat-narrative-action-v64' : id === 'character.chat-narrative-action-review' ? 'chat-narrative-action-review-v39' : skill.promptVersion}
  })
  const choice = draftPause(f)
  const generated = await generateInteractionRuntimeCandidateV1({...run.input, runAI: async messages => messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? JSON.stringify(chatActionChoiceFixture(messages, choice)) : run.input.runAI(messages)})
  const prompt = run.reviews[0][0].content
  expect(prompt).toBe(chatTurnEndControlReviewRulesV1(historical ? 'chat-narrative-action-review-v39' : 'chat-narrative-action-review-v40').join('\n'))
  expect(run.reviews[0][1].content).toContain(choice.decisionSummary)
  expect(run.reviews[0][1].content).toContain(f.handoff.purpose)
  if (!historical) expect(prompt).toContain('当前待审对象只由 handoff 给出')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.messages).toEqual(before.interaction!.messages)
  expect(after.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
  expect(after.interaction!.chatNarrative!.triggers.at(-1)!.status).toBe('complete')
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '未采用草稿不成为目标状态'})
  const branched = await readProductRuntimeState(branch.id!)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched.interaction)
})

it.each(CHAT_TURN_END_CONTROL_CHECKS_V1)('retains an independent %s rejection despite an unadopted draft', async check => {
  const f = await seedChatTurnEndRuntimeFixture(), run = chatTurnEndRuntimeRequest(f), before = await readProductRuntimeState(f.sessionId)
  const review = chatTurnEndReviewFixture(f.handoff); review.checks.find(c => c.check === check)!.passed = false
  let calls = 0, reviews = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...run.input, onRunCreated: id => {runId = id}, runAI: async messages => {
    calls++; return messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? JSON.stringify(chatActionChoiceFixture(messages, draftPause(f))) : run.input.runAI(messages)
  }, runReviewAI: async () => {reviews++; return JSON.stringify({checks: review.checks})}})).rejects.toThrow('审查未通过')
  expect((await db.agentRuns.get(runId))!.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(calls).toBe(2); expect(reviews).toBe(1)
})
