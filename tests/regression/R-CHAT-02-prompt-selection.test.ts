import {createHash} from 'node:crypto'
import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createInitialInteractionState, interactionRetrievalView} from '../../src/lib/character-interaction/runtime'
import {requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatActionPromptFeaturesV1, chatActionPromptRulesV1, chatActionReviewPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {followupOwnAction, followupResultAction} from '../helpers/chat-player-followup'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const action = (): ChatNarrativeActionV1 => ({kind: 'complete', text: '我把灯移到门边。门边亮了起来。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [{factKey: 'lit-door', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}], disclosures: [], threadUpdates: [], goalStatus: null})
function prepared() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  state.remainingDirectorBudget = 100
  return requestChatNarrativeTriggerV1(state, {sequence: 2, sourceEventSequence: 1, kind: 'scene-start', seed: null})
}
const view = (state = prepared()) => interactionRetrievalView(state, 'guard')
const review = (state = prepared(), actions = [action()], compact = true) => chatActionReviewPromptRulesV1({view: view(state), actions, compact, options: false}).join('\n')

it('keeps legacy saved-review instructions byte-for-byte while reducing an ordinary action review', () => {
  const old = review(prepared(), [action()], false), current = review()
  // Exact V57 rendered system text; no private story data in this digest.
  expect(createHash('sha256').update(old).digest('hex')).toBe('b62509228f6339922e5b9f633b0e4b02b06c9616a7bc43739ecda42f4dcb6523')
  expect(current.length).toBeLessThan(old.length * .7)
  for (const check of ['continuity：', 'permissions：', 'player-agency：', 'visibility：', 'consequences：', 'meaningful-direction：']) expect(current).toContain(check)
  expect(current).toContain('不能借偏好或担心的措辞泄露既有秘密')
  expect(current).not.toContain('若有 pendingEdit')
  expect(current).not.toContain('若含 followupGoal')
})

it('hidden truth and other roles cannot change the actor instruction selection', () => {
  const state = prepared(), before = chatActionPromptRulesV1(view(state))
  state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.text = '隐藏答案完全改变，角色不能获知。'
  state.chatNarrative!.situation.goals[1].desire = '其他角色秘密地打算离开。'
  state.chatNarrative!.situation.goals.push({...state.chatNarrative!.situation.goals[1], goalKey: 'other-hidden', status: 'paused'})
  expect(chatActionPromptRulesV1(view(state))).toEqual(before)
  const rules = before.join('\n')
  expect(rules).not.toContain('pendingEdit.mode=option')
  expect(rules).not.toContain('若 maxDiscoveriesPerSituation')
  expect(rules).not.toContain('关系幅度绝对值')
  expect(rules).toContain('本次 situationRequest=null')
  expect(rules).toContain('本次不使用 followupGoal')
  expect(rules).toContain('goalStatus=fulfilled 或 threadUpdates.status=resolved')
  expect(rules).toContain('都必须 kind=complete 且 waitingForPlayer=false')
})

it('does not ask immutable edits or consequence-only revisions to improve the original expression', () => {
  const state = prepared(), originalView = view(state)
  const options = {producerVersion: 'chat-narrative-action-v44', replanning: true}
  const current = chatActionPromptRulesV1(originalView, options).join('\n')
  expect(current).toContain('一次回复可以连贯完成')
  expect(current).toContain('承接实际所得，判断它使原事项中的哪个问题')
  const revision = chatActionPromptRulesV1(originalView, {...options, preserveExpression: true}).join('\n')
  expect(revision).not.toContain('一次回复可以连贯完成')
  expect(revision).not.toContain('承接实际所得，判断它使原事项中的哪个问题')
  originalView.chatNarrative!.pendingEdit = {sourceMessageId: 'old', role: 'character', actorKey: 'guard', text: '原文保持不变。', audienceKeys: ['guard', 'player'], requestedSequence: 0}
  const edited = chatActionPromptRulesV1(originalView, options).join('\n')
  expect(edited).toContain('默认必须逐字保留其 text')
  expect(edited).not.toContain('一次回复可以连贯完成')
  expect(edited).not.toContain('承接实际所得，判断它使原事项中的哪个问题')
})

it('keeps the new-goal and background alternatives only for the authorized first closed-goal response', () => {
  const state = prepared(), story = state.chatNarrative!
  story.situation.goals[0].status = 'fulfilled'
  story.triggers[0].kind = 'player-response'
  Object.assign(story.permissions, {allowActorSituationExpansion: true, allowPlayerFollowupSituations: true})
  expect(chatActionPromptFeaturesV1(view(state)).followup).toBe(true)
  expect(chatActionPromptRulesV1(view(state)).join('\n')).toContain('结构为 {playerEventSequence:')
  expect(chatActionPromptRulesV1(view(state)).join('\n')).toContain('只在普通回答不足且需要先补足未知局部背景时使用')
  story.triggers[0].kind = 'continue'
  expect(chatActionPromptFeaturesV1(view(state)).followup).toBe(false)
  story.triggers[0].kind = 'player-response'; delete story.permissions.allowPlayerFollowupSituations
  expect(chatActionPromptFeaturesV1(view(state)).followup).toBe(false)
})

it('reviews ordinary pending observation results as a valid first phase even without hidden-discovery permission', () => {
  const text = review(prepared(), [followupResultAction()])
  expect(text).toContain('这是完整的本阶段后果')
  expect(text).toContain('purpose=observation-result')
  expect(text).toContain('不能要求该角色提前披露秘密')
  expect(review(prepared(), [followupOwnAction(1)])).toContain('若含 followupGoal')
})

it('retains obligations for unreported goal and belief changes, and checks both alternative candidates', () => {
  const state = prepared(), story = state.chatNarrative!
  story.situation.goals.push({...story.situation.goals[0], goalKey: 'clarify', desire: '澄清旧猜测'})
  const current = review(state)
  expect(current).toContain('同一行动已结束多个自己的目标时都须登记')
  expect(current).toContain('保留相反的旧打算/猜测')
  const alternatives = chatActionReviewPromptRulesV1({view: view(), actions: [action(), followupOwnAction(1)], options: true, compact: true}).join('\n')
  expect(alternatives).toContain('若含 followupGoal')
  expect(alternatives).toContain('两条正文都会在选定前展示给玩家')
})

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
it('retains exact registered role context, durable rendered requests and independent review after saved-candidate recovery', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'prompt.start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  let runId = 0, generated = 0, reviewed = 0
  const before = await readProductRuntimeState(f.sessionId)
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', narrativeTriggerSequence: trigger.sequence,
    objective: '一次有依据的行动', runAI: withChatActionChoiceFixture(async messages => {
      generated++; expect(messages[0].content).not.toContain('pendingEdit.mode=option')
      expect(messages[1].content).toContain('担心再次错怪人')
      expect(messages[1].content).not.toContain('柜台下')
      return JSON.stringify(action())
    }), onNarrativeActionSaved: id => {runId = id; throw new Error('saved-before-review')},
  })).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  const recovered = await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    reviewed++; expect(messages[0].content).not.toContain('若有 pendingEdit')
    expect(messages[0].content).toContain('visibility：')
    expect(messages[1].content).toContain('柜台下')
    return JSON.stringify(chatActionReviewOutputFixture())
  }})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect([generated, reviewed]).toEqual([1, 1])
  const hashes = new Set(recovered.snapshot.events.flatMap(e => e.type === 'evidence.artifact.recorded' ? [e.payload.contentHash] : []))
  const artifacts = (await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()).filter(a => hashes.has(a.contentHash))
  expect(artifacts.filter(a => a.artifactKind === 'rendered-request')).toHaveLength(3)
  expect(artifacts.some(a => a.artifactKind === 'context-packet')).toBe(true)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(1)
})

