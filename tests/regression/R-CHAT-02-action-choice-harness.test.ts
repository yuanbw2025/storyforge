import {chatActionOutcomeFixture, chatActionChoiceFixture} from '../helpers/chat-action-outcome'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import * as ai from '../../src/lib/ai/client'
import * as harness from '../../src/lib/character-interaction/harness'
import * as choiceEvidence from '../../src/lib/character-interaction/action-choice-evidence'
import * as runStore from '../../src/lib/agent/run/event-store'
import {assertChatActionChoiceInputBudgetV1, estimateChatActionRequestInputV1, readChatActionChoiceInputBudgetV1} from '../../src/lib/character-interaction/action-choice-input-budget'
import {estimateTokens} from '../../src/lib/ai/context-budget'
import {CHAT_ACTION_OUTPUT_BUDGET_CRITERION_V1, readChatActionOutputBudgetV1} from '../../src/lib/character-interaction/action-choice-output-budget'
import {CHAT_ACTION_TERMINAL_VERIFIER_V2, readChatActionTerminalReceiptV1} from '../../src/lib/character-interaction/action-terminal-receipt'
import {createVerificationReceiptV1, verifyVerificationReceiptIntegrityV1} from '../../src/lib/agent/run/verification-receipt'
import {useCharacterInteractionPlayerStore as store} from '../../src/stores/character-interaction-player'
import {appendAgentRunEventV1, readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1} from '../../src/lib/agent/run/checkpoint'
import {readAgentRunArtifactExactV1, recordAgentRunArtifactV1} from '../../src/lib/memory/artifact-store'
import {assembleContext} from '../../src/lib/registry/assemble-context'
import {adoptInteractionRuntimeCandidateV1, cancelInteractionRuntimeRunV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeActionV1} from '../../src/lib/character-interaction/harness'
import {CHAT_ACTION_CHOICE_CHECKPOINT_V1, chooseRuntimeChatActionV1} from '../../src/lib/character-interaction/action-choice-harness'
import {CHAT_ACTION_CHOICE_STEP_V1} from '../../src/lib/character-interaction/action-choice-contract'
import {branchProductRuntimeSession, commitChatNarrativeAction, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {canonicalStringify, hashCanonicalValue} from '../../src/lib/agent/run/hash'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {readChatRunProgressV1} from '../../src/lib/character-interaction/run-progress'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import type {ChatMessage} from '../../src/lib/types'

const originalSkill = skills.getAgentSkillV1
const realResumeAction = resumeChatNarrativeActionV1
const createRun = runStore.createAgentRunV1
const choice = {directions: [{id: 'ask', action: '询问铜印最后出现的位置', evidenceFactKeys: ['lost'], evidenceMessageIds: [], changes: '澄清仍未得知的地点，不预定玩家知道答案',
  playerDependency: '玩家是否愿意提供线索', unconfirmedConditions: [], kind: 'question'}], selectedId: 'ask', decisionSummary: '先提出与未解决线索有关的问题。'}
const action = {kind: 'speak', text: '你记得最后一次见到铜印的地方吗？', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
beforeEach(async () => {
  expect(originalSkill('character.chat-narrative-action').promptVersion).toBe('chat-narrative-action-v72')
  db.close(); await db.delete(); await db.open()
})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function start(directorBudget = 20) {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget}), version = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: version.sequence,
    baseStateHash: version.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
function input(f: Awaited<ReturnType<typeof start>>) {
  const calls: ChatMessage[][] = [], reviews = vi.fn(async () => JSON.stringify(chatActionReviewOutputFixture()))
  return {calls, reviews, request: {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
    objective: '由角色在自身可知范围选择并表达下一步', runAI: async (messages: ChatMessage[]) => {
      calls.push(messages)
      return JSON.stringify(messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? chatActionChoiceFixture(messages, choice) : chatActionOutcomeFixture(messages, action))
    }, runReviewAI: reviews}}
}
async function current(f: Awaited<ReturnType<typeof start>>) {
  const run = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  return readInstanceAgentRunV1(f.scope, run!.id!)
}

it('retains the full terminal receipt with actual budget evidence and returns it unchanged on repeated adoption', async () => {
  const f = await start(), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const receipt = (await readChatActionTerminalReceiptV1(f.scope, done.snapshot))!
  expect(await verifyVerificationReceiptIntegrityV1(receipt)).toBe(true)
  expect(receipt.receiptHash).toBe(done.receiptHash)
  expect(receipt.verifierSetVersion).toBe(CHAT_ACTION_TERMINAL_VERIFIER_V2)
  const output = (await readChatActionOutputBudgetV1(f.scope, done.snapshot))!
  expect(receipt.criteria.find(item => item.id === CHAT_ACTION_OUTPUT_BUDGET_CRITERION_V1)?.evidenceRefs).toEqual(output.calls.map(call => `artifact:${call.receiptHash}`))
  const repeated = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: done.snapshot.run.id})
  expect(repeated.snapshot.projection.lastSequence).toBe(done.snapshot.projection.lastSequence)
  expect(await readChatActionTerminalReceiptV1(f.scope, repeated.snapshot)).toEqual(receipt)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
})

