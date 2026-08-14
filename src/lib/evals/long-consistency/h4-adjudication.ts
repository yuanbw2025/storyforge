import { sha256Text } from '../../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../../ai/context-budget'
import { canonicalStringify, hashCanonicalValue } from '../../agent/run/hash'
import {
  assertExactKeys,
  assertUnique,
  failSchema,
  readArray,
  readBoolean,
  readEnum,
  readHash,
  readInteger,
  readNonNegativeNumber,
  readRecord,
  readString,
} from '../../agent/run/schema-utils'
import type { ChatMessage } from '../../types'
import {
  LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V7,
  type LongConsistencyAuditCallResultV1,
} from './evidence-report'
import {
  H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
  getH4LongConsistencyFixturesV1,
} from './h4-fixtures'
import {
  parseH4LongConsistencyRunCheckpointV1,
  verifyH4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyCompletedCaseV1,
  type H4LongConsistencyRunBudgetV1,
  type H4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyRunUsageV1,
} from './h4-runner'
import type {
  LongConsistencyFixtureBindingV1,
  LongConsistencyIssueV1,
  LongConsistencyModelBindingV1,
  LongConsistencyModelUsageV1,
} from './report-types'
import {
  LONG_CONSISTENCY_SUBTYPES_V1,
  LONG_CONSISTENCY_TAXONOMY_V1,
  LONG_CONSISTENCY_TAXONOMY_VERSION_V1,
  getLongConsistencyTaxonomyEntryV1,
  type LongConsistencySubtypeV1,
} from './taxonomy'
import type { EvalSplit } from './types'

export const H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1 =
  'h4-long-consistency-subtype-adjudication-v1'
export const H4_SUBTYPE_ADJUDICATION_PROTOCOL_VERSION_V1 =
  'h4-evidence-pair-subtype-adjudication-v1'
export const H4_SUBTYPE_ADJUDICATION_ARTIFACT_TYPE_V1 =
  'storyforge-h4-subtype-adjudication-artifact'
export const H4_SUBTYPE_ADJUDICATION_CHECKPOINT_TYPE_V1 =
  'storyforge-h4-subtype-adjudication-checkpoint'
export const H4_SUBTYPE_ADJUDICATION_RUNNER_VERSION_V1 =
  'h4-subtype-adjudication-runner-v1'

const H4_SUBTYPE_ADJUDICATION_VERDICTS_V1 = ['conflict', 'not-conflict'] as const
const H4_SUBTYPE_ADJUDICATION_CALL_STATUSES_V1 = [
  'succeeded',
  'protocol-failed',
  'provider-failed',
] as const
const CHECKPOINT_STATUSES = ['running', 'completed', 'failed', 'budget-exhausted', 'provider-blocked'] as const

export type H4SubtypeAdjudicationVerdictV1 =
  typeof H4_SUBTYPE_ADJUDICATION_VERDICTS_V1[number]
export type H4SubtypeAdjudicationRunStatusV1 = typeof CHECKPOINT_STATUSES[number]

export interface H4SubtypeAdjudicationDecisionV1 {
  candidateId: string
  verdict: H4SubtypeAdjudicationVerdictV1
  subtype: LongConsistencySubtypeV1 | null
  reason: string
}

export interface H4SubtypeAdjudicationArtifactCallV1 {
  traceHash: string
  inputHash: string
  outputHash: string
  usage: LongConsistencyModelUsageV1
}

export interface H4SubtypeAdjudicationArtifactV1 {
  schemaVersion: 1
  artifactType: typeof H4_SUBTYPE_ADJUDICATION_ARTIFACT_TYPE_V1
  protocolVersion: typeof H4_SUBTYPE_ADJUDICATION_PROTOCOL_VERSION_V1
  runId: string
  createdAt: string
  codeRevision: string
  fixture: LongConsistencyFixtureBindingV1
  execution: {
    generator: LongConsistencyModelBindingV1
    discoveryVerifier: LongConsistencyModelBindingV1
    adjudicator: LongConsistencyModelBindingV1
    generatorIdentitySeparated: boolean
  }
  source: {
    checkpointHash: string
    artifactHash: string
    judgeInputHash: string
    judgeOutputHash: string
    traceHashes: string[]
    verifierUsage: LongConsistencyModelUsageV1
  }
  sourceSetHash: string
  candidateSetHash: string
  call: H4SubtypeAdjudicationArtifactCallV1 | null
  decisions: H4SubtypeAdjudicationDecisionV1[]
  derivedIssueSetHash: string
  artifactHash: string
}

export interface H4SubtypeAdjudicationCompletedCaseV1 {
  fixtureId: string
  attempts: number
  rawAdjudicationOutput: string | null
  artifact: H4SubtypeAdjudicationArtifactV1
}

export interface H4SubtypeAdjudicationFailureV1 {
  fixtureId: string
  attempt: number
  traceHash: string
  code: string
  message: string
  usage: LongConsistencyModelUsageV1 | null
}

export interface H4SubtypeAdjudicationCallRecordV1 {
  fixtureId: string
  attempt: number
  stage: 'subtype-adjudication'
  traceHash: string
  inputHash: string
  outputHash: string | null
  model: LongConsistencyModelBindingV1
  status: typeof H4_SUBTYPE_ADJUDICATION_CALL_STATUSES_V1[number]
  failureCode: string | null
  usage: LongConsistencyModelUsageV1 | null
}

export interface H4SubtypeAdjudicationCheckpointV1 {
  schemaVersion: 1
  checkpointType: typeof H4_SUBTYPE_ADJUDICATION_CHECKPOINT_TYPE_V1
  runnerVersion: typeof H4_SUBTYPE_ADJUDICATION_RUNNER_VERSION_V1
  fixtureVersion: typeof H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1
  runId: string
  split: EvalSplit
  codeRevision: string
  createdAt: string
  updatedAt: string
  status: H4SubtypeAdjudicationRunStatusV1
  baseCheckpointHash: string
  baseCheckpoint: H4LongConsistencyRunCheckpointV1
  execution: H4SubtypeAdjudicationArtifactV1['execution']
  maxAttemptsPerFixture: number
  budget: H4LongConsistencyRunBudgetV1
  fixtureIds: string[]
  fixtureSetHash: string
  attempts: Array<{ fixtureId: string; count: number }>
  completed: H4SubtypeAdjudicationCompletedCaseV1[]
  failures: H4SubtypeAdjudicationFailureV1[]
  calls: H4SubtypeAdjudicationCallRecordV1[]
  usage: H4LongConsistencyRunUsageV1
  checkpointHash: string
}

export interface H4SubtypeAdjudicationCallInputV1 {
  fixture: {
    id: string
    split: EvalSplit
    task: LongConsistencyFixtureBindingV1['task']
  }
  messages: ChatMessage[]
  adjudicator: LongConsistencyModelBindingV1
  attempt: number
  traceHash: string
}

export interface RunH4SubtypeAdjudicationInputV1 {
  runId: string
  codeRevision: string
  baseCheckpoint: unknown
  adjudicator: LongConsistencyModelBindingV1
  call: (input: H4SubtypeAdjudicationCallInputV1) => Promise<LongConsistencyAuditCallResultV1>
  maxAttemptsPerFixture?: number
  budget?: Partial<H4LongConsistencyRunBudgetV1>
  resumeFrom?: unknown
  now?: () => number
  onCheckpoint?: (checkpoint: H4SubtypeAdjudicationCheckpointV1) => void | Promise<void>
  onProgress?: (completed: number, total: number) => void
}

