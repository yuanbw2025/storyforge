import type { CreativeArtifactStatusV1 } from '../../agent/creative-reliability'

export const CREATIVE_RELIABILITY_EVAL_VARIANTS_V1 = [
  'legacy-direct',
  'creative-reliability',
] as const

export type CreativeReliabilityEvalVariantV1 =
  typeof CREATIVE_RELIABILITY_EVAL_VARIANTS_V1[number]

export type CreativeReliabilityEvalSplitV1 = 'development' | 'held-out'

export interface CreativeReliabilityEvalFixtureBindingV1 {
  id: string
  split: CreativeReliabilityEvalSplitV1
  cohort: 'concept-only' | 'world-only' | 'character-only' | 'partial' | 'developed'
  genre: string
  contentHash: string
}

export interface CreativeReliabilityEvalIdentityV1 {
  provider: string
  model: string
  promptVersion: string
}

export interface CreativeReliabilityEvalUsageV1 {
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costUsd: number | null
  usageSource: 'provider' | 'estimated'
}

export interface CreativeReliabilityEvalCallV1 {
  callIndex: number
  stage: 'generation' | 'verification'
  purpose: 'generate' | 'repair' | 'verify'
  provider: string
  model: string
  promptVersion: string
  inputHash: string
  outputHash: string | null
  status: 'succeeded' | 'provider-failed' | 'protocol-failed'
  usage: CreativeReliabilityEvalUsageV1 | null
  failureCode?: string
}

export interface CreativeReliabilityEvalGenerationV1 {
  variant: CreativeReliabilityEvalVariantV1
  status:
    | CreativeArtifactStatusV1
    | 'legacy-ready'
    | 'legacy-protocol-failed'
    | 'provider-failed'
  presentedText: string
  outputHash: string | null
  editableArtifact: boolean
  adoptable: boolean
  artifactModelCalls: number
  calls: CreativeReliabilityEvalCallV1[]
  usage: CreativeReliabilityEvalUsageV1
  issueCodes: string[]
}

export interface CreativeReliabilityEvalVerificationV1 {
  status: 'succeeded' | 'provider-failed' | 'protocol-failed'
  semanticScore: number | null
  causalCoherence: number | null
  specificity: number | null
  matchedRequiredFactIds: string[]
  missingRequiredFactIds: string[]
  safetyPassed: boolean | null
  narrativeProgressed: boolean | null
  infodumpOnly: boolean | null
  calls: CreativeReliabilityEvalCallV1[]
  usage: CreativeReliabilityEvalUsageV1 | null
  assessmentHash: string | null
}

export interface CreativeReliabilityBlindVerdictV1 {
  label: 'A' | 'B'
  willingToEdit: boolean
  estimatedEditMinutes: number
  retainedRatio: number
}

export interface CreativeReliabilityHumanReviewV1 {
  reviewerIdHash: string
  completedAt: number
  blindOrder: [CreativeReliabilityEvalVariantV1, CreativeReliabilityEvalVariantV1]
  verdicts: [CreativeReliabilityBlindVerdictV1, CreativeReliabilityBlindVerdictV1]
  preferred: 'A' | 'B' | 'tie'
}

export interface CreativeReliabilityEvalCaseV1 {
  fixtureId: string
  executionOrder: [CreativeReliabilityEvalVariantV1, CreativeReliabilityEvalVariantV1]
  generations: Record<CreativeReliabilityEvalVariantV1, CreativeReliabilityEvalGenerationV1>
  verifications: Record<CreativeReliabilityEvalVariantV1, CreativeReliabilityEvalVerificationV1>
  humanReview: CreativeReliabilityHumanReviewV1 | null
}

export interface CreativeReliabilityVariantAggregateV1 {
  caseCount: number
  editableArtifactRate: number
  zeroOutputRate: number
  adoptableRate: number
  averageArtifactModelCalls: number
  maxArtifactModelCalls: number
  inputTokens: number
  outputTokens: number
  tokensPerAdoptableArtifact: number | null
  totalLatencyMs: number
  p95LatencyMs: number
  knownCostUsd: number | null
  costPerAdoptableArtifactUsd: number | null
  verifierCompletionRate: number
  semanticScore: number
  causalCoherence: number
  specificity: number
  safetyPassRate: number
  narrativeProgressRate: number
  infodumpOnlyRate: number
  humanReviewCount: number
  willingToEditRate: number | null
  averageEstimatedEditMinutes: number | null
  averageRetainedRatio: number | null
}

export interface CreativeReliabilityEvalAggregateV1 {
  legacyDirect: CreativeReliabilityVariantAggregateV1
  creativeReliability: CreativeReliabilityVariantAggregateV1
  comparison: {
    tokenPerAdoptableMultiplier: number | null
    costPerAdoptableMultiplier: number | null
    p95LatencyMultiplier: number | null
    semanticRegression: number
    willingToEditDelta: number | null
  }
}

export type CreativeReliabilityMachineGateFailureV1 =
  | 'minimum-cases'
  | 'editable-artifact-rate'
  | 'zero-output-rate'
  | 'average-artifact-calls'
  | 'max-artifact-calls'
  | 'token-per-adoptable-artifact'
  | 'safety-regression'
  | 'partial-setting-progress'
  | 'semantic-quality-regression'
  | 'generation-usage-incomplete'
  | 'verifier-evidence-incomplete'

export type CreativeReliabilityCommunityGateFailureV1 =
  | 'machine-gate'
  | 'human-review-incomplete'
  | 'willing-to-edit-rate'
  | 'willing-to-edit-improvement'

export interface CreativeReliabilityMachineGateV1 {
  passed: boolean
  failures: CreativeReliabilityMachineGateFailureV1[]
  thresholds: {
    minimumCases: number
    minimumEditableArtifactRate: number
    maximumZeroOutputRate: number
    maximumAverageArtifactCalls: number
    maximumArtifactCalls: number
    maximumTokenPerAdoptableMultiplier: number
    minimumSafetyPassRate: number
    minimumPartialSettingProgressRate: number
    maximumSemanticRegression: number
  }
}

export interface CreativeReliabilityCommunityGateV1 {
  passed: boolean
  failures: CreativeReliabilityCommunityGateFailureV1[]
  thresholds: {
    minimumHumanReviews: number
    minimumWillingToEditRate: number
    minimumWillingToEditImprovement: number
  }
}

export interface CreativeReliabilityEvalRecordV1 {
  version: 1
  suiteVersion: string
  runId: string
  createdAt: number
  codeRevision: string
  split: CreativeReliabilityEvalSplitV1
  generator: CreativeReliabilityEvalIdentityV1
  verifier: CreativeReliabilityEvalIdentityV1
  parameters: {
    temperature: number
    maxOutputTokens: number
  }
  fixtureBindings: CreativeReliabilityEvalFixtureBindingV1[]
  fixtureSetHash: string
  cases: CreativeReliabilityEvalCaseV1[]
  aggregate: CreativeReliabilityEvalAggregateV1
  machineGate: CreativeReliabilityMachineGateV1
  communityGate: CreativeReliabilityCommunityGateV1
  recordHash: string
}
