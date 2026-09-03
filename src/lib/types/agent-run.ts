import type {
  ContextCompressionEvidenceV1,
  ContextSufficiencyReportV1,
  RetrievalTraceV1,
} from '../registry/types'
import type { ExactRunArtifactKindV1 } from './memory-engineering'

export type AgentRunWorkflowKind =
  | 'direct-generation'
  | 'read-only-audit'
  | 'plan-execute'
  | 'generate-verify-revise'
  | 'multi-domain-sequential'
  | 'fan-out-synthesize'
  | 'long-running-resumable'

export type AgentExecutionBoundaryV1 =
  | 'formal'
  | 'evaluation'
  | 'product-runtime'
  | 'experimental'

export interface AgentRunScopeV1 {
  projectId: number
  worldGroupId: number | null
  chapterIds?: number[]
  outlineNodeIds?: number[]
  /** HARNESS-RUNTIME-1 immutable instance input boundary. */
  runtime?: {
    productRuntimeSessionId: number
    baseSequence: number
    stateHash: string
    visibilityHash: string
    releaseHash: string
  }
  /** PRODUCTPROD-1 immutable Build/task boundary for Work-owned production runs. */
  productProduction?: {
    productBuildId: number
    buildNumber: number
    controlEpoch: number
    planHash: string
    taskKey: string
  }
}

export interface AgentSkillExecutionBindingV1 {
  version: 1
  skillId: string
  skillVersion: 1
  promptVersion: string
  toolSchemaVersion: string
  toolSchemaHash: string
}

/** Immutable PromptTemplate/options identity bound before a formal step starts. */
export interface AgentRunPromptExecutionBindingV1 {
  version: 1
  moduleKey: string
  templateId: number | null
  templateName: string
  templateScope: 'system' | 'user'
  templateUpdatedAt: number
  templateHash: string
  parameterValuesHash: string
  overridesHash: string
}

/** Immutable snapshot of the operation-level FormalAIEntryBinding used by a run step. */
export interface AgentRunFormalAIEntryBindingV1 {
  version: 1
  entryId: string
  bindingJson: string
  bindingHash: string
}

export interface AgentRunStepExecutionBindingV1 extends AgentSkillExecutionBindingV1 {
  stepId: string
  promptExecution?: AgentRunPromptExecutionBindingV1
  formalEntry?: AgentRunFormalAIEntryBindingV1
}

export type AgentOptionalContextActivationReasonV2 =
  | 'perspective-character'
  | 'prior-outline-candidate'
  | 'explicit-runtime-boundary'

export interface AgentOptionalContextActivationV2 {
  sourceKey: string
  reasonCode: AgentOptionalContextActivationReasonV2
  /** Hash of the runtime boundary that activated the optional source. */
  boundaryHash?: string
}

/**
 * Immutable Skill-derived execution snapshot. The canonical V2 Skill body is
 * stored as JSON so an accepted run remains auditable after the live registry
 * changes without creating a second editable registry.
 */
export interface AgentSkillExecutionBindingV2 {
  version: 2
  skillId: string
  skillVersion: 2
  skillDefinitionJson: string
  skillDefinitionHash: string
  contextAccessPolicyHash: string
  promptVersion: string
  toolSchemaVersion: string
  toolSchemaHash: string
  contextSourceKeys: string[]
  optionalContextActivations: AgentOptionalContextActivationV2[]
  writeTargets: AgentRunWriteTargetV1[]
  maxOutputTokens: number
}

