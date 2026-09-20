import type { TextOpenWorldRuntimeAIExecutionObservationV1 } from '../../open-world/runtime-ai-error'

export const TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_VERSION_V1 = 'text-open-world-runtime-ai-eval-v1' as const

export type TextOpenWorldRuntimeAIEvalRiskV1 =
  | 'privilege-escalation'
  | 'spoiler-paraphrase'
  | 'fake-progress'
  | 'wrong-intent-mapping'
  | 'long-context-late-evidence'
  | 'offline-degradation'
  | 'high-risk-confirmation'
  | 'grounded-control'

export type TextOpenWorldRuntimeAIEvalCapabilityV1 =
  | 'intent'
  | 'dialogue'
  | 'expression'
  | 'quest-packaging'
  | 'direction'
  | 'memory'

export interface TextOpenWorldRuntimeAIEvalFixtureV1 {
  id: string
  risk: TextOpenWorldRuntimeAIEvalRiskV1
  capability: TextOpenWorldRuntimeAIEvalCapabilityV1
  title: string
  playerInput: string
  authorizedFacts: string[]
  forbiddenFacts: string[]
  expectedActionKey: string | null
  semanticJudgeRequired: boolean
}

export type TextOpenWorldRuntimeAIEvalDispositionV1 =
  | 'accepted-read-only'
  | 'blocked'
  | 'degraded'
  | 'confirmation-required'

export interface TextOpenWorldRuntimeAIEvalObservationV1 {
  fixtureId: string
  disposition: TextOpenWorldRuntimeAIEvalDispositionV1
  candidateText: string
  selectedActionKey: string | null
  stateChanged: boolean
  providerCallCount: number
  deterministicFallbackAvailable: boolean
  lateAnchorDelivered: boolean | null
  forbiddenContextDelivered: boolean
  transport: TextOpenWorldRuntimeAIExecutionObservationV1 | null
}

export interface TextOpenWorldRuntimeAISemanticGradeV1 {
  privilegeEscalation: boolean
  spoilerLeak: boolean
  fakeProgress: boolean
  intentMismatch: boolean
  contradictsEvidence: boolean
  naturalAndUseful: boolean
  reason: string
}

export interface TextOpenWorldRuntimeAISemanticGradeEvidenceV1 {
  provider: string
  model: string
  promptVersion: string
  inputHash: string
  outputHash: string
  inputTokens: number | null
  outputTokens: number | null
  finishReason: string | null
  durationMs: number
}

export interface TextOpenWorldRuntimeAIEvalResultV1 {
  fixtureId: string
  risk: TextOpenWorldRuntimeAIEvalRiskV1
  capability: TextOpenWorldRuntimeAIEvalCapabilityV1
  status: 'passed' | 'failed'
  disposition: TextOpenWorldRuntimeAIEvalDispositionV1 | null
  candidateHash: string | null
  selectedActionKey: string | null
  providerCallCount: number
  deterministicFailures: string[]
  grade: TextOpenWorldRuntimeAISemanticGradeV1 | null
  gradeEvidence: TextOpenWorldRuntimeAISemanticGradeEvidenceV1 | null
  transport: TextOpenWorldRuntimeAIExecutionObservationV1 | null
  error: string | null
  durationMs: number
}

export interface TextOpenWorldRuntimeAIEvalScoreV1 {
  sampleCount: number
  passedCount: number
  semanticSampleCount: number
  singleCallRate: number
  riskPassRates: Record<TextOpenWorldRuntimeAIEvalRiskV1, number>
  passed: boolean
  failures: string[]
}

export interface TextOpenWorldRuntimeAIEvalReportV1 {
  version: typeof TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_VERSION_V1
  fixtureHash: string
  generatorIdentity: { provider: string; model: string }
  graderIdentity: { provider: string; model: string; promptVersion: string } | null
  results: TextOpenWorldRuntimeAIEvalResultV1[]
  score: TextOpenWorldRuntimeAIEvalScoreV1
  startedAt: number
  completedAt: number
  reportHash: string
}

export type TextOpenWorldRuntimeAIEvalJudgeV1 = (input: {
  fixture: TextOpenWorldRuntimeAIEvalFixtureV1
  observation: TextOpenWorldRuntimeAIEvalObservationV1
}) => Promise<{
  grade: TextOpenWorldRuntimeAISemanticGradeV1
  evidence: TextOpenWorldRuntimeAISemanticGradeEvidenceV1
}>
