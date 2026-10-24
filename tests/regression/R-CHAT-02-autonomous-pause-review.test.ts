import {createHash} from 'node:crypto'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, branchProductRuntimeSession} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {CHAT_AUTONOMOUS_PAUSE_REVIEW_RULES_V1, CHAT_REPLANNING_REVIEW_RULES_V1, chatReplanningReviewRulesV1} from '../../src/lib/character-interaction/narrative-replanning'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const pause: ChatNarrativeActionV1 = {kind: 'pause', text: '我选择暂缓自己的寻找，铜印还没找到。', goalKey: 'find-seal',
  evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'paused', nextPossibilities: []}
function reviewInput(options: boolean, reviewerVersion: string, action = pause) {
  return {reviewerVersion, actions: [action], options, compact: false, naturalDisclosure: true, commitments: true, memoryReconciliation: true,
    threadFollowup: true, playerPause: true, conversationEvidence: true, promiseRequest: true, knownFactReview: true, existingGoalPause: true,
    sceneTransition: true, replanning: true, spokenInquiry: true, playerDecision: true}
}

it.each([false, true])('keeps the frozen v38/v28 pause review bytes and every non-pause instruction (options=%s)', options => {
  const old = options ? 'chat-narrative-options-review-v28' : 'chat-narrative-action-review-v38'
  const current = options ? 'chat-narrative-options-review-v29' : 'chat-narrative-action-review-v39'
  const historical = chatActionReviewPromptRulesV1(reviewInput(options, old))
  // Captured from the unmodified 554eeee4 source before this change.
  expect(createHash('sha256').update(JSON.stringify(historical)).digest('hex')).toBe(options
    ? '9be66c4014ef6c41f3688182a37989f79a1bb1391f6da8e0a9c3d73c57387ce9'
    : '5e16ec20478828f1e6f774dc5245229691b5477c5dc5a2245fc48518a9c7e947')
  const next = chatActionReviewPromptRulesV1(reviewInput(options, current))
  expect(next).toEqual(historical.flatMap(rule => rule === CHAT_REPLANNING_REVIEW_RULES_V1[1] ? CHAT_AUTONOMOUS_PAUSE_REVIEW_RULES_V1 : [rule]))
  const continuing = {...pause, kind: 'speak' as const, goalStatus: null}
  expect(chatActionReviewPromptRulesV1(reviewInput(options, current, continuing)))
    .toEqual(chatActionReviewPromptRulesV1(reviewInput(options, old, continuing)))
  const playerHold = {...pause, pauseGoal: {threadKey: 'investigate', playerEventSequence: 5, playerExcerpt: '先停下吧', evidenceExcerpt: pause.text}}
  expect(chatActionReviewPromptRulesV1(reviewInput(options, current, playerHold)))
    .toEqual(chatActionReviewPromptRulesV1(reviewInput(options, old, playerHold)))
})

it('does not extend the new interpretation to unregistered reviewers or a player-requested followup pause', () => {
  for (const version of [undefined, 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v43', 'chat-narrative-options-review-v31'])
    expect(chatReplanningReviewRulesV1(version, [pause])).toEqual(CHAT_REPLANNING_REVIEW_RULES_V1)
  const playerHold = {...pause, threadFollowupGoal: {threadKey: 'investigate', evidenceExcerpt: pause.text,
    goal: {goalKey: 'remaining', desire: '继续核实', concern: '尊重暂停', boundary: '不擅自恢复', evidenceFactKeys: ['lost']},
    pauseRequest: {playerEventSequence: 5, playerExcerpt: '先停下吧'}}}
  expect(chatReplanningReviewRulesV1('chat-narrative-action-review-v39', [playerHold])).toEqual(CHAT_REPLANNING_REVIEW_RULES_V1)
})

async function start() {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'pause-review.open', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}

it.each([false, true])('uses the independent pause review and preserves the unfinished goal through adoption, branch and import (options=%s)', async options => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  const alternative = {...pause, text: '我先暂停自己的寻找，不把尚未查清的事说成任何人的过错。'}
  const generate = vi.fn(withChatActionChoiceFixture(async () => JSON.stringify(options ? {options: [pause, alternative]} : pause)))
  const review = vi.fn(async (messages: Array<{content: string}>) => {
    for (const rule of CHAT_AUTONOMOUS_PAUSE_REVIEW_RULES_V1) expect(messages[0].content).toContain(rule)
    expect(messages[0].content).toContain('任何一项不通过就拒绝整条表达')
    return JSON.stringify(options ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))} : chatActionReviewOutputFixture())
  })
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: options ? 'character.chat-narrative-options' : 'character.chat-narrative-action', objective: '工程注入只验证暂停候选链路，不证明故事质量', runAI: generate, runReviewAI: review})
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(generated.snapshot.contract.executionBindings!.map(b => b.promptVersion)).toContain(options ? 'chat-narrative-options-review-v30' : 'chat-narrative-action-review-v42')
  expect(generated.snapshot.events.filter(e => e.type === 'model.requested')).toHaveLength(options ? 2 : 3)
  expect(generated.snapshot.contract.budget.maxAttemptsPerStep).toBe(1)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, ...(options ? {optionKey: 'option-1'} : {})})
  const after = await readProductRuntimeState(f.sessionId), story = after.interaction!.chatNarrative!
  expect(story.situation.goals.find(g => g.goalKey === pause.goalKey)?.status).toBe('paused')
  expect(story.situation.threads).toEqual(before.interaction!.chatNarrative!.situation.threads)
  expect(story.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '自主暂停工程副本'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  const importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(importedProject).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  expect(generate).toHaveBeenCalledTimes(options ? 1 : 2); expect(review).toHaveBeenCalledTimes(1)
})

it.each(['meaningful-direction', 'continuity', 'permissions', 'player-agency', 'visibility', 'consequences'])('keeps a failed %s review terminal without adoption or automatic repair', async check => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), output = chatActionReviewOutputFixture()
  output.checks.find(row => row.check === check)!.passed = false
  output.checks.find(row => row.check === check)!.reason = '工程注入：本次候选缺少足够依据，不能借自主暂停跳过独立否决。'
  const generate = vi.fn(withChatActionChoiceFixture(async () => JSON.stringify(pause)))
  const review = vi.fn(async () => JSON.stringify(output)); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', objective: '保留原六项独立审查', runAI: generate, runReviewAI: review, onRunCreated: id => {runId = id}})).rejects.toThrow('语义审查未通过')
  expect((await db.agentRuns.get(runId))!.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(generate).toHaveBeenCalledTimes(2); expect(review).toHaveBeenCalledTimes(1)
})
