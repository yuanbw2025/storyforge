import type {
  AgentRunEventV1,
  AgentRunEventTypeV1,
  AgentRunProjectionBodyV1,
  AgentRunProjectionV1,
  AgentRunState,
  AgentRunStepProjectionV1,
  AnyAgentRunEventV1,
} from '../../types/agent-run'
import { parseAgentRunEventV1 } from './event-schema'
import { hashCanonicalValue } from './hash'

const TERMINAL_STATES: readonly AgentRunState[] = ['completed', 'failed', 'cancelled', 'recovery_required']

class ProjectionError extends Error {}

function expectState(projection: AgentRunProjectionV1, eventType: AgentRunEventTypeV1, allowed: AgentRunState[]): void {
  if (!allowed.includes(projection.state)) {
    throw new ProjectionError(`${eventType} 不能从 ${projection.state} 状态执行`)
  }
}

function stepFor(projection: AgentRunProjectionV1, stepId: string): AgentRunStepProjectionV1 {
  const step = projection.steps[stepId]
  if (!step) throw new ProjectionError(`步骤 ${stepId} 尚未调度`)
  return step
}

function assertAttempt(step: AgentRunStepProjectionV1, attempt: number): void {
  if (step.attempt !== attempt) {
    throw new ProjectionError(`步骤 ${step.stepId} attempt 不匹配：期望 ${step.attempt}，收到 ${attempt}`)
  }
}

function assertCandidate(step: AgentRunStepProjectionV1, candidateHash: string): void {
  if (!step.candidateHash || step.candidateHash !== candidateHash) {
    throw new ProjectionError(`步骤 ${step.stepId} candidateHash 不匹配`)
  }
}

function assertActiveStep(
  projection: AgentRunProjectionV1,
  payload: { stepId: string; attempt: number },
): AgentRunStepProjectionV1 {
  const step = stepFor(projection, payload.stepId)
  if (step.status !== 'running') throw new ProjectionError(`步骤 ${payload.stepId} 当前不是 running`)
  assertAttempt(step, payload.attempt)
  return step
}

function refreshRunningState(projection: AgentRunProjectionV1): void {
  const steps = Object.values(projection.steps)
  const hasExecutable = steps.some(step => (
    step.status === 'scheduled' || step.status === 'running' || step.status === 'failed'
  ))
  projection.state = hasExecutable
    ? 'running'
    : steps.some(step => step.status === 'awaiting_confirmation')
      ? 'awaiting_confirmation'
      : 'running'
}