it('reuses the exact retained terminal receipt after an interruption without replaying the adopted action or models', async () => {
  const f = await start(), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id,
    onDurableBoundary: name => {if (name === 'terminal-receipt.recorded') throw Error('host-interrupted')}})).rejects.toThrow('host-interrupted')
  const saved = await current(f), receipt = await readChatActionTerminalReceiptV1(f.scope, saved)
  expect(saved.projection.state).toBe('verifying')
  const state = await readProductRuntimeState(f.sessionId)
  db.close(); await db.open()
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.run.id})
  expect(done.receiptHash).toBe(receipt!.receiptHash)
  expect(await readChatActionTerminalReceiptV1(f.scope, done.snapshot)).toEqual(receipt)
  expect(done.snapshot.events.filter(event => event.type === 'runtime.candidate.adopted')).toHaveLength(1)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
})

it.each(['verifying', 'completed'] as const)('does not recreate missing terminal receipt evidence in a %s run', async status => {
  const f = await start(), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  const adopt = () => adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  if (status === 'verifying') await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id,
    onDurableBoundary: name => {if (name === 'terminal-receipt.recorded') throw Error('host-interrupted')}})).rejects.toThrow('host-interrupted')
  else await adopt()
  const saved = await current(f), state = await readProductRuntimeState(f.sessionId)
  const row = (await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()).find(a => a.content?.includes('storyforge.chat-action-terminal-receipt'))!
  await db.agentRunArtifacts.delete(row.id!)
  await expect(adopt()).rejects.toThrow()
  expect((await current(f)).projection).toEqual(saved.projection)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
})

it('rejects conflicting retained terminal receipts without signing a different completion', async () => {
  const f = await start(), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id,
    onDurableBoundary: name => {if (name === 'terminal-receipt.recorded') throw Error('host-interrupted')}})).rejects.toThrow('host-interrupted')
  const saved = await current(f), original = (await readChatActionTerminalReceiptV1(f.scope, saved))!
  const {receiptHash: _hash, ...body} = original
  const other = await createVerificationReceiptV1({...body, postStateHash: 'f'.repeat(64)})
  await recordAgentRunArtifactV1({scope: f.scope, runId: saved.run.id, productRuntimeSessionId: f.sessionId, artifactKind: 'tool-result',
    content: JSON.stringify({schema: 'storyforge.chat-action-terminal-receipt', version: 1, receipt: other}), expectedLastSequence: saved.projection.lastSequence})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.run.id})).rejects.toThrow('不唯一')
  expect((await current(f)).projection.state).toBe('verifying')
})

it('preserves the original terminal verifier and receipt boundary for historical choice contracts', async () => {
  vi.spyOn(runStore, 'createAgentRunV1').mockImplementation(request => createRun({...request, contract: {...request.contract,
    verificationPlan: request.contract.verificationPlan.map(plan => ({...plan, verifier: 'interaction-runtime-terminal-v1'}))}}))
  const f = await start(), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(await readChatActionTerminalReceiptV1(f.scope, done.snapshot)).toBeNull()
  expect((await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: done.snapshot.run.id})).receiptHash).toBe(done.receiptHash)
  expect((await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()).some(row => row.content?.includes('storyforge.chat-action-terminal-receipt'))).toBe(false)
})

function codexBudgetInput(f: Awaited<ReturnType<typeof start>>, outputTokens: number[], missingAt = -1) {
  vi.spyOn(navigator, 'locks', 'get').mockReturnValue({request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({})} as unknown as LockManager)
  let index = 0
  const transport = vi.spyOn(ai, 'chat').mockImplementation(async (_messages, _config, _meta, _signal, result) => {
    const i = index++, tokens = outputTokens[i]
    if (i !== missingAt && result) result.usage = {inputTokens: 500, outputTokens: tokens, totalTokens: 500 + tokens}
    return JSON.stringify(chatActionOutcomeFixture(_messages, chatActionChoiceFixture(_messages, [choice, action, chatActionReviewOutputFixture()][i])))
  })
  const {runAI: _runAI, runReviewAI: _runReviewAI, ...request} = input(f).request
  return {transport, request: {...request, aiConfig: {provider: 'codex' as const, model: 'budget-test', baseUrl: '/storyforge/local-codex/v1', apiKey: '', maxTokens: 0, temperature: 0}}}
}

it.each([0, 1, 2])('retains an over-budget Codex response at step %i and never dispatches the next step or adopts', async index => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), tokens = [100, 100, 100]
  tokens[index] = [2000, 4000, 8000][index] + 1
  const run = codexBudgetInput(f, tokens)
  await expect(generateInteractionRuntimeCandidateV1(run.request)).rejects.toThrow('超出')
  expect(run.transport).toHaveBeenCalledTimes(index + 1)
  const saved = await current(f)
  expect(saved.projection.state).toBe('failed')
  expect(saved.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')).toHaveLength(index + 1)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('accepts the exact three-step output budget, preserves provider accounting and freezes the new criterion', async () => {
  const f = await start(), run = codexBudgetInput(f, [2000, 4000, 8000])
  const generated = await generateInteractionRuntimeCandidateV1(run.request)
  const budget = (await readChatActionOutputBudgetV1(f.scope, generated.snapshot))!
  expect(budget.accountedOutputTokens).toBe(14000)
  expect(budget.calls.map(call => call.usageSource)).toEqual(['provider', 'provider', 'provider'])
  expect(generated.snapshot.contract.acceptance).toContainEqual({id: CHAT_ACTION_OUTPUT_BUDGET_CRITERION_V1, kind: 'deterministic-check', required: true})
  expect((await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).snapshot.projection.state).toBe('completed')
  expect(run.transport).toHaveBeenCalledTimes(3)
})

