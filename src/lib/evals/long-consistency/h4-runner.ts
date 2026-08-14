import type { ChatMessage } from '../../types'
import { estimateTokens } from '../../ai/context-budget'
import { canonicalStringify, hashCanonicalValue } from '../../agent/run/hash'
import {
  assertExactKeys,
  assertUnique,
  failSchema,
  readArray,
  readEnum,
  readHash,
  readInteger,
  readNonNegativeNumber,
  readRecord,
  readString,
} from '../../agent/run/schema-utils'
import {
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V1,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V2,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V3,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V4,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V5,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V6,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V7,
  createLongConsistencyJudgeRepairV1,
  createLongConsistencyFixtureBindingV1,
  parseLongConsistencyEvalArtifactV1,
  runLongConsistencySemanticAuditV1,
  verifyLongConsistencyEvalArtifactV1,
} from './evidence-report'
import {
  H4_LONG_CONSISTENCY_FIXTURES_V1,
  H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
  getH4LongConsistencyFixturesV1,
  toH4ModelVisibleFixtureV1,
  type H4LongConsistencyFixtureV1,
  type H4LongConsistencyModelVisibleFixtureV1,
} from './h4-fixtures'
import type {
  LongConsistencyAuditCallResultV1,
} from './evidence-report'
import type {
  LongConsistencyEvalArtifactV1,
  LongConsistencyModelBindingV1,
  LongConsistencyModelUsageV1,
} from './report-types'
import type { EvalSplit } from './types'

export const H4_LONG_CONSISTENCY_RUNNER_VERSION_V1 = 'h4-verifier-runner-v1'
export const H4_LONG_CONSISTENCY_CHECKPOINT_TYPE_V1 = 'storyforge-h4-verifier-checkpoint'

export type H4LongConsistencyRunStatusV1 = 'running' | 'completed' | 'failed' | 'budget-exhausted'

export interface H4LongConsistencyRunBudgetV1 {
  maxModelCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  maxDurationMs: number
  maxCostUsd: number
}

export interface H4LongConsistencyRunUsageV1 {
  modelCalls: number
  meteredModelCalls: number
  unmeteredModelCalls: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  costUsd: number
}

export interface H4LongConsistencyCompletedCaseV1 {
  fixtureId: string
  attempts: number
  rawJudgeOutput: string
  artifact: LongConsistencyEvalArtifactV1
}

export interface H4LongConsistencyRunFailureV1 {
  fixtureId: string
  attempt: number
  code: string
  message: string
  usage: LongConsistencyModelUsageV1 | null
}

export interface H4LongConsistencyRunCheckpointV1 {
  schemaVersion: 1
  checkpointType: typeof H4_LONG_CONSISTENCY_CHECKPOINT_TYPE_V1
  runnerVersion: typeof H4_LONG_CONSISTENCY_RUNNER_VERSION_V1
  fixtureVersion: typeof H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1
  runId: string
  split: EvalSplit
  codeRevision: string
  createdAt: string
  updatedAt: string
  status: H4LongConsistencyRunStatusV1
  execution: {
    generator: LongConsistencyModelBindingV1
    verifier: LongConsistencyModelBindingV1
  }
  maxAttemptsPerFixture: number
  budget: H4LongConsistencyRunBudgetV1
  fixtureIds: string[]
  fixtureSetHash: string
  attempts: Array<{ fixtureId: string; count: number }>
  completed: H4LongConsistencyCompletedCaseV1[]
  failures: H4LongConsistencyRunFailureV1[]
  usage: H4LongConsistencyRunUsageV1
  checkpointHash: string
}

export interface H4LongConsistencyVerifierCallInputV1 {
  fixture: Pick<H4LongConsistencyModelVisibleFixtureV1, 'id' | 'split' | 'task'>
  messages: ChatMessage[]
  verifier: LongConsistencyModelBindingV1
  attempt: number
  traceHash: string
}

export interface RunH4LongConsistencyVerifierInputV1 {
  runId: string
  split: EvalSplit
  codeRevision: string
  execution: H4LongConsistencyRunCheckpointV1['execution']
  call: (input: H4LongConsistencyVerifierCallInputV1) => Promise<LongConsistencyAuditCallResultV1>
  fixtureIds?: string[]
  maxAttemptsPerFixture?: number
  budget?: Partial<H4LongConsistencyRunBudgetV1>
  resumeFrom?: unknown
  now?: () => number
  onCheckpoint?: (checkpoint: H4LongConsistencyRunCheckpointV1) => void | Promise<void>
  onProgress?: (completed: number, total: number) => void
}

const CHECKPOINT_STATUSES = ['running', 'completed', 'failed', 'budget-exhausted'] as const
const SUPPORTED_JUDGE_PROMPT_VERSIONS = [
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V1,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V2,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V3,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V4,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V5,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V6,
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V7,
] as const

function supportsJudgeRepair(promptVersion: string): boolean {
  return promptVersion === LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V4
    || promptVersion === LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V5
    || promptVersion === LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V6
    || promptVersion === LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V7
}

