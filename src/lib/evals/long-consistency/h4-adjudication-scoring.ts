import { canonicalStringify, hashCanonicalValue } from '../../agent/run/hash'
import {
  deriveH4SubtypeAdjudicatedIssuesV1,
  parseH4SubtypeAdjudicationCheckpointV1,
  verifyH4SubtypeAdjudicationCheckpointV1,
  type H4SubtypeAdjudicationCheckpointV1,
} from './h4-adjudication'
import type { H4LongConsistencyRunUsageV1 } from './h4-runner'
import {
  computeH4LongConsistencyMetricSummaryV1,
  evaluateH4LongConsistencyReleaseGateV1,
  resolveH4LongConsistencyReleaseThresholdsV1,
  type H4LongConsistencyGateFailureV1,
  type H4LongConsistencyMetricSummaryV1,
  type H4LongConsistencyReleaseThresholdsV1,
} from './h4-scoring'
import type { LongConsistencyEvalTaskV1 } from './report-types'

export const H4_SUBTYPE_ADJUDICATION_SCORING_VERSION_V1 =
  'h4-subtype-adjudication-scoring-v1'
export const H4_SUBTYPE_ADJUDICATION_SCORE_TYPE_V1 =
  'storyforge-h4-subtype-adjudication-score'

export interface H4SubtypeAdjudicationSealedScoreV1 {
  schemaVersion: 1
  scoreType: typeof H4_SUBTYPE_ADJUDICATION_SCORE_TYPE_V1
  scoringVersion: typeof H4_SUBTYPE_ADJUDICATION_SCORING_VERSION_V1
  fixtureVersion: H4SubtypeAdjudicationCheckpointV1['fixtureVersion']
  runId: string
  split: H4SubtypeAdjudicationCheckpointV1['split']
  codeRevision: string
  createdAt: string
  execution: H4SubtypeAdjudicationCheckpointV1['execution']
  baseCheckpointHash: string
  checkpointHash: string
  fixtureSetHash: string
  artifactSetHash: string
  completedCases: number
  taskCounts: Record<LongConsistencyEvalTaskV1, number>
  highSeverityHard: H4LongConsistencyMetricSummaryV1['highSeverityHard']
  evidence: H4LongConsistencyMetricSummaryV1['evidence']
  intentControls: H4LongConsistencyMetricSummaryV1['intentControls']
  cleanControls: H4LongConsistencyMetricSummaryV1['cleanControls']
  failedAttempts: {
    discovery: number
    adjudication: number
    total: number
  }
  usage: {
    discovery: H4LongConsistencyRunUsageV1
    adjudication: H4LongConsistencyRunUsageV1
    total: H4LongConsistencyRunUsageV1
  }
  thresholds: H4LongConsistencyReleaseThresholdsV1
  gate: {
    passed: boolean
    failures: H4LongConsistencyGateFailureV1[]
  }
  scoreHash: string
}

function addUsage(
  left: H4LongConsistencyRunUsageV1,
  right: H4LongConsistencyRunUsageV1,
): H4LongConsistencyRunUsageV1 {
  return {
    modelCalls: left.modelCalls + right.modelCalls,
    meteredModelCalls: left.meteredModelCalls + right.meteredModelCalls,
    unmeteredModelCalls: left.unmeteredModelCalls + right.unmeteredModelCalls,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    durationMs: left.durationMs + right.durationMs,
    costUsd: left.costUsd + right.costUsd,
  }
}

function scoreBody(
  score: H4SubtypeAdjudicationSealedScoreV1,
): Omit<H4SubtypeAdjudicationSealedScoreV1, 'scoreHash'> {
  const { scoreHash: _scoreHash, ...body } = score
  return body
}