it('stops after a missing native Codex usage receipt without pretending visible text bounds reasoning tokens', async () => {
  const f = await start(), run = codexBudgetInput(f, [100, 100, 100], 1)
  await expect(generateInteractionRuntimeCandidateV1(run.request)).rejects.toThrow('Codex 未返回实际输出用量')
  expect(run.transport).toHaveBeenCalledTimes(2)
  const saved = await current(f)
  expect(saved.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')).toHaveLength(2)
})

it('rechecks retained output after a host interruption instead of regenerating or spending a review call', async () => {
  const f = await start(), run = codexBudgetInput(f, [2001, 100, 100])
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: name => {if (name === 'raw-response.saved') throw Error('host-interrupted')}})).rejects.toThrow('host-interrupted')
  const saved = await current(f)
  await expect(resumeChatNarrativeActionV1({scope: f.scope, runId: saved.run.id, aiConfig: run.request.aiConfig})).rejects.toThrow('超出')
  expect(run.transport).toHaveBeenCalledTimes(1)
})

it('blocks adoption if a completed output receipt is missing while retaining the candidate and raw evidence', async () => {
  const f = await start(), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  const receipt = (await readChatActionOutputBudgetV1(f.scope, generated.snapshot))!.calls[0]
  await db.agentRunArtifacts.where('contentHash').equals(receipt.receiptHash).delete()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect((await readProductRuntimeState(f.sessionId)).lastSequence).toBe(generated.candidate.baseSequence)
  expect(run.calls).toHaveLength(2)
})

it('enforces the cumulative run output limit even when every step stays within its own limit', async () => {
  vi.spyOn(runStore, 'createAgentRunV1').mockImplementation(request => createRun({...request,
    contract: {...request.contract, budget: {...request.contract.budget, maxOutputTokens: 8999}}}))
  const f = await start(), run = codexBudgetInput(f, [2000, 3000, 4000])
  await expect(generateInteractionRuntimeCandidateV1(run.request)).rejects.toThrow('累计输出超出')
  expect(run.transport).toHaveBeenCalledTimes(3)
  expect((await current(f)).projection.state).toBe('failed')
})

it('keeps a user output limit below the frozen step allowance and retains the actual overspend', async () => {
  const f = await start(), run = codexBudgetInput(f, [1001, 100, 100])
  run.request.aiConfig.maxTokens = 1000
  await expect(generateInteractionRuntimeCandidateV1(run.request)).rejects.toThrow('超出 1000 预算')
  expect(run.transport).toHaveBeenCalledTimes(1)
})

it('rejects a duplicate usage receipt instead of choosing whichever receipt would pass', async () => {
  const f = await start(), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  const first = (await readChatActionOutputBudgetV1(f.scope, generated.snapshot))!.calls[0]
  const content = JSON.parse(await readAgentRunArtifactExactV1({projectId: f.scope.projectId, artifactKind: 'tool-result', contentHash: first.receiptHash}))
  const appended = await recordAgentRunArtifactV1({scope: f.scope, runId: generated.snapshot.run.id, productRuntimeSessionId: f.sessionId,
    stepId: first.stepId, attempt: 1, artifactKind: 'tool-result', content: JSON.stringify({...content, usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2}})})
  await expect(readChatActionOutputBudgetV1(f.scope, appended.snapshot)).rejects.toThrow('缺少唯一的输出用量凭据')
})

it('does not invent new output receipts or acceptance for historical contracts without the criterion', async () => {
  vi.spyOn(runStore, 'createAgentRunV1').mockImplementation(request => createRun({...request, contract: {...request.contract,
    acceptance: request.contract.acceptance.filter(item => item.id !== CHAT_ACTION_OUTPUT_BUDGET_CRITERION_V1),
    verificationPlan: request.contract.verificationPlan.map(item => ({...item, criterionIds: item.criterionIds.filter(id => id !== CHAT_ACTION_OUTPUT_BUDGET_CRITERION_V1)}))}}))
  const f = await start(), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  expect(await readChatActionOutputBudgetV1(f.scope, generated.snapshot)).toBeNull()
  expect((await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).snapshot.projection.state).toBe('completed')
})
async function resumeChoice(f: Awaited<ReturnType<typeof start>>, runAI = vi.fn(async () => {throw Error('must not dispatch')})) {
  const snapshot = await current(f)
  const event = snapshot.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.stepId === CHAT_ACTION_CHOICE_STEP_V1 && event.payload.artifactKind === 'context-packet')!
  if (event.type !== 'evidence.artifact.recorded') throw Error('no choice input')
  const packet = JSON.parse(await readAgentRunArtifactExactV1({projectId: f.scope.projectId, artifactKind: 'context-packet', contentHash: event.payload.contentHash}))
  const assembled = await assembleContext({projectId: f.scope.projectId, scope: f.scope, productRuntimeSessionId: f.sessionId,
    chatActionContextRunId: snapshot.run.id,
    worldGroupId: snapshot.run.worldGroupId ?? null, interactionParticipantKey: 'guard', sourceKeys: ['interactionRuntime'], inputBudgetMaxTokens: 16000})
  return chooseRuntimeChatActionV1({scope: f.scope, snapshot, participantKey: 'guard', assembled, actorMessages: packet.actorMessages, runAI})
}

