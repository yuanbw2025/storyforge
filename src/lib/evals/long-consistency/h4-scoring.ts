import { normalizeChapterText } from '../../ai/chapter-memory/text-normalization'
import { canonicalStringify, hashCanonicalValue } from '../../agent/run/hash'
import { assertExactKeys, readRecord } from '../../agent/run/schema-utils'
import type { LongConsistencyEvidenceSpanV1, LongConsistencyIssueV1 } from './report-types'
import {
  getH4LongConsistencyFixturesV1,
  type H4LongConsistencyExpectedIssueV1,
  type H4LongConsistencyFixtureV1,
} from './h4-fixtures'
import {
  parseH4LongConsistencyRunCheckpointV1,
  verifyH4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyRunUsageV1,
} from './h4-runner'
import { wilsonInterval95V1, type H4WilsonIntervalV1 } from './h4-statistics'
import type { LongConsistencyEvalTaskV1 } from './report-types'

export const H4_LONG_CONSISTENCY_SCORING_VERSION_V1 = 'h4-sealed-scoring-v1'
export const H4_LONG_CONSISTENCY_SCORE_TYPE_V1 = 'storyforge-h4-sealed-score'

export interface H4LongConsistencyReleaseThresholdsV1 {
  minimumCompletedCases: number
  minimumHighSeverityHardPrecision: number
  minimumHighSeverityHardRecall: number
  minimumEvidenceVerificationRate: number
  maximumIntentEscalationRate: number
  maximumCleanHardFalsePositiveRate: number
}

export type H4LongConsistencyGateFailureV1 =
  | 'run-not-completed'
  | 'minimum-completed-cases'
  | 'high-severity-hard-precision'
  | 'high-severity-hard-recall'
  | 'evidence-verification'
  | 'intent-escalation'
  | 'clean-hard-false-positive'
  | 'budget-exceeded'
  | 'identity-separation'
  | 'usage-evidence-missing'

export interface H4LongConsistencySealedScoreV1 {
  schemaVersion: 1
  scoreType: typeof H4_LONG_CONSISTENCY_SCORE_TYPE_V1
  scoringVersion: typeof H4_LONG_CONSISTENCY_SCORING_VERSION_V1
  fixtureVersion: H4LongConsistencyRunCheckpointV1['fixtureVersion']
  runId: string
  split: H4LongConsistencyRunCheckpointV1['split']
  codeRevision: string
  createdAt: string
  execution: H4LongConsistencyRunCheckpointV1['execution']
  checkpointHash: string
  fixtureSetHash: string
  artifactSetHash: string
  completedCases: number
  taskCounts: Record<LongConsistencyEvalTaskV1, number>
  highSeverityHard: {
    truePositive: number
    falsePositive: number
    falseNegative: number
    precision: H4WilsonIntervalV1
    recall: H4WilsonIntervalV1
  }
  evidence: {
    reportedPairs: number
    verifiedPairs: number
    verificationRate: H4WilsonIntervalV1
  }
  intentControls: {
    cases: number
    hardEscalations: number
    escalationRate: H4WilsonIntervalV1
  }
  cleanControls: {
    cases: number
    hardFalsePositives: number
    falsePositiveRate: H4WilsonIntervalV1
  }
  failedAttempts: number
  usage: H4LongConsistencyRunUsageV1
  thresholds: H4LongConsistencyReleaseThresholdsV1
  gate: {
    passed: boolean
    failures: H4LongConsistencyGateFailureV1[]
  }
  scoreHash: string
}

export interface H4LongConsistencyIssueCaseV1 {
  fixtureId: string
  issues: readonly LongConsistencyIssueV1[]
}

