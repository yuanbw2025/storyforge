import type { ProductQualityGateReceiptStatusV1 } from '../types'
import { isSha256Hash } from '../product-production/hash'

export const TEXT_OPEN_WORLD_CREATOR_HARD_GATE_ID_V1 = 'text-open-world.creator.hard-gates'
export const TEXT_OPEN_WORLD_CREATOR_SEMANTIC_GATE_ID_V1 = 'text-open-world.creator.semantic-release'
export const TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1 = 'text-open-world.creator.graybox'
export const TEXT_OPEN_WORLD_CREATOR_CALIBRATION_GATE_ID_V1 = 'text-open-world.creator.release-calibration'
export const TEXT_OPEN_WORLD_CREATOR_RELEASE_QUALITY_GATE_ID_V1 = 'text-open-world.creator.release-quality'
export const TEXT_OPEN_WORLD_CREATOR_ISSUE_GATE_PREFIX_V1 = 'text-open-world.creator.issue.'
export const TEXT_OPEN_WORLD_CREATOR_ISSUE_WAIVER_GATE_PREFIX_V1 = 'text-open-world.creator.issue-waiver.'

export const TEXT_OPEN_WORLD_CREATOR_ISSUE_CATEGORIES_V1 = [
  'narrative', 'quest', 'gameplay', 'balance', 'ui-accessibility', 'media',
  'performance', 'save-recovery', 'data-integrity', 'other',
] as const
export type TextOpenWorldCreatorIssueCategoryV1 = typeof TEXT_OPEN_WORLD_CREATOR_ISSUE_CATEGORIES_V1[number]
export type TextOpenWorldCreatorIssueSeverityV1 = 'advisory' | 'blocking'

export const TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1 = [
  'mainline-ending', 'governed-action', 'world-exploration', 'combat',
  'growth-or-economy', 'checkpoint-replay',
] as const
export type TextOpenWorldCreatorGrayboxCoverageKeyV1 = typeof TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1[number]

export interface TextOpenWorldCreatorBuildBindingV1 {
  productionKey: string
  buildNumber: number
  packageHash: string
  previewHash: string
  manifestHash: string
  qualityReportHash: string
  rootTerminalReceiptHash: string
}

export interface TextOpenWorldCreatorHardGateCheckV1 {
  gateKey: string
  label: string
  passed: boolean
  evidenceHashes: string[]
}

export interface TextOpenWorldCreatorHardGateEvidenceV1 {
  schema: 'storyforge.text-open-world-creator-hard-gate-evidence'
  version: 1
  build: TextOpenWorldCreatorBuildBindingV1
  governanceSnapshotHash: string
  checks: TextOpenWorldCreatorHardGateCheckV1[]
  evaluatedAt: number
}

export interface TextOpenWorldCreatorReviewScoreV1 {
  metricKey: string
  score: number
  rationale: string
}

export interface TextOpenWorldCreatorReviewFindingV1 {
  findingKey: string
  reviewKind: 'balance' | 'semantic'
  severity: 'advisory' | 'blocking'
  metricKey: string
  score: number
  summary: string
  evidence: string
  targetArtifactKey: string
  targetEntityKeys: string[]
  repairTaskKey: string
}

export interface TextOpenWorldCreatorReviewSummaryV1 {
  reviewKind: 'balance' | 'semantic'
  artifactHash: string
  reviewHash: string
  minimumScore: number
  threshold: number
  verdict: 'pass' | 'repair-required'
  scores: TextOpenWorldCreatorReviewScoreV1[]
  findings: TextOpenWorldCreatorReviewFindingV1[]
}

export interface TextOpenWorldCreatorSemanticWaiverV1 {
  findingKey: string
  reason: string
}

export interface TextOpenWorldCreatorHumanQualityChecksV1 {
  narrativeAndGuidanceReviewed: true
  regionalAndQuestVarietyReviewed: true
  dialogueAndKnowledgeReviewed: true
  mediaAndAccessibilityReviewed: true
  issueListComplete: true
}

export interface TextOpenWorldCreatorSemanticDecisionEvidenceV1 {
  schema: 'storyforge.text-open-world-creator-semantic-decision-evidence'
  version: 1
  build: TextOpenWorldCreatorBuildBindingV1
  reviews: Array<{
    reviewKind: 'balance' | 'semantic'
    artifactHash: string
    reviewHash: string
    minimumScore: number
    verdict: 'pass'
    findingKeys: string[]
  }>
  waivers: TextOpenWorldCreatorSemanticWaiverV1[]
  humanChecks: TextOpenWorldCreatorHumanQualityChecksV1
  authorNote: string
  decision: 'passed' | 'passed-with-soft-waivers'
  confirmedAt: number
}

export interface TextOpenWorldCreatorGrayboxEnvironmentV1 {
  browserName: string
  browserVersion: string
  platform: string
  viewport: { width: number; height: number }
}

export interface TextOpenWorldCreatorGrayboxSessionEvidenceV1 {
  sessionWitnessKey: string
  runtimeSourceHash: string
  seedHash: string
  titleHash: string
  status: 'active' | 'paused' | 'completed' | 'archived'
  initialStateHash: string
  currentStateHash: string
  eventStreamHash: string
  eventCount: number
  throughSequence: number
  endingKey: string | null
  actionKeys: string[]
  checkpointStateHashes: string[]
  coverageKeys: TextOpenWorldCreatorGrayboxCoverageKeyV1[]
  startedAt: number
  updatedAt: number
}

