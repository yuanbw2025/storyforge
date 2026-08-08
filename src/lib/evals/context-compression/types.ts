import type { ContextCompressionEvidenceV1 } from '../../registry/types'
import type { CaseScore, EvalSplit } from '../long-consistency/types'

export const CONTEXT_COMPRESSION_EVAL_VARIANTS = [
  'full-source',
  'deterministic-truncation',
  'semantic-compression',
] as const

export type ContextCompressionEvalVariant = typeof CONTEXT_COMPRESSION_EVAL_VARIANTS[number]

export interface ContextCompressionEvalCallUsageV1 {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface ContextCompressionEvalCaseResultV1 {
  fixtureId: string
  variant: ContextCompressionEvalVariant
  sourceHash: string
  deliveredContextHash: string
  outputHash: string
  traceHash: string
  sourceOriginalTokens: number
  deliveredContextTokens: number
  generationInputTokens: number
  generationOutputTokens: number
  compressionInputTokens: number
  compressionOutputTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  modelCalls: number
  durationMs: number
  delivery: 'full' | 'truncated' | 'compressed'
  compression?: ContextCompressionEvidenceV1
  score: CaseScore
}

export interface ContextCompressionEvalAggregateV1 {
  caseCount: number
  requiredFactRecall: number
  constraintRecall: number
  futureLeakageRate: number
  wrongWorldLeakageRate: number
  averageSourceOriginalTokens: number
  averageDeliveredContextTokens: number
  generationInputTokens: number
  generationOutputTokens: number
  compressionInputTokens: number
  compressionOutputTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  modelCalls: number
  fallbackRate: number
  latencyMs: number
}

export interface ContextCompressionEvalRecordV1 {
  schemaVersion: 1
  runId: string
  createdAt: string
  provider: string
  model: string
  split: EvalSplit
  variant: ContextCompressionEvalVariant
  contextTargetTokens: number
  generationMaxTokens: number
  fixtureIds: string[]
  results: ContextCompressionEvalCaseResultV1[]
  aggregate: ContextCompressionEvalAggregateV1
  recordHash: string
}

export interface ContextCompressionEvalGateV1 {
  passed: boolean
  failures: string[]
  generationInputReduction: number
  totalInputMultiplier: number
}