interface CandidateBindingV1 {
  candidateId: string
  sourceIssueId: string
  sourceIssueHash: string
  evidencePairHash: string
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

function parseRunUsage(value: unknown, path: string): H4LongConsistencyRunUsageV1 {
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

function parseFixtureBinding(value: unknown, path: string): LongConsistencyFixtureBindingV1 {
  const record = readRecord(value, path)
  const keys = ['id', 'split', 'task', 'inputHash', 'labelHash'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    id: readString(record.id, `${path}.id`, { max: 160 }),
    split: readEnum(record.split, ['development', 'held-out'], `${path}.split`),
    task: readEnum(record.task, ['generation', 'continuation', 'expansion', 'completion'], `${path}.task`),
    inputHash: readHash(record.inputHash, `${path}.inputHash`),
    labelHash: readHash(record.labelHash, `${path}.labelHash`),
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

function modelIdentitySeparated(
  generator: LongConsistencyModelBindingV1,
  model: LongConsistencyModelBindingV1,
): boolean {
  return generator.provider !== model.provider || generator.model !== model.model
}

async function candidateBindings(
  sourceCase: H4LongConsistencyCompletedCaseV1,
): Promise<CandidateBindingV1[]> {
  return await Promise.all(sourceCase.artifact.issues.map(async (issue, index) => ({
    candidateId: `candidate-${String(index + 1).padStart(2, '0')}`,
    sourceIssueId: issue.id,
    sourceIssueHash: await hashCanonicalValue(issue),
    evidencePairHash: await hashCanonicalValue(issue.pair),
  })))
}

function modelVisibleCandidates(sourceCase: H4LongConsistencyCompletedCaseV1) {
  return sourceCase.artifact.issues.map((issue, index) => ({
    candidateId: `candidate-${String(index + 1).padStart(2, '0')}`,
    factEvidence: {
      sourceId: issue.pair.fact.sourceId,
      quote: issue.pair.fact.quote,
    },
    contradictionEvidence: {
      sourceId: issue.pair.contradiction.sourceId,
      quote: issue.pair.contradiction.quote,
    },
  }))
}

function repairInstruction(failureCode: string | null): string | null {
  if (failureCode === 'invalid_json') {
    return '上一次响应不是单一合法 JSON 对象。只返回根 JSON 对象，不要围栏、解释、前后缀或多个对象。'
  }
  if (failureCode === 'unknown_field' || failureCode === 'missing_field' || failureCode === 'invalid_type') {
    return '上一次响应违反 exact-key 契约。逐层只保留示例字段；null 与字符串类型必须严格符合 verdict 规则。'
  }
  if (failureCode === 'invalid_value' || failureCode === 'duplicate_value') {
    return '上一次响应未逐项覆盖冻结 candidateId 或使用了非法 verdict/subtype。按输入顺序为每个候选恰好输出一条决定。'
  }
  return null
}

export function buildH4SubtypeAdjudicationMessagesV1(
  sourceCase: H4LongConsistencyCompletedCaseV1,
  previousFailureCode: string | null = null,
): ChatMessage[] {
  const candidates = modelVisibleCandidates(sourceCase)
  if (!candidates.length) throw new Error('零候选不应调用 subtype adjudicator')
  const taxonomy = LONG_CONSISTENCY_TAXONOMY_V1.map(entry => ({
    subtype: entry.subtype,
    subtypeLabel: entry.subtypeLabel,
    operationalDefinitionZh: entry.operationalDefinitionZh,
    decisionBoundaryZh: entry.decisionBoundaryZh,
  }))
  const messages: ChatMessage[] = [{
    role: 'system',
    content: [
      '你是中文长篇一致性评测的第二阶段 subtype adjudicator。输入只包含第一阶段已逐字验证的候选证据对。',
      '不得猜测隐藏标签，不得要求或补充原文，不得依据 candidateId 推断类别；candidateId 只是顺序标识。',
      '对每个候选先判断两段引文是否构成直接、具体、无需补写事实的矛盾；不是则 verdict=not-conflict。',
      'verdict=conflict 时必须按操作定义和相邻边界选择唯一最具体 subtype；verdict=not-conflict 时 subtype 必须为 null。',
      '时间点、持续时长和同刻互斥分别归 absolute-time、duration、simultaneity；必要原因缺席归 causeless-effect，原因存在但顺序/条件错误归 causal-logic。',
      '记得与否归 memory，无获知渠道却知道归 knowledge；能力水平反转归 skill-fluctuation，已有能力被忽略归 forgotten-ability。',
      '自然/魔法/制度底层机制归 core-rules，礼仪文化与社会执行规范归 social-norms；情绪姿态归 tone，表达形式归 style-shift。',
      '必须按输入顺序为每个 candidateId 恰好返回一条决定，不得新增、遗漏、重排或重复候选。',
      '只返回一个 JSON 对象，不要 markdown 或解释。根对象严格为：',
      '{"schemaVersion":1,"decisions":[{"candidateId":"candidate-01","verdict":"conflict|not-conflict","subtype":"19个子型之一或null","reason":"仅基于两段证据的简短判定理由"}]}',
      `taxonomyVersion=${LONG_CONSISTENCY_TAXONOMY_VERSION_V1}`,
      JSON.stringify(taxonomy),
    ].join('\n'),
  }, {
    role: 'user',
    content: `【已验真候选证据对】\n${JSON.stringify(candidates)}`,
  }]
  const repair = repairInstruction(previousFailureCode)
  if (repair) {
    messages.push({
      role: 'user',
      content: [
        '【确定性判类协议纠错】',
        repair,
        '重新执行全部冻结检查；不得引用上一轮响应、隐藏标签、第一阶段 subtype、summary、severity 或 intent。',
      ].join('\n'),
    })
  }
  return messages
}

function parseDecisions(
  raw: string,
  candidateIds: readonly string[],
): H4SubtypeAdjudicationDecisionV1[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    failSchema('invalid_json', 'adjudicationResponse', '必须是单一合法 JSON 对象')
  }
  const root = readRecord(value, 'adjudicationResponse')
  const rootKeys = ['schemaVersion', 'decisions'] as const
  assertExactKeys(root, rootKeys, rootKeys, 'adjudicationResponse')
  if (root.schemaVersion !== 1) {
    failSchema('invalid_value', 'adjudicationResponse.schemaVersion', '仅支持版本 1')
  }
  const decisions = readArray(root.decisions, 'adjudicationResponse.decisions').map((item, index) => {
    const path = `adjudicationResponse.decisions[${index}]`
    const record = readRecord(item, path)
    const keys = ['candidateId', 'verdict', 'subtype', 'reason'] as const
    assertExactKeys(record, keys, keys, path)
    const verdict = readEnum(record.verdict, H4_SUBTYPE_ADJUDICATION_VERDICTS_V1, `${path}.verdict`)
    let subtype: LongConsistencySubtypeV1 | null
    if (verdict === 'not-conflict') {
      if (record.subtype !== null) failSchema('invalid_value', `${path}.subtype`, 'not-conflict 必须为 null')
      subtype = null
    } else {
      subtype = readEnum(record.subtype, LONG_CONSISTENCY_SUBTYPES_V1, `${path}.subtype`)
    }
    return {
      candidateId: readString(record.candidateId, `${path}.candidateId`, { max: 80 }),
      verdict,
      subtype,
      reason: readString(record.reason, `${path}.reason`, { max: 600 }),
    }
  })
  assertUnique(decisions.map(item => item.candidateId), 'adjudicationResponse.decisions.candidateId')
  if (!sameValue(decisions.map(item => item.candidateId), candidateIds)) {
    failSchema('invalid_value', 'adjudicationResponse.decisions', '必须按输入顺序逐项覆盖全部 candidateId')
  }
  return decisions
}

export function deriveH4SubtypeAdjudicatedIssuesV1(
  sourceCase: H4LongConsistencyCompletedCaseV1,
  decisions: readonly H4SubtypeAdjudicationDecisionV1[],
): LongConsistencyIssueV1[] {
  const candidateIds = sourceCase.artifact.issues.map((_, index) => (
    `candidate-${String(index + 1).padStart(2, '0')}`
  ))
  if (!sameValue(decisions.map(item => item.candidateId), candidateIds)) {
    throw new Error(`fixture ${sourceCase.fixtureId} 的判类决定与候选不匹配`)
  }
  const issues = decisions.flatMap((decision, index): LongConsistencyIssueV1[] => {
    if (decision.verdict === 'not-conflict' || decision.subtype == null) return []
    const source = sourceCase.artifact.issues[index]
    return [{
      ...source,
      category: getLongConsistencyTaxonomyEntryV1(decision.subtype).category,
      subtype: decision.subtype,
      summary: decision.reason,
    }]
  })
  assertUnique(issues.map(issue => [
    issue.subtype,
    issue.pair.fact.sourceId,
    issue.pair.fact.startOffset,
    issue.pair.contradiction.sourceId,
    issue.pair.contradiction.startOffset,
  ].join('\u0000')), 'adjudicatedIssues.pair')
  return issues
}

function parseArtifactCall(value: unknown, path: string): H4SubtypeAdjudicationArtifactCallV1 | null {
  if (value === null) return null
  const record = readRecord(value, path)
  const keys = ['traceHash', 'inputHash', 'outputHash', 'usage'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    traceHash: readHash(record.traceHash, `${path}.traceHash`),
    inputHash: readHash(record.inputHash, `${path}.inputHash`),
    outputHash: readHash(record.outputHash, `${path}.outputHash`),
    usage: parseModelUsage(record.usage, `${path}.usage`),
  }
}

function parseDecision(value: unknown, path: string): H4SubtypeAdjudicationDecisionV1 {
  const record = readRecord(value, path)
  const keys = ['candidateId', 'verdict', 'subtype', 'reason'] as const
  assertExactKeys(record, keys, keys, path)
  const verdict = readEnum(record.verdict, H4_SUBTYPE_ADJUDICATION_VERDICTS_V1, `${path}.verdict`)
  let subtype: LongConsistencySubtypeV1 | null
  if (verdict === 'not-conflict') {
    if (record.subtype !== null) failSchema('invalid_value', `${path}.subtype`, 'not-conflict 必须为 null')
    subtype = null
  } else {
    subtype = readEnum(record.subtype, LONG_CONSISTENCY_SUBTYPES_V1, `${path}.subtype`)
  }
  return {
    candidateId: readString(record.candidateId, `${path}.candidateId`, { max: 80 }),
    verdict,
    subtype,
    reason: readString(record.reason, `${path}.reason`, { max: 600 }),
  }
}

export function parseH4SubtypeAdjudicationArtifactV1(
  value: unknown,
): H4SubtypeAdjudicationArtifactV1 {
  const record = readRecord(value, 'artifact')
  const keys = [
    'schemaVersion',
    'artifactType',
    'protocolVersion',
    'runId',
    'createdAt',
    'codeRevision',
    'fixture',
    'execution',
    'source',
    'sourceSetHash',
    'candidateSetHash',
    'call',
    'decisions',
    'derivedIssueSetHash',
    'artifactHash',
  ] as const
  assertExactKeys(record, keys, keys, 'artifact')
  if (record.schemaVersion !== 1) failSchema('unsupported_version', 'artifact.schemaVersion', '仅支持版本 1')
  if (record.artifactType !== H4_SUBTYPE_ADJUDICATION_ARTIFACT_TYPE_V1) {
    failSchema('invalid_value', 'artifact.artifactType', 'artifact 类型不匹配')
  }
  if (record.protocolVersion !== H4_SUBTYPE_ADJUDICATION_PROTOCOL_VERSION_V1) {
    failSchema('unsupported_version', 'artifact.protocolVersion', '判类协议版本不匹配')
  }
  const executionRecord = readRecord(record.execution, 'artifact.execution')
  const executionKeys = ['generator', 'discoveryVerifier', 'adjudicator', 'generatorIdentitySeparated'] as const
  assertExactKeys(executionRecord, executionKeys, executionKeys, 'artifact.execution')
  const generator = parseModelBinding(executionRecord.generator, 'artifact.execution.generator')
  const discoveryVerifier = parseModelBinding(
    executionRecord.discoveryVerifier,
    'artifact.execution.discoveryVerifier',
  )
  const adjudicator = parseModelBinding(executionRecord.adjudicator, 'artifact.execution.adjudicator')
  const separated = readBoolean(
    executionRecord.generatorIdentitySeparated,
    'artifact.execution.generatorIdentitySeparated',
  )
  if (
    separated !== (
      modelIdentitySeparated(generator, discoveryVerifier)
      && modelIdentitySeparated(generator, adjudicator)
    )
  ) failSchema('binding_mismatch', 'artifact.execution.generatorIdentitySeparated', '模型身份分离不匹配')

  const sourceRecord = readRecord(record.source, 'artifact.source')
  const sourceKeys = [
    'checkpointHash',
    'artifactHash',
    'judgeInputHash',
    'judgeOutputHash',
    'traceHashes',
    'verifierUsage',
  ] as const
  assertExactKeys(sourceRecord, sourceKeys, sourceKeys, 'artifact.source')
  const traceHashes = readArray(sourceRecord.traceHashes, 'artifact.source.traceHashes')
    .map((hash, index) => readHash(hash, `artifact.source.traceHashes[${index}]`))
  if (!traceHashes.length) failSchema('invalid_value', 'artifact.source.traceHashes', '不得为空')
  assertUnique(traceHashes, 'artifact.source.traceHashes')
  const decisions = readArray(record.decisions, 'artifact.decisions')
    .map((item, index) => parseDecision(item, `artifact.decisions[${index}]`))
  assertUnique(decisions.map(item => item.candidateId), 'artifact.decisions.candidateId')

  return {
    schemaVersion: 1,
    artifactType: H4_SUBTYPE_ADJUDICATION_ARTIFACT_TYPE_V1,
    protocolVersion: H4_SUBTYPE_ADJUDICATION_PROTOCOL_VERSION_V1,
    runId: readString(record.runId, 'artifact.runId', { max: 360 }),
    createdAt: isoTimestamp(record.createdAt, 'artifact.createdAt'),
    codeRevision: readString(record.codeRevision, 'artifact.codeRevision', { max: 120 }),
    fixture: parseFixtureBinding(record.fixture, 'artifact.fixture'),
    execution: { generator, discoveryVerifier, adjudicator, generatorIdentitySeparated: separated },
    source: {
      checkpointHash: readHash(sourceRecord.checkpointHash, 'artifact.source.checkpointHash'),
      artifactHash: readHash(sourceRecord.artifactHash, 'artifact.source.artifactHash'),
      judgeInputHash: readHash(sourceRecord.judgeInputHash, 'artifact.source.judgeInputHash'),
      judgeOutputHash: readHash(sourceRecord.judgeOutputHash, 'artifact.source.judgeOutputHash'),
      traceHashes,
      verifierUsage: parseModelUsage(sourceRecord.verifierUsage, 'artifact.source.verifierUsage'),
    },
    sourceSetHash: readHash(record.sourceSetHash, 'artifact.sourceSetHash'),
    candidateSetHash: readHash(record.candidateSetHash, 'artifact.candidateSetHash'),
    call: parseArtifactCall(record.call, 'artifact.call'),
    decisions,
    derivedIssueSetHash: readHash(record.derivedIssueSetHash, 'artifact.derivedIssueSetHash'),
    artifactHash: readHash(record.artifactHash, 'artifact.artifactHash'),
  }
}

function artifactBody(
  artifact: H4SubtypeAdjudicationArtifactV1,
): Omit<H4SubtypeAdjudicationArtifactV1, 'artifactHash'> {
  const { artifactHash: _artifactHash, ...body } = artifact
  return body
}

async function createArtifact(input: {
  runId: string
  createdAt: string
  codeRevision: string
  baseCheckpoint: H4LongConsistencyRunCheckpointV1
  sourceCase: H4LongConsistencyCompletedCaseV1
  adjudicator: LongConsistencyModelBindingV1
  attempt: number
  previousFailureCode: string | null
  rawOutput: string | null
  traceHash: string | null
  usage: LongConsistencyModelUsageV1 | null
}): Promise<H4SubtypeAdjudicationArtifactV1> {
  const bindings = await candidateBindings(input.sourceCase)
  const candidateIds = bindings.map(item => item.candidateId)
  let decisions: H4SubtypeAdjudicationDecisionV1[] = []
  let call: H4SubtypeAdjudicationArtifactCallV1 | null = null
  if (bindings.length) {
    if (input.rawOutput == null || input.traceHash == null || input.usage == null) {
      failSchema('missing_field', 'artifact.call', '非空候选必须绑定真实 adjudicator 调用')
    }
    const messages = buildH4SubtypeAdjudicationMessagesV1(input.sourceCase, input.previousFailureCode)
    decisions = parseDecisions(input.rawOutput, candidateIds)
    call = {
      traceHash: input.traceHash,
      inputHash: await hashCanonicalValue(messages),
      outputHash: await sha256Text(input.rawOutput),
      usage: input.usage,
    }
  }
  const issues = deriveH4SubtypeAdjudicatedIssuesV1(input.sourceCase, decisions)
  const execution = {
    generator: input.baseCheckpoint.execution.generator,
    discoveryVerifier: input.baseCheckpoint.execution.verifier,
    adjudicator: input.adjudicator,
    generatorIdentitySeparated:
      modelIdentitySeparated(input.baseCheckpoint.execution.generator, input.baseCheckpoint.execution.verifier)
      && modelIdentitySeparated(input.baseCheckpoint.execution.generator, input.adjudicator),
  }
  const provisional: H4SubtypeAdjudicationArtifactV1 = {
    schemaVersion: 1,
    artifactType: H4_SUBTYPE_ADJUDICATION_ARTIFACT_TYPE_V1,
    protocolVersion: H4_SUBTYPE_ADJUDICATION_PROTOCOL_VERSION_V1,
    runId: input.runId,
    createdAt: input.createdAt,
    codeRevision: input.codeRevision,
    fixture: input.sourceCase.artifact.fixture,
    execution,
    source: {
      checkpointHash: input.baseCheckpoint.checkpointHash,
      artifactHash: input.sourceCase.artifact.artifactHash,
      judgeInputHash: input.sourceCase.artifact.judgeInputHash,
      judgeOutputHash: input.sourceCase.artifact.judgeOutputHash,
      traceHashes: input.sourceCase.artifact.traceHashes,
      verifierUsage: input.sourceCase.artifact.execution.verifierUsage,
    },
    sourceSetHash: input.sourceCase.artifact.sourceSetHash,
    candidateSetHash: await hashCanonicalValue(bindings),
    call,
    decisions,
    derivedIssueSetHash: await hashCanonicalValue(issues),
    artifactHash: '0'.repeat(64),
  }
  const parsed = parseH4SubtypeAdjudicationArtifactV1(provisional)
  return { ...parsed, artifactHash: await hashCanonicalValue(artifactBody(parsed)) }
}

async function verifyArtifact(
  value: unknown,
  input: {
    baseCheckpoint: H4LongConsistencyRunCheckpointV1
    sourceCase: H4LongConsistencyCompletedCaseV1
    rawOutput: string | null
    attempt: number
    previousFailureCode: string | null
  },
): Promise<boolean> {
  try {
    const artifact = parseH4SubtypeAdjudicationArtifactV1(value)
    if (await hashCanonicalValue(artifactBody(artifact)) !== artifact.artifactHash) return false
    const expectedExecution = {
      generator: input.baseCheckpoint.execution.generator,
      discoveryVerifier: input.baseCheckpoint.execution.verifier,
      adjudicator: artifact.execution.adjudicator,
      generatorIdentitySeparated:
        modelIdentitySeparated(input.baseCheckpoint.execution.generator, input.baseCheckpoint.execution.verifier)
        && modelIdentitySeparated(input.baseCheckpoint.execution.generator, artifact.execution.adjudicator),
    }
    if (!sameValue(artifact.execution, expectedExecution)) return false
    if (
      artifact.runId === ''
      || artifact.fixture.id !== input.sourceCase.fixtureId
      || !sameValue(artifact.fixture, input.sourceCase.artifact.fixture)
      || artifact.source.checkpointHash !== input.baseCheckpoint.checkpointHash
      || artifact.source.artifactHash !== input.sourceCase.artifact.artifactHash
      || artifact.source.judgeInputHash !== input.sourceCase.artifact.judgeInputHash
      || artifact.source.judgeOutputHash !== input.sourceCase.artifact.judgeOutputHash
      || !sameValue(artifact.source.traceHashes, input.sourceCase.artifact.traceHashes)
      || !sameValue(artifact.source.verifierUsage, input.sourceCase.artifact.execution.verifierUsage)
      || artifact.sourceSetHash !== input.sourceCase.artifact.sourceSetHash
    ) return false
    const bindings = await candidateBindings(input.sourceCase)
    if (artifact.candidateSetHash !== await hashCanonicalValue(bindings)) return false
    if (!bindings.length) {
      if (artifact.call != null || input.rawOutput != null || artifact.decisions.length) return false
    } else {
      if (artifact.call == null || input.rawOutput == null) return false
      const messages = buildH4SubtypeAdjudicationMessagesV1(input.sourceCase, input.previousFailureCode)
      if (artifact.call.inputHash !== await hashCanonicalValue(messages)) return false
      if (artifact.call.outputHash !== await sha256Text(input.rawOutput)) return false
      const decisions = parseDecisions(input.rawOutput, bindings.map(item => item.candidateId))
      if (!sameValue(artifact.decisions, decisions)) return false
      const expectedTraceHash = await hashCanonicalValue({
        runnerVersion: H4_SUBTYPE_ADJUDICATION_RUNNER_VERSION_V1,
        runId: artifact.runId.split(':').slice(0, -1).join(':'),
        fixtureId: input.sourceCase.fixtureId,
        attempt: input.attempt,
        stage: 'subtype-adjudication',
        model: artifact.execution.adjudicator,
      })
      if (artifact.call.traceHash !== expectedTraceHash) return false
    }
    const issues = deriveH4SubtypeAdjudicatedIssuesV1(input.sourceCase, artifact.decisions)
    return artifact.derivedIssueSetHash === await hashCanonicalValue(issues)
  } catch {
    return false
  }
}

function parseCallRecord(value: unknown, path: string): H4SubtypeAdjudicationCallRecordV1 {
  const record = readRecord(value, path)
  const keys = [
    'fixtureId',
    'attempt',
    'stage',
    'traceHash',
    'inputHash',
    'outputHash',
    'model',
    'status',
    'failureCode',
    'usage',
  ] as const
  assertExactKeys(record, keys, keys, path)
  if (record.stage !== 'subtype-adjudication') {
    failSchema('invalid_value', `${path}.stage`, 'stage 不匹配')
  }
  const status = readEnum(record.status, H4_SUBTYPE_ADJUDICATION_CALL_STATUSES_V1, `${path}.status`)
  const outputHash = record.outputHash === null ? null : readHash(record.outputHash, `${path}.outputHash`)
  const failureCode = record.failureCode === null
    ? null
    : readString(record.failureCode, `${path}.failureCode`, { max: 120 })
  const usage = record.usage === null ? null : parseModelUsage(record.usage, `${path}.usage`)
  if (status === 'succeeded' && (outputHash == null || usage == null || failureCode != null)) {
    failSchema('invalid_value', path, '成功调用必须有 output/usage 且无 failureCode')
  }
  if (status === 'protocol-failed' && (outputHash == null || usage == null || failureCode == null)) {
    failSchema('invalid_value', path, '协议失败必须有 output/usage/failureCode')
  }
  if (status === 'provider-failed' && (outputHash != null || failureCode == null)) {
    failSchema('invalid_value', path, 'provider 失败不得伪造 output hash')
  }
  return {
    fixtureId: readString(record.fixtureId, `${path}.fixtureId`, { max: 160 }),
    attempt: readInteger(record.attempt, `${path}.attempt`, { min: 1 }),
    stage: 'subtype-adjudication',
    traceHash: readHash(record.traceHash, `${path}.traceHash`),
    inputHash: readHash(record.inputHash, `${path}.inputHash`),
    outputHash,
    model: parseModelBinding(record.model, `${path}.model`),
    status,
    failureCode,
    usage,
  }
}

function parseFailure(value: unknown, path: string): H4SubtypeAdjudicationFailureV1 {
  const record = readRecord(value, path)
  const keys = ['fixtureId', 'attempt', 'traceHash', 'code', 'message', 'usage'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    fixtureId: readString(record.fixtureId, `${path}.fixtureId`, { max: 160 }),
    attempt: readInteger(record.attempt, `${path}.attempt`, { min: 1 }),
    traceHash: readHash(record.traceHash, `${path}.traceHash`),
    code: readString(record.code, `${path}.code`, { max: 120 }),
    message: readString(record.message, `${path}.message`, { max: 500 }),
    usage: record.usage === null ? null : parseModelUsage(record.usage, `${path}.usage`),
  }
}

function parseCompleted(value: unknown, path: string): H4SubtypeAdjudicationCompletedCaseV1 {
  const record = readRecord(value, path)
  const keys = ['fixtureId', 'attempts', 'rawAdjudicationOutput', 'artifact'] as const
  assertExactKeys(record, keys, keys, path)
  return {
    fixtureId: readString(record.fixtureId, `${path}.fixtureId`, { max: 160 }),
    attempts: readInteger(record.attempts, `${path}.attempts`),
    rawAdjudicationOutput: record.rawAdjudicationOutput === null
      ? null
      : rawString(record.rawAdjudicationOutput, `${path}.rawAdjudicationOutput`, 200_000),
    artifact: parseH4SubtypeAdjudicationArtifactV1(record.artifact),
  }
}

export function parseH4SubtypeAdjudicationCheckpointV1(
  value: unknown,
): H4SubtypeAdjudicationCheckpointV1 {
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
    'baseCheckpointHash',
    'baseCheckpoint',
    'execution',
    'maxAttemptsPerFixture',
    'budget',
    'fixtureIds',
    'fixtureSetHash',
    'attempts',
    'completed',
    'failures',
    'calls',
    'usage',
    'checkpointHash',
  ] as const
  assertExactKeys(record, keys, keys, 'checkpoint')
  if (record.schemaVersion !== 1) failSchema('unsupported_version', 'checkpoint.schemaVersion', '仅支持版本 1')
  if (record.checkpointType !== H4_SUBTYPE_ADJUDICATION_CHECKPOINT_TYPE_V1) {
    failSchema('invalid_value', 'checkpoint.checkpointType', 'checkpoint 类型不匹配')
  }
  if (record.runnerVersion !== H4_SUBTYPE_ADJUDICATION_RUNNER_VERSION_V1) {
    failSchema('unsupported_version', 'checkpoint.runnerVersion', 'runner 版本不匹配')
  }
  if (record.fixtureVersion !== H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1) {
    failSchema('unsupported_version', 'checkpoint.fixtureVersion', 'fixture 版本不匹配')
  }
  const executionRecord = readRecord(record.execution, 'checkpoint.execution')
  const executionKeys = ['generator', 'discoveryVerifier', 'adjudicator', 'generatorIdentitySeparated'] as const
  assertExactKeys(executionRecord, executionKeys, executionKeys, 'checkpoint.execution')
  const generator = parseModelBinding(executionRecord.generator, 'checkpoint.execution.generator')
  const discoveryVerifier = parseModelBinding(
    executionRecord.discoveryVerifier,
    'checkpoint.execution.discoveryVerifier',
  )
  const adjudicator = parseModelBinding(executionRecord.adjudicator, 'checkpoint.execution.adjudicator')
  const separated = readBoolean(
    executionRecord.generatorIdentitySeparated,
    'checkpoint.execution.generatorIdentitySeparated',
  )
  if (
    separated !== (modelIdentitySeparated(generator, discoveryVerifier) && modelIdentitySeparated(generator, adjudicator))
  ) failSchema('binding_mismatch', 'checkpoint.execution.generatorIdentitySeparated', '身份分离不匹配')
  const fixtureIds = readArray(record.fixtureIds, 'checkpoint.fixtureIds').map((item, index) => (
    readString(item, `checkpoint.fixtureIds[${index}]`, { max: 160 })
  ))
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
  return {
    schemaVersion: 1,
    checkpointType: H4_SUBTYPE_ADJUDICATION_CHECKPOINT_TYPE_V1,
    runnerVersion: H4_SUBTYPE_ADJUDICATION_RUNNER_VERSION_V1,
    fixtureVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
    runId: readString(record.runId, 'checkpoint.runId', { max: 160 }),
    split: readEnum(record.split, ['development', 'held-out'], 'checkpoint.split'),
    codeRevision: readString(record.codeRevision, 'checkpoint.codeRevision', { max: 120 }),
    createdAt: isoTimestamp(record.createdAt, 'checkpoint.createdAt'),
    updatedAt: isoTimestamp(record.updatedAt, 'checkpoint.updatedAt'),
    status: readEnum(record.status, CHECKPOINT_STATUSES, 'checkpoint.status'),
    baseCheckpointHash: readHash(record.baseCheckpointHash, 'checkpoint.baseCheckpointHash'),
    baseCheckpoint: parseH4LongConsistencyRunCheckpointV1(record.baseCheckpoint),
    execution: { generator, discoveryVerifier, adjudicator, generatorIdentitySeparated: separated },
    maxAttemptsPerFixture: readInteger(
      record.maxAttemptsPerFixture,
      'checkpoint.maxAttemptsPerFixture',
      { min: 1 },
    ),
    budget: parseBudget(record.budget, 'checkpoint.budget'),
    fixtureIds,
    fixtureSetHash: readHash(record.fixtureSetHash, 'checkpoint.fixtureSetHash'),
    attempts,
    completed: readArray(record.completed, 'checkpoint.completed')
      .map((item, index) => parseCompleted(item, `checkpoint.completed[${index}]`)),
    failures: readArray(record.failures, 'checkpoint.failures')
      .map((item, index) => parseFailure(item, `checkpoint.failures[${index}]`)),
    calls: readArray(record.calls, 'checkpoint.calls')
      .map((item, index) => parseCallRecord(item, `checkpoint.calls[${index}]`)),
    usage: parseRunUsage(record.usage, 'checkpoint.usage'),
    checkpointHash: readHash(record.checkpointHash, 'checkpoint.checkpointHash'),
  }
}

function checkpointBody(
  checkpoint: H4SubtypeAdjudicationCheckpointV1,
): Omit<H4SubtypeAdjudicationCheckpointV1, 'checkpointHash'> {
  const { checkpointHash: _checkpointHash, ...body } = checkpoint
  return body
}

async function signCheckpoint(
  checkpoint: Omit<H4SubtypeAdjudicationCheckpointV1, 'checkpointHash'>,
): Promise<H4SubtypeAdjudicationCheckpointV1> {
  return parseH4SubtypeAdjudicationCheckpointV1({
    ...checkpoint,
    checkpointHash: await hashCanonicalValue(checkpoint),
  })
}

function aggregateUsage(calls: readonly H4SubtypeAdjudicationCallRecordV1[]): H4LongConsistencyRunUsageV1 {
  return calls.reduce<H4LongConsistencyRunUsageV1>((total, call) => (
    call.usage == null
      ? { ...total, modelCalls: total.modelCalls + 1, unmeteredModelCalls: total.unmeteredModelCalls + 1 }
      : {
          modelCalls: total.modelCalls + 1,
          meteredModelCalls: total.meteredModelCalls + 1,
          unmeteredModelCalls: total.unmeteredModelCalls,
          inputTokens: total.inputTokens + call.usage.inputTokens,
          outputTokens: total.outputTokens + call.usage.outputTokens,
          durationMs: total.durationMs + call.usage.durationMs,
          costUsd: total.costUsd + call.usage.costUsd,
        }
  ), {
    modelCalls: 0,
    meteredModelCalls: 0,
    unmeteredModelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    costUsd: 0,
  })
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

function failureDetails(error: unknown, hadOutput: boolean): {
  code: string
  message: string
  nonRetryable: boolean
  retryLater: boolean
} {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown; status?: unknown }
    : null
  const status = typeof candidate?.status === 'number' ? candidate.status : null
  const explicitCode = typeof candidate?.code === 'string' && candidate.code.trim()
    ? candidate.code.trim().slice(0, 120)
    : null
  const message = typeof candidate?.message === 'string' && candidate.message.trim()
    ? candidate.message.trim().slice(0, 500)
    : String(error).slice(0, 500) || 'unknown adjudicator error'
  const rateLimited = status === 429 || /AI API Error \(429\)|rate limit/i.test(message)
  const nonRetryable = status != null && status >= 400
    && status < 500
    && status !== 408
    && status !== 409
    && status !== 425
    && status !== 429
  return {
    code: hadOutput
      ? explicitCode ?? 'adjudicator_protocol_error'
      : rateLimited
      ? 'adjudicator_rate_limited'
      : nonRetryable
      ? 'adjudicator_error_non_retryable'
      : status == null || status >= 500 || status === 408 || status === 409 || status === 425
        ? 'adjudicator_error_retry_later'
      : explicitCode
        ? explicitCode
        : 'adjudicator_error',
    message,
    nonRetryable,
    retryLater: !hadOutput && !nonRetryable && (
      rateLimited || status == null || status >= 500 || status === 408 || status === 409 || status === 425
    ),
  }
}

function legacyRateLimitedFailure(failure: H4SubtypeAdjudicationFailureV1 | undefined): boolean {
  return failure?.code === 'adjudicator_error' && failure.message.includes('AI API Error (429)')
}

function retryLaterFailure(failure: H4SubtypeAdjudicationFailureV1 | undefined): boolean {
  return failure?.code === 'adjudicator_rate_limited'
    || failure?.code === 'adjudicator_error_retry_later'
    || legacyRateLimitedFailure(failure)
}

function terminalFailure(
  failure: H4SubtypeAdjudicationFailureV1,
  protocolFailureCount: number,
  maximum: number,
  hadOutput: boolean,
): boolean {
  if (failure.code === 'adjudicator_error_non_retryable' || protocolFailureCount >= maximum) return true
  return hadOutput && repairInstruction(failure.code) == null
}

async function assertCheckpoint(checkpoint: H4SubtypeAdjudicationCheckpointV1): Promise<void> {
  if (await hashCanonicalValue(checkpointBody(checkpoint)) !== checkpoint.checkpointHash) {
    throw new Error('H85 checkpoint hash 不匹配')
  }
  if (!await verifyH4LongConsistencyRunCheckpointV1(checkpoint.baseCheckpoint)) {
    throw new Error('H85 base checkpoint 无法验签')
  }
  if (
    checkpoint.baseCheckpoint.status !== 'completed'
    || checkpoint.baseCheckpoint.execution.verifier.promptVersion !== LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V7
  ) throw new Error('H85 只接受完整 judge v7 base checkpoint')
  if (
    checkpoint.baseCheckpointHash !== checkpoint.baseCheckpoint.checkpointHash
    || checkpoint.split !== checkpoint.baseCheckpoint.split
    || checkpoint.fixtureSetHash !== checkpoint.baseCheckpoint.fixtureSetHash
    || !sameValue(checkpoint.fixtureIds, checkpoint.baseCheckpoint.fixtureIds)
    || !sameValue(checkpoint.execution.generator, checkpoint.baseCheckpoint.execution.generator)
    || !sameValue(checkpoint.execution.discoveryVerifier, checkpoint.baseCheckpoint.execution.verifier)
  ) throw new Error('H85 base lineage 不匹配')
  if (
    checkpoint.execution.adjudicator.promptVersion !== H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1
    || !checkpoint.execution.generatorIdentitySeparated
  ) throw new Error('H85 adjudicator 执行身份不匹配')
  if (
    checkpoint.maxAttemptsPerFixture > 2
    || checkpoint.attempts.length !== checkpoint.fixtureIds.length
    || checkpoint.attempts.some((item, index) => (
      item.fixtureId !== checkpoint.fixtureIds[index]
    ))
  ) throw new Error('H85 attempts 超出冻结边界')
  if (checkpoint.completed.some((item, index) => item.fixtureId !== checkpoint.fixtureIds[index])) {
    throw new Error('H85 completed 必须是 fixture 有序前缀')
  }
  assertUnique(checkpoint.completed.map(item => item.fixtureId), 'checkpoint.completed.fixtureId')
  assertUnique(checkpoint.calls.map(item => item.traceHash), 'checkpoint.calls.traceHash')
  const baseById = new Map(checkpoint.baseCheckpoint.completed.map(item => [item.fixtureId, item] as const))
  const failureByKey = new Map<string, H4SubtypeAdjudicationFailureV1>(
    checkpoint.failures.map(item => [`${item.fixtureId}\u0000${item.attempt}`, item]),
  )
  const callByKey = new Map<string, H4SubtypeAdjudicationCallRecordV1>(
    checkpoint.calls.map(item => [`${item.fixtureId}\u0000${item.attempt}`, item]),
  )
  if (failureByKey.size !== checkpoint.failures.length || callByKey.size !== checkpoint.calls.length) {
    throw new Error('H85 failure/call attempt 不得重复')
  }
  for (const fixtureId of checkpoint.fixtureIds) {
    const protocolFailureCount = checkpoint.calls.filter(call => (
      call.fixtureId === fixtureId && call.status === 'protocol-failed'
    )).length
    if (protocolFailureCount > checkpoint.maxAttemptsPerFixture) {
      throw new Error(`H85 protocol failures ${fixtureId} 超出冻结边界`)
    }
  }
  for (const [index, fixtureId] of checkpoint.fixtureIds.entries()) {
    const baseCase = baseById.get(fixtureId)!
    const attemptCount = checkpoint.attempts[index].count
    const completed = checkpoint.completed[index]
    const candidateCount = baseCase.artifact.issues.length
    if (completed?.fixtureId === fixtureId) {
      if (
        completed.artifact.runId !== `${checkpoint.runId}:${fixtureId}`
        || completed.artifact.codeRevision !== checkpoint.codeRevision
      ) throw new Error(`H85 完成项 ${fixtureId} 的 run/code 绑定不匹配`)
      if (candidateCount === 0) {
        if (attemptCount !== 0 || completed.attempts !== 0 || completed.rawAdjudicationOutput !== null) {
          throw new Error(`H85 零候选 ${fixtureId} 不得伪造模型调用`)
        }
      } else if (attemptCount !== completed.attempts || attemptCount < 1) {
        throw new Error(`H85 完成项 ${fixtureId} attempts 不匹配`)
      }
      const previousFailureCode = completed.attempts > 1
        ? failureByKey.get(`${fixtureId}\u0000${completed.attempts - 1}`)?.code ?? null
        : null
      if (!await verifyArtifact(completed.artifact, {
        baseCheckpoint: checkpoint.baseCheckpoint,
        sourceCase: baseCase,
        rawOutput: completed.rawAdjudicationOutput,
        attempt: completed.attempts,
        previousFailureCode,
      })) throw new Error(`H85 artifact ${fixtureId} 无法验签`)
      if (candidateCount > 0) {
        const call = callByKey.get(`${fixtureId}\u0000${completed.attempts}`)
        if (
          !call
          || call.status !== 'succeeded'
          || !sameValue(completed.artifact.call, {
            traceHash: call.traceHash,
            inputHash: call.inputHash,
            outputHash: call.outputHash,
            usage: call.usage,
          })
        ) throw new Error(`H85 成功调用 ${fixtureId} 与 artifact 不匹配`)
      }
    } else if (index < checkpoint.completed.length) {
      throw new Error('H85 completed 顺序损坏')
    }
    const successfulAttempt = completed?.fixtureId === fixtureId && candidateCount > 0
      ? completed.attempts
      : 0
    for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
      const key = `${fixtureId}\u0000${attempt}`
      const call = callByKey.get(key)
      if (!call || !sameValue(call.model, checkpoint.execution.adjudicator)) {
        throw new Error(`H85 缺少调用记录 ${key}`)
      }
      const expectedTraceHash = await hashCanonicalValue({
        runnerVersion: H4_SUBTYPE_ADJUDICATION_RUNNER_VERSION_V1,
        runId: checkpoint.runId,
        fixtureId,
        attempt,
        stage: 'subtype-adjudication',
        model: checkpoint.execution.adjudicator,
      })
      if (call.traceHash !== expectedTraceHash) throw new Error(`H85 trace ${key} 不匹配`)
      const previousFailureCode = attempt > 1 ? failureByKey.get(`${fixtureId}\u0000${attempt - 1}`)?.code ?? null : null
      const messages = buildH4SubtypeAdjudicationMessagesV1(baseCase, previousFailureCode)
      if (call.inputHash !== await hashCanonicalValue(messages)) throw new Error(`H85 input hash ${key} 不匹配`)
      const isSuccess = attempt === successfulAttempt
      const failure = failureByKey.get(key)
      if (isSuccess ? call.status !== 'succeeded' || failure != null : call.status === 'succeeded' || !failure) {
        throw new Error(`H85 call/failure ${key} 不匹配`)
      }
      if (failure && (
        failure.traceHash !== call.traceHash
        || failure.code !== call.failureCode
        || !sameValue(failure.usage, call.usage)
      )) {
        throw new Error(`H85 failure usage ${key} 不匹配`)
      }
    }
  }
  if (checkpoint.calls.length !== checkpoint.attempts.reduce((sum, item) => sum + item.count, 0)) {
    throw new Error('H85 调用数不得隐藏在 attempt 内')
  }
  if (!sameValue(aggregateUsage(checkpoint.calls), checkpoint.usage)) {
    throw new Error('H85 usage 无法从逐调用记录重算')
  }
  if (checkpoint.status === 'completed' && checkpoint.completed.length !== checkpoint.fixtureIds.length) {
    throw new Error('H85 伪造 completed')
  }
  if (checkpoint.status === 'completed' && budgetOvershot(checkpoint.usage, checkpoint.budget)) {
    throw new Error('H85 completed 超出预算')
  }
  if (checkpoint.status === 'running' && checkpoint.completed.length === checkpoint.fixtureIds.length) {
    throw new Error('H85 全部完成却仍 running')
  }
  if (checkpoint.status === 'failed' && checkpoint.failures.length === 0) {
    throw new Error('H85 failed 缺少失败证据')
  }
  const currentIndex = checkpoint.completed.length
  const currentFixtureId = checkpoint.fixtureIds[currentIndex]
  const currentAttempts = checkpoint.attempts[currentIndex]?.count ?? 0
  const currentFailure = currentFixtureId
    ? failureByKey.get(`${currentFixtureId}\u0000${currentAttempts}`)
    : undefined
  const currentCall = currentFixtureId
    ? callByKey.get(`${currentFixtureId}\u0000${currentAttempts}`)
    : undefined
  const currentProtocolFailures = currentFixtureId
    ? checkpoint.calls.filter(call => (
      call.fixtureId === currentFixtureId && call.status === 'protocol-failed'
    )).length
    : 0
  if (
    checkpoint.status === 'failed'
    && (
      !currentFailure
      || (!legacyRateLimitedFailure(currentFailure) && !terminalFailure(
        currentFailure,
        currentProtocolFailures,
        checkpoint.maxAttemptsPerFixture,
        currentCall?.status === 'protocol-failed',
      ))
    )
  ) throw new Error('H85 failed 与终止条件不匹配')
  if (
    checkpoint.status === 'provider-blocked'
    && (
      !currentFailure
      || currentCall?.status !== 'provider-failed'
      || !retryLaterFailure(currentFailure)
    )
  ) throw new Error('H85 provider-blocked 缺少可恢复 provider 失败证据')
  if (
    checkpoint.status === 'running'
    && currentFailure
    && terminalFailure(
      currentFailure,
      currentProtocolFailures,
      checkpoint.maxAttemptsPerFixture,
      currentCall?.status === 'protocol-failed',
    )
  ) throw new Error('H85 running 已满足终止条件')
  if (checkpoint.status === 'budget-exhausted' && !budgetExceeded(checkpoint.usage, checkpoint.budget)) {
    throw new Error('H85 budget-exhausted 缺少预算证据')
  }
}

export async function verifyH4SubtypeAdjudicationCheckpointV1(value: unknown): Promise<boolean> {
  try {
    const checkpoint = parseH4SubtypeAdjudicationCheckpointV1(value)
    await assertCheckpoint(checkpoint)
    return true
  } catch {
    return false
  }
}

export async function exportH4SubtypeAdjudicationCheckpointV1(value: unknown): Promise<string> {
  const checkpoint = parseH4SubtypeAdjudicationCheckpointV1(value)
  if (!await verifyH4SubtypeAdjudicationCheckpointV1(checkpoint)) {
    throw new Error('H85 checkpoint 完整性验证失败，拒绝导出')
  }
  return JSON.stringify(checkpoint, null, 2)
}

export async function importH4SubtypeAdjudicationCheckpointV1(
  raw: string,
): Promise<H4SubtypeAdjudicationCheckpointV1> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('H85 checkpoint 不是有效 JSON')
  }
  const checkpoint = parseH4SubtypeAdjudicationCheckpointV1(value)
  if (!await verifyH4SubtypeAdjudicationCheckpointV1(checkpoint)) {
    throw new Error('H85 checkpoint 完整性验证失败，拒绝导入')
  }
  return checkpoint
}