export interface AgentRunStepExecutionBindingV2 extends AgentSkillExecutionBindingV2 {
  stepId: string
  formalEntry?: AgentRunFormalAIEntryBindingV1
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
  /**
   * Durable ownership/budget tree. Unlike lineage, this relation does not
   * consume a completed parent receipt, so a production root Run can own
   * concurrent child task Runs and sign its terminal join afterwards.
   */
  ownership?: {
    parentRunId: number
    relation: string
  }
  /** Absent on root/legacy runs; immutable once a child run is created. */
  lineage?: {
    parent: AgentRunParentLineageV1
  }
  scope: AgentRunScopeV1
  permissions: {
    contextSourceKeys: string[]
    writeTargets: AgentRunWriteTargetV1[]
  }
  /** Absent on runs created before HARNESS-29; binds provider/model/transport capabilities. */
  runtimeBindingHash?: string
  /** Absent on runs created before HARNESS-18. */
  executionBindings?: AgentRunStepExecutionBindingV1[]
  /** Absent on runs created before HARNESS-25 and on workflows without a candidate join. */
  dependencyReceiptPolicy?: {
    requiredForJoin: true
    verifierSetVersion: string
  }
  /** Absent until explicitly enabled after the paired release gate has evidence. */
  candidateSemanticReviewPolicy?: {
    requiredForJoin: true
    verifierSetVersion: string
    taskIds: string[]
  }
  /** PROGRESS-1: immutable author/policy authorization for automated child work. */
  automationAuthorization?: {
    version: 1
    mode: 'author-confirmed' | 'preauthorized'
    policy: 'suggest' | 'auto-with-budget'
    taskKey: string
    settingsHash: string
    sourceTextHash: string
    taskTypes: Array<'organization' | 'memory' | 'retrieval' | 'consistency'>
    /** Frozen effective routes for the two model-bearing steps. */
    modelRoutes?: Array<{
      taskType: 'organization' | 'memory'
      provider: string
      model: string
    }>
    maxCostUsd: number
    allowUnknownCost: boolean
    estimate: {
      modelCalls: number
      inputTokensMin: number
      inputTokensMax: number
      outputTokensMin: number
      outputTokensMax: number
      costUsdMin: number | null
      costUsdMax: number | null
    }
  }
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

/**
 * V2 requires every executable step to carry a complete Skill-derived binding.
 * Historical V1 contracts remain readable and are never upgraded in place.
 */
export interface AgentRunContractV2 extends Omit<AgentRunContractV1, 'version' | 'executionBindings'> {
  version: 2
  executionBindings: AgentRunStepExecutionBindingV2[]
}

export interface AgentRunContractV3 extends Omit<AgentRunContractV2, 'version'> {
  version: 3
  executionBoundary: AgentExecutionBoundaryV1
}

export type AgentRunContract = AgentRunContractV1 | AgentRunContractV2 | AgentRunContractV3

export interface AcceptedAgentRunContractV1 {
  contract: AgentRunContractV1
  contractHash: string
}

export interface AcceptedAgentRunContractV2 {
  contract: AgentRunContractV2
  contractHash: string
}

export interface AcceptedAgentRunContractV3 {
  contract: AgentRunContractV3
  contractHash: string
}

export type AcceptedAgentRunContract =
  | AcceptedAgentRunContractV1
  | AcceptedAgentRunContractV2
  | AcceptedAgentRunContractV3

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

export interface ContextManifestSourceProvenanceV2 {
  mirrorDocumentIds: string[]
  artifactIds: string[]
  baselineRevision: number | null
  canonicalHash: string | null
  freshnessStatus: 'fresh' | 'dirty' | 'unmirrored'
  authority: 'accepted' | 'author-input' | 'derived' | 'runtime'
  editPolicy: 'author-editable' | 'candidate-editable' | 'machine-readonly' | 'not-applicable'
  derivedUpstreamHash?: string
}

export interface ContextManifestSourceV2 extends ContextManifestSourceV1 {
  provenance: ContextManifestSourceProvenanceV2
}

export interface ContextManifestV2 {
  version: 2
  runId: number
  stepId: string
  attempt: number
  scope: {
    projectId: number
    worldGroupId: number | null
    workspaceUid: string
    worldCode: string
    workCode: string
  }
  inputBudget: number
  totalInputTokens: number
  sources: ContextManifestSourceV2[]
  v1ManifestHash: string
  manifestHash: string
}

export type ContextManifestArtifactRoleV3 =
  | 'selector-result'
  | 'context-packet'
  | 'source-snapshot'
  | 'tool-result'
  | 'rendered-request'
  | 'raw-response'

export interface ContextManifestArtifactRefV3 {
  role: ContextManifestArtifactRoleV3
  artifactKind: ExactRunArtifactKindV1
  contentHash: string
  byteLength: number
  sourceKey?: string
  resourceKey?: string
  /** Hash of the exact source body inside a source-snapshot artifact. */
  sourceContentHash?: string
  /** Hash of the Canon SourceRefs carried inside a source-snapshot artifact. */
  sourceRefsHash?: string
  toolName?: string
  callIndex?: number
}

/** CTXG-6 immutable final evidence view for one Run step attempt. */
export interface ContextManifestV3 {
  version: 3
  runId: number
  stepId: string
  attempt: number
  scope: ContextManifestV2['scope']
  inputBudget: number
  totalInputTokens: number
  sources: ContextManifestSourceV2[]
  v1ManifestHash: string
  v2ManifestHash: string
  gateway: {
    scopeFingerprint: string
    gatewayVersionHash: string
    policyHash: string
    selectorPolicyId: string
    selectorHash: string
    selectorArtifactHash: string
    inventoryHash: string
    catalogVersion: string
    contextPacketHash: string
    sufficiency: ContextSufficiencyReportV1
    retrievalTrace: RetrievalTraceV1
  }
  artifacts: ContextManifestArtifactRefV3[]
  prompt: {
    promptHash: string
    renderedRequestArtifactHash: string
  }
  candidate: {
    candidateHash: string
    rawResponseArtifactHash: string
  }
  workingContext: {
    generation: number
    packetArtifactHash: string
    checkpointHash: string | null
  }
  manifestHash: string
}

export interface VerificationCriterionReceiptV1 {
  id: string
  status: 'passed' | 'failed'
  evidenceRefs: string[]
}

/**
 * Deterministic candidate evidence used inside one run generation. The event
 * envelope owns run/contract identity so the receipt remains portable when a
 * project import rebinds physical IDs and contract hashes.
 */
export interface AgentRunStepVerificationReceiptV1 {
  version: 1
  stepId: string
  attempt: number
  candidateHash: string
  outputHash: string
  contextManifestHash: string
  verifierSetVersion: string
  criteria: VerificationCriterionReceiptV1[]
  acceptedAt: number
  receiptHash: string
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
  /** Exactly one of workId / productRuntimeSessionId owns every non-legacy run. */
  productRuntimeSessionId?: number | null
  /** PRODUCTPROD-1 build owner; build runs remain Work-owned and never use this as a second owner. */
  productBuildId?: number | null
  worldGroupId?: number | null
  conversationId?: number | null
  /** Materialized child index; mirrors contract.ownership or legacy lineage.parent. */
  parentRunId?: number | null
  parentRelation?: string | null
  parentReceiptHash?: string | null
  parentArtifactHash?: string | null
  status: AgentRunState
  contractVersion: 1 | 2 | 3
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
  | 'evidence.artifact.recorded'
  | 'model.requested'
  | 'model.responded'
  | 'tool.called'
  | 'tool.returned'
  | 'candidate.persisted'
  | 'candidate.revised'
  | 'candidate.staled'
  | 'candidate.carried-forward'
  | 'runtime.candidate.adopted'
  | 'step.verification.accepted'
  | 'step.verification.staled'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'adoption.committed'
  | 'adoption.rejected'
  | 'verification.started'
  | 'verification.accepted'
  | 'memory.settlement.recorded'
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
  'evidence.artifact.recorded': {
    artifactKind: import('./memory-engineering').ExactRunArtifactKindV1
    contentHash: string
    byteLength: number
    stepId?: string
    attempt?: number
  }
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
  'runtime.candidate.adopted': {
    stepId: string
    candidateHash: string
    adoptionHash: string
    commandIds: string[]
    baseSequence: number
    resultingSequence: number
  }
  'step.verification.accepted': { receipt: AgentRunStepVerificationReceiptV1 }
  'step.verification.staled': { stepId: string; previousReceiptHash: string; reason: string }
  'confirmation.recorded': {
    stepId: string
    candidateHash: string
    decision: 'adopt' | 'reject'
    /** Optional review metadata for non-Canon author decisions. */
    reviewItemId?: string
    reviewDecision?: 'acknowledged' | 'needs-manual-action'
    note?: string
  }
  'adoption.started': { stepId: string; candidateHash: string; intentHash?: string }
  'adoption.committed': { stepId: string; candidateHash: string; adoptionHash: string }
  'adoption.rejected': { stepId: string; candidateHash: string; code: string }
  'verification.started': { verifierSetVersion: string }
  'verification.accepted': { receiptHash: string }
  /**
   * Immutable Harness-to-memory boundary. The complete receipt remains
   * reproducible from the event ledger; this compact payload freezes its hash
   * and index coverage without copying candidate or manuscript bodies.
   */
  'memory.settlement.recorded': {
    receiptHash: string
    terminalReceiptHash: string | null
    state: 'settled' | 'incomplete'
    contextManifestHashes: string[]
    adoptionHashes: string[]
    artifactIndexHash: string
    workspaceDirty: true
  }
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
  verificationReceiptHash?: string
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
  memorySettlement?: {
    receiptHash: string
    terminalReceiptHash: string | null
    state: 'settled' | 'incomplete'
    artifactIndexHash: string
    workspaceDirty: true
    recordedAt: number
  }
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