it('does not use prompt selection to authorize a stale saved candidate', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'prompt.start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  let runId = 0, reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '原行动',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(action())), onNarrativeActionSaved: id => {runId = id; throw new Error('saved')},
  })).rejects.toThrow('saved')
  const version = await readProductRuntimeStateVersion(f.sessionId)
  await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'interrupt', baseSequence: version.sequence, baseStateHash: version.stateHash, messageId: 'interrupt', text: '先停一下。'})
  await expect(resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {reviews++; return JSON.stringify(chatActionReviewOutputFixture())}})).rejects.toThrow()
  expect(reviews).toBe(0)
})

it('gives new reviewers the exact required disclosure keys without changing old prompt text', () => {
  const a = action(), b = {...action(), disclosures: [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: '旧日误会', wording: 'equivalent' as const}]}
  const input = {view: view(), actions: [a, b], options: true, compact: true, naturalDisclosure: true}
  const old = chatActionReviewPromptRulesV1(input).join('\n'), current = chatActionReviewPromptRulesV1({...input, knownFactReview: true}).join('\n')
  expect(old).not.toContain('本次必须逐项返回的')
  expect(current).toContain(JSON.stringify([{optionKey: 'option-1', factKeys: []}, {optionKey: 'option-2', factKeys: ['regret']}]))
  expect(current).toContain('否定结论不能省略'); expect(current).toContain(old)
})