export interface H4LongConsistencyMetricSummaryV1 {
  taskCounts: Record<LongConsistencyEvalTaskV1, number>
  highSeverityHard: {
    truePositive: number
    falsePositive: number
    falseNegative: number
    precision: H4WilsonIntervalV1
    recall: H4WilsonIntervalV1
  }
  evidence: {
    reportedPairs: number
    verifiedPairs: number
    verificationRate: H4WilsonIntervalV1
  }
  intentControls: {
    cases: number
    hardEscalations: number
    escalationRate: H4WilsonIntervalV1
  }
  cleanControls: {
    cases: number
    hardFalsePositives: number
    falsePositiveRate: H4WilsonIntervalV1
  }
}

interface ExpectedSpan {
  sourceId: string
  startOffset: number
  endOffset: number
}

function defaultThresholds(split: H4LongConsistencyRunCheckpointV1['split']): H4LongConsistencyReleaseThresholdsV1 {
  return {
    minimumCompletedCases: split === 'held-out' ? 20 : 40,
    minimumHighSeverityHardPrecision: 0.9,
    minimumHighSeverityHardRecall: 0.8,
    minimumEvidenceVerificationRate: 1,
    maximumIntentEscalationRate: 0.05,
    maximumCleanHardFalsePositiveRate: 0,
  }
}

