export const CREATIVE_ARTIFACT_STATUSES = [
  'ready',
  'usable-with-warnings',
  'manual-repair',
  'blocked',
] as const

export type CreativeArtifactStatusV1 = typeof CREATIVE_ARTIFACT_STATUSES[number]

export const CREATIVE_QUALITY_MODES = ['economy', 'balanced', 'refine'] as const
export type CreativeQualityModeV1 = typeof CREATIVE_QUALITY_MODES[number]

/**
 * Local kill switch for the production CREL path. Existing artifacts remain
 * readable when disabled; new production runs use the legacy single-call
 * candidate path and do not attach CreativeArtifactV1 evidence.
 */
export const CREATIVE_RELIABILITY_RUNTIME_STORAGE_KEY_V1 =
  'storyforge:creative-reliability:runtime-v1'

export function isCreativeReliabilityRuntimeEnabledV1(): boolean {
  try {
    return globalThis.localStorage?.getItem(CREATIVE_RELIABILITY_RUNTIME_STORAGE_KEY_V1) !== 'disabled'
  } catch {
    return true
  }
}

export function setCreativeReliabilityRuntimeEnabledV1(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(
      CREATIVE_RELIABILITY_RUNTIME_STORAGE_KEY_V1,
      enabled ? 'enabled' : 'disabled',
    )
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts. The
    // in-memory store still reflects the current session selection.
  }
}

export interface CreativeQualityPolicyV1 {
  version: 1
  mode: CreativeQualityModeV1
  maxAutomaticCallsPerArtifact: 1 | 2
  allowAutomaticRepair: boolean
  allowAutomaticSemanticReview: false
}

export function sanitizeCreativeQualityModeV1(value: unknown): CreativeQualityModeV1 {
  return CREATIVE_QUALITY_MODES.includes(value as CreativeQualityModeV1)
    ? value as CreativeQualityModeV1
    : 'balanced'
}

export function resolveCreativeQualityPolicyV1(mode: CreativeQualityModeV1): CreativeQualityPolicyV1 {
  return {
    version: 1,
    mode,
    maxAutomaticCallsPerArtifact: mode === 'economy' ? 1 : 2,
    allowAutomaticRepair: mode !== 'economy',
    allowAutomaticSemanticReview: false,
  }
}

export const CREATIVE_ISSUE_SEVERITIES = ['info', 'warning', 'error'] as const
export type CreativeArtifactIssueSeverityV1 = typeof CREATIVE_ISSUE_SEVERITIES[number]

export const CREATIVE_ISSUE_DISPOSITIONS = ['advisory', 'repairable', 'blocking'] as const
export type CreativeArtifactIssueDispositionV1 = typeof CREATIVE_ISSUE_DISPOSITIONS[number]

export const CREATIVE_ISSUE_ACTIONS = ['none', 'edit', 'repair-once', 'remove', 'replan'] as const
export type CreativeArtifactIssueActionV1 = typeof CREATIVE_ISSUE_ACTIONS[number]

export interface CreativeArtifactIssueV1 {
  version: 1
  code: string
  severity: CreativeArtifactIssueSeverityV1
  disposition: CreativeArtifactIssueDispositionV1
  path: string
  message: string
  suggestedAction: CreativeArtifactIssueActionV1
  evidenceRefs: string[]
  deterministic: boolean
}

export interface CreativeArtifactFragmentV1 {
  version: 1
  id: string
  path: string
  text: string
  status: 'valid' | 'rejected'
  issueCodes: string[]
}

export interface CreativeAssumptionV1 {
  version: 1
  id: string
  text: string
  derivedFrom: string[]
  confidence: 'low' | 'medium' | 'high'
  conflictsWith: string[]
  status: 'provisional' | 'author-confirmed' | 'rejected'
}

export interface CreativeCallEvidenceV1 {
  version: 1
  callIndex: 1 | 2
  purpose: 'generate' | 'repair' | 'author-review'
  status: 'succeeded' | 'failed' | 'unknown'
  provider: string
  model: string
  usageSource: 'provider' | 'estimated' | 'unknown'
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  latencyMs: number | null
  estimatedCostUsd: number | null
  outputHash: string | null
}

export interface CreativeRepairEvidenceV1 {
  version: 1
  sourceTextHash: string
  targetIssueCodes: string[]
  callIndex: 2
  result: 'repaired' | 'partial' | 'failed'
}

