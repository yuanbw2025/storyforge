import {z} from 'zod'
import type {ChatResult} from '../ai/client'
import {estimateTokens} from '../ai/context-budget'
import {hashCanonicalValue} from '../agent/run/hash'
import type {AgentRunSnapshotV1} from '../agent/run/event-store'
import {readAgentRunArtifactExactV1, recordAgentRunArtifactV1} from '../memory/artifact-store'
import type {AIConfig, WorkspaceScope} from '../types'
import {chatActionChoiceVersionForContractV1} from './action-choice-budget'
import {boundedChatOutputTokensV1} from './action-output-contract'

export const CHAT_ACTION_OUTPUT_BUDGET_CRITERION_V1 = 'runtime.action-output-budget-v1'
const receiptSchema = z.object({
  schema: z.literal('storyforge.chat-action-output-budget'), version: z.literal(1),
  stepId: z.string().min(1), bindingHash: z.string().regex(/^[a-f0-9]{64}$/), outputHash: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.string().min(1), model: z.string().min(1), requestedOutputTokens: z.number().int().positive(),
  transportLimit: z.enum(['not-sent', 'requested-unverified', 'test-adapter']),
  usage: z.object({inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative()}).strict().nullable(),
  estimatedVisibleOutputTokens: z.number().int().nonnegative(),
}).strict()

function fail(message: string): never {throw new Error(`[chat-action-budget] ${message}`)}

/** A new frozen acceptance criterion opts in. Historical completed runs retain
 * their original contract and are never relabelled as measured output runs. */
export function hasChatActionOutputBudgetV1(snapshot: AgentRunSnapshotV1): boolean {
  const enabled = snapshot.contract.acceptance.some(item => item.id === CHAT_ACTION_OUTPUT_BUDGET_CRITERION_V1 && item.required)
  if (enabled && chatActionChoiceVersionForContractV1(snapshot.contract) !== 1) fail('输出预算缺少选择合同')
  return enabled
}

/** Called after retaining the raw response, before parsing or any next model
 * call. This is application-side admission, not a provider generation cap.
 * Missing/invalid usage remains visible; native Codex needs its actual receipt
 * because visible-text estimates cannot bound hidden reasoning consumption. */
export async function recordChatActionOutputBudgetV1(input: {
  scope: WorkspaceScope; snapshot: AgentRunSnapshotV1; stepId: string; output: string
  result: ChatResult; aiConfig?: AIConfig; injected: boolean
}): Promise<AgentRunSnapshotV1> {
  const {snapshot, stepId} = input
  if (!hasChatActionOutputBudgetV1(snapshot)) return snapshot
  const binding = snapshot.contract.executionBindings?.find(item => item.stepId === stepId)
  const requested = snapshot.events.find(event => event.type === 'model.requested' && event.payload.stepId === stepId)
  if (binding?.version !== 2 || requested?.type !== 'model.requested') fail('缺少原输出预算绑定')
  const provider = input.injected ? 'test-adapter' : input.aiConfig?.provider ?? fail('缺少提供商')
  const model = input.injected ? 'injected' : input.aiConfig?.model ?? fail('缺少模型')
  const usage = input.result.usage
  const receipt = {
    schema: 'storyforge.chat-action-output-budget', version: 1, stepId,
    bindingHash: requested.payload.bindingHash, outputHash: await hashCanonicalValue(input.output), provider, model,
    requestedOutputTokens: boundedChatOutputTokensV1(input.injected ? undefined : input.aiConfig?.maxTokens, binding.maxOutputTokens),
    transportLimit: input.injected ? 'test-adapter' : provider === 'codex' ? 'not-sent' : 'requested-unverified',
    usage: usage ? {inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens} : null,
    estimatedVisibleOutputTokens: estimateTokens(input.output),
  }
  return (await recordAgentRunArtifactV1({scope: input.scope, runId: snapshot.run.id, productRuntimeSessionId: snapshot.run.productRuntimeSessionId!,
    artifactKind: 'tool-result', content: JSON.stringify(receipt), stepId, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence})).snapshot
}

/** Reconstructs every actually dispatched step from exact response + usage
 * artifacts. A crash with no receipt is not permission to estimate, retry or
 * adopt; the original response remains available for diagnosis. */