it('runs choice, expression and review in one frozen run and adopts once with the three-unit allowance', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
  expect(run.calls[0][1]).toEqual(run.calls[1][1])
  expect(run.calls[1]).toHaveLength(3)
  expect(run.calls[1][2].content).toContain('未确认草稿')
  expect(run.calls[0][1].content).not.toContain('铜印藏在柜台')
  expect(generated.snapshot.contract.budget).toMatchObject({maxModelCalls: 3, maxInputTokens: 56000, maxOutputTokens: 14000, maxAttemptsPerStep: 1})
  expect(generated.snapshot.contract.executionBindings!.find(binding => binding.stepId === CHAT_ACTION_CHOICE_STEP_V1)).toMatchObject({maxOutputTokens: 2000, writeTargets: [], contextSourceKeys: ['interactionRuntime']})
  expect(generated.snapshot.events.filter(event => event.type === 'model.requested').map(event => event.payload.stepId)).toEqual([
    CHAT_ACTION_CHOICE_STEP_V1, 'interaction:runtime-candidate', 'interaction:action-review'])
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(JSON.parse(adopted.event!.payloadJson).actionChoiceVersion).toBe(1)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 3)
  expect((await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).event!.id).toBe(adopted.event!.id)
  expect(run.calls).toHaveLength(2)
})

it.each(['raw-response.saved', 'choice.saved'] as const)('recovers %s from original evidence without a second selection request', async point => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === point) throw Error('host-crash')}})).rejects.toThrow('host-crash')
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
  expect((await current(f)).projection.state).toBe('running')
  db.close(); await db.open()
  const noCall = vi.fn(async () => {throw Error('unexpected resend')})
  const resumed = await resumeChoice(f, noCall)
  expect(resumed.choice).toEqual(chatActionChoiceFixture(run.calls[0], choice)); expect(noCall).not.toHaveBeenCalled()
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(f.scope, resumed.snapshot.run.id, {owner: 'instance'})
  expect(checkpoint!.resumePayload).toMatchObject({kind: CHAT_ACTION_CHOICE_CHECKPOINT_V1, participantKey: 'guard', choiceHash: resumed.choiceHash})
  const again = await resumeChoice(f, noCall)
  expect(again.snapshot.projection.lastSequence).toBe(resumed.snapshot.projection.lastSequence)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('retains a requested-but-unknown selection and refuses both a resend and a fresh same-head run', async () => {
  const f = await start(), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === 'model.requested') throw Error('host-lost')}})).rejects.toThrow('host-lost')
  expect(run.calls).toHaveLength(0)
  await expect(resumeChoice(f)).rejects.toThrow('结果未知')
  await expect(resumeChatNarrativeActionV1({scope: f.scope, runId: (await current(f)).run.id,
    runAI: run.request.runAI, runReviewAI: run.reviews})).rejects.toThrow('结果未知')
  await expect(generateInteractionRuntimeCandidateV1(run.request)).rejects.toThrow('已有行动运行')
  expect(run.calls).toHaveLength(0)
  expect((await current(f)).events.filter(event => event.type === 'model.requested')).toHaveLength(1)
  const snapshot = await current(f), budget = await readChatActionChoiceInputBudgetV1(f.scope, snapshot)
  expect(budget!.calls).toHaveLength(1)
  expect(budget!.estimatedInputTokens).toBeGreaterThan(0)
  await expect(assertChatActionChoiceInputBudgetV1({scope: f.scope, snapshot, stepId: CHAT_ACTION_CHOICE_STEP_V1,
    messages: [{role: 'user', content: '不能借恢复重置额度'}]})).rejects.toThrow('已经发送过请求')
})

it('retains malformed raw selection while preventing expression, review and adoption', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f), invalid = vi.fn(async () => '{"directions":[]}')
  await expect(generateInteractionRuntimeCandidateV1({...run.request, runAI: invalid})).rejects.toThrow('字段不完整')
  expect(invalid).toHaveBeenCalledTimes(1); expect(run.reviews).not.toHaveBeenCalled()
  const saved = await current(f)
  expect(saved.projection.state).toBe('failed')
  expect(saved.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response' && event.payload.stepId === CHAT_ACTION_CHOICE_STEP_V1)).toBe(true)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('refuses the new run before dispatch when only two scene units remain', async () => {
  const f = await start(2), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1(run.request)).rejects.toThrow('预算不足')
  expect(run.calls).toHaveLength(0); expect(run.reviews).not.toHaveBeenCalled()
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).count()).toBe(0)
})

// Lower the accepted contract before creation, never rewrite an existing run's
// hash or ledger. Recreate the isolated fixture after measuring its inputs;
// a cancelled same-head run intentionally cannot be dispatched again.
async function budgetBaseline() {
  const baseline = await start(), run = input(baseline)
  const generated = await generateInteractionRuntimeCandidateV1(run.request)
  const budget = (await readChatActionChoiceInputBudgetV1(baseline.scope, generated.snapshot))!
  db.close(); await db.delete(); await db.open()
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  return {f, before, budget}
}
function freezeInputLimit(maxInputTokens: number) {
  vi.spyOn(runStore, 'createAgentRunV1').mockImplementation(request => createRun({...request,
    contract: {...request.contract, budget: {...request.contract.budget, maxInputTokens}}}))
}

