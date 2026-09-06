import { AIError } from '../../types'
import { isProviderQuotaRejectionV1 } from '../../ai/provider-rejection'
import { AICompletionResponseErrorV1 } from '../../ai/completion-response'
import { AgentTeamBudgetExceededError } from '../team-budget'
import {
  StructuredOutputPipelineErrorV1,
  StructuredOutputRepairFailedErrorV1,
  type StructuredOutputIssueCategoryV1,
} from '../structured-output-pipeline'
import { hashCanonicalValue } from './hash'

export const HARNESS_FAILURE_CLASSES_V1 = [
  'save',
  'scope',
  'context',
  'budget',
  'provider',
  'parse',
  'schema',
  'gate',
  'candidate',
  'stale',
  'adoption',
  'terminal',
] as const

export type HarnessFailureClassV1 = typeof HARNESS_FAILURE_CLASSES_V1[number]

export const HARNESS_FAILURE_LABELS_V1: Record<HarnessFailureClassV1, string> = {
  save: '作者内容保存',
  scope: '项目/世界作用域',
  context: '上下文装配',
  budget: '上下文或调用预算',
  provider: '模型服务',
  parse: '模型输出解析',
  schema: '结构化字段校验',
  gate: '确定性门禁',
  candidate: '候选持久化/同步',
  stale: '候选已过期',
  adoption: '正式采纳',
  terminal: '终态验证',
}

export interface HarnessFailureEvidenceV1 {
  version: 1
  failureClass: HarnessFailureClassV1
  label: string
  code: string
  retryable: boolean
  fingerprint: string
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .trim()
    .replace(/[a-f0-9]{32,}/gi, '<hash>')
    .replace(/\b\d{3,}\b/g, '<n>')
    .slice(0, 500)
}

function classForStructuredIssues(
  categories: readonly StructuredOutputIssueCategoryV1[],
): HarnessFailureClassV1 {
  if (categories.includes('stale')) return 'stale'
  if (categories.includes('scope')) return 'scope'
  if (categories.includes('permission') || categories.includes('target')) return 'gate'
  if (categories.includes('parse')) return 'parse'
  if (categories.includes('schema')) return 'schema'
  if (categories.includes('length')) return 'budget'
  return 'schema'
}

function decide(
  error: unknown,
  stage?: HarnessFailureClassV1,
): Omit<HarnessFailureEvidenceV1, 'version' | 'label' | 'fingerprint'> {
  if (
    error instanceof Error
    && error.name === 'HarnessInjectedFaultV1'
    && typeof (error as Error & { failureClass?: unknown }).failureClass === 'string'
    && HARNESS_FAILURE_CLASSES_V1.includes(
      (error as Error & { failureClass: HarnessFailureClassV1 }).failureClass,
    )
  ) {
    const failureClass = (error as Error & { failureClass: HarnessFailureClassV1 }).failureClass
    return { failureClass, code: `${failureClass}_fault_injected`, retryable: true }
  }
  if (error instanceof AgentTeamBudgetExceededError) {
    return { failureClass: 'budget', code: 'team_budget_exhausted', retryable: false }
  }
  if (error instanceof StructuredOutputPipelineErrorV1) {
    const failureClass = classForStructuredIssues(error.evidence.issues.map(issue => issue.category))
    return { failureClass, code: `structured_output_${failureClass}`, retryable: error.retryable }
  }
  if (error instanceof StructuredOutputRepairFailedErrorV1) {
    const categories = error.runEvidence.attempts.flatMap(attempt => (
      attempt.evidence.issues.map(issue => issue.category)
    ))
    const failureClass = classForStructuredIssues(categories)
    return { failureClass, code: `structured_output_repair_${failureClass}`, retryable: false }
  }
  if (error instanceof AICompletionResponseErrorV1) {
    return { failureClass: 'provider', code: `provider_response_${error.problem}`, retryable: false }
  }
  if (error instanceof AIError) {
    const quotaRejected = isProviderQuotaRejectionV1({
      status: error.status,
      message: error.message,
    })
    return {
      failureClass: 'provider',
      code: quotaRejected
        ? 'provider_quota'
        : error.status === 401 || error.status === 403
        ? 'provider_authorization'
        : [408, 409, 425, 429].includes(error.status) || error.status >= 500
          ? 'provider_transient'
          : 'provider_request_rejected',
      retryable: !quotaRejected
        && ([408, 409, 425, 429].includes(error.status) || error.status >= 500),
    }
  }
  const normalized = message(error)
  if (/stale|过期|已变化|依赖.*不一致|修订向量|上下文.*不一致|快照.*不匹配/i.test(normalized)) {
    return { failureClass: 'stale', code: 'stale_input', retryable: false }
  }
  if (/作者编辑保存失败|Pending edit|保存.*失败|flush/i.test(normalized)) {
    return { failureClass: 'save', code: 'author_save_failed', retryable: true }
  }
  if (/越界|作用域|不属于当前 (?:Work|World)|WorkspaceScope|worldGroupId|scope/i.test(normalized)) {
    return { failureClass: 'scope', code: 'scope_mismatch', retryable: false }
  }
  if (/上下文|assembleContext|Context Manifest|压缩产物|来源.*预算/i.test(normalized)) {
    return { failureClass: 'context', code: 'context_assembly_failed', retryable: true }
  }
  if (/预算|token|上下文窗口|调用上限|长度|too large/i.test(normalized)) {
    return { failureClass: 'budget', code: 'budget_exhausted', retryable: false }
  }
  if (/候选.*(?:不存在|缺少|损坏|同步|持久化)|CandidateDraft|candidate event/i.test(normalized)) {
    return { failureClass: 'candidate', code: 'candidate_unavailable', retryable: true }
  }
  if (/终态|terminal|receipt|verification/i.test(normalized)) {
    return { failureClass: 'terminal', code: 'terminal_verification_failed', retryable: true }
  }
  if (/采纳|adoption|正式写入/i.test(normalized)) {
    return { failureClass: 'adoption', code: 'adoption_failed', retryable: true }
  }
  if (/JSON|解析|语法|Syntax/i.test(normalized) || error instanceof SyntaxError) {
    return { failureClass: 'parse', code: 'output_parse_failed', retryable: true }
  }
  if (/schema|字段|结构化|协议/i.test(normalized)) {
    return { failureClass: 'schema', code: 'output_schema_failed', retryable: true }
  }
  if (/Canon|门禁|gate|权限|约束|校验/i.test(normalized)) {
    return { failureClass: 'gate', code: 'deterministic_gate_blocked', retryable: false }
  }
  if (/timeout|timed out|network|fetch|socket|超时|网络|限流|服务暂不可用|AbortError/i.test(normalized)) {
    return { failureClass: 'provider', code: 'provider_transient', retryable: true }
  }
  return {
    failureClass: stage ?? 'provider',
    code: stage ? `${stage}_unknown` : 'execution_unknown',
    retryable: true,
  }
}

/** Deterministic product-level classification shared by UI errors and durable evidence. */
export async function classifyHarnessFailureV1(
  error: unknown,
  options: { stage?: HarnessFailureClassV1 } = {},
): Promise<HarnessFailureEvidenceV1> {
  const result = decide(error, options.stage)
  return {
    version: 1,
    ...result,
    label: HARNESS_FAILURE_LABELS_V1[result.failureClass],
    fingerprint: await hashCanonicalValue({
      version: 1,
      failureClass: result.failureClass,
      code: result.code,
      name: error instanceof Error ? error.name : typeof error,
      message: message(error),
      status: error instanceof AIError ? error.status : null,
    }),
  }
}
