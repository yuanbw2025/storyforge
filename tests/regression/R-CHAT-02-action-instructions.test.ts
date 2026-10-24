import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import retained343 from '../fixtures/character-chat-input-budget-v343.json'
import retained349 from '../fixtures/character-chat-input-budget-v349.json'
import {chatConsolidatedActionPromptV1, CHAT_CONSOLIDATED_ACTION_PRODUCER_V1 as current} from '../../src/lib/character-interaction/action-instructions'
import {chatActionRequestOptionsV1} from '../../src/lib/character-interaction/action-output-contract'
import {estimateChatActionRequestInputV1} from '../../src/lib/character-interaction/action-choice-input-budget'
import {chatActionContextVersionsV1} from '../../src/lib/character-interaction/context-selection'
import {chatActionChoiceVersionForContractV1} from '../../src/lib/character-interaction/action-choice-budget'
import {assertChatControlHandoffBindingsV1} from '../../src/lib/character-interaction/control-handoff-wire'
import * as skills from '../../src/lib/agent/skill-registry'
import * as runtime from '../../src/lib/character-interaction/runtime'
import {db} from '../../src/lib/db/schema'
import {seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture, chatActionReviewOutputFixture} from '../helpers/chat-narrative-fixture'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import type {ChatMessage} from '../../src/lib/types'
import type {ChatRequestOptions} from '../../src/lib/ai/client'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
type Envelope = ChatMessage[] | {messages: ChatMessage[]; requestOptions?: ChatRequestOptions}
function messagesOf(request: Envelope) {return Array.isArray(request) ? request : request.messages}
function viewOf(messages: ChatMessage[]): runtime.InteractionVisibilityView {
  const lines = messages[1].content.split('\n'), chatNarrative = JSON.parse(lines.find(line => line.startsWith('{"situationKey"'))!)
  const {relationships} = JSON.parse(lines.find(line => line.startsWith('{"relationships"'))!)
  const participantKey = lines.find(line => line.startsWith('【角色互动视角】'))!.split('key=')[1].split('｜')[0]
  return {chatNarrative, relationships, participantKey} as runtime.InteractionVisibilityView
}
function replacement(messages: ChatMessage[]) {
  const example = messages[0].content.split('\n').find(line => line.startsWith('严格输出 JSON：'))!.slice('严格输出 JSON：'.length)
  return chatConsolidatedActionPromptV1(viewOf(messages), ['player', 'participant.001'], example)
}

it.each([['V343', retained343], ['V349', retained349]] as const)('keeps the complete %s inputs and gains usable headroom without increasing the hard budget', (label, retained) => {
  let before = 0, after = 0
  for (const [stepId, entry] of Object.entries(retained.requests)) {
    const request = entry.request as unknown as Envelope, messages = messagesOf(request)
    const options = Array.isArray(request) ? undefined : request.requestOptions
    const original = estimateChatActionRequestInputV1(messages, options)
    expect(original).toBe(retained.expectedOriginalEstimates[stepId as keyof typeof retained.expectedOriginalEstimates])
    before += original
    const next = structuredClone(messages)
    if (stepId === 'interaction:runtime-candidate') next[0].content = replacement(messages)
    expect(next.slice(1)).toEqual(messages.slice(1))
    if (stepId !== 'interaction:runtime-candidate') expect(next).toEqual(messages)
    after += estimateChatActionRequestInputV1(next, stepId === 'interaction:runtime-candidate' ? chatActionRequestOptionsV1(current, 'codex') : options)
  }
  expect(retained.inputBudget).toBe(56000)
  expect(after).toBeLessThan(53000)
  expect(before - after).toBeGreaterThan(3000)
  process.stdout.write(JSON.stringify({case: label, before, after, saved: before - after, margin: retained.inputBudget - after}) + '\n')
})

