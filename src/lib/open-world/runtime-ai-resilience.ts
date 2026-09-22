import { AIError } from '../types'
import { isProviderQuotaRejectionV1 } from '../ai/provider-rejection'
import { AICompletionResponseErrorV1 } from '../ai/completion-response'
import { appendAgentRunEventV1, readInstanceAgentRunV1 } from '../agent/run/event-store'
import { hashCanonicalValue } from '../agent/run/hash'
import type { WorkspaceScope } from '../types'
import {
  TextOpenWorldRuntimeAIExecutionErrorV1,
  TextOpenWorldRuntimeAIPlayerErrorV1,
  type TextOpenWorldRuntimeAIFailureV1,
} from './runtime-ai-error'
export {
  TEXT_OPEN_WORLD_RUNTIME_AI_FAILURE_KINDS_V1,
  TextOpenWorldRuntimeAIPlayerErrorV1,
  textOpenWorldRuntimeAIPlayerFailureV1,
  type TextOpenWorldRuntimeAIFailureKindV1,
  type TextOpenWorldRuntimeAIFailureV1,
} from './runtime-ai-error'

function normalizedMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .trim()
    .replace(/[a-f0-9]{32,}/gi, '<hash>')
    .replace(/\b\d{3,}\b/g, '<n>')
    .slice(0, 500)
}

function underlying(error: unknown): unknown {
  return error instanceof TextOpenWorldRuntimeAIExecutionErrorV1 ? error.cause : error
}

function transport(error: unknown) {
  const observation = error instanceof TextOpenWorldRuntimeAIExecutionErrorV1
    ? error.observation
    : null
  return {
    phase: observation?.requestLifecycle.phase ?? 'not-observed' as const,
    status: observation?.requestLifecycle.responseStatus ?? null,
    timedOut: observation?.timedOut ?? false,
    usageObserved: observation?.usage != null,
  }
}

