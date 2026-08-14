import type { EvalSplit } from './types'
import type {
  LongConsistencyCategoryV1,
  LongConsistencySubtypeV1,
} from './taxonomy'

export const LONG_CONSISTENCY_REPORT_SOURCE_KINDS_V1 = [
  'narrative',
  'world',
  'character',
  'outline',
  'author-intent',
] as const

export type LongConsistencyReportSourceKindV1 = typeof LONG_CONSISTENCY_REPORT_SOURCE_KINDS_V1[number]

export const LONG_CONSISTENCY_SEVERITIES_V1 = ['low', 'medium', 'high'] as const
export type LongConsistencySeverityV1 = typeof LONG_CONSISTENCY_SEVERITIES_V1[number]

export const LONG_CONSISTENCY_INTENT_CLASSIFICATIONS_V1 = [
  'unintentional',
  'intentional',
  'ambiguous',
] as const
export type LongConsistencyIntentClassificationV1 = typeof LONG_CONSISTENCY_INTENT_CLASSIFICATIONS_V1[number]

export type LongConsistencyDispositionV1 = 'hard-conflict' | 'advisory'
export type LongConsistencyEvalTaskV1 = 'generation' | 'continuation' | 'expansion' | 'completion'
export type LongConsistencyJudgePromptVersionV1 =
  | 'h4-long-consistency-judge-v1'
  | 'h4-long-consistency-judge-v2'
  | 'h4-long-consistency-judge-v3'

export interface LongConsistencyReportSourceInputV1 {
  id: string
  kind: LongConsistencyReportSourceKindV1
  content: string
}

export interface LongConsistencyReportSourceV1 {
  id: string
  kind: LongConsistencyReportSourceKindV1
  contentHash: string
  charLength: number
}

export interface LongConsistencyEvidenceReferenceV1 {
  sourceId: string
  quote: string
}

export interface LongConsistencyEvidenceSpanV1 extends LongConsistencyEvidenceReferenceV1 {
  sourceHash: string
  startOffset: number
  endOffset: number
}

export interface LongConsistencyJudgeCandidateV1 {
  id: string
  subtype: LongConsistencySubtypeV1
  severity: LongConsistencySeverityV1
  intentClassification: LongConsistencyIntentClassificationV1
  summary: string
  factEvidence: LongConsistencyEvidenceReferenceV1
  contradictionEvidence: LongConsistencyEvidenceReferenceV1
}

export interface LongConsistencyIssueV1 {
  id: string
  category: LongConsistencyCategoryV1
  subtype: LongConsistencySubtypeV1
  severity: LongConsistencySeverityV1
  intentClassification: LongConsistencyIntentClassificationV1
  disposition: LongConsistencyDispositionV1
  summary: string
  pair: {
    fact: LongConsistencyEvidenceSpanV1
    contradiction: LongConsistencyEvidenceSpanV1
  }
}

export interface LongConsistencyFixtureBindingV1 {
  id: string
  split: EvalSplit
  task: LongConsistencyEvalTaskV1
  inputHash: string
  labelHash: string
}

export interface LongConsistencyModelBindingV1 {
  provider: string
  model: string
  promptVersion: string
}

export interface LongConsistencyModelUsageV1 {
  inputTokens: number
  outputTokens: number
  durationMs: number
  costUsd: number
}

export interface LongConsistencyEvalArtifactV1 {
  schemaVersion: 1
  artifactType: 'storyforge-long-consistency-eval'
  benchmark: {
    version: 'storyforge-h4-evidence-v1'
    taxonomyVersion: 'constory-bench-19-v1'
    judgePromptVersion: LongConsistencyJudgePromptVersionV1
  }
  evidenceProtocol: {
    normalizationVersion: 'chapter-text-v1'
    offsetUnit: 'utf-16-code-unit'
    endOffset: 'exclusive'
  }
  runId: string
  createdAt: string
  codeRevision: string
  fixture: LongConsistencyFixtureBindingV1
  execution: {
    generator: LongConsistencyModelBindingV1
    verifier: LongConsistencyModelBindingV1
    modelIdentitySeparated: boolean
    generationUsage: LongConsistencyModelUsageV1
    verifierUsage: LongConsistencyModelUsageV1
  }
  sourceSetHash: string
  judgeInputHash: string
  judgeOutputHash: string
  sources: LongConsistencyReportSourceV1[]
  issues: LongConsistencyIssueV1[]
  metrics: {
    issueCount: number
    hardConflictCount: number
    highSeverityHardConflictCount: number
    advisoryCount: number
    intentionalCount: number
    ambiguousCount: number
  }
  traceHashes: string[]
  artifactHash: string
}