function unit(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${path} 必须在 0 到 1 之间`)
  return value
}

export function resolveH4LongConsistencyReleaseThresholdsV1(
  split: H4LongConsistencyRunCheckpointV1['split'],
  override?: Partial<H4LongConsistencyReleaseThresholdsV1>,
): H4LongConsistencyReleaseThresholdsV1 {
  const baseline = defaultThresholds(split)
  if (override) {
    const keys = [
      'minimumCompletedCases',
      'minimumHighSeverityHardPrecision',
      'minimumHighSeverityHardRecall',
      'minimumEvidenceVerificationRate',
      'maximumIntentEscalationRate',
      'maximumCleanHardFalsePositiveRate',
    ] as const
    assertExactKeys(readRecord(override, 'thresholds'), keys, [], 'thresholds')
  }
  const thresholds = {
    ...baseline,
    ...override,
  }
  if (!Number.isInteger(thresholds.minimumCompletedCases) || thresholds.minimumCompletedCases < 1) {
    throw new Error('minimumCompletedCases 必须是正整数')
  }
  unit(thresholds.minimumHighSeverityHardPrecision, 'minimumHighSeverityHardPrecision')
  unit(thresholds.minimumHighSeverityHardRecall, 'minimumHighSeverityHardRecall')
  unit(thresholds.minimumEvidenceVerificationRate, 'minimumEvidenceVerificationRate')
  unit(thresholds.maximumIntentEscalationRate, 'maximumIntentEscalationRate')
  unit(thresholds.maximumCleanHardFalsePositiveRate, 'maximumCleanHardFalsePositiveRate')
  if (
    thresholds.minimumCompletedCases < baseline.minimumCompletedCases
    || thresholds.minimumHighSeverityHardPrecision < baseline.minimumHighSeverityHardPrecision
    || thresholds.minimumHighSeverityHardRecall < baseline.minimumHighSeverityHardRecall
    || thresholds.minimumEvidenceVerificationRate < baseline.minimumEvidenceVerificationRate
    || thresholds.maximumIntentEscalationRate > baseline.maximumIntentEscalationRate
    || thresholds.maximumCleanHardFalsePositiveRate > baseline.maximumCleanHardFalsePositiveRate
  ) throw new Error('H4 发布阈值不得弱于默认门槛')
  return thresholds
}

function expectedSpan(
  fixture: H4LongConsistencyFixtureV1,
  evidence: H4LongConsistencyExpectedIssueV1['factEvidence'],
): ExpectedSpan {
  const source = fixture.sources.find(item => item.id === evidence.sourceId)
  if (!source) throw new Error(`fixture ${fixture.id} 缺少标签来源 ${evidence.sourceId}`)
  const content = normalizeChapterText(source.content)
  const quote = normalizeChapterText(evidence.quote)
  const startOffset = content.indexOf(quote)
  if (startOffset < 0 || content.indexOf(quote, startOffset + quote.length) >= 0) {
    throw new Error(`fixture ${fixture.id} 的标签引文不存在或不唯一`)
  }
  return { sourceId: source.id, startOffset, endOffset: startOffset + quote.length }
}

function covers(predicted: LongConsistencyEvidenceSpanV1, expected: ExpectedSpan): boolean {
  return predicted.sourceId === expected.sourceId
    && predicted.startOffset <= expected.startOffset
    && predicted.endOffset >= expected.endOffset
}

function pairMatches(
  fixture: H4LongConsistencyFixtureV1,
  predicted: LongConsistencyIssueV1,
  expected: H4LongConsistencyExpectedIssueV1,
  requireSubtype: boolean,
): boolean {
  if (requireSubtype && predicted.subtype !== expected.subtype) return false
  const fact = expectedSpan(fixture, expected.factEvidence)
  const contradiction = expectedSpan(fixture, expected.contradictionEvidence)
  return (
    covers(predicted.pair.fact, fact) && covers(predicted.pair.contradiction, contradiction)
  ) || (
    covers(predicted.pair.fact, contradiction) && covers(predicted.pair.contradiction, fact)
  )
}

function taskCounts(fixtures: readonly H4LongConsistencyFixtureV1[]): Record<LongConsistencyEvalTaskV1, number> {
  const result: Record<LongConsistencyEvalTaskV1, number> = {
    generation: 0,
    continuation: 0,
    expansion: 0,
    completion: 0,
  }
  for (const fixture of fixtures) result[fixture.task] += 1
  return result
}

export function computeH4LongConsistencyMetricSummaryV1(
  split: H4LongConsistencyRunCheckpointV1['split'],
  cases: readonly H4LongConsistencyIssueCaseV1[],
): H4LongConsistencyMetricSummaryV1 {
  const fixtureById = new Map(getH4LongConsistencyFixturesV1(split).map(fixture => (
    [fixture.id, fixture] as const
  )))
  const seen = new Set<string>()
  const completedFixtures = cases.map(item => {
    if (seen.has(item.fixtureId)) throw new Error(`H4 score 重复 fixture ${item.fixtureId}`)
    seen.add(item.fixtureId)
    const fixture = fixtureById.get(item.fixtureId)
    if (!fixture) throw new Error(`H4 score 包含未知 fixture ${item.fixtureId}`)
    return fixture
  })
  let truePositive = 0
  let falsePositive = 0
  let falseNegative = 0
  let reportedPairs = 0
  let intentCases = 0
  let hardEscalations = 0
  let cleanCases = 0
  let cleanHardFalsePositives = 0

  for (const completed of cases) {
    const fixture = fixtureById.get(completed.fixtureId)!
    const predictedHigh = completed.issues.filter(issue => (
      issue.disposition === 'hard-conflict' && issue.severity === 'high'
    ))
    const expectedHigh = fixture.hiddenLabels.expectedIssues.filter(issue => (
      issue.intentClassification === 'unintentional' && issue.severity === 'high'
    ))
    const matchedExpected = new Set<number>()
    for (const predicted of predictedHigh) {
      const expectedIndex = expectedHigh.findIndex((expected, index) => (
        !matchedExpected.has(index) && pairMatches(fixture, predicted, expected, true)
      ))
      if (expectedIndex >= 0) {
        matchedExpected.add(expectedIndex)
        truePositive += 1
      } else {
        falsePositive += 1
      }
    }
    falseNegative += expectedHigh.length - matchedExpected.size
    reportedPairs += completed.issues.length

    const intentExpected = fixture.hiddenLabels.expectedIssues.filter(issue => (
      issue.intentClassification !== 'unintentional'
    ))
    for (const expected of intentExpected) {
      intentCases += 1
      if (completed.issues.some(issue => (
        issue.disposition === 'hard-conflict' && pairMatches(fixture, issue, expected, false)
      ))) hardEscalations += 1
    }
    if (fixture.hiddenLabels.cleanControl) {
      cleanCases += 1
      if (completed.issues.some(issue => issue.disposition === 'hard-conflict')) {
        cleanHardFalsePositives += 1
      }
    }
  }

  return {
    taskCounts: taskCounts(completedFixtures),
    highSeverityHard: {
      truePositive,
      falsePositive,
      falseNegative,
      precision: wilsonInterval95V1(truePositive, truePositive + falsePositive),
      recall: wilsonInterval95V1(truePositive, truePositive + falseNegative),
    },
    evidence: {
      reportedPairs,
      verifiedPairs: reportedPairs,
      verificationRate: wilsonInterval95V1(reportedPairs, reportedPairs),
    },
    intentControls: {
      cases: intentCases,
      hardEscalations,
      escalationRate: wilsonInterval95V1(hardEscalations, intentCases),
    },
    cleanControls: {
      cases: cleanCases,
      hardFalsePositives: cleanHardFalsePositives,
      falsePositiveRate: wilsonInterval95V1(cleanHardFalsePositives, cleanCases),
    },
  }
}

function scoreBody(score: H4LongConsistencySealedScoreV1): Omit<H4LongConsistencySealedScoreV1, 'scoreHash'> {
  const { scoreHash: _scoreHash, ...body } = score
  return body
}

export function evaluateH4LongConsistencyReleaseGateV1(input: {
  status: H4LongConsistencyRunCheckpointV1['status'] | 'provider-blocked'
  completedCases: number
  precision: H4WilsonIntervalV1
  recall: H4WilsonIntervalV1
  evidenceRate: H4WilsonIntervalV1
  intentRate: H4WilsonIntervalV1
  cleanRate: H4WilsonIntervalV1
  thresholds: H4LongConsistencyReleaseThresholdsV1
  budgetExceeded: boolean
  identitySeparated: boolean
  unmeteredModelCalls: number
}): H4LongConsistencySealedScoreV1['gate'] {
  const failures: H4LongConsistencyGateFailureV1[] = []
  if (input.status !== 'completed') failures.push('run-not-completed')
  if (input.completedCases < input.thresholds.minimumCompletedCases) failures.push('minimum-completed-cases')
  if (
    input.precision.estimate == null
    || input.precision.estimate < input.thresholds.minimumHighSeverityHardPrecision
  ) failures.push('high-severity-hard-precision')
  if (input.recall.estimate == null || input.recall.estimate < input.thresholds.minimumHighSeverityHardRecall) {
    failures.push('high-severity-hard-recall')
  }
  if (
    input.evidenceRate.estimate == null
    || input.evidenceRate.estimate < input.thresholds.minimumEvidenceVerificationRate
  ) failures.push('evidence-verification')
  if (input.intentRate.estimate != null && input.intentRate.estimate > input.thresholds.maximumIntentEscalationRate) {
    failures.push('intent-escalation')
  }
  if (input.cleanRate.estimate != null && input.cleanRate.estimate > input.thresholds.maximumCleanHardFalsePositiveRate) {
    failures.push('clean-hard-false-positive')
  }
  if (input.budgetExceeded) failures.push('budget-exceeded')
  if (!input.identitySeparated) failures.push('identity-separation')
  if (input.unmeteredModelCalls > 0) failures.push('usage-evidence-missing')
  return { passed: failures.length === 0, failures }
}

export async function scoreH4LongConsistencyCheckpointV1(input: {
  checkpoint: unknown
  thresholds?: Partial<H4LongConsistencyReleaseThresholdsV1>
}): Promise<H4LongConsistencySealedScoreV1> {
  if (!await verifyH4LongConsistencyRunCheckpointV1(input.checkpoint)) {
    throw new Error('H4 checkpoint 无法通过完整性验证')
  }
  const checkpoint = parseH4LongConsistencyRunCheckpointV1(input.checkpoint)
  const metrics = computeH4LongConsistencyMetricSummaryV1(
    checkpoint.split,
    checkpoint.completed.map(item => ({
      fixtureId: item.fixtureId,
      issues: item.artifact.issues,
    })),
  )
  const thresholds = resolveH4LongConsistencyReleaseThresholdsV1(checkpoint.split, input.thresholds)
  const gate = evaluateH4LongConsistencyReleaseGateV1({
    status: checkpoint.status,
    completedCases: checkpoint.completed.length,
    precision: metrics.highSeverityHard.precision,
    recall: metrics.highSeverityHard.recall,
    evidenceRate: metrics.evidence.verificationRate,
    intentRate: metrics.intentControls.escalationRate,
    cleanRate: metrics.cleanControls.falsePositiveRate,
    thresholds,
    budgetExceeded: checkpoint.status === 'budget-exhausted',
    identitySeparated: checkpoint.completed.every(item => item.artifact.execution.modelIdentitySeparated),
    unmeteredModelCalls: checkpoint.usage.unmeteredModelCalls,
  })
  const artifactSetHash = await hashCanonicalValue(checkpoint.completed.map(item => ({
    fixtureId: item.fixtureId,
    artifactHash: item.artifact.artifactHash,
    judgeOutputHash: item.artifact.judgeOutputHash,
  })))
  const provisional: H4LongConsistencySealedScoreV1 = {
    schemaVersion: 1,
    scoreType: H4_LONG_CONSISTENCY_SCORE_TYPE_V1,
    scoringVersion: H4_LONG_CONSISTENCY_SCORING_VERSION_V1,
    fixtureVersion: checkpoint.fixtureVersion,
    runId: checkpoint.runId,
    split: checkpoint.split,
    codeRevision: checkpoint.codeRevision,
    createdAt: checkpoint.updatedAt,
    execution: checkpoint.execution,
    checkpointHash: checkpoint.checkpointHash,
    fixtureSetHash: checkpoint.fixtureSetHash,
    artifactSetHash,
    completedCases: checkpoint.completed.length,
    taskCounts: metrics.taskCounts,
    highSeverityHard: metrics.highSeverityHard,
    evidence: metrics.evidence,
    intentControls: metrics.intentControls,
    cleanControls: metrics.cleanControls,
    failedAttempts: checkpoint.failures.length,
    usage: checkpoint.usage,
    thresholds,
    gate,
    scoreHash: '0'.repeat(64),
  }
  return {
    ...provisional,
    scoreHash: await hashCanonicalValue(scoreBody(provisional)),
  }
}

export async function verifyH4LongConsistencySealedScoreV1(
  score: unknown,
  checkpoint: unknown,
): Promise<boolean> {
  try {
    const expected = await scoreH4LongConsistencyCheckpointV1({
      checkpoint,
      thresholds: (score as H4LongConsistencySealedScoreV1).thresholds,
    })
    return canonicalStringify(expected) === canonicalStringify(score)
      && await hashCanonicalValue(scoreBody(expected)) === expected.scoreHash
  } catch {
    return false
  }
}

export async function exportH4LongConsistencySealedScoreV1(
  score: unknown,
  checkpoint: unknown,
): Promise<string> {
  if (!await verifyH4LongConsistencySealedScoreV1(score, checkpoint)) {
    throw new Error('H4 sealed score 完整性验证失败，拒绝导出')
  }
  return JSON.stringify(score, null, 2)
}

export async function importH4LongConsistencySealedScoreV1(
  raw: string,
  checkpoint: unknown,
): Promise<H4LongConsistencySealedScoreV1> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('H4 sealed score 不是有效 JSON')
  }
  if (!await verifyH4LongConsistencySealedScoreV1(value, checkpoint)) {
    throw new Error('H4 sealed score 完整性验证失败，拒绝导入')
  }
  return value as H4LongConsistencySealedScoreV1
}
