import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import original from '../fixtures/character-chat-bounded-observation-v313.json'
import {db} from '../../src/lib/db/schema'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {compileChatActionWireV1} from '../../src/lib/character-interaction/action-wire'
import {chatActionReviewPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {chatActionChoiceVersionForContractV1} from '../../src/lib/character-interaction/action-choice-budget'
import {chatInquiryEvidenceVersionForContractV1} from '../../src/lib/character-interaction/inquiry-evidence'
import {chatObservationScopeGenerationRulesV1, chatObservationScopeReviewRulesV1} from '../../src/lib/character-interaction/observation-scope-prompt'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

// Verdict injection checks the durable boundary, not the quality of model judgement.
const report = (failed?: string) => ({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: check !== failed, reason: '工程注入；模型语义判别另验收'}))})
const text = original.expression.value.action.text
const direction = original.expression.value.action.situationRequest.direction
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function command(sessionId: number) {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture({factDiscovery: true})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const action: ChatNarrativeActionV1 = {kind: 'complete', text, goalKey: 'find-seal', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['box'], waitingForPlayer: false,
    newFacts: [{factKey: 'inspected', kind: 'observation', text, evidenceFactKeys: ['box'], evidenceExcerpt: text}], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {purpose: 'observation-result', threadKey: 'investigate', direction, evidenceFactKeys: ['box', 'inspected'], evidenceExcerpt: text}}
  let calls = 0
  const result = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '一次已实施的有限检查', runAI: withChatActionChoiceFixture(async messages => {
      calls++; expect(messages[0].content).toContain('记录完成的是这次尝试，不是成功')
      return JSON.stringify(action)
    }), runReviewAI: async messages => {
      calls++; expect(messages[0].content).toContain('不能要求角色先断言打开成功或知道内容才允许判定')
      expect(messages[1].content).toContain(text)
      return JSON.stringify(chatActionReviewOutputFixture())
    }})
  expect(result.snapshot.contract.executionBindings?.find(b => b.stepId === 'interaction:action-review')?.promptVersion).toBe('chat-narrative-action-review-v42')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const state = await readProductRuntimeState(f.sessionId)
  expect(state.interaction!.chatNarrative!.pendingSituation?.direction).toBe(direction)
  expect(state.interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')?.audienceKeys).toEqual([])
  expect(calls).toBe(2) // Choice fixture is separate; this counter records expression and review only.
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: state.lastSequence})
  return f
}
function outcome(actionSequence: number, failedAccess: boolean): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newGoals: [], newThreads: [], possibilities: [],
    newFacts: [{factKey: 'limited-result', kind: 'observation', text: failedAccess
      ? '箱盖只掀起一道窄缝，叶岑这次尝试未能看清内部；没有强拆或继续翻动。'
      : '箱盖正常开启；叶岑此次俯身查看，认清了箱内的铜印，没有取出或翻动其他物件。',
      audienceKeys: ['guard'], evidenceFactKeys: ['lost', 'box', 'inspected'], seedExcerpt: direction}],
    discoveries: [{factKey: 'secret', actorKey: 'guard', actionSequence, evidenceFactKeys: ['lost', 'box', 'inspected'], evidenceExcerpt: text,
      result: failedAccess ? 'inconclusive' : 'discovered', reason: failedAccess ? '仅看见开合受阻，未看清内容。' : '本次已实施的开启查看正常完成，具体观察确认铜印；不推断经手者。'}]}
}

it.each([false, true])('settles the same bounded attempt once, without precommitting success or sharing private contents (failedAccess=%s)', async failedAccess => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  const actionSequence = before.interaction!.chatNarrative!.pendingSituation!.sourceEventSequence
  let calls = 0
  const result = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: 'character.chat-situation-construction',
    objective: '结算一次实际尝试的有限结果', runAI: withChatActionChoiceFixture(async messages => {
      calls++; expect(messages[0].content).toContain('尝试本身已完成，成功及所得待判定')
      expect(messages[1].content).toContain(text)
      return JSON.stringify(outcome(actionSequence, failedAccess))
    }), runReviewAI: async messages => {
      calls++; expect(messages[0].content).toContain('不能保证成功、追加选择、执行未来动作')
      return JSON.stringify(report())
    }})
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId), story = after.interaction!.chatNarrative!
  expect(story.pendingSituation).toBeUndefined()
  expect(story.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
  expect(after.interaction!.messages).toEqual(before.interaction!.messages)
  expect(story.situation.facts.find(f => f.factKey === 'secret')?.audienceKeys).toEqual(failedAccess ? [] : ['guard'])
  expect(JSON.stringify(interactionVisibilityView(after.interaction!, 'player'))).not.toContain('铜印在柜台下的木箱里')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '一次有限检查'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  expect(calls).toBe(2)
})

