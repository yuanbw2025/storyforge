import {createHash} from 'node:crypto'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {chatSituationResponseRulesV1} from '../../src/lib/character-interaction/narrative-situation-prompt'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatNarrativeActionV1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const skillId = 'character.chat-situation-construction' as const
const direction = '补足掌柜对此次保管情况询问的实际回应，不预定他提供任何秘密。'
const review = () => ({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具，只验证绑定与提交，不是语义质量验收'}))})
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true})
  const v = await readProductRuntimeStateVersion(f.sessionId), seed = '掌柜在柜台另一端，可以当面交谈。'
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'inquiry.seed', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'player-seed', sourceEventSequence: v.sequence, seed})
  const backdrop: ChatSituationDraftV1 = {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'clerk-present', kind: 'observation', text: seed, audienceKeys: ['player', 'guard', 'artisan'], evidenceFactKeys: ['road'], seedExcerpt: seed}],
    newGoals: [], newThreads: [], possibilities: []}
  const local = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId,
    objective: '已声明的工程交谈场景', runAI: withChatActionChoiceFixture(async () => JSON.stringify(backdrop)), runReviewAI: async () => JSON.stringify(review())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: local.snapshot.run.id})
  const text = '叶岑向柜台另一端的掌柜问：“铜印平时如何保管？是否有人经手登记？”'
  const action: ChatNarrativeActionV1 = {kind: 'speak', text, goalKey: 'find-seal', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['lost', 'clerk-present'],
    waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {threadKey: 'investigate', direction, evidenceFactKeys: ['lost', 'clerk-present'], evidenceExcerpt: text}}
  const asked = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '工程询问，未预写回答', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: asked.snapshot.run.id})
  const current = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'inquiry.continue', baseSequence: current.sequence, baseStateHash: current.stateHash,
    kind: 'continue', sourceEventSequence: current.sequence})
  return f
}
function response(): ChatSituationDraftV1 {
  return {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'clerk-response', kind: 'observation', text: '掌柜答道：“这里没有逐次领用的登记。”这只说明没有可查询的领用记录，没有确认任何人的经手情况或铜印去向。',
      audienceKeys: ['player', 'guard'], evidenceFactKeys: ['lost', 'clerk-present'], seedExcerpt: direction}],
    newGoals: [], newThreads: [], possibilities: []}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId, objective: '承接已提出的具体问题'}
}

it.each([false, true])('binds inquiry guidance to the saved producer, keeping old bytes and unchanged independent review (legacy=%s)', async legacy => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), raw = JSON.stringify(response())
  const original = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === skillId
    ? {...original(id), promptVersion: `chat-situation-construction-v${legacy ? 6 : 7}`}
    : id === 'character.chat-situation-review' ? {...original(id), promptVersion: 'chat-situation-review-v6'} : original(id))
  let calls = 0, rendered = ''
  const result = await generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async messages => {
    calls++; rendered = JSON.stringify(messages)
    expect(messages[0].content.includes(chatSituationResponseRulesV1('chat-situation-construction-v7')[0])).toBe(!legacy)
    // Digests captured from the unchanged V97 producer and reviewer before this fix.
    if (legacy) expect(digest(messages[0].content)).toBe('41bd4a8eafae948ab4ad400ec4041ac123ce149c108ccce8f19f97c1c2342501')
    expect(messages[1].content).toContain(direction)
    return raw
  }), runReviewAI: async messages => {
    calls++; expect(digest(messages[0].content)).toBe('2be4898f1ab2469e7ca5d1f3d238bc1dc399e32a1db18b532b2e3cc223bf3065')
    return JSON.stringify(review())
  }})
  expect(calls).toBe(2)
  expect(result.snapshot.contract.executionBindings?.find(b => b.skillId === skillId)?.promptVersion).toBe(`chat-situation-construction-v${legacy ? 6 : 7}`)
  expect(result.snapshot.contract.budget.maxModelCalls).toBe(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'rendered-request' && a.content === rendered)).toBe(true)
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === raw)).toBe(true)
  db.close(); await db.open()
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.situation.facts.at(-1)?.factKey).toBe('clerk-response')
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')?.audienceKeys).toEqual([])
  expect(state.chatNarrative!.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
  expect(state.messages).toEqual(before.interaction!.messages)
  const adopted = await readProductRuntimeStateVersion(f.sessionId)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(adopted)
})

it.each(['meaningful-direction', 'visibility'] as const)('retains %s rejection without adopting, repairing or silently resending the response', async check => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), draft = response(), report = review()
  draft.newFacts[0].text = check === 'meaningful-direction' ? '掌柜反问：“你问的是以前还是现在？再说一遍。”' : '掌柜说铜印在柜台下的木箱里。'
  report.checks.find(c => c.check === check)!.passed = false
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id},
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(draft)}), runReviewAI: async () => {calls++; return JSON.stringify(report)},
  })).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2)
  expect((await db.agentRuns.get(runId))?.status).toBe('failed')
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === JSON.stringify(report))).toBe(true)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('cannot turn a hidden source into public answer evidence even when generation asks for progress', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), draft = response()
  draft.newFacts[0].evidenceFactKeys = ['secret']
  let reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)),
    runReviewAI: async () => {reviews++; return JSON.stringify(review())},
  })).rejects.toThrow('不能传播不可知的依据')
  expect(reviews).toBe(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('does not inject the new instructions into unknown or historical producer identities', () => {
  for (const v of [undefined, 'chat-situation-construction-v6', 'chat-situation-construction-v999', 'chat-situation-review-v6']) expect(chatSituationResponseRulesV1(v)).toEqual([])
})