function decide(error: unknown, providerResponseObserved: boolean): Omit<TextOpenWorldRuntimeAIFailureV1, 'version' | 'fingerprint'> {
  const cause = underlying(error)
  const boundary = transport(error)
  const message = normalizedMessage(cause)
  const responseObserved = providerResponseObserved || boundary.phase === 'response-observed'
  const requestDispatched = responseObserved || boundary.phase === 'request-dispatched'

  if (boundary.phase === 'request-dispatched' && !responseObserved) {
    return {
      kind: 'unknown-result', code: boundary.timedOut ? 'provider_timeout_unknown' : 'provider_result_unknown',
      category: 'unknown', action: 'pause-for-author', retryable: false,
      unknownResult: true, possibleCharge: true,
      message: boundary.timedOut
        ? '模型请求已发出，但在超时前没有确认结果。系统没有重新发送。'
        : '模型请求已发出，但网络中断前没有确认结果。系统没有重新发送。',
      recovery: '固定选项和系统操作仍可继续；如需再次生成，请重新发起一次新的明确请求。',
      requestPhase: boundary.phase, responseStatus: boundary.status,
    }
  }
  if (boundary.timedOut) {
    return {
      kind: 'provider-unavailable', code: 'runtime_ai_timeout', category: 'transient',
      action: 'retry', retryable: true, unknownResult: false,
      possibleCharge: requestDispatched || responseObserved,
      message: responseObserved
        ? '模型响应已经到达，但候选没有在合同时间内完成校验。'
        : '模型调用在请求发出前超过合同时间，本次没有采用任何 AI 结果。',
      recovery: '可以明确重试一次；系统不会自动重发，固定玩法仍可继续。',
      requestPhase: boundary.phase, responseStatus: boundary.status,
    }
  }
  if (cause instanceof AIError) {
    if (isProviderQuotaRejectionV1({ status: cause.status, message: cause.message })) {
      return {
        kind: 'insufficient-balance', code: 'provider_quota', category: 'deterministic',
        action: 'pause-for-author', retryable: false, unknownResult: false,
        possibleCharge: requestDispatched && !boundary.usageObserved,
        message: '模型服务拒绝了本次调用，可能是余额或额度不足。',
        recovery: '补充额度或切换可用模型后，再明确发起一次生成；游戏本体不受影响。',
        requestPhase: boundary.phase, responseStatus: cause.status,
      }
    }
    if (cause.status === 401 || cause.status === 403) {
      return {
        kind: 'authorization', code: 'provider_authorization', category: 'deterministic',
        action: 'pause-for-author', retryable: false, unknownResult: false, possibleCharge: false,
        message: '模型凭证或服务权限校验失败。',
        recovery: '检查当前 BYOK 凭证和模型权限后，再明确发起一次生成。',
        requestPhase: boundary.phase, responseStatus: cause.status,
      }
    }
    if (cause.status === 429) {
      return {
        kind: 'rate-limit', code: 'provider_rate_limited', category: 'transient',
        action: 'retry', retryable: true, unknownResult: false, possibleCharge: false,
        message: '模型服务正在限流，本次没有采用任何 AI 结果。',
        recovery: '稍后可明确重试一次；系统不会自动重发。',
        requestPhase: boundary.phase, responseStatus: cause.status,
      }
    }
    if ([408, 409, 425].includes(cause.status) || cause.status >= 500) {
      return {
        kind: 'provider-unavailable', code: 'provider_transient', category: 'transient',
        action: 'retry', retryable: true, unknownResult: false,
        possibleCharge: requestDispatched && !boundary.usageObserved,
        message: '模型服务暂时不可用，本次没有采用任何 AI 结果。',
        recovery: '可明确重试一次；固定选项和系统操作始终可用。',
        requestPhase: boundary.phase, responseStatus: cause.status,
      }
    }
    return {
      kind: 'configuration', code: 'provider_request_rejected', category: 'deterministic',
      action: 'pause-for-author', retryable: false, unknownResult: false, possibleCharge: false,
      message: `模型服务拒绝了请求（HTTP ${cause.status}）。`,
      recovery: '检查模型、端点和请求配置后，再重新发起生成。',
      requestPhase: boundary.phase, responseStatus: cause.status,
    }
  }
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return {
      kind: 'cancelled', code: 'runtime_ai_cancelled', category: 'cancelled', action: 'fail',
      retryable: false, unknownResult: false, possibleCharge: requestDispatched,
      message: '这次 AI 生成已取消，没有采用任何候选。',
      recovery: '当前游戏状态没有因此改变；需要时可重新发起。',
      requestPhase: boundary.phase, responseStatus: boundary.status,
    }
  }
  if (/stale|过期|已变化|边界|快照.*不匹配|状态.*变化/i.test(message)) {
    return {
      kind: 'stale', code: 'stale_input', category: 'stale-input', action: 'replan',
      retryable: false, unknownResult: false, possibleCharge: responseObserved,
      message: '游戏状态已经变化，旧的 AI 候选已被安全丢弃。',
      recovery: '请基于当前场景重新操作；已经发生的正式事件不会回滚。',
      requestPhase: boundary.phase, responseStatus: boundary.status,
    }
  }
  if (/预算|token|上下文窗口|调用上限|长度|too large/i.test(message)) {
    return {
      kind: 'budget', code: 'runtime_ai_budget_blocked', category: 'budget', action: 'pause-for-author',
      retryable: false, unknownResult: false, possibleCharge: responseObserved,
      message: '本次生成超出已声明的上下文或输出预算，未采用 AI 结果。',
      recovery: '缩短输入或改用更大上下文模型后，再重新发起生成。',
      requestPhase: boundary.phase, responseStatus: boundary.status,
    }
  }
  if (cause instanceof AICompletionResponseErrorV1
    || cause instanceof SyntaxError
    || /JSON|协议|解析|schema|字段|结构化|允许闭集|不得|无效/i.test(message)) {
    return {
      kind: 'protocol', code: 'runtime_ai_protocol_blocked', category: 'protocol', action: 'retry',
      retryable: true, unknownResult: false, possibleCharge: responseObserved,
      message: '模型返回内容没有通过游戏协议校验，未写入任何正式状态。',
      recovery: '可以明确重试一次；若再次失败，请切换模型或继续使用固定玩法。',
      requestPhase: boundary.phase, responseStatus: boundary.status,
    }
  }
  if (/network|fetch|socket|超时|网络|服务暂不可用/i.test(message)) {
    return {
      kind: 'provider-unavailable', code: 'provider_transient', category: 'transient',
      action: 'retry', retryable: true, unknownResult: false, possibleCharge: false,
      message: '模型请求在发出前或已确认失败后中断。',
      recovery: '网络恢复后可明确重试一次；系统不会自动重发。',
      requestPhase: boundary.phase, responseStatus: boundary.status,
    }
  }
  if (responseObserved) {
    return {
      kind: 'protocol', code: 'runtime_ai_candidate_blocked', category: 'protocol',
      action: 'retry', retryable: true, unknownResult: false, possibleCharge: true,
      message: '模型候选没有通过当前游戏边界校验，未写入任何正式状态。',
      recovery: '可以明确重试一次；若再次失败，请继续使用固定玩法。',
      requestPhase: boundary.phase, responseStatus: boundary.status,
    }
  }
  return {
    kind: 'configuration', code: 'runtime_ai_execution_blocked', category: 'unknown',
    action: 'pause-for-author', retryable: false, unknownResult: false,
    possibleCharge: responseObserved,
    message: '运行时 AI 没有完成，本次未采用任何候选。',
    recovery: '固定选项和系统操作仍可继续；检查模型配置后可重新发起。',
    requestPhase: boundary.phase, responseStatus: boundary.status,
  }
}