export async function readChatActionOutputBudgetV1(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1) {
  if (!hasChatActionOutputBudgetV1(snapshot)) return null
  const calls: Array<{stepId: string; accountedOutputTokens: number; usageSource: 'provider' | 'visible-estimate'; receiptHash: string}> = []
  for (const requested of snapshot.events.filter(event => event.type === 'model.requested')) {
    if (requested.type !== 'model.requested') continue
    const {stepId, attempt} = requested.payload
    if (attempt !== 1 || calls.some(call => call.stepId === stepId)) fail('输出预算存在重复调用')
    const binding = snapshot.contract.executionBindings?.find(item => item.stepId === stepId)
    if (binding?.version !== 2) fail('缺少步骤输出上限')
    const rawEvents = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.stepId === stepId
      && event.payload.attempt === attempt && event.payload.artifactKind === 'raw-response')
    const responded = snapshot.events.filter(event => event.type === 'model.responded' && event.payload.stepId === stepId && event.payload.attempt === attempt)
    if (rawEvents.length !== 1 || rawEvents[0].type !== 'evidence.artifact.recorded'
      || responded.length !== 1 || responded[0].type !== 'model.responded' || responded[0].sequence <= requested.sequence
      || rawEvents[0].sequence <= responded[0].sequence) fail('输出结果未知或原响应证据不完整；不会继续调用')
    const output = await readAgentRunArtifactExactV1({projectId: scope.projectId, artifactKind: 'raw-response', contentHash: rawEvents[0].payload.contentHash})
    const outputHash = await hashCanonicalValue(output)
    if (responded[0].payload.outputHash !== outputHash) fail('原响应与输出预算不一致')
    const receipts = []
    for (const event of snapshot.events) {
      if (event.type !== 'evidence.artifact.recorded' || event.payload.stepId !== stepId || event.payload.attempt !== attempt || event.payload.artifactKind !== 'tool-result') continue
      const value = JSON.parse(await readAgentRunArtifactExactV1({projectId: scope.projectId, artifactKind: 'tool-result', contentHash: event.payload.contentHash}))
      if (value?.schema === 'storyforge.chat-action-output-budget') receipts.push({event, value})
    }
    if (receipts.length !== 1) fail('缺少唯一的输出用量凭据；保留原结果，不会重发或采用')
    const {event, value} = receipts[0], parsed = receiptSchema.safeParse(value)
    if (!parsed.success) fail('输出用量凭据无效')
    const receipt = parsed.data
    const primary = snapshot.contract.executionBindings!.find(item => item.stepId === 'interaction:runtime-candidate')!
    const {stepId: _step, ...executionBinding} = primary
    if (event.sequence <= rawEvents[0].sequence || receipt.stepId !== stepId || receipt.bindingHash !== requested.payload.bindingHash
      || receipt.outputHash !== outputHash || receipt.estimatedVisibleOutputTokens !== estimateTokens(output)
      || receipt.requestedOutputTokens > binding.maxOutputTokens
      || snapshot.contract.runtimeBindingHash !== await hashCanonicalValue({executionBinding,
        modelIdentity: {provider: receipt.provider, model: receipt.model, transport: 'chat-v1'}})
      || receipt.transportLimit !== (receipt.provider === 'test-adapter' ? 'test-adapter' : receipt.provider === 'codex' ? 'not-sent' : 'requested-unverified')) fail('输出用量凭据与原请求不一致')
    if (receipt.provider === 'codex' && !receipt.usage) fail('Codex 未返回实际输出用量；保留响应，停止后续调用及采用')
    if (receipt.usage && receipt.usage.totalTokens < receipt.usage.inputTokens + receipt.usage.outputTokens) fail('提供商用量合计无效')
    const accountedOutputTokens = Math.max(receipt.estimatedVisibleOutputTokens, receipt.usage?.outputTokens ?? 0)
    calls.push({stepId, accountedOutputTokens, usageSource: receipt.usage ? 'provider' : 'visible-estimate', receiptHash: event.payload.contentHash})
    if (accountedOutputTokens > receipt.requestedOutputTokens) fail(`本步骤输出用量 ${accountedOutputTokens} tokens 超出 ${receipt.requestedOutputTokens} 预算；原响应已保留，停止后续调用及采用`)
  }
  const accountedOutputTokens = calls.reduce((sum, call) => sum + call.accountedOutputTokens, 0)
  if (calls.length > snapshot.contract.budget.maxModelCalls || accountedOutputTokens > snapshot.contract.budget.maxOutputTokens) fail('累计输出超出冻结预算；原响应已保留，停止后续调用及采用')
  return {version: 1 as const, calls, accountedOutputTokens, maximumOutputTokens: snapshot.contract.budget.maxOutputTokens}
}