function repeatedRepairWouldBeIdentical(
  failures: readonly H4LongConsistencyRunFailureV1[],
  fixtureId: string,
  completedAttempts: number,
): boolean {
  if (completedAttempts < 2) return false
  const prior = failures.find(failure => (
    failure.fixtureId === fixtureId && failure.attempt === completedAttempts - 1
  ))
  const latest = failures.find(failure => (
    failure.fixtureId === fixtureId && failure.attempt === completedAttempts
  ))
  if (!prior || !latest) return false
  const priorRepair = createLongConsistencyJudgeRepairV1(prior.code)
  const latestRepair = createLongConsistencyJudgeRepairV1(latest.code)
  return priorRepair != null && sameValue(priorRepair, latestRepair)
}

function isSupportedJudgePromptVersion(value: string): boolean {
  return SUPPORTED_JUDGE_PROMPT_VERSIONS.some(version => version === value)
}

function isoTimestamp(value: unknown, path: string): string {
  const text = readString(value, path, { max: 40 })
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== text) {
    failSchema('invalid_value', path, '必须是规范 ISO 时间')
  }
  return text
}

function rawString(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    failSchema('invalid_value', path, `必须是长度不超过 ${max} 的非空字符串`)
  }
  return value
}

function parseModelBinding(value: unknown, path: string): LongConsistencyModelBindingV1 {
  const record = readRecord(value, path)
  const keys = ['provider', 'model', 'promptVersion'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    provider: readString(record.provider, `${path}.provider`, { max: 120 }),
    model: readString(record.model, `${path}.model`, { max: 200 }),
    promptVersion: readString(record.promptVersion, `${path}.promptVersion`, { max: 160 }),
  }
}

function parseBudget(value: unknown, path: string): H4LongConsistencyRunBudgetV1 {
  const record = readRecord(value, path)
  const keys = ['maxModelCalls', 'maxInputTokens', 'maxOutputTokens', 'maxDurationMs', 'maxCostUsd'] as const
  assertExactKeys(record, keys, keys, path)
  const budget = {
    maxModelCalls: readInteger(record.maxModelCalls, `${path}.maxModelCalls`, { min: 1 }),
    maxInputTokens: readInteger(record.maxInputTokens, `${path}.maxInputTokens`, { min: 1 }),
    maxOutputTokens: readInteger(record.maxOutputTokens, `${path}.maxOutputTokens`, { min: 1 }),
    maxDurationMs: readNonNegativeNumber(record.maxDurationMs, `${path}.maxDurationMs`),
    maxCostUsd: readNonNegativeNumber(record.maxCostUsd, `${path}.maxCostUsd`),
  }
  if (budget.maxDurationMs <= 0 || budget.maxCostUsd <= 0) {
    failSchema('invalid_value', path, '时长与成本预算必须大于 0')
  }
  return budget
}

function parseModelUsage(value: unknown, path: string): LongConsistencyModelUsageV1 {
  const record = readRecord(value, path)
  const keys = ['inputTokens', 'outputTokens', 'durationMs', 'costUsd'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    inputTokens: readInteger(record.inputTokens, `${path}.inputTokens`),
    outputTokens: readInteger(record.outputTokens, `${path}.outputTokens`),
    durationMs: readNonNegativeNumber(record.durationMs, `${path}.durationMs`),
    costUsd: readNonNegativeNumber(record.costUsd, `${path}.costUsd`),
  }
}

function parseUsage(value: unknown, path: string): H4LongConsistencyRunUsageV1 {
  const record = readRecord(value, path)
  const keys = [
    'modelCalls',
    'meteredModelCalls',
    'unmeteredModelCalls',
    'inputTokens',
    'outputTokens',
    'durationMs',
    'costUsd',
  ] as const
  assertExactKeys(record, keys, keys, path)
  const usage = {
    modelCalls: readInteger(record.modelCalls, `${path}.modelCalls`),
    meteredModelCalls: readInteger(record.meteredModelCalls, `${path}.meteredModelCalls`),
    unmeteredModelCalls: readInteger(record.unmeteredModelCalls, `${path}.unmeteredModelCalls`),
    inputTokens: readInteger(record.inputTokens, `${path}.inputTokens`),
    outputTokens: readInteger(record.outputTokens, `${path}.outputTokens`),
    durationMs: readNonNegativeNumber(record.durationMs, `${path}.durationMs`),
    costUsd: readNonNegativeNumber(record.costUsd, `${path}.costUsd`),
  }
  if (usage.meteredModelCalls + usage.unmeteredModelCalls !== usage.modelCalls) {
    failSchema('invalid_value', path, 'metered + unmetered 必须等于 modelCalls')
  }
  return usage
}

function parseFailure(value: unknown, path: string): H4LongConsistencyRunFailureV1 | null {
  if (value === null) return null
  const record = readRecord(value, path)
  const keys = ['fixtureId', 'attempt', 'code', 'message', 'usage'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    fixtureId: readString(record.fixtureId, `${path}.fixtureId`, { max: 160 }),
    attempt: readInteger(record.attempt, `${path}.attempt`, { min: 1 }),
    code: readString(record.code, `${path}.code`, { max: 120 }),
    message: readString(record.message, `${path}.message`, { max: 500 }),
    usage: record.usage === null ? null : parseModelUsage(record.usage, `${path}.usage`),
  }
}