it.each([0, 1, 2])('stops before step %i when its complete request exceeds the remaining input budget by one', async index => {
  const {f, before, budget} = await budgetBaseline(), run = input(f)
  const limit = budget.calls.slice(0, index + 1).reduce((sum, call) => sum + call.estimatedInputTokens, 0) - 1
  freezeInputLimit(limit)
  await expect(generateInteractionRuntimeCandidateV1(run.request)).rejects.toThrow('完整请求累计预计需要')
  const saved = await current(f), consumed = (await readChatActionChoiceInputBudgetV1(f.scope, saved))!
  expect(saved.contract.budget.maxInputTokens).toBe(limit)
  expect(saved.events.filter(event => event.type === 'model.requested')).toHaveLength(index)
  expect(saved.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')).toHaveLength(index)
  // A rendered request exists for the stopped step but has not been sent.
  expect(saved.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'rendered-request')).toHaveLength(index + 1)
  expect(consumed.calls).toEqual(budget.calls.slice(0, index))
  expect(run.calls).toHaveLength(index); expect(run.reviews).not.toHaveBeenCalled()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('accepts the exact cumulative input limit and includes system text, objective and choice proposal', async () => {
  const {f, budget} = await budgetBaseline(), run = input(f)
  freezeInputLimit(budget.estimatedInputTokens)
  const generated = await generateInteractionRuntimeCandidateV1(run.request)
  const counted = (await readChatActionChoiceInputBudgetV1(f.scope, generated.snapshot))!
  expect(counted.estimatedInputTokens).toBe(counted.maximumInputTokens)
  expect(counted.calls[0].estimatedInputTokens).toBe(estimateChatActionRequestInputV1(run.calls[0]))
  expect(counted.calls[1].estimatedInputTokens).toBe(estimateChatActionRequestInputV1(run.calls[1]))
  expect(counted.calls[1].estimatedInputTokens).toBeGreaterThan(estimateChatActionRequestInputV1(run.calls[1].slice(0, 2)))
  expect(counted.calls[0].estimatedInputTokens).toBeGreaterThan(estimateTokens(run.calls[0][1].content))
  expect(run.calls[0][1].content).toContain(run.request.objective)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages.slice(-1)[0].text).toBe(action.text)
})

it('keeps prior input consumption after reopening and stops before an unaffordable review', async () => {
  const {f, before, budget} = await budgetBaseline(), run = input(f)
  freezeInputLimit(budget.estimatedInputTokens - 1)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {
    if (boundary === 'choice.saved') throw Error('host-crash')
  }})).rejects.toThrow('host-crash')
  const saved = await current(f)
  db.close(); await db.open()
  await expect(resumeChatNarrativeActionV1({scope: f.scope, runId: saved.run.id,
    runAI: run.request.runAI, runReviewAI: run.reviews})).rejects.toThrow('完整请求累计预计需要')
  const resumed = await current(f)
  expect(resumed.run.id).toBe(saved.run.id)
  expect((await readChatActionChoiceInputBudgetV1(f.scope, resumed))!.calls).toEqual(budget.calls.slice(0, 2))
  expect(run.calls).toHaveLength(2); expect(run.reviews).not.toHaveBeenCalled()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it.each(['missing', 'duplicate'] as const)('blocks adoption when review request budget evidence is %s', async damage => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  const generated = await generateInteractionRuntimeCandidateV1(run.request)
  const event = generated.snapshot.events.find(item => item.type === 'evidence.artifact.recorded'
    && item.payload.stepId === 'interaction:action-review' && item.payload.artifactKind === 'rendered-request')!
  if (event.type !== 'evidence.artifact.recorded') throw Error('missing fixture request')
  if (damage === 'missing') {
    await db.agentRunArtifacts.filter(row => row.projectId === f.scope.projectId && row.artifactKind === 'rendered-request'
      && row.contentHash === event.payload.contentHash).delete()
  } else {
    await recordAgentRunArtifactV1({scope: f.scope, runId: generated.snapshot.run.id, productRuntimeSessionId: f.sessionId,
      stepId: 'interaction:action-review', attempt: 1, artifactKind: 'rendered-request', content: JSON.stringify([{role: 'user', content: '不能用更小的输入替换已发送请求'}])})
  }
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
})

it('rejects stale retained choice evidence before resuming without executing the remaining steps', async () => {
  const f = await start(), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === 'choice.saved') throw Error('host-crash')}})).rejects.toThrow('host-crash')
  const version = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: version.sequence, baseStateHash: version.stateHash,
    kind: 'continue', sourceEventSequence: version.sequence})
  const after = await readProductRuntimeState(f.sessionId)
  await expect(resumeChoice(f)).rejects.toThrow()
  await expect(resumeChatNarrativeActionV1({scope: f.scope, runId: (await current(f)).run.id,
    runAI: run.request.runAI, runReviewAI: run.reviews})).rejects.toThrow()
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(after)
})

