import type {
  AgentRunContractV1,
  AgentRunEventTypeV1,
  AgentRunProjectionV1,
  WorkspaceScope,
} from '../../types'
import {
  AGENT_READ_CONTEXT_SOURCE_KEYS,
  AGENT_READ_TOOLS,
} from '../tool-registry'
import type { AgentToolExecutionContext } from '../types'
import {
  resolveReadOnlyAgentLimits,
  runReadOnlyAgent,
  type ReadOnlyAgentExecutionSummary,
  type ReadOnlyAgentExecutionTrace,
  type ReadOnlyAgentLimits,
  type ReadOnlyAgentResult,
  type RunReadOnlyAgentInput,
} from '../runner'
import {
  beginAgentRunRecoveryV1,
  completeAgentRunRecoveryV1,
  createAgentRunCheckpointV1,
  readLatestVerifiedAgentRunCheckpointV1,
} from './checkpoint'
import { acceptAgentRunContractV1 } from './contract'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { hashCanonicalValue } from './hash'

export const READ_ONLY_AGENT_DURABLE_STEP_ID_V1 = 'read-only-audit'
export const READ_ONLY_AGENT_DURABLE_ADAPTER_VERSION_V1 = 'read-only-durable-v1'

const RESULT_KIND = 'read-only-agent-result'
const MAX_DURABLE_ANSWER_CHARS = 32_000
const DEFAULT_MAX_ATTEMPTS = 3
const HARD_MAX_ATTEMPTS = 5

export interface ReadOnlyAgentExecutionBindingV1 {
  provider: string
  model: string
  adapterVersion: string
  capabilityProfileHash?: string
  reasoningEffort?: string
}

export interface ReadOnlyAgentDurableBoundaryV1 {
  type: AgentRunEventTypeV1
  runId: number
  sequence: number
}

export interface DurableReadOnlyAgentResultV1 {
  runId: number
  stepId: typeof READ_ONLY_AGENT_DURABLE_STEP_ID_V1
  resumed: boolean
  execution: ReadOnlyAgentExecutionSummary
  liveResult: ReadOnlyAgentResult | null
  projection: AgentRunProjectionV1
}

export interface RunDurableReadOnlyAgentInputV1 extends Omit<
  RunReadOnlyAgentInput,
  'context' | 'executionTrace'
> {
  scope: WorkspaceScope
  worldGroupId: number | null
  context: AgentToolExecutionContext
  executionBinding: ReadOnlyAgentExecutionBindingV1
  runId?: number
  maxAttemptsPerStep?: number
  now?: () => number
  onDurableBoundary?: (boundary: ReadOnlyAgentDurableBoundaryV1) => void | Promise<void>
}

interface ReadOnlyAgentResultCheckpointV1 extends ReadOnlyAgentExecutionSummary {
  version: 1
  kind: typeof RESULT_KIND
  stepId: typeof READ_ONLY_AGENT_DURABLE_STEP_ID_V1
  attempt: number
}

function clampAttempts(value: number | undefined): number {
  if (!Number.isFinite(value) || value == null) return DEFAULT_MAX_ATTEMPTS
  return Math.max(1, Math.min(HARD_MAX_ATTEMPTS, Math.floor(value)))
}

function nonEmptyBindingValue(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 160) throw new Error(`${field} 必须是 1-160 字符`)
  return normalized
}

function normalizeExecutionBinding(
  binding: ReadOnlyAgentExecutionBindingV1,
): ReadOnlyAgentExecutionBindingV1 {
  return {
    provider: nonEmptyBindingValue(binding.provider, 'executionBinding.provider'),
    model: nonEmptyBindingValue(binding.model, 'executionBinding.model'),
    adapterVersion: nonEmptyBindingValue(binding.adapterVersion, 'executionBinding.adapterVersion'),
    ...(binding.capabilityProfileHash
      ? { capabilityProfileHash: nonEmptyBindingValue(binding.capabilityProfileHash, 'executionBinding.capabilityProfileHash') }
      : {}),
    ...(binding.reasoningEffort
      ? { reasoningEffort: nonEmptyBindingValue(binding.reasoningEffort, 'executionBinding.reasoningEffort') }
      : {}),
  }
}