function parseCompletedCase(value: unknown, path: string): H4LongConsistencyCompletedCaseV1 {
  const record = readRecord(value, path)
  const keys = ['fixtureId', 'attempts', 'rawJudgeOutput', 'artifact'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    fixtureId: readString(record.fixtureId, `${path}.fixtureId`, { max: 160 }),
    attempts: readInteger(record.attempts, `${path}.attempts`, { min: 1 }),
    rawJudgeOutput: rawString(record.rawJudgeOutput, `${path}.rawJudgeOutput`, 500_000),
    artifact: parseLongConsistencyEvalArtifactV1(record.artifact),
  }
}

export function parseH4LongConsistencyRunCheckpointV1(value: unknown): H4LongConsistencyRunCheckpointV1 {
  const record = readRecord(value, 'checkpoint')
  const keys = [
    'schemaVersion',
    'checkpointType',
    'runnerVersion',
    'fixtureVersion',
    'runId',
    'split',
    'codeRevision',
    'createdAt',
    'updatedAt',
    'status',
    'execution',
    'maxAttemptsPerFixture',
    'budget',
    'fixtureIds',
    'fixtureSetHash',
    'attempts',
    'completed',
    'failures',
    'usage',
    'checkpointHash',
  ] as const
  assertExactKeys(record, keys, keys, 'checkpoint')
  if (record.schemaVersion !== 1) failSchema('unsupported_version', 'checkpoint.schemaVersion', '仅支持版本 1')
  if (record.checkpointType !== H4_LONG_CONSISTENCY_CHECKPOINT_TYPE_V1) {
    failSchema('invalid_value', 'checkpoint.checkpointType', '不是 H4 verifier checkpoint')
  }
  if (record.runnerVersion !== H4_LONG_CONSISTENCY_RUNNER_VERSION_V1) {
    failSchema('unsupported_version', 'checkpoint.runnerVersion', 'runner 版本不匹配')
  }
  if (record.fixtureVersion !== H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1) {
    failSchema('unsupported_version', 'checkpoint.fixtureVersion', 'fixture 版本不匹配')
  }
  const executionRecord = readRecord(record.execution, 'checkpoint.execution')
  const executionKeys = ['generator', 'verifier'] as const
  assertExactKeys(executionRecord, executionKeys, executionKeys, 'checkpoint.execution')
  const fixtureIds = readArray(record.fixtureIds, 'checkpoint.fixtureIds').map((item, index) => (
    readString(item, `checkpoint.fixtureIds[${index}]`, { max: 160 })
  ))
  if (!fixtureIds.length || fixtureIds.length > H4_LONG_CONSISTENCY_FIXTURES_V1.length) {
    failSchema('invalid_value', 'checkpoint.fixtureIds', '数量必须在 1 到 60 之间')
  }
  assertUnique(fixtureIds, 'checkpoint.fixtureIds')
  const attempts = readArray(record.attempts, 'checkpoint.attempts').map((item, index) => {
    const path = `checkpoint.attempts[${index}]`
    const attempt = readRecord(item, path)
    const attemptKeys = ['fixtureId', 'count'] as const
    assertExactKeys(attempt, attemptKeys, attemptKeys, path)
    return {
      fixtureId: readString(attempt.fixtureId, `${path}.fixtureId`, { max: 160 }),
      count: readInteger(attempt.count, `${path}.count`),
    }
  })
  assertUnique(attempts.map(item => item.fixtureId), 'checkpoint.attempts.fixtureId')
  const completed = readArray(record.completed, 'checkpoint.completed').map((item, index) => (
    parseCompletedCase(item, `checkpoint.completed[${index}]`)
  ))
  assertUnique(completed.map(item => item.fixtureId), 'checkpoint.completed.fixtureId')
  const failures = readArray(record.failures, 'checkpoint.failures').map((item, index) => {
    const failure = parseFailure(item, `checkpoint.failures[${index}]`)
    if (!failure) failSchema('invalid_value', `checkpoint.failures[${index}]`, '不得是 null')
    return failure
  })
  return {
    schemaVersion: 1,
    checkpointType: H4_LONG_CONSISTENCY_CHECKPOINT_TYPE_V1,
    runnerVersion: H4_LONG_CONSISTENCY_RUNNER_VERSION_V1,
    fixtureVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
    runId: readString(record.runId, 'checkpoint.runId', { max: 160 }),
    split: readEnum(record.split, ['development', 'held-out'], 'checkpoint.split'),
    codeRevision: readString(record.codeRevision, 'checkpoint.codeRevision', { max: 120 }),
    createdAt: isoTimestamp(record.createdAt, 'checkpoint.createdAt'),
    updatedAt: isoTimestamp(record.updatedAt, 'checkpoint.updatedAt'),
    status: readEnum(record.status, CHECKPOINT_STATUSES, 'checkpoint.status'),
    execution: {
      generator: parseModelBinding(executionRecord.generator, 'checkpoint.execution.generator'),
      verifier: parseModelBinding(executionRecord.verifier, 'checkpoint.execution.verifier'),
    },
    maxAttemptsPerFixture: readInteger(
      record.maxAttemptsPerFixture,
      'checkpoint.maxAttemptsPerFixture',
      { min: 1 },
    ),
    budget: parseBudget(record.budget, 'checkpoint.budget'),
    fixtureIds,
    fixtureSetHash: readHash(record.fixtureSetHash, 'checkpoint.fixtureSetHash'),
    attempts,
    completed,
    failures,
    usage: parseUsage(record.usage, 'checkpoint.usage'),
    checkpointHash: readHash(record.checkpointHash, 'checkpoint.checkpointHash'),
  }
}

