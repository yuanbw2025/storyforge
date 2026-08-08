import type { ContextCompressionEvidenceV1 } from '../registry/types'

export type AgentRunWorkflowKind =
  | 'direct-generation'
  | 'read-only-audit'
  | 'plan-execute'
  | 'generate-verify-revise'
  | 'multi-domain-sequential'
  | 'fan-out-synthesize'
  | 'long-running-resumable'

export interface AgentRunScopeV1 {
  projectId: number
  worldGroupId: number | null
  chapterIds?: number[]
  outlineNodeIds?: number[]
}

export interface AgentSkillExecutionBindingV1 {
  version: 1
  skillId: string
  skillVersion: 1
  promptVersion: string
  toolSchemaVersion: string
  toolSchemaHash: string
}

export interface AgentRunStepExecutionBindingV1 extends AgentSkillExecutionBindingV1 {
  stepId: string
}

/** Durable provenance for a run created from another run's verified artifact. */
export interface AgentRunParentLineageV1 {
  runId: number
  receiptHash: string
  relation: string
  artifactHash?: string
}

export type AgentRunWriteMode = 'none' | 'candidate-only' | 'author-confirmed'

export interface AgentRunWriteTargetV1 {
  table: string
  fields: string[]
  mode: AgentRunWriteMode
  /**
   * Domain adoption extension used when the target is intentionally outside
   * FIELD_REGISTRY. The extension must be registered for the same table.
   */
  adoptionExtension?: string
}

export type AgentRunAcceptanceKind =
  | 'output-present'
  | 'gate-passed'
  | 'author-confirmed'
  | 'adoption-committed'
  | 'post-state-matches'
  | 'deterministic-check'
  | 'semantic-review'

export interface AgentRunAcceptanceCriterionV1 {
  id: string
  kind: AgentRunAcceptanceKind
  required: boolean
}

export type AgentRunVerificationKind =
  | 'protocol'
  | 'scope'
  | 'freshness'
  | 'adoption'
  | 'deterministic'
  | 'semantic'
  | 'terminal'

export type AgentRunFailureCategoryV1 =
  | 'protocol'
  | 'transient'
  | 'stale-input'
  | 'deterministic'
  | 'budget'
  | 'cancelled'
  | 'unknown'

export type AgentRunFailureActionV1 =
  | 'retry'
  | 'replan'
  | 'pause-for-author'
  | 'fail'

export interface AgentRunVerificationStepV1 {
  id: string
  kind: AgentRunVerificationKind
  verifier: string
  criterionIds: string[]
}

export interface AgentRunContractV1 {
  version: 1
  objective: string
  workflowKind: AgentRunWorkflowKind
  /** Absent on root/legacy runs; immutable once a child run is created. */
  lineage?: {
    parent: AgentRunParentLineageV1
  }
  scope: AgentRunScopeV1
  permissions: {
    contextSourceKeys: string[]
    writeTargets: AgentRunWriteTargetV1[]
  }
  /** Absent on runs created before HARNESS-18. */
  executionBindings?: AgentRunStepExecutionBindingV1[]
  budget: {
    maxModelCalls: number
    maxToolCalls: number
    maxInputTokens: number
    maxOutputTokens: number
    maxAttemptsPerStep: number
    /** Bounded contract-generation changes; absent on pre-HARNESS-24 runs. */
    maxReplans?: number
    /** Runner-specific evidence ceiling; absent on older/non-tool contracts. */
    maxToolResultTokens?: number
    /** Strict protocol repair allowance; absent on older/non-protocol contracts. */
    maxProtocolErrors?: number
  }
  acceptance: AgentRunAcceptanceCriterionV1[]
  verificationPlan: AgentRunVerificationStepV1[]
  failurePolicy: {
    onProtocolError: 'retry' | 'fail'
    onVerificationFailure: 'revise' | 'replan' | 'fail'
    onStaleInput: 'restart-step' | 'pause-for-author'
  }
}

export interface AcceptedAgentRunContractV1 {
  contract: AgentRunContractV1
  contractHash: string
}

export type ContextManifestSourceStatus = 'included' | 'omitted' | 'trimmed'
export type ContextManifestSourceDeliveryV1 = 'full' | 'compressed' | 'truncated'

export interface ContextManifestBoundaryV1 {
  chapterId?: number
  throughChapterId?: number
  outlineNodeId?: number
}