function resolvedBudget(
  fixtureCount: number,
  maxAttemptsPerFixture: number,
  override: Partial<H4LongConsistencyRunBudgetV1> | undefined,
): H4LongConsistencyRunBudgetV1 {
  return parseBudget({
    // Protocol repairs stay capped by maxAttemptsPerFixture. Two additional calls per
    // fixture are reserved only for explicit, user-triggered provider-blocked resumes.
    maxModelCalls: override?.maxModelCalls ?? Math.max(1, fixtureCount * (maxAttemptsPerFixture + 2)),
    maxInputTokens: override?.maxInputTokens ?? 1_000_000,
    maxOutputTokens: override?.maxOutputTokens ?? 100_000,
    maxDurationMs: override?.maxDurationMs ?? 3_600_000,
    maxCostUsd: override?.maxCostUsd ?? 1_000,
  }, 'budget')
}

async function initialCheckpoint(
  input: RunH4SubtypeAdjudicationInputV1,
): Promise<H4SubtypeAdjudicationCheckpointV1> {
  const baseCheckpoint = parseH4LongConsistencyRunCheckpointV1(input.baseCheckpoint)
  if (!await verifyH4LongConsistencyRunCheckpointV1(baseCheckpoint)) {
    throw new Error('H85 base checkpoint 无法通过完整性验证')
  }
  if (
    baseCheckpoint.status !== 'completed'
    || baseCheckpoint.execution.verifier.promptVersion !== LONG_CONSISTENCY_JUDGE_PROMPT_VERSION_V7
  ) throw new Error('H85 只接受完成的 judge v7 base checkpoint')
  const adjudicator = parseModelBinding(input.adjudicator, 'adjudicator')
  if (adjudicator.promptVersion !== H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1) {
    throw new Error(`H85 adjudicator promptVersion 必须是 ${H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1}`)
  }
  if (!modelIdentitySeparated(baseCheckpoint.execution.generator, adjudicator)) {
    throw new Error('H85 adjudicator 必须与静态 generator 身份分离')
  }
  const maxAttemptsPerFixture = input.maxAttemptsPerFixture ?? 2
  if (!Number.isInteger(maxAttemptsPerFixture) || maxAttemptsPerFixture < 1 || maxAttemptsPerFixture > 2) {
    throw new Error('H85 maxAttemptsPerFixture 必须在 1 到 2 之间')
  }
  const timestamp = new Date(input.now?.() ?? Date.now()).toISOString()
  return await signCheckpoint({
    schemaVersion: 1,
    checkpointType: H4_SUBTYPE_ADJUDICATION_CHECKPOINT_TYPE_V1,
    runnerVersion: H4_SUBTYPE_ADJUDICATION_RUNNER_VERSION_V1,
    fixtureVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
    runId: readString(input.runId, 'runId', { max: 160 }),
    split: baseCheckpoint.split,
    codeRevision: readString(input.codeRevision, 'codeRevision', { max: 120 }),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'running',
    baseCheckpointHash: baseCheckpoint.checkpointHash,
    baseCheckpoint: structuredClone(baseCheckpoint),
    execution: {
      generator: baseCheckpoint.execution.generator,
      discoveryVerifier: baseCheckpoint.execution.verifier,
      adjudicator,
      generatorIdentitySeparated: true,
    },
    maxAttemptsPerFixture,
    budget: resolvedBudget(baseCheckpoint.fixtureIds.length, maxAttemptsPerFixture, input.budget),
    fixtureIds: [...baseCheckpoint.fixtureIds],
    fixtureSetHash: baseCheckpoint.fixtureSetHash,
    attempts: baseCheckpoint.fixtureIds.map(fixtureId => ({ fixtureId, count: 0 })),
    completed: [],
    failures: [],
    calls: [],
    usage: aggregateUsage([]),
  })
}