function checkpointBody(
  checkpoint: H4LongConsistencyRunCheckpointV1,
): Omit<H4LongConsistencyRunCheckpointV1, 'checkpointHash'> {
  const { checkpointHash: _checkpointHash, ...body } = checkpoint
  return body
}

async function signCheckpoint(
  checkpoint: Omit<H4LongConsistencyRunCheckpointV1, 'checkpointHash'>,
): Promise<H4LongConsistencyRunCheckpointV1> {
  return parseH4LongConsistencyRunCheckpointV1({
    ...checkpoint,
    checkpointHash: await hashCanonicalValue(checkpoint),
  })
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

function selectFixtures(split: EvalSplit, fixtureIds?: readonly string[]): H4LongConsistencyFixtureV1[] {
  const available = getH4LongConsistencyFixturesV1(split)
  if (!fixtureIds) return available
  assertUnique(fixtureIds, 'fixtureIds')
  const byId = new Map(available.map(fixture => [fixture.id, fixture] as const))
  return fixtureIds.map(id => {
    const fixture = byId.get(id)
    if (!fixture) throw new Error(`H4 ${split} 中不存在 fixture ${id}`)
    return fixture
  })
}

async function fixtureBindings(fixtures: readonly H4LongConsistencyFixtureV1[]) {
  return Promise.all(fixtures.map(async fixture => await createLongConsistencyFixtureBindingV1({
    id: fixture.id,
    split: fixture.split,
    task: fixture.task,
    modelInput: toH4ModelVisibleFixtureV1(fixture),
    hiddenLabels: fixture.hiddenLabels,
  })))
}

function aggregateUsage(checkpoint: Pick<H4LongConsistencyRunCheckpointV1, 'attempts' | 'completed' | 'failures'>) {
  const completedUsage = checkpoint.completed.reduce<H4LongConsistencyRunUsageV1>((usage, item) => ({
    ...usage,
    meteredModelCalls: usage.meteredModelCalls + 1,
    inputTokens: usage.inputTokens + item.artifact.execution.verifierUsage.inputTokens,
    outputTokens: usage.outputTokens + item.artifact.execution.verifierUsage.outputTokens,
    durationMs: usage.durationMs + item.artifact.execution.verifierUsage.durationMs,
    costUsd: usage.costUsd + item.artifact.execution.verifierUsage.costUsd,
  }), {
    modelCalls: checkpoint.attempts.reduce((sum, item) => sum + item.count, 0),
    meteredModelCalls: 0,
    unmeteredModelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
  })
  const usage = checkpoint.failures.reduce<H4LongConsistencyRunUsageV1>((total, failure) => (
    failure.usage
      ? {
          ...total,
          meteredModelCalls: total.meteredModelCalls + 1,
          inputTokens: total.inputTokens + failure.usage.inputTokens,
          outputTokens: total.outputTokens + failure.usage.outputTokens,
          durationMs: total.durationMs + failure.usage.durationMs,
          costUsd: total.costUsd + failure.usage.costUsd,
        }
      : { ...total, unmeteredModelCalls: total.unmeteredModelCalls + 1 }
  ), completedUsage)
  const accounted = usage.meteredModelCalls + usage.unmeteredModelCalls
  return accounted < usage.modelCalls
    ? { ...usage, unmeteredModelCalls: usage.unmeteredModelCalls + usage.modelCalls - accounted }
    : usage
}

function budgetExceeded(usage: H4LongConsistencyRunUsageV1, budget: H4LongConsistencyRunBudgetV1): boolean {
  return usage.modelCalls >= budget.maxModelCalls
    || usage.inputTokens >= budget.maxInputTokens
    || usage.outputTokens >= budget.maxOutputTokens
    || usage.durationMs >= budget.maxDurationMs
    || usage.costUsd >= budget.maxCostUsd
}

function budgetOvershot(usage: H4LongConsistencyRunUsageV1, budget: H4LongConsistencyRunBudgetV1): boolean {
  return usage.modelCalls > budget.maxModelCalls
    || usage.inputTokens > budget.maxInputTokens
    || usage.outputTokens > budget.maxOutputTokens
    || usage.durationMs > budget.maxDurationMs
    || usage.costUsd > budget.maxCostUsd
}

function failureFrom(
  error: unknown,
  fixtureId: string,
  attempt: number,
  usage: LongConsistencyModelUsageV1 | null,
): H4LongConsistencyRunFailureV1 {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown; status?: unknown }
    : null
  const status = typeof candidate?.status === 'number' ? candidate.status : 0
  const nonRetryableProviderError = status >= 400
    && status < 500
    && status !== 408
    && status !== 409
    && status !== 425
    && status !== 429
  const code = nonRetryableProviderError
    ? 'verifier_error_non_retryable'
    : typeof candidate?.code === 'string' && candidate.code.trim()
      ? candidate.code.trim().slice(0, 120)
      : 'verifier_error'
  const message = typeof candidate?.message === 'string' && candidate.message.trim()
    ? candidate.message.trim().slice(0, 500)
    : String(error).slice(0, 500) || 'unknown verifier error'
  return { fixtureId, attempt, code, message, usage }
}