function applyEvent(projection: AgentRunProjectionV1, event: AnyAgentRunEventV1): void {
  if (
    TERMINAL_STATES.includes(projection.state)
    && event.type !== 'verification.staled'
    && event.type !== 'memory.settlement.recorded'
  ) {
    throw new ProjectionError(`终态 ${projection.state} 后不得追加 ${event.type}`)
  }
  switch (event.type) {
    case 'run.created':
      throw new ProjectionError('run.created 只能作为首个事件')
    case 'contract.accepted':
      expectState(projection, event.type, ['planned'])
      break
    case 'contract.revised':
      if (event.payload.previousContractHash !== projection.contractHash) {
        throw new ProjectionError('contract.revised 的 previousContractHash 不匹配')
      }
      if (event.generation !== projection.generation + 1) {
        throw new ProjectionError('contract.revised 必须将 generation 递增 1')
      }
      projection.generation = event.generation
      projection.contractHash = event.contractHash
      projection.steps = {}
      projection.state = 'planned'
      break
    case 'plan.replanned':
      expectState(projection, event.type, ['planned'])
      break
    case 'step.scheduled':
      expectState(projection, event.type, ['planned', 'running'])
      if (projection.steps[event.payload.stepId]) throw new ProjectionError(`步骤 ${event.payload.stepId} 重复调度`)
      projection.steps[event.payload.stepId] = {
        stepId: event.payload.stepId,
        status: 'scheduled',
        attempt: 0,
      }
      projection.state = 'running'
      break
    case 'step.started': {
      expectState(projection, event.type, ['running'])
      const step = stepFor(projection, event.payload.stepId)
      const expectedAttempt = step.status === 'scheduled' ? 1 : step.status === 'failed' ? step.attempt + 1 : -1
      if (event.payload.attempt !== expectedAttempt) throw new ProjectionError(`步骤 ${step.stepId} attempt 必须为 ${expectedAttempt}`)
      step.status = 'running'
      step.attempt = event.payload.attempt
      step.failureCode = undefined
      break
    }
    case 'step.succeeded': {
      const step = assertActiveStep(projection, event.payload)
      step.status = 'succeeded'
      step.outputHash = event.payload.outputHash
      refreshRunningState(projection)
      break
    }
    case 'step.failed': {
      const step = assertActiveStep(projection, event.payload)
      step.status = 'failed'
      step.failureCode = event.payload.code
      refreshRunningState(projection)
      break
    }
    case 'context.assembled':
    case 'model.requested':
    case 'model.responded':
    case 'tool.called':
    case 'tool.returned':
      expectState(projection, event.type, ['running'])
      assertActiveStep(projection, event.payload)
      break
    case 'candidate.persisted': {
      expectState(projection, event.type, ['running'])
      const step = assertActiveStep(projection, event.payload)
      step.candidateHash = event.payload.candidateHash
      if (event.payload.requiresConfirmation) {
        step.status = 'awaiting_confirmation'
        refreshRunningState(projection)
      }
      break
    }
    case 'candidate.revised': {
      expectState(projection, event.type, ['running', 'awaiting_confirmation'])
      const step = stepFor(projection, event.payload.stepId)
      if (step.status !== 'awaiting_confirmation') {
        throw new ProjectionError(`步骤 ${event.payload.stepId} 不在等待确认，不能修订候选`)
      }
      assertAttempt(step, event.payload.attempt)
      assertCandidate(step, event.payload.previousCandidateHash)
      if (step.confirmation) throw new ProjectionError('候选已经确认，不能再修订')
      step.candidateHash = event.payload.candidateHash
      break
    }
    case 'candidate.staled': {
      const step = stepFor(projection, event.payload.stepId)
      assertCandidate(step, event.payload.candidateHash)
      step.status = 'stale'
      projection.state = 'paused'
      break
    }
    case 'candidate.carried-forward': {
      expectState(projection, event.type, ['running'])
      if (event.payload.sourceGeneration >= projection.generation) {
        throw new ProjectionError('candidate.carried-forward 必须引用旧 generation')
      }
      const step = stepFor(projection, event.payload.stepId)
      if (step.status !== 'scheduled' || step.attempt !== 0) {
        throw new ProjectionError(`步骤 ${event.payload.stepId} 不是可跨代保留的 scheduled 状态`)
      }
      step.status = 'awaiting_confirmation'
      step.attempt = 1
      step.candidateHash = event.payload.candidateHash
      refreshRunningState(projection)
      break
    }
    case 'runtime.candidate.adopted': {
      expectState(projection, event.type, ['running', 'awaiting_confirmation'])
      const step = stepFor(projection, event.payload.stepId)
      assertCandidate(step, event.payload.candidateHash)
      if (step.status !== 'awaiting_confirmation' && step.status !== 'running') {
        throw new ProjectionError(`步骤 ${step.stepId} 不在可采用状态`)
      }
      step.status = 'running'
      step.adoptionHash = event.payload.adoptionHash
      refreshRunningState(projection)
      break
    }
    case 'step.verification.accepted': {
      expectState(projection, event.type, ['running', 'awaiting_confirmation'])
      const receipt = event.payload.receipt
      const step = stepFor(projection, receipt.stepId)
      if (step.status !== 'awaiting_confirmation') {
        throw new ProjectionError(`步骤 ${receipt.stepId} 不在等待确认，不能签发步骤回执`)
      }
      assertAttempt(step, receipt.attempt)
      assertCandidate(step, receipt.candidateHash)
      step.verificationReceiptHash = receipt.receiptHash
      break
    }
    case 'step.verification.staled': {
      const step = stepFor(projection, event.payload.stepId)
      if (step.verificationReceiptHash !== event.payload.previousReceiptHash) {
        throw new ProjectionError('step.verification.staled 的 previousReceiptHash 不匹配')
      }
      step.verificationReceiptHash = undefined
      break
    }
    case 'confirmation.recorded': {
      expectState(projection, event.type, ['running', 'awaiting_confirmation'])
      const step = stepFor(projection, event.payload.stepId)
      if (step.status !== 'awaiting_confirmation') throw new ProjectionError(`步骤 ${step.stepId} 不在等待确认`)
      assertCandidate(step, event.payload.candidateHash)
      step.confirmation = event.payload.decision
      if (event.payload.decision === 'reject') {
        step.status = 'failed'
        step.failureCode = 'author_rejected'
      } else {
        step.status = 'running'
      }
      refreshRunningState(projection)
      break
    }
    case 'adoption.started': {
      expectState(projection, event.type, ['running'])
      const step = stepFor(projection, event.payload.stepId)
      assertCandidate(step, event.payload.candidateHash)
      if (step.confirmation !== 'adopt') throw new ProjectionError('未记录作者采纳确认')
      break
    }
    case 'adoption.committed': {
      expectState(projection, event.type, ['running'])
      const step = stepFor(projection, event.payload.stepId)
      assertCandidate(step, event.payload.candidateHash)
      if (step.confirmation !== 'adopt') throw new ProjectionError('未记录作者采纳确认')
      step.adoptionHash = event.payload.adoptionHash
      break
    }
    case 'adoption.rejected': {
      expectState(projection, event.type, ['running'])
      const step = stepFor(projection, event.payload.stepId)
      assertCandidate(step, event.payload.candidateHash)
      step.status = 'failed'
      step.failureCode = event.payload.code
      break
    }
    case 'verification.started':
      expectState(projection, event.type, ['running'])
      if (Object.keys(projection.steps).length === 0) throw new ProjectionError('没有可验证的步骤')
      if (Object.values(projection.steps).some(step => step.status !== 'succeeded')) {
        throw new ProjectionError('仍有步骤未成功，不能开始终态验证')
      }
      projection.state = 'verifying'
      break
    case 'verification.accepted':
      expectState(projection, event.type, ['verifying'])
      projection.terminalReceiptHash = event.payload.receiptHash
      projection.state = 'completed'
      break
    case 'memory.settlement.recorded':
      expectState(projection, event.type, ['completed', 'failed', 'cancelled'])
      if (projection.memorySettlement) {
        throw new ProjectionError('当前终态已经存在记忆结算，不得重复签发')
      }
      if ((projection.terminalReceiptHash ?? null) !== event.payload.terminalReceiptHash) {
        throw new ProjectionError('记忆结算引用的 terminal receipt 与运行投影不匹配')
      }
      if (event.payload.state === 'settled' && projection.state !== 'completed') {
        throw new ProjectionError('未完成的 Harness 终态不得伪造 settled 记忆结算')
      }
      projection.memorySettlement = {
        receiptHash: event.payload.receiptHash,
        terminalReceiptHash: event.payload.terminalReceiptHash,
        state: event.payload.state,
        artifactIndexHash: event.payload.artifactIndexHash,
        workspaceDirty: event.payload.workspaceDirty,
        recordedAt: event.createdAt,
      }
      break
    case 'verification.rejected':
      expectState(projection, event.type, ['verifying'])
      projection.state = event.payload.retryable ? 'running' : 'failed'
      break
    case 'verification.staled':
      expectState(projection, event.type, ['completed'])
      if (projection.terminalReceiptHash !== event.payload.previousReceiptHash) {
        throw new ProjectionError('verification.staled 的 previousReceiptHash 不匹配')
      }
      projection.terminalReceiptHash = undefined
      projection.memorySettlement = undefined
      projection.state = 'running'
      break
    case 'checkpoint.created':
      if (event.payload.throughSequence !== event.sequence - 1) {
        throw new ProjectionError('checkpoint throughSequence 必须指向前一个事件')
      }
      projection.lastCheckpointHash = event.payload.checkpointHash
      break
    case 'recovery.started':
      expectState(projection, event.type, ['paused'])
      if (projection.lastCheckpointHash !== event.payload.checkpointHash) {
        throw new ProjectionError('恢复使用的 checkpoint 不是当前最新 checkpoint')
      }
      projection.state = 'recovering'
      break
    case 'recovery.completed':
      expectState(projection, event.type, ['recovering'])
      if (projection.lastCheckpointHash !== event.payload.checkpointHash) {
        throw new ProjectionError('恢复完成的 checkpoint 不匹配')
      }
      refreshRunningState(projection)
      break
    case 'budget.reserved':
    case 'budget.settled':
      expectState(projection, event.type, ['running'])
      stepFor(projection, event.payload.stepId)
      break
    case 'budget.exhausted':
      expectState(projection, event.type, ['running', 'verifying'])
      projection.state = 'failed'
      break
    case 'run.paused':
      expectState(projection, event.type, ['running', 'awaiting_confirmation'])
      projection.state = 'paused'
      break
    case 'run.cancelled':
      expectState(projection, event.type, ['planned', 'running', 'awaiting_confirmation', 'verifying', 'paused'])
      projection.state = 'cancelled'
      break
    case 'run.failed':
      expectState(projection, event.type, ['planned', 'running', 'awaiting_confirmation', 'verifying', 'paused', 'recovering'])
      projection.state = 'failed'
      break
  }
}