async function updateCheckpoint(
  checkpoint: H4SubtypeAdjudicationCheckpointV1,
  input: RunH4SubtypeAdjudicationInputV1,
  patch: Partial<Omit<H4SubtypeAdjudicationCheckpointV1, 'checkpointHash' | 'schemaVersion'>>,
): Promise<H4SubtypeAdjudicationCheckpointV1> {
  return await signCheckpoint({
    ...checkpointBody(checkpoint),
    ...patch,
    updatedAt: new Date(input.now?.() ?? Date.now()).toISOString(),
  })
}

async function resumeCheckpoint(
  input: RunH4SubtypeAdjudicationInputV1,
): Promise<H4SubtypeAdjudicationCheckpointV1> {
  const checkpoint = parseH4SubtypeAdjudicationCheckpointV1(input.resumeFrom)
  await assertCheckpoint(checkpoint)
  const baseCheckpoint = parseH4LongConsistencyRunCheckpointV1(input.baseCheckpoint)
  if (
    checkpoint.runId !== input.runId
    || checkpoint.codeRevision !== input.codeRevision
    || checkpoint.baseCheckpointHash !== baseCheckpoint.checkpointHash
    || !sameValue(checkpoint.execution.adjudicator, input.adjudicator)
  ) throw new Error('H85 resume 参数与冻结契约不一致')
  if (
    input.maxAttemptsPerFixture != null
    && input.maxAttemptsPerFixture !== checkpoint.maxAttemptsPerFixture
  ) throw new Error('H85 resume maxAttemptsPerFixture 不一致')
  if (input.budget) {
    const budget = resolvedBudget(checkpoint.fixtureIds.length, checkpoint.maxAttemptsPerFixture, input.budget)
    if (!sameValue(budget, checkpoint.budget)) throw new Error('H85 resume budget 不一致')
  }
  return checkpoint
}