export interface CreativeArtifactV1 {
  version: 1
  policyVersion: 'creative-reliability-v1'
  status: CreativeArtifactStatusV1
  qualityMode: CreativeQualityModeV1
  originalText: string
  editableText: string
  validFragments: CreativeArtifactFragmentV1[]
  rejectedFragments: CreativeArtifactFragmentV1[]
  issues: CreativeArtifactIssueV1[]
  assumptions: CreativeAssumptionV1[]
  canonEvidenceRefs: string[]
  callEvidence: CreativeCallEvidenceV1[]
  repair: CreativeRepairEvidenceV1 | null
}

const MAX_ARTIFACT_TEXT_CHARS = 120_000
const MAX_FRAGMENT_TEXT_CHARS = 40_000
const MAX_ISSUES = 200
const MAX_FRAGMENTS = 200
const MAX_ASSUMPTIONS = 100

function fail(message: string): never {
  throw new Error(`创作产物合同无效：${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    fail(`${label} 字段必须严格为 ${keys.join('、')}`)
  }
}

function readString(value: unknown, label: string, max = 2_000, allowEmpty = false): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const normalized = allowEmpty ? value : value.trim()
  if (!allowEmpty && !normalized) fail(`${label} 不能为空`)
  if (normalized.length > max) fail(`${label} 超过 ${max} 字符`)
  return normalized
}

function readEnum<T extends string | number>(value: unknown, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) fail(`${label} 不在允许范围内`)
  return value as T
}

function readStringArray(value: unknown, label: string, max = 100): string[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} 必须是最多 ${max} 项的数组`)
  const result = value.map((item, index) => readString(item, `${label}[${index}]`, 500))
  if (new Set(result).size !== result.length) fail(`${label} 不能包含重复项`)
  return result
}

function readNullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || (value as number) < 0) fail(`${label} 必须是非负整数或 null`)
  return value as number
}

function readNullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} 必须是非负有限数字或 null`)
  }
  return value
}

function readHash(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null
  const hash = readString(value, label, 64)
  if (!/^[a-f0-9]{64}$/i.test(hash)) fail(`${label} 必须是 SHA-256`)
  return hash.toLowerCase()
}

function parseIssue(value: unknown, index: number): CreativeArtifactIssueV1 {
  if (!isRecord(value)) fail(`issues[${index}] 必须是对象`)
  exactKeys(value, [
    'version', 'code', 'severity', 'disposition', 'path', 'message',
    'suggestedAction', 'evidenceRefs', 'deterministic',
  ], `issues[${index}]`)
  if (value.version !== 1) fail(`issues[${index}].version 不支持`)
  if (typeof value.deterministic !== 'boolean') fail(`issues[${index}].deterministic 必须是布尔值`)
  return {
    version: 1,
    code: readString(value.code, `issues[${index}].code`, 120),
    severity: readEnum(value.severity, CREATIVE_ISSUE_SEVERITIES, `issues[${index}].severity`),
    disposition: readEnum(value.disposition, CREATIVE_ISSUE_DISPOSITIONS, `issues[${index}].disposition`),
    path: readString(value.path, `issues[${index}].path`, 500),
    message: readString(value.message, `issues[${index}].message`, 1_000),
    suggestedAction: readEnum(value.suggestedAction, CREATIVE_ISSUE_ACTIONS, `issues[${index}].suggestedAction`),
    evidenceRefs: readStringArray(value.evidenceRefs, `issues[${index}].evidenceRefs`, 50),
    deterministic: value.deterministic,
  }
}

function parseFragment(value: unknown, index: number, label: string): CreativeArtifactFragmentV1 {
  if (!isRecord(value)) fail(`${label}[${index}] 必须是对象`)
  exactKeys(value, ['version', 'id', 'path', 'text', 'status', 'issueCodes'], `${label}[${index}]`)
  if (value.version !== 1) fail(`${label}[${index}].version 不支持`)
  return {
    version: 1,
    id: readString(value.id, `${label}[${index}].id`, 120),
    path: readString(value.path, `${label}[${index}].path`, 500),
    text: readString(value.text, `${label}[${index}].text`, MAX_FRAGMENT_TEXT_CHARS, true),
    status: readEnum(value.status, ['valid', 'rejected'] as const, `${label}[${index}].status`),
    issueCodes: readStringArray(value.issueCodes, `${label}[${index}].issueCodes`, 50),
  }
}

export function parseCreativeAssumptionV1(value: unknown, index = 0): CreativeAssumptionV1 {
  if (!isRecord(value)) fail(`assumptions[${index}] 必须是对象`)
  exactKeys(value, [
    'version', 'id', 'text', 'derivedFrom', 'confidence', 'conflictsWith', 'status',
  ], `assumptions[${index}]`)
  if (value.version !== 1) fail(`assumptions[${index}].version 不支持`)
  return {
    version: 1,
    id: readString(value.id, `assumptions[${index}].id`, 120),
    text: readString(value.text, `assumptions[${index}].text`, 2_000),
    derivedFrom: readStringArray(value.derivedFrom, `assumptions[${index}].derivedFrom`, 50),
    confidence: readEnum(value.confidence, ['low', 'medium', 'high'] as const, `assumptions[${index}].confidence`),
    conflictsWith: readStringArray(value.conflictsWith, `assumptions[${index}].conflictsWith`, 50),
    status: readEnum(
      value.status,
      ['provisional', 'author-confirmed', 'rejected'] as const,
      `assumptions[${index}].status`,
    ),
  }
}

function parseCallEvidence(value: unknown, index: number): CreativeCallEvidenceV1 {
  if (!isRecord(value)) fail(`callEvidence[${index}] 必须是对象`)
  exactKeys(value, [
    'version', 'callIndex', 'purpose', 'status', 'provider', 'model', 'usageSource',
    'inputTokens', 'outputTokens', 'totalTokens', 'latencyMs', 'estimatedCostUsd', 'outputHash',
  ], `callEvidence[${index}]`)
  if (value.version !== 1) fail(`callEvidence[${index}].version 不支持`)
  const callIndex = readEnum(value.callIndex, [1, 2] as const, `callEvidence[${index}].callIndex`)
  const usageSource = readEnum(
    value.usageSource,
    ['provider', 'estimated', 'unknown'] as const,
    `callEvidence[${index}].usageSource`,
  )
  const inputTokens = readNullableInteger(value.inputTokens, `callEvidence[${index}].inputTokens`)
  const outputTokens = readNullableInteger(value.outputTokens, `callEvidence[${index}].outputTokens`)
  const totalTokens = readNullableInteger(value.totalTokens, `callEvidence[${index}].totalTokens`)
  if (usageSource === 'unknown' && [inputTokens, outputTokens, totalTokens].some(item => item !== null)) {
    fail(`callEvidence[${index}] usageSource=unknown 时 token 必须为 null`)
  }
  if (inputTokens !== null && outputTokens !== null && totalTokens !== inputTokens + outputTokens) {
    fail(`callEvidence[${index}].totalTokens 与输入输出之和不一致`)
  }
  return {
    version: 1,
    callIndex,
    purpose: readEnum(
      value.purpose,
      ['generate', 'repair', 'author-review'] as const,
      `callEvidence[${index}].purpose`,
    ),
    status: readEnum(
      value.status,
      ['succeeded', 'failed', 'unknown'] as const,
      `callEvidence[${index}].status`,
    ),
    provider: readString(value.provider, `callEvidence[${index}].provider`, 120),
    model: readString(value.model, `callEvidence[${index}].model`, 240),
    usageSource,
    inputTokens,
    outputTokens,
    totalTokens,
    latencyMs: readNullableInteger(value.latencyMs, `callEvidence[${index}].latencyMs`),
    estimatedCostUsd: readNullableNumber(value.estimatedCostUsd, `callEvidence[${index}].estimatedCostUsd`),
    outputHash: readHash(value.outputHash, `callEvidence[${index}].outputHash`, true),
  }
}

function parseRepair(value: unknown): CreativeRepairEvidenceV1 | null {
  if (value === null) return null
  if (!isRecord(value)) fail('repair 必须是对象或 null')
  exactKeys(value, ['version', 'sourceTextHash', 'targetIssueCodes', 'callIndex', 'result'], 'repair')
  if (value.version !== 1 || value.callIndex !== 2) fail('repair 版本或 callIndex 无效')
  return {
    version: 1,
    sourceTextHash: readHash(value.sourceTextHash, 'repair.sourceTextHash')!,
    targetIssueCodes: readStringArray(value.targetIssueCodes, 'repair.targetIssueCodes', 100),
    callIndex: 2,
    result: readEnum(value.result, ['repaired', 'partial', 'failed'] as const, 'repair.result'),
  }
}

function assertUniqueBy<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  const keys = values.map(key)
  if (new Set(keys).size !== keys.length) fail(`${label} 包含重复身份`)
}

export function parseCreativeArtifactV1(value: unknown): CreativeArtifactV1 {
  if (!isRecord(value)) fail('根必须是对象')
  exactKeys(value, [
    'version', 'policyVersion', 'status', 'qualityMode', 'originalText', 'editableText',
    'validFragments', 'rejectedFragments', 'issues', 'assumptions', 'canonEvidenceRefs',
    'callEvidence', 'repair',
  ], '根')
  if (value.version !== 1 || value.policyVersion !== 'creative-reliability-v1') {
    fail('version 或 policyVersion 不支持')
  }
  if (!Array.isArray(value.issues) || value.issues.length > MAX_ISSUES) fail('issues 数量无效')
  if (!Array.isArray(value.validFragments) || value.validFragments.length > MAX_FRAGMENTS) {
    fail('validFragments 数量无效')
  }
  if (!Array.isArray(value.rejectedFragments) || value.rejectedFragments.length > MAX_FRAGMENTS) {
    fail('rejectedFragments 数量无效')
  }
  if (!Array.isArray(value.assumptions) || value.assumptions.length > MAX_ASSUMPTIONS) {
    fail('assumptions 数量无效')
  }
  if (!Array.isArray(value.callEvidence) || value.callEvidence.length < 1 || value.callEvidence.length > 2) {
    fail('callEvidence 必须包含 1-2 次物理模型调用')
  }

  const status = readEnum(value.status, CREATIVE_ARTIFACT_STATUSES, 'status')
  const issues = value.issues.map(parseIssue)
  const validFragments = value.validFragments.map((item, index) => parseFragment(item, index, 'validFragments'))
  const rejectedFragments = value.rejectedFragments.map((item, index) => parseFragment(item, index, 'rejectedFragments'))
  const assumptions = value.assumptions.map(parseCreativeAssumptionV1)
  const callEvidence = value.callEvidence.map(parseCallEvidence)
  const repair = parseRepair(value.repair)

  if (validFragments.some(fragment => fragment.status !== 'valid')) fail('validFragments 只能包含 valid 片段')
  if (rejectedFragments.some(fragment => fragment.status !== 'rejected')) fail('rejectedFragments 只能包含 rejected 片段')
  assertUniqueBy([...validFragments, ...rejectedFragments], fragment => fragment.id, '全部 fragments')
  assertUniqueBy(assumptions, assumption => assumption.id, 'assumptions')
  assertUniqueBy(callEvidence, call => String(call.callIndex), 'callEvidence')
  callEvidence.forEach((call, index) => {
    if (call.callIndex !== index + 1) fail('callEvidence 必须从 1 开始连续排列')
    if (call.callIndex === 1 && call.purpose !== 'generate') fail('第一次调用必须是 generate')
    if (call.callIndex === 2 && call.purpose === 'generate') fail('第二次调用不能再次标记为 generate')
  })
  if ((repair === null) !== (callEvidence.length === 1)) fail('repair 必须与第二次调用同时存在')
  if (repair && !callEvidence.some(call => call.callIndex === 2 && call.purpose === 'repair')) {
    fail('repair 缺少第二次 repair 调用证据')
  }

  const hasBlocking = issues.some(issue => issue.disposition === 'blocking')
  if (status === 'ready' && issues.length > 0) fail('ready 不能携带问题')
  if (status === 'usable-with-warnings' && (issues.length === 0 || hasBlocking)) {
    fail('usable-with-warnings 必须有非阻断问题且不能有 blocking')
  }
  if (status === 'manual-repair' && (issues.length === 0 || hasBlocking)) {
    fail('manual-repair 必须有非阻断可修问题且不能有 blocking')
  }
  if (status === 'blocked' && !hasBlocking) fail('blocked 必须有 blocking 问题')

  return {
    version: 1,
    policyVersion: 'creative-reliability-v1',
    status,
    qualityMode: readEnum(value.qualityMode, CREATIVE_QUALITY_MODES, 'qualityMode'),
    originalText: readString(value.originalText, 'originalText', MAX_ARTIFACT_TEXT_CHARS, true),
    editableText: readString(value.editableText, 'editableText', MAX_ARTIFACT_TEXT_CHARS, true),
    validFragments,
    rejectedFragments,
    issues,
    assumptions,
    canonEvidenceRefs: readStringArray(value.canonEvidenceRefs, 'canonEvidenceRefs', 200),
    callEvidence,
    repair,
  }
}

export function creativeArtifactCanAdoptV1(artifact: CreativeArtifactV1): boolean {
  return artifact.status === 'ready' || artifact.status === 'usable-with-warnings'
}