it('uses the frozen choice output cap and strict provider schema on the existing real transport boundary', async () => {
  vi.spyOn(navigator, 'locks', 'get').mockReturnValue({request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({})} as unknown as LockManager)
  const chat = vi.spyOn(ai, 'chat').mockImplementation(async messages => JSON.stringify(messages[0].content.startsWith('这是尚未发生的角色行动选择草稿')
    ? chatActionChoiceFixture(messages, choice) : JSON.stringify(messages).includes('本次持久化行动候选') ? chatActionReviewOutputFixture() : chatActionOutcomeFixture(messages, action)))
  const f = await start(), run = input(f)
  const {runAI: _runAI, runReviewAI: _runReviewAI, ...request} = run.request
  const generated = await generateInteractionRuntimeCandidateV1({...request, aiConfig: {provider: 'agnes', baseUrl: 'https://invalid.example/v1', model: 'agnes-2.5-flash', apiKey: 'fixture-only', temperature: .2, maxTokens: 9000}})
  expect(chat).toHaveBeenCalledTimes(3)
  expect(chat.mock.calls.map(call => call[1].maxTokens)).toEqual([2000, 4000, 8000])
  expect(chat.mock.calls[0][5]?.jsonSchema).toMatchObject({name: 'chat_action_choice_v4', strict: true})
  const counted = (await readChatActionChoiceInputBudgetV1(f.scope, generated.snapshot))!
  for (const [index, call] of chat.mock.calls.entries()) {
    expect(counted.calls[index].estimatedInputTokens).toBe(estimateChatActionRequestInputV1(call[0], call[5]))
  }
  expect(counted.calls[0].estimatedInputTokens).toBeGreaterThan(estimateChatActionRequestInputV1(chat.mock.calls[0][0]))
})

it.each(['context-packet', 'rendered-request', 'raw-response'] as const)('refuses adoption when the completed choice has lost its %s artifact', async kind => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  const generated = await generateInteractionRuntimeCandidateV1(run.request)
  const saved = generated.snapshot.events.find(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === CHAT_ACTION_CHOICE_STEP_V1 && event.payload.artifactKind === kind)!
  if (saved.type !== 'evidence.artifact.recorded') throw Error('missing fixture evidence')
  await db.agentRunArtifacts.filter(row => row.projectId === f.scope.projectId && row.artifactKind === kind && row.contentHash === saved.payload.contentHash).delete()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
})

it('does not accept a second choice response added after expression and review', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  const generated = await generateInteractionRuntimeCandidateV1(run.request)
  await recordAgentRunArtifactV1({scope: f.scope, runId: generated.snapshot.run.id, productRuntimeSessionId: f.sessionId,
    stepId: CHAT_ACTION_CHOICE_STEP_V1, attempt: 1, artifactKind: 'raw-response', content: JSON.stringify({...choice, decisionSummary: '后来替换的方向'})})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow('缺少唯一的 raw-response')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('blocks a direct command from turning only a saved choice into a reviewed story action', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === 'choice.saved') throw Error('host-crash')}})).rejects.toThrow('host-crash')
  const saved = await current(f), boundary = saved.contract.scope.runtime!
  await expect(commitChatNarrativeAction({sessionId: f.sessionId, baseSequence: boundary.baseSequence, baseStateHash: boundary.stateHash,
    commandId: `harness:${saved.run.id}:chat-narrative-action-candidate`, actorKey: 'guard', messageId: `message:harness:${saved.run.id}`,
    triggerSequence: before.interaction!.chatNarrative!.triggers.slice(-1)[0]!.requestedSequence, action: action as Parameters<typeof commitChatNarrativeAction>[0]['action'],
    review: {...chatActionReviewOutputFixture(), reviewedActionJson: canonicalStringify(action)}, actionChoiceVersion: 1,
    harnessRun: {id: saved.run.id, lastSequence: saved.projection.lastSequence}})).rejects.toThrow('原已审查候选不一致')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
})

it.each(['raw-response.saved', 'choice.saved'] as const)('continues expression and review after selection %s with exactly one selection request', async point => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === point) throw Error('host-crash')}})).rejects.toThrow('host-crash')
  const runId = (await current(f)).run.id
  db.close(); await db.open()
  const resumed = await resumeChatNarrativeActionV1({scope: f.scope, runId, runAI: run.request.runAI, runReviewAI: run.reviews})
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
  expect(resumed.snapshot.events.filter(event => event.type === 'model.requested').map(event => event.payload.stepId)).toEqual([
    CHAT_ACTION_CHOICE_STEP_V1, 'interaction:runtime-candidate', 'interaction:action-review'])
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages.slice(-1)[0].text).toBe(action.text)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 3)
})

it.each(['raw-response.saved', 'candidate.persisted'] as const)('reuses a retained expression after %s and reviews it once without regenerating either stage', async point => {
  const f = await start(), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionExpressionBoundary: boundary => {if (boundary === point) throw Error('host-crash')}})).rejects.toThrow('host-crash')
  expect(run.calls).toHaveLength(2); expect(run.reviews).not.toHaveBeenCalled()
  const runId = (await current(f)).run.id, noCall = vi.fn(async () => {throw Error('must not resend')})
  db.close(); await db.open()
  const resumed = await resumeChatNarrativeActionV1({scope: f.scope, runId, runAI: noCall, runReviewAI: run.reviews})
  const again = await resumeChatNarrativeActionV1({scope: f.scope, runId, runAI: noCall, runReviewAI: run.reviews})
  expect(again.candidate).toEqual(resumed.candidate)
  expect(resumed.snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(2)
  expect(noCall).not.toHaveBeenCalled(); expect(run.reviews).toHaveBeenCalledTimes(1)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
})