export async function runH4SubtypeAdjudicationV1(
  input: RunH4SubtypeAdjudicationInputV1,
): Promise<H4SubtypeAdjudicationCheckpointV1> {
  let checkpoint = input.resumeFrom == null
    ? await initialCheckpoint(input)
    : await resumeCheckpoint(input)
  const latestFailure = checkpoint.failures[checkpoint.failures.length - 1]
  if (checkpoint.status === 'provider-blocked' || (
    checkpoint.status === 'failed' && legacyRateLimitedFailure(latestFailure)
  )) {
    checkpoint = await updateCheckpoint(checkpoint, input, { status: 'running' })
    await input.onCheckpoint?.(structuredClone(checkpoint))
  } else if (checkpoint.status !== 'running') {
    return checkpoint
  }
  if (input.resumeFrom == null) await input.onCheckpoint?.(structuredClone(checkpoint))
  const sourceById = new Map(checkpoint.baseCheckpoint.completed.map(item => [item.fixtureId, item] as const))
  const fixtureById = new Map(getH4LongConsistencyFixturesV1(checkpoint.split).map(item => [item.id, item] as const))
  const completedIds = new Set(checkpoint.completed.map(item => item.fixtureId))

  for (const fixtureId of checkpoint.fixtureIds) {
    if (completedIds.has(fixtureId)) continue
    const sourceCase = sourceById.get(fixtureId)!
    const fixture = fixtureById.get(fixtureId)!
    if (!sourceCase.artifact.issues.length) {
      const artifact = await createArtifact({
        runId: `${checkpoint.runId}:${fixtureId}`,
        createdAt: new Date(input.now?.() ?? Date.now()).toISOString(),
        codeRevision: checkpoint.codeRevision,
        baseCheckpoint: checkpoint.baseCheckpoint,
        sourceCase,
        adjudicator: checkpoint.execution.adjudicator,
        attempt: 0,
        previousFailureCode: null,
        rawOutput: null,
        traceHash: null,
        usage: null,
      })
      const completed = [...checkpoint.completed, {
        fixtureId,
        attempts: 0,
        rawAdjudicationOutput: null,
        artifact,
      }]
      checkpoint = await updateCheckpoint(checkpoint, input, {
        completed,
        status: completed.length === checkpoint.fixtureIds.length ? 'completed' : 'running',
      })
      await input.onCheckpoint?.(structuredClone(checkpoint))
      completedIds.add(fixtureId)
      input.onProgress?.(completed.length, checkpoint.fixtureIds.length)
      continue
    }

    while (true) {
      if (budgetExceeded(checkpoint.usage, checkpoint.budget)) {
        checkpoint = await updateCheckpoint(checkpoint, input, { status: 'budget-exhausted' })
        await input.onCheckpoint?.(structuredClone(checkpoint))
        return checkpoint
      }
      const attemptIndex = checkpoint.attempts.findIndex(item => item.fixtureId === fixtureId)
      const protocolFailureCount = checkpoint.calls.filter(call => (
        call.fixtureId === fixtureId && call.status === 'protocol-failed'
      )).length
      if (protocolFailureCount >= checkpoint.maxAttemptsPerFixture) {
        checkpoint = await updateCheckpoint(checkpoint, input, { status: 'failed' })
        await input.onCheckpoint?.(structuredClone(checkpoint))
        return checkpoint
      }
      const attempt = checkpoint.attempts[attemptIndex].count + 1
      const attempts = checkpoint.attempts.map((item, index) => (
        index === attemptIndex ? { ...item, count: attempt } : item
      ))
      const previousFailureCode = attempt > 1
        ? checkpoint.failures.find(item => item.fixtureId === fixtureId && item.attempt === attempt - 1)?.code ?? null
        : null
      const messages = buildH4SubtypeAdjudicationMessagesV1(sourceCase, previousFailureCode)
      const traceHash = await hashCanonicalValue({
        runnerVersion: H4_SUBTYPE_ADJUDICATION_RUNNER_VERSION_V1,
        runId: checkpoint.runId,
        fixtureId,
        attempt,
        stage: 'subtype-adjudication',
        model: checkpoint.execution.adjudicator,
      })
      const inputHash = await hashCanonicalValue(messages)
      let rawOutput: string | null = null
      let callUsage: LongConsistencyModelUsageV1 | null = null
      try {
        const startedAt = performance.now()
        const response = await input.call({
          fixture: { id: fixture.id, split: fixture.split, task: fixture.task },
          messages: structuredClone(messages),
          adjudicator: checkpoint.execution.adjudicator,
          attempt,
          traceHash,
        })
        if (typeof response.output !== 'string') {
          failSchema('invalid_type', 'adjudicationResponse', 'adjudicator 必须返回字符串')
        }
        rawOutput = response.output
        callUsage = {
          inputTokens: response.usage?.inputTokens
            ?? messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
          outputTokens: response.usage?.outputTokens ?? estimateTokens(response.output),
          durationMs: response.usage?.durationMs ?? Math.round(performance.now() - startedAt),
          costUsd: response.usage?.costUsd ?? 0,
        }
        const artifact = await createArtifact({
          runId: `${checkpoint.runId}:${fixtureId}`,
          createdAt: new Date(input.now?.() ?? Date.now()).toISOString(),
          codeRevision: checkpoint.codeRevision,
          baseCheckpoint: checkpoint.baseCheckpoint,
          sourceCase,
          adjudicator: checkpoint.execution.adjudicator,
          attempt,
          previousFailureCode,
          rawOutput,
          traceHash,
          usage: callUsage,
        })
        const callRecord: H4SubtypeAdjudicationCallRecordV1 = {
          fixtureId,
          attempt,
          stage: 'subtype-adjudication',
          traceHash,
          inputHash,
          outputHash: await sha256Text(rawOutput),
          model: checkpoint.execution.adjudicator,
          status: 'succeeded',
          failureCode: null,
          usage: callUsage,
        }
        const calls = [...checkpoint.calls, callRecord]
        const completed = [...checkpoint.completed, {
          fixtureId,
          attempts: attempt,
          rawAdjudicationOutput: rawOutput,
          artifact,
        }]
        const usage = aggregateUsage(calls)
        checkpoint = await updateCheckpoint(checkpoint, input, {
          attempts,
          calls,
          completed,
          usage,
          status: budgetOvershot(usage, checkpoint.budget)
            ? 'budget-exhausted'
            : completed.length === checkpoint.fixtureIds.length ? 'completed' : 'running',
        })
        await input.onCheckpoint?.(structuredClone(checkpoint))
        completedIds.add(fixtureId)
        input.onProgress?.(completed.length, checkpoint.fixtureIds.length)
        if (checkpoint.status !== 'running') return checkpoint
        break
      } catch (error) {
        const detail = failureDetails(error, rawOutput != null)
        const outputHash = rawOutput == null ? null : await sha256Text(rawOutput)
        const callRecord: H4SubtypeAdjudicationCallRecordV1 = {
          fixtureId,
          attempt,
          stage: 'subtype-adjudication',
          traceHash,
          inputHash,
          outputHash,
          model: checkpoint.execution.adjudicator,
          status: rawOutput == null ? 'provider-failed' : 'protocol-failed',
          failureCode: detail.code,
          usage: callUsage,
        }
        const failure: H4SubtypeAdjudicationFailureV1 = {
          fixtureId,
          attempt,
          traceHash,
          code: detail.code,
          message: detail.message,
          usage: callUsage,
        }
        const calls = [...checkpoint.calls, callRecord]
        const failures = [...checkpoint.failures, failure]
        const usage = aggregateUsage(calls)
        const protocolFailures = calls.filter(call => (
          call.fixtureId === fixtureId && call.status === 'protocol-failed'
        )).length
        const terminal = terminalFailure(
          failure,
          protocolFailures,
          checkpoint.maxAttemptsPerFixture,
          rawOutput != null,
        )
        const providerBlocked = detail.retryLater && rawOutput == null
        checkpoint = await updateCheckpoint(checkpoint, input, {
          attempts,
          calls,
          failures,
          usage,
          status: providerBlocked ? 'provider-blocked' : terminal ? 'failed' : 'running',
        })
        await input.onCheckpoint?.(structuredClone(checkpoint))
        if (providerBlocked || terminal) return checkpoint
      }
    }
  }
  return checkpoint
}
