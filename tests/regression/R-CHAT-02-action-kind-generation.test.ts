import {createHash} from 'node:crypto'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {CHAT_ACTION_KIND_RULE_V1, supportsChatActionKindPromptV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true}), v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'action-kind.start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
function inquiry(): ChatNarrativeActionV1 {
  const text = '我朝屋里问：“有人见过失踪的铜印吗？”'
  return {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {threadKey: 'investigate', direction: '补足当前是否有人能提供最后见到铜印位置的线索，不预定他人回答。', evidenceFactKeys: ['lost'], evidenceExcerpt: text}}
}

it.each([[false, false], [false, true], [true, false], [true, true]])('preserves the old producer while reviewing an actual inquiry (options=%s, legacy=%s)', async (options, legacy) => {
  const f = await prepared(), skillId = options ? 'character.chat-narrative-options' : 'character.chat-narrative-action'
  if (legacy) {
    const original = skills.getAgentSkillV1
    vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === skillId ? {...original(id), promptVersion: options ? 'chat-narrative-options-v24' : 'chat-narrative-action-v34'} : original(id))
  }
  const a = inquiry(), b = {...a, text: '我问道：“有人愿意说说见过的情况吗？”', situationRequest: null}
  const raw = JSON.stringify(options ? {options: [a, b]} : a), before = await readProductRuntimeState(f.sessionId)
  let calls = 0, rendered = ''
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId, objective: '核验普通询问与玩家决定的边界',
    runAI: withChatActionChoiceFixture(async messages => {
      calls++; rendered = JSON.stringify(messages)
      expect(messages[0].content.includes(options || legacy ? CHAT_ACTION_KIND_RULE_V1 : '等待环境结果或非玩家回答不等于等待玩家')).toBe(!legacy)
      if (legacy) expect(createHash('sha256').update(messages[0].content).digest('hex')).toBe(options
        ? 'cfdb2fdedc24df3e9c20b46d06104ba2272a27c3c98ca18cad40779072af65bd'
        : '339fafb4dc218595a12844d0d5639476f7b7dfb7b8355060e16d748598945df7')
      expect(messages[1].content).not.toContain('柜台下')
      return raw
    }), runReviewAI: async messages => {
      calls++; expect(messages[0].content).not.toContain(CHAT_ACTION_KIND_RULE_V1)
      return JSON.stringify(options ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))} : chatActionReviewOutputFixture())
    },
  })
  expect(calls).toBe(2); expect(generated.snapshot.contract.budget.maxModelCalls).toBe(options || legacy ? 2 : 3)
  expect(generated.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(options || legacy ? 2 : 3)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const artifacts = await db.agentRunArtifacts.toArray()
  expect(artifacts.some(row => row.artifactKind === 'raw-response' && row.content === (options || legacy ? raw : JSON.stringify({outcome: 'action', action: a, handoff: null})))).toBe(true)
  expect(artifacts.some(a => a.artifactKind === 'rendered-request' && a.content === rendered)).toBe(true)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, ...(options ? {optionKey: 'option-1'} : {})})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.pendingSituation?.direction).toBe(a.situationRequest!.direction)
  expect(state.messages.map(m => m.text)).toEqual([a.text])
  expect(state.chatNarrative!.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
})

it('does not apply the new clarification to saved revisions or unknown producers', () => {
  for (const version of ['chat-narrative-action-v35', 'chat-narrative-options-v25']) expect(supportsChatActionKindPromptV1(version)).toBe(true)
  for (const version of [undefined, 'chat-narrative-action-v34', 'chat-narrative-options-v24', 'chat-action-revision-v16', 'chat-narrative-action-v999']) expect(supportsChatActionKindPromptV1(version)).toBe(false)
})

it.each(['attempt-without-player', 'speech-with-result', 'speech-with-fulfilled-goal', 'waiting-with-result'])('rejects %s without normalization, another call or any state change', async kind => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), a = inquiry()
  if (kind === 'attempt-without-player') a.kind = 'attempt'
  else if (kind === 'speech-with-fulfilled-goal') a.goalStatus = 'fulfilled'
  else {
    a.text = '门边亮了起来。'; a.situationRequest = null
    a.newFacts = [{factKey: 'lit-door', kind: 'observation', text: a.text, evidenceFactKeys: ['lost'], evidenceExcerpt: a.text}]
    if (kind === 'waiting-with-result') {a.kind = 'complete'; a.waitingForPlayer = true}
  }
  const raw = JSON.stringify(a); let calls = 0, reviewed = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '原样拒绝无效行动组合',
    runAI: withChatActionChoiceFixture(async () => {calls++; return raw}), runReviewAI: async () => {reviewed++; return JSON.stringify(chatActionReviewOutputFixture())}, onRunCreated: id => {runId = id},
  })).rejects.toThrow(kind === 'attempt-without-player' ? '行动尝试必须交还玩家决定' : '意图或等待选择不能写成已完成后果')
  expect([calls, reviewed]).toEqual([1, 0]); expect((await db.agentRuns.get(runId))!.status).toBe('failed')
  expect((await db.agentRunArtifacts.toArray()).some(row => row.artifactKind === 'raw-response' && row.content === JSON.stringify({outcome: 'action', action: a, handoff: null}))).toBe(true)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('still waits for the player when the actor requests permission', async () => {
  const f = await prepared(), a = {...inquiry(), kind: 'attempt' as const, text: '你愿意帮我查看屋外吗？', waitingForPlayer: true, situationRequest: null}
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '询问玩家是否愿意参与',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(a)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture()),
  })
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers.at(-1)!.status).toBe('waiting-player')
  expect(state.chatNarrative!.pendingSituation).toBeUndefined()
})

it('keeps semantic rejection independent of a structurally valid utterance', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), a = inquiry(), review = chatActionReviewOutputFixture()
  review.checks.find(c => c.check === 'player-agency')!.passed = false
  let calls = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '审查拒绝仍保留原状态',
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(a)}), runReviewAI: async () => {calls++; return JSON.stringify(review)},
  })).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})