async function assertCheckpointAgainstCatalog(checkpoint: H4LongConsistencyRunCheckpointV1): Promise<void> {
  if (await hashCanonicalValue(checkpointBody(checkpoint)) !== checkpoint.checkpointHash) {
    throw new Error('H4 checkpoint hash 不匹配')
  }
  if (
    checkpoint.execution.generator.provider === checkpoint.execution.verifier.provider
    && checkpoint.execution.generator.model === checkpoint.execution.verifier.model
  ) throw new Error('H4 checkpoint 的 generator/verifier 身份未隔离')
  if (!isSupportedJudgePromptVersion(checkpoint.execution.verifier.promptVersion)) {
    throw new Error('H4 checkpoint verifier Prompt 版本不匹配')
  }
  const fixtures = selectFixtures(checkpoint.split, checkpoint.fixtureIds)
  const bindings = await fixtureBindings(fixtures)
  if (await hashCanonicalValue(bindings) !== checkpoint.fixtureSetHash) {
    throw new Error('H4 checkpoint fixture set 不匹配')
  }
  if (
    checkpoint.attempts.length !== fixtures.length
    || checkpoint.attempts.some((item, index) => item.fixtureId !== fixtures[index].id)
  ) throw new Error('H4 checkpoint attempts 与 fixture 顺序不匹配')
  if (Date.parse(checkpoint.updatedAt) < Date.parse(checkpoint.createdAt)) {
    throw new Error('H4 checkpoint updatedAt 早于 createdAt')
  }
  const maxAttempts = checkpoint.maxAttemptsPerFixture
  if (maxAttempts > 3 || checkpoint.attempts.some(item => item.count > maxAttempts)) {
    throw new Error('H4 checkpoint attempts 超出冻结上限')
  }
  const fixtureById = new Map(fixtures.map(fixture => [fixture.id, fixture] as const))
  const bindingById = new Map(bindings.map(binding => [binding.id, binding] as const))
  if (checkpoint.completed.some((item, index) => item.fixtureId !== fixtures[index]?.id)) {
    throw new Error('H4 checkpoint completed 必须是 fixture 目录的有序前缀')
  }
  const completedIds = new Set(checkpoint.completed.map(item => item.fixtureId))
  const failureKeys = checkpoint.failures.map(failure => `${failure.fixtureId}\u0000${failure.attempt}`)
  assertUnique(failureKeys, 'checkpoint.failures.fixtureAttempt')
  const expectedFailureKeys: string[] = []
  for (const [index, fixture] of fixtures.entries()) {
    const attemptCount = checkpoint.attempts[index].count
    if (index > checkpoint.completed.length && attemptCount !== 0) {
      throw new Error('H4 checkpoint 不得越过当前 fixture 记录尝试')
    }
    const successful = completedIds.has(fixture.id)
    const failureCount = successful ? attemptCount - 1 : attemptCount
    if (failureCount < 0) throw new Error(`H4 checkpoint 完成项 ${fixture.id} 缺少成功尝试`)
    for (let attempt = 1; attempt <= failureCount; attempt += 1) {
      expectedFailureKeys.push(`${fixture.id}\u0000${attempt}`)
    }
  }
  if (!sameValue(failureKeys, expectedFailureKeys)) {
    throw new Error('H4 checkpoint failure 历史必须与尝试顺序逐项对应')
  }
  for (const completed of checkpoint.completed) {
    const fixture = fixtureById.get(completed.fixtureId)
    if (!fixture) throw new Error(`H4 checkpoint 包含未知完成项 ${completed.fixtureId}`)
    const attempt = checkpoint.attempts.find(item => item.fixtureId === completed.fixtureId)!
    if (attempt.count !== completed.attempts || completed.attempts < 1) {
      throw new Error(`H4 checkpoint 完成项 ${completed.fixtureId} 的 attempts 不匹配`)
    }
    if (
      completed.artifact.runId !== `${checkpoint.runId}:${fixture.id}`
      || completed.artifact.codeRevision !== checkpoint.codeRevision
      || !sameValue(completed.artifact.fixture, bindingById.get(fixture.id))
      || !sameValue(completed.artifact.execution.generator, checkpoint.execution.generator)
      || !sameValue(completed.artifact.execution.verifier, checkpoint.execution.verifier)
    ) throw new Error(`H4 checkpoint 完成项 ${fixture.id} 的执行绑定不匹配`)
    const previousFailure = completed.attempts > 1
      ? checkpoint.failures.find(failure => (
          failure.fixtureId === fixture.id && failure.attempt === completed.attempts - 1
        ))
      : undefined
    const expectedJudgeRepair = supportsJudgeRepair(checkpoint.execution.verifier.promptVersion)
      ? previousFailure ? createLongConsistencyJudgeRepairV1(previousFailure.code) : null
      : undefined
    if (!sameValue(completed.artifact.judgeRepair, expectedJudgeRepair)) {
      throw new Error(`H4 checkpoint 完成项 ${fixture.id} 的纠错绑定不匹配`)
    }
    const expectedTraceHash = await hashCanonicalValue({
      runnerVersion: H4_LONG_CONSISTENCY_RUNNER_VERSION_V1,
      runId: checkpoint.runId,
      fixtureId: fixture.id,
      attempt: completed.attempts,
      verifier: checkpoint.execution.verifier,
    })
    if (!sameValue(completed.artifact.traceHashes, [expectedTraceHash])) {
      throw new Error(`H4 checkpoint 完成项 ${fixture.id} 的 trace 与成功尝试不匹配`)
    }
    if (!await verifyLongConsistencyEvalArtifactV1(completed.artifact, {
      sources: fixture.sources,
      rawJudgeOutput: completed.rawJudgeOutput,
    })) throw new Error(`H4 checkpoint 完成项 ${fixture.id} 的 artifact 无法验证`)
  }
  const usage = aggregateUsage(checkpoint)
  if (!sameValue(usage, checkpoint.usage)) throw new Error('H4 checkpoint usage 不可重算')
  if (checkpoint.status === 'completed' && checkpoint.completed.length !== fixtures.length) {
    throw new Error('H4 checkpoint 伪造 completed')
  }
  if (checkpoint.status === 'completed' && budgetOvershot(checkpoint.usage, checkpoint.budget)) {
    throw new Error('H4 checkpoint completed 超出冻结预算')
  }
  if (checkpoint.status === 'running' && checkpoint.completed.length === fixtures.length) {
    throw new Error('H4 checkpoint 已完成全部 fixture 却仍标记 running')
  }
  const currentAttempt = checkpoint.attempts[checkpoint.completed.length]?.count ?? 0
  if (checkpoint.status === 'running' && currentAttempt >= maxAttempts) {
    throw new Error('H4 checkpoint running 已耗尽当前 fixture 尝试')
  }
  if (checkpoint.status === 'failed' && checkpoint.failures.length === 0) {
    throw new Error('H4 checkpoint failed 缺少失败证据')
  }
  if (
    checkpoint.status === 'failed'
    && (
      checkpoint.completed.length === fixtures.length
      || (
        currentAttempt !== maxAttempts
        && checkpoint.failures[checkpoint.failures.length - 1]?.code !== 'verifier_error_non_retryable'
        && !repeatedRepairWouldBeIdentical(
          checkpoint.failures,
          fixtures[checkpoint.completed.length]?.id ?? '',
          currentAttempt,
        )
      )
    )
  ) throw new Error('H4 checkpoint failed 与终止尝试不匹配')
  if (checkpoint.status === 'budget-exhausted' && !budgetExceeded(checkpoint.usage, checkpoint.budget)) {
    throw new Error('H4 checkpoint budget-exhausted 缺少预算证据')
  }
}