function scopeMatches(projection: AgentRunProjectionV1, event: AnyAgentRunEventV1): boolean {
  return event.runId === projection.runId
    && event.projectId === projection.projectId
    && event.worldGroupId === projection.worldGroupId
}

function appendError(projection: AgentRunProjectionV1, message: string): AgentRunProjectionV1 {
  projection.errors.push(message)
  projection.state = 'recovery_required'
  return projection
}

export function replayAgentRunEventsV1(values: readonly unknown[]): AgentRunProjectionV1 {
  if (values.length === 0) throw new ProjectionError('run event 不能为空')
  const first = parseAgentRunEventV1(values[0])
  const projection: AgentRunProjectionV1 = {
    version: 1,
    runId: first.runId,
    projectId: first.projectId,
    worldGroupId: first.worldGroupId,
    generation: first.generation,
    contractHash: first.contractHash,
    state: 'planned',
    lastSequence: 0,
    steps: {},
    errors: [],
  }
  if (first.type !== 'run.created') return appendError(projection, '首个事件必须是 run.created')
  if (first.sequence !== 1) return appendError(projection, 'run.created 的 sequence 必须是 1')
  projection.lastSequence = 1

  for (let index = 1; index < values.length; index += 1) {
    let event: AnyAgentRunEventV1
    try {
      event = parseAgentRunEventV1(values[index])
    } catch (error) {
      return appendError(projection, error instanceof Error ? error.message : '事件解析失败')
    }
    if (event.sequence !== projection.lastSequence + 1) {
      return appendError(projection, `事件序列不连续：期望 ${projection.lastSequence + 1}，收到 ${event.sequence}`)
    }
    if (!scopeMatches(projection, event)) return appendError(projection, `事件 ${event.sequence} scope 不匹配`)
    if (event.type !== 'contract.revised') {
      if (event.generation !== projection.generation || event.contractHash !== projection.contractHash) {
        return appendError(projection, `事件 ${event.sequence} contract generation/hash 不匹配`)
      }
    }
    try {
      applyEvent(projection, event)
    } catch (error) {
      return appendError(projection, error instanceof Error ? error.message : '状态转换失败')
    }
    projection.lastSequence = event.sequence
  }
  return projection
}

export async function hashAgentRunProjectionV1(projection: AgentRunProjectionV1): Promise<string> {
  return hashCanonicalValue(projection)
}

export function toAgentRunProjectionBodyV1(
  projection: AgentRunProjectionV1,
): AgentRunProjectionBodyV1 {
  return {
    version: 1,
    generation: projection.generation,
    state: projection.state,
    lastSequence: projection.lastSequence,
    steps: projection.steps,
    terminalReceiptHash: projection.terminalReceiptHash,
    memorySettlement: projection.memorySettlement,
    lastCheckpointHash: projection.lastCheckpointHash,
    errors: projection.errors,
  }
}

export async function hashAgentRunProjectionBodyV1(
  projection: AgentRunProjectionV1,
): Promise<string> {
  return hashCanonicalValue(toAgentRunProjectionBodyV1(projection))
}

export function isAgentRunCompletedV1(projection: AgentRunProjectionV1): boolean {
  return projection.state === 'completed' && !!projection.terminalReceiptHash && projection.errors.length === 0
}

export function agentRunEventV1<T extends AgentRunEventTypeV1>(
  event: AgentRunEventV1<T>,
): AgentRunEventV1<T> {
  return event
}
