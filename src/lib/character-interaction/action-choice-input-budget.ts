import {estimateChatRequestOptionsTokens, type ChatRequestOptions} from '../ai/client'
import {estimateTokens} from '../ai/context-budget'
import {hashCanonicalValue} from '../agent/run/hash'
import type {AgentRunSnapshotV1} from '../agent/run/event-store'
import {readAgentRunArtifactExactV1} from '../memory/artifact-store'
import type {ChatMessage, WorkspaceScope} from '../types'
import {chatActionChoiceVersionForContractV1} from './action-choice-budget'
import {readChatActionOutputBudgetV1} from './action-choice-output-budget'

function fail(message: string): never {throw new Error(`[chat-action-budget] ${message}`)}

/** Same input estimate used by the client window guard. Includes all
 * system/user messages and schema options, not just registered source text.
 * This is an admission estimate, never a provider billing receipt. */
export function estimateChatActionRequestInputV1(messages: readonly ChatMessage[], options?: ChatRequestOptions): number {
  if (!Array.isArray(messages) || !messages.length || messages.some(message => !message
    || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) fail('缺少完整的模型请求')
  return messages.reduce((total, message) => total + estimateTokens(message.content), 0) + estimateChatRequestOptionsTokens(options)
}

/** Reconstruct only actually requested calls from immutable exact artifacts.
 * Prepared-but-unsent requests cost no call. Unknown requests are retained and
 * counted; neither missing evidence nor duplicate dispatch may reduce usage. */
export async function readChatActionChoiceInputBudgetV1(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1) {
  if (chatActionChoiceVersionForContractV1(snapshot.contract) !== 1) return null
  const calls: Array<{stepId: string; estimatedInputTokens: number}> = []
  for (const requested of snapshot.events.filter(event => event.type === 'model.requested')) {
    if (requested.type !== 'model.requested') continue
    const {stepId, attempt} = requested.payload
    if (attempt !== 1 || calls.some(call => call.stepId === stepId)
      || !snapshot.contract.executionBindings?.some(binding => binding.stepId === stepId)) fail('调用次数或步骤超出冻结预算')
    const artifacts = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded' && event.payload.stepId === stepId
      && event.payload.attempt === attempt && event.payload.artifactKind === 'rendered-request')
    const assemblies = snapshot.events.filter(event => event.type === 'context.assembled' && event.payload.stepId === stepId && event.payload.attempt === attempt)
    if (artifacts.length !== 1 || artifacts[0].type !== 'evidence.artifact.recorded' || artifacts[0].sequence >= requested.sequence
      || assemblies.length !== 1 || assemblies[0].type !== 'context.assembled' || assemblies[0].sequence >= artifacts[0].sequence) fail('已发送请求缺少唯一的输入预算证据')
    const delivered = JSON.parse(await readAgentRunArtifactExactV1({projectId: scope.projectId, artifactKind: 'rendered-request', contentHash: artifacts[0].payload.contentHash}))
    const messages = Array.isArray(delivered) ? delivered : delivered?.version === 1 ? delivered.messages : null
    const requestOptions = Array.isArray(delivered) ? undefined : delivered?.requestOptions
    const estimatedInputTokens = estimateChatActionRequestInputV1(messages, requestOptions)
    if (requested.payload.bindingHash !== await hashCanonicalValue({runtimeBindingHash: snapshot.contract.runtimeBindingHash,
      manifestHash: assemblies[0].payload.manifestHash, messages, ...(requestOptions ? {requestOptions} : {})})) fail('已发送请求的预算证据与原调用不一致')
    calls.push({stepId, estimatedInputTokens})
  }
  const estimatedInputTokens = calls.reduce((total, call) => total + call.estimatedInputTokens, 0)
  if (calls.length > snapshot.contract.budget.maxModelCalls || estimatedInputTokens > snapshot.contract.budget.maxInputTokens) fail('已发送请求超出冻结输入预算；保留原结果，不能继续采用')
  return {version: 1 as const, estimator: 'chat-request-input-v1' as const, calls, estimatedInputTokens,
    maximumInputTokens: snapshot.contract.budget.maxInputTokens, maximumModelCalls: snapshot.contract.budget.maxModelCalls}
}

/** Call immediately before recording a new model.requested under the existing
 * run lock. Recovery of a retained response never enters this dispatch guard. */
export async function assertChatActionChoiceInputBudgetV1(input: {scope: WorkspaceScope; snapshot: AgentRunSnapshotV1;
  stepId: string; messages: readonly ChatMessage[]; requestOptions?: ChatRequestOptions}) {
  const previous = await readChatActionChoiceInputBudgetV1(input.scope, input.snapshot)
  if (!previous) return
  if (previous.calls.some(call => call.stepId === input.stepId)) fail('本步骤已经发送过请求，不能重复调用')
  await readChatActionOutputBudgetV1(input.scope, input.snapshot)
  if (!input.snapshot.contract.executionBindings?.some(binding => binding.stepId === input.stepId)
    || previous.calls.length + 1 > previous.maximumModelCalls) fail('下一步超出冻结调用预算')
  const estimated = previous.estimatedInputTokens + estimateChatActionRequestInputV1(input.messages, input.requestOptions)
  if (estimated > previous.maximumInputTokens) fail(`完整请求累计预计需要 ${estimated} tokens，超过本次运行的 ${previous.maximumInputTokens} 输入预算；未发送下一步，已有结果保留`)
}