export async function verifyH4LongConsistencyRunCheckpointV1(value: unknown): Promise<boolean> {
  try {
    const checkpoint = parseH4LongConsistencyRunCheckpointV1(value)
    await assertCheckpointAgainstCatalog(checkpoint)
    return true
  } catch {
    return false
  }
}

export async function exportH4LongConsistencyRunCheckpointV1(value: unknown): Promise<string> {
  const checkpoint = parseH4LongConsistencyRunCheckpointV1(value)
  if (!await verifyH4LongConsistencyRunCheckpointV1(checkpoint)) {
    throw new Error('H4 checkpoint 完整性验证失败，拒绝导出')
  }
  return JSON.stringify(checkpoint, null, 2)
}

export async function importH4LongConsistencyRunCheckpointV1(
  raw: string,
): Promise<H4LongConsistencyRunCheckpointV1> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('H4 checkpoint 不是有效 JSON')
  }
  const checkpoint = parseH4LongConsistencyRunCheckpointV1(value)
  if (!await verifyH4LongConsistencyRunCheckpointV1(checkpoint)) {
    throw new Error('H4 checkpoint 完整性验证失败，拒绝导入')
  }
  return checkpoint
}

function resolvedBudget(
  fixtureCount: number,
  maxAttemptsPerFixture: number,
  override: Partial<H4LongConsistencyRunBudgetV1> | undefined,
): H4LongConsistencyRunBudgetV1 {
  return parseBudget({
    maxModelCalls: override?.maxModelCalls ?? fixtureCount * maxAttemptsPerFixture,
    maxInputTokens: override?.maxInputTokens ?? 2_000_000,
    maxOutputTokens: override?.maxOutputTokens ?? 200_000,
    maxDurationMs: override?.maxDurationMs ?? 3_600_000,
    maxCostUsd: override?.maxCostUsd ?? 1_000,
  }, 'budget')
}