export interface ContextManifestSourceV1 {
  key: string
  status: ContextManifestSourceStatus
  contentHash?: string
  tokens: number
  /** Optional for manifests created before HARNESS-15. */
  delivery?: ContextManifestSourceDeliveryV1
  /** Reader output size before per-source capping; never contains source text. */
  originalTokens?: number
  /** Optional for manifests created before HARNESS-16. */
  compression?: ContextCompressionEvidenceV1
  boundary?: ContextManifestBoundaryV1
  readerVersion?: string
}

export interface ContextManifestV1 {
  version: 1
  runId: number
  stepId: string
  attempt: number
  scope: {
    projectId: number
    worldGroupId: number | null
  }
  inputBudget: number
  totalInputTokens: number
  sources: ContextManifestSourceV1[]
  manifestHash: string
}

export interface VerificationCriterionReceiptV1 {
  id: string
  status: 'passed' | 'failed'
  evidenceRefs: string[]
}

export interface VerificationReceiptV1 {
  version: 1
  runId: number
  generation: number
  contractHash: string
  contextManifestHashes: string[]
  candidateHashes: string[]
  adoptionEventIds: number[]
  postStateHash: string
  verifierSetVersion: string
  /** The terminal receipt is cryptographically bound to its upstream run via the contract hash. */
  lineage?: AgentRunParentLineageV1
  semanticVerifier?: {
    provider: string
    model: string
    promptVersion: string
  }
  criteria: VerificationCriterionReceiptV1[]
  acceptedAt: number
  receiptHash: string
}

export interface AgentHarnessBenchmarkArtifactV1 {
  version: 1
  createdAt: number
  codeRevision: string
  schemaVersions: {
    contract: 1
    event: 1
    manifest: 1
    receipt: 1
  }
  execution: {
    provider: string
    model: string
    promptVersion: string
    toolSchemaVersion: string
  }
  fixture: {
    id: string
    split: 'development' | 'held-out'
    contentHash: string
  }
  metrics: {
    runs: number
    successfulSteps: number
    failedSteps: number
    modelCalls: number
    toolCalls: number
    inputTokens: number
    outputTokens: number
    latencyMs: number
    costUsd: number
  }
  traceHashes: string[]
  artifactHash: string
}

export interface AgentRunRecord {
  id?: number
  projectId: number
  workId?: number | null
  worldGroupId?: number | null
  conversationId?: number | null
  /** Materialized index for querying child runs; mirrors contract.lineage.parent. */
  parentRunId?: number | null
  parentRelation?: string | null
  parentReceiptHash?: string | null
  parentArtifactHash?: string | null
  status: AgentRunState
  contractVersion: 1
  contractJson: string
  contractHash: string
  generation: number
  lastSequence: number
  projectionJson: string
  projectionHash: string
  terminalReceiptHash?: string | null
  createdAt: number
  updatedAt: number
}

export interface AgentRunEventRecord {
  id?: number
  projectId: number
  worldGroupId?: number | null
  runId: number
  sequence: number
  generation: number
  contractHash: string
  type: AgentRunEventTypeV1
  payloadJson: string
  createdAt: number
}

export interface AgentRunCheckpointRecord {
  id?: number
  projectId: number
  worldGroupId?: number | null
  runId: number
  throughSequence: number
  generation: number
  contractHash: string
  checkpointHash: string
  projectionJson: string
  projectionHash: string
  resumePayloadJson?: string | null
  resumePayloadHash?: string | null
  createdAt: number
}

export type AgentRunEventTypeV1 =
  | 'run.created'
  | 'contract.accepted'
  | 'contract.revised'
  | 'plan.replanned'
  | 'step.scheduled'
  | 'step.started'
  | 'step.succeeded'
  | 'step.failed'
  | 'context.assembled'
  | 'model.requested'
  | 'model.responded'
  | 'tool.called'
  | 'tool.returned'
  | 'candidate.persisted'
  | 'candidate.revised'
  | 'candidate.staled'
  | 'candidate.carried-forward'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'adoption.committed'
  | 'adoption.rejected'
  | 'verification.started'
  | 'verification.accepted'
  | 'verification.rejected'
  | 'verification.staled'
  | 'checkpoint.created'
  | 'recovery.started'
  | 'recovery.completed'
  | 'budget.reserved'
  | 'budget.settled'
  | 'budget.exhausted'
  | 'run.paused'
  | 'run.cancelled'
  | 'run.failed'

