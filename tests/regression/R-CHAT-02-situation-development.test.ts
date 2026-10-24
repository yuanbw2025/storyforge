import {estimateChatActionRequestInputV1} from '../../src/lib/character-interaction/action-choice-input-budget'
import type {ChatMessage} from '../../src/lib/types'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import legacy from '../fixtures/character-chat-situation-development-legacy.json'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {chatInquiryEvidenceVersionForContractV1} from '../../src/lib/character-interaction/inquiry-evidence'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'
import {chatSituationDevelopmentGenerationRulesV1, chatSituationDevelopmentReviewRulesV1} from '../../src/lib/character-interaction/situation-development'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const sparse: ChatSituationDraftV1 = {kind: 'chat-situation', title: '门外的声响', location: '驿站', timeLabel: '傍晚',
  newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['player', 'guard'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}],
  newGoals: [{goalKey: 'understand-knock', actorKey: 'guard', desire: '了解来意', concern: '贸然开门', boundary: '不替玩家开门', evidenceFactKeys: ['knocking']}],
  newThreads: [], possibilities: [{actorKey: 'guard', text: '可以隔门询问，也可以等待。', evidenceFactKeys: ['knocking']}]}
const review = (passed: boolean) => ({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check,
  passed: check !== 'meaningful-direction' || passed,
  reason: check === 'meaningful-direction' && !passed ? '只重复敲门现象和询问意向，未准备支持互动的具体背景。工程拒绝夹具，不代表真实语义评分。' : '工程流程夹具，不代表真实语义评分。'}))})
async function prepare() {
  const f = await seedChatNarrativeRuntimeFixture(), version = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'new-background', baseSequence: version.sequence,
    baseStateHash: version.stateHash, kind: 'player-seed', sourceEventSequence: version.sequence, seed: '门外传来敲门声，门边有一块未写定细节的旧告示。'})
  return {...f, triggerSequence: trigger.sequence}
}
const input = (f: Awaited<ReturnType<typeof prepare>>) => ({scope: f.scope, productRuntimeSessionId: f.sessionId,
  participantKey: 'player', skillId: 'character.chat-situation-construction' as const, narrativeTriggerSequence: f.triggerSequence, objective: '内化新的局部情境'})