export async function classifyTextOpenWorldRuntimeAIFailureV1(input: {
  error: unknown
  providerResponseObserved?: boolean
}): Promise<TextOpenWorldRuntimeAIFailureV1> {
  if (input.error instanceof TextOpenWorldRuntimeAIPlayerErrorV1) return input.error.failure
  const decision = decide(input.error, input.providerResponseObserved ?? false)
  return {
    version: 1,
    ...decision,
    fingerprint: await hashCanonicalValue({
      version: 1,
      kind: decision.kind,
      code: decision.code,
      category: decision.category,
      requestPhase: decision.requestPhase,
      responseStatus: decision.responseStatus,
      errorName: underlying(input.error) instanceof Error
        ? (underlying(input.error) as Error).name
        : typeof underlying(input.error),
      message: normalizedMessage(underlying(input.error)),
    }),
  }
}

export async function failTextOpenWorldRuntimeAIRunV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
  runId: number
  stepId: string
  error: unknown
  signal?: AbortSignal
  providerResponseObserved?: boolean
}): Promise<TextOpenWorldRuntimeAIPlayerErrorV1> {
  const failure = await classifyTextOpenWorldRuntimeAIFailureV1({
    error: input.error,
    providerResponseObserved: input.providerResponseObserved,
  })
  let snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (snapshot.projection.steps[input.stepId]?.status === 'running') {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope,
      runId: input.runId,
      productRuntimeSessionId: input.productRuntimeSessionId,
      type: 'step.failed',
      payload: {
        stepId: input.stepId,
        attempt: 1,
        code: failure.code,
        retryable: failure.retryable,
        category: failure.category,
        action: failure.action,
        fingerprint: failure.fingerprint,
      },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
  }
  if (!['completed', 'failed', 'cancelled', 'paused'].includes(snapshot.projection.state)) {
    if (failure.kind === 'cancelled' && input.signal?.aborted) {
      await appendAgentRunEventV1({
        scope: input.scope, runId: input.runId,
        productRuntimeSessionId: input.productRuntimeSessionId,
        type: 'run.cancelled', payload: { reason: failure.code },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
    } else if (failure.action === 'pause-for-author') {
      await appendAgentRunEventV1({
        scope: input.scope, runId: input.runId,
        productRuntimeSessionId: input.productRuntimeSessionId,
        type: 'run.paused', payload: { reason: failure.code, recoverable: true },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
    } else {
      await appendAgentRunEventV1({
        scope: input.scope, runId: input.runId,
        productRuntimeSessionId: input.productRuntimeSessionId,
        type: 'run.failed', payload: { code: failure.code, retryable: failure.retryable },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
    }
  }
  return new TextOpenWorldRuntimeAIPlayerErrorV1(input.error, failure)
}