it('refuses an expression with an unknown outcome without resending or changing the saved run', async () => {
  const f = await start(), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionExpressionBoundary: boundary => {if (boundary === 'model.requested') throw Error('host-lost')}})).rejects.toThrow('host-lost')
  const saved = await current(f), before = await readProductRuntimeState(f.sessionId)
  await expect(resumeChatNarrativeActionV1({scope: f.scope, runId: saved.run.id, runAI: run.request.runAI, runReviewAI: run.reviews})).rejects.toThrow('表达调用结果未知')
  expect((await current(f)).projection.lastSequence).toBe(saved.projection.lastSequence)
  expect((await current(f)).projection.state).toBe('running')
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('keeps a saved selection recoverable when the expression version has changed', async () => {
  const f = await start(), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === 'choice.saved') throw Error('host-crash')}})).rejects.toThrow('host-crash')
  const saved = await current(f)
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action'
    ? {...originalSkill(id), promptVersion: 'chat-narrative-action-v44'} : originalSkill(id))
  await expect(resumeChatNarrativeActionV1({scope: f.scope, runId: saved.run.id, runAI: run.request.runAI, runReviewAI: run.reviews})).rejects.toThrow('表达配置或功能版本已变化')
  expect((await current(f)).projection.lastSequence).toBe(saved.projection.lastSequence)
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
})

it('does not continue a cancelled selection or implicitly start another run', async () => {
  const f = await start(), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === 'choice.saved') throw Error('host-crash')}})).rejects.toThrow('host-crash')
  const saved = await current(f), before = await readProductRuntimeState(f.sessionId)
  await cancelInteractionRuntimeRunV1({scope: f.scope, runId: saved.run.id})
  await expect(resumeChatNarrativeActionV1({scope: f.scope, runId: saved.run.id, runAI: run.request.runAI, runReviewAI: run.reviews})).rejects.toThrow('已停止')
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('retains semantic rejection after recovered expression and never adopts or silently retries it', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === 'choice.saved') throw Error('host-crash')}})).rejects.toThrow('host-crash')
  const saved = await current(f), review = chatActionReviewOutputFixture(); review.checks[0].passed = false
  run.reviews.mockResolvedValue(JSON.stringify(review))
  await expect(resumeChatNarrativeActionV1({scope: f.scope, runId: saved.run.id, runAI: run.request.runAI, runReviewAI: run.reviews})).rejects.toThrow('行动语义审查未通过')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: saved.run.id})).rejects.toThrow()
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it.each(['raw-response.saved', 'choice.saved'] as const)('shows %s as an explicit action continuation, not an adoptable reply, after reload', async point => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === point) throw Error('host-crash')}})).rejects.toThrow('host-crash')
  const runId = (await current(f)).run.id
  db.close(); await db.open()
  store.setState({busy: false, generatingRunId: null, scope: null, selectedSessionId: null})
  await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().pendingNarrativeActionRunIds).toEqual([runId])
  expect(store.getState().recoverableRunIds).toEqual([])
  expect(store.getState().pendingNarrativeReviewRunIds).toEqual([])
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
  vi.spyOn(harness, 'resumeChatNarrativeActionV1').mockImplementation(request => realResumeAction({...request, runAI: run.request.runAI, runReviewAI: run.reviews}))
  await store.getState().resumeNarrativeAction(runId, {} as never)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
  expect(store.getState().runtimeState.interaction!.messages.slice(-1)[0].text).toBe(action.text)
  expect(store.getState().runtimeState.interaction!.remainingDirectorBudget).toBe(before.interaction!.remainingDirectorBudget - 3)
  expect(store.getState().pendingNarrativeActionRunIds).toEqual([])
})

it('offers cancellation instead of adoption or another paid call for an unknown expression', async () => {
  const f = await start(), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionExpressionBoundary: boundary => {if (boundary === 'model.requested') throw Error('host-lost')}})).rejects.toThrow('host-lost')
  const runId = (await current(f)).run.id
  store.setState({busy: false, generatingRunId: null, scope: null, selectedSessionId: null})
  await store.getState().load(f.scope, null, f.sessionId)
  expect(store.getState().pendingNarrativeActionRunIds).toEqual([])
  expect(store.getState().recoverableRunIds).toEqual([])
  expect(store.getState().pendingNarrativeRunIds).toContain(runId)
  await expect(store.getState().resumeNarrativeAction(runId, {} as never)).rejects.toThrow('没有该可继续')
  await store.getState().cancelPendingRun(runId)
  expect((await current(f)).projection.state).toBe('cancelled')
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
})