export async function scoreH4SubtypeAdjudicationCheckpointV1(input: {
  checkpoint: unknown
  thresholds?: Partial<H4LongConsistencyReleaseThresholdsV1>
}): Promise<H4SubtypeAdjudicationSealedScoreV1> {
  if (!await verifyH4SubtypeAdjudicationCheckpointV1(input.checkpoint)) {
    throw new Error('H85 checkpoint 无法通过完整性验证')
  }
  const checkpoint = parseH4SubtypeAdjudicationCheckpointV1(input.checkpoint)
  const sourceById = new Map(checkpoint.baseCheckpoint.completed.map(item => [item.fixtureId, item] as const))
  const metrics = computeH4LongConsistencyMetricSummaryV1(
    checkpoint.split,
    checkpoint.completed.map(item => ({
      fixtureId: item.fixtureId,
      issues: deriveH4SubtypeAdjudicatedIssuesV1(
        sourceById.get(item.fixtureId)!,
        item.artifact.decisions,
      ),
    })),
  )
  const thresholds = resolveH4LongConsistencyReleaseThresholdsV1(checkpoint.split, input.thresholds)
  const totalUsage = addUsage(checkpoint.baseCheckpoint.usage, checkpoint.usage)
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
    identitySeparated: checkpoint.execution.generatorIdentitySeparated,
    unmeteredModelCalls: totalUsage.unmeteredModelCalls,
  })
  const discoveryFailures = checkpoint.baseCheckpoint.failures.length
  const adjudicationFailures = checkpoint.failures.length
  const provisional: H4SubtypeAdjudicationSealedScoreV1 = {
    schemaVersion: 1,
    scoreType: H4_SUBTYPE_ADJUDICATION_SCORE_TYPE_V1,
    scoringVersion: H4_SUBTYPE_ADJUDICATION_SCORING_VERSION_V1,
    fixtureVersion: checkpoint.fixtureVersion,
    runId: checkpoint.runId,
    split: checkpoint.split,
    codeRevision: checkpoint.codeRevision,
    createdAt: checkpoint.updatedAt,
    execution: checkpoint.execution,
    baseCheckpointHash: checkpoint.baseCheckpointHash,
    checkpointHash: checkpoint.checkpointHash,
    fixtureSetHash: checkpoint.fixtureSetHash,
    artifactSetHash: await hashCanonicalValue(checkpoint.completed.map(item => ({
      fixtureId: item.fixtureId,
      sourceArtifactHash: item.artifact.source.artifactHash,
      artifactHash: item.artifact.artifactHash,
      adjudicatorOutputHash: item.artifact.call?.outputHash ?? null,
    }))),
    completedCases: checkpoint.completed.length,
    taskCounts: metrics.taskCounts,
    highSeverityHard: metrics.highSeverityHard,
    evidence: metrics.evidence,
    intentControls: metrics.intentControls,
    cleanControls: metrics.cleanControls,
    failedAttempts: {
      discovery: discoveryFailures,
      adjudication: adjudicationFailures,
      total: discoveryFailures + adjudicationFailures,
    },
    usage: {
      discovery: checkpoint.baseCheckpoint.usage,
      adjudication: checkpoint.usage,
      total: totalUsage,
    },
    thresholds,
    gate,
    scoreHash: '0'.repeat(64),
  }
  return {
    ...provisional,
    scoreHash: await hashCanonicalValue(scoreBody(provisional)),
  }
}

export async function verifyH4SubtypeAdjudicationSealedScoreV1(
  score: unknown,
  checkpoint: unknown,
): Promise<boolean> {
  try {
    const expected = await scoreH4SubtypeAdjudicationCheckpointV1({
      checkpoint,
      thresholds: (score as H4SubtypeAdjudicationSealedScoreV1).thresholds,
    })
    return canonicalStringify(expected) === canonicalStringify(score)
      && await hashCanonicalValue(scoreBody(expected)) === expected.scoreHash
  } catch {
    return false
  }
}

export async function exportH4SubtypeAdjudicationSealedScoreV1(
  score: unknown,
  checkpoint: unknown,
): Promise<string> {
  if (!await verifyH4SubtypeAdjudicationSealedScoreV1(score, checkpoint)) {
    throw new Error('H85 sealed score 完整性验证失败，拒绝导出')
  }
  return JSON.stringify(score, null, 2)
}