async function initialCheckpoint(input: RunH4LongConsistencyVerifierInputV1) {
  const fixtures = selectFixtures(input.split, input.fixtureIds)
  const maxAttemptsPerFixture = input.maxAttemptsPerFixture ?? 2
  if (!Number.isInteger(maxAttemptsPerFixture) || maxAttemptsPerFixture < 1 || maxAttemptsPerFixture > 3) {
    throw new Error('maxAttemptsPerFixture 必须在 1 到 3 之间')
  }
  const execution = {
    generator: parseModelBinding(input.execution.generator, 'execution.generator'),
    verifier: parseModelBinding(input.execution.verifier, 'execution.verifier'),
  }
  if (
    execution.generator.provider === execution.verifier.provider
    && execution.generator.model === execution.verifier.model
  ) throw new Error('H4 发布评测要求 generator 与 verifier 使用不同 provider/model 身份')
  if (!isSupportedJudgePromptVersion(execution.verifier.promptVersion)) {
    throw new Error(`H4 verifier promptVersion 必须是 ${SUPPORTED_JUDGE_PROMPT_VERSIONS.join(' 或 ')}`)
  }
  const timestamp = new Date(input.now?.() ?? Date.now()).toISOString()
  const bindings = await fixtureBindings(fixtures)
  return await signCheckpoint({
    schemaVersion: 1,
    checkpointType: H4_LONG_CONSISTENCY_CHECKPOINT_TYPE_V1,
    runnerVersion: H4_LONG_CONSISTENCY_RUNNER_VERSION_V1,
    fixtureVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
    runId: readString(input.runId, 'runId', { max: 160 }),
    split: input.split,
    codeRevision: readString(input.codeRevision, 'codeRevision', { max: 120 }),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'running',
    execution,
    maxAttemptsPerFixture,
    budget: resolvedBudget(fixtures.length, maxAttemptsPerFixture, input.budget),
    fixtureIds: fixtures.map(fixture => fixture.id),
    fixtureSetHash: await hashCanonicalValue(bindings),
    attempts: fixtures.map(fixture => ({ fixtureId: fixture.id, count: 0 })),
    completed: [],
    failures: [],
    usage: {
      modelCalls: 0,
      meteredModelCalls: 0,
      unmeteredModelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      costUsd: 0,
    },
  })
}

async function updateCheckpoint(
  checkpoint: H4LongConsistencyRunCheckpointV1,
  input: RunH4LongConsistencyVerifierInputV1,
  patch: Partial<Omit<H4LongConsistencyRunCheckpointV1, 'checkpointHash' | 'schemaVersion'>>,
): Promise<H4LongConsistencyRunCheckpointV1> {
  const next = await signCheckpoint({
    ...checkpointBody(checkpoint),
    ...patch,
    updatedAt: new Date(input.now?.() ?? Date.now()).toISOString(),
  })
  return next
}

async function resumeCheckpoint(input: RunH4LongConsistencyVerifierInputV1) {
  const checkpoint = parseH4LongConsistencyRunCheckpointV1(input.resumeFrom)
  await assertCheckpointAgainstCatalog(checkpoint)
  if (
    checkpoint.runId !== input.runId
    || checkpoint.split !== input.split
    || checkpoint.codeRevision !== input.codeRevision
    || !sameValue(checkpoint.execution, input.execution)
  ) throw new Error('H4 resume 参数与 checkpoint 冻结契约不一致')
  if (input.fixtureIds && !sameValue(checkpoint.fixtureIds, input.fixtureIds)) {
    throw new Error('H4 resume fixtureIds 与 checkpoint 不一致')
  }
  if (
    input.maxAttemptsPerFixture != null
    && input.maxAttemptsPerFixture !== checkpoint.maxAttemptsPerFixture
  ) throw new Error('H4 resume maxAttemptsPerFixture 与 checkpoint 不一致')
  if (input.budget) {
    const resumedBudget = resolvedBudget(
      checkpoint.fixtureIds.length,
      checkpoint.maxAttemptsPerFixture,
      input.budget,
    )
    if (!sameValue(resumedBudget, checkpoint.budget)) throw new Error('H4 resume budget 与 checkpoint 不一致')
  }
  return checkpoint
}