export function buildReadOnlyAgentRunContractV1(input: {
  goal: string
  projectId: number
  worldGroupId: number | null
  limits?: Partial<ReadOnlyAgentLimits>
  maxAttemptsPerStep?: number
  runtimeBindingHash?: string
}): AgentRunContractV1 {
  const objective = input.goal.trim()
  if (!objective) throw new Error('Agent 目标不能为空')
  if (input.runtimeBindingHash && !/^[0-9a-f]{64}$/u.test(input.runtimeBindingHash)) {
    throw new Error('runtimeBindingHash 必须是 SHA-256')
  }
  const limits = resolveReadOnlyAgentLimits(input.limits)
  return {
    version: 1,
    objective,
    workflowKind: 'read-only-audit',
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
    },
    permissions: {
      contextSourceKeys: [...AGENT_READ_CONTEXT_SOURCE_KEYS],
      writeTargets: [],
    },
    ...(input.runtimeBindingHash ? { runtimeBindingHash: input.runtimeBindingHash } : {}),
    budget: {
      maxModelCalls: limits.maxSteps,
      maxToolCalls: limits.maxToolCalls,
      // Runner enforces the stricter combined model-token ceiling at runtime.
      maxInputTokens: limits.maxTotalTokens,
      maxOutputTokens: limits.maxTotalTokens,
      maxAttemptsPerStep: clampAttempts(input.maxAttemptsPerStep),
      maxToolResultTokens: limits.maxToolResultTokens,
      maxProtocolErrors: limits.maxProtocolErrors,
    },
    acceptance: [{ id: 'readonly.output', kind: 'output-present', required: true }],
    verificationPlan: [{
      id: 'readonly.terminal',
      kind: 'terminal',
      verifier: 'read-only-terminal-v1',
      criterionIds: ['readonly.output'],
    }],
    failurePolicy: {
      onProtocolError: limits.maxProtocolErrors > 0 ? 'retry' : 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'restart-step',
    },
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function readCount(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field} 不是非负整数`)
  return Number(value)
}

function parseResultCheckpoint(value: unknown): ReadOnlyAgentResultCheckpointV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = [
    'version', 'kind', 'stepId', 'attempt', 'status', 'answer', 'steps',
    'toolCalls', 'totalTokens', 'toolResultTokens',
  ] as const
  if (!exactKeys(record, keys)) throw new Error('只读 Agent 检查点字段不合法')
  if (record.version !== 1 || record.kind !== RESULT_KIND) return null
  if (record.stepId !== READ_ONLY_AGENT_DURABLE_STEP_ID_V1) {
    throw new Error('只读 Agent 检查点 stepId 不匹配')
  }
  if (record.status !== 'completed') throw new Error('只读 Agent 结果检查点不是成功执行结果')
  if (typeof record.answer !== 'string' || !record.answer || record.answer.length > MAX_DURABLE_ANSWER_CHARS) {
    throw new Error('只读 Agent 检查点 answer 缺失或超出上限')
  }
  return {
    version: 1,
    kind: RESULT_KIND,
    stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
    attempt: readCount(record.attempt, 'checkpoint.attempt'),
    status: 'completed',
    answer: record.answer,
    steps: readCount(record.steps, 'checkpoint.steps'),
    toolCalls: readCount(record.toolCalls, 'checkpoint.toolCalls'),
    totalTokens: readCount(record.totalTokens, 'checkpoint.totalTokens'),
    toolResultTokens: readCount(record.toolResultTokens, 'checkpoint.toolResultTokens'),
  }
}

function checkpointFromSummary(
  summary: ReadOnlyAgentExecutionSummary,
  attempt: number,
): ReadOnlyAgentResultCheckpointV1 {
  if (summary.status !== 'completed' || !summary.answer) {
    throw new Error('只有模型按协议返回 final 后才能持久化只读 Agent 结果')
  }
  if (summary.answer.length > MAX_DURABLE_ANSWER_CHARS) {
    throw new Error(`只读 Agent 最终答复超过 ${MAX_DURABLE_ANSWER_CHARS} 字符持久化上限`)
  }
  return {
    version: 1,
    kind: RESULT_KIND,
    stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
    attempt,
    ...summary,
  }
}

function assertContextScope(input: RunDurableReadOnlyAgentInputV1): AgentToolExecutionContext {
  if (input.context.projectId !== input.scope.projectId) {
    throw new Error('Agent context.projectId 与 WorkspaceScope 不一致')
  }
  if (input.context.scope && (
    input.context.scope.projectId !== input.scope.projectId
    || input.context.scope.worldId !== input.scope.worldId
    || input.context.scope.workId !== input.scope.workId
  )) throw new Error('Agent context.scope 与 durable WorkspaceScope 不一致')
  if (
    Object.prototype.hasOwnProperty.call(input.context, 'worldGroupId')
    && input.context.worldGroupId !== undefined
    && input.context.worldGroupId !== input.worldGroupId
  ) throw new Error('Agent context.worldGroupId 与 durable run 不一致')
  return {
    ...input.context,
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
  }
}

function summaryFromCheckpoint(
  checkpoint: ReadOnlyAgentResultCheckpointV1,
): ReadOnlyAgentExecutionSummary {
  return {
    status: checkpoint.status,
    answer: checkpoint.answer,
    steps: checkpoint.steps,
    toolCalls: checkpoint.toolCalls,
    totalTokens: checkpoint.totalTokens,
    toolResultTokens: checkpoint.toolResultTokens,
  }
}

function result(input: {
  snapshot: AgentRunSnapshotV1
  resumed: boolean
  execution: ReadOnlyAgentExecutionSummary
  liveResult: ReadOnlyAgentResult | null
}): DurableReadOnlyAgentResultV1 {
  return {
    runId: input.snapshot.run.id,
    stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
    resumed: input.resumed,
    execution: input.execution,
    liveResult: input.liveResult,
    projection: input.snapshot.projection,
  }
}

function terminalResource(status: ReadOnlyAgentExecutionSummary['status']):
  'model-calls' | 'tool-calls' | 'input-tokens' | null {
  if (status === 'max_steps') return 'model-calls'
  if (status === 'max_tool_calls') return 'tool-calls'
  if (status === 'token_budget') return 'input-tokens'
  return null
}

async function notifyBoundary(
  callback: RunDurableReadOnlyAgentInputV1['onDurableBoundary'],
  snapshot: AgentRunSnapshotV1,
  type: AgentRunEventTypeV1,
): Promise<void> {
  await callback?.({
    type,
    runId: snapshot.run.id,
    sequence: snapshot.projection.lastSequence,
  })
}

async function recoverCachedResult(input: {
  request: RunDurableReadOnlyAgentInputV1
  snapshot: AgentRunSnapshotV1
  checkpoint: ReadOnlyAgentResultCheckpointV1
}): Promise<DurableReadOnlyAgentResultV1> {
  let snapshot = input.snapshot
  const step = snapshot.projection.steps[READ_ONLY_AGENT_DURABLE_STEP_ID_V1]
  if (!step || step.attempt !== input.checkpoint.attempt) {
    throw new Error('只读 Agent 结果检查点与当前 attempt 不匹配')
  }
  const lastEvent = snapshot.events[snapshot.events.length - 1]
  const alreadyWaitingForVerifier = snapshot.projection.state === 'paused'
    && step.status === 'succeeded'
    && lastEvent?.type === 'run.paused'
    && lastEvent.payload.reason === 'awaiting_terminal_verification'
  if (!alreadyWaitingForVerifier) {
    if (snapshot.projection.state === 'running') {
      snapshot = await appendAgentRunEventV1({
        scope: input.request.scope,
        runId: snapshot.run.id,
        type: 'run.paused',
        payload: { reason: 'interrupted_after_result_checkpoint', recoverable: true },
        expectedLastSequence: snapshot.projection.lastSequence,
        now: input.request.now?.(),
      })
      await notifyBoundary(input.request.onDurableBoundary, snapshot, 'run.paused')
    }
    if (snapshot.projection.state === 'paused' || snapshot.projection.state === 'recovering') {
      const wasRecovering = snapshot.projection.state === 'recovering'
      const plan = await beginAgentRunRecoveryV1({
        scope: input.request.scope,
        runId: snapshot.run.id,
        expectedLastSequence: snapshot.projection.lastSequence,
        now: input.request.now?.(),
      })
      snapshot = plan.snapshot
      if (!wasRecovering) await notifyBoundary(input.request.onDurableBoundary, snapshot, 'recovery.started')
      snapshot = await completeAgentRunRecoveryV1({
        scope: input.request.scope,
        runId: snapshot.run.id,
        checkpointHash: plan.checkpointHash,
        expectedLastSequence: snapshot.projection.lastSequence,
        now: input.request.now?.(),
      })
      await notifyBoundary(input.request.onDurableBoundary, snapshot, 'recovery.completed')
    }
    const recoveredStep = snapshot.projection.steps[READ_ONLY_AGENT_DURABLE_STEP_ID_V1]
    if (recoveredStep?.status === 'running') {
      snapshot = await appendAgentRunEventV1({
        scope: input.request.scope,
        runId: snapshot.run.id,
        type: 'step.succeeded',
        payload: {
          stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
          attempt: input.checkpoint.attempt,
          outputHash: await hashCanonicalValue(input.checkpoint.answer),
        },
        expectedLastSequence: snapshot.projection.lastSequence,
        now: input.request.now?.(),
      })
      await notifyBoundary(input.request.onDurableBoundary, snapshot, 'step.succeeded')
    } else if (recoveredStep?.status !== 'succeeded') {
      throw new Error(`只读 Agent 结果恢复遇到不可接受的步骤状态 ${recoveredStep?.status ?? 'missing'}`)
    }
    if (snapshot.projection.state === 'running') {
      snapshot = await appendAgentRunEventV1({
        scope: input.request.scope,
        runId: snapshot.run.id,
        type: 'run.paused',
        payload: { reason: 'awaiting_terminal_verification', recoverable: true },
        expectedLastSequence: snapshot.projection.lastSequence,
        now: input.request.now?.(),
      })
      await notifyBoundary(input.request.onDurableBoundary, snapshot, 'run.paused')
    }
  }
  return result({
    snapshot,
    resumed: true,
    execution: summaryFromCheckpoint(input.checkpoint),
    liveResult: null,
  })
}

async function prepareAttempt(input: {
  request: RunDurableReadOnlyAgentInputV1
  snapshot: AgentRunSnapshotV1
}): Promise<{ snapshot: AgentRunSnapshotV1; attempt: number }> {
  let snapshot = input.snapshot
  if (snapshot.projection.state === 'recovering') {
    const plan = await beginAgentRunRecoveryV1({
      scope: input.request.scope,
      runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: input.request.now?.(),
    })
    snapshot = await completeAgentRunRecoveryV1({
      scope: input.request.scope,
      runId: snapshot.run.id,
      checkpointHash: plan.checkpointHash,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: input.request.now?.(),
    })
    await notifyBoundary(input.request.onDurableBoundary, snapshot, 'recovery.completed')
  }
  if (snapshot.projection.state !== 'planned' && snapshot.projection.state !== 'running') {
    throw new Error(`只读 Agent run 当前状态 ${snapshot.projection.state} 不能执行`)
  }

  let step = snapshot.projection.steps[READ_ONLY_AGENT_DURABLE_STEP_ID_V1]
  if (!step) {
    snapshot = await appendAgentRunEventV1({
      scope: input.request.scope,
      runId: snapshot.run.id,
      type: 'step.scheduled',
      payload: { stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1 },
      expectedLastSequence: snapshot.projection.lastSequence,
      now: input.request.now?.(),
    })
    await notifyBoundary(input.request.onDurableBoundary, snapshot, 'step.scheduled')
    step = snapshot.projection.steps[READ_ONLY_AGENT_DURABLE_STEP_ID_V1]
  } else if (step.status === 'running') {
    snapshot = await appendAgentRunEventV1({
      scope: input.request.scope,
      runId: snapshot.run.id,
      type: 'step.failed',
      payload: {
        stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
        attempt: step.attempt,
        code: 'host_interrupted',
        retryable: true,
      },
      expectedLastSequence: snapshot.projection.lastSequence,
      now: input.request.now?.(),
    })
    await notifyBoundary(input.request.onDurableBoundary, snapshot, 'step.failed')
    step = snapshot.projection.steps[READ_ONLY_AGENT_DURABLE_STEP_ID_V1]
  } else if (step.status === 'succeeded') {
    snapshot = await appendAgentRunEventV1({
      scope: input.request.scope,
      runId: snapshot.run.id,
      type: 'run.failed',
      payload: { code: 'readonly_result_checkpoint_missing', retryable: false },
      expectedLastSequence: snapshot.projection.lastSequence,
      now: input.request.now?.(),
    })
    await notifyBoundary(input.request.onDurableBoundary, snapshot, 'run.failed')
    throw new Error('只读 Agent 步骤已成功但结果检查点缺失，已拒绝重新调用模型')
  }

  const attempt = step.status === 'scheduled' ? 1 : step.attempt + 1
  if (attempt > snapshot.contract.budget.maxAttemptsPerStep) {
    snapshot = await appendAgentRunEventV1({
      scope: input.request.scope,
      runId: snapshot.run.id,
      type: 'budget.exhausted',
      payload: { resource: 'attempts' },
      expectedLastSequence: snapshot.projection.lastSequence,
      now: input.request.now?.(),
    })
    await notifyBoundary(input.request.onDurableBoundary, snapshot, 'budget.exhausted')
    throw new Error('只读 Agent 恢复 attempt 已耗尽')
  }
  snapshot = await appendAgentRunEventV1({
    scope: input.request.scope,
    runId: snapshot.run.id,
    type: 'step.started',
    payload: { stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1, attempt },
    expectedLastSequence: snapshot.projection.lastSequence,
    now: input.request.now?.(),
  })
  await notifyBoundary(input.request.onDurableBoundary, snapshot, 'step.started')
  snapshot = await appendAgentRunEventV1({
    scope: input.request.scope,
    runId: snapshot.run.id,
    type: 'budget.reserved',
    payload: {
      stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
      modelCalls: snapshot.contract.budget.maxModelCalls,
      toolCalls: snapshot.contract.budget.maxToolCalls,
      tokens: snapshot.contract.budget.maxInputTokens,
    },
    expectedLastSequence: snapshot.projection.lastSequence,
    now: input.request.now?.(),
  })
  await notifyBoundary(input.request.onDurableBoundary, snapshot, 'budget.reserved')
  return { snapshot, attempt }
}

export async function runDurableReadOnlyAgentV1(
  input: RunDurableReadOnlyAgentInputV1,
): Promise<DurableReadOnlyAgentResultV1> {
  const context = assertContextScope(input)
  const limits = resolveReadOnlyAgentLimits(input.limits)
  const executionBinding = normalizeExecutionBinding(input.executionBinding)
  const runtimeBindingHash = await hashCanonicalValue(executionBinding)
  const existingSnapshot = input.runId == null
    ? null
    : await readAgentRunV1(input.scope, input.runId)
  // Pre-HARNESS-29 runs did not freeze provider/model/transport. They retain
  // their historical contract shape; every newly created run is bound.
  const bindRuntime = input.runId == null || existingSnapshot?.contract.runtimeBindingHash !== undefined
  const contract = buildReadOnlyAgentRunContractV1({
    goal: input.goal,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    limits,
    maxAttemptsPerStep: input.maxAttemptsPerStep,
    ...(bindRuntime ? { runtimeBindingHash } : {}),
  })
  const accepted = await acceptAgentRunContractV1(contract)
  let snapshot: AgentRunSnapshotV1
  if (existingSnapshot) {
    snapshot = existingSnapshot
  } else if (input.runId == null) {
    snapshot = await createAgentRunV1({
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      contract,
      now: input.now?.(),
    })
  } else {
    snapshot = await readAgentRunV1(input.scope, input.runId)
  }
  if (snapshot.run.contractHash !== accepted.contractHash) {
    throw new Error('现有只读 Agent run 与本次目标、权限或预算契约不一致')
  }
  if (snapshot.contract.workflowKind !== 'read-only-audit') {
    throw new Error('现有 run 不是 read-only-audit')
  }
  if (snapshot.contract.permissions.writeTargets.length > 0) {
    throw new Error('只读 Agent run 含有写权限')
  }

  const latest = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
  const cached = parseResultCheckpoint(latest?.resumePayload ?? null)
  if (cached) {
    return recoverCachedResult({ request: input, snapshot: latest!.snapshot, checkpoint: cached })
  }

  const prepared = await prepareAttempt({ request: input, snapshot })
  snapshot = prepared.snapshot
  const attempt = prepared.attempt
  const toolSchemaSetHash = await hashCanonicalValue(AGENT_READ_TOOLS.map(tool => ({
    name: tool.name,
    risk: tool.risk,
    parameters: tool.parameters,
    sourceKeys: tool.sourceKeys,
    inputBudgetTokens: tool.inputBudgetTokens,
  })))

  const append = async <T extends AgentRunEventTypeV1>(
    type: T,
    payload: Parameters<typeof appendAgentRunEventV1<T>>[0]['payload'],
  ) => {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope,
      runId: snapshot.run.id,
      type,
      payload,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: input.now?.(),
    })
    await notifyBoundary(input.onDurableBoundary, snapshot, type)
  }

  const trace: ReadOnlyAgentExecutionTrace = {
    async beforeModel({ step, messages, estimatedInputTokens }) {
      await append('model.requested', {
        stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
        attempt,
        bindingHash: await hashCanonicalValue({
          executionBinding,
          toolSchemaSetHash,
          runnerStep: step,
          estimatedInputTokens,
          messages,
        }),
      })
    },
    async modelResponded({ output }) {
      await append('model.responded', {
        stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
        attempt,
        outputHash: await hashCanonicalValue(output),
      })
    },
    async toolCalled({ name, arguments: toolArguments }) {
      await append('tool.called', {
        stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
        attempt,
        toolName: name,
        callHash: await hashCanonicalValue({ name, arguments: toolArguments }),
      })
    },
    async toolReturned({ name, arguments: toolArguments, result: toolResult }) {
      await append('tool.returned', {
        stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
        attempt,
        toolName: name,
        resultHash: await hashCanonicalValue({
          name,
          arguments: toolArguments,
          ok: toolResult.ok,
          content: toolResult.content,
          error: toolResult.error,
          meta: toolResult.meta,
        }),
      })
    },
    async stopped(execution) {
      await append('budget.settled', {
        stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
        modelCalls: execution.steps,
        toolCalls: execution.toolCalls,
        tokens: execution.totalTokens,
      })
      if (execution.status === 'completed') {
        let checkpoint: ReadOnlyAgentResultCheckpointV1
        try {
          checkpoint = checkpointFromSummary(execution, attempt)
        } catch (error) {
          await append('step.failed', {
            stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
            attempt,
            code: 'readonly_result_not_durable',
            retryable: false,
          })
          await append('run.failed', { code: 'readonly_result_not_durable', retryable: false })
          throw error
        }
        const saved = await createAgentRunCheckpointV1({
          scope: input.scope,
          runId: snapshot.run.id,
          resumePayload: checkpoint,
          expectedLastSequence: snapshot.projection.lastSequence,
          now: input.now?.(),
        })
        snapshot = saved.snapshot
        await notifyBoundary(input.onDurableBoundary, snapshot, 'checkpoint.created')
        await append('step.succeeded', {
          stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
          attempt,
          outputHash: await hashCanonicalValue(execution.answer),
        })
        // H1 records an executable result. H2 is the only layer allowed to
        // issue verification.accepted and move this run to completed.
        await append('run.paused', {
          reason: 'awaiting_terminal_verification',
          recoverable: true,
        })
        return
      }

      await append('step.failed', {
        stepId: READ_ONLY_AGENT_DURABLE_STEP_ID_V1,
        attempt,
        code: `readonly_${execution.status}`,
        retryable: false,
      })
      if (execution.status === 'aborted') {
        await append('run.cancelled', { reason: 'readonly_aborted' })
        return
      }
      const resource = terminalResource(execution.status)
      if (resource) {
        await append('budget.exhausted', { resource })
        return
      }
      await append('run.failed', { code: `readonly_${execution.status}`, retryable: false })
    },
  }

  const liveResult = await runReadOnlyAgent({
    goal: input.goal,
    context,
    model: input.model,
    limits,
    signal: input.signal,
    onEvent: input.onEvent,
    executionTrace: trace,
  })
  snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
  return result({ snapshot, resumed: false, execution: liveResult, liveResult })
}