it('keeps the complete transport schema, reader, reviewer and explicit three-call binding', () => {
  expect(chatActionRequestOptionsV1(current, 'codex')).toEqual(chatActionRequestOptionsV1('chat-narrative-action-v67', 'codex'))
  expect(chatActionRequestOptionsV1(current, 'agnes')).toEqual(chatActionRequestOptionsV1(current, 'codex'))
  expect(chatActionContextVersionsV1(current)).toEqual({readerVersion: 'chat-narrative-runtime-view-v18', retrievalVersion: 'chat-relevance-v14'})
  const binding = (producer = current, reviewer = 'chat-narrative-action-review-v41', choice = producer) => ({executionBindings: [
    {stepId: 'interaction:action-choice', skillId: 'character.chat-narrative-action', promptVersion: choice},
    {stepId: 'interaction:runtime-candidate', skillId: 'character.chat-narrative-action', promptVersion: producer},
    {stepId: 'interaction:action-review', skillId: 'character.chat-narrative-action-review', promptVersion: reviewer},
  ], budget: {maxModelCalls: 3, maxAttemptsPerStep: 1}})
  expect(chatActionChoiceVersionForContractV1(binding())).toBe(1)
  expect(() => assertChatControlHandoffBindingsV1(binding())).not.toThrow()
  for (const invalid of [binding('chat-narrative-action-v70'), binding(current, 'chat-narrative-action-review-v40'), binding(current, 'chat-narrative-action-review-v41', 'chat-narrative-action-v67')]) {
    expect(() => chatActionChoiceVersionForContractV1(invalid)).toThrow()
    expect(() => assertChatControlHandoffBindingsV1(invalid)).toThrow()
  }
})

const action = {kind: 'speak', text: '你记得最后在哪儿见过铜印吗？', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard'], waitingForPlayer: true,
  newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
async function start() {
  const f = await seedChatNarrativeRuntimeFixture({onlyGuard: true}), version = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'instruction-fixture', baseSequence: version.sequence, baseStateHash: version.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}

it('renders the saved v67 complete system request byte for byte through the production harness', async () => {
  const originalSkill = skills.getAgentSkillV1, originalView = runtime.buildInteractionContextWindow
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action' ? {...originalSkill(id), promptVersion: 'chat-narrative-action-v67'} : id === 'character.chat-narrative-action-review' ? {...originalSkill(id), promptVersion: 'chat-narrative-action-review-v41'} : originalSkill(id))
  vi.spyOn(runtime, 'buildInteractionContextWindow').mockImplementation((...args) => ({...originalView(...args), ...retained349.promptView}) as runtime.InteractionContextWindow)
  const f = await start()
  const saved = retained349.requests['interaction:runtime-candidate'].request.messages[0].content
  let observed = ''
  await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '原合同字节核验',
    runAI: withChatActionChoiceFixture(async messages => {observed = messages[0].content; return JSON.stringify(action)}), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  expect(observed.replace('["player","guard"]', '["player","participant.001"]')).toBe(saved)
})

it.each(['chat-narrative-action-v68', 'chat-narrative-action-v69'].flatMap(producer => [true, false].map(accepted => ({producer, accepted}))))('keeps $producer independent review acceptance=$accepted in control of adoption and durable recovery', async ({producer, accepted}) => {
  const originalSkill = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action' ? {...originalSkill(id), promptVersion: producer} : id === 'character.chat-narrative-action-review' ? {...originalSkill(id), promptVersion: 'chat-narrative-action-review-v41'} : originalSkill(id))
  const f = await start(), before = await readProductRuntimeState(f.sessionId), calls: string[] = []
  let runId = 0
  const request = {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '核对原审查与采用边界', onRunCreated: (id: number) => {runId = id},
    runAI: withChatActionChoiceFixture(async (messages: ChatMessage[]) => {calls.push(messages[0].content); return JSON.stringify(action)}),
    runReviewAI: async (messages: ChatMessage[]) => {calls.push(messages[0].content); const review = chatActionReviewOutputFixture()
      if (!accepted) {const check = review.checks.find(c => c.check === 'meaningful-direction')!; check.passed = false; check.reason = '工程拒绝夹具，不是模型语义成绩'}
      return JSON.stringify(review)
    }}
  if (accepted) {
    const generated = await generateInteractionRuntimeCandidateV1(request)
    expect(generated.snapshot.contract.budget).toMatchObject({maxModelCalls: 3, maxInputTokens: 56000, maxOutputTokens: 14000, maxAttemptsPerStep: 1})
    expect(generated.snapshot.contract.executionBindings?.map(b => b.promptVersion)).toEqual([producer, producer, 'chat-narrative-action-review-v41'])
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
    db.close(); await db.open()
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.interaction!.messages.at(-1)?.text).toBe(action.text)
    expect(after.interaction!.chatNarrative!.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
  } else {
    await expect(generateInteractionRuntimeCandidateV1(request)).rejects.toThrow('语义审查未通过')
    db.close(); await db.open()
    expect((await readInstanceAgentRunV1(f.scope, runId)).projection.state).toBe('failed')
    await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  }
  expect(calls).toHaveLength(2)
  expect(calls[0]).toContain('【选择与推进】')
  expect(calls[0]).toContain('【输出与原文证据】')
})