export async function runH4LongConsistencyVerifierV1(
  input: RunH4LongConsistencyVerifierInputV1,
): Promise<H4LongConsistencyRunCheckpointV1> {
  let checkpoint = input.resumeFrom == null
    ? await initialCheckpoint(input)
    : await resumeCheckpoint(input)
  if (checkpoint.status !== 'running') return checkpoint
  if (input.resumeFrom == null) await input.onCheckpoint?.(structuredClone(checkpoint))
  const fixtures = selectFixtures(checkpoint.split, checkpoint.fixtureIds)
  const completedIds = new Set(checkpoint.completed.map(item => item.fixtureId))

  for (const fixture of fixtures) {
    if (completedIds.has(fixture.id)) continue
    while (true) {
      if (budgetExceeded(checkpoint.usage, checkpoint.budget)) {
        checkpoint = await updateCheckpoint(checkpoint, input, { status: 'budget-exhausted' })
        await input.onCheckpoint?.(structuredClone(checkpoint))
        return checkpoint
      }
      const attemptIndex = checkpoint.attempts.findIndex(item => item.fixtureId === fixture.id)
      const attempt = checkpoint.attempts[attemptIndex].count + 1
      if (attempt > checkpoint.maxAttemptsPerFixture) {
        return await updateCheckpoint(checkpoint, input, { status: 'failed' })
      }
      const attempts = checkpoint.attempts.map((item, index) => (
        index === attemptIndex ? { ...item, count: attempt } : item
      ))
      const previousFailure = attempt > 1
        ? checkpoint.failures.find(failure => (
            failure.fixtureId === fixture.id && failure.attempt === attempt - 1
          ))
        : undefined
      const judgeRepair = supportsJudgeRepair(checkpoint.execution.verifier.promptVersion)
        ? previousFailure ? createLongConsistencyJudgeRepairV1(previousFailure.code) : null
        : undefined
      let artifact: LongConsistencyEvalArtifactV1
      let rawJudgeOutput = ''
      let failedAttemptUsage: LongConsistencyModelUsageV1 | null = null
      try {
        const traceHash = await hashCanonicalValue({
          runnerVersion: H4_LONG_CONSISTENCY_RUNNER_VERSION_V1,
          runId: checkpoint.runId,
          fixtureId: fixture.id,
          attempt,
          verifier: checkpoint.execution.verifier,
        })
        artifact = await runLongConsistencySemanticAuditV1({
          runId: `${checkpoint.runId}:${fixture.id}`,
          createdAt: new Date(input.now?.() ?? Date.now()).toISOString(),
          codeRevision: checkpoint.codeRevision,
          fixture: (await fixtureBindings([fixture]))[0],
          generator: checkpoint.execution.generator,
          verifier: checkpoint.execution.verifier,
          generationUsage: { inputTokens: 0, outputTokens: 0, durationMs: 0, costUsd: 0 },
          sources: fixture.sources,
          traceHashes: [traceHash],
          ...(judgeRepair !== undefined ? { judgeRepair } : {}),
          call: async messages => {
            const startedAt = performance.now()
            const response = await input.call({
              fixture: {
                id: fixture.id,
                split: fixture.split,
                task: fixture.task,
              },
              messages: structuredClone(messages),
              verifier: checkpoint.execution.verifier,
              attempt,
              traceHash,
            })
            rawJudgeOutput = response.output
            failedAttemptUsage = {
              inputTokens: response.usage?.inputTokens
                ?? messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
              outputTokens: response.usage?.outputTokens
                ?? (typeof response.output === 'string' ? estimateTokens(response.output) : 0),
              durationMs: response.usage?.durationMs ?? Math.round(performance.now() - startedAt),
              costUsd: response.usage?.costUsd ?? 0,
            }
            return response
          },
        })
      } catch (error) {
        const failure = failureFrom(error, fixture.id, attempt, failedAttemptUsage)
        const failures = [...checkpoint.failures, failure]
        const usage = aggregateUsage({ attempts, completed: checkpoint.completed, failures })
        const terminal = failure.code === 'verifier_error_non_retryable'
          || attempt >= checkpoint.maxAttemptsPerFixture
          || (
            supportsJudgeRepair(checkpoint.execution.verifier.promptVersion)
            && repeatedRepairWouldBeIdentical(failures, fixture.id, attempt)
          )
        checkpoint = await updateCheckpoint(checkpoint, input, {
          attempts,
          usage,
          failures,
          status: terminal ? 'failed' : 'running',
        })
        await input.onCheckpoint?.(structuredClone(checkpoint))
        if (terminal) return checkpoint
        continue
      }
      const completed = [...checkpoint.completed, {
        fixtureId: fixture.id,
        attempts: attempt,
        rawJudgeOutput,
        artifact,
      }]
      const usage = aggregateUsage({ attempts, completed, failures: checkpoint.failures })
      const allCompleted = completed.length === fixtures.length
      checkpoint = await updateCheckpoint(checkpoint, input, {
        attempts,
        completed,
        usage,
        status: budgetOvershot(usage, checkpoint.budget)
          ? 'budget-exhausted'
          : allCompleted ? 'completed' : 'running',
      })
      await input.onCheckpoint?.(structuredClone(checkpoint))
      completedIds.add(fixture.id)
      input.onProgress?.(completed.length, fixtures.length)
      if (checkpoint.status !== 'running') return checkpoint
      break
    }
  }
  return checkpoint
}