export interface TextOpenWorldCreatorGrayboxHumanChecksV1 {
  refreshedAndRecovered: true
  guidanceWasUnderstandable: true
  narrativeExperienceReviewed: true
  mediaAndFallbacksReviewed: true
  allObservedProblemsReported: true
}

export interface TextOpenWorldCreatorGrayboxEvidenceV1 {
  schema: 'storyforge.text-open-world-creator-graybox-evidence'
  version: 1
  build: TextOpenWorldCreatorBuildBindingV1
  sessions: TextOpenWorldCreatorGrayboxSessionEvidenceV1[]
  combinedCoverageKeys: TextOpenWorldCreatorGrayboxCoverageKeyV1[]
  environment: TextOpenWorldCreatorGrayboxEnvironmentV1
  humanChecks: TextOpenWorldCreatorGrayboxHumanChecksV1
  authorNote: string
  confirmedAt: number
}

export const TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1 = [
  'mainline-quality', 'significant-stories', 'template-differentiation',
] as const
export type TextOpenWorldCreatorCalibrationMetricV1 = typeof TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1[number]

export interface TextOpenWorldCreatorCalibrationEvidenceV1 {
  schema: 'storyforge.text-open-world-creator-calibration-evidence'
  version: 1
  build: TextOpenWorldCreatorBuildBindingV1
  generator: {
    provider: string
    model: string
    bindingHash: string
  }
  independentReview: {
    provider: string
    model: string
    promptVersion: string
    inputHash: string
    outputHash: string
    inputTokens: number | null
    outputTokens: number | null
    finishReason: string | null
    durationMs: number
    scores: Array<{
      metricKey: TextOpenWorldCreatorCalibrationMetricV1
      score: number
      rationale: string
    }>
    findings: string[]
  }
  productionSemanticReview: {
    reviewHash: string
    scores: Array<{ metricKey: string; score: number; rationale: string }>
  }
  templateDifferentiation: {
    templateCount: number
    variantCount: number
    minimumVariantsPerTemplate: number
    exactDuplicateTitleCount: number
    exactDuplicateDescriptionCount: number
    maximumPairSimilarityBasisPoints: number
  }
  contentDuration: {
    mainlineMinutes: number
    optionalInventoryMinutes: number
    totalAuthoredMinutes: number
    typicalPlaythroughMinutes: number
    requestedMainlineMinimum: number
    requestedMainlineMaximum: number
    requestedOptionalMinimum: number
    requestedOptionalMaximum: number
  }
  productionUsage: {
    ledgerHash: string
    modelCalls: number
    inputTokens: number
    outputTokens: number
    totalDurationMs: number
    averageCallDurationMs: number
    p95CallDurationMs: number
    maximumCallDurationMs: number
    estimatedTextCostUsd: number
    priceQuoteHash: string
    priceQuoteSource: string
    priceQuoteAsOf: string
    budgetMaximumCalls: number
    budgetMaximumInputTokens: number
    budgetMaximumOutputTokens: number
    budgetMaximumDurationMs: number
    budgetMaximumCostUsd: number
  }
  checks: Array<{ key: string; passed: boolean; summary: string }>
  passed: boolean
  evaluatedAt: number
}

export interface TextOpenWorldCreatorCalibrationReadinessV1 {
  generator: { provider: string; model: string }
  grader: { provider: string; model: string }
  credentialReady: boolean
  independentIdentity: boolean
  ready: boolean
  issue: string | null
}

export interface TextOpenWorldCreatorIssueRuntimeWitnessV1 {
  sessionWitnessKey: string
  runtimeSourceHash: string
  currentStateHash: string
  eventStreamHash: string
  throughSequence: number
}

export interface TextOpenWorldCreatorIssueEvidenceV1 {
  schema: 'storyforge.text-open-world-creator-issue-evidence'
  version: 1
  build: TextOpenWorldCreatorBuildBindingV1
  issueKey: string
  issueFingerprint: string
  severity: TextOpenWorldCreatorIssueSeverityV1
  category: TextOpenWorldCreatorIssueCategoryV1
  summary: string
  preconditions: string[]
  reproductionSteps: string[]
  expected: string
  actual: string
  affectedStableKeys: string[]
  runtimeWitness: TextOpenWorldCreatorIssueRuntimeWitnessV1 | null
  sourceTextExcluded: true
  reportedAt: number
}

export interface TextOpenWorldCreatorIssueWaiverEvidenceV1 {
  schema: 'storyforge.text-open-world-creator-issue-waiver-evidence'
  version: 1
  build: TextOpenWorldCreatorBuildBindingV1
  issueKey: string
  issueReceiptHash: string
  reason: string
  confirmation: 'author-accepts-advisory-risk'
  confirmedAt: number
}