it.each(['raw-response.saved', 'choice.saved'] as const)('preserves evidence but cancels the nonportable %s run on import without generating', async point => {
  const f = await start(), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === point) throw Error('host-crash')}})).rejects.toThrow('host-crash')
  const original = await current(f), projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).first())!
  const scope = {projectId, workId: session.workId, worldId: session.worldId}
  const imported = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).first())!
  expect(imported.status).toBe('cancelled')
  await expect(resumeChatNarrativeActionV1({scope, runId: imported.id!, runAI: run.request.runAI, runReviewAI: run.reviews})).rejects.toThrow('已停止')
  const saved = await readInstanceAgentRunV1(scope, imported.id!)
  const raw = saved.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.stepId === CHAT_ACTION_CHOICE_STEP_V1 && event.payload.artifactKind === 'raw-response')!
  if (raw.type !== 'evidence.artifact.recorded') throw Error('missing imported raw')
  expect(JSON.parse(await readAgentRunArtifactExactV1({projectId, artifactKind: 'raw-response', contentHash: raw.payload.contentHash}))).toEqual(chatActionChoiceFixture(run.calls[0], choice))
  expect((await current(f)).projection.lastSequence).toBe(original.projection.lastSequence)
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
})

it('keeps completed choice history through repeated backup import without re-adoption or duplicate allowance', async () => {
  const f = await start(), run = input(f), generated = await generateInteractionRuntimeCandidateV1(run.request)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const original = await readProductRuntimeState(f.sessionId)
  const terminalBody = (await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()).find(row => row.content?.includes('storyforge.chat-action-terminal-receipt'))!
  expect(terminalBody).toBeDefined()
  let projectId = f.scope.projectId
  for (let index = 0; index < 2; index++) {
    projectId = await importProjectJSON(await exportProjectJSON(projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).first())!
    const scope = {projectId, worldId: session.worldId, workId: session.workId}
    const saved = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).first())!
    expect((await readProductRuntimeState(session.id!)).interaction).toEqual(original.interaction)
    expect((await readChatContextInspectionV1(scope, session.id!, saved.id!)).available).toBe(true)
    const retained = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([projectId, 'tool-result', terminalBody.contentHash]).first()
    expect(retained?.content).toBe(terminalBody.content)
    store.setState({busy: false, generatingRunId: null, scope: null, selectedSessionId: null})
    await store.getState().load(scope, null, session.id!)
    expect(store.getState().pendingNarrativeActionRunIds).toEqual([])
    expect(store.getState().recoverableRunIds).toEqual([])
  }
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
})

it('branches story state without copying a pending choice or displaying its private proposal', async () => {
  const f = await start(), run = input(f)
  await expect(generateInteractionRuntimeCandidateV1({...run.request, onActionChoiceBoundary: boundary => {if (boundary === 'choice.saved') throw Error('host-crash')}})).rejects.toThrow('host-crash')
  const saved = await current(f), progress = await readChatRunProgressV1(f.scope, f.sessionId, saved.run.id)
  expect(progress.label).toBe('行动进度已保存，等待继续表达')
  expect(JSON.stringify(progress)).not.toContain(choice.directions[0].action)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: saved.contract.scope.runtime!.baseSequence, title: '选择前的分支'})
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(branch.id!).count()).toBe(0)
  expect((await readProductRuntimeState(branch.id!)).interaction!.messages).toEqual([])
  expect((await current(f)).projection.lastSequence).toBe(saved.projection.lastSequence)
  expect(run.calls).toHaveLength(1); expect(run.reviews).not.toHaveBeenCalled()
})

it('rejects a self-consistent replacement checkpoint that does not match the original expression', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  const generated = await generateInteractionRuntimeCandidateV1(run.request)
  if (generated.candidate.kind !== 'chat-narrative-action-candidate') throw Error('wrong fixture candidate')
  const changed = {...generated.candidate.action, text: '这是一条后来替换的回复。'}
  const {candidateHash: _oldHash, ...original} = generated.candidate
  const body = {...original, action: changed, review: {...original.review!, reviewedActionJson: canonicalStringify(changed)}}
  const candidate = {...body, candidateHash: await hashCanonicalValue(body)}
  const snapshot = await appendAgentRunEventV1({scope: f.scope, runId: generated.snapshot.run.id, productRuntimeSessionId: f.sessionId,
    expectedLastSequence: generated.snapshot.projection.lastSequence, type: 'candidate.persisted',
    payload: {stepId: 'interaction:runtime-candidate', attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: false}})
  await createAgentRunCheckpointV1({scope: f.scope, runId: snapshot.run.id, productRuntimeSessionId: f.sessionId,
    expectedLastSequence: snapshot.projection.lastSequence, resumePayload: candidate})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: snapshot.run.id})).rejects.toThrow('不是原选择、表达和审查的结果')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
})

it('rechecks cancellation in the command transaction after asynchronous choice proof has passed', async () => {
  const f = await start(), before = await readProductRuntimeState(f.sessionId), run = input(f)
  const generated = await generateInteractionRuntimeCandidateV1(run.request), verify = choiceEvidence.assertChatActionChoiceCommitEvidenceV1
  vi.spyOn(choiceEvidence, 'assertChatActionChoiceCommitEvidenceV1').mockImplementation(async request => {
    await verify(request)
    await cancelInteractionRuntimeRunV1({scope: f.scope, runId: generated.snapshot.run.id})
  })
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).rejects.toThrow('已取消、暂停或变化')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(run.calls).toHaveLength(2); expect(run.reviews).toHaveBeenCalledTimes(1)
})