it.each(['未实际查看', '借结果追加动作', '私下内容公开'])('retains semantic rejection without automatic repair, adoption or further actions: %s', async reason => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  const draft = outcome(before.interaction!.chatNarrative!.pendingSituation!.sourceEventSequence, false)
  draft.newFacts[0].text = reason === '未实际查看' ? '只是计划查看，但按计划确认了全部内容。' : reason === '借结果追加动作' ? '打开后又翻找了另一只箱子，取出了其中物品。' : '叶岑独自看到的箱内物品现在也都告诉了玩家。'
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: 'character.chat-situation-construction',
    objective: '不得放行范围外结果', onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(draft)}),
    runReviewAI: async () => {calls++; return JSON.stringify(report('meaningful-direction'))},
  })).rejects.toThrow('语义审查未通过')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRuns.get(runId))?.status).toBe('failed')
  expect(calls).toBe(2)
})

it('keeps the exact failed V313 payload and distinguishes the new rule from the frozen historical review', () => {
  const action = compileChatActionWireV1(original.expression.value.action, 'chat-narrative-action-v57', ['player', 'participant.001']) as ChatNarrativeActionV1
  const old = chatActionReviewPromptRulesV1({actions: [action], options: false, compact: false, reviewerVersion: 'chat-narrative-action-review-v36'})
  const current = chatActionReviewPromptRulesV1({actions: [action], options: false, compact: false, reviewerVersion: 'chat-narrative-action-review-v37'})
  expect(original.review.value.checks.filter(c => !c.passed).map(c => c.check)).toEqual(['consequences', 'meaningful-direction'])
  expect(old.join('\n')).not.toContain('完成一次检查尝试与已经成功')
  expect(current.join('\n')).toContain('完成一次检查尝试与已经成功')
  expect(chatObservationScopeGenerationRulesV1('chat-situation-construction-v15').join('\n')).not.toContain('尝试本身已完成')
  expect(chatObservationScopeReviewRulesV1('chat-situation-review-v14').join('\n')).not.toContain('尝试本身已完成')
})

it('requires the new exact producer/reviewer pairs while retaining all old inquiry evidence versions', () => {
  const binding = (stepId: string, skillId: string, promptVersion: string) => ({stepId, skillId, promptVersion})
  const action = {budget: {maxModelCalls: 3, maxAttemptsPerStep: 1}, executionBindings: [
    binding('interaction:action-choice', 'character.chat-narrative-action', 'chat-narrative-action-v58'),
    binding('interaction:runtime-candidate', 'character.chat-narrative-action', 'chat-narrative-action-v58'),
    binding('interaction:action-review', 'character.chat-narrative-action-review', 'chat-narrative-action-review-v37')]}
  expect(chatActionChoiceVersionForContractV1(action)).toBe(1)
  action.executionBindings[2].promptVersion = 'chat-narrative-action-review-v36'
  expect(() => chatActionChoiceVersionForContractV1(action)).toThrow()
  for (const [producer, reviewer, evidence] of [[13, 12, 1], [14, 13, 2], [15, 14, 3], [16, 15, 3]]) {
    const executionBindings = [binding('interaction:runtime-candidate', 'character.chat-situation-construction', `chat-situation-construction-v${producer}`),
      binding('interaction:situation-review', 'character.chat-situation-review', `chat-situation-review-v${reviewer}`)]
    expect(chatInquiryEvidenceVersionForContractV1({executionBindings})).toBe(evidence)
    executionBindings[1].promptVersion = 'chat-situation-review-v11'
    expect(() => chatInquiryEvidenceVersionForContractV1({executionBindings})).toThrow()
  }
})