export interface TextOpenWorldCreatorReleaseQualityEvidenceV1 {
  schema: 'storyforge.text-open-world-creator-release-quality-evidence'
  version: 1
  build: TextOpenWorldCreatorBuildBindingV1
  hardGateReceiptHash: string
  semanticDecisionReceiptHash: string
  grayboxReceiptHash: string
  issueReceiptHashes: string[]
  issueWaiverReceiptHashes: string[]
  issueSetHash: string
  status: 'passed'
  completedAt: number
}

export interface TextOpenWorldCreatorQualityReceiptV1<T> {
  rowId: number
  gateId: string
  status: ProductQualityGateReceiptStatusV1
  receiptHash: string
  evidence: T
  createdAt: number
}

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-quality-contract] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不符合合同:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum: number, minimum = 1): string {
  if (typeof value !== 'string') fail(`${label} 必须是文本`)
  const normalized = value.trim().normalize('NFC')
  if (normalized.length < minimum || normalized.length > maximum) fail(`${label} 长度无效`)
  return normalized
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) fail(`${label} 无效`)
  return Number(value)
}

function finiteNumber(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) fail(`${label} 无效`)
  return value
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSha256Hash(value)) fail(`${label} 不是SHA-256`)
  return value
}

function hashList(value: unknown, label: string, maximum = 10_000): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} 无效`)
  const rows = value.map((item, index) => hash(item, `${label}[${index}]`))
  if (new Set(rows).size !== rows.length || [...rows].sort().some((item, index) => item !== rows[index])) {
    fail(`${label} 必须唯一排序`)
  }
  return rows
}

function textList(value: unknown, label: string, maximumItems: number, maximumLength: number, minimumItems = 0): string[] {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > maximumItems) fail(`${label} 数量无效`)
  const rows = value.map((item, index) => text(item, `${label}[${index}]`, maximumLength))
  if (new Set(rows).size !== rows.length) fail(`${label} 不能重复`)
  return rows
}

export function parseTextOpenWorldCreatorBuildBindingV1(value: unknown): TextOpenWorldCreatorBuildBindingV1 {
  const row = record(value, 'build')
  exactKeys(row, [
    'productionKey', 'buildNumber', 'packageHash', 'previewHash', 'manifestHash',
    'qualityReportHash', 'rootTerminalReceiptHash',
  ], 'build')
  return {
    productionKey: text(row.productionKey, 'productionKey', 200),
    buildNumber: integer(row.buildNumber, 'buildNumber', 1),
    packageHash: hash(row.packageHash, 'packageHash'),
    previewHash: hash(row.previewHash, 'previewHash'),
    manifestHash: hash(row.manifestHash, 'manifestHash'),
    qualityReportHash: hash(row.qualityReportHash, 'qualityReportHash'),
    rootTerminalReceiptHash: hash(row.rootTerminalReceiptHash, 'rootTerminalReceiptHash'),
  }
}

function parseEnvironment(value: unknown): TextOpenWorldCreatorGrayboxEnvironmentV1 {
  const row = record(value, 'environment')
  exactKeys(row, ['browserName', 'browserVersion', 'platform', 'viewport'], 'environment')
  const viewport = record(row.viewport, 'environment.viewport')
  exactKeys(viewport, ['width', 'height'], 'environment.viewport')
  return {
    browserName: text(row.browserName, 'browserName', 200),
    browserVersion: text(row.browserVersion, 'browserVersion', 500),
    platform: text(row.platform, 'platform', 200),
    viewport: {
      width: integer(viewport.width, 'viewport.width', 1),
      height: integer(viewport.height, 'viewport.height', 1),
    },
  }
}

export function parseTextOpenWorldCreatorHardGateEvidenceV1(value: unknown): TextOpenWorldCreatorHardGateEvidenceV1 {
  const row = record(value, 'hard gate evidence')
  exactKeys(row, ['schema', 'version', 'build', 'governanceSnapshotHash', 'checks', 'evaluatedAt'], 'hard gate evidence')
  if (row.schema !== 'storyforge.text-open-world-creator-hard-gate-evidence' || row.version !== 1
    || !Array.isArray(row.checks) || row.checks.length < 1 || row.checks.length > 200) fail('hard gate evidence 身份或数量无效')
  const checks = row.checks.map((value, index) => {
    const check = record(value, `checks[${index}]`)
    exactKeys(check, ['gateKey', 'label', 'passed', 'evidenceHashes'], `checks[${index}]`)
    if (typeof check.passed !== 'boolean') fail(`checks[${index}].passed 无效`)
    return {
      gateKey: text(check.gateKey, `checks[${index}].gateKey`, 200),
      label: text(check.label, `checks[${index}].label`, 500),
      passed: check.passed,
      evidenceHashes: hashList(check.evidenceHashes, `checks[${index}].evidenceHashes`, 50),
    }
  })
  if (new Set(checks.map(check => check.gateKey)).size !== checks.length
    || checks.some(check => !check.passed)) fail('hard gate evidence 不能包含重复或未通过硬门')
  return {
    schema: 'storyforge.text-open-world-creator-hard-gate-evidence', version: 1,
    build: parseTextOpenWorldCreatorBuildBindingV1(row.build),
    governanceSnapshotHash: hash(row.governanceSnapshotHash, 'governanceSnapshotHash'),
    checks, evaluatedAt: integer(row.evaluatedAt, 'evaluatedAt', 1),
  }
}

function parseHumanQualityChecks(value: unknown): TextOpenWorldCreatorHumanQualityChecksV1 {
  const row = record(value, 'humanChecks')
  const keys = [
    'narrativeAndGuidanceReviewed', 'regionalAndQuestVarietyReviewed',
    'dialogueAndKnowledgeReviewed', 'mediaAndAccessibilityReviewed', 'issueListComplete',
  ] as const
  exactKeys(row, keys, 'humanChecks')
  if (keys.some(key => row[key] !== true)) fail('所有人工质量检查必须明确确认')
  return row as unknown as TextOpenWorldCreatorHumanQualityChecksV1
}

export function parseTextOpenWorldCreatorSemanticDecisionEvidenceV1(value: unknown): TextOpenWorldCreatorSemanticDecisionEvidenceV1 {
  const row = record(value, 'semantic decision evidence')
  exactKeys(row, [
    'schema', 'version', 'build', 'reviews', 'waivers', 'humanChecks', 'authorNote',
    'decision', 'confirmedAt',
  ], 'semantic decision evidence')
  if (row.schema !== 'storyforge.text-open-world-creator-semantic-decision-evidence' || row.version !== 1
    || !Array.isArray(row.reviews) || row.reviews.length !== 2
    || !Array.isArray(row.waivers)
    || !['passed', 'passed-with-soft-waivers'].includes(String(row.decision))) fail('semantic decision 身份或基础字段无效')
  const reviews = row.reviews.map((value, index) => {
    const review = record(value, `reviews[${index}]`)
    exactKeys(review, [
      'reviewKind', 'artifactHash', 'reviewHash', 'minimumScore', 'verdict', 'findingKeys',
    ], `reviews[${index}]`)
    if (!['balance', 'semantic'].includes(String(review.reviewKind)) || review.verdict !== 'pass'
      || !Number.isInteger(review.minimumScore) || Number(review.minimumScore) < 0 || Number(review.minimumScore) > 100) {
      fail(`reviews[${index}] 无效`)
    }
    return {
      reviewKind: review.reviewKind as 'balance' | 'semantic',
      artifactHash: hash(review.artifactHash, `reviews[${index}].artifactHash`),
      reviewHash: hash(review.reviewHash, `reviews[${index}].reviewHash`),
      minimumScore: Number(review.minimumScore), verdict: 'pass' as const,
      findingKeys: textList(review.findingKeys, `reviews[${index}].findingKeys`, 100, 200).sort(),
    }
  }).sort((left, right) => left.reviewKind.localeCompare(right.reviewKind))
  if (reviews[0]?.reviewKind !== 'balance' || reviews[1]?.reviewKind !== 'semantic') fail('reviews 必须完整覆盖双评审')
  const waivers = row.waivers.map((value, index) => {
    const waiver = record(value, `waivers[${index}]`)
    exactKeys(waiver, ['findingKey', 'reason'], `waivers[${index}]`)
    return {
      findingKey: text(waiver.findingKey, `waivers[${index}].findingKey`, 200),
      reason: text(waiver.reason, `waivers[${index}].reason`, 2_000, 20),
    }
  }).sort((left, right) => left.findingKey.localeCompare(right.findingKey))
  if (new Set(waivers.map(item => item.findingKey)).size !== waivers.length
    || (row.decision === 'passed') !== (waivers.length === 0)) fail('waiver 与 decision 不一致')
  return {
    schema: 'storyforge.text-open-world-creator-semantic-decision-evidence', version: 1,
    build: parseTextOpenWorldCreatorBuildBindingV1(row.build), reviews, waivers,
    humanChecks: parseHumanQualityChecks(row.humanChecks),
    authorNote: typeof row.authorNote === 'string' && row.authorNote.trim()
      ? text(row.authorNote, 'authorNote', 4_000) : '',
    decision: row.decision as TextOpenWorldCreatorSemanticDecisionEvidenceV1['decision'],
    confirmedAt: integer(row.confirmedAt, 'confirmedAt', 1),
  }
}

function parseGrayboxHumanChecks(value: unknown): TextOpenWorldCreatorGrayboxHumanChecksV1 {
  const row = record(value, 'graybox.humanChecks')
  const keys = [
    'refreshedAndRecovered', 'guidanceWasUnderstandable', 'narrativeExperienceReviewed',
    'mediaAndFallbacksReviewed', 'allObservedProblemsReported',
  ] as const
  exactKeys(row, keys, 'graybox.humanChecks')
  if (keys.some(key => row[key] !== true)) fail('灰盒人工检查必须全部明确确认')
  return row as unknown as TextOpenWorldCreatorGrayboxHumanChecksV1
}

function parseCoverageKeys(value: unknown, label: string): TextOpenWorldCreatorGrayboxCoverageKeyV1[] {
  const values = textList(value, label, TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1.length, 100)
  if (values.some(item => !TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1.includes(item as TextOpenWorldCreatorGrayboxCoverageKeyV1))) {
    fail(`${label} 含未知覆盖项`)
  }
  return values as TextOpenWorldCreatorGrayboxCoverageKeyV1[]
}

function parseGrayboxSession(value: unknown, index: number): TextOpenWorldCreatorGrayboxSessionEvidenceV1 {
  const row = record(value, `sessions[${index}]`)
  exactKeys(row, [
    'sessionWitnessKey', 'runtimeSourceHash', 'seedHash', 'titleHash', 'status',
    'initialStateHash', 'currentStateHash', 'eventStreamHash', 'eventCount', 'throughSequence',
    'endingKey', 'actionKeys', 'checkpointStateHashes', 'coverageKeys', 'startedAt', 'updatedAt',
  ], `sessions[${index}]`)
  if (!['active', 'paused', 'completed', 'archived'].includes(String(row.status))) fail(`sessions[${index}].status 无效`)
  return {
    sessionWitnessKey: text(row.sessionWitnessKey, `sessions[${index}].sessionWitnessKey`, 200),
    runtimeSourceHash: hash(row.runtimeSourceHash, `sessions[${index}].runtimeSourceHash`),
    seedHash: hash(row.seedHash, `sessions[${index}].seedHash`),
    titleHash: hash(row.titleHash, `sessions[${index}].titleHash`),
    status: row.status as TextOpenWorldCreatorGrayboxSessionEvidenceV1['status'],
    initialStateHash: hash(row.initialStateHash, `sessions[${index}].initialStateHash`),
    currentStateHash: hash(row.currentStateHash, `sessions[${index}].currentStateHash`),
    eventStreamHash: hash(row.eventStreamHash, `sessions[${index}].eventStreamHash`),
    eventCount: integer(row.eventCount, `sessions[${index}].eventCount`, 1),
    throughSequence: integer(row.throughSequence, `sessions[${index}].throughSequence`, 1),
    endingKey: row.endingKey == null ? null : text(row.endingKey, `sessions[${index}].endingKey`, 200),
    actionKeys: textList(row.actionKeys, `sessions[${index}].actionKeys`, 10_000, 200).sort(),
    checkpointStateHashes: hashList(row.checkpointStateHashes, `sessions[${index}].checkpointStateHashes`, 1_000),
    coverageKeys: parseCoverageKeys(row.coverageKeys, `sessions[${index}].coverageKeys`).sort(),
    startedAt: integer(row.startedAt, `sessions[${index}].startedAt`, 1),
    updatedAt: integer(row.updatedAt, `sessions[${index}].updatedAt`, 1),
  }
}

export function parseTextOpenWorldCreatorGrayboxEvidenceV1(value: unknown): TextOpenWorldCreatorGrayboxEvidenceV1 {
  const row = record(value, 'graybox evidence')
  exactKeys(row, [
    'schema', 'version', 'build', 'sessions', 'combinedCoverageKeys', 'environment',
    'humanChecks', 'authorNote', 'confirmedAt',
  ], 'graybox evidence')
  if (row.schema !== 'storyforge.text-open-world-creator-graybox-evidence' || row.version !== 1
    || !Array.isArray(row.sessions) || row.sessions.length < 1 || row.sessions.length > 6) fail('graybox evidence 身份或Session数量无效')
  const sessions = row.sessions.map(parseGrayboxSession)
    .sort((left, right) => left.sessionWitnessKey.localeCompare(right.sessionWitnessKey))
  if (new Set(sessions.map(item => item.sessionWitnessKey)).size !== sessions.length) fail('graybox Session重复')
  const combinedCoverageKeys = parseCoverageKeys(row.combinedCoverageKeys, 'combinedCoverageKeys').sort()
  if (TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1.some(key => !combinedCoverageKeys.includes(key))) {
    fail('graybox 未覆盖完整首版标准路径')
  }
  const actualCombined = [...new Set(sessions.flatMap(session => session.coverageKeys))].sort()
  if (actualCombined.length !== combinedCoverageKeys.length
    || actualCombined.some((key, index) => key !== combinedCoverageKeys[index])) fail('graybox combinedCoverageKeys 与Session不一致')
  if (!sessions.some(session => session.status === 'completed' && session.endingKey)) fail('graybox 缺少完成主线的Session')
  return {
    schema: 'storyforge.text-open-world-creator-graybox-evidence', version: 1,
    build: parseTextOpenWorldCreatorBuildBindingV1(row.build), sessions, combinedCoverageKeys,
    environment: parseEnvironment(row.environment), humanChecks: parseGrayboxHumanChecks(row.humanChecks),
    authorNote: typeof row.authorNote === 'string' && row.authorNote.trim()
      ? text(row.authorNote, 'authorNote', 4_000) : '',
    confirmedAt: integer(row.confirmedAt, 'confirmedAt', 1),
  }
}

export function parseTextOpenWorldCreatorCalibrationEvidenceV1(value: unknown): TextOpenWorldCreatorCalibrationEvidenceV1 {
  const row = record(value, 'calibration evidence')
  exactKeys(row, [
    'schema', 'version', 'build', 'generator', 'independentReview', 'productionSemanticReview',
    'templateDifferentiation', 'contentDuration', 'productionUsage', 'checks', 'passed', 'evaluatedAt',
  ], 'calibration evidence')
  if (row.schema !== 'storyforge.text-open-world-creator-calibration-evidence' || row.version !== 1
    || typeof row.passed !== 'boolean' || !Array.isArray(row.checks)) fail('calibration evidence 身份无效')
  const generator = record(row.generator, 'generator')
  exactKeys(generator, ['provider', 'model', 'bindingHash'], 'generator')
  const review = record(row.independentReview, 'independentReview')
  exactKeys(review, [
    'provider', 'model', 'promptVersion', 'inputHash', 'outputHash', 'inputTokens', 'outputTokens',
    'finishReason', 'durationMs', 'scores', 'findings',
  ], 'independentReview')
  if (!Array.isArray(review.scores) || review.scores.length !== TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1.length) {
    fail('independentReview.scores 数量无效')
  }
  const scores = review.scores.map((value, index) => {
    const score = record(value, `independentReview.scores[${index}]`)
    exactKeys(score, ['metricKey', 'score', 'rationale'], `independentReview.scores[${index}]`)
    if (score.metricKey !== TEXT_OPEN_WORLD_CREATOR_CALIBRATION_METRICS_V1[index]
      || !Number.isInteger(score.score) || Number(score.score) < 0 || Number(score.score) > 100) {
      fail(`independentReview.scores[${index}] 无效`)
    }
    return {
      metricKey: score.metricKey as TextOpenWorldCreatorCalibrationMetricV1,
      score: Number(score.score), rationale: text(score.rationale, `independentReview.scores[${index}].rationale`, 1_000),
    }
  })
  const semantic = record(row.productionSemanticReview, 'productionSemanticReview')
  exactKeys(semantic, ['reviewHash', 'scores'], 'productionSemanticReview')
  if (!Array.isArray(semantic.scores) || semantic.scores.length < 3 || semantic.scores.length > 20) {
    fail('productionSemanticReview.scores 数量无效')
  }
  const semanticScores = semantic.scores.map((value, index) => {
    const score = record(value, `productionSemanticReview.scores[${index}]`)
    exactKeys(score, ['metricKey', 'score', 'rationale'], `productionSemanticReview.scores[${index}]`)
    if (!Number.isInteger(score.score) || Number(score.score) < 0 || Number(score.score) > 100) {
      fail(`productionSemanticReview.scores[${index}].score 无效`)
    }
    return {
      metricKey: text(score.metricKey, `productionSemanticReview.scores[${index}].metricKey`, 100),
      score: Number(score.score), rationale: text(score.rationale, `productionSemanticReview.scores[${index}].rationale`, 1_000),
    }
  })
  const variants = record(row.templateDifferentiation, 'templateDifferentiation')
  exactKeys(variants, [
    'templateCount', 'variantCount', 'minimumVariantsPerTemplate', 'exactDuplicateTitleCount',
    'exactDuplicateDescriptionCount', 'maximumPairSimilarityBasisPoints',
  ], 'templateDifferentiation')
  const duration = record(row.contentDuration, 'contentDuration')
  exactKeys(duration, [
    'mainlineMinutes', 'optionalInventoryMinutes', 'totalAuthoredMinutes', 'typicalPlaythroughMinutes',
    'requestedMainlineMinimum', 'requestedMainlineMaximum', 'requestedOptionalMinimum', 'requestedOptionalMaximum',
  ], 'contentDuration')
  const usage = record(row.productionUsage, 'productionUsage')
  exactKeys(usage, [
    'ledgerHash', 'modelCalls', 'inputTokens', 'outputTokens', 'totalDurationMs', 'averageCallDurationMs',
    'p95CallDurationMs', 'maximumCallDurationMs', 'estimatedTextCostUsd', 'priceQuoteHash',
    'priceQuoteSource', 'priceQuoteAsOf', 'budgetMaximumCalls', 'budgetMaximumInputTokens',
    'budgetMaximumOutputTokens', 'budgetMaximumDurationMs', 'budgetMaximumCostUsd',
  ], 'productionUsage')
  const checks = row.checks.map((value, index) => {
    const check = record(value, `checks[${index}]`)
    exactKeys(check, ['key', 'passed', 'summary'], `checks[${index}]`)
    if (typeof check.passed !== 'boolean') fail(`checks[${index}].passed 无效`)
    return {
      key: text(check.key, `checks[${index}].key`, 200), passed: check.passed,
      summary: text(check.summary, `checks[${index}].summary`, 1_000),
    }
  })
  if (checks.length < 5 || checks.length > 30 || new Set(checks.map(check => check.key)).size !== checks.length
    || row.passed !== checks.every(check => check.passed)) fail('checks 与 passed 不一致')
  const inputTokens = review.inputTokens == null ? null : integer(review.inputTokens, 'independentReview.inputTokens')
  const outputTokens = review.outputTokens == null ? null : integer(review.outputTokens, 'independentReview.outputTokens')
  return {
    schema: 'storyforge.text-open-world-creator-calibration-evidence', version: 1,
    build: parseTextOpenWorldCreatorBuildBindingV1(row.build),
    generator: {
      provider: text(generator.provider, 'generator.provider', 100), model: text(generator.model, 'generator.model', 500),
      bindingHash: hash(generator.bindingHash, 'generator.bindingHash'),
    },
    independentReview: {
      provider: text(review.provider, 'independentReview.provider', 100),
      model: text(review.model, 'independentReview.model', 500),
      promptVersion: text(review.promptVersion, 'independentReview.promptVersion', 200),
      inputHash: hash(review.inputHash, 'independentReview.inputHash'),
      outputHash: hash(review.outputHash, 'independentReview.outputHash'), inputTokens, outputTokens,
      finishReason: review.finishReason == null ? null : text(review.finishReason, 'independentReview.finishReason', 100),
      durationMs: integer(review.durationMs, 'independentReview.durationMs', 1), scores,
      findings: textList(review.findings, 'independentReview.findings', 30, 1_000),
    },
    productionSemanticReview: { reviewHash: hash(semantic.reviewHash, 'productionSemanticReview.reviewHash'), scores: semanticScores },
    templateDifferentiation: {
      templateCount: integer(variants.templateCount, 'templateCount'), variantCount: integer(variants.variantCount, 'variantCount'),
      minimumVariantsPerTemplate: integer(variants.minimumVariantsPerTemplate, 'minimumVariantsPerTemplate'),
      exactDuplicateTitleCount: integer(variants.exactDuplicateTitleCount, 'exactDuplicateTitleCount'),
      exactDuplicateDescriptionCount: integer(variants.exactDuplicateDescriptionCount, 'exactDuplicateDescriptionCount'),
      maximumPairSimilarityBasisPoints: integer(variants.maximumPairSimilarityBasisPoints, 'maximumPairSimilarityBasisPoints'),
    },
    contentDuration: {
      mainlineMinutes: integer(duration.mainlineMinutes, 'mainlineMinutes'),
      optionalInventoryMinutes: integer(duration.optionalInventoryMinutes, 'optionalInventoryMinutes'),
      totalAuthoredMinutes: integer(duration.totalAuthoredMinutes, 'totalAuthoredMinutes'),
      typicalPlaythroughMinutes: integer(duration.typicalPlaythroughMinutes, 'typicalPlaythroughMinutes'),
      requestedMainlineMinimum: integer(duration.requestedMainlineMinimum, 'requestedMainlineMinimum'),
      requestedMainlineMaximum: integer(duration.requestedMainlineMaximum, 'requestedMainlineMaximum'),
      requestedOptionalMinimum: integer(duration.requestedOptionalMinimum, 'requestedOptionalMinimum'),
      requestedOptionalMaximum: integer(duration.requestedOptionalMaximum, 'requestedOptionalMaximum'),
    },
    productionUsage: {
      ledgerHash: hash(usage.ledgerHash, 'productionUsage.ledgerHash'),
      modelCalls: integer(usage.modelCalls, 'productionUsage.modelCalls'),
      inputTokens: integer(usage.inputTokens, 'productionUsage.inputTokens'),
      outputTokens: integer(usage.outputTokens, 'productionUsage.outputTokens'),
      totalDurationMs: integer(usage.totalDurationMs, 'productionUsage.totalDurationMs'),
      averageCallDurationMs: integer(usage.averageCallDurationMs, 'productionUsage.averageCallDurationMs'),
      p95CallDurationMs: integer(usage.p95CallDurationMs, 'productionUsage.p95CallDurationMs'),
      maximumCallDurationMs: integer(usage.maximumCallDurationMs, 'productionUsage.maximumCallDurationMs'),
      estimatedTextCostUsd: finiteNumber(usage.estimatedTextCostUsd, 'productionUsage.estimatedTextCostUsd'),
      priceQuoteHash: hash(usage.priceQuoteHash, 'productionUsage.priceQuoteHash'),
      priceQuoteSource: text(usage.priceQuoteSource, 'productionUsage.priceQuoteSource', 100),
      priceQuoteAsOf: text(usage.priceQuoteAsOf, 'productionUsage.priceQuoteAsOf', 100),
      budgetMaximumCalls: integer(usage.budgetMaximumCalls, 'productionUsage.budgetMaximumCalls'),
      budgetMaximumInputTokens: integer(usage.budgetMaximumInputTokens, 'productionUsage.budgetMaximumInputTokens'),
      budgetMaximumOutputTokens: integer(usage.budgetMaximumOutputTokens, 'productionUsage.budgetMaximumOutputTokens'),
      budgetMaximumDurationMs: integer(usage.budgetMaximumDurationMs, 'productionUsage.budgetMaximumDurationMs'),
      budgetMaximumCostUsd: finiteNumber(usage.budgetMaximumCostUsd, 'productionUsage.budgetMaximumCostUsd'),
    },
    checks, passed: row.passed, evaluatedAt: integer(row.evaluatedAt, 'evaluatedAt', 1),
  }
}

function parseRuntimeWitness(value: unknown): TextOpenWorldCreatorIssueRuntimeWitnessV1 | null {
  if (value == null) return null
  const row = record(value, 'runtimeWitness')
  exactKeys(row, ['sessionWitnessKey', 'runtimeSourceHash', 'currentStateHash', 'eventStreamHash', 'throughSequence'], 'runtimeWitness')
  return {
    sessionWitnessKey: text(row.sessionWitnessKey, 'sessionWitnessKey', 200),
    runtimeSourceHash: hash(row.runtimeSourceHash, 'runtimeSourceHash'),
    currentStateHash: hash(row.currentStateHash, 'currentStateHash'),
    eventStreamHash: hash(row.eventStreamHash, 'eventStreamHash'),
    throughSequence: integer(row.throughSequence, 'throughSequence', 1),
  }
}

export function parseTextOpenWorldCreatorIssueEvidenceV1(value: unknown): TextOpenWorldCreatorIssueEvidenceV1 {
  const row = record(value, 'issue evidence')
  exactKeys(row, [
    'schema', 'version', 'build', 'issueKey', 'issueFingerprint', 'severity', 'category',
    'summary', 'preconditions', 'reproductionSteps', 'expected', 'actual', 'affectedStableKeys',
    'runtimeWitness', 'sourceTextExcluded', 'reportedAt',
  ], 'issue evidence')
  if (row.schema !== 'storyforge.text-open-world-creator-issue-evidence' || row.version !== 1
    || !['advisory', 'blocking'].includes(String(row.severity))
    || !TEXT_OPEN_WORLD_CREATOR_ISSUE_CATEGORIES_V1.includes(row.category as TextOpenWorldCreatorIssueCategoryV1)
    || row.sourceTextExcluded !== true) fail('issue evidence 身份或枚举无效')
  const issueFingerprint = hash(row.issueFingerprint, 'issueFingerprint')
  const issueKey = text(row.issueKey, 'issueKey', 100)
  if (issueKey !== `issue.${issueFingerprint.slice(0, 24)}`) fail('issueKey 与 fingerprint 不一致')
  return {
    schema: 'storyforge.text-open-world-creator-issue-evidence', version: 1,
    build: parseTextOpenWorldCreatorBuildBindingV1(row.build), issueKey, issueFingerprint,
    severity: row.severity as TextOpenWorldCreatorIssueSeverityV1,
    category: row.category as TextOpenWorldCreatorIssueCategoryV1,
    summary: text(row.summary, 'summary', 300, 5),
    preconditions: textList(row.preconditions, 'preconditions', 20, 500),
    reproductionSteps: textList(row.reproductionSteps, 'reproductionSteps', 30, 1_000, 1),
    expected: text(row.expected, 'expected', 2_000, 3), actual: text(row.actual, 'actual', 2_000, 3),
    affectedStableKeys: textList(row.affectedStableKeys, 'affectedStableKeys', 100, 200).sort(),
    runtimeWitness: parseRuntimeWitness(row.runtimeWitness), sourceTextExcluded: true,
    reportedAt: integer(row.reportedAt, 'reportedAt', 1),
  }
}

export function parseTextOpenWorldCreatorIssueWaiverEvidenceV1(value: unknown): TextOpenWorldCreatorIssueWaiverEvidenceV1 {
  const row = record(value, 'issue waiver evidence')
  exactKeys(row, [
    'schema', 'version', 'build', 'issueKey', 'issueReceiptHash', 'reason', 'confirmation', 'confirmedAt',
  ], 'issue waiver evidence')
  if (row.schema !== 'storyforge.text-open-world-creator-issue-waiver-evidence' || row.version !== 1
    || row.confirmation !== 'author-accepts-advisory-risk') fail('issue waiver evidence 身份或确认无效')
  return {
    schema: 'storyforge.text-open-world-creator-issue-waiver-evidence', version: 1,
    build: parseTextOpenWorldCreatorBuildBindingV1(row.build),
    issueKey: text(row.issueKey, 'issueKey', 100),
    issueReceiptHash: hash(row.issueReceiptHash, 'issueReceiptHash'),
    reason: text(row.reason, 'reason', 2_000, 20),
    confirmation: 'author-accepts-advisory-risk',
    confirmedAt: integer(row.confirmedAt, 'confirmedAt', 1),
  }
}

export function parseTextOpenWorldCreatorReleaseQualityEvidenceV1(value: unknown): TextOpenWorldCreatorReleaseQualityEvidenceV1 {
  const row = record(value, 'release quality evidence')
  exactKeys(row, [
    'schema', 'version', 'build', 'hardGateReceiptHash', 'semanticDecisionReceiptHash',
    'grayboxReceiptHash', 'issueReceiptHashes', 'issueWaiverReceiptHashes', 'issueSetHash',
    'status', 'completedAt',
  ], 'release quality evidence')
  if (row.schema !== 'storyforge.text-open-world-creator-release-quality-evidence' || row.version !== 1
    || row.status !== 'passed') fail('release quality evidence 身份或状态无效')
  return {
    schema: 'storyforge.text-open-world-creator-release-quality-evidence', version: 1,
    build: parseTextOpenWorldCreatorBuildBindingV1(row.build),
    hardGateReceiptHash: hash(row.hardGateReceiptHash, 'hardGateReceiptHash'),
    semanticDecisionReceiptHash: hash(row.semanticDecisionReceiptHash, 'semanticDecisionReceiptHash'),
    grayboxReceiptHash: hash(row.grayboxReceiptHash, 'grayboxReceiptHash'),
    issueReceiptHashes: hashList(row.issueReceiptHashes, 'issueReceiptHashes'),
    issueWaiverReceiptHashes: hashList(row.issueWaiverReceiptHashes, 'issueWaiverReceiptHashes'),
    issueSetHash: hash(row.issueSetHash, 'issueSetHash'), status: 'passed',
    completedAt: integer(row.completedAt, 'completedAt', 1),
  }
}