it.each(['historical', 'development-v19'] as const)('preserves the exact retained V343 system requests and all existing rules under %s bindings', async mode => {
  const original = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-situation-construction'
    ? {...original(id), promptVersion: mode === 'historical' ? legacy.producerVersion : 'chat-situation-construction-v19'} : id === 'character.chat-situation-review'
      ? {...original(id), promptVersion: mode === 'historical' ? legacy.reviewerVersion : 'chat-situation-review-v18'} : original(id))
  const f = await prepare(), before = await readProductRuntimeState(f.sessionId)
  const prompts: string[] = []
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: async messages => {
    prompts.push(messages[0].content); return JSON.stringify(sparse)
  }, runReviewAI: async messages => {prompts.push(messages[0].content); return JSON.stringify(review(true))}})
  const versions = mode === 'historical' ? [legacy.producerVersion, legacy.reviewerVersion] : ['chat-situation-construction-v19', 'chat-situation-review-v18']
  expect(generated.snapshot.contract.executionBindings?.map(b => b.promptVersion)).toEqual(versions)
  const extras = [chatSituationDevelopmentGenerationRulesV1(versions[0]), chatSituationDevelopmentReviewRulesV1(versions[1])]
  for (let index = 0; index < 2; index++) {
    expect(extras[index].length).toBe(mode === 'historical' ? 0 : 3)
    for (const rule of extras[index]) expect(prompts[index]).toContain(rule)
    const old = prompts[index].split('\n').filter(line => !extras[index].includes(line)).join('\n')
    expect(digest(old)).toBe(legacy.systemHashes[index])
  }
  const retainedInputs = legacy.requests.map((messages, index) => estimateChatActionRequestInputV1(
    messages.map((message, at) => ({...message, ...(at === 0 ? {content: prompts[index]} : {})})) as ChatMessage[]))
  expect(retainedInputs.reduce((sum, tokens) => sum + tokens, 0)).toBeLessThanOrEqual(generated.snapshot.contract.budget.maxInputTokens)
  expect(generated.snapshot.contract.budget).toMatchObject({maxModelCalls: 2, maxInputTokens: 40000, maxAttemptsPerStep: 1})
  expect(chatInquiryEvidenceVersionForContractV1(generated.snapshot.contract)).toBe(4)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('keeps a sparse but structurally valid background unadopted after the independent review rejects its development', async () => {
  const f = await prepare(), before = await readProductRuntimeState(f.sessionId)
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: async () => {
    calls++; return JSON.stringify(sparse)
  }, runReviewAI: async messages => {
    calls++; expect(messages[0].content).toContain('不能替候选补写条件'); return JSON.stringify(review(false))
  }})).rejects.toThrow('语义审查未通过')
  db.close(); await db.open()
  const snapshot = await readInstanceAgentRunV1(f.scope, runId)
  expect(snapshot.projection.state).toBe('failed')
  expect((await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'raw-response').map(a => a.content))
    .toEqual(expect.arrayContaining([JSON.stringify(sparse), JSON.stringify(review(false))]))
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(calls).toBe(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('adopts reviewed current conditions through the existing state transaction without adding player actions or revealing old secrets', async () => {
  const f = await prepare(), before = await readProductRuntimeState(f.sessionId)
  const draft: ChatSituationDraftV1 = {...structuredClone(sparse), newFacts: [...structuredClone(sparse.newFacts),
    {factKey: 'notice', kind: 'object', text: '门内的旧告示写着：入夜后由当值守卫隔门核对通行单，告示旁有能从门内使用的小递物口。',
      audienceKeys: ['player', 'guard'], evidenceFactKeys: ['road'], seedExcerpt: '门边有一块未写定细节的旧告示'}],
  possibilities: [{actorKey: 'guard', text: '可按告示隔门询问通行单；是否有人递来及其内容仍待实际互动。', evidenceFactKeys: ['notice', 'knocking']}]}
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), runAI: async () => JSON.stringify(draft), runReviewAI: async () => JSON.stringify(review(true))})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  db.close(); await db.open()
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.messages).toEqual(before.interaction!.messages)
  expect(after.interaction!.chatNarrative!.situation.facts.find(fact => fact.factKey === 'secret')).toEqual(before.interaction!.chatNarrative!.situation.facts.find(fact => fact.factKey === 'secret'))
  expect(after.interaction!.chatNarrative!.situation.facts.find(fact => fact.factKey === 'notice')?.text).toBe(draft.newFacts[1].text)
  expect(after.interaction!.chatNarrative!.situation.possibilities).toEqual(expect.arrayContaining(draft.possibilities.map(p => expect.objectContaining(p))))
})

it('accepts only the exact new producer/reviewer pair for the existing inquiry evidence', () => {
  const bindings = (producer: string, reviewer: string) => ({executionBindings: [
    {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-situation-construction', promptVersion: producer},
    {stepId: 'interaction:situation-review', skillId: 'character.chat-situation-review', promptVersion: reviewer},
  ]})
  expect(chatInquiryEvidenceVersionForContractV1(bindings('chat-situation-construction-v19', 'chat-situation-review-v18'))).toBe(4)
  for (const [producer, reviewer] of [['chat-situation-construction-v19', 'chat-situation-review-v17'], ['chat-situation-construction-v18', 'chat-situation-review-v18']]) {
    expect(() => chatInquiryEvidenceVersionForContractV1(bindings(producer, reviewer))).toThrow('不一致')
  }
  expect(chatInquiryEvidenceVersionForContractV1(bindings('chat-situation-construction-v20', 'chat-situation-review-v19'))).toBe(5)
  expect(chatSituationDevelopmentGenerationRulesV1('chat-situation-construction-v22')).toEqual([])
  expect(chatSituationDevelopmentReviewRulesV1('chat-situation-review-v20')).toEqual([])
})