export interface AgentRunEventPayloadByTypeV1 {
  'run.created': { objectiveHash: string }
  'contract.accepted': { contractJson?: string }
  'contract.revised': { previousContractHash: string; contractJson?: string }
  'plan.replanned': {
    previousPlanHash: string
    planHash: string
    reasonCode: string
    affectedStepIds: string[]
    carriedStepIds: string[]
    failureFingerprints: string[]
  }
  'step.scheduled': { stepId: string }
  'step.started': { stepId: string; attempt: number }
  'step.succeeded': { stepId: string; attempt: number; outputHash: string }
  'step.failed': {
    stepId: string
    attempt: number
    code: string
    retryable: boolean
    category?: AgentRunFailureCategoryV1
    action?: AgentRunFailureActionV1
    fingerprint?: string
  }
  'context.assembled': { stepId: string; attempt: number; manifestHash: string }
  'model.requested': { stepId: string; attempt: number; bindingHash: string }
  'model.responded': { stepId: string; attempt: number; outputHash: string }
  'tool.called': { stepId: string; attempt: number; toolName: string; callHash: string }
  'tool.returned': { stepId: string; attempt: number; toolName: string; resultHash: string }
  'candidate.persisted': {
    stepId: string
    attempt: number
    candidateHash: string
    requiresConfirmation: boolean
  }
  'candidate.revised': {
    stepId: string
    attempt: number
    previousCandidateHash: string
    candidateHash: string
  }
  'candidate.staled': { stepId: string; candidateHash: string; reason: string }
  'candidate.carried-forward': {
    stepId: string
    sourceGeneration: number
    sourceAttempt: number
    candidateHash: string
  }
  'confirmation.recorded': {
    stepId: string
    candidateHash: string
    decision: 'adopt' | 'reject'
  }
  'adoption.started': { stepId: string; candidateHash: string; intentHash?: string }
  'adoption.committed': { stepId: string; candidateHash: string; adoptionHash: string }
  'adoption.rejected': { stepId: string; candidateHash: string; code: string }
  'verification.started': { verifierSetVersion: string }
  'verification.accepted': { receiptHash: string }
  'verification.rejected': { codes: string[]; retryable: boolean }
  'verification.staled': { previousReceiptHash: string; reason: string }
  'checkpoint.created': { throughSequence: number; checkpointHash: string }
  'recovery.started': { checkpointHash: string }
  'recovery.completed': { checkpointHash: string }
  'budget.reserved': { stepId: string; modelCalls: number; toolCalls: number; tokens: number }
  'budget.settled': { stepId: string; modelCalls: number; toolCalls: number; tokens: number }
  'budget.exhausted': {
    resource: 'model-calls' | 'tool-calls' | 'input-tokens' | 'output-tokens' | 'attempts' | 'replans'
  }
  'run.paused': { reason: string; recoverable: boolean }
  'run.cancelled': { reason: string }
  'run.failed': { code: string; retryable: boolean }
}

export interface AgentRunEventV1<T extends AgentRunEventTypeV1 = AgentRunEventTypeV1> {
  version: 1
  runId: number
  sequence: number
  generation: number
  projectId: number
  worldGroupId: number | null
  contractHash: string
  type: T
  createdAt: number
  payload: AgentRunEventPayloadByTypeV1[T]
}

export type AnyAgentRunEventV1 = {
  [T in AgentRunEventTypeV1]: AgentRunEventV1<T>
}[AgentRunEventTypeV1]

export type AgentRunState =
  | 'planned'
  | 'running'
  | 'awaiting_confirmation'
  | 'verifying'
  | 'completed'
  | 'paused'
  | 'recovering'
  | 'failed'
  | 'cancelled'
  | 'recovery_required'

export type AgentRunStepState =
  | 'scheduled'
  | 'running'
  | 'awaiting_confirmation'
  | 'succeeded'
  | 'failed'
  | 'stale'

export interface AgentRunStepProjectionV1 {
  stepId: string
  status: AgentRunStepState
  attempt: number
  outputHash?: string
  candidateHash?: string
  confirmation?: 'adopt' | 'reject'
  adoptionHash?: string
  failureCode?: string
}

export interface AgentRunProjectionV1 {
  version: 1
  runId: number
  projectId: number
  worldGroupId: number | null
  generation: number
  contractHash: string
  state: AgentRunState
  lastSequence: number
  steps: Record<string, AgentRunStepProjectionV1>
  terminalReceiptHash?: string
  lastCheckpointHash?: string
  errors: string[]
}

/**
 * Durable/exportable projection body. Physical workspace/run identifiers and
 * the rebindable contract hash live on AgentRunRecord, so importing a backup
 * never leaves stale local primary keys hidden inside projection JSON.
 */
export type AgentRunProjectionBodyV1 = Omit<
  AgentRunProjectionV1,
  'runId' | 'projectId' | 'worldGroupId' | 'contractHash'
>
