import { AIError } from '../../types'
import type {
  AgentRunFailureActionV1,
  AgentRunFailureCategoryV1,
  AnyAgentRunEventV1,
} from '../../types/agent-run'
import { AgentTeamBudgetExceededError } from '../team-budget'
import { hashCanonicalValue } from './hash'

export interface AgentRunFailureEvidenceV1 {
  code: string
  retryable: boolean
  category: AgentRunFailureCategoryV1
  action: AgentRunFailureActionV1
  fingerprint: string
}

function normalizedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .trim()
    .replace(/[a-f0-9]{32,}/gi, '<hash>')
    .replace(/\b\d{3,}\b/g, '<n>')
    .slice(0, 500)
}

function decision(error: unknown): Omit<AgentRunFailureEvidenceV1, 'fingerprint'> {
  if (error instanceof AgentTeamBudgetExceededError) {
    return { code: 'team_budget_exhausted', retryable: false, category: 'budget', action: 'fail' }
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'host_interrupted', retryable: true, category: 'cancelled', action: 'retry' }
  }
  if (error instanceof AIError) {
    if ([408, 409, 425, 429].includes(error.status) || error.status >= 500) {
      return { code: 'provider_transient', retryable: true, category: 'transient', action: 'retry' }
    }
    if (error.status === 401 || error.status === 403) {
      return { code: 'provider_authorization', retryable: false, category: 'deterministic', action: 'pause-for-author' }
    }
    return { code: 'provider_request_rejected', retryable: false, category: 'deterministic', action: 'pause-for-author' }
  }

  const message = normalizedMessage(error)
  if (/stale|过期|已变化|依赖.*不一致|上下文.*不一致|快照.*不匹配/i.test(message)) {
    return { code: 'stale_input', retryable: false, category: 'stale-input', action: 'replan' }
  }
  if (/JSON|协议|解析|格式|schema|结构化/i.test(message) || error instanceof SyntaxError) {
    return { code: 'protocol_error', retryable: true, category: 'protocol', action: 'retry' }
  }
  if (/Canon|确定性.*校验|硬门|gate|违反.*约束/i.test(message)) {
    return { code: 'deterministic_verification_failed', retryable: false, category: 'deterministic', action: 'replan' }
  }
  if (/timeout|timed out|network|fetch|socket|超时|网络|限流|服务暂不可用/i.test(message)) {
    return { code: 'provider_transient', retryable: true, category: 'transient', action: 'retry' }
  }
  return { code: 'execution_unknown', retryable: true, category: 'unknown', action: 'retry' }
}

export async function classifyAgentRunFailureV1(error: unknown): Promise<AgentRunFailureEvidenceV1> {
  const classified = decision(error)
  return {
    ...classified,
    fingerprint: await hashCanonicalValue({
      version: 1,
      category: classified.category,
      code: classified.code,
      name: error instanceof Error ? error.name : typeof error,
      message: normalizedMessage(error),
      status: error instanceof AIError ? error.status : null,
    }),
  }
}

export function matchingFailureCountV1(
  events: readonly AnyAgentRunEventV1[],
  input: { generation: number; stepId: string; fingerprint: string },
): number {
  return events.filter(event => (
    event.generation === input.generation
    && event.type === 'step.failed'
    && event.payload.stepId === input.stepId
    && event.payload.fingerprint === input.fingerprint
  )).length
}
