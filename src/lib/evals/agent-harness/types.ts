import type { AgentHarnessBenchmarkArtifactV1 } from '../../types/agent-run'

export const AGENT_HARNESS_WORKFLOW_VARIANTS = ['sequential', 'fan-out'] as const

export type AgentHarnessWorkflowVariantV1 = typeof AGENT_HARNESS_WORKFLOW_VARIANTS[number]
export type AgentHarnessWorkflowSplitV1 = 'development' | 'held-out'

export interface AgentHarnessWorkflowFixtureV1 {
  id: string
  split: AgentHarnessWorkflowSplitV1
  contentHash: string
  inputHash: string
  planHash: string
}

export interface AgentHarnessWorkflowGeneratorV1 {
  provider: string
  model: string
  promptVersion: string
  toolSchemaVersion: string
}

export interface AgentHarnessWorkflowVerifierV1 {
  provider: string
  model: string
  promptVersion: string
}

export interface AgentHarnessWorkflowExecutionV1 {
  generator: AgentHarnessWorkflowGeneratorV1
  verifier: AgentHarnessWorkflowVerifierV1
}

export interface AgentHarnessWorkflowCaseResultV1 {
  fixtureId: string
  variant: AgentHarnessWorkflowVariantV1
  outputHash: string
  traceHash: string
  receiptHashes: string[]
  expectedReceiptCount: number
  completed: boolean
  successfulSteps: number
  failedSteps: number
  modelCalls: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costUsd: number
  semanticScore: number
  evidenceCoverage: number
  futureLeakage: boolean
  wrongWorldLeakage: boolean
}

export interface AgentHarnessWorkflowCasePairV1 {
  fixtureId: string
  executionOrder: [AgentHarnessWorkflowVariantV1, AgentHarnessWorkflowVariantV1]
  sequential: AgentHarnessWorkflowCaseResultV1
  fanOut: AgentHarnessWorkflowCaseResultV1
}

export interface AgentHarnessWorkflowVariantAggregateV1 {
  caseCount: number
  completionRate: number
  receiptCoverage: number
  semanticScore: number
  evidenceCoverage: number
  futureLeakageRate: number
  wrongWorldLeakageRate: number
  successfulSteps: number
  failedSteps: number
  modelCalls: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  totalLatencyMs: number
  p95LatencyMs: number
  costUsd: number
}

export interface AgentHarnessWorkflowComparisonV1 {
  semanticQualityRegression: number
  evidenceRegression: number
  p95LatencyRatio: number
  tokenMultiplier: number
  costMultiplier: number | null
}

export interface AgentHarnessWorkflowAggregateV1 {
  sequential: AgentHarnessWorkflowVariantAggregateV1
  fanOut: AgentHarnessWorkflowVariantAggregateV1
  comparison: AgentHarnessWorkflowComparisonV1
}

export interface AgentHarnessWorkflowThresholdsV1 {
  minimumPairedCases: number
  maximumSemanticQualityRegression: number
  maximumEvidenceRegression: number
  minimumCompletionRate: number
  minimumReceiptCoverage: number
  maximumFutureLeakageRate: number
  maximumWrongWorldLeakageRate: number
  maximumP95LatencyRatio: number
  maximumTokenMultiplier: number
  maximumCostMultiplier: number
}

export type AgentHarnessWorkflowGateFailureV1 =
  | 'minimum-paired-cases'
  | 'sequential-completion'
  | 'fan-out-completion'
  | 'sequential-receipt-coverage'
  | 'fan-out-receipt-coverage'
  | 'semantic-quality-noninferiority'
  | 'evidence-noninferiority'
  | 'fan-out-future-leakage'
  | 'fan-out-wrong-world-leakage'
  | 'p95-latency-benefit'
  | 'token-budget'
  | 'cost-evidence-missing'
  | 'cost-budget'

export interface AgentHarnessWorkflowGateV1 {
  passed: boolean
  failures: AgentHarnessWorkflowGateFailureV1[]
}

export interface AgentHarnessWorkflowPairedRecordV1 {
  version: 1
  createdAt: number
  codeRevision: string
  split: AgentHarnessWorkflowSplitV1
  execution: AgentHarnessWorkflowExecutionV1
  fixtures: AgentHarnessWorkflowFixtureV1[]
  fixtureSetHash: string
  cases: AgentHarnessWorkflowCasePairV1[]
  artifacts: {
    sequential: AgentHarnessBenchmarkArtifactV1
    fanOut: AgentHarnessBenchmarkArtifactV1
  }
  aggregate: AgentHarnessWorkflowAggregateV1
  thresholds: AgentHarnessWorkflowThresholdsV1
  gate: AgentHarnessWorkflowGateV1
  recordHash: string
}

export interface AgentHarnessWorkflowExecutionResultV1 {
  output: string
  contentHash: string
  inputHash: string
  planHash: string
  execution: AgentHarnessWorkflowGeneratorV1
  traceHash: string
  receiptHashes: string[]
  expectedReceiptCount: number
  completed: boolean
  successfulSteps: number
  failedSteps: number
  modelCalls: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costUsd: number
}

export interface AgentHarnessWorkflowVerifierResultV1 {
  semanticScore: number
  evidenceCoverage: number
  futureLeakage: boolean
  wrongWorldLeakage: boolean
}
