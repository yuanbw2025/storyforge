import { db } from '../db/schema'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { classifyHarnessFailureV1 } from '../agent/run/harness-failure'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import {
  createContextManifestFromAssemblyV1,
  createContextManifestV2FromV1,
} from '../agent/run/context-manifest'
import {
  finalizeContextGatewayAttemptEvidenceV1,
  recordContextGatewayPreflightEvidenceV1,
  type ContextGatewayPreflightEvidenceV1,
} from '../context-gateway/attempt-evidence'
import type { ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { assembleContext } from '../registry/assemble-context'
import type { AssembleContextResult } from '../registry/types'
import type {
  AgentRunEventPayloadByTypeV1,
  AgentRunEventTypeV1,
  AgentRunStepState,
  ContextManifestV2,
  ProductBuildArtifactKindV1,
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionBlockerResolutionV1,
  ProductProductionBriefV3,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductTaskBudgetReservationV1,
  TextOpenWorldSourcePinBundleV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../workspace/scope'
import {
  acceptProductBuildArtifact,
  acceptTextOpenWorldSourcePinBundleArtifactsV1,
  carryForwardProductBuildArtifactsAcrossBuildsV1,
  carryForwardProductBuildArtifactsToEpochV1,
} from './artifact-store'
import { parseProductBuildQualityReportV1 } from './adoption'
import { createProductBuildCompatibilityReportV1 } from './compatibility'
import { parseProductProductionBriefV3 } from './contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import {
  createProductProductionPlanV3,
  parseProductProductionPlanV3,
  textAdventureQualityReviewBatchArtifactKeyV1,
  textAdventureQualityReviewBatchTaskKeysV1,
  textAdventureQualityReviewScopeFromTaskKeyV1,
} from './plan'
import { createProductBuildPreviewManifestV1 } from './preview-manifest'
import { createProductBuildRootTerminalReceiptV1 } from './receipts'
import {
  parseProductRuntimePackageV1,
  productProductionTerminalArtifactKeysV1,
} from './runtime-package'
import { parseTextOpenWorldModulesV1 } from '../open-world/modules'
import {
  executeProductProductionWorldGatewayV1,
  productProductionTaskOwnsWorldGatewayV1,
  productProductionTaskUsesWorldGatewayV1,
  parseConfirmedProductBriefV1,
  parseProductProductionSourcePlanV1,
} from './source-contracts'
import { assertFormalProductProductionStartV1 } from '../product/source-contracts'
import { preserveProductProductionContextV1, ProductProductionContextBudgetErrorV1 } from './context'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'
import {
  parseTextAdventureQualityReviewArtifactV1,
  parseTextAdventureQualityReviewBatchArtifactV1,
  TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1,
  type TextAdventureQualityReviewScopeV1,
} from '../adventure/production-artifacts'
import {
  textAdventureQualityArcRepairTaskKeysV1,
  textAdventureQualityChoiceCopyOnlyRepairV1,
  textAdventureQualityIssueOwnerArtifactKeyV1,
  textAdventureQualityIssueSupersededByCompiledEchoV1,
  textAdventureQualityIssueFrozenBeatContradictionV1,
  textAdventureQualityBeatFactsV1,
  normalizeTextAdventureQualityStableReferenceV1,
  textAdventureQualityReviewAuthorityViolationsV1,
  textAdventureQualityReviewBatchCoverageViolationsV1,
  textAdventureQualityReviewFactualContradictionV1,
  textAdventureQualityReviewReferenceViolationsV1,
  textAdventureQualityReviewScopeViolationsV1,
  textAdventurePlayerPerspectiveIssuesV1,
  textAdventureUnauthorizedKinshipIssuesV1,
  textAdventureDialogueAttributionIssuesV1,
  textAdventureSceneSpeakerAuthorityIssuesV1,
  textAdventureQuestLocationAuthorityIssuesV1,
  isTextAdventureRecomputedQualityIssueV1,
  type TextAdventureQualityReferenceIndexV1,
  type TextAdventureQualityReviewBatchCoverageV1,
} from './text-adventure-quality'
import { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } from '../open-world/creator-derived-authority'
import {
  resolveTextOpenWorldCreatorRepairTaskResultV1,
  type TextOpenWorldCreatorRepairExecutionAuthorityV1,
} from '../open-world/creator-artifact-repair-authority'
import {
  resolveTextOpenWorldCreatorImportedMediaTaskResultV1,
  type TextOpenWorldCreatorMediaExecutionAuthorityV1,
} from '../open-world/creator-media-authority'

const ROOT_TASK_KEY = '$root'
const ROOT_STEP_ID = '$join'
const CLAIM_TTL_MS = 15_000
const ABANDONED_TASK_GRACE_MS = 5_000

/**
 * The frozen Plan declares an upper bound. A provider adapter may impose a
 * narrower effective bound when its service tier cannot safely sustain
 * parallel long-context generations. Agnes free-tier requests have shown
 * head-of-line stalls when two 15k+ context calls are opened together, so
 * serialize only the configured text lane while preserving media concurrency.
 */
export function effectiveTextProviderConcurrencyV1(
  planned: number,
  bindings: readonly ProductProductionCapabilityBindingV1[],
): number {
  const usesAgnesText = bindings.some(binding => (
    binding.adapterId === 'configured-text.v1' && binding.provider === 'agnes'
  ))
  return usesAgnesText ? Math.min(planned, 1) : planned
}
const DETERMINISTIC_WORLD_TOOL = 'product-production-deterministic-world-integrator'
const LOCAL_PROCEDURAL_MEDIA_TOOL = 'product-production-local-procedural-media'
// This is intentionally process-local. A surviving scheduler invocation owns
// its claimed child Run until the promise settles; a browser reload/HMR creates
// a new module instance and therefore cannot accidentally treat the abandoned
// provider request as still in flight. It is only a local fast-path; durable
// event age below prevents another tab/worker from being declared abandoned.
const ACTIVE_TASK_RUN_IDS = new Set<number>()

type ProductBuildCompatibilityBaselineCandidateV1 = Pick<
  ProductBuildRecordV1,
  'id' | 'buildNumber' | 'controlEpoch' | 'packageHash'
>

/**
 * A Build's direct parent is lineage evidence, not necessarily a playable
 * compatibility baseline. Recovery-required/cancelled parents never freeze a
 * packageHash. Compare saves with the nearest earlier terminal package; if no
 * such package exists, the current Build is the first playable session.
 */
export function selectProductBuildCompatibilityBaselineV1(input: {
  currentBuildNumber: number
  parentBuildNumber: number | null
  priorBuilds: readonly ProductBuildCompatibilityBaselineCandidateV1[]
}): ProductBuildCompatibilityBaselineCandidateV1 | null {
  if (input.parentBuildNumber == null) return null
  if (input.parentBuildNumber >= input.currentBuildNumber
    || !input.priorBuilds.some(row => row.buildNumber === input.parentBuildNumber)) {
    throw new Error('[product-production-scheduler] compatibility lineage parent Build 缺失')
  }
  return input.priorBuilds
    .filter(row => row.buildNumber < input.currentBuildNumber && row.packageHash.trim().length > 0)
    .sort((a, b) => b.buildNumber - a.buildNumber)[0] ?? null
}

export interface ProductProductionCapabilityBindingV1 {
  requirementKey: string
  bindingHash: string
  adapterId: string
  /**
   * Non-secret provider identity for capabilities whose output semantics can
   * change when the configured model changes.  Media/built-in bindings may
   * omit these fields; the text vision preflight requires both.
   */
  provider?: string
  model?: string
}

export interface ProductProductionTaskArtifactV1 {
  artifactKey: string
  requirementKey?: string | null
  kind: ProductBuildArtifactKindV1
  mediaKind?: ProductBuildArtifactRecordV1['mediaKind']
  payload: unknown
  metadata?: unknown
  quality?: unknown
  rights?: unknown
  contentHash?: string
  blobObjectId?: number | null
  mimeType?: string | null
  byteSize?: number
}

export interface ProductProductionTaskUsageV1 {
  modelCalls: number
  inputTokens: number
  outputTokens: number
  mediaCalls: number
  costUsd: number | null
  durationMs: number
  storageBytes: number
}

export interface ProductProductionTaskExecutionResultV1 {
  artifacts: ProductProductionTaskArtifactV1[]
  passedGateIds: string[]
  usage: ProductProductionTaskUsageV1
}

/** A received draft failed validation; repeating the same request is not a repair. */
export class ProductProductionDraftRejectedErrorV1 extends Error {
  constructor(message: string, readonly usage: ProductProductionTaskUsageV1) {
    super(message)
    this.name = 'ProductProductionDraftRejectedErrorV1'
  }
}

/** A safely repeatable executor failure with fully observed paid usage. */
export class ProductProductionRetryableExecutionErrorV1 extends Error {
  constructor(message: string, readonly usage: ProductProductionTaskUsageV1) {
    super(message)
    this.name = 'ProductProductionRetryableExecutionErrorV1'
  }
}

/** The provider request crossed dispatch without a definitive response. */
export class ProductProductionResultUnknownErrorV1 extends Error {
  readonly requestDispatched = true
  readonly reservationDisposition = 'retain' as const

  constructor() {
    super('[product-production-model] 请求结果未知；为避免重复生成或计费，必须由作者确认后再处理。')
    this.name = 'ProductProductionResultUnknownErrorV1'
  }
}

export interface ProductProductionTaskExecutionInputV1 {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  buildNumber: number
  controlEpoch: number
  planHash: string
  task: ProductProductionPlanTaskV3
  /** Conservative remaining reservation visible to bounded multi-call executors. */
  attemptBudgetReservation?: ProductTaskBudgetReservationV1
  attempt: number
  idempotencyKey: string
  /** Durable child Run owning this execution attempt. */
  taskRunId?: number
  contextText: string
  inputArtifacts: ProductBuildArtifactRecordV1[]
  capabilityBindings: ProductProductionCapabilityBindingV1[]
  authorResolution: ProductProductionAuthorResolutionEvidenceV1 | null
  signal: AbortSignal
  /** Persist the received model text before parsing, including rejected drafts. */
  onModelOutput?: (output: string) => Promise<void | 'discarded-stale'>
  /** Re-fence a bounded protocol before every paid call after the first. */
  beforeAdditionalModelRequest?: () => Promise<void | 'discarded-stale'>
  authorDraftJson?: string
  /** Registered repair evidence kept separate from the atomic task payload. */
  repairFeedbackText?: string
}

export interface ProductProductionAuthorResolutionEvidenceV1 {
  commandId: string
  blockerKey: string
  resolution: ProductProductionBlockerResolutionV1
  resolvedAt: number
}

export type ProductProductionTaskExecutorV1 = (
  input: ProductProductionTaskExecutionInputV1,
) => Promise<ProductProductionTaskExecutionResultV1>

export type ProductProductionSchedulerBoundaryV1 =
  | 'task.claimed'
  | 'provider.requested'
  | 'provider.responded'
  | 'candidate.checkpoint'
  | 'artifact.accepted'
  | 'root.completed'

interface LedgerTaskV1 {
  runId: number
  attempt: number
  status: 'claimed' | 'settled' | 'failed'
  idempotencyKey: string
  candidateHash: string | null
  terminalReceiptHash: string | null
  passedGateIds: string[]
  usage: ProductProductionTaskUsageV1 | null
  errorCode: string | null
}

interface LedgerAttemptV2 {
  controlEpoch: number
  taskKey: string
  runId: number
  attempt: number
  idempotencyKey: string
  outcome: 'settled' | 'failed'
  usage: ProductProductionTaskUsageV1 | null
  usageKnown: boolean
  errorCode: string | null
  resolution?:
    | 'author-confirmed-not-charged'
    | 'author-charged-reservation-upper-bound'
    | 'system-released-before-dispatch'
    | 'system-released-no-usage-reported'
}

interface SchedulerLedgerV2 {
  schema: 'storyforge.product-production-budget-ledger'
  version: 2
  rootRunId: number | null
  rootClaim: { owner: string; expiresAt: number } | null
  tasks: Record<string, LedgerTaskV1>
  attempts: LedgerAttemptV2[]
}

interface ResumeCandidateV1 {
  schema: 'storyforge.product-production-task-candidate'
  version: 1
  taskKey: string
  attempt: number
  controlEpoch: number
  inputHash: string
  candidateHash: string
  result: ProductProductionTaskExecutionResultV1
}

export interface ProductProductionTaskProjectionV1 {
  taskKey: string
  lane: ProductProductionPlanTaskV3['lane']
  status: 'waiting' | 'ready' | 'running' | 'retry-ready' | 'completed' | 'blocked' | 'stale'
  runId: number | null
  attempt: number
  terminalReceiptHash: string | null
  blocker: string | null
  /** Durable instant when another scheduler may safely classify an abandoned running attempt. */
  recoveryCheckAt: number | null
  latestDurableBoundary: ProductProductionDurableBoundaryProjectionV1 | null
  checkpoint: ProductProductionCheckpointProjectionV1 | null
  steps: ProductProductionStepProjectionV1[]
}

export interface ProductProductionDurableBoundaryProjectionV1 {
  eventType: AgentRunEventTypeV1
  sequence: number
  createdAt: number
  stepId: string | null
  attempt: number | null
}

export interface ProductProductionAttemptProjectionV1 {
  attempt: number
  status: AgentRunStepState
  startedAt: number | null
  finishedAt: number | null
  failureCode: string | null
  latestDurableBoundary: ProductProductionDurableBoundaryProjectionV1 | null
}

export interface ProductProductionStepProjectionV1 {
  stepId: string
  status: AgentRunStepState
  currentAttempt: number
  candidateHash: string | null
  outputHash: string | null
  failureCode: string | null
  attempts: ProductProductionAttemptProjectionV1[]
}

export interface ProductProductionCheckpointProjectionV1 {
  status: 'verified' | 'invalid'
  checkpointHash: string | null
  throughSequence: number | null
  createdAt: number | null
  resumeKind: 'task-candidate' | 'other' | 'invalid'
  candidateHash: string | null
  attempt: number | null
}

export interface ProductProductionSchedulerProjectionV1 {
  productionId: number
  buildId: number
  buildNumber: number
  buildStatus: string
  controlEpoch: number
  planHash: string
  rootRunId: number | null
  terminal: boolean
  budget: {
    usage: ProductProductionTaskUsageV1
    limits: ProductProductionBriefV3['productionBudget']
  }
  tasks: ProductProductionTaskProjectionV1[]
}

function emptyLedger(attempts: LedgerAttemptV2[] = []): SchedulerLedgerV2 {
  return {
    schema: 'storyforge.product-production-budget-ledger',
    version: 2,
    rootRunId: null,
    rootClaim: null,
    tasks: {},
    attempts,
  }
}

function ledgerRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[product-production-scheduler] ${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function exactLedgerKeys(row: Record<string, unknown>, keys: string[], label: string): void {
  const expected = new Set(keys)
  if (Object.keys(row).some(key => !expected.has(key)) || keys.some(key => !(key in row))) {
    throw new Error(`[product-production-scheduler] ${label} 字段不精确`)
  }
}

function ledgerInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`[product-production-scheduler] ${label} 整数无效`)
  }
  return value
}

function ledgerHash(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!isSha256Hash(value) && !(allowEmpty && value === ''))) {
    throw new Error(`[product-production-scheduler] ${label} hash 无效`)
  }
  return value
}

function parseLedgerUsage(value: unknown, label: string): ProductProductionTaskUsageV1 {
  const row = ledgerRecord(value, label)
  exactLedgerKeys(row, [
    'modelCalls', 'inputTokens', 'outputTokens', 'mediaCalls', 'costUsd', 'durationMs', 'storageBytes',
  ], label)
  const costUsd = row.costUsd === null ? null : row.costUsd
  if (costUsd !== null && (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0)) {
    throw new Error(`[product-production-scheduler] ${label}.costUsd 无效`)
  }
  return {
    modelCalls: ledgerInteger(row.modelCalls, `${label}.modelCalls`),
    inputTokens: ledgerInteger(row.inputTokens, `${label}.inputTokens`),
    outputTokens: ledgerInteger(row.outputTokens, `${label}.outputTokens`),
    mediaCalls: ledgerInteger(row.mediaCalls, `${label}.mediaCalls`),
    costUsd,
    durationMs: ledgerInteger(row.durationMs, `${label}.durationMs`),
    storageBytes: ledgerInteger(row.storageBytes, `${label}.storageBytes`),
  }
}

function parseLedger(value: string): SchedulerLedgerV2 {
  if (value === '{}' || !value.trim()) return emptyLedger()
  let candidate: unknown
  try { candidate = JSON.parse(value) } catch { throw new Error('[product-production-scheduler] budget ledger JSON 损坏') }
  const row = ledgerRecord(candidate, 'budget ledger')
  const legacy = row.version === 1
  exactLedgerKeys(row, [
    'schema', 'version', 'rootRunId', 'rootClaim', 'tasks', ...(legacy ? [] : ['attempts']),
  ], 'budget ledger')
  if (row.schema !== 'storyforge.product-production-budget-ledger' || ![1, 2].includes(Number(row.version))
    || !row.tasks || typeof row.tasks !== 'object' || Array.isArray(row.tasks)) {
    throw new Error('[product-production-scheduler] budget ledger 基础字段无效')
  }
  const rootRunId = row.rootRunId === null ? null : ledgerInteger(row.rootRunId, 'rootRunId', 1)
  let rootClaim: SchedulerLedgerV2['rootClaim'] = null
  if (row.rootClaim !== null) {
    const claim = ledgerRecord(row.rootClaim, 'rootClaim')
    exactLedgerKeys(claim, ['owner', 'expiresAt'], 'rootClaim')
    if (typeof claim.owner !== 'string' || !claim.owner || claim.owner.length > 300) {
      throw new Error('[product-production-scheduler] rootClaim.owner 无效')
    }
    rootClaim = { owner: claim.owner, expiresAt: ledgerInteger(claim.expiresAt, 'rootClaim.expiresAt') }
  }
  const tasks: Record<string, LedgerTaskV1> = {}
  for (const [taskKey, rawTask] of Object.entries(row.tasks as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(taskKey)) {
      throw new Error('[product-production-scheduler] ledger taskKey 无效')
    }
    const task = ledgerRecord(rawTask, `tasks.${taskKey}`)
    exactLedgerKeys(task, [
      'runId', 'attempt', 'status', 'idempotencyKey', 'candidateHash', 'terminalReceiptHash',
      'passedGateIds', 'usage', 'errorCode',
    ], `tasks.${taskKey}`)
    if (!['claimed', 'settled', 'failed'].includes(String(task.status))) {
      throw new Error(`[product-production-scheduler] tasks.${taskKey}.status 无效`)
    }
    if (!Array.isArray(task.passedGateIds) || task.passedGateIds.length > 100
      || task.passedGateIds.some(gate => typeof gate !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(gate))
      || new Set(task.passedGateIds).size !== task.passedGateIds.length) {
      throw new Error(`[product-production-scheduler] tasks.${taskKey}.passedGateIds 无效`)
    }
    const errorCode = task.errorCode === null ? null : task.errorCode
    if (errorCode !== null && (typeof errorCode !== 'string' || !errorCode || errorCode.length > 300)) {
      throw new Error(`[product-production-scheduler] tasks.${taskKey}.errorCode 无效`)
    }
    tasks[taskKey] = {
      runId: ledgerInteger(task.runId, `tasks.${taskKey}.runId`, 1),
      attempt: ledgerInteger(task.attempt, `tasks.${taskKey}.attempt`),
      status: task.status as LedgerTaskV1['status'],
      idempotencyKey: ledgerHash(task.idempotencyKey, `tasks.${taskKey}.idempotencyKey`, true),
      candidateHash: task.candidateHash === null ? null : ledgerHash(task.candidateHash, `tasks.${taskKey}.candidateHash`),
      terminalReceiptHash: task.terminalReceiptHash === null
        ? null : ledgerHash(task.terminalReceiptHash, `tasks.${taskKey}.terminalReceiptHash`),
      passedGateIds: [...task.passedGateIds] as string[],
      usage: task.usage === null ? null : parseLedgerUsage(task.usage, `tasks.${taskKey}.usage`),
      errorCode,
    }
  }
  const rawAttempts = legacy
    ? Object.entries(tasks).flatMap(([taskKey, task]) => task.status === 'claimed' ? [] : [{
        controlEpoch: 0,
        taskKey,
        runId: task.runId,
        attempt: task.attempt,
        idempotencyKey: task.idempotencyKey,
        outcome: task.status,
        usage: task.usage,
        usageKnown: task.usage !== null,
        errorCode: task.errorCode,
      }])
    : Array.isArray(row.attempts) ? row.attempts : (() => {
        throw new Error('[product-production-scheduler] budget ledger attempts 无效')
      })()
  if (rawAttempts.length > 20_000) throw new Error('[product-production-scheduler] budget ledger attempts 超限')
  const attempts = rawAttempts.map((rawAttempt, index): LedgerAttemptV2 => {
    const attempt = ledgerRecord(rawAttempt, `attempts[${index}]`)
    exactLedgerKeys(attempt, [
      'controlEpoch', 'taskKey', 'runId', 'attempt', 'idempotencyKey',
      'outcome', 'usage', 'usageKnown', 'errorCode',
      ...('resolution' in attempt ? ['resolution'] : []),
    ], `attempts[${index}]`)
    if (typeof attempt.taskKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(attempt.taskKey)) {
      throw new Error(`[product-production-scheduler] attempts[${index}].taskKey 无效`)
    }
    if (!['settled', 'failed'].includes(String(attempt.outcome)) || typeof attempt.usageKnown !== 'boolean') {
      throw new Error(`[product-production-scheduler] attempts[${index}] 终态无效`)
    }
    const usage = attempt.usage === null ? null : parseLedgerUsage(attempt.usage, `attempts[${index}].usage`)
    if (attempt.usageKnown && usage === null) {
      throw new Error(`[product-production-scheduler] attempts[${index}].usageKnown 缺少已知 usage`)
    }
    const errorCode = attempt.errorCode === null ? null : attempt.errorCode
    if (errorCode !== null && (typeof errorCode !== 'string' || !errorCode || errorCode.length > 300)) {
      throw new Error(`[product-production-scheduler] attempts[${index}].errorCode 无效`)
    }
    const resolution = attempt.resolution
    if (resolution !== undefined && ![
      'author-confirmed-not-charged',
      'author-charged-reservation-upper-bound',
      'system-released-before-dispatch',
      'system-released-no-usage-reported',
    ].includes(String(resolution))) {
      throw new Error(`[product-production-scheduler] attempts[${index}].resolution 无效`)
    }
    return {
      controlEpoch: ledgerInteger(attempt.controlEpoch, `attempts[${index}].controlEpoch`),
      taskKey: attempt.taskKey,
      runId: ledgerInteger(attempt.runId, `attempts[${index}].runId`, 1),
      attempt: ledgerInteger(attempt.attempt, `attempts[${index}].attempt`, 1),
      idempotencyKey: ledgerHash(attempt.idempotencyKey, `attempts[${index}].idempotencyKey`, true),
      outcome: attempt.outcome as LedgerAttemptV2['outcome'],
      usage,
      usageKnown: attempt.usageKnown,
      errorCode,
      ...(resolution === undefined ? {} : { resolution: resolution as LedgerAttemptV2['resolution'] }),
    }
  })
  const identities = attempts.map(attempt => `${attempt.controlEpoch}:${attempt.runId}:${attempt.attempt}`)
  if (new Set(identities).size !== identities.length) {
    throw new Error('[product-production-scheduler] budget ledger attempts 身份重复')
  }
  return {
    schema: 'storyforge.product-production-budget-ledger', version: 2,
    rootRunId, rootClaim, tasks, attempts,
  }
}

/** Public deterministic contract guard for diagnostics, import and regression tests. */
export function assertProductProductionBudgetLedgerV1(value: string): void {
  parseLedger(value)
}

/**
 * Close one conservatively held result-unknown attempt without changing the
 * mainline append-only attempt ledger. The unknown attempt already stores its
 * task reservation as usage with `usageKnown=false`; author resolution turns
 * that hold into either a zero-charge tombstone or an upper-bound charge.
 */
export function resolveProductProductionUnknownResultReservationLedgerV2(input: {
  budgetLedgerJson: string
  taskKey: string
  runId: number
  attempt: number
  controlEpoch: number
  disposition: 'confirmed-not-charged' | 'charge-reservation-upper-bound'
}): {
  budgetLedgerJson: string
  chargedUsage: ProductProductionTaskUsageV1 | null
  accounting: {
    requestedDisposition: 'confirmed-not-charged' | 'charge-reservation-upper-bound'
    effectiveDisposition:
      | 'provider-actual-charge'
      | 'author-confirmed-not-charged'
      | 'author-charged-reservation-upper-bound'
      | 'system-released-before-dispatch'
      | 'system-released-no-usage-reported'
    usage: ProductProductionTaskUsageV1
  }
} {
  const ledger = parseLedger(input.budgetLedgerJson)
  const entry = ledger.attempts.find(attempt => (
    attempt.taskKey === input.taskKey
    && attempt.runId === input.runId
    && attempt.attempt === input.attempt
    && attempt.controlEpoch === input.controlEpoch
  ))
  if (!entry) {
    throw new Error('[product-production-scheduler] unknown-result attempt 与失败证据不一致')
  }
  if (entry.usageKnown) {
    const usage = entry.usage ?? zeroUsage()
    const effectiveDisposition = entry.resolution ?? 'provider-actual-charge'
    const expectedResolution = input.disposition === 'confirmed-not-charged'
      ? 'author-confirmed-not-charged'
      : 'author-charged-reservation-upper-bound'
    if (entry.resolution && entry.resolution !== expectedResolution) {
      throw new Error('[product-production-scheduler] unknown-result attempt 已由另一项作者处置关闭')
    }
    return {
      budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
      chargedUsage: effectiveDisposition === 'author-confirmed-not-charged'
        || effectiveDisposition === 'system-released-before-dispatch'
        || effectiveDisposition === 'system-released-no-usage-reported'
        ? null : structuredClone(usage),
      accounting: {
        requestedDisposition: input.disposition,
        effectiveDisposition,
        usage: structuredClone(usage),
      },
    }
  }
  const heldUsage = entry.usage
  if (!heldUsage) {
    throw new Error('[product-production-scheduler] unknown-result attempt 缺少预算预留')
  }
  const effectiveDisposition = input.disposition === 'confirmed-not-charged'
    ? 'author-confirmed-not-charged' as const
    : 'author-charged-reservation-upper-bound' as const
  const accountingUsage = input.disposition === 'confirmed-not-charged'
    ? zeroUsage()
    : structuredClone(heldUsage)
  entry.usage = accountingUsage
  entry.usageKnown = true
  entry.resolution = effectiveDisposition
  return {
    budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
    chargedUsage: input.disposition === 'confirmed-not-charged' ? null : structuredClone(accountingUsage),
    accounting: {
      requestedDisposition: input.disposition,
      effectiveDisposition,
      usage: structuredClone(accountingUsage),
    },
  }
}

function zeroUsage(): ProductProductionTaskUsageV1 {
  return { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0 }
}

function reservationUsage(reservation: ProductTaskBudgetReservationV1): ProductProductionTaskUsageV1 {
  return {
    modelCalls: reservation.modelCalls,
    inputTokens: reservation.inputTokens,
    outputTokens: reservation.outputTokens,
    mediaCalls: reservation.mediaCalls,
    costUsd: reservation.maximumCostUsd,
    durationMs: reservation.durationMs,
    storageBytes: reservation.storageBytes,
  }
}

function safeExecutorError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const redacted = message
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|ak)-[A-Za-z0-9_-]{8,}\b/g, '[redacted-credential]')
    .replace(/(?:authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi, 'credential=[redacted]')
  const bounded = redacted.length <= 1_000
    ? redacted
  // Parser/coverage failures often enumerate one violation near the start and
  // another at the end. Preserve both causal edges within the same bounded,
  // redacted envelope; head-only truncation makes the next repair oscillate.
    : `${redacted.slice(0, 500)}…${redacted.slice(-499)}`
  try {
    assertExactRunArtifactBodySafeV1({ artifactKind: 'tool-result', body: bounded })
    return bounded
  } catch {
    return '任务执行失败；错误详情包含不适合保存的内容。'
  }
}

function paidUsageFromExecutorError(error: unknown): ProductProductionTaskUsageV1 | null {
  if (!error || typeof error !== 'object' || !('productProductionUsage' in error)) return null
  try {
    return parseLedgerUsage(
      (error as { productProductionUsage?: unknown }).productProductionUsage,
      'executorError.productProductionUsage',
    )
  } catch {
    // A malformed usage attachment is not accepted as evidence. The caller
    // records an unknown paid attempt, which the next budget preflight must
    // hold conservatively.
    return null
  }
}

function isProviderTransportResultUnknown(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.trim()
  return (error.name === 'TypeError' && message === 'Failed to fetch')
    || /^(?:NetworkError|Load failed)(?::|$)/i.test(message)
}

const NON_AUTOMATIC_RETRY_FAILURE_CODES = new Set([
  'provider-safety-refusal',
  'provider-result-unknown',
  'task-preflight-failed',
  'task-result-unknown',
  'task-finalization-failed',
  'task-budget-exceeded',
])

function permitsAutomaticTaskRetry(failureCode: string | undefined): boolean {
  return !failureCode || !NON_AUTOMATIC_RETRY_FAILURE_CODES.has(failureCode)
}

function boundedUsage(usage: ProductProductionTaskUsageV1, reservation: ProductTaskBudgetReservationV1): void {
  // OpenAI-compatible providers can include hidden reasoning and protocol
  // framing in completion_tokens, so the receipt may exceed the maxTokens sent
  // on the wire by a very small accounting delta. Accept at most 2%/128 tokens
  // for normal-sized model tasks, retain the real receipt in the append-only
  // ledger, and let the author-approved Build lifetime budget remain the hard
  // aggregate ceiling. Tiny reservations get no tolerance, keeping budget
  // boundary tests and deliberately narrow contracts exact.
  const outputAccountingTolerance = reservation.outputTokens >= 1_000 && usage.modelCalls > 0
    ? Math.min(128, Math.ceil(reservation.outputTokens * 0.02))
    : 0
  const integers = [usage.modelCalls, usage.inputTokens, usage.outputTokens, usage.mediaCalls, usage.durationMs, usage.storageBytes]
  const invalid = integers.some(value => !Number.isInteger(value) || value < 0)
    || (usage.costUsd != null && (!Number.isFinite(usage.costUsd) || usage.costUsd < 0))
  const exceeded = [
    ['modelCalls', usage.modelCalls, reservation.modelCalls],
    ['inputTokens', usage.inputTokens, reservation.inputTokens],
    ['outputTokens', usage.outputTokens, reservation.outputTokens + outputAccountingTolerance],
    ['mediaCalls', usage.mediaCalls, reservation.mediaCalls],
    ['durationMs', usage.durationMs, reservation.durationMs],
    ['storageBytes', usage.storageBytes, reservation.storageBytes],
    ...(reservation.maximumCostUsd == null
      ? [] : [['costUsd', usage.costUsd ?? 0, reservation.maximumCostUsd] as const]),
  ].filter(([, actual, maximum]) => actual > maximum)
    .map(([field, actual, maximum]) => `${field}=${actual}/${maximum}`)
  if (invalid || exceeded.length > 0) {
    throw new Error(`[product-production-scheduler] task usage 超出 Plan 预算预留${
      invalid ? ':usage-invalid' : `:${exceeded.join(',')}`
    }`)
  }
}

function sumTaskUsage(usages: readonly ProductProductionTaskUsageV1[]): ProductProductionTaskUsageV1 {
  const knownCosts = usages.map(usage => usage.costUsd)
  return {
    modelCalls: usages.reduce((sum, usage) => sum + usage.modelCalls, 0),
    inputTokens: usages.reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: usages.reduce((sum, usage) => sum + usage.outputTokens, 0),
    mediaCalls: usages.reduce((sum, usage) => sum + usage.mediaCalls, 0),
    costUsd: knownCosts.some(value => value == null)
      ? null : knownCosts.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    durationMs: usages.reduce((sum, usage) => sum + usage.durationMs, 0),
    storageBytes: usages.reduce((sum, usage) => sum + usage.storageBytes, 0),
  }
}

function proportionalTaskCostUpperBoundV1(
  reservation: ProductTaskBudgetReservationV1,
  usage: ProductProductionTaskUsageV1,
): number | null {
  if (usage.costUsd != null) return usage.costUsd
  if (reservation.maximumCostUsd == null) return null
  const reservedCalls = reservation.modelCalls + reservation.mediaCalls
  const actualCalls = usage.modelCalls + usage.mediaCalls
  if (reservedCalls === 0) return actualCalls === 0 ? 0 : reservation.maximumCostUsd
  return reservation.maximumCostUsd * Math.min(1, actualCalls / reservedCalls)
}

function remainingTaskAttemptBudgetV1(input: {
  task: ProductProductionPlanTaskV3
  ledger: SchedulerLedgerV2
  controlEpoch: number
}): ProductTaskBudgetReservationV1 {
  // The current text-adventure production plan budgets specialist retries as
  // distinct attempts and reserves retry headroom at the Build level. Keep
  // that shipped contract intact while bounded multi-call tasks consume one
  // task-lifetime reservation inside an epoch.
  if (input.task.skillId?.startsWith('text-adventure.') === true) {
    return structuredClone(input.task.budgetReservation)
  }
  const prior = sumTaskUsage(input.ledger.attempts
    .filter(entry => entry.controlEpoch === input.controlEpoch
      && entry.taskKey === input.task.taskKey && entry.usageKnown && entry.usage != null)
    .map(entry => ({
      ...entry.usage!,
      costUsd: proportionalTaskCostUpperBoundV1(input.task.budgetReservation, entry.usage!),
    })))
  const reservation = input.task.budgetReservation
  return {
    modelCalls: Math.max(0, reservation.modelCalls - prior.modelCalls),
    inputTokens: Math.max(0, reservation.inputTokens - prior.inputTokens),
    outputTokens: Math.max(0, reservation.outputTokens - prior.outputTokens),
    mediaCalls: Math.max(0, reservation.mediaCalls - prior.mediaCalls),
    maximumCostUsd: reservation.maximumCostUsd == null
      ? null
      : Math.max(0, reservation.maximumCostUsd - (prior.costUsd ?? 0)),
    durationMs: Math.max(0, reservation.durationMs - prior.durationMs),
    storageBytes: Math.max(0, reservation.storageBytes - prior.storageBytes),
  }
}

async function assertBuildLifetimeBudgetCapacity(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  controlEpoch: number
}): Promise<void> {
  const current = await currentProductionBuild(input.scope, input.productionId)
  if (current.build.id !== input.buildId || current.build.controlEpoch !== input.controlEpoch) {
    throw new Error('[product-production-scheduler] Build lifetime budget 复验 epoch 已过期')
  }
  const plan = parseProductProductionPlanV3(
    current.build.planJson, current.brief, current.briefRow.briefHash,
  )
  const ledger = parseLedger(current.build.budgetLedgerJson)
  const planTaskByKey = new Map(plan.tasks.map(task => [task.taskKey, task]))
  const charged = ledger.attempts.flatMap(attempt => {
    if (!attempt.usage) return []
    const task = planTaskByKey.get(attempt.taskKey)
    return [{
      ...attempt.usage,
      costUsd: task
        ? proportionalTaskCostUpperBoundV1(task.budgetReservation, attempt.usage)
        : attempt.usage.costUsd,
    }]
  })
  const inFlight = Object.entries(ledger.tasks).flatMap(([taskKey, entry]) => {
    if (entry.status !== 'claimed') return []
    const task = planTaskByKey.get(taskKey)
    return task ? [reservationUsage(remainingTaskAttemptBudgetV1({
      task,
      ledger,
      controlEpoch: current.build.controlEpoch,
    }))] : []
  })
  const usage = sumTaskUsage([...charged, ...inFlight])
  const limits = current.brief.productionBudget
  const exceeded = [
    ['modelCalls', usage.modelCalls, limits.maximumModelCalls],
    ['inputTokens', usage.inputTokens, limits.maximumInputTokens],
    ['outputTokens', usage.outputTokens, limits.maximumOutputTokens],
    ['mediaCalls', usage.mediaCalls, limits.maximumMediaCalls],
    ['durationMs', usage.durationMs, limits.maximumDurationMs],
    ['storageBytes', usage.storageBytes, limits.maximumStorageBytes],
  ].filter(([, actual, maximum]) => actual > maximum)
    .map(([field, actual, maximum]) => `${field}=${actual}/${maximum}`)
  if (limits.maximumCostUsd != null
    && (usage.costUsd == null || usage.costUsd > limits.maximumCostUsd)) {
    exceeded.push(`costUsd=${usage.costUsd ?? 'unknown'}/${limits.maximumCostUsd}`)
  }
  if (exceeded.length > 0) {
    throw new Error(`[product-production-scheduler] Build lifetime budget 不足:${exceeded.join(',')}`)
  }
}

function normalizedBindings(
  task: ProductProductionPlanTaskV3,
  bindings: readonly ProductProductionCapabilityBindingV1[],
): ProductProductionCapabilityBindingV1[] {
  const byKey = new Map(bindings.map(binding => [binding.requirementKey, binding]))
  return task.capabilityRequirementKeys.map(requirementKey => {
    const binding = byKey.get(requirementKey)
    if (!binding || !isSha256Hash(binding.bindingHash) || !binding.adapterId.trim()) {
      throw new Error(`[product-production-scheduler] 缺少非密钥 capability binding:${requirementKey}`)
    }
    const provider = binding.provider?.trim()
    const model = binding.model?.trim()
    if ((provider && !model) || (!provider && model)) {
      throw new Error(`[product-production-scheduler] capability provider/model 必须成对冻结:${requirementKey}`)
    }
    return {
      requirementKey,
      bindingHash: binding.bindingHash,
      adapterId: binding.adapterId.trim(),
      ...(provider && model ? { provider, model } : {}),
    }
  })
}

/** A zero-cost Creator media lane is authorized to execute locally only. Its
 * durable tool marker must remain distinguishable from a remote provider
 * dispatch so a process crash can be retried without an unknown-charge hold. */
function isLocalProceduralMediaTaskV1(
  task: ProductProductionPlanTaskV3,
  bindings: readonly ProductProductionCapabilityBindingV1[],
  authorizedCreatorImportAdapter: string | null = null,
): boolean {
  if (task.executionMode !== 'media-provider'
    || !['media.visual', 'media.audio'].includes(task.taskKey)
    || task.budgetReservation.maximumCostUsd !== 0) return false
  const expectedAdapter = task.taskKey === 'media.visual'
    ? authorizedCreatorImportAdapter ?? 'storyforge.procedural-svg.v1'
    : 'storyforge.procedural-audio.v1'
  if (task.capabilityRequirementKeys.length === 0) {
    throw new Error(
      `[product-production-scheduler] ${task.taskKey} 零费用程序化任务缺少 capability 绑定`,
    )
  }
  for (const requirementKey of task.capabilityRequirementKeys) {
    const binding = bindings.find(item => item.requirementKey === requirementKey)
    if (!binding || binding.adapterId !== expectedAdapter || !isSha256Hash(binding.bindingHash)) {
      throw new Error(
        `[product-production-scheduler] ${task.taskKey} 未获匹配的本地程序化或Creator导入授权`,
      )
    }
  }
  return true
}

class ProductProductionDurableBoundaryInterruptionV1 extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error))
    ;(this as Error & { cause?: unknown }).cause = error
    this.name = 'ProductProductionDurableBoundaryInterruptionV1'
  }
}

function artifactWriteTargets(task: ProductProductionPlanTaskV3) {
  if (task.skillId) {
    const skill = getAgentSkillV1(task.skillId)
    return skill.writeTargets.map(target => ({
      table: target.table,
      fields: [...target.fields],
      mode: 'candidate-only' as const,
      ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}),
    }))
  }
  return [{
    table: 'productBuildArtifacts', fields: [], mode: 'candidate-only' as const,
    adoptionExtension: 'product-production-artifacts',
  }]
}

function taskContextSourceKeys(
  task: ProductProductionPlanTaskV3,
  excludeRepairFeedback = false,
): string[] {
  // The deterministic runtime compiler receives immutable artifact rows via
  // inputArtifacts and binds their hashes in structuralInput. Re-serializing
  // the same full payload into a model-style context duplicates tens of
  // thousands of tokens without adding authority or compiler input.
  if (task.executionMode === 'deterministic' && task.kind === 'runtime-package') {
    return ['product-production.brief']
  }
  if (task.skillId) {
    const skill = getAgentSkillV1(task.skillId)
    return [
      ...skill.contextSourceKeys,
      ...skill.optionalContextSourceKeys.filter(key => (
        (key !== 'product-production.artifact-inputs' || task.inputArtifactKeys.length > 0)
        && (key !== 'product-production.repair-feedback' || !excludeRepairFeedback)
      )),
    ]
  }
  return ['product-production.brief', ...(task.inputArtifactKeys.length > 0 ? ['product-production.artifact-inputs'] : [])]
}

function taskRequiredContextSourceKeys(task: ProductProductionPlanTaskV3): string[] {
  if (task.executionMode === 'deterministic' && task.kind === 'runtime-package') {
    return ['product-production.brief']
  }
  if (task.skillId) {
    const skill = getAgentSkillV1(task.skillId)
    return [...new Set([
      ...skill.contextSourceKeys,
      ...(task.inputArtifactKeys.length > 0 ? ['product-production.artifact-inputs'] : []),
    ])]
  }
  return ['product-production.brief', ...(task.inputArtifactKeys.length > 0 ? ['product-production.artifact-inputs'] : [])]
}

function taskContractContextSourceKeys(task: ProductProductionPlanTaskV3): string[] {
  const normal = taskContextSourceKeys(task)
  const skill = task.skillId ? getAgentSkillV1(task.skillId) : null
  return [...new Set([
    ...normal,
    ...(skill?.contextGateway?.providerSourceKeys ?? []),
    ...(productProductionTaskUsesWorldGatewayV1(task) ? ['worldRelease'] : []),
  ])]
}

function combineProductProductionContextV1(input: {
  assembled: AssembleContextResult
  worldContent: string
  worldContentHash: string
  worldTokens: number
  inputBudget: number
}): AssembleContextResult {
  const separator = input.assembled.text.trim() && input.worldContent.trim() ? '\n\n' : ''
  const text = `${input.assembled.text}${separator}${input.worldContent}`
  const included = [...new Set([...input.assembled.included, 'worldRelease'])]
  const totalInputTokens = input.assembled.totalInputTokens + input.worldTokens
  return {
    ...input.assembled,
    text,
    segments: [
      ...input.assembled.segments,
      {
        label: '冻结世界版本按需读取', layer: 'L0', content: input.worldContent,
        tokens: input.worldTokens, trimmable: false,
      },
    ],
    included,
    omitted: input.assembled.omitted.filter(key => key !== 'worldRelease'),
    trimmed: input.assembled.trimmed.filter(key => key !== 'worldRelease'),
    sourceEvidence: [
      ...(input.assembled.sourceEvidence ?? []),
      {
        key: 'worldRelease', status: 'included', delivery: 'full',
        sourceHash: input.worldContentHash,
        originalCharacters: input.worldContent.length,
        inputCharacters: input.worldContent.length,
        originalTokens: input.worldTokens,
        inputTokens: input.worldTokens,
      },
    ],
    totalInputTokens,
    inputBudget: input.inputBudget,
    overBudgetBeforeTrim: totalInputTokens > input.inputBudget,
    overBudgetAfterTrim: totalInputTokens > input.inputBudget,
  }
}

async function rootContract(scope: WorkspaceScope, build: { id: number; buildNumber: number; controlEpoch: number; planHash: string }) {
  const runtimeBindingHash = await hashProductProductionValueV2({
    schema: 'storyforge.product-production-root-runtime',
    version: 1,
    executor: 'product-production-scheduler',
    planHash: build.planHash,
  })
  return {
    version: 1 as const,
    objective: `负责 ProductBuild ${build.buildNumber} 的有界 DAG 所有权、预算与 terminal join`,
    workflowKind: 'long-running-resumable' as const,
    scope: {
      projectId: scope.projectId,
      worldGroupId: null,
      productProduction: {
        productBuildId: build.id,
        buildNumber: build.buildNumber,
        controlEpoch: build.controlEpoch,
        planHash: build.planHash,
        taskKey: ROOT_TASK_KEY,
      },
    },
    permissions: {
      contextSourceKeys: ['product-production.brief'],
      writeTargets: [{
        table: 'productBuilds', fields: [], mode: 'candidate-only' as const,
        adoptionExtension: 'product-production-builds',
      }],
    },
    runtimeBindingHash,
    dependencyReceiptPolicy: { requiredForJoin: true as const, verifierSetVersion: 'product-production-root-v1' },
    budget: {
      maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1, maxOutputTokens: 1,
      maxAttemptsPerStep: 1,
    },
    acceptance: [
      { id: 'product-production.children', kind: 'deterministic-check' as const, required: true },
      { id: 'product-production.package', kind: 'gate-passed' as const, required: true },
    ],
    verificationPlan: [{
      id: 'product-production.root-terminal', kind: 'terminal' as const,
      verifier: 'product-production-root-v1',
      criterionIds: ['product-production.children', 'product-production.package'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function taskContract(input: {
  scope: WorkspaceScope
  rootRunId: number
  build: { id: number; buildNumber: number; controlEpoch: number; planHash: string }
  task: ProductProductionPlanTaskV3
  capabilityBindingHash?: string
}) {
  const sourceKeys = taskContractContextSourceKeys(input.task)
  const skill = input.task.skillId ? getAgentSkillV1(input.task.skillId) : null
  const executionIdentityHash = await productProductionTaskExecutionIdentityHashV1(input.task)
  const runtimeBindingHash = await hashProductProductionValueV2({
    schema: 'storyforge.product-production-task-runtime',
    version: 1,
    executor: 'product-production-scheduler',
    planHash: input.build.planHash,
    taskKey: input.task.taskKey,
    taskKind: input.task.kind,
    executionMode: input.task.executionMode,
    skillId: input.task.skillId ?? null,
    executionIdentityHash,
    capabilityBindingHash: input.capabilityBindingHash ?? null,
  })
  return {
    version: 1 as const,
    objective: `执行 ProductBuild ${input.build.buildNumber} 的任务 ${input.task.taskKey}`,
    workflowKind: 'long-running-resumable' as const,
    ownership: { parentRunId: input.rootRunId, relation: `task:${input.task.taskKey}` },
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: null,
      productProduction: {
        productBuildId: input.build.id,
        buildNumber: input.build.buildNumber,
        controlEpoch: input.build.controlEpoch,
        planHash: input.build.planHash,
        taskKey: input.task.taskKey,
      },
    },
    permissions: { contextSourceKeys: sourceKeys, writeTargets: artifactWriteTargets(input.task) },
    runtimeBindingHash,
    ...(skill ? { executionBindings: [{ stepId: input.task.taskKey, ...createAgentSkillExecutionBindingV1(skill) }] } : {}),
    dependencyReceiptPolicy: { requiredForJoin: true as const, verifierSetVersion: 'product-production-task-v1' },
    budget: {
      maxModelCalls: Math.max(1, input.task.budgetReservation.modelCalls),
      maxToolCalls: input.task.budgetReservation.mediaCalls,
      maxInputTokens: Math.max(1, input.task.budgetReservation.inputTokens),
      maxOutputTokens: Math.max(1, input.task.budgetReservation.outputTokens),
      maxAttemptsPerStep: input.task.maxAttempts,
    },
    acceptance: [
      { id: `${input.task.taskKey}.output`, kind: 'output-present' as const, required: true },
      { id: `${input.task.taskKey}.gates`, kind: 'gate-passed' as const, required: true },
    ],
    verificationPlan: [{
      id: `${input.task.taskKey}.terminal`, kind: 'terminal' as const,
      verifier: 'product-production-task-v1',
      criterionIds: [`${input.task.taskKey}.output`, `${input.task.taskKey}.gates`],
    }],
    failurePolicy: {
      onProtocolError: input.task.maxAttempts > 1 ? 'retry' as const : 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function productProductionTaskExecutionIdentityPayloadV1(
  task: ProductProductionPlanTaskV3,
  frozenBindings?: AgentRunSnapshotV1['contract']['executionBindings'],
) {
  const executionBindings = frozenBindings ?? (task.skillId
    ? [{ stepId: task.taskKey, ...createAgentSkillExecutionBindingV1(getAgentSkillV1(task.skillId)) }]
    : [])
  return {
    schema: 'storyforge.product-production-task-execution-identity',
    version: 1,
    taskKey: task.taskKey,
    taskKind: task.kind,
    executionMode: task.executionMode,
    executionBindings,
  }
}

/**
 * Stable identity of the executable semantics currently registered for a Plan
 * task. In particular this binds Skill promptVersion/tool schema rather than
 * treating a stable skillId as proof that an older model artifact is fresh.
 */
export async function productProductionTaskExecutionIdentityHashV1(
  task: ProductProductionPlanTaskV3,
): Promise<string> {
  return hashProductProductionValueV2(productProductionTaskExecutionIdentityPayloadV1(task))
}

async function frozenProductProductionTaskExecutionIdentityHashV1(
  task: ProductProductionPlanTaskV3,
  snapshot: Pick<AgentRunSnapshotV1, 'contract'>,
): Promise<string> {
  return hashProductProductionValueV2(productProductionTaskExecutionIdentityPayloadV1(
    task,
    snapshot.contract.executionBindings ?? [],
  ))
}

async function append<T extends AgentRunEventTypeV1>(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: T,
  payload: AgentRunEventPayloadByTypeV1[T],
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
}

async function cancelNonTerminalBuildRunsAfterStopV1(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
}): Promise<void> {
  const rows = await db.agentRuns.where('productBuildId').equals(input.buildId).toArray()
  for (const row of rows) {
    if (row.id == null) continue
    let latest = await readAgentRunV1(input.scope, row.id)
    const productionScope = latest.contract.scope.productProduction
    if (!productionScope
      || productionScope.controlEpoch > input.controlEpoch
      || (latest.projection.state !== 'planned' && latest.projection.state !== 'running')) continue
    try {
      await append(input.scope, latest, 'run.cancelled', {
        reason: 'scheduler-cycle-ended-after-build-stop',
      })
    } catch (error) {
      // Another callback may settle between the read and append. Re-read once:
      // a terminal winner is safe; a still-live child means cleanup genuinely
      // failed and must not be hidden.
      latest = await readAgentRunV1(input.scope, row.id)
      if (latest.projection.state === 'planned' || latest.projection.state === 'running') throw error
    }
  }
}

async function currentProductionBuild(scope: WorkspaceScope, productionId: number) {
  const production = await db.productProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.currentBuildNumber == null || production.currentBriefRevision == null) {
    throw new Error('[product-production-scheduler] Production/当前 Build 不存在')
  }
  const [build, briefRow] = await Promise.all([
    db.productBuilds.where('[productionId+buildNumber]').equals([production.id!, production.currentBuildNumber]).first(),
    db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first(),
  ])
  if (!build || !briefRow || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || briefRow.status !== 'authorized' || build.briefHash !== briefRow.briefHash) {
    throw new Error('[product-production-scheduler] Build/Brief 不满足调度条件')
  }
  const creatorAuthority = briefRow.briefKind === 'text-open-world-creator-v1'
    ? await readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope, buildId: build.id! })
    : null
  const brief = creatorAuthority?.contracts.executionBrief
    ?? parseProductProductionBriefV3(briefRow.briefJson)
  if (!creatorAuthority && await hashProductProductionValueV2(brief) !== briefRow.briefHash) {
    throw new Error('[product-production-scheduler] Brief hash 校验失败')
  }
  return {
    production,
    build,
    briefRow,
    brief,
    creatorContracts: creatorAuthority?.contracts ?? null,
    creatorAuthority,
    repairAuthority: creatorAuthority?.repair ?? null,
    mediaAuthority: creatorAuthority?.media ?? null,
  }
}

export function productProductionEvolutionTaskLaneV1(
  taskKey: string,
): 'content' | 'product' | 'visual' | 'audio' | null {
  if (taskKey.startsWith('content.scene-script.act-')
    || taskKey.startsWith('content.dialogue-pass.act-')
    || taskKey === 'production.supervision'
    || taskKey === 'content.source-sufficiency'
    || taskKey === 'content.design'
    || taskKey === 'content.story-bible'
    || taskKey === 'content.cast-bible'
    || taskKey === 'content.narrative'
    || taskKey === 'content.adventure-architecture'
    || taskKey === 'content.narrative-arc-scenes'
    || taskKey === 'content.narrative-decision-plan'
    || taskKey === 'content.narrative-arc-plan'
    || taskKey === 'content.ending-route-plan'
    || taskKey === 'content.main-quest-plan'
    || taskKey === 'content.quest-script'
    || taskKey.startsWith('content.quest-script.main.act-')
    || taskKey === 'content.quest-script.supplemental'
    || taskKey === 'content.adventure-side-quests'
    || taskKey === 'content.adventure-ambient-events'
    || textAdventureQualityReviewScopeFromTaskKeyV1(taskKey) != null
    || taskKey === 'content.adventure-quality-review') return 'content'
  if (taskKey === 'content.product-module') return 'product'
  if (taskKey === 'media.requirements' || taskKey === 'media.visual-bible.compile'
    || taskKey === 'media.vision-preflight' || taskKey === 'media.anchor-author-gate'
    || /^media\.visual-quality-review\.batch-\d+$/.test(taskKey)
    || taskKey === 'media.visual'
    || taskKey.startsWith('media.visual.')) return 'visual'
  if (taskKey === 'media.audio' || taskKey.startsWith('media.audio.')) return 'audio'
  return null
}

/**
 * A public quality scorecard is only a deterministic projection of the four
 * independently receipted review batches. If that public evidence is invalid
 * or cannot identify a repair owner, carrying the private batches and merely
 * re-running the assembler would reproduce the same result forever.
 */
export function textAdventureQualityReviewRerunTaskKeysV1(
  plan: Pick<ProductProductionPlanV3, 'tasks'>,
): Set<string> {
  const plannedTaskKeys = new Set(plan.tasks.map(task => task.taskKey))
  return new Set([
    ...textAdventureQualityReviewBatchTaskKeysV1()
      .filter(taskKey => plannedTaskKeys.has(taskKey)),
    'content.adventure-quality-review',
  ])
}

function textAdventureQualityRollbackInvalidatedTaskKeysV1(
  plan: Pick<ProductProductionPlanV3, 'tasks'>,
): Set<string> {
  const invalidated = textAdventureQualityReviewRerunTaskKeysV1(plan)
  let expanded = true
  while (expanded) {
    expanded = false
    for (const task of plan.tasks) {
      if (invalidated.has(task.taskKey)
        || !task.dependsOn.some(dependency => invalidated.has(dependency))) continue
      invalidated.add(task.taskKey)
      expanded = true
    }
  }
  return invalidated
}

export interface TextAdventureInvalidQualityRollbackSourceV1 {
  originControlEpoch: number
  invalidReviewContentHash: string
}

export function textAdventureRecoveryUsesQualityRollbackV1(
  affectedLanes: readonly string[] | undefined,
): boolean {
  return !(affectedLanes?.length === 1
    && (affectedLanes[0] === 'production-budget' || affectedLanes[0] === 'runtime'))
}

/**
 * Resolves a semantically invalid review to its one cryptographically signed
 * origin row. Cross-Build recovery must carry from this exact epoch or not
 * reuse at all; it must never substitute a nearer historical Artifact.
 */
export async function textAdventureInvalidQualityRollbackSourceV1(input: {
  buildId: number
  declaredControlEpoch: number
}): Promise<TextAdventureInvalidQualityRollbackSourceV1 | null> {
  if (!Number.isInteger(input.declaredControlEpoch) || input.declaredControlEpoch < 0) {
    throw new Error('[product-production-scheduler] 无效审查回滚基线 epoch 无效')
  }
  const originControlEpoch = await invalidTextAdventureQualityReviewRollbackEpochV1({
    buildId: input.buildId,
    beforeControlEpoch: input.declaredControlEpoch + 1,
  })
  if (originControlEpoch == null) return null
  const candidates = (await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray())
    .filter(row => row.artifactKey === 'quality.adventure-review'
      && row.controlEpoch === originControlEpoch
      && isSha256Hash(row.contentHash)
      && isSha256Hash(row.producerReceiptHash ?? ''))
  const verified: ProductBuildArtifactRecordV1[] = []
  for (const row of candidates) {
    const payload = parsedObject(row.payloadJson)
    if (payload.passed === false
      && await hashProductProductionValueV2(payload) === row.contentHash) verified.push(row)
  }
  if (verified.length !== 1) {
    throw new Error('[product-production-scheduler] 无效审查原产 row 缺失或不唯一')
  }
  return {
    originControlEpoch,
    invalidReviewContentHash: verified[0].contentHash,
  }
}

interface TextAdventureParentQualityRollbackContextV1 {
  sourceBuildId: number
  sourceBuildNumber: number
  sourceArtifacts: ProductBuildArtifactRecordV1[]
  recoverySource: {
    briefHash: string
    planHash: string
    controlEpoch: number
    qualityRollback: TextAdventureInvalidQualityRollbackSourceV1
  }
}

/**
 * Re-opens only the direct recovery lineage frozen into the authorized Brief.
 * This is intentionally stricter than ordinary evolution reuse because it is
 * also used to repair a child Build that an older scheduler already populated
 * from a semantically invalid parent epoch.
 */
async function textAdventureParentQualityRollbackContextV1(input: {
  scope: WorkspaceScope
  build: {
    id?: number
    productionId: number
    parentBuildNumber: number | null
  }
  brief: ProductProductionBriefV3
}): Promise<TextAdventureParentQualityRollbackContextV1 | null> {
  const base = input.brief.evolution?.base
  const usesQualityRollback = textAdventureRecoveryUsesQualityRollbackV1(
    input.brief.evolution?.affectedLanes,
  )
  if (base?.kind !== 'recovery-build' || input.build.id == null
    || input.build.parentBuildNumber !== base.buildNumber || !usesQualityRollback) return null
  const parentBuild = await db.productBuilds
    .where('[productionId+buildNumber]').equals([input.build.productionId, base.buildNumber]).first()
  const rejectedVisualRecovery = parentBuild?.status === 'cancelled'
    && input.brief.evolution?.affectedLanes.length === 1
    && input.brief.evolution.affectedLanes[0] === 'visual'
  if (rejectedVisualRecovery) return null
  if (!parentBuild || parentBuild.id == null
    || !await assertRecordInScope(input.scope, 'productBuilds', parentBuild, { owner: 'work' })
    || parentBuild.productionId !== input.build.productionId
    || parentBuild.status !== 'recovery-required'
    || parentBuild.briefHash !== base.briefHash
    || parentBuild.planHash !== base.planHash
    || parentBuild.controlEpoch !== base.controlEpoch) {
    throw new Error('[product-production-scheduler] 子 Build 的恢复父链已变化')
  }
  const qualityRollback = await textAdventureInvalidQualityRollbackSourceV1({
    buildId: parentBuild.id,
    declaredControlEpoch: base.controlEpoch,
  })
  if (!qualityRollback) return null
  const sourceArtifacts = (await db.productBuildArtifacts.where('buildId').equals(parentBuild.id).toArray())
    .filter(row => row.controlEpoch === qualityRollback.originControlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward' || row.status === 'invalid')
      && isSha256Hash(row.contentHash)
      && isSha256Hash(row.producerReceiptHash ?? ''))
  return {
    sourceBuildId: parentBuild.id,
    sourceBuildNumber: parentBuild.buildNumber,
    sourceArtifacts,
    recoverySource: {
      briefHash: base.briefHash,
      planHash: base.planHash,
      controlEpoch: base.controlEpoch,
      qualityRollback,
    },
  }
}

/**
 * When a child was already initialized by an older scheduler, only tasks that
 * its frozen Plan explicitly marked as cross-Build reuse may be rebound. Every
 * source output must exist exactly once at the coherent parent epoch; missing
 * outputs make that task and its downstream closure run again.
 */
function textAdventureParentRollbackReusableArtifactKeysV1(input: {
  plan: Pick<ProductProductionPlanV3, 'tasks'>
  previousPlan: Pick<ProductProductionPlanV3, 'tasks'>
  sourceBuildNumber: number
  sourceArtifacts: ProductBuildArtifactRecordV1[]
  invalidatedTaskKeys: ReadonlySet<string>
}): string[] {
  const previousTasks = new Map(input.previousPlan.tasks.map(task => [task.taskKey, task]))
  const sourceRowsByKey = new Map<string, ProductBuildArtifactRecordV1[]>()
  for (const artifact of input.sourceArtifacts) {
    const rows = sourceRowsByKey.get(artifact.artifactKey) ?? []
    rows.push(artifact)
    sourceRowsByKey.set(artifact.artifactKey, rows)
  }
  const coherentTasks = new Set<string>()
  const artifactKeys: string[] = []
  for (const task of input.plan.tasks) {
    const previous = previousTasks.get(task.taskKey)
    if (!previous || input.invalidatedTaskKeys.has(task.taskKey)
      || !productProductionTaskReuseSemanticsEqualV1(previous, task)
      || !task.dependsOn.every(dependency => coherentTasks.has(dependency))) continue
    if (task.executionMode === 'deterministic') {
      coherentTasks.add(task.taskKey)
      continue
    }
    if (previous.reuse?.sourceBuildNumber !== input.sourceBuildNumber
      || !task.outputArtifactKeys.every(key => sourceRowsByKey.get(key)?.length === 1)) continue
    coherentTasks.add(task.taskKey)
    artifactKeys.push(...task.outputArtifactKeys)
  }
  return artifactKeys
}

export async function applyCrossBuildEvolutionReuseV1(input: {
  scope: WorkspaceScope
  build: {
    id?: number
    productionId: number
    buildNumber: number
    parentBuildNumber: number | null
    controlEpoch: number
  }
  brief: ProductProductionBriefV3
  plan: ProductProductionPlanV3
}): Promise<{
  plan: ProductProductionPlanV3
  reusableArtifactKeys: string[]
  sourceBuildId: number | null
  qualityRollback: TextAdventureInvalidQualityRollbackSourceV1 | null
}> {
  const evolution = input.brief.evolution
  if (!evolution || input.build.id == null || input.build.parentBuildNumber == null) {
    return { plan: input.plan, reusableArtifactKeys: [], sourceBuildId: null, qualityRollback: null }
  }
  const parentBuild = await db.productBuilds
    .where('[productionId+buildNumber]').equals([input.build.productionId, input.build.parentBuildNumber]).first()
  if (!parentBuild || parentBuild.id == null
    || !await assertRecordInScope(input.scope, 'productBuilds', parentBuild, { owner: 'work' })) {
    throw new Error('[product-production-scheduler] 演化 parent Build 缺失或跨 Work')
  }
  if ((evolution.base.kind === 'build' || evolution.base.kind === 'recovery-build')
    && evolution.base.buildNumber !== parentBuild.buildNumber) {
    throw new Error('[product-production-scheduler] 演化 impact 与 parent Build 不一致')
  }
  const parentFrozenPlanEpoch = evolution.base.kind === 'recovery-build'
    ? (() => {
        try { return parseProductProductionPlanV3(parentBuild.planJson).controlEpoch } catch { return null }
      })()
    : null
  if (evolution.base.kind === 'recovery-build'
    && (evolution.base.briefHash !== parentBuild.briefHash
      || evolution.base.planHash !== parentBuild.planHash
      || (evolution.base.controlEpoch !== parentBuild.controlEpoch
        && evolution.base.controlEpoch !== parentFrozenPlanEpoch))) {
    throw new Error('[product-production-scheduler] 恢复 Build 的 Brief/Plan/epoch 已变化')
  }
  const parentBriefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([input.build.productionId, parentBuild.briefRevision]).first()
  if (!parentBriefRow) throw new Error('[product-production-scheduler] 演化 parent Brief 缺失')
  const parentBrief = parseProductProductionBriefV3(parentBriefRow.briefJson)
  const immutableEnvelope = (brief: ProductProductionBriefV3) => ({
    sourceWorldContentHash: brief.source.worldContentHash,
    productType: brief.intent.productType,
    scale: brief.scale,
    media: brief.media,
    qualityProfile: brief.qualityProfile,
    capabilityRequirements: brief.capabilityRequirements,
    externalDataPolicy: brief.externalDataPolicy,
    fallbackPolicy: brief.fallbackPolicy,
    completionContract: brief.completionContract,
  })
  if (canonicalProductProductionJsonV2(immutableEnvelope(parentBrief))
    !== canonicalProductProductionJsonV2(immutableEnvelope(input.brief))) {
    return { plan: input.plan, reusableArtifactKeys: [], sourceBuildId: parentBuild.id, qualityRollback: null }
  }
  let parentPlan: ProductProductionPlanV3
  try { parentPlan = parseProductProductionPlanV3(parentBuild.planJson, parentBrief, parentBriefRow.briefHash) } catch {
    return { plan: input.plan, reusableArtifactKeys: [], sourceBuildId: parentBuild.id, qualityRollback: null }
  }
  const parentTasks = new Map(parentPlan.tasks.map(task => [task.taskKey, task]))
  // A production-budget child exists only to reset the per-Build lifetime
  // ledger after proven exhaustion. It must continue from the parent's
  // declared current epoch. Replaying an older failed quality review here
  // silently discards later, already-signed repair artifacts and can rebuild
  // a stale narrative closure. Execution-plan/content repair retains the
  // exact-origin rollback path below.
  const qualityRollback = evolution.base.kind === 'recovery-build'
    && textAdventureRecoveryUsesQualityRollbackV1(evolution.affectedLanes)
    ? await textAdventureInvalidQualityRollbackSourceV1({
        buildId: parentBuild.id,
        declaredControlEpoch: evolution.base.controlEpoch,
      })
    : null
  const sourceControlEpoch = qualityRollback?.originControlEpoch
    ?? (evolution.base.kind === 'recovery-build'
      ? evolution.base.controlEpoch : parentBuild.controlEpoch)
  const parentArtifacts = (await db.productBuildArtifacts.where('buildId').equals(parentBuild.id).toArray())
    .filter(row => row.controlEpoch === sourceControlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'
        || (qualityRollback != null && row.status === 'invalid')))
  const artifactByKey = new Map(parentArtifacts.map(row => [row.artifactKey, row]))
  const affected = new Set(evolution.affectedLanes)
  const rollbackInvalidatedTaskKeys = qualityRollback == null
    ? new Set<string>() : textAdventureQualityRollbackInvalidatedTaskKeysV1(input.plan)
  const reusableTasks = new Set<string>()
  const tasks: ProductProductionPlanV3['tasks'] = []
  const reusableArtifactKeys: string[] = []
  for (const task of input.plan.tasks) {
    const parentTask = parentTasks.get(task.taskKey)
    const lane = productProductionEvolutionTaskLaneV1(task.taskKey)
    const requirementsUnchanged = parentTask && canonicalProductProductionJsonV2(
      parentTask.capabilityRequirementKeys.map(key => parentBrief.capabilityRequirements.find(item => item.requirementKey === key)),
    ) === canonicalProductProductionJsonV2(
      task.capabilityRequirementKeys.map(key => input.brief.capabilityRequirements.find(item => item.requirementKey === key)),
    )
    const outputs = task.outputArtifactKeys.map(key => artifactByKey.get(key))
    if (task.taskKey === 'source.author-gate' && !affected.has('content') && !affected.has('world-source')
      && !!parentTask && task.dependsOn.every(dependency => reusableTasks.has(dependency))
      && outputs.every(Boolean)) {
      // An author decision may cross Builds only when the frozen source
      // envelope and all content dependencies are proven unchanged. The copy
      // is still a Build-local carried-forward Artifact with explicit lineage.
      const artifacts = outputs as Array<NonNullable<(typeof outputs)[number]>>
      const reuseKey = await hashProductProductionValueV2({
        schema: 'storyforge.product-production-cross-build-reuse', version: 1,
        sourceBuildNumber: parentBuild.buildNumber, targetBuildNumber: input.build.buildNumber,
        sourceControlEpoch,
        invalidQualityReviewContentHash: qualityRollback?.invalidReviewContentHash ?? null,
        taskKey: task.taskKey, userImpact: evolution.affectedLanes,
        artifacts: artifacts.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
      })
      reusableTasks.add(task.taskKey)
      reusableArtifactKeys.push(...task.outputArtifactKeys)
      tasks.push({
        ...task,
        reuse: {
          sourceBuildNumber: parentBuild.buildNumber,
          sourceArtifactKey: artifacts[0].artifactKey,
          sourceContentHash: artifacts[0].contentHash,
          reuseKey,
          requiresRevalidation: true,
          reason: '作者 impact 未包含 content/world-source，来源审计与私域补充决策闭包未变化',
        },
      })
      continue
    }
    if (task.taskKey === 'integration.narrative' && !affected.has('content') && !affected.has('world-source')
      && !!parentTask && task.dependsOn.every(dependency => reusableTasks.has(dependency))) {
      // The deterministic narrative assembler still runs in the new Build,
      // but its stable upstream closure allows the accepted model review and
      // media plan downstream to be carried once this fresh receipt exists.
      reusableTasks.add(task.taskKey)
      tasks.push(task)
      continue
    }
    if (task.taskKey === 'content.adventure-quality-review'
      && !affected.has('content') && !affected.has('world-source')
      && !!parentTask && task.dependsOn.every(dependency => reusableTasks.has(dependency))) {
      // The four model scorecards are immutable carried evidence. Re-run the
      // cheap deterministic public aggregate in this Build, while marking its
      // closure reusable so unchanged media planning can also be carried.
      reusableTasks.add(task.taskKey)
      tasks.push(task)
      continue
    }
    if (task.taskKey === 'content.narrative-arc-plan'
      && !affected.has('content') && !affected.has('world-source')
      && !!parentTask && task.dependsOn.every(dependency => reusableTasks.has(dependency))) {
      // The narrative department emits two bounded model artifacts and this
      // task deterministically assembles their public arc contract. Re-run the
      // cheap assembler, while preserving the proven unchanged content closure
      // so downstream specialists can be carried into a runtime-only Build.
      reusableTasks.add(task.taskKey)
      tasks.push(task)
      continue
    }
    if (task.taskKey === 'content.quest-script'
      && !affected.has('content') && !affected.has('product') && !affected.has('world-source')
      && !!parentTask && task.dependsOn.every(dependency => reusableTasks.has(dependency))) {
      // Four bounded Quest Scripter Runs are carried when their inputs are
      // unchanged; re-run only the deterministic completeness assembler so
      // downstream scene/runtime proof remains Build-local.
      reusableTasks.add(task.taskKey)
      tasks.push(task)
      continue
    }
    if (/^content\.scene-script\.act-[1-3]$/.test(task.taskKey)
      && !affected.has('content') && !affected.has('world-source')
      && !!parentTask && task.dependsOn.every(dependency => reusableTasks.has(dependency))) {
      // Scene packets carry across unchanged content Builds, while the cheap
      // act assembler runs again to prove packet completeness in this Build.
      reusableTasks.add(task.taskKey)
      tasks.push(task)
      continue
    }
    if (task.taskKey === 'media.visual-bible.compile' && !affected.has('visual')
      && !affected.has('content') && !affected.has('world-source')
      && !!parentTask && task.dependsOn.every(dependency => reusableTasks.has(dependency))) {
      // The compiler is deterministic and cheap. Re-run it in the target Build
      // so the visual Bible is proven against this Build's carried inputs.
      reusableTasks.add(task.taskKey)
      tasks.push(task)
      continue
    }
    if (task.taskKey === 'media.anchor-author-gate' && !affected.has('visual')
      && !affected.has('content') && !affected.has('world-source')
      && !!parentTask && productProductionTaskReuseSemanticsEqualV1(parentTask, task)
      && task.dependsOn.every(dependency => reusableTasks.has(dependency))
      && outputs.every(Boolean)) {
      const artifacts = outputs as Array<NonNullable<(typeof outputs)[number]>>
      const reuseKey = await hashProductProductionValueV2({
        schema: 'storyforge.product-production-cross-build-reuse', version: 1,
        sourceBuildNumber: parentBuild.buildNumber, targetBuildNumber: input.build.buildNumber,
        sourceControlEpoch,
        invalidQualityReviewContentHash: qualityRollback?.invalidReviewContentHash ?? null,
        taskKey: task.taskKey, userImpact: evolution.affectedLanes,
        artifacts: artifacts.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
      })
      reusableTasks.add(task.taskKey)
      reusableArtifactKeys.push(...task.outputArtifactKeys)
      tasks.push({
        ...task,
        reuse: {
          sourceBuildNumber: parentBuild.buildNumber,
          sourceArtifactKey: artifacts[0].artifactKey,
          sourceContentHash: artifacts[0].contentHash,
          reuseKey,
          requiresRevalidation: true,
          reason: '作者 impact 未包含 visual/content/world-source，角色锚点及其视觉圣经依赖闭包未变化',
        },
      })
      continue
    }
    const canReuse = !rollbackInvalidatedTaskKeys.has(task.taskKey)
      && task.executionMode !== 'deterministic' && lane != null && !affected.has(lane)
      && !(task.taskKey === 'media.requirements' && affected.has('audio'))
      && !!parentTask && requirementsUnchanged
      && canonicalProductProductionJsonV2(parentTask.outputArtifactKeys) === canonicalProductProductionJsonV2(task.outputArtifactKeys)
      && task.dependsOn.every(dependency => reusableTasks.has(dependency))
      && outputs.every(Boolean)
    if (!canReuse) {
      tasks.push(task)
      continue
    }
    const artifacts = outputs as Array<NonNullable<(typeof outputs)[number]>>
    const reuseKey = await hashProductProductionValueV2({
      schema: 'storyforge.product-production-cross-build-reuse', version: 1,
      sourceBuildNumber: parentBuild.buildNumber, targetBuildNumber: input.build.buildNumber,
      sourceControlEpoch,
      invalidQualityReviewContentHash: qualityRollback?.invalidReviewContentHash ?? null,
      taskKey: task.taskKey, userImpact: evolution.affectedLanes,
      artifacts: artifacts.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
    })
    reusableTasks.add(task.taskKey)
    reusableArtifactKeys.push(...task.outputArtifactKeys)
    tasks.push({
      ...task,
      reuse: {
        sourceBuildNumber: parentBuild.buildNumber,
        sourceArtifactKey: artifacts[0].artifactKey,
        sourceContentHash: artifacts[0].contentHash,
        reuseKey, requiresRevalidation: true,
        reason: `作者 impact 未包含 ${lane}，且依赖闭包/能力包络未变化`,
      },
    })
  }
  const plan = parseProductProductionPlanV3({ ...input.plan, tasks }, input.brief, input.plan.briefHash)
  return { plan, reusableArtifactKeys, sourceBuildId: parentBuild.id, qualityRollback }
}

export function productProductionTaskReuseSemanticsEqualV1(
  previous: ProductProductionPlanTaskV3,
  next: ProductProductionPlanTaskV3,
): boolean {
  const signature = (task: ProductProductionPlanTaskV3) => ({
    kind: task.kind, skillId: task.skillId, executionMode: task.executionMode,
    executionIdentity: productProductionTaskExecutionIdentityPayloadV1(task),
    dependsOn: task.dependsOn, inputArtifactKeys: task.inputArtifactKeys,
    outputArtifactKeys: task.outputArtifactKeys, requirementKeys: task.requirementKeys,
    capabilityRequirementKeys: task.capabilityRequirementKeys,
    acceptanceGateIds: task.acceptanceGateIds,
  })
  return canonicalProductProductionJsonV2(signature(previous))
    === canonicalProductProductionJsonV2(signature(next))
}

function expandProductProductionInvalidatedTaskClosureV1(
  plan: Pick<ProductProductionPlanV3, 'tasks'>,
  seeds: Iterable<string>,
): Set<string> {
  const invalidated = new Set(seeds)
  let expanded = true
  while (expanded) {
    expanded = false
    for (const task of plan.tasks) {
      if (invalidated.has(task.taskKey) || !task.dependsOn.some(key => invalidated.has(key))) continue
      invalidated.add(task.taskKey)
      expanded = true
    }
  }
  return invalidated
}

/**
 * Cross-Build execution-plan reuse is allowed to carry an already-observed
 * vision probe, its author anchor decision and the paid image closure.  That
 * shortcut is valid only while the *currently configured* text
 * provider/model/capability binding is byte-for-byte the one proven by the
 * probe.  Planning cannot know the live binding, so the scheduler performs
 * this check before it creates any carried child Run.  A stale probe and all
 * descendants are invalidated in the child Build; the probe then executes as
 * an ordinary zero-media-call model task before any image task can be ready.
 */
export async function invalidateStaleCarriedTextAdventureVisionClosureV1(input: {
  scope: WorkspaceScope
  buildId: number
  buildNumber: number
  controlEpoch: number
  plan: ProductProductionPlanV3
  capabilityBindings: ProductProductionCapabilityBindingV1[]
}): Promise<boolean> {
  if (input.plan.productType !== 'text-adventure') return false
  const preflightTask = input.plan.tasks.find(task => task.taskKey === 'media.vision-preflight')
  if (!preflightTask) return false
  const rows = (await db.productBuildArtifacts
    .where('[buildId+artifactKey]').equals([input.buildId, 'media.vision-preflight']).toArray())
    .filter(row => row.controlEpoch === input.controlEpoch && row.status === 'carried-forward')
  if (rows.length === 0) return false
  let valid = rows.length === 1
  const binding = (() => {
    try { return normalizedBindings(preflightTask, input.capabilityBindings)[0] ?? null } catch { return null }
  })()
  if (!binding?.provider || !binding.model) valid = false
  const row = rows[0]
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(row?.payloadJson ?? '{}') as Record<string, unknown> } catch { valid = false }
  const observedQuadrants = Array.isArray(payload.observedQuadrants)
    ? payload.observedQuadrants : []
  const allowedQuadrants = new Set([
    'black', 'blue', 'cyan', 'green', 'magenta', 'red', 'white', 'yellow',
  ])
  const expectedKeys = [
    'buildNumber', 'capabilityHash', 'imageContentHash', 'model', 'observedQuadrants',
    'passed', 'provider', 'schema', 'textCapabilityBindingHash', 'version',
  ]
  const expectedBindingHash = binding?.provider && binding.model
    ? await hashProductProductionValueV2({
        schema: 'storyforge.text-adventure-vision-preflight-binding', version: 1,
        capabilityHash: binding.bindingHash, provider: binding.provider, model: binding.model,
      })
    : null
  if (!row || row.carriedFrom == null
    || await hashProductProductionValueV2(payload) !== row.contentHash
    || payload.schema !== 'storyforge.text-adventure-vision-capability-preflight'
    || payload.version !== 2 || !Number.isSafeInteger(payload.buildNumber)
    || Number(payload.buildNumber) < 1 || Number(payload.buildNumber) > input.buildNumber
    || Object.keys(payload).sort().join(',') !== expectedKeys.join(',')
    || !isSha256Hash(String(payload.imageContentHash ?? ''))
    || observedQuadrants.length !== 4 || new Set(observedQuadrants).size !== 4
    || observedQuadrants.some(value => typeof value !== 'string' || !allowedQuadrants.has(value))
    || payload.capabilityHash !== binding?.bindingHash
    || payload.provider !== binding?.provider || payload.model !== binding?.model
    || payload.textCapabilityBindingHash !== expectedBindingHash || payload.passed !== true) {
    valid = false
  }
  if (valid) return false

  const invalidatedTasks = expandProductProductionInvalidatedTaskClosureV1(
    input.plan, ['media.vision-preflight'],
  )
  const invalidatedArtifactKeys = new Set(input.plan.tasks
    .filter(task => invalidatedTasks.has(task.taskKey))
    .flatMap(task => task.outputArtifactKeys))
  await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productBuildArtifacts), async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || build.buildNumber !== input.buildNumber || build.controlEpoch !== input.controlEpoch
      || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) {
      throw new Error('[product-production-scheduler] vision preflight 失效处理时 Build CAS 已过期')
    }
    await db.productBuildArtifacts.where('buildId').equals(input.buildId).and(artifact => (
      artifact.controlEpoch === input.controlEpoch && artifact.status === 'carried-forward'
        && invalidatedArtifactKeys.has(artifact.artifactKey)
    )).modify({ status: 'invalid', updatedAt: Date.now() })
  })
  return true
}

/**
 * Recovery may only reuse a provider-owned Artifact when its frozen Skill
 * binding still equals the current registry. Prefer the immediately preceding
 * epoch's completed child Run. A pause can, however, interrupt synthetic carry
 * settlement after the immutable Artifact rows have already been rebound. In
 * that case the carried rows retain the original producer Run/receipt and that
 * provenance is the authority; requiring a not-yet-created synthetic Run would
 * turn a second pause into a paid provider retry. Missing, ambiguous or
 * unverifiable provenance still fails closed and invalidates the downstream
 * dependency closure.
 */
export async function executionBindingDriftInvalidatedTaskKeysV1(input: {
  scope: WorkspaceScope
  buildId: number
  previousControlEpoch: number
  plan: Pick<ProductProductionPlanV3, 'tasks'>
  allowHistoricalProducerFallback?: boolean
}): Promise<Set<string>> {
  const providerTasks = input.plan.tasks.filter(task => task.skillId != null)
  if (providerTasks.length === 0) return new Set()
  const rows = await db.agentRuns.where('productBuildId').equals(input.buildId).toArray()
  const sourceArtifactRows = await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray()
  const currentBuild = await db.productBuilds.get(input.buildId)
  const lineageBuilds = currentBuild == null ? [] : (await db.productBuilds
    .where('productionId').equals(currentBuild.productionId).toArray())
    .filter(build => build.projectId === currentBuild.projectId
      && build.worldId === currentBuild.worldId && build.workId === currentBuild.workId)
  const lineageRows = (await Promise.all(lineageBuilds.map(build => (
    db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  )))).flat()
  const lineageBuildByNumber = new Map(lineageBuilds.map(build => [build.buildNumber, build]))
  const originProducerArtifact = (
    artifact: ProductBuildArtifactRecordV1,
  ): ProductBuildArtifactRecordV1 | null => {
    let cursor = artifact
    const visited = new Set<number>()
    for (let depth = 0; depth <= lineageBuilds.length + sourceArtifactRows.length; depth += 1) {
      if (cursor.id == null || visited.has(cursor.id)) return null
      visited.add(cursor.id)
      if (cursor.producerRunId != null && isSha256Hash(cursor.producerReceiptHash ?? '')) return cursor
      const carried = cursor.carriedFrom
      if (!carried || cursor.parentArtifactHash !== carried.contentHash
        || cursor.artifactKey !== carried.artifactKey
        || cursor.contentHash !== carried.contentHash
        || !isSha256Hash(cursor.producerReceiptHash ?? '')) return null
      const sourceBuild = lineageBuildByNumber.get(carried.buildNumber)
      if (!sourceBuild?.id) return null
      const matches = lineageRows.filter(row => row.buildId === sourceBuild.id
        && row.artifactKey === carried.artifactKey
        && row.version === carried.version
        && row.contentHash === carried.contentHash
        && row.producerReceiptHash === cursor.producerReceiptHash
        && (row.status === 'accepted' || row.status === 'carried-forward' || row.status === 'invalid'))
      if (matches.length !== 1) return null
      cursor = matches[0]
    }
    return null
  }
  const sourceArtifactsForTask = (task: ProductProductionPlanTaskV3) => task.outputArtifactKeys.map(artifactKey => {
    const immediate = sourceArtifactRows.filter(row => row.artifactKey === artifactKey
      && row.controlEpoch === input.previousControlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
    if (immediate.length > 0 || input.allowHistoricalProducerFallback !== true) return immediate
    const historical = sourceArtifactRows.filter(row => row.artifactKey === artifactKey
      && row.controlEpoch <= input.previousControlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward' || row.status === 'invalid'))
      .sort((left, right) => right.controlEpoch - left.controlEpoch || right.version - left.version)
    const latestEpoch = historical[0]?.controlEpoch
    return latestEpoch == null ? [] : historical.filter(row => row.controlEpoch === latestEpoch)
  })
  const seeds = new Set<string>()
  for (const task of providerTasks) {
    const candidates = rows.filter(row => {
      if (row.parentRunId == null || row.parentRelation !== `task:${task.taskKey}`
        || !isSha256Hash(row.terminalReceiptHash ?? '')) return false
      try {
        const contract = JSON.parse(row.contractJson) as {
          scope?: { productProduction?: { controlEpoch?: unknown; taskKey?: unknown } }
        }
        return contract.scope?.productProduction?.controlEpoch === input.previousControlEpoch
          && contract.scope.productProduction.taskKey === task.taskKey
      } catch {
        return false
      }
    })
    if (candidates.length > 1) {
      seeds.add(task.taskKey)
      continue
    }
    const currentIdentity = await productProductionTaskExecutionIdentityHashV1(task)
    if (candidates.length === 0) {
      const outputs = sourceArtifactsForTask(task)
      if (outputs.length === 0 || outputs.some(matches => matches.length !== 1)) {
        seeds.add(task.taskKey)
        continue
      }
      let provenanceValid = true
      for (const artifact of outputs.map(matches => matches[0])) {
        const origin = originProducerArtifact(artifact)
        if (origin?.producerRunId == null || !isSha256Hash(origin.producerReceiptHash ?? '')) {
          provenanceValid = false
          break
        }
        try {
          const snapshot = await readAgentRunV1(input.scope, origin.producerRunId)
          if (snapshot.projection.state !== 'completed'
            || snapshot.projection.terminalReceiptHash !== origin.producerReceiptHash
            || snapshot.contract.scope.productProduction?.taskKey !== task.taskKey
            || currentIdentity !== await frozenProductProductionTaskExecutionIdentityHashV1(task, snapshot)) {
            provenanceValid = false
            break
          }
        } catch {
          provenanceValid = false
          break
        }
      }
      if (!provenanceValid) seeds.add(task.taskKey)
      continue
    }
    if (candidates[0].id == null) {
      seeds.add(task.taskKey)
      continue
    }
    try {
      const snapshot = await readAgentRunV1(input.scope, candidates[0].id)
      const frozenIdentity = await frozenProductProductionTaskExecutionIdentityHashV1(task, snapshot)
      if (currentIdentity !== frozenIdentity) seeds.add(task.taskKey)
    } catch {
      seeds.add(task.taskKey)
    }
  }
  return expandProductProductionInvalidatedTaskClosureV1(input.plan, seeds)
}

/**
 * A Creator repair/media command persists the exact cross-Build reuse plan
 * before the scheduler starts. Re-entry must materialize those immutable
 * carries from that persisted authority; otherwise deterministic ancestors
 * such as P0 would be dispatched again instead of receiving a zero-call
 * revalidation receipt.
 */
async function ensureCrossBuildCarryForPersistedPlanV1(input: {
  scope: WorkspaceScope
  build: { id: number; productionId: number; controlEpoch: number }
  plan: ProductProductionPlanV3
}): Promise<void> {
  const reusableTasks = input.plan.tasks.filter(task => task.reuse != null)
  const sourceBuildNumbers = [...new Set(reusableTasks.map(task => task.reuse!.sourceBuildNumber))]
  for (const sourceBuildNumber of sourceBuildNumbers) {
    const sourceBuild = await db.productBuilds.where('[productionId+buildNumber]')
      .equals([input.build.productionId, sourceBuildNumber]).first()
    if (!sourceBuild?.id) {
      throw new Error(`[product-production-scheduler] persisted reuse 来源 Build 缺失:${sourceBuildNumber}`)
    }
    const artifactKeys = reusableTasks
      .filter(task => task.reuse!.sourceBuildNumber === sourceBuildNumber)
      .flatMap(task => task.outputArtifactKeys)
    if (artifactKeys.length > 0) {
      await carryForwardProductBuildArtifactsAcrossBuildsV1({
        scope: input.scope,
        sourceBuildId: sourceBuild.id,
        targetBuildId: input.build.id,
        targetControlEpoch: input.build.controlEpoch,
        artifactKeys,
      })
    }
  }
}

async function ensurePlan(input: {
  scope: WorkspaceScope
  productionId: number
  suppliedPlan?: ProductProductionPlanV3
}) {
  let state = await currentProductionBuild(input.scope, input.productionId)
  if (['paused', 'cancelled', 'failed', 'recovery-required', 'archived', 'released'].includes(state.build.status)) {
    throw new Error(`[product-production-scheduler] Build 状态 ${state.build.status} 不允许调度`)
  }
  let currentPlan: ProductProductionPlanV3 | null = null
  try {
    currentPlan = parseProductProductionPlanV3(state.build.planJson, state.brief, state.briefRow.briefHash)
  } catch { currentPlan = null }
  if (currentPlan && currentPlan.controlEpoch === state.build.controlEpoch && state.build.planHash === await hashProductProductionValueV2(currentPlan)) {
    if (state.build.status === 'authorized') {
      const updatedAt = Date.now()
      await db.transaction('rw', scopeTransactionTables(db.productBuilds), async () => {
        const build = await db.productBuilds.get(state.build.id!)
        if (!build || build.status !== 'authorized'
          || build.controlEpoch !== state.build.controlEpoch
          || build.planHash !== state.build.planHash
          || build.stateRevision !== state.build.stateRevision) {
          throw new Error('[product-production-scheduler] Build 启动 CAS 已过期')
        }
        await db.productBuilds.update(build.id!, {
          status: 'building',
          stateRevision: build.stateRevision + 1,
          startedAt: build.startedAt ?? updatedAt,
          updatedAt,
        })
      })
      state = await currentProductionBuild(input.scope, input.productionId)
    }
    if (state.creatorContracts) {
      await ensureCrossBuildCarryForPersistedPlanV1({
        scope: input.scope,
        build: {
          id: state.build.id!,
          productionId: state.build.productionId,
          controlEpoch: state.build.controlEpoch,
        },
        plan: currentPlan,
      })
    }
    return { ...state, plan: currentPlan }
  }
  const currentMediaRevisionPlan = currentPlan && currentPlan.tasks.some(task => (
    task.taskKey === 'media.repair-feedback'
      || task.reuse?.reason.startsWith('媒资修订 ') === true
  )) ? currentPlan : null
  let plan: ProductProductionPlanV3
  if (state.creatorContracts) {
    if (!currentPlan || await hashProductProductionValueV2(currentPlan) !== state.build.planHash) {
      throw new Error('[product-production-scheduler] Creator Build 的冻结 Plan 缺失或损坏，不能恢复')
    }
    if (currentPlan.controlEpoch > state.build.controlEpoch) {
      throw new Error('[product-production-scheduler] Creator Build 的 Plan epoch 超前，不能恢复')
    }
    if (input.suppliedPlan) {
      throw new Error('[product-production-scheduler] Creator Build 不接受外部 Plan 替换')
    }
    plan = parseProductProductionPlanV3({
      ...currentPlan,
      controlEpoch: state.build.controlEpoch,
    }, state.brief, state.briefRow.briefHash)
  } else if (input.suppliedPlan) {
    plan = parseProductProductionPlanV3(input.suppliedPlan, state.brief, state.briefRow.briefHash)
  } else {
    const freshBasePlan = await createProductProductionPlanV3({
      brief: state.brief,
      briefHash: state.briefRow.briefHash,
      buildNumber: state.build.buildNumber,
      controlEpoch: state.build.controlEpoch,
    })
    const refreshedBaseTaskByKey = new Map(freshBasePlan.tasks.map(task => [task.taskKey, task]))
    plan = currentMediaRevisionPlan
      ? parseProductProductionPlanV3({
          ...currentMediaRevisionPlan,
          controlEpoch: state.build.controlEpoch,
          tasks: currentMediaRevisionPlan.tasks.map(task => {
            const refreshed = refreshedBaseTaskByKey.get(task.taskKey)
            return refreshed ? {
              ...task,
              budgetReservation: refreshed.budgetReservation,
              maxAttempts: refreshed.maxAttempts,
              timeoutMs: refreshed.timeoutMs,
              failurePolicy: refreshed.failurePolicy,
            } : task
          }),
        }, state.brief, state.briefRow.briefHash)
      : freshBasePlan
  }
  // Cross-Build reuse belongs only to the child's initial Plan. A later
  // recovery epoch must derive reuse from the immediately preceding epoch so
  // that a deterministic failure can invalidate a carried parent artifact.
  // Re-applying parent reuse here would resurrect the exact stale artifact
  // that the recovery closure just proved unsuitable.
  if (!state.creatorContracts && !input.suppliedPlan && !currentMediaRevisionPlan
    && currentPlan == null && state.build.planRevision === 0) {
    const reuse = await applyCrossBuildEvolutionReuseV1({
      scope: input.scope, build: state.build, brief: state.brief, plan,
    })
    plan = reuse.plan
    if (reuse.sourceBuildId != null && reuse.reusableArtifactKeys.length > 0) {
      await carryForwardProductBuildArtifactsAcrossBuildsV1({
        scope: input.scope, sourceBuildId: reuse.sourceBuildId, targetBuildId: state.build.id!,
        targetControlEpoch: state.build.controlEpoch, artifactKeys: reuse.reusableArtifactKeys,
        recoverySource: state.brief.evolution?.base.kind === 'recovery-build'
          ? {
              briefHash: state.brief.evolution.base.briefHash,
              planHash: state.brief.evolution.base.planHash,
              controlEpoch: state.brief.evolution.base.controlEpoch,
              ...(reuse.qualityRollback
                ? { qualityRollback: reuse.qualityRollback }
                : {}),
            }
          : undefined,
      })
    }
  }
  if (plan.controlEpoch !== state.build.controlEpoch || plan.buildNumber !== state.build.buildNumber) {
    throw new Error('[product-production-scheduler] Plan 与 Build epoch/number 不一致')
  }
  const planHash = await hashProductProductionValueV2(plan)
  if (currentPlan && currentPlan.controlEpoch < plan.controlEpoch
    && currentPlan.briefHash === plan.briefHash && currentPlan.buildNumber === plan.buildNumber) {
    // A provider review that violates the registered reviewer boundary is not
    // evidence against any authored Artifact. If a prior software version
    // already started a broad repair from that bad review, reuse the coherent
    // epoch that produced it and discard the accidental intermediate rewrite.
    const declaredParentBuildNumber = state.brief.evolution?.base.kind === 'recovery-build'
      ? state.brief.evolution.base.buildNumber : null
    const parentQualityRollback = declaredParentBuildNumber != null
      && currentPlan.tasks.some(task => task.reuse?.sourceBuildNumber === declaredParentBuildNumber)
      ? await textAdventureParentQualityRollbackContextV1({
          scope: input.scope, build: state.build, brief: state.brief,
        })
      : null
    // Prefer the frozen direct-parent lineage. An old child epoch may contain a
    // copied review, but its authored ancestors can already be the broad parent
    // rewrite caused by that review; rolling back inside the child is too late.
    const detectedReviewRollbackControlEpoch = parentQualityRollback == null
      ? await invalidTextAdventureQualityReviewRollbackEpochV1({
          buildId: state.build.id!, beforeControlEpoch: plan.controlEpoch,
        })
      : null
    const reviewRollbackControlEpoch = detectedReviewRollbackControlEpoch != null
      && await textAdventureQualityRollbackAlreadyAppliedV1({
        buildId: state.build.id!,
        currentControlEpoch: currentPlan.controlEpoch,
        originControlEpoch: detectedReviewRollbackControlEpoch,
      })
      ? null
      : detectedReviewRollbackControlEpoch
    const currentEpochHasPassedQuality = await passedTextAdventureQualityReviewAtEpochV1({
      buildId: state.build.id!, controlEpoch: currentPlan.controlEpoch,
    })
    const activeQualityRepairCause = currentEpochHasPassedQuality
      ? null : activeTextAdventureQualityRepairCauseV1(state.build.failureJson)
    const regressedQualityPassEpoch = parentQualityRollback == null
      && reviewRollbackControlEpoch == null
      && activeQualityRepairCause != null
      ? await regressedTextAdventureQualityPassEpochV1({
          buildId: state.build.id!,
          failedControlEpoch: currentPlan.controlEpoch,
        })
      : null
    const qualityRepairSourceEpoch = parentQualityRollback == null
      && reviewRollbackControlEpoch == null
      && regressedQualityPassEpoch == null
      && (activeQualityRepairCause != null
        || legacyPausedTextAdventureQualityRecoveryV1(state.build.failureJson))
      ? (await latestFailedTextAdventureQualityReviewV1(
          state.build.id!, plan.controlEpoch,
        ))?.controlEpoch ?? null
      : null
    const confirmedAnchorRecoveryEpoch = parentQualityRollback == null
      && reviewRollbackControlEpoch == null
      && regressedQualityPassEpoch == null
      && qualityRepairSourceEpoch == null
      ? await latestConfirmedTextAdventureAnchorRecoveryEpochV1({
          buildId: state.build.id!,
          beforeControlEpoch: plan.controlEpoch,
          failureJson: state.build.failureJson,
        })
      : null
    const recoveryArtifactSourceEpoch = reviewRollbackControlEpoch
      ?? regressedQualityPassEpoch
      ?? qualityRepairSourceEpoch
      ?? confirmedAnchorRecoveryEpoch
      ?? currentPlan.controlEpoch
    const pauseResumeRecovery = (() => {
      const failure = parsedObject(state.build.failureJson)
      return failure.code === 'user-paused' || failure.code === 'user-resumed'
    })()
    const invalidatedTaskKeys = parentQualityRollback != null || reviewRollbackControlEpoch != null
      ? textAdventureQualityRollbackInvalidatedTaskKeysV1(plan)
      : regressedQualityPassEpoch != null
        ? expandProductProductionInvalidatedTaskClosureV1(plan, ['media.anchor-author-gate'])
        : confirmedAnchorRecoveryEpoch != null
          // The author decision and the passed quality evidence already form a
          // complete signed prefix. Missing or interrupted image Runs are
          // invalidated below by execution-binding verification; append-only
          // diagnostic taskFailures must not rewind prose on pause/resume.
          ? new Set<string>()
        : await recoveryInvalidatedTaskKeys({
            buildId: state.build.id!, failureJson: state.build.failureJson,
            previousControlEpoch: currentPlan.controlEpoch, plan,
          })
    // Parent quality rollback has its own frozen cross-Build lineage verifier
    // and deliberately bypasses the polluted child epoch. Same-Build recovery,
    // however, must prove the immediately preceding child Run binding.
    if (parentQualityRollback == null) {
      const executionBindingInvalidatedTaskKeys = await executionBindingDriftInvalidatedTaskKeysV1({
        scope: input.scope,
        buildId: state.build.id!,
        previousControlEpoch: recoveryArtifactSourceEpoch,
        plan,
        allowHistoricalProducerFallback: pauseResumeRecovery,
      })
      for (const taskKey of executionBindingInvalidatedTaskKeys) invalidatedTaskKeys.add(taskKey)
    }
    if (parentQualityRollback) {
      const reusableArtifactKeys = textAdventureParentRollbackReusableArtifactKeysV1({
        plan, previousPlan: currentPlan,
        sourceBuildNumber: parentQualityRollback.sourceBuildNumber,
        sourceArtifacts: parentQualityRollback.sourceArtifacts,
        invalidatedTaskKeys,
      })
      if (reusableArtifactKeys.length > 0) {
        await carryForwardProductBuildArtifactsAcrossBuildsV1({
          scope: input.scope,
          sourceBuildId: parentQualityRollback.sourceBuildId,
          targetBuildId: state.build.id!,
          targetControlEpoch: plan.controlEpoch,
          artifactKeys: reusableArtifactKeys,
          recoverySource: parentQualityRollback.recoverySource,
        })
      }
    } else {
      const previousTasks = new Map(currentPlan.tasks.map(task => [task.taskKey, task]))
      const coherentTasks = new Set<string>()
      const reusableArtifactKeys: string[] = []
      for (const task of plan.tasks) {
        const previous = previousTasks.get(task.taskKey)
        const carriesExplicitAuthorDecision = task.taskKey === 'source.author-gate'
          || task.taskKey === 'media.anchor-author-gate'
        const coherent = !invalidatedTaskKeys.has(task.taskKey) && previous != null
          && productProductionTaskReuseSemanticsEqualV1(previous, task)
          && task.dependsOn.every(dependency => coherentTasks.has(dependency))
        if (!coherent) continue
        coherentTasks.add(task.taskKey)
        if ((task.executionMode !== 'deterministic' || carriesExplicitAuthorDecision)
          && canonicalProductProductionJsonV2(previous.outputArtifactKeys)
            === canonicalProductProductionJsonV2(task.outputArtifactKeys)) {
          reusableArtifactKeys.push(...task.outputArtifactKeys)
        }
      }
      if (reusableArtifactKeys.length > 0) await carryForwardProductBuildArtifactsToEpochV1({
        scope: input.scope, buildId: state.build.id!,
        fromControlEpoch: recoveryArtifactSourceEpoch,
        toControlEpoch: plan.controlEpoch, artifactKeys: reusableArtifactKeys,
        allowInvalidSourceAtFromEpoch: reviewRollbackControlEpoch != null
          || regressedQualityPassEpoch != null
          || qualityRepairSourceEpoch != null
          || confirmedAnchorRecoveryEpoch != null,
        allowHistoricalInvalidSourceBeforeEpoch: pauseResumeRecovery,
      })
    }
  }
  await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productBuildArtifacts), async () => {
    const build = await db.productBuilds.get(state.build.id!)
    if (!build || build.controlEpoch !== state.build.controlEpoch || build.stateRevision !== state.build.stateRevision) {
      throw new Error('[product-production-scheduler] Plan CAS 已过期')
    }
    await db.productBuildArtifacts.where('buildId').equals(build.id!).filter(row => (
      row.controlEpoch !== build.controlEpoch && (row.status === 'accepted' || row.status === 'carried-forward')
    )).modify({ status: 'invalid', updatedAt: Date.now() })
    const priorLedger = parseLedger(build.budgetLedgerJson)
    await db.productBuilds.update(build.id!, {
      status: 'building', planRevision: build.planRevision + 1,
      planJson: canonicalProductProductionJsonV2(plan), planHash,
      // A recovery epoch owns a fresh root/task projection, but paid attempts
      // remain append-only for the entire Build lifetime.
      budgetLedgerJson: canonicalProductProductionJsonV2(emptyLedger(priorLedger.attempts)),
      stateRevision: build.stateRevision + 1, startedAt: build.startedAt ?? Date.now(), updatedAt: Date.now(),
    })
  })
  state = await currentProductionBuild(input.scope, input.productionId)
  return { ...state, plan }
}

function parsedObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

function authorResolutionEvidence(
  failureJson: string,
  taskKey: string,
): ProductProductionAuthorResolutionEvidenceV1 | null {
  const row = parsedObject(failureJson)
  const resolution = row.resolution
  if (row.blockerKey !== taskKey || typeof row.commandId !== 'string'
    || !resolution || typeof resolution !== 'object' || Array.isArray(resolution)
    || typeof row.resolvedAt !== 'number' || !Number.isFinite(row.resolvedAt)) return null
  const candidate = resolution as Record<string, unknown>
  const actions: ProductProductionBlockerResolutionV1['action'][] = [
    'retry', 'fallback', 'waive-soft-gate', 'change-capability',
    'accept-product-private-expansion', 'confirm-character-anchors', 'cancel',
  ]
  if (typeof candidate.action !== 'string'
    || !actions.includes(candidate.action as ProductProductionBlockerResolutionV1['action'])
    || typeof candidate.note !== 'string' || !candidate.note.trim()) return null
  return {
    commandId: row.commandId,
    blockerKey: row.blockerKey,
    resolution: {
      action: candidate.action as ProductProductionBlockerResolutionV1['action'],
      note: candidate.note,
    },
    resolvedAt: row.resolvedAt,
  }
}

function textAdventureQualityRepairCause(value: string | Record<string, unknown>): Record<string, unknown> | null {
  const pending: Record<string, unknown>[] = [typeof value === 'string' ? parsedObject(value) : value]
  const visited = new Set<Record<string, unknown>>()
  for (let inspected = 0; inspected < 64 && pending.length > 0; inspected += 1) {
    const current = pending.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    if (current.taskKey === 'integration.package'
      && typeof current.detail === 'string'
      && current.detail.includes('文字冒险叙事质量审查未通过')) return current
    for (const key of ['repairCause', 'previousFailure']) {
      const nested = current[key]
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        pending.unshift(nested as Record<string, unknown>)
      }
    }
  }
  return null
}

function directTextAdventureQualityRepairCauseV1(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  if (value.taskKey === 'integration.package'
    && typeof value.detail === 'string'
    && value.detail.includes('文字冒险叙事质量审查未通过')) return value
  if (typeof value.taskKey !== 'string'
    || !/^content\.adventure-quality-review(?:\.|$)/.test(value.taskKey)) return null
  const repairCause = value.repairCause
  if (!repairCause || typeof repairCause !== 'object' || Array.isArray(repairCause)) return null
  const cause = repairCause as Record<string, unknown>
  return cause.taskKey === 'integration.package'
    && typeof cause.detail === 'string'
    && cause.detail.includes('文字冒险叙事质量审查未通过')
    ? cause : null
}

/**
 * Resolves only the currently active narrative-quality recovery cause.
 *
 * Recovery envelopes intentionally retain append-only `repairCause` and
 * `taskFailures` diagnostics. A generic recursive search therefore cannot be
 * used to choose the source epoch: an unrelated later blocker (for example,
 * the character-anchor author gate) may still contain an old quality failure
 * for audit purposes. Only the direct failure, an interrupted quality-review
 * task, or a pause/resume wrapper around either is allowed to reactivate that
 * failed quality lineage.
 */
export function activeTextAdventureQualityRepairCauseV1(
  value: string | Record<string, unknown>,
): Record<string, unknown> | null {
  let current = typeof value === 'string' ? parsedObject(value) : value
  const visited = new Set<Record<string, unknown>>()
  for (let depth = 0; depth < 16; depth += 1) {
    if (visited.has(current)) return null
    visited.add(current)
    const code = typeof current.code === 'string' ? current.code : null
    const previousFailure = current.previousFailure
    const previous = previousFailure && typeof previousFailure === 'object'
      && !Array.isArray(previousFailure)
      ? previousFailure as Record<string, unknown> : null

    if (code === 'user-paused' || code === 'user-resumed') {
      if (!previous) return null
      current = previous
      continue
    }

    if (typeof current.blockerKey === 'string') {
      const qualityBlocker = current.blockerKey === 'integration.package'
        || /^content\.adventure-quality-review(?:\.|$)/.test(current.blockerKey)
      // A resolved author/media/source blocker owns the current transition.
      // Historical quality causes inside its compact evidence stay diagnostic.
      if (!qualityBlocker) return null
      return previous
        ? directTextAdventureQualityRepairCauseV1(previous)
        : directTextAdventureQualityRepairCauseV1(current)
    }

    return directTextAdventureQualityRepairCauseV1(current)
  }
  return null
}

function legacyPausedTextAdventureQualityRecoveryV1(
  value: string | Record<string, unknown>,
): boolean {
  let current = typeof value === 'string' ? parsedObject(value) : value
  const visited = new Set<Record<string, unknown>>()
  for (let depth = 0; depth < 16; depth += 1) {
    if (visited.has(current)) return false
    visited.add(current)
    if (current.code !== 'user-paused' && current.code !== 'user-resumed') return false
    const previousFailure = current.previousFailure
    if (!previousFailure || typeof previousFailure !== 'object' || Array.isArray(previousFailure)) {
      // Compatibility for Builds paused by versions that did not preserve the
      // causal failure. The latest frozen failed review remains the only
      // recoverable evidence in that legacy shape.
      return true
    }
    current = previousFailure as Record<string, unknown>
  }
  return false
}

export function textAdventureTaskFailures(value: string | Record<string, unknown>): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>()
  const pending: Record<string, unknown>[] = [typeof value === 'string' ? parsedObject(value) : value]
  const visited = new Set<Record<string, unknown>>()
  for (let inspected = 0; inspected < 128 && pending.length > 0; inspected += 1) {
    const current = pending.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    if (typeof current.taskKey === 'string'
      && (current.taskKey.startsWith('content.') || current.taskKey === 'integration.narrative')
      && typeof current.detail === 'string' && current.detail.trim()
      && !result.has(current.taskKey)) {
      // Direct/current causal evidence is queued first. Preserve it when the
      // same task also appears in an older nested recovery envelope.
      result.set(current.taskKey, current)
    }
    for (const key of ['repairCause', 'previousFailure']) {
      const nested = current[key]
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        pending.unshift(nested as Record<string, unknown>)
      }
    }
    const taskFailures = current.taskFailures
    if (taskFailures && typeof taskFailures === 'object' && !Array.isArray(taskFailures)) {
      for (const nested of Object.values(taskFailures)) {
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          pending.push(nested as Record<string, unknown>)
        }
      }
    }
  }
  return result
}

function taskFailureEnvelope(
  existingFailureJson: string,
  failure: Record<string, unknown>,
  options: { preservePrimary?: boolean } = {},
): Record<string, unknown> {
  const existing = parsedObject(existingFailureJson)
  const taskKey = typeof failure.taskKey === 'string' ? failure.taskKey : 'unknown'
  const taskFailures = textAdventureTaskFailures(existingFailureJson)
  if (typeof existing.taskKey === 'string'
    && typeof existing.detail === 'string' && existing.detail.trim()) {
    taskFailures.set(existing.taskKey, {
      taskKey: existing.taskKey,
      ...(typeof existing.code === 'string' ? { code: existing.code } : {}),
      ...(typeof existing.attempt === 'number' ? { attempt: existing.attempt } : {}),
      detail: existing.detail,
    })
  }
  taskFailures.set(taskKey, failure)
  const repairCause = textAdventureQualityRepairCause(existingFailureJson)
  const primary = options.preservePrimary && Object.keys(existing).length > 0
    ? existing : failure
  return {
    ...primary,
    taskFailures: Object.fromEntries([...taskFailures.entries()].sort(([left], [right]) => left.localeCompare(right))),
    ...(repairCause ? { repairCause } : {}),
  }
}

export function textAdventureNarrativeRepairPreservesFrozenMediaV1(issues: unknown): boolean {
  if (!Array.isArray(issues)) return false
  const blocking = issues.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    return row.severity === 'blocking' ? [row] : []
  })
  if (!blocking.length) return false
  return blocking.every(issue => {
    if (typeof issue.detail !== 'string' || typeof issue.recommendation !== 'string') return false
    const evidence = `${issue.detail}\n${issue.recommendation}`
    const visualImpact = /视觉|美术|插图|媒资|图片|画面|角色身份|服饰|道具|色板|构图|\b(?:asset|image|media|visual)\b/i.test(evidence)
    if (visualImpact) return false
    const artifactKey = textAdventureQualityIssueOwnerArtifactKeyV1(issue)
    if (artifactKey === 'content.narrative') {
      return /choice\.|scene\.|locationOrdinal|targetNodeKey|openingBeat|选择文案|选择标签|目标节点|地点错位|场景衔接|未本地化|外语单词/.test(evidence)
    }
    if (artifactKey === 'content.narrative-arc-plan') {
      // Decision topology and missing incoming/outgoing choice edges do not
      // alter any frozen visual requirement.  Keep approved media immutable
      // while the owning narrative specialists repair graph semantics.  A
      // visual term above, or a request to move/change a location/scene card,
      // still forces media planning to run again.
      const changesVisualSceneIdentity = /(?:修改|改写|重写|调整|移动|重设|修正|变更)[^\n]{0,100}(?:locationOrdinal|sceneCards?|场景卡|地点|区域)|(?:locationOrdinal|sceneCards?|场景卡|地点|区域)[^\n]{0,100}(?:修改|改写|重写|调整|移动|重设|修正|变更)/i.test(issue.recommendation)
      return !changesVisualSceneIdentity
        && /decision\.|option\.|echoSceneKeys|choice\.|scene\.|入边|出边|incoming|outgoing|选择|分支|回响|因果/.test(evidence)
    }
    if (artifactKey === 'content.ending-route-plan') {
      return /ending\.|结局|route|路线|requiredEffectKeys|persistentEffectKey|行动链|条件/i.test(evidence)
    }
    if (/^content\.dialogue-pass\.act-[1-3]$/.test(artifactKey)) {
      return /choice\.|dialogue|对白|文案|措辞|描述|未本地化|外语单词/.test(evidence)
    }
    if (/^content\.scene-script\.act-[1-3]$/.test(artifactKey)) {
      return /scene\.|beat|正文|叙述|开场|衔接|未本地化|外语单词/.test(evidence)
    }
    if (artifactKey === 'content.adventure-side-quests'
      || artifactKey === 'content.adventure-ambient-events') {
      return /locationOrdinal|地点错位|发生地|绑定地点|未本地化|外语单词/.test(evidence)
    }
    if (artifactKey === 'content.quest-script') {
      return /未本地化|外语单词|结算文案|玩家可见字段/.test(evidence)
    }
    return false
  })
}

const TEXT_ADVENTURE_QUALITY_BATCH_ARTIFACT_KEYS_V1 = [
  'quality.adventure-review.structure',
  'quality.adventure-review.act-1',
  'quality.adventure-review.act-2',
  'quality.adventure-review.act-3',
] as const

async function passedTextAdventureQualityReviewAtEpochV1(input: {
  buildId: number
  controlEpoch: number
}): Promise<boolean> {
  const rows = (await db.productBuildArtifacts
    .where('[buildId+artifactKey]').equals([input.buildId, 'quality.adventure-review']).toArray())
    .filter(row => row.controlEpoch === input.controlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (rows.length !== 1 || !isSha256Hash(rows[0].contentHash)
    || !isSha256Hash(rows[0].producerReceiptHash ?? '')) return false
  const payload = parsedObject(rows[0].payloadJson)
  return payload.passed === true
    && await hashProductProductionValueV2(payload) === rows[0].contentHash
}

function wrappedTextAdventureFailureTaskKeyV1(
  value: string | Record<string, unknown>,
): string | null {
  let current = typeof value === 'string' ? parsedObject(value) : value
  const visited = new Set<Record<string, unknown>>()
  for (let depth = 0; depth < 16; depth += 1) {
    if (visited.has(current)) return null
    visited.add(current)
    if (current.code === 'user-paused' || current.code === 'user-resumed') {
      const previous = current.previousFailure
      if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return null
      current = previous as Record<string, unknown>
      continue
    }
    return typeof current.taskKey === 'string' ? current.taskKey : null
  }
  return null
}

async function textAdventureAnchorDecisionMatchesBibleV1(input: {
  anchor: ProductBuildArtifactRecordV1
  visualBible: ProductBuildArtifactRecordV1
}): Promise<boolean> {
  let bible: unknown
  let decision: Record<string, unknown>
  try {
    bible = JSON.parse(input.visualBible.payloadJson)
    decision = JSON.parse(input.anchor.payloadJson) as Record<string, unknown>
  } catch { return false }
  if (await hashProductProductionValueV2(bible) !== input.visualBible.contentHash
    || await hashProductProductionValueV2(decision) !== input.anchor.contentHash) return false
  const expectedHash = await hashProductProductionValueV2({
    schema: 'storyforge.text-adventure-visual-anchor-confirmation', version: 1,
    visualBible: bible,
  })
  return decision.schema === 'storyforge.text-adventure-media-anchor-decision-artifact'
    && decision.version === 1
    && decision.decision === 'confirm-character-anchors'
    && decision.visualBibleHash === expectedHash
}

/**
 * Pause/resume does not create Artifact copies for its empty control epoch.
 * When it occurs after a signed character-anchor decision, the immediately
 * preceding Plan may therefore be only a partial replay whose source rows were
 * mechanically marked invalid. Recover the latest cryptographically complete
 * anchor prefix rather than interpreting append-only historical taskFailures
 * as fresh reasons to regenerate prose.
 */
export async function latestConfirmedTextAdventureAnchorRecoveryEpochV1(input: {
  buildId: number
  beforeControlEpoch: number
  failureJson: string | Record<string, unknown>
}): Promise<number | null> {
  if (wrappedTextAdventureFailureTaskKeyV1(input.failureJson) !== 'media.anchor-author-gate') {
    return null
  }
  const rows = await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray()
  const allowedStatuses = new Set<ProductBuildArtifactRecordV1['status']>([
    'accepted', 'carried-forward', 'invalid',
  ])
  const candidateEpochs = [...new Set(rows
    .filter(row => row.controlEpoch < input.beforeControlEpoch
      && row.artifactKey === 'media.anchor-decision'
      && allowedStatuses.has(row.status))
    .map(row => row.controlEpoch))]
    .sort((left, right) => right - left)
  const verifiedPayload = async (row: ProductBuildArtifactRecordV1 | undefined) => {
    if (!row || !isSha256Hash(row.contentHash)
      || !isSha256Hash(row.producerReceiptHash ?? '')) return null
    const payload = parsedObject(row.payloadJson)
    return await hashProductProductionValueV2(payload) === row.contentHash ? payload : null
  }
  const uniqueRow = (epoch: number, artifactKey: string) => {
    const matches = rows.filter(row => row.controlEpoch === epoch
      && row.artifactKey === artifactKey && allowedStatuses.has(row.status))
    return matches.length === 1 ? matches[0] : undefined
  }
  for (const controlEpoch of candidateEpochs) {
    const anchor = uniqueRow(controlEpoch, 'media.anchor-decision')
    const visualBible = uniqueRow(controlEpoch, 'media.visual-bible')
    const requirements = uniqueRow(controlEpoch, 'media.requirements')
    const preflight = uniqueRow(controlEpoch, 'media.vision-preflight')
    const quality = uniqueRow(controlEpoch, 'quality.adventure-review')
    if (!anchor || !visualBible || await verifiedPayload(requirements) == null
      || (await verifiedPayload(preflight))?.passed !== true
      || (await verifiedPayload(quality))?.passed !== true
      || !await textAdventureAnchorDecisionMatchesBibleV1({ anchor, visualBible })) continue
    let completeBatches = true
    for (const artifactKey of TEXT_ADVENTURE_QUALITY_BATCH_ARTIFACT_KEYS_V1) {
      if (await verifiedPayload(uniqueRow(controlEpoch, artifactKey)) == null) {
        completeBatches = false
        break
      }
    }
    if (completeBatches) return controlEpoch
  }
  return null
}

/**
 * Detects a recovery regression in which every current review batch was
 * carried from an older failed epoch even though a newer, fully signed review
 * had already passed. This is deliberately stricter than choosing the nearest
 * passed scorecard: the four current batch lineages, the intervening passed
 * aggregate, and its four same-epoch batches must all be unique and hash
 * valid. Ambiguous evidence fails closed and ordinary narrative repair keeps
 * using the current failed review.
 */
export async function regressedTextAdventureQualityPassEpochV1(input: {
  buildId: number
  failedControlEpoch: number
}): Promise<number | null> {
  if (!Number.isInteger(input.failedControlEpoch) || input.failedControlEpoch < 1) return null
  const allRows = await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray()
  const verifiedPayload = async (row: ProductBuildArtifactRecordV1): Promise<Record<string, unknown> | null> => {
    if (!isSha256Hash(row.contentHash) || !isSha256Hash(row.producerReceiptHash ?? '')) return null
    const payload = parsedObject(row.payloadJson)
    return await hashProductProductionValueV2(payload) === row.contentHash ? payload : null
  }
  const failedAggregates = allRows.filter(row => (
    row.artifactKey === 'quality.adventure-review'
    && row.controlEpoch === input.failedControlEpoch
    && (row.status === 'accepted' || row.status === 'carried-forward')
  ))
  if (failedAggregates.length !== 1
    || (await verifiedPayload(failedAggregates[0]))?.passed !== false) return null

  const originEpochs: number[] = []
  for (const artifactKey of TEXT_ADVENTURE_QUALITY_BATCH_ARTIFACT_KEYS_V1) {
    const currentRows = allRows.filter(row => (
      row.artifactKey === artifactKey
      && row.controlEpoch === input.failedControlEpoch
      && row.status === 'carried-forward'
      && row.carriedFrom != null
    ))
    if (currentRows.length !== 1 || await verifiedPayload(currentRows[0]) == null) return null
    let cursor = currentRows[0]
    const visited = new Set<number>()
    while (cursor.carriedFrom != null) {
      if (cursor.id == null || visited.has(cursor.id)) return null
      visited.add(cursor.id)
      const source = cursor.carriedFrom
      const parents = allRows.filter(row => (
        row.artifactKey === source.artifactKey
        && row.version === source.version
        && row.contentHash === source.contentHash
        && row.controlEpoch < cursor.controlEpoch
      ))
      if (parents.length !== 1 || await verifiedPayload(parents[0]) == null) return null
      cursor = parents[0]
    }
    originEpochs.push(cursor.controlEpoch)
  }

  const newestRegressedOrigin = Math.max(...originEpochs)
  const passedAggregates = allRows.filter(row => (
    row.artifactKey === 'quality.adventure-review'
    && row.controlEpoch > newestRegressedOrigin
    && row.controlEpoch < input.failedControlEpoch
  )).sort((left, right) => right.controlEpoch - left.controlEpoch || right.version - left.version)
  for (const aggregate of passedAggregates) {
    if ((await verifiedPayload(aggregate))?.passed !== true) continue
    let completeBatchSet = true
    for (const artifactKey of TEXT_ADVENTURE_QUALITY_BATCH_ARTIFACT_KEYS_V1) {
      const candidates = allRows.filter(row => (
        row.artifactKey === artifactKey && row.controlEpoch === aggregate.controlEpoch
      ))
      if (candidates.length !== 1 || await verifiedPayload(candidates[0]) == null) {
        completeBatchSet = false
        break
      }
    }
    if (completeBatchSet) return aggregate.controlEpoch
  }
  return null
}

async function latestFailedTextAdventureQualityReviewV1(
  buildId: number,
  beforeControlEpoch: number,
): Promise<{ payload: Record<string, unknown>; controlEpoch: number } | null> {
  const rows = (await db.productBuildArtifacts.where('buildId').equals(buildId).toArray())
    .filter(row => row.artifactKey === 'quality.adventure-review'
      && row.controlEpoch < beforeControlEpoch && isSha256Hash(row.contentHash))
    .sort((left, right) => right.controlEpoch - left.controlEpoch || right.version - left.version)
  for (const row of rows) {
    const payload = parsedObject(row.payloadJson)
    if (payload.passed === false && await hashProductProductionValueV2(payload) === row.contentHash) {
      return { payload, controlEpoch: row.controlEpoch }
    }
  }
  return null
}

function qualityEvidenceRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap(item => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? [item as Record<string, unknown>] : []
  )) : []
}

function qualityEvidenceStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null
  const result = value as string[]
  return new Set(result).size === result.length ? result : null
}

function qualityReferenceEvidenceFromFrozenSourcesV1(
  sourcePayloadByKey: ReadonlyMap<string, Record<string, unknown>>,
): { index: TextAdventureQualityReferenceIndexV1; maximumLocationOrdinal: number } | null {
  const arc = sourcePayloadByKey.get('content.narrative-arc-plan')
  const narrative = sourcePayloadByKey.get('content.narrative')
  const mainQuest = sourcePayloadByKey.get('content.main-quest-plan')
  const architecture = sourcePayloadByKey.get('content.adventure-architecture')
  if (!arc || !narrative || !mainQuest || !architecture) return null
  const acts = qualityEvidenceRecords(arc.acts)
  const sceneRows = acts.flatMap(act => qualityEvidenceRecords(act.sceneCards))
  const decisionRows = qualityEvidenceRecords(arc.decisions)
  const endingRows = qualityEvidenceRecords(arc.endings)
  const choiceRows = qualityEvidenceRecords(narrative.choices)
  const entryNodeKey = typeof narrative.entryNodeKey === 'string' ? narrative.entryNodeKey : null
  const incomingChoiceKeysByNodeKey: Record<string, string[]> = {}
  const outgoingChoiceKeysByNodeKey: Record<string, string[]> = {}
  const choiceTargetByKey = new Map<string, string>()
  choiceRows.forEach(choice => {
    if (typeof choice.choiceKey !== 'string' || typeof choice.sourceNodeKey !== 'string'
      || typeof choice.targetNodeKey !== 'string') return
    ;(outgoingChoiceKeysByNodeKey[choice.sourceNodeKey] ??= []).push(choice.choiceKey)
    ;(incomingChoiceKeysByNodeKey[choice.targetNodeKey] ??= []).push(choice.choiceKey)
    choiceTargetByKey.set(choice.choiceKey, choice.targetNodeKey)
  })
  const reachableNodeKeys = new Set<string>()
  const pendingNodeKeys = entryNodeKey ? [entryNodeKey] : []
  while (pendingNodeKeys.length > 0) {
    const current = pendingNodeKeys.shift()!
    if (reachableNodeKeys.has(current)) continue
    reachableNodeKeys.add(current)
    for (const choiceKey of outgoingChoiceKeysByNodeKey[current] ?? []) {
      const target = choiceTargetByKey.get(choiceKey)
      if (target && !reachableNodeKeys.has(target)) pendingNodeKeys.push(target)
    }
  }
  const objectiveRows = qualityEvidenceRecords(mainQuest.quests)
    .flatMap(quest => qualityEvidenceRecords(quest.objectives))
  const locationCount = qualityEvidenceRecords(architecture.regions)
    .flatMap(region => qualityEvidenceRecords(region.areas))
    .flatMap(area => qualityEvidenceRecords(area.locations)).length
  const sceneKeys = sceneRows.flatMap(scene => typeof scene.key === 'string' ? [scene.key] : [])
  if (sceneKeys.length === 0 || new Set(sceneKeys).size !== sceneKeys.length) return null
  return {
    index: {
      decisionSceneByKey: Object.fromEntries(decisionRows.flatMap(decision => (
        typeof decision.key === 'string' && typeof decision.sceneKey === 'string'
          ? [[decision.key, decision.sceneKey]] : []
      ))),
      decisionOptionKeysByKey: Object.fromEntries(decisionRows.flatMap(decision => (
        typeof decision.key === 'string'
          ? [[decision.key, qualityEvidenceRecords(decision.options)
              .flatMap(option => typeof option.key === 'string' ? [option.key] : [])]]
          : []
      ))),
      optionKeys: decisionRows.flatMap(decision => qualityEvidenceRecords(decision.options))
        .flatMap(option => typeof option.key === 'string' ? [option.key] : []),
      choiceEdgeByKey: Object.fromEntries(choiceRows.flatMap(choice => (
        typeof choice.choiceKey === 'string' && typeof choice.sourceNodeKey === 'string'
          && typeof choice.targetNodeKey === 'string'
          ? [[choice.choiceKey, {
              sourceNodeKey: choice.sourceNodeKey,
              targetNodeKey: choice.targetNodeKey,
            }]] : []
      ))),
      sceneKeys,
      endingKeys: endingRows.flatMap(ending => (
        typeof ending.endingKey === 'string' ? [ending.endingKey] : []
      )),
      objectiveSceneByKey: Object.fromEntries(objectiveRows.flatMap(objective => (
        typeof objective.key === 'string' && Array.isArray(objective.sceneKeys)
          && typeof objective.sceneKeys[0] === 'string'
          ? [[objective.key, objective.sceneKeys[0]]] : []
      ))),
      objectiveAlternativeKeysByKey: Object.fromEntries(objectiveRows.flatMap(objective => (
        typeof objective.key === 'string'
          ? [[objective.key, qualityEvidenceRecords(objective.alternatives)
              .flatMap(alternative => typeof alternative.key === 'string' ? [alternative.key] : [])]]
          : []
      ))),
      alternativeKeys: objectiveRows.flatMap(objective => qualityEvidenceRecords(objective.alternatives))
        .flatMap(alternative => typeof alternative.key === 'string' ? [alternative.key] : []),
      entryNodeKey,
      incomingChoiceKeysByNodeKey,
      outgoingChoiceKeysByNodeKey,
      reachableNodeKeys: [...reachableNodeKeys],
      decisionOptionFactsByKey: Object.fromEntries(decisionRows.flatMap(decision => (
        typeof decision.key === 'string'
          ? [[decision.key, qualityEvidenceRecords(decision.options).flatMap(option => (
              typeof option.key === 'string' && typeof option.cost === 'string'
                && typeof option.persistentEffectKey === 'string'
                ? [{
                    optionKey: option.key,
                    choiceKey: outgoingChoiceKeysByNodeKey[
                      typeof decision.sceneKey === 'string' ? decision.sceneKey : ''
                    ]?.[qualityEvidenceRecords(decision.options).indexOf(option)] ?? null,
                    cost: option.cost,
                    persistentEffectKey: option.persistentEffectKey,
                    echoSceneKeys: qualityEvidenceStringArray(option.echoSceneKeys) ?? [],
                  }]
                : []
            ))]]
          : []
      ))),
      beatFactsByKey: textAdventureQualityBeatFactsV1(narrative),
    },
    maximumLocationOrdinal: locationCount,
  }
}

function qualityBatchCoverageFromFrozenSourcesV1(input: {
  scope: TextAdventureQualityReviewScopeV1
  frozenSceneKeys: readonly string[]
  sourcePayloadByKey: ReadonlyMap<string, Record<string, unknown>>
}): TextAdventureQualityReviewBatchCoverageV1 | null {
  const arc = input.sourcePayloadByKey.get('content.narrative-arc-plan')
  const narrative = input.sourcePayloadByKey.get('content.narrative')
  const mainQuest = input.sourcePayloadByKey.get('content.main-quest-plan')
  if (!arc || !narrative || !mainQuest) return null
  const acts = qualityEvidenceRecords(arc.acts)
  const actIndex = input.scope === 'structure' ? null : Number(input.scope.slice('act-'.length)) - 1
  const allSceneKeys = acts.flatMap(act => qualityEvidenceRecords(act.sceneCards))
    .flatMap(scene => typeof scene.key === 'string' ? [scene.key] : [])
  const expectedSceneKeys = (actIndex == null ? acts : acts[actIndex] ? [acts[actIndex]] : [])
    .flatMap(act => qualityEvidenceRecords(act.sceneCards))
    .flatMap(scene => typeof scene.key === 'string' ? [scene.key] : [])
  if (expectedSceneKeys.length !== input.frozenSceneKeys.length
    || expectedSceneKeys.some((key, index) => key !== input.frozenSceneKeys[index])) return null
  const ownedSceneKeys = new Set(input.frozenSceneKeys)
  const endingKeys = qualityEvidenceRecords(arc.endings)
    .flatMap(ending => typeof ending.endingKey === 'string' ? [ending.endingKey] : [])
  const decisionRows = qualityEvidenceRecords(arc.decisions)
  const ownedDecisionRows = input.scope === 'structure' ? decisionRows : decisionRows.filter(decision => (
    typeof decision.sceneKey === 'string' && ownedSceneKeys.has(decision.sceneKey)
  ))
  const decisionEchoSceneKeysByKey = Object.fromEntries(decisionRows.flatMap(decision => (
    typeof decision.key === 'string'
      ? [[decision.key, qualityEvidenceRecords(decision.options).flatMap(option => (
          qualityEvidenceStringArray(option.echoSceneKeys) ?? []
        ))]] : []
  )))
  const optionRows = decisionRows.flatMap(decision => qualityEvidenceRecords(decision.options))
  const optionEchoSceneKeysByKey = Object.fromEntries(optionRows.flatMap(option => (
    typeof option.key === 'string'
      ? [[option.key, qualityEvidenceStringArray(option.echoSceneKeys) ?? []]] : []
  )))
  const ownedOptionKeys = ownedDecisionRows.flatMap(decision => qualityEvidenceRecords(decision.options))
    .flatMap(option => typeof option.key === 'string' ? [option.key] : [])
  const choiceRows = qualityEvidenceRecords(narrative.choices)
  const choiceTargetByKey = Object.fromEntries(choiceRows.flatMap(choice => (
    typeof choice.choiceKey === 'string' && typeof choice.targetNodeKey === 'string'
      ? [[choice.choiceKey, choice.targetNodeKey]] : []
  )))
  const ownedChoiceKeys = choiceRows.filter(choice => (
    input.scope === 'structure'
      || (typeof choice.sourceNodeKey === 'string' && ownedSceneKeys.has(choice.sourceNodeKey))
  )).flatMap(choice => typeof choice.choiceKey === 'string' ? [choice.choiceKey] : [])
  const objectiveRows = qualityEvidenceRecords(mainQuest.quests)
    .flatMap(quest => qualityEvidenceRecords(quest.objectives))
  const ownedObjectiveRows = input.scope === 'structure' ? objectiveRows : objectiveRows.filter(objective => (
    (qualityEvidenceStringArray(objective.sceneKeys) ?? []).some(sceneKey => ownedSceneKeys.has(sceneKey))
  ))
  const objectiveKeys = objectiveRows.flatMap(objective => (
    typeof objective.key === 'string' ? [objective.key] : []
  ))
  const alternativeKeys = objectiveRows.flatMap(objective => qualityEvidenceRecords(objective.alternatives))
    .flatMap(alternative => typeof alternative.key === 'string' ? [alternative.key] : [])
  const ownedAlternativeKeys = ownedObjectiveRows
    .flatMap(objective => qualityEvidenceRecords(objective.alternatives))
    .flatMap(alternative => typeof alternative.key === 'string' ? [alternative.key] : [])
  const supplementalCoverage = (artifactKey: string) => {
    const bundle = input.sourcePayloadByKey.get(artifactKey)
    const entries = bundle ? qualityEvidenceRecords(bundle.entries) : []
    const ownedEntries = actIndex == null
      ? entries : entries.filter((_, index) => index % 3 === actIndex)
    const entryKeys = (values: readonly Record<string, unknown>[]) => values.flatMap(entry => (
      typeof entry.key === 'string' ? [entry.key] : []
    ))
    const stageKeys = (values: readonly Record<string, unknown>[]) => values
      .flatMap(entry => qualityEvidenceRecords(entry.stages))
      .flatMap(stage => typeof stage.key === 'string' ? [stage.key] : [])
    return {
      allEntryKeys: entryKeys(entries),
      ownedEntryKeys: entryKeys(ownedEntries),
      allStageKeys: stageKeys(entries),
      ownedStageKeys: stageKeys(ownedEntries),
    }
  }
  const sideQuests = supplementalCoverage('content.adventure-side-quests')
  const ambientEvents = supplementalCoverage('content.adventure-ambient-events')
  return {
    scope: input.scope,
    supplementalAssignmentRule: 'bundle-entry-index-modulo-three',
    allSceneKeys,
    sceneKeys: [...input.frozenSceneKeys],
    allEndingKeys: endingKeys,
    endingKeys: input.scope === 'structure' || actIndex === 2 ? endingKeys : [],
    ownedChoiceKeys,
    choiceTargetByKey,
    ownedDecisionKeys: ownedDecisionRows.flatMap(decision => (
      typeof decision.key === 'string' ? [decision.key] : []
    )),
    decisionEchoSceneKeysByKey,
    ownedOptionKeys,
    optionEchoSceneKeysByKey,
    objectiveKeys,
    ownedObjectiveKeys: ownedObjectiveRows.flatMap(objective => (
      typeof objective.key === 'string' ? [objective.key] : []
    )),
    alternativeKeys,
    ownedAlternativeKeys,
    allSupplementalEntryKeys: [...sideQuests.allEntryKeys, ...ambientEvents.allEntryKeys],
    ownedSupplementalEntryKeys: [...sideQuests.ownedEntryKeys, ...ambientEvents.ownedEntryKeys],
    allSupplementalStageKeys: [...sideQuests.allStageKeys, ...ambientEvents.allStageKeys],
    ownedSupplementalStageKeys: [...sideQuests.ownedStageKeys, ...ambientEvents.ownedStageKeys],
  }
}

async function frozenTextAdventureQualityReviewEvidenceV1(input: {
  allRows: readonly ProductBuildArtifactRecordV1[]
  reviewControlEpoch: number
}): Promise<{
  reference: { index: TextAdventureQualityReferenceIndexV1; maximumLocationOrdinal: number }
  batches: Array<{
    issues: unknown
    coverage: TextAdventureQualityReviewBatchCoverageV1
  }>
} | null> {
  const sourceHashes = new Map<string, string>()
  let frozenSourceSignature: string | null = null
  const batches: Array<{
    scope: TextAdventureQualityReviewScopeV1
    issues: unknown
    frozenSceneKeys: string[]
  }> = []
  for (const scope of TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1) {
    const artifactKey = textAdventureQualityReviewBatchArtifactKeyV1(scope)
    const candidates = input.allRows.filter(row => (
      row.artifactKey === artifactKey && row.controlEpoch === input.reviewControlEpoch
        && isSha256Hash(row.contentHash)
    ))
    const verified: Array<{ row: ProductBuildArtifactRecordV1; payload: Record<string, unknown> }> = []
    for (const row of candidates) {
      const payload = parsedObject(row.payloadJson)
      if (await hashProductProductionValueV2(payload) === row.contentHash) verified.push({ row, payload })
    }
    if (verified.length !== 1) return null
    let parsedBatch
    try { parsedBatch = parseTextAdventureQualityReviewBatchArtifactV1(verified[0].payload, scope) } catch { return null }
    const quality = parsedObject(verified[0].row.qualityJson)
    const coverage = quality.coverage && typeof quality.coverage === 'object'
      && !Array.isArray(quality.coverage) ? quality.coverage as Record<string, unknown> : null
    if (!coverage || coverage.scope !== scope) return null
    const frozenSceneKeys = qualityEvidenceStringArray(coverage.sceneKeys)
    const frozenSources = qualityEvidenceRecords(coverage.sourceHashes)
    if (!frozenSceneKeys || frozenSources.length === 0) return null
    const seenInBatch = new Set<string>()
    const batchSources: Array<{ artifactKey: string; contentHash: string }> = []
    for (const source of frozenSources) {
      if (typeof source.artifactKey !== 'string' || !isSha256Hash(source.contentHash)
        || seenInBatch.has(source.artifactKey)) return null
      seenInBatch.add(source.artifactKey)
      batchSources.push({ artifactKey: source.artifactKey, contentHash: source.contentHash })
      const priorHash = sourceHashes.get(source.artifactKey)
      if (priorHash != null && priorHash !== source.contentHash) return null
      sourceHashes.set(source.artifactKey, source.contentHash)
    }
    const signature = canonicalProductProductionJsonV2(
      batchSources.sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)),
    )
    if (frozenSourceSignature != null && signature !== frozenSourceSignature) return null
    frozenSourceSignature = signature
    batches.push({ scope, issues: parsedBatch.issues, frozenSceneKeys })
  }
  const sourcePayloadByKey = new Map<string, Record<string, unknown>>()
  for (const [artifactKey, contentHash] of sourceHashes) {
    const candidates = input.allRows.filter(row => (
      row.artifactKey === artifactKey && row.controlEpoch === input.reviewControlEpoch
        && row.contentHash === contentHash
    ))
    const verified: Record<string, unknown>[] = []
    for (const row of candidates) {
      const payload = parsedObject(row.payloadJson)
      if (await hashProductProductionValueV2(payload) === row.contentHash) verified.push(payload)
    }
    // Frozen coverage is an exact review input manifest. Missing or ambiguous
    // rows must stop recovery rather than inviting a nearest-epoch guess.
    if (verified.length !== 1) return null
    sourcePayloadByKey.set(artifactKey, verified[0])
  }
  const reference = qualityReferenceEvidenceFromFrozenSourcesV1(sourcePayloadByKey)
  if (!reference) return null
  const reconstructedBatches = batches.flatMap(batch => {
    const coverage = qualityBatchCoverageFromFrozenSourcesV1({
      scope: batch.scope,
      frozenSceneKeys: batch.frozenSceneKeys,
      sourcePayloadByKey,
    })
    return coverage ? [{ issues: batch.issues, coverage }] : []
  })
  return reconstructedBatches.length === batches.length
    ? { reference, batches: reconstructedBatches } : null
}

export async function invalidTextAdventureQualityReviewRollbackEpochV1(input: {
  buildId: number
  beforeControlEpoch: number
}): Promise<number | null> {
  const allRows = await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray()
  const rows = allRows.filter(row => row.artifactKey === 'quality.adventure-review'
      && row.controlEpoch < input.beforeControlEpoch && isSha256Hash(row.contentHash))
    .sort((left, right) => right.controlEpoch - left.controlEpoch || right.version - left.version)
  // The recovery transition intentionally invalidates old versions. That must
  // not erase evidence that the transition itself was founded on an invalid
  // reviewer response. A later cryptographically valid review supersedes it.
  for (const row of rows) {
    const payload = parsedObject(row.payloadJson)
    if (await hashProductProductionValueV2(payload) !== row.contentHash) continue
    if (payload.passed !== false) return null
    // A bad review can itself be carried through one or more recovery epochs.
    // The carrying epoch may already contain an accidental mix of regenerated
    // ancestors and old descendants, so follow the immutable provenance chain
    // back to the review's original production epoch.
    let origin = row
    const visited = new Set<string>()
    while (origin.carriedFrom) {
      const identity = `${origin.version}:${origin.contentHash}`
      if (visited.has(identity)) return null
      visited.add(identity)
      const parents = rows.filter(candidate => (
        candidate.version === origin.carriedFrom!.version
        && candidate.artifactKey === origin.carriedFrom!.artifactKey
        && candidate.contentHash === origin.carriedFrom!.contentHash
        && candidate.controlEpoch < origin.controlEpoch
      ))
      if (parents.length !== 1) return null
      const parentPayload = parsedObject(parents[0].payloadJson)
      if (await hashProductProductionValueV2(parentPayload) !== parents[0].contentHash) return null
      origin = parents[0]
    }
    const originPayload = parsedObject(origin.payloadJson)
    const frozenEvidence = await frozenTextAdventureQualityReviewEvidenceV1({
      allRows,
      reviewControlEpoch: origin.controlEpoch,
    })
    const authorityInvalid = textAdventureQualityReviewAuthorityViolationsV1(
      originPayload.issues,
      frozenEvidence?.reference.maximumLocationOrdinal,
    ).length > 0
    const scopeInvalid = textAdventureQualityReviewScopeViolationsV1(originPayload.issues).length > 0
    const referenceInvalid = frozenEvidence != null
      && textAdventureQualityReviewReferenceViolationsV1(
        originPayload.issues,
        frozenEvidence.reference.index,
      ).length > 0
    const batchCoverageInvalid = frozenEvidence != null && frozenEvidence.batches.some(batch => (
      textAdventureQualityReviewBatchCoverageViolationsV1(batch.issues, batch.coverage).length > 0
    ))
    const factualInvalid = frozenEvidence != null && Array.isArray(originPayload.issues)
      && originPayload.issues.some(value => (
        value && typeof value === 'object' && !Array.isArray(value)
          && textAdventureQualityReviewFactualContradictionV1(
            value as Record<string, unknown>, frozenEvidence.reference.index,
          ) != null
      ))
    if (!authorityInvalid && !scopeInvalid && !referenceInvalid && !batchCoverageInvalid
      && !factualInvalid) return null
    return origin.controlEpoch
  }
  return null
}

/**
 * Proves that the current epoch was already materialized from an invalid
 * review's exact origin. Without this guard, a later provider interruption
 * would rediscover the same historical review and rewind the Build again.
 */
export async function textAdventureQualityRollbackAlreadyAppliedV1(input: {
  buildId: number
  currentControlEpoch: number
  originControlEpoch: number
}): Promise<boolean> {
  if (!Number.isInteger(input.currentControlEpoch)
    || !Number.isInteger(input.originControlEpoch)
    || input.originControlEpoch < 0
    || input.currentControlEpoch <= input.originControlEpoch) return false
  const rows = await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray()
  const currentCarries = rows.filter(row => (
    row.controlEpoch === input.currentControlEpoch
    && row.status === 'carried-forward'
    && row.carriedFrom != null
    && !row.artifactKey.startsWith('quality.adventure-review')
    && isSha256Hash(row.contentHash)
  ))
  return currentCarries.some(current => {
    let cursor = current
    const visited = new Set<number>()
    while (cursor.controlEpoch > input.originControlEpoch) {
      if (cursor.id == null || visited.has(cursor.id) || cursor.carriedFrom == null) return false
      visited.add(cursor.id)
      const parents = rows.filter(parent => (
        parent.artifactKey === cursor.artifactKey
        && parent.version === cursor.carriedFrom!.version
        && parent.contentHash === cursor.carriedFrom!.contentHash
        && parent.controlEpoch < cursor.controlEpoch
        && isSha256Hash(parent.contentHash)
      ))
      if (parents.length !== 1) return false
      cursor = parents[0]
    }
    return cursor.controlEpoch === input.originControlEpoch
      && cursor.contentHash === current.contentHash
  })
}

/**
 * A deterministic integration blocker can prove that an accepted model
 * artifact is unsuitable. Recovery must invalidate that artifact and every
 * non-deterministic descendant, otherwise a new epoch would faithfully carry
 * the failed evidence forward and reproduce the same blocker forever.
 */
export async function recoveryInvalidatedTaskKeys(input: {
  buildId: number
  failureJson: string
  previousControlEpoch: number
  plan: ProductProductionPlanV3
}): Promise<Set<string>> {
  if (input.plan.productType !== 'text-adventure') return new Set()
  const recovery = parsedObject(input.failureJson)
  const recoveryResolution = recovery.resolution && typeof recovery.resolution === 'object'
    && !Array.isArray(recovery.resolution)
    ? recovery.resolution as Record<string, unknown> : null
  const previousFailure = recovery.previousFailure && typeof recovery.previousFailure === 'object'
    && !Array.isArray(recovery.previousFailure)
    ? recovery.previousFailure as Record<string, unknown> : null
  if (recovery.blockerKey === 'media.anchor-author-gate'
    && recoveryResolution?.action === 'confirm-character-anchors') {
    // Re-run the gate itself so the new author resolution, rather than a
    // carried historical decision, binds the current confirmation hash.
    // Downstream images remain reusable and append-only narrative repair
    // history must not become an unrelated invalidation root.
    return new Set(['media.anchor-author-gate'])
  }
  if (previousFailure
    && typeof previousFailure.taskKey === 'string'
    && (/^media\.visual\.\d{3}$/.test(previousFailure.taskKey)
      || previousFailure.taskKey === 'integration.package')
    && typeof previousFailure.detail === 'string'
    && previousFailure.detail.includes('mediaAnchorDecision schema/version/hash 无效')) {
    // A carried author decision cannot authorize a changed visual bible. Go
    // back only to the deterministic confirmation gate; do not regenerate
    // prose or images until a fresh decision binds the current hash.
    return new Set(['media.anchor-author-gate'])
  }
  if (recovery.blockerKey === 'content.source-sufficiency'
    && recoveryResolution?.action === 'retry'
    && previousFailure?.taskKey === 'source.author-gate') {
    // The author is challenging the model review, not accepting its proposed
    // source additions. Re-run the source editor and invalidate every
    // descendant; never carry the disputed audit into the new epoch.
    const invalidated = new Set<string>(['content.source-sufficiency'])
    let expanded = true
    while (expanded) {
      expanded = false
      for (const task of input.plan.tasks) {
        if (invalidated.has(task.taskKey) || !task.dependsOn.some(key => invalidated.has(key))) continue
        invalidated.add(task.taskKey)
        expanded = true
      }
    }
    return invalidated
  }
  const recordedFailureDetails = [recovery, previousFailure]
    .flatMap(value => value && typeof value.detail === 'string' ? [value.detail] : [])
  if (recovery.blockerKey === 'content.quest-script.supplemental'
    && recordedFailureDetails.some(detail => detail.includes('abilityKey 未闭合系统与任务设计'))) {
    // The strict Quest Scripter parser has proven that accepted side/ambient
    // plans referenced abilities outside the frozen systems registry. Repair
    // must return to both owning specialist tasks; changing the downstream
    // script would otherwise hide a broken upstream contract.
    const invalidated = new Set<string>([
      'content.adventure-side-quests', 'content.adventure-ambient-events',
    ])
    let expanded = true
    while (expanded) {
      expanded = false
      for (const task of input.plan.tasks) {
        if (invalidated.has(task.taskKey) || !task.dependsOn.some(key => invalidated.has(key))) continue
        invalidated.add(task.taskKey)
        expanded = true
      }
    }
    return invalidated
  }
  const acceptedArtifactKeys = new Set((await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray())
    .filter(row => row.controlEpoch === input.previousControlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
    .map(row => row.artifactKey))
  const currentEpochHasPassedQuality = await passedTextAdventureQualityReviewAtEpochV1({
    buildId: input.buildId, controlEpoch: input.previousControlEpoch,
  })
  const activeQualityRepairCause = currentEpochHasPassedQuality
    ? null : activeTextAdventureQualityRepairCauseV1(input.failureJson)
  const qualityRepairRecovery = activeQualityRepairCause
    ?? (!currentEpochHasPassedQuality
      && legacyPausedTextAdventureQualityRecoveryV1(input.failureJson) ? recovery : null)
  const failedQualityReview = qualityRepairRecovery
    ? await latestFailedTextAdventureQualityReviewV1(input.buildId, input.plan.controlEpoch)
    : null
  const preserveFrozenMedia = textAdventureNarrativeRepairPreservesFrozenMediaV1(
    failedQualityReview?.payload.issues,
  )
  const sceneScriptPartKeys = (taskKey: string) => {
    const match = /^content\.scene-script\.act-([1-3])$/.exec(taskKey)
    if (!match) return [taskKey]
    return input.plan.tasks
      .filter(task => task.taskKey.startsWith(`content.scene-script.act-${match[1]}.part-`))
      .map(task => task.taskKey)
      .concat(taskKey)
  }
  const narrativeIntegrationOwnerTaskKeys = input.plan.tasks
    .filter(task => /^content\.(?:scene-script\.act-[1-3](?:\.part-\d+)?|dialogue-pass\.act-[1-3])$/.test(task.taskKey))
    .map(task => task.taskKey)
  const dialoguePassTaskKeys = [
    'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3',
  ]
  const mainQuestScriptPartTaskKeys = input.plan.tasks
    .filter(task => /^content\.quest-script\.main\.act-[1-3]\.(?:single|multi)$/.test(task.taskKey))
    .map(task => task.taskKey)
  const supplementalQuestScriptTaskKey = input.plan.tasks.some(task => (
    task.taskKey === 'content.quest-script.supplemental'
  )) ? 'content.quest-script.supplemental' : null
  const visualReviewBatchTaskKeys = input.plan.tasks
    .filter(task => /^media\.visual-quality-review\.batch-\d+$/.test(task.taskKey))
    .map(task => task.taskKey)
  const directlyResolvedFailureDetail = previousFailure && typeof previousFailure.detail === 'string'
    ? previousFailure.detail : ''
  const exactFailedDialoguePassTaskKey = directlyResolvedFailureDetail
    .match(/content\.dialogue-pass\.act-[1-3]/)?.[0] ?? null
  const failedMediaArtifactTaskKeys = [...new Set(
    directlyResolvedFailureDetail.match(/media\.visual\.\d{3}/g) ?? [],
  )].filter(taskKey => input.plan.tasks.some(task => task.taskKey === taskKey))
  const mediaAuditFailureSegments = directlyResolvedFailureDetail.includes('需求—图片 Artifact 审计失败:')
    ? directlyResolvedFailureDetail.slice(
        directlyResolvedFailureDetail.indexOf('需求—图片 Artifact 审计失败:')
          + '需求—图片 Artifact 审计失败:'.length,
      ).split(';')
    : []
  const mediaAuditRequiresRevalidationOnly = mediaAuditFailureSegments.length > 0
    && mediaAuditFailureSegments.every(segment => /^media\.visual\.\d{3}:request$/.test(segment.trim()))
  const narrativeArcFailureOwnerTaskKeys = () => {
    const owners: string[] = []
    if (/sceneCards|acts|locationOrdinal|冻结地点|场景/.test(directlyResolvedFailureDetail)) {
      owners.push('content.narrative-arc-scenes')
    }
    if (/decisions|decision\.|选择计划/.test(directlyResolvedFailureDetail)) {
      owners.push('content.narrative-decision-plan')
    }
    return owners.length > 0
      ? owners
      : ['content.narrative-arc-scenes', 'content.narrative-decision-plan']
  }
  const questScriptFailureOwnerTaskKeys = () => {
    // The deterministic assembler proves that one of its model-owned parts is
    // stale against a newly regenerated quest plan. Re-running only the
    // assembler would carry the same obsolete part forever.
    if (/questScript\.(?:sideQuestScripts|ambientEventScripts)|未知任务条目|未知阶段|未精确覆盖任务(?:条目|阶段)|补充任务/i.test(
      directlyResolvedFailureDetail,
    )) {
      return supplementalQuestScriptTaskKey ? [supplementalQuestScriptTaskKey] : []
    }
    if (/mainObjectiveScripts|未知目标|未精确覆盖(?:主线目标|目标解法)|主线(?:目标|解法)|objectiveKey|alternativeKey/i.test(
      directlyResolvedFailureDetail,
    )) {
      return mainQuestScriptPartTaskKeys
    }
    return [
      ...mainQuestScriptPartTaskKeys,
      ...(supplementalQuestScriptTaskKey ? [supplementalQuestScriptTaskKey] : []),
    ]
  }
  const expandFailureOwnerTaskKeys = (taskKey: string) => (
    taskKey === 'integration.narrative'
      ? exactFailedDialoguePassTaskKey
        ? [exactFailedDialoguePassTaskKey]
        : narrativeIntegrationOwnerTaskKeys
      : taskKey === 'content.narrative-arc-plan'
        ? narrativeArcFailureOwnerTaskKeys()
      : taskKey === 'content.quest-script'
        ? questScriptFailureOwnerTaskKeys()
      : /^content\.scene-script\.act-[1-3]$/.test(taskKey)
        && directlyResolvedFailureDetail.includes('跨场景 beatKey 重复')
        ? [taskKey]
      : taskKey === 'media.audit'
        ? mediaAuditRequiresRevalidationOnly
          ? ['media.audit']
          : failedMediaArtifactTaskKeys.length > 0
          ? failedMediaArtifactTaskKeys
          : input.plan.tasks
            .filter(task => /^media\.visual\.\d{3}$/.test(task.taskKey))
            .map(task => task.taskKey)
      : taskKey === 'media.visual-quality-review'
        ? visualReviewBatchTaskKeys
      : taskKey === 'content.adventure-quality-review'
        ? [...textAdventureQualityReviewRerunTaskKeysV1(input.plan)]
      : sceneScriptPartKeys(taskKey)
  )
  const directlyResolvedFailureTaskKey = previousFailure
    && typeof previousFailure.taskKey === 'string'
    && (previousFailure.taskKey.startsWith('content.')
      || previousFailure.taskKey === 'integration.narrative'
      || previousFailure.taskKey === 'integration.package'
      || previousFailure.taskKey === 'media.requirements'
      || previousFailure.taskKey === 'media.audit'
      || previousFailure.taskKey.startsWith('media.visual-quality-review'))
    ? previousFailure.taskKey : null
  // A resolve-blocker envelope names the current failure in previousFailure.
  // Prefer that root over append-only diagnostic history; otherwise an older,
  // already repaired failure can rewind unrelated acts in every later epoch.
  const siblingActAssemblyFailureTaskKeys = directlyResolvedFailureTaskKey
    && /^content\.scene-script\.act-[1-3]$/.test(directlyResolvedFailureTaskKey)
    ? [...textAdventureTaskFailures(input.failureJson).keys()].filter(taskKey => (
        /^content\.scene-script\.act-[1-3]$/.test(taskKey)
      ))
    : []
  const unresolvedFailureTaskKeys = (directlyResolvedFailureTaskKey
    ? [...new Set([directlyResolvedFailureTaskKey, ...siblingActAssemblyFailureTaskKeys])]
    : [...textAdventureTaskFailures(input.failureJson).keys()])
    .filter(taskKey => {
      // `integration.package` is the deterministic messenger for a failed
      // narrative review.  When the signed review is available, route repair
      // from its issue ownership instead of treating package assembly as an
      // opaque integration failure and rewinding every narrative specialist.
      if (taskKey === 'integration.package' && qualityRepairRecovery && failedQualityReview) return false
      // A later review-batch protocol failure (including an unknown provider
      // result after browser/HMR interruption) does not supersede the signed,
      // substantive quality report that authorized this repair epoch. Route
      // from the frozen blocking issues first; otherwise the scheduler merely
      // re-runs reviewers against unchanged prose forever.
      if (qualityRepairRecovery && failedQualityReview
        && /^content\.adventure-quality-review(?:\.|$)/.test(taskKey)) return false
      // A blocker the author just resolved is the authoritative current
      // failure even when an older artifact with the same output key was
      // carried into the previous epoch. Historical acceptance cannot prove
      // that the current deterministic revalidation succeeded.
      if (taskKey === directlyResolvedFailureTaskKey) return true
      if (taskKey === 'integration.narrative') return true
      const task = input.plan.tasks.find(candidate => candidate.taskKey === taskKey)
      return task && !task.outputArtifactKeys.every(artifactKey => acceptedArtifactKeys.has(artifactKey))
    })
  if (unresolvedFailureTaskKeys.length > 0) {
    // Integration and act-level assembly failures prove that one or more
    // upstream specialist artifacts are stale. Rewind to the owning scene and
    // dialogue tasks before walking descendants; invalidating only the
    // deterministic integration task would carry the same bad inputs forever.
    const invalidated = new Set(unresolvedFailureTaskKeys.flatMap(expandFailureOwnerTaskKeys))
    let expanded = true
    while (expanded) {
      expanded = false
      for (const task of input.plan.tasks) {
        if (invalidated.has(task.taskKey) || !task.dependsOn.some(key => invalidated.has(key))) continue
        if (preserveFrozenMedia && task.taskKey === 'media.requirements') continue
        invalidated.add(task.taskKey)
        expanded = true
      }
    }
    return invalidated
  }
  if (!qualityRepairRecovery || !failedQualityReview) return new Set()
  const reviewPayload = failedQualityReview.payload
  const taskByArtifactKey = new Map(input.plan.tasks.flatMap(task => (
    task.outputArtifactKeys.map(artifactKey => [artifactKey, task.taskKey] as const)
  )))
  const reviewEvidenceInvalid = textAdventureQualityReviewAuthorityViolationsV1(
    reviewPayload.issues,
  ).length > 0 || textAdventureQualityReviewScopeViolationsV1(reviewPayload.issues).length > 0
  const reviewedEvidenceRows = (await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray())
    .filter(row => (row.artifactKey === 'content.narrative-arc-plan'
      || row.artifactKey === 'content.narrative'
      || row.artifactKey === 'content.cast-bible'
      || row.artifactKey === 'content.adventure-architecture')
      && row.controlEpoch <= failedQualityReview.controlEpoch
      && isSha256Hash(row.contentHash))
    .sort((left, right) => right.controlEpoch - left.controlEpoch || right.version - left.version)
  const reviewedEvidence = (artifactKey: string) => reviewedEvidenceRows
    .find(row => row.artifactKey === artifactKey)
  const reviewedArcPlanRow = reviewedEvidence('content.narrative-arc-plan')
  const reviewedNarrativeRow = reviewedEvidence('content.narrative')
  const reviewedCastRow = reviewedEvidence('content.cast-bible')
  const reviewedArchitectureRow = reviewedEvidence('content.adventure-architecture')
  const reviewedMainQuestPlanRow = reviewedEvidence('content.main-quest-plan')
  const reviewedArcPlan = reviewedArcPlanRow ? parsedObject(reviewedArcPlanRow.payloadJson) : null
  const reviewedNarrative = reviewedNarrativeRow ? parsedObject(reviewedNarrativeRow.payloadJson) : null
  const reviewedCast = reviewedCastRow ? parsedObject(reviewedCastRow.payloadJson) : null
  const reviewedArchitecture = reviewedArchitectureRow
    ? parsedObject(reviewedArchitectureRow.payloadJson) : null
  const reviewedMainQuestPlan = reviewedMainQuestPlanRow
    ? parsedObject(reviewedMainQuestPlanRow.payloadJson) : null
  const reviewedLocationTitles = (Array.isArray(reviewedArchitecture?.regions)
    ? reviewedArchitecture.regions : []).flatMap(regionValue => {
    if (!regionValue || typeof regionValue !== 'object' || Array.isArray(regionValue)) return []
    const region = regionValue as Record<string, unknown>
    return (Array.isArray(region.areas) ? region.areas : []).flatMap(areaValue => {
      if (!areaValue || typeof areaValue !== 'object' || Array.isArray(areaValue)) return []
      const area = areaValue as Record<string, unknown>
      return (Array.isArray(area.locations) ? area.locations : []).flatMap(locationValue => {
        if (!locationValue || typeof locationValue !== 'object' || Array.isArray(locationValue)) return []
        const title = (locationValue as Record<string, unknown>).title
        return typeof title === 'string' ? [title] : []
      })
    })
  })
  const providerBlockingIssues = !reviewEvidenceInvalid && Array.isArray(reviewPayload.issues)
    ? reviewPayload.issues.flatMap(value => {
        const issue = value && typeof value === 'object' && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        return issue.severity === 'blocking'
          && typeof issue.artifactKey === 'string'
          && !isTextAdventureRecomputedQualityIssueV1(issue)
          && !textAdventureQualityIssueSupersededByCompiledEchoV1(issue, reviewedArcPlan)
          && textAdventureQualityIssueFrozenBeatContradictionV1(issue, reviewedNarrative) == null
          ? [issue] : []
      })
    : []
  const blockingIssues = [...new Map([
    ...providerBlockingIssues,
    ...textAdventurePlayerPerspectiveIssuesV1(
      reviewedNarrative,
      reviewedCast,
      reviewedArchitecture,
    ),
    ...textAdventureUnauthorizedKinshipIssuesV1(reviewedNarrative, reviewedCast),
    ...textAdventureDialogueAttributionIssuesV1(reviewedNarrative, reviewedCast),
    ...textAdventureSceneSpeakerAuthorityIssuesV1(reviewedNarrative, reviewedArcPlan, reviewedCast),
    ...textAdventureQuestLocationAuthorityIssuesV1(reviewedMainQuestPlan, reviewedLocationTitles),
  ].map(issue => [
    `${issue.artifactKey}\n${issue.detail}\n${issue.recommendation}`, issue,
  ] as const)).values()]
  const sceneScriptTaskKeys = [
    'content.scene-script.act-1', 'content.scene-script.act-2', 'content.scene-script.act-3',
  ]
  const questScriptTaskKeys = input.plan.tasks
    .filter(task => /^content\.quest-script\.(?:main\.act-[1-3]\.(?:single|multi)|supplemental)$/.test(task.taskKey))
    .map(task => task.taskKey)
  const scenePartTaskKeys = input.plan.tasks
    .map(task => task.taskKey)
    .filter(taskKey => /^content\.scene-script\.act-[1-3]\.part-\d+$/.test(taskKey))
  const repairPartTaskKeys = new Set([...scenePartTaskKeys, ...questScriptTaskKeys])
  const repairArtifactRows = (await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray())
    .filter(row => repairPartTaskKeys.has(row.artifactKey)
      && row.controlEpoch <= input.previousControlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'
        // Later recovery epochs invalidate the source rows, but the signed
        // failed review still proves the exact epoch and hashes it inspected.
        // Re-open only that one review epoch for stable-key owner routing;
        // never select a nearest arbitrary invalid version.
        || (row.status === 'invalid'
          && row.controlEpoch === failedQualityReview.controlEpoch))
      && isSha256Hash(row.contentHash))
    .sort((left, right) => right.controlEpoch - left.controlEpoch || right.version - left.version)
  const latestRepairPartPayloads = new Map<string, Record<string, unknown>>()
  for (const row of repairArtifactRows) {
    if (!latestRepairPartPayloads.has(row.artifactKey)) {
      latestRepairPartPayloads.set(row.artifactKey, parsedObject(row.payloadJson))
    }
  }
  const knownScenePartChoiceKeys = new Set([...latestRepairPartPayloads].flatMap(([taskKey, payload]) => (
    scenePartTaskKeys.includes(taskKey) && Array.isArray(payload.choices)
      ? payload.choices.flatMap(value => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return []
          const choiceKey = (value as Record<string, unknown>).choiceKey
          return typeof choiceKey === 'string' ? [choiceKey] : []
        }) : []
  )))
  const knownScenePartSceneKeys = new Set([...latestRepairPartPayloads].flatMap(([taskKey, payload]) => (
    scenePartTaskKeys.includes(taskKey) && Array.isArray(payload.scenes)
      ? payload.scenes.flatMap(value => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return []
          const sceneKey = (value as Record<string, unknown>).sceneKey
          return typeof sceneKey === 'string' ? [sceneKey] : []
      }) : []
  )))
  const knownScenePartEndingKeys = new Set([...latestRepairPartPayloads].flatMap(([taskKey, payload]) => (
    scenePartTaskKeys.includes(taskKey) && Array.isArray(payload.endings)
      ? payload.endings.flatMap(value => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return []
          const endingKey = (value as Record<string, unknown>).endingKey
          return typeof endingKey === 'string' ? [endingKey] : []
        }) : []
  )))
  const knownQuestScriptStableKeys = new Set([...latestRepairPartPayloads].flatMap(([taskKey, payload]) => (
    questScriptTaskKeys.includes(taskKey)
      ? [...JSON.stringify(payload).matchAll(
          /"(?:objectiveKey|alternativeKey|entryKey|stageKey)":"((?:objective|alternative|entry|stage)\.[A-Za-z0-9._:-]+)"/g,
        )].map(match => match[1])
      : []
  )))
  const resolvedStableKeys = (
    evidence: string,
    pattern: RegExp,
    known: ReadonlySet<string>,
  ): Set<string> => {
    const knownByLength = [...known].sort((left, right) => right.length - left.length)
    return new Set((evidence.match(pattern) ?? []).flatMap(raw => {
      const normalized = normalizeTextAdventureQualityStableReferenceV1(raw, known)
      if (known.has(normalized)) return [normalized]
      const owner = knownByLength.find(key => normalized.startsWith(`${key}.`))
      return owner ? [owner] : []
    }))
  }
  const scenePartOwnersForIssue = (issue: Record<string, unknown>): string[] => {
    const evidence = `${typeof issue.detail === 'string' ? issue.detail : ''}\n${typeof issue.recommendation === 'string' ? issue.recommendation : ''}`
    const choiceKeys = resolvedStableKeys(
      evidence, /choice\.[A-Za-z0-9._:-]+/g, knownScenePartChoiceKeys,
    )
    const sourceSceneKeys = resolvedStableKeys([...evidence.matchAll(
      /sourceNodeKey\s*(?:=|:)?\s*["']?(scene\.[A-Za-z0-9._:-]+)/g,
    )].map(match => match[1]).join(' '), /scene\.[A-Za-z0-9._:-]+/g, knownScenePartSceneKeys)
    const namedSceneKeys = resolvedStableKeys(
      evidence, /scene\.[A-Za-z0-9._:-]+/g, knownScenePartSceneKeys,
    )
    const endingKeys = resolvedStableKeys(
      evidence, /ending\.[A-Za-z0-9._:-]+/g, knownScenePartEndingKeys,
    )
    const hasChoiceOrEndingIdentity = choiceKeys.size > 0
      || sourceSceneKeys.size > 0 || endingKeys.size > 0
    return [...latestRepairPartPayloads].flatMap(([taskKey, payload]) => {
      if (!scenePartTaskKeys.includes(taskKey)) return []
      const ownsChoice = Array.isArray(payload.choices) && payload.choices.some(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        const choice = value as Record<string, unknown>
        return (typeof choice.choiceKey === 'string' && choiceKeys.has(choice.choiceKey))
          || (typeof choice.sourceNodeKey === 'string' && sourceSceneKeys.has(choice.sourceNodeKey))
      })
      const ownsScene = Array.isArray(payload.scenes) && payload.scenes.some(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        const scene = value as Record<string, unknown>
        return typeof scene.sceneKey === 'string' && namedSceneKeys.has(scene.sceneKey)
      })
      const ownsEnding = Array.isArray(payload.endings) && payload.endings.some(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        const ending = value as Record<string, unknown>
        return typeof ending.endingKey === 'string' && endingKeys.has(ending.endingKey)
      })
      return (hasChoiceOrEndingIdentity ? (ownsChoice || ownsEnding) : ownsScene)
        ? [taskKey] : []
    })
  }
  const questScriptPartOwnersForIssue = (issue: Record<string, unknown>): string[] => {
    const evidence = `${typeof issue.detail === 'string' ? issue.detail : ''}\n${typeof issue.recommendation === 'string' ? issue.recommendation : ''}`
    const stableKeys = resolvedStableKeys(
      evidence,
      /(?:objective|alternative|entry|stage)\.[A-Za-z0-9._:-]+/g,
      knownQuestScriptStableKeys,
    )
    if (stableKeys.size === 0) return []
    return [...latestRepairPartPayloads].flatMap(([taskKey, payload]) => {
      if (!questScriptTaskKeys.includes(taskKey)) return []
      const serialized = JSON.stringify(payload)
      return [...stableKeys].some(key => serialized.includes(`"${key}"`)) ? [taskKey] : []
    })
  }
  const narrativeBlockingIssues = blockingIssues.filter(issue => (
    textAdventureQualityIssueOwnerArtifactKeyV1(issue) === 'content.narrative'
  ))
  const targetedNarrativeTaskKeys = new Set<string>()
  let narrativeIssueWithoutResolvedOwner = false
  let invalidReviewReference = false
  if (narrativeBlockingIssues.length > 0) {
    for (const issue of narrativeBlockingIssues) {
      const partOwners = scenePartOwnersForIssue(issue)
      for (const taskKey of partOwners) {
        if (textAdventureQualityChoiceCopyOnlyRepairV1(issue)) {
          const actMatch = /^content\.scene-script\.act-([1-3])\.part-\d+$/.exec(taskKey)
          if (actMatch) targetedNarrativeTaskKeys.add(`content.dialogue-pass.act-${actMatch[1]}`)
        } else {
          targetedNarrativeTaskKeys.add(taskKey)
        }
      }
      if (partOwners.length === 0) {
        const evidence = `${typeof issue.detail === 'string' ? issue.detail : ''}\n${typeof issue.recommendation === 'string' ? issue.recommendation : ''}`
        const namesStableIdentity = /(?:^|[^\w])choice\.[A-Za-z0-9._:-]+|sourceNodeKey\s*(?:=|:)|(?:^|[^\w])scene\.[A-Za-z0-9._:-]+/i.test(evidence)
        if (namesStableIdentity) invalidReviewReference = true
        else narrativeIssueWithoutResolvedOwner = true
      }
    }
  }
  if (invalidReviewReference) {
    return textAdventureQualityReviewRerunTaskKeysV1(input.plan)
  }
  const narrativeRepairTaskKeys = [...new Set([
    ...(narrativeIssueWithoutResolvedOwner ? sceneScriptTaskKeys.flatMap(sceneScriptPartKeys) : []),
    ...targetedNarrativeTaskKeys,
  ])]
  const invalidated = new Set<string>(unresolvedFailureTaskKeys.length > 0
    ? unresolvedFailureTaskKeys.flatMap(taskKey => (
        taskKey === 'integration.narrative'
          ? exactFailedDialoguePassTaskKey
            ? [exactFailedDialoguePassTaskKey]
            : [...sceneScriptTaskKeys.flatMap(sceneScriptPartKeys), ...dialoguePassTaskKeys]
          : sceneScriptPartKeys(taskKey)
      ))
    : blockingIssues.flatMap(issue => {
        const artifactKey = textAdventureQualityIssueOwnerArtifactKeyV1(issue)
        if (artifactKey === 'content.narrative-arc-plan') {
          return textAdventureQualityArcRepairTaskKeysV1(issue)
        }
        if (artifactKey === 'content.narrative') {
          return narrativeRepairTaskKeys
        }
        if (artifactKey === 'content.quest-script') {
          const exactOwners = questScriptPartOwnersForIssue(issue)
          return exactOwners.length > 0 ? exactOwners : questScriptTaskKeys
        }
        if (/^content\.scene-script\.act-[1-3]$/.test(artifactKey)) {
          const exactOwners = scenePartOwnersForIssue(issue)
            .filter(taskKey => taskKey.startsWith(`${artifactKey}.part-`))
          return exactOwners.length > 0 ? exactOwners : sceneScriptPartKeys(artifactKey)
        }
        const taskKey = taskByArtifactKey.get(artifactKey)
        return taskKey ? sceneScriptPartKeys(taskKey) : []
      }))
  if (invalidated.size === 0) {
    for (const taskKey of textAdventureQualityReviewRerunTaskKeysV1(input.plan)) {
      invalidated.add(taskKey)
    }
  }
  let expanded = true
  while (expanded) {
    expanded = false
    for (const task of input.plan.tasks) {
      if (invalidated.has(task.taskKey) || !task.dependsOn.some(key => invalidated.has(key))) continue
      if (preserveFrozenMedia && task.taskKey === 'media.requirements') continue
      invalidated.add(task.taskKey)
      expanded = true
    }
  }
  return invalidated
}

async function ensureRootRun(input: {
  scope: WorkspaceScope
  productionId: number
  suppliedPlan?: ProductProductionPlanV3
}) {
  const state = await ensurePlan(input)
  let ledger = parseLedger(state.build.budgetLedgerJson)
  if (ledger.rootRunId != null) {
    const root = await readAgentRunV1(input.scope, ledger.rootRunId)
    if (root.run.productBuildId !== state.build.id
      || root.contract.scope.productProduction?.taskKey !== ROOT_TASK_KEY
      || root.contract.scope.productProduction.controlEpoch !== state.build.controlEpoch
      || root.contract.scope.productProduction.planHash !== state.build.planHash) {
      throw new Error('[product-production-scheduler] root Run 与 Build 不一致')
    }
    return { ...state, root, ledger }
  }

  const claimOwner = `scheduler:${crypto.randomUUID()}`
  await db.transaction('rw', db.productBuilds, async () => {
    const current = await db.productBuilds.get(state.build.id!)
    if (!current || current.controlEpoch !== state.build.controlEpoch || current.planHash !== state.build.planHash) {
      throw new Error('[product-production-scheduler] root claim 已过期')
    }
    const next = parseLedger(current.budgetLedgerJson)
    if (next.rootRunId != null) return
    if (next.rootClaim && next.rootClaim.owner !== claimOwner && next.rootClaim.expiresAt > Date.now()) {
      throw new Error('[product-production-scheduler] root Run 正由其他调度器创建')
    }
    next.rootClaim = { owner: claimOwner, expiresAt: Date.now() + CLAIM_TTL_MS }
    await db.productBuilds.update(current.id!, { budgetLedgerJson: canonicalProductProductionJsonV2(next), updatedAt: Date.now() })
  })
  const refreshed = await db.productBuilds.get(state.build.id!)
  ledger = parseLedger(refreshed!.budgetLedgerJson)
  if (ledger.rootRunId != null) {
    return { ...state, build: refreshed!, root: await readAgentRunV1(input.scope, ledger.rootRunId), ledger }
  }
  if (ledger.rootClaim?.owner !== claimOwner) throw new Error('[product-production-scheduler] root claim 丢失')
  let root = await createAgentRunV1({
    scope: input.scope, productBuildId: state.build.id!,
    contract: await rootContract(input.scope, {
      id: state.build.id!, buildNumber: state.build.buildNumber,
      controlEpoch: state.build.controlEpoch, planHash: state.build.planHash,
    }),
  })
  root = await append(input.scope, root, 'step.scheduled', { stepId: ROOT_STEP_ID })
  root = await append(input.scope, root, 'step.started', { stepId: ROOT_STEP_ID, attempt: 1 })
  await db.transaction('rw', db.productBuilds, async () => {
    const current = await db.productBuilds.get(state.build.id!)
    if (!current) throw new Error('[product-production-scheduler] Build 在 root 提交前消失')
    const next = parseLedger(current.budgetLedgerJson)
    if (next.rootRunId != null && next.rootRunId !== root.run.id) {
      throw new Error('[product-production-scheduler] 检测到并发 root Run')
    }
    if (next.rootClaim?.owner !== claimOwner) throw new Error('[product-production-scheduler] root claim 已被替换')
    next.rootRunId = root.run.id
    next.rootClaim = null
    await db.productBuilds.update(current.id!, { budgetLedgerJson: canonicalProductProductionJsonV2(next), updatedAt: Date.now() })
  })
  const build = (await db.productBuilds.get(state.build.id!))!
  return { ...state, build, root, ledger: parseLedger(build.budgetLedgerJson) }
}

async function childSnapshots(scope: WorkspaceScope, buildId: number, rootRunId: number) {
  const rows = await db.agentRuns.where('productBuildId').equals(buildId).toArray()
  const children = rows.filter(row => row.parentRunId === rootRunId && row.id != null)
  const snapshots = await Promise.all(children.map(row => readAgentRunV1(scope, row.id!)))
  return new Map(snapshots.map(snapshot => [snapshot.contract.scope.productProduction!.taskKey, snapshot]))
}

async function settleCarriedTask(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
  inputHash: string
  candidateHash: string
}): Promise<void> {
  const receiptHash = input.snapshot.projection.terminalReceiptHash
  if (!receiptHash) throw new Error('[product-production-scheduler] carried task 缺少 terminal receipt')
  await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productBuildArtifacts), async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || build.controlEpoch !== input.controlEpoch) {
      throw new Error('[product-production-scheduler] carried task settlement epoch 已过期')
    }
    const artifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
      .filter(row => row.controlEpoch === input.controlEpoch
        && (row.status === 'carried-forward'
          || (input.task.executionMode === 'human-import' && row.status === 'accepted'))
        && input.task.outputArtifactKeys.includes(row.artifactKey))
    if (artifacts.length !== input.task.outputArtifactKeys.length) {
      throw new Error(`[product-production-scheduler] carried task 输出不完整:${input.task.taskKey}`)
    }
    const now = Date.now()
    // A reuse Run proves that carrying was valid for this epoch; it did not
    // produce the immutable bytes. Keep the source producer/input provenance
    // on the Artifact instead of laundering it into a newer Skill contract.
    const ledger = parseLedger(build.budgetLedgerJson)
    recordLedgerEntryV2(ledger, input.controlEpoch, input.task.taskKey, {
      runId: input.snapshot.run.id, attempt: 1, status: 'settled', idempotencyKey: input.inputHash,
      candidateHash: input.candidateHash, terminalReceiptHash: receiptHash,
      passedGateIds: [...input.task.acceptanceGateIds], usage: zeroUsage(), errorCode: null,
    })
    await db.productBuilds.update(build.id!, {
      budgetLedgerJson: canonicalProductProductionJsonV2(ledger), updatedAt: now,
    })
  })
}

async function invalidateCarriedTaskClosureV1(input: {
  scope: WorkspaceScope
  buildId: number
  buildNumber: number
  controlEpoch: number
  plan: ProductProductionPlanV3
  seedTaskKey: string
}): Promise<void> {
  const invalidatedTasks = expandProductProductionInvalidatedTaskClosureV1(
    input.plan, [input.seedTaskKey],
  )
  const artifactKeys = new Set(input.plan.tasks
    .filter(task => invalidatedTasks.has(task.taskKey))
    .flatMap(task => task.outputArtifactKeys))
  await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productBuildArtifacts), async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || build.buildNumber !== input.buildNumber || build.controlEpoch !== input.controlEpoch
      || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) {
      throw new Error('[product-production-scheduler] carried closure 失效处理时 Build CAS 已过期')
    }
    await db.productBuildArtifacts.where('buildId').equals(input.buildId).and(row => (
      row.controlEpoch === input.controlEpoch && row.status === 'carried-forward'
        && artifactKeys.has(row.artifactKey)
    )).modify({ status: 'invalid', updatedAt: Date.now() })
  })
}

async function carriedTextAdventureAnchorMatchesCurrentBibleV1(input: {
  buildNumber: number
  anchor: ProductBuildArtifactRecordV1
  visualBible: ProductBuildArtifactRecordV1 | undefined
}): Promise<boolean> {
  if (!input.visualBible || input.anchor.carriedFrom == null) return false
  return textAdventureAnchorDecisionMatchesBibleV1({
    anchor: input.anchor,
    visualBible: input.visualBible,
  })
}

/**
 * An accepted artifact is not automatically a carried input. Most accepted
 * rows were produced by a normal task Run in the current epoch and already
 * own an immutable ledger settlement. Governed `human-import` commands (for
 * example an author-locked/replaced image or frozen repair feedback) create
 * the accepted Artifact before the scheduler signs its zero-provider Run;
 * those rows are therefore eligible only while they still have no producer
 * Run. Explicit cross-epoch copies use `carried-forward` instead.
 */
export function productProductionArtifactEligibleForSyntheticCarryV1(input: {
  taskKey: string
  executionMode: ProductProductionPlanTaskV3['executionMode']
  artifactStatus: ProductBuildArtifactRecordV1['status']
  producerRunId: number | null
}): boolean {
  if (input.artifactStatus === 'carried-forward') return true
  return input.executionMode === 'human-import'
    && input.artifactStatus === 'accepted'
    && input.producerRunId == null
}

async function ensureCarriedForwardTaskRuns(input: {
  scope: WorkspaceScope
  build: { id: number; buildNumber: number; controlEpoch: number; planHash: string }
  root: AgentRunSnapshotV1
  plan: ProductProductionPlanV3
  capabilityBindings: ProductProductionCapabilityBindingV1[]
  onDurableBoundary?: (boundary: ProductProductionSchedulerBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<void> {
  let progressed = true
  while (progressed) {
    progressed = false
    const children = await childSnapshots(input.scope, input.build.id, input.root.run.id)
    const completed = new Map([...children].flatMap(([taskKey, snapshot]) => (
      snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash
        ? [[taskKey, snapshot.projection.terminalReceiptHash] as const] : []
    )))
    const artifacts = (await db.productBuildArtifacts.where('buildId').equals(input.build.id).toArray())
      .filter(row => row.controlEpoch === input.build.controlEpoch
        && (row.status === 'carried-forward' || row.status === 'accepted'))
    for (const task of input.plan.tasks) {
      const carriesExplicitAuthorDecision = task.taskKey === 'source.author-gate'
        || task.taskKey === 'media.anchor-author-gate'
      if (task.executionMode === 'deterministic' && task.reuse == null
        && !carriesExplicitAuthorDecision) continue
      const outputs = artifacts.filter(row => task.outputArtifactKeys.includes(row.artifactKey)
        && productProductionArtifactEligibleForSyntheticCarryV1({
          taskKey: task.taskKey,
          executionMode: task.executionMode,
          artifactStatus: row.status,
          producerRunId: row.producerRunId,
        }))
      if (outputs.length !== task.outputArtifactKeys.length
        || task.dependsOn.some(dependency => !completed.has(dependency))) continue
      if (task.taskKey === 'media.anchor-author-gate'
        && !await carriedTextAdventureAnchorMatchesCurrentBibleV1({
          buildNumber: input.build.buildNumber,
          anchor: outputs[0],
          visualBible: artifacts.find(row => row.artifactKey === 'media.visual-bible'),
        })) {
        await invalidateCarriedTaskClosureV1({
          scope: input.scope,
          buildId: input.build.id,
          buildNumber: input.build.buildNumber,
          controlEpoch: input.build.controlEpoch,
          plan: input.plan,
          seedTaskKey: task.taskKey,
        })
        progressed = true
        break
      }
      const dependencies = task.dependsOn.map(taskKey => ({ taskKey, receiptHash: completed.get(taskKey)! }))
      const candidateHash = await hashProductProductionValueV2(outputs.map(row => ({
        artifactKey: row.artifactKey, contentHash: row.contentHash,
        carriedFrom: row.carriedFrom, parentArtifactHash: row.parentArtifactHash,
      })).sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)))
      const bindings = normalizedBindings(task, input.capabilityBindings)
      const executionIdentityHash = await productProductionTaskExecutionIdentityHashV1(task)
      const inputHash = await hashProductProductionValueV2({
        schema: 'storyforge.product-production-carried-task-input', version: 1,
        planHash: input.build.planHash, taskKey: task.taskKey,
        controlEpoch: input.build.controlEpoch, dependencies, candidateHash,
        executionIdentityHash, capabilityBindings: bindings,
      })
      const existing = children.get(task.taskKey)
      if (existing) {
        if (existing.projection.state !== 'completed') continue
        const receiptHash = existing.projection.terminalReceiptHash!
        const build = await db.productBuilds.get(input.build.id)
        const ledgerTask = build ? parseLedger(build.budgetLedgerJson).tasks[task.taskKey] : null
        const alreadySettled = ledgerTask?.status === 'settled'
          && ledgerTask.runId === existing.run.id
          && ledgerTask.terminalReceiptHash === receiptHash
          && ledgerTask.idempotencyKey === inputHash
        if (!alreadySettled) {
          await settleCarriedTask({
            scope: input.scope, buildId: input.build.id, controlEpoch: input.build.controlEpoch,
            task, snapshot: existing, inputHash, candidateHash,
          })
          progressed = true
        }
        completed.set(task.taskKey, existing.projection.terminalReceiptHash!)
        continue
      }
      const capabilityBindingHash = bindings.length > 0 ? await hashProductProductionValueV2(bindings) : undefined
      let snapshot: AgentRunSnapshotV1
      try {
        snapshot = await createAgentRunV1({
          scope: input.scope, productBuildId: input.build.id,
          contract: await taskContract({
            scope: input.scope, rootRunId: input.root.run.id, build: input.build,
            task, capabilityBindingHash,
          }),
        })
      } catch (error) {
        if (!(error instanceof Error) || !/duplicate_child|已经存在子运行/.test(error.message)) throw error
        progressed = true
        break
      }
      snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: task.taskKey })
      snapshot = await append(input.scope, snapshot, 'step.started', { stepId: task.taskKey, attempt: 1 })
      snapshot = await append(input.scope, snapshot, 'budget.reserved', {
        stepId: task.taskKey, modelCalls: task.budgetReservation.modelCalls,
        toolCalls: task.budgetReservation.mediaCalls,
        tokens: task.budgetReservation.inputTokens + task.budgetReservation.outputTokens,
      })
      snapshot = await append(input.scope, snapshot, 'budget.settled', {
        stepId: task.taskKey, modelCalls: 0, toolCalls: 0, tokens: 0,
      })
      snapshot = await append(input.scope, snapshot, 'step.succeeded', {
        stepId: task.taskKey, attempt: 1, outputHash: candidateHash,
      })
      snapshot = await append(input.scope, snapshot, 'verification.started', {
        verifierSetVersion: 'product-production-carried-task-v1',
      })
      const receiptHash = await hashProductProductionValueV2({
        schema: 'storyforge.product-production-carried-task-receipt', version: 1,
        taskKey: task.taskKey, inputHash, candidateHash, dependencies,
        executionIdentityHash,
        passedGateIds: task.acceptanceGateIds, controlEpoch: input.build.controlEpoch,
      })
      snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash })
      await settleCarriedTask({
        scope: input.scope, buildId: input.build.id, controlEpoch: input.build.controlEpoch,
        task, snapshot, inputHash, candidateHash,
      })
      await input.onDurableBoundary?.('artifact.accepted', snapshot)
      progressed = true
    }
  }
}

async function acceptedInputs(buildId: number, controlEpoch: number, keys: string[]) {
  if (keys.length === 0) return []
  const wanted = new Set(keys)
  const rows = (await db.productBuildArtifacts.where('buildId').equals(buildId).toArray())
    .filter(row => wanted.has(row.artifactKey) && row.controlEpoch === controlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (rows.length !== wanted.size || new Set(rows.map(row => row.artifactKey)).size !== wanted.size) {
    throw new Error('[product-production-scheduler] task 输入 Artifact 缺失、重复或 epoch 过期')
  }
  return rows.sort((a, b) => a.artifactKey.localeCompare(b.artifactKey))
}

function validateExecutionResult(task: ProductProductionPlanTaskV3, result: ProductProductionTaskExecutionResultV1): void {
  if (!result || !Array.isArray(result.artifacts) || !Array.isArray(result.passedGateIds)) {
    throw new Error('[product-production-scheduler] executor 返回合同无效')
  }
  const expected = [...task.outputArtifactKeys].sort()
  const actual = result.artifacts.map(row => row.artifactKey).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])
    || new Set(result.passedGateIds).size !== result.passedGateIds.length
    || task.acceptanceGateIds.some(gate => !result.passedGateIds.includes(gate))) {
    throw new Error(`[product-production-scheduler] ${task.taskKey} 输出或 acceptance gates 不完整`)
  }
  boundedUsage(result.usage, task.budgetReservation)
}

function parseResumeCandidate(value: unknown, task: ProductProductionPlanTaskV3, epoch: number): ResumeCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[product-production-scheduler] checkpoint candidate 缺失')
  const candidate = value as ResumeCandidateV1
  if (candidate.schema !== 'storyforge.product-production-task-candidate' || candidate.version !== 1
    || candidate.taskKey !== task.taskKey || candidate.controlEpoch !== epoch
    || !isSha256Hash(candidate.inputHash) || !isSha256Hash(candidate.candidateHash)) {
    throw new Error('[product-production-scheduler] checkpoint candidate 无效或过期')
  }
  validateExecutionResult(task, candidate.result)
  return candidate
}

function recordLedgerEntryV2(
  ledger: SchedulerLedgerV2,
  controlEpoch: number,
  taskKey: string,
  entry: LedgerTaskV1,
  unknownUsageHold: ProductProductionTaskUsageV1 | null = null,
): void {
  ledger.tasks[taskKey] = entry
  if (entry.status === 'claimed') return
  const identity = `${controlEpoch}:${entry.runId}:${entry.attempt}`
  const existing = ledger.attempts.find(attempt => (
    `${attempt.controlEpoch}:${attempt.runId}:${attempt.attempt}` === identity
  ))
  const attempt: LedgerAttemptV2 = {
    controlEpoch,
    taskKey,
    runId: entry.runId,
    attempt: entry.attempt,
    idempotencyKey: entry.idempotencyKey,
    outcome: entry.status,
    usage: entry.usage == null
      ? (unknownUsageHold == null ? null : structuredClone(unknownUsageHold))
      : structuredClone(entry.usage),
    usageKnown: entry.usage != null,
    errorCode: entry.errorCode,
  }
  if (existing) {
    if (canonicalProductProductionJsonV2(existing) !== canonicalProductProductionJsonV2(attempt)) {
      throw new Error(
        `[product-production-scheduler] budget ledger attempt 不可覆写:${identity}:` +
        `${existing.taskKey}/${existing.outcome}->${attempt.taskKey}/${attempt.outcome}:` +
        `${existing.idempotencyKey !== attempt.idempotencyKey ? 'idempotency-key-mismatch' : 'receipt-mismatch'}`,
      )
    }
    return
  }
  ledger.attempts.push(attempt)
}

async function settleLedger(input: {
  buildId: number
  controlEpoch: number
  taskKey: string
  entry: LedgerTaskV1
  unknownUsageHold?: ProductProductionTaskUsageV1 | null
}): Promise<void> {
  await db.transaction('rw', db.productBuilds, async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || build.controlEpoch !== input.controlEpoch) throw new Error('[product-production-scheduler] ledger epoch 已过期')
    const ledger = parseLedger(build.budgetLedgerJson)
    recordLedgerEntryV2(
      ledger, input.controlEpoch, input.taskKey, input.entry, input.unknownUsageHold ?? null,
    )
    await db.productBuilds.update(build.id!, { budgetLedgerJson: canonicalProductProductionJsonV2(ledger), updatedAt: Date.now() })
  })
}

async function acceptCandidate(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
  candidate: ResumeCandidateV1
}): Promise<void> {
  const receiptHash = input.snapshot.projection.terminalReceiptHash
  if (!receiptHash) throw new Error('[product-production-scheduler] task Run 尚无 terminal receipt')
  if (input.task.taskKey === 'p0.source-lock') {
    const pinArtifact = input.candidate.result.artifacts.find(artifact => (
      artifact.artifactKey === 'text-open-world.source-pin'
        && artifact.kind === 'text-open-world.source-pin'
    ))
    if (!pinArtifact) {
      throw new Error('[product-production-scheduler] P0 candidate 缺少 SourcePin closure marker')
    }
    const unitArtifacts = input.candidate.result.artifacts.filter(artifact => (
      artifact.kind === 'text-open-world.source-pin-unit'
    ))
    const bundle: TextOpenWorldSourcePinBundleV1 = {
      pin: pinArtifact.payload as TextOpenWorldSourcePinBundleV1['pin'],
      units: unitArtifacts.map(artifact => ({
        payload: artifact.payload as TextOpenWorldSourcePinBundleV1['units'][number]['payload'],
        artifactContentHash: artifact.contentHash ?? '',
      })),
    }
    await settleLedger({
      buildId: input.buildId,
      controlEpoch: input.controlEpoch,
      taskKey: input.task.taskKey,
      entry: {
        runId: input.snapshot.run.id,
        attempt: input.candidate.attempt,
        status: 'settled',
        idempotencyKey: input.candidate.inputHash,
        candidateHash: input.candidate.candidateHash,
        terminalReceiptHash: receiptHash,
        passedGateIds: input.candidate.result.passedGateIds,
        usage: input.candidate.result.usage,
        errorCode: null,
      },
    })
    await acceptTextOpenWorldSourcePinBundleArtifactsV1({
      scope: input.scope,
      buildId: input.buildId,
      controlEpoch: input.controlEpoch,
      bundle,
      producer: {
        runId: input.snapshot.run.id,
        receiptHash,
        inputHash: input.candidate.inputHash,
      },
    })
    return
  }
  for (const artifact of input.candidate.result.artifacts) {
    await acceptProductBuildArtifact({
      scope: input.scope, buildId: input.buildId, controlEpoch: input.controlEpoch,
      artifactKey: artifact.artifactKey, requirementKey: artifact.requirementKey,
      kind: artifact.kind, mediaKind: artifact.mediaKind, payload: artifact.payload,
      metadata: artifact.metadata, quality: artifact.quality, rights: artifact.rights,
      contentHash: artifact.contentHash, blobObjectId: artifact.blobObjectId,
      mimeType: artifact.mimeType, byteSize: artifact.byteSize,
      producerRunId: input.snapshot.run.id, producerReceiptHash: receiptHash,
      inputHash: input.candidate.inputHash,
    })
  }
  await settleLedger({
    buildId: input.buildId, controlEpoch: input.controlEpoch, taskKey: input.task.taskKey,
    entry: {
      runId: input.snapshot.run.id, attempt: input.candidate.attempt, status: 'settled',
      idempotencyKey: input.candidate.inputHash, candidateHash: input.candidate.candidateHash,
      terminalReceiptHash: receiptHash, passedGateIds: input.candidate.result.passedGateIds,
      usage: input.candidate.result.usage, errorCode: null,
    },
  })
}

async function finishCandidateRun(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  task: ProductProductionPlanTaskV3
  candidate: ResumeCandidateV1
}): Promise<AgentRunSnapshotV1> {
  let snapshot = input.snapshot
  if (snapshot.projection.state === 'completed') return snapshot
  snapshot = await append(input.scope, snapshot, 'budget.settled', {
    stepId: input.task.taskKey,
    modelCalls: input.candidate.result.usage.modelCalls,
    toolCalls: input.candidate.result.usage.mediaCalls,
    tokens: input.candidate.result.usage.inputTokens + input.candidate.result.usage.outputTokens,
  })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', {
    stepId: input.task.taskKey, attempt: input.candidate.attempt,
    outputHash: input.candidate.candidateHash,
  })
  snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: 'product-production-task-v1' })
  const receiptHash = await hashProductProductionValueV2({
    schema: 'storyforge.product-production-task-receipt', version: 1,
    taskKey: input.task.taskKey, attempt: input.candidate.attempt,
    inputHash: input.candidate.inputHash, candidateHash: input.candidate.candidateHash,
    passedGateIds: input.candidate.result.passedGateIds,
    usage: input.candidate.result.usage,
    controlEpoch: input.candidate.controlEpoch,
  })
  return append(input.scope, snapshot, 'verification.accepted', { receiptHash })
}

async function recoverCompletedOrCheckpointed(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
}): Promise<boolean> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.snapshot.run.id)
  if (!checkpoint?.resumePayload) return false
  const candidate = parseResumeCandidate(checkpoint.resumePayload, input.task, input.controlEpoch)
  let snapshot = input.snapshot
  if (snapshot.projection.state !== 'completed') {
    const step = snapshot.projection.steps[input.task.taskKey]
    if (!step || step.candidateHash !== candidate.candidateHash || step.status !== 'running') return false
    snapshot = await finishCandidateRun({ scope: input.scope, snapshot, task: input.task, candidate })
  }
  await acceptCandidate({ ...input, snapshot, candidate })
  return true
}

async function runClaimedTaskCore(input: {
  scope: WorkspaceScope
  productionId: number
  build: { id: number; buildNumber: number; controlEpoch: number; planHash: string; failureJson: string }
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
  executor: ProductProductionTaskExecutorV1
  repairAuthority: TextOpenWorldCreatorRepairExecutionAuthorityV1 | null
  mediaAuthority: TextOpenWorldCreatorMediaExecutionAuthorityV1 | null
  capabilityBindings: ProductProductionCapabilityBindingV1[]
  signal: AbortSignal
  onDurableBoundary?: (boundary: ProductProductionSchedulerBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<void> {
  let snapshot = input.snapshot
  const previous = snapshot.projection.steps[input.task.taskKey]
  const attempt = previous?.status === 'failed' ? previous.attempt + 1 : 1
  if (!previous) snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: input.task.taskKey })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: input.task.taskKey, attempt })
  const artifacts = await acceptedInputs(input.build.id, input.build.controlEpoch, input.task.inputArtifactKeys)
  const authorizedRepair = input.repairAuthority == null
    ? null
    : await resolveTextOpenWorldCreatorRepairTaskResultV1({
        authority: input.repairAuthority,
        taskKey: input.task.taskKey,
        inputArtifacts: artifacts,
      })
  const authorizedMediaImport = input.mediaAuthority == null
    ? null
    : await resolveTextOpenWorldCreatorImportedMediaTaskResultV1({
        authority: input.mediaAuthority,
        taskKey: input.task.taskKey,
      })
  const authorizedDirectResult = authorizedRepair ?? authorizedMediaImport
  const attemptBudgetReservation = authorizedDirectResult == null
      ? remainingTaskAttemptBudgetV1({
        task: input.task,
        ledger: parseLedger((await db.productBuilds.get(input.build.id))!.budgetLedgerJson),
        controlEpoch: input.build.controlEpoch,
      })
    : {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        mediaCalls: 0,
        maximumCostUsd: 0,
        durationMs: input.task.budgetReservation.durationMs,
        storageBytes: input.task.budgetReservation.storageBytes,
      }
  const bindings = normalizedBindings(input.task, input.capabilityBindings)
  const localProceduralMedia = isLocalProceduralMediaTaskV1(
    input.task,
    bindings,
    input.mediaAuthority?.authorization.plan.mode === 'author-import'
      ? input.mediaAuthority.authorization.plan.capability.adapterId
      : null,
  )
  const authorResolution = authorResolutionEvidence(input.build.failureJson, input.task.taskKey)
  const dependencyRuns = await Promise.all(input.task.dependsOn.map(async taskKey => {
    const row = await db.agentRuns.where('[parentRunId+parentRelation]')
      .equals([snapshot.run.parentRunId!, `task:${taskKey}`]).first()
    if (!row?.terminalReceiptHash) throw new Error(`[product-production-scheduler] dependency receipt 缺失:${taskKey}`)
    return { taskKey, receiptHash: row.terminalReceiptHash }
  }))
  const [executionIdentityHash, frozenExecutionIdentityHash] = await Promise.all([
    productProductionTaskExecutionIdentityHashV1(input.task),
    frozenProductProductionTaskExecutionIdentityHashV1(input.task, snapshot),
  ])
  if (executionIdentityHash !== frozenExecutionIdentityHash) {
    throw new Error(`[product-production-scheduler] Run Skill execution binding 已过期:${input.task.taskKey}`)
  }
  const structuralInput = {
    planHash: input.build.planHash, taskKey: input.task.taskKey, controlEpoch: input.build.controlEpoch,
    dependencies: dependencyRuns, artifacts: artifacts.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
    executionIdentityHash,
    capabilityBindings: bindings,
    authorResolution,
  }
  const normalSourceKeys = taskContextSourceKeys(
    input.task,
    input.task.skillId?.startsWith('text-open-world.') === true,
  )
  const requiredNormalSourceKeys = new Set(taskRequiredContextSourceKeys(input.task))
  const contractSourceKeys = taskContractContextSourceKeys(input.task)
  const totalInputBudget = Math.max(1, input.task.budgetReservation.inputTokens)
  const worldGatewayUsed = productProductionTaskUsesWorldGatewayV1(input.task)
  const executorOwnsWorldGateway = productProductionTaskOwnsWorldGatewayV1(input.task)
  const worldGatewayRequired = worldGatewayUsed && !executorOwnsWorldGateway
  const requiresExactContext = worldGatewayUsed || input.task.executionMode === 'model'
  // The gateway below receives the declared budget minus the context actually
  // assembled here. A fixed percentage cap would reject a valid, exact Brief
  // and artifact set before the remaining world budget can even be measured.
  const normalInputBudget = totalInputBudget
  let normalAssembled: AssembleContextResult
  try {
    normalAssembled = await assembleContext({
      projectId: input.scope.projectId, scope: input.scope, sourceKeys: normalSourceKeys,
      productProductionId: input.productionId, productBuildId: input.build.id,
      productArtifactKeys: input.task.inputArtifactKeys,
      productProductionTaskKey: input.task.taskKey,
      // The frozen Plan is the formal per-task contract. Passing it merely as
      // a maximum would silently clamp provider-agnostic durable Runs to the
      // generic 48k fallback even when an authorized long-context task (for
      // example visual direction) owns a larger exact source packet.
      inputBudgetTokens: normalInputBudget,
    ...(requiresExactContext ? { sourceTransformer: preserveProductProductionContextV1 } : {}),
    })
    if (requiresExactContext && (normalAssembled.overBudgetAfterTrim || !normalAssembled.sourceEvidence || normalAssembled.sourceEvidence.some(source => (
      (requiredNormalSourceKeys.has(source.key) || source.originalTokens > 0)
        && (source.status !== 'included' || source.delivery !== 'full')
    )))) {
      const incompleteSources = normalAssembled.sourceEvidence
        ?.filter(source => (
          (requiredNormalSourceKeys.has(source.key) || source.originalTokens > 0)
            && (source.status !== 'included' || source.delivery !== 'full')
        ))
        .map(source => source.key)
        .join(',') || 'unknown'
      throw new ProductProductionContextBudgetErrorV1(
        `[product-production-context] 制作合同或依赖产物未完整进入任务预算`
        + `（required=${normalAssembled.totalInputTokens}, budget=${normalAssembled.inputBudget}, sources=${incompleteSources}）`
        + '；未调用模型，请缩小制作范围。',
      )
    }
  } catch (error) {
    if (!(error instanceof ProductProductionContextBudgetErrorV1)) throw error
    const code = 'task-context-budget-exceeded'
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: input.task.taskKey, attempt, code, retryable: false, category: 'deterministic', action: 'fail',
    })
    snapshot = await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
    await settleLedger({
      buildId: input.build.id, controlEpoch: input.build.controlEpoch, taskKey: input.task.taskKey,
      entry: { runId: snapshot.run.id, attempt, status: 'failed', idempotencyKey: '',
        candidateHash: null, terminalReceiptHash: null, passedGateIds: [], usage: zeroUsage(), errorCode: code },
    })
    await db.transaction('rw', scopeTransactionTables(db.productBuilds), async () => {
      const build = await db.productBuilds.get(input.build.id)
      if (!build || build.controlEpoch !== input.build.controlEpoch) return
      await db.productBuilds.update(input.build.id, {
        status: 'recovery-required', updatedAt: Date.now(),
        failureJson: canonicalProductProductionJsonV2({ taskKey: input.task.taskKey, code, attempt, detail: error.message }),
      })
    })
    return
  }
  let assembled = normalAssembled
  let gatewayExecution: ContextGatewayExecutionV1 | null = null
  let gatewayBaseManifest: ContextManifestV2 | null = null
  let gatewayPreflight: ContextGatewayPreflightEvidenceV1 | null = null
  let sourcePlanHash: string | null = null
  let confirmedBriefHash: string | null = null
  if (worldGatewayUsed) {
    const production = await db.productProductions.get(input.productionId)
    if (!production?.id || production.currentBriefRevision == null) {
      throw new Error('[product-production-scheduler] 模型任务缺少当前 Production/Brief')
    }
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([production.id, production.currentBriefRevision]).first()
    if (!briefRow || briefRow.status !== 'authorized') {
      throw new Error('[product-production-scheduler] 模型任务缺少已授权 Brief')
    }
    if (briefRow.briefKind === 'text-open-world-creator-v1') {
      const build = await db.productBuilds.get(input.build.id)
      if (!build || build.productionId !== input.productionId) {
        throw new Error('[product-production-scheduler] Creator 模型任务缺少当前 Build')
      }
      const creator = await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
        scope: input.scope,
        buildId: build.id!,
      })
      sourcePlanHash = creator.contracts.sourcePlan.planHash
      confirmedBriefHash = creator.contracts.start.startHash
      if (worldGatewayRequired) {
        throw new Error('[product-production-scheduler] Creator SourcePlan 尚未声明共享 World Gateway 适配器')
      }
    } else {
      const brief = parseProductProductionBriefV3(briefRow.briefJson)
      const sourcePlan = await parseProductProductionSourcePlanV1(briefRow)
      const confirmedBrief = await parseConfirmedProductBriefV1({ row: briefRow, sourcePlan })
      await assertFormalProductProductionStartV1({
        sourcePlan,
        confirmedBrief,
        authorStartRevision: confirmedBrief.authorStartRevision,
      })
      sourcePlanHash = sourcePlan.planHash
      confirmedBriefHash = confirmedBrief.confirmationHash
      if (worldGatewayRequired) {
        const worldBudget = Math.max(1, totalInputBudget - normalAssembled.totalInputTokens)
        gatewayExecution = await executeProductProductionWorldGatewayV1({
          scope: input.scope,
          sourcePlan,
          brief,
          task: input.task,
          budgetTokens: worldBudget,
          requireCompilationResources: input.task.executionMode === 'deterministic'
            && input.task.kind === 'runtime-package',
          signal: input.signal,
        })
        assembled = combineProductProductionContextV1({
          assembled: normalAssembled,
          worldContent: gatewayExecution.contextPacket.content,
          worldContentHash: gatewayExecution.contextPacket.contentHash,
          worldTokens: gatewayExecution.contextPacket.tokenCount,
          inputBudget: totalInputBudget,
        })
        if (assembled.overBudgetAfterTrim) {
          throw new Error('[product-production-scheduler] Brief/Artifact 与冻结世界事实合并后超过任务输入预算')
        }
        const manifestV1 = await createContextManifestFromAssemblyV1({
          runId: snapshot.run.id, stepId: input.task.taskKey, attempt,
          projectId: input.scope.projectId, worldGroupId: null,
          declaredSourceKeys: contractSourceKeys, assembled,
          readerVersion: 'product-production-world-gateway-v1',
        })
        gatewayBaseManifest = await createContextManifestV2FromV1({ manifest: manifestV1, scope: input.scope })
        const recorded = await recordContextGatewayPreflightEvidenceV1({
          scope: input.scope,
          runId: snapshot.run.id,
          stepId: input.task.taskKey,
          attempt,
          contextPacket: gatewayExecution.contextPacket,
          selector: gatewayExecution.selector,
          renderedRequest: {
            schema: 'storyforge.product-production-task-request', version: 1,
            taskKey: input.task.taskKey, planHash: input.build.planHash,
            executionMode: input.task.executionMode,
            contextText: assembled.text,
            inputArtifacts: artifacts.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
          },
          sourceSnapshots: [
            ...(normalAssembled.sourceSnapshots ?? []).map(source => ({
              sourceKey: source.key,
              sourceRefs: [],
              content: source.content,
            })),
            ...gatewayExecution.sourceSnapshots,
          ],
          toolTranscript: gatewayExecution.toolTranscript,
          expectedLastSequence: snapshot.projection.lastSequence,
        })
        snapshot = recorded.snapshot
        gatewayPreflight = recorded.evidence
      }
    }
  } else {
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id, stepId: input.task.taskKey, attempt,
      projectId: input.scope.projectId, worldGroupId: null,
      declaredSourceKeys: normalSourceKeys, assembled,
      readerVersion: 'product-production-context-v1',
    })
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: input.task.taskKey, attempt, manifestHash: manifest.manifestHash,
    })
  }
  const inputHash = await hashProductProductionValueV2({
    ...structuralInput,
    sourcePlanHash,
    confirmedBriefHash,
    contextPacketHash: gatewayExecution?.contextPacket.packetHash ?? null,
    creatorDerivedAuthorizationHash: authorizedDirectResult == null
      ? null
      : input.repairAuthority?.authorization.authorizationHash
        ?? input.mediaAuthority?.authorization.authorizationHash
        ?? null,
  })
  snapshot = await append(input.scope, snapshot, 'budget.reserved', {
    stepId: input.task.taskKey,
    modelCalls: attemptBudgetReservation.modelCalls,
    toolCalls: attemptBudgetReservation.mediaCalls,
    tokens: attemptBudgetReservation.inputTokens + attemptBudgetReservation.outputTokens,
  })
  const repair = JSON.parse(input.build.failureJson)
  const authorDraftJson = repair.blockerKey === input.task.taskKey && repair.resolution?.action === 'author-edit'
    ? repair.resolution.authorDraftJson as string : undefined
  if (authorDraftJson || authorizedDirectResult) {
    const recorded = await recordAgentRunArtifactV1({
      scope: input.scope, runId: snapshot.run.id, stepId: input.task.taskKey, attempt,
      artifactKind: 'source-snapshot', content: authorDraftJson ?? authorizedDirectResult!.evidenceJson,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = recorded.snapshot
  }
  await settleLedger({
    buildId: input.build.id,
    controlEpoch: input.build.controlEpoch,
    taskKey: input.task.taskKey,
    entry: {
      runId: snapshot.run.id,
      attempt,
      status: 'claimed',
      idempotencyKey: inputHash,
      candidateHash: null,
      terminalReceiptHash: null,
      passedGateIds: [],
      usage: zeroUsage(),
      errorCode: null,
    },
  })
  await assertBuildLifetimeBudgetCapacity({
    scope: input.scope,
    productionId: input.productionId,
    buildId: input.build.id,
    controlEpoch: input.build.controlEpoch,
  })
  const bindingHash = frozenExecutionIdentityHash
  if (authorizedDirectResult) {
    snapshot = await append(input.scope, snapshot, 'tool.called', {
      stepId: input.task.taskKey,
      attempt,
      toolName: authorizedRepair
        ? 'text-open-world-creator-repair-adoption'
        : 'text-open-world-creator-media-import-adoption',
      callHash: inputHash,
    })
  } else if (input.task.executionMode === 'model' && !authorDraftJson && !executorOwnsWorldGateway) {
    snapshot = await append(input.scope, snapshot, 'model.requested', { stepId: input.task.taskKey, attempt, bindingHash })
  } else if (input.task.executionMode === 'media-provider') {
    snapshot = await append(input.scope, snapshot, 'tool.called', {
      stepId: input.task.taskKey, attempt,
      toolName: localProceduralMedia ? LOCAL_PROCEDURAL_MEDIA_TOOL : 'game-media-provider',
      callHash: inputHash,
    })
  } else if (worldGatewayRequired) {
    snapshot = await append(input.scope, snapshot, 'tool.called', {
      stepId: input.task.taskKey, attempt, toolName: DETERMINISTIC_WORLD_TOOL, callHash: inputHash,
    })
  }
  try {
    await input.onDurableBoundary?.('provider.requested', snapshot)
  } catch (error) {
    // Test/dev crash injection represents process loss at an exact durable
    // boundary. Do not reinterpret it as a normal executor failure.
    throw new ProductProductionDurableBoundaryInterruptionV1(error)
  }
  let result: ProductProductionTaskExecutionResultV1 | undefined
  let timedOut = false
  const refreshExecutionAttemptAuthority = async (): Promise<boolean> => {
    snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
    const step = snapshot.projection.steps[input.task.taskKey]
    if (snapshot.projection.state !== 'running'
      || step?.status !== 'running'
      || step.attempt !== attempt) return false
    const [currentBuild, currentProduction] = await Promise.all([
      db.productBuilds.get(input.build.id),
      db.productProductions.get(input.productionId),
    ])
    return !!currentBuild && !!currentProduction
      && currentBuild.controlEpoch === input.build.controlEpoch
      && currentProduction.controlEpoch === input.build.controlEpoch
      && currentBuild.status === 'building'
      && currentProduction.status === 'producing'
  }
  const executionController = new AbortController()
  const abortFromParent = () => executionController.abort(input.signal.reason)
  if (input.signal.aborted) abortFromParent()
  else input.signal.addEventListener('abort', abortFromParent, { once: true })
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = globalThis.setTimeout(() => {
      timedOut = true
      const timeoutError = new Error(
        `[product-production-scheduler] ${input.task.taskKey} 超过任务合同 ${input.task.timeoutMs}ms`,
      )
      timeoutError.name = 'TimeoutError'
      executionController.abort(timeoutError)
      // Provider adapters are required to observe AbortSignal, but Scheduler
      // correctness cannot depend on that courtesy. The race releases the
      // durable task even when a transport ignores cancellation.
      reject(timeoutError)
    }, input.task.timeoutMs)
  })
  try {
    result = authorizedDirectResult?.result ?? await Promise.race([
      input.executor({
        scope: input.scope, productionId: input.productionId, buildId: input.build.id,
        buildNumber: input.build.buildNumber, controlEpoch: input.build.controlEpoch,
        planHash: input.build.planHash, task: input.task,
        attemptBudgetReservation,
        attempt, taskRunId: snapshot.run.id,
        idempotencyKey: inputHash, contextText: assembled.text, authorDraftJson,
        inputArtifacts: artifacts, capabilityBindings: bindings, authorResolution,
        signal: executionController.signal,
        beforeAdditionalModelRequest: async () => {
          if (!await refreshExecutionAttemptAuthority()) return 'discarded-stale'
        },
        onModelOutput: async output => {
          if (!await refreshExecutionAttemptAuthority()) return 'discarded-stale'
          const recorded = await recordAgentRunArtifactV1({
            scope: input.scope, runId: snapshot.run.id, stepId: input.task.taskKey, attempt,
            artifactKind: 'raw-response', content: output,
            expectedLastSequence: snapshot.projection.lastSequence,
          })
          snapshot = recorded.snapshot
        },
      }),
      timeoutPromise,
    ])
    validateExecutionResult(input.task, result)
    boundedUsage(result.usage, attemptBudgetReservation)
  } catch (error) {
    // Dedicated executors such as P1/P9 persist nested durable child-step
    // evidence on this same Run. Rebase the outer snapshot before writing the
    // failure envelope so their legitimate sequence advancement is preserved.
    snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
    const classifiedFailure = await classifyHarnessFailureV1(error)
    const recordedFailure = await recordAgentRunArtifactV1({
      scope: input.scope, runId: snapshot.run.id, stepId: input.task.taskKey, attempt,
      artifactKind: 'tool-result',
      content: canonicalProductProductionJsonV2({
        schema: 'storyforge.product-task-failure', version: 1,
        taskKey: input.task.taskKey, detail: safeExecutorError(error),
      }),
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = recordedFailure.snapshot
    const paidUsage = result?.usage
      ?? (error instanceof ProductProductionDraftRejectedErrorV1
        || error instanceof ProductProductionRetryableExecutionErrorV1
        ? error.usage : paidUsageFromExecutorError(error))
    let paidUsageBudgetExceeded = false
    if (paidUsage != null) {
      try {
        boundedUsage(paidUsage, attemptBudgetReservation)
      } catch (usageError) {
        if (usageError instanceof Error
          && usageError.message.includes('task usage 超出 Plan 预算预留')) {
          paidUsageBudgetExceeded = true
        } else {
          throw usageError
        }
      }
    }
    const providerTransportResultUnknown = costBearing(input.task)
      && paidUsage == null
      && isProviderTransportResultUnknown(error)
    const code = timedOut || (error instanceof Error && error.name === 'TimeoutError') ? 'task-timeout'
      : error instanceof Error && error.name === 'AbortError' ? 'task-aborted'
      : error instanceof ProductProductionDraftRejectedErrorV1 ? 'task-draft-rejected'
      : error instanceof ProductProductionResultUnknownErrorV1 ? 'task-result-unknown'
      : providerTransportResultUnknown ? 'task-result-unknown'
      : error instanceof Error && error.message.includes('provider-safety-refusal')
        ? 'provider-safety-refusal'
        : paidUsageBudgetExceeded
          || (error instanceof Error && error.message.includes('task usage 超出 Plan 预算预留'))
          ? 'task-budget-exceeded'
          : !classifiedFailure.retryable ? 'task-executor-nonretryable' : 'task-executor-failed'
    const retryable = permitsAutomaticTaskRetry(code)
      && !['task-aborted', 'task-draft-rejected', 'task-executor-nonretryable'].includes(code)
      && classifiedFailure.retryable
      && attempt < input.task.maxAttempts
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: input.task.taskKey, attempt, code,
      retryable,
      category: code === 'task-aborted' ? 'cancelled'
        : code === 'task-timeout' ? 'transient'
        : code === 'provider-safety-refusal' || code === 'task-budget-exceeded' ? 'deterministic' : 'unknown',
      action: retryable ? 'retry' : 'fail',
    })
    const failure = {
      taskKey: input.task.taskKey, code, attempt, detail: safeExecutorError(error),
      failureProvenance: {
        runId: snapshot.run.id,
        rootRunId: snapshot.run.parentRunId,
        controlEpoch: input.build.controlEpoch,
        planHash: input.build.planHash,
        attempt,
      },
    }
    const cancellationReason = (reason: string) => (
      `${reason};code=${code};detail=${failure.detail}`.slice(0, 1_000)
    )
    try {
      // A sibling may already have stopped the Build, but this paid attempt
      // still belongs to the same immutable Build epoch and must be settled.
      await settleLedger({
        buildId: input.build.id, controlEpoch: input.build.controlEpoch, taskKey: input.task.taskKey,
        unknownUsageHold: paidUsage == null && costBearing(input.task)
          ? reservationUsage(attemptBudgetReservation) : null,
        entry: {
          runId: snapshot.run.id, attempt, status: 'failed', idempotencyKey: inputHash,
          candidateHash: null, terminalReceiptHash: null, passedGateIds: [],
          usage: paidUsage, errorCode: code,
        },
      })
    } catch (ledgerError) {
      const current = await db.productBuilds.get(input.build.id)
      if (!current || current.controlEpoch !== input.build.controlEpoch) {
        await append(input.scope, snapshot, 'run.cancelled', {
          reason: cancellationReason('task-failed-after-control-epoch-change'),
        })
        return
      }
      throw ledgerError
    }

    const disposition = await db.transaction(
      'rw', scopeTransactionTables(db.productBuilds, db.productProductions), async () => {
        const build = await db.productBuilds.get(input.build.id)
        const production = await db.productProductions.get(input.productionId)
        if (!build || !production || build.controlEpoch !== input.build.controlEpoch) return 'stale' as const
        const alreadyStopped = ['paused', 'cancelled', 'failed', 'recovery-required', 'archived', 'released']
          .includes(build.status)
        const status = input.task.failurePolicy === 'fail-build' ? 'failed' : 'recovery-required'
        const updatedAt = Date.now()
        await db.productBuilds.update(input.build.id, {
          ...(!retryable && !alreadyStopped ? { status } : {}),
          failureJson: canonicalProductProductionJsonV2(taskFailureEnvelope(
            build.failureJson,
            failure,
            { preservePrimary: alreadyStopped },
          )),
          updatedAt,
        })
        if (!retryable && !alreadyStopped && status === 'failed') {
          await db.productProductions.update(input.productionId, {
            status: 'failed', stateRevision: production.stateRevision + 1, updatedAt,
          })
        }
        return alreadyStopped ? 'sibling-stopped' as const
          : retryable ? 'retry' as const : 'terminal' as const
      },
    )
    if (disposition === 'stale') {
      await append(input.scope, snapshot, 'run.cancelled', {
        reason: cancellationReason('task-failed-after-control-epoch-change'),
      })
      return
    }
    if (disposition === 'sibling-stopped') {
      await append(input.scope, snapshot, 'run.cancelled', {
        reason: cancellationReason('task-failed-after-sibling-build-stop'),
      })
      return
    }
    if (disposition === 'terminal') {
      if (code === 'task-aborted') {
        await append(input.scope, snapshot, 'run.cancelled', { reason: 'task-executor-aborted' })
      } else {
        await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
      }
    }
    return
  } finally {
    if (timeoutHandle != null) globalThis.clearTimeout(timeoutHandle)
    input.signal.removeEventListener('abort', abortFromParent)
  }
  if (!result) throw new Error('[product-production-scheduler] executor 未返回结果')
  // The executor may own nested model/tool boundaries on the same durable
  // Run. Always append the outer response/candidate from the latest sequence.
  snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
  const candidateHash = await hashProductProductionValueV2(result)
  if (authorizedDirectResult) {
    snapshot = await append(input.scope, snapshot, 'tool.returned', {
      stepId: input.task.taskKey,
      attempt,
      toolName: authorizedRepair
        ? 'text-open-world-creator-repair-adoption'
        : 'text-open-world-creator-media-import-adoption',
      resultHash: candidateHash,
    })
  } else if (input.task.executionMode === 'model' && !authorDraftJson && !executorOwnsWorldGateway) {
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: input.task.taskKey, attempt, outputHash: candidateHash,
    })
  } else if (input.task.executionMode === 'media-provider') {
    snapshot = await append(input.scope, snapshot, 'tool.returned', {
      stepId: input.task.taskKey, attempt,
      toolName: localProceduralMedia ? LOCAL_PROCEDURAL_MEDIA_TOOL : 'game-media-provider',
      resultHash: candidateHash,
    })
  } else if (worldGatewayRequired) {
    snapshot = await append(input.scope, snapshot, 'tool.returned', {
      stepId: input.task.taskKey, attempt, toolName: DETERMINISTIC_WORLD_TOOL, resultHash: candidateHash,
    })
  }
  if (worldGatewayRequired) {
    if (!gatewayExecution || !gatewayBaseManifest || !gatewayPreflight) {
      throw new Error('[product-production-scheduler] 世界来源任务缺少冻结 Gateway 证据')
    }
    const finalized = await finalizeContextGatewayAttemptEvidenceV1({
      scope: input.scope,
      runId: snapshot.run.id,
      stepId: input.task.taskKey,
      attempt,
      baseManifest: gatewayBaseManifest,
      preflight: gatewayPreflight,
      selector: gatewayExecution.selector,
      sufficiency: gatewayExecution.sufficiency,
      retrievalTrace: gatewayExecution.retrievalTrace,
      gatewayVersionHash: gatewayExecution.contextPacket.gatewayVersionHash,
      policyHash: gatewayExecution.contextPacket.policyHash,
      rawResponse: result,
      candidateHash,
      executionBoundary: input.task.executionMode === 'model' && !authorDraftJson
        ? { kind: 'model' }
        : { kind: 'tool', toolName: DETERMINISTIC_WORLD_TOOL },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = finalized.snapshot
  }
  await input.onDurableBoundary?.('provider.responded', snapshot)
  const current = await db.productBuilds.get(input.build.id)
  if (!current || current.controlEpoch !== input.build.controlEpoch
    || ['paused', 'cancelled', 'failed', 'recovery-required', 'archived', 'released'].includes(current.status)) {
    snapshot = await append(input.scope, snapshot, 'budget.settled', {
      stepId: input.task.taskKey,
      modelCalls: result.usage.modelCalls,
      toolCalls: result.usage.mediaCalls,
      tokens: result.usage.inputTokens + result.usage.outputTokens,
    })
    await append(input.scope, snapshot, 'run.cancelled', { reason: 'late-result-after-control-epoch-change' })
    return
  }
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: input.task.taskKey, attempt, candidateHash, requiresConfirmation: false,
  })
  const resumePayload: ResumeCandidateV1 = {
    schema: 'storyforge.product-production-task-candidate', version: 1,
    taskKey: input.task.taskKey, attempt, controlEpoch: input.build.controlEpoch,
    inputHash, candidateHash, result,
  }
  const checkpointed = await createAgentRunCheckpointV1({
    scope: input.scope, runId: snapshot.run.id,
    expectedLastSequence: snapshot.projection.lastSequence, resumePayload,
  })
  snapshot = checkpointed.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await finishCandidateRun({ scope: input.scope, snapshot, task: input.task, candidate: resumePayload })
  await acceptCandidate({
    scope: input.scope, buildId: input.build.id, controlEpoch: input.build.controlEpoch,
    task: input.task, snapshot, candidate: resumePayload,
  })
  await input.onDurableBoundary?.('artifact.accepted', snapshot)
}

/**
 * A claimed child Run must never be left in `running` merely because setup or
 * post-provider evidence handling threw outside the executor timeout boundary.
 *
 * Preflight failures are deterministic until an author/developer changes the
 * inputs, while failures after a durable provider-request event are
 * deliberately classified as result-unknown. Neither is retried implicitly:
 * the former would repeat the same invalid input and the latter could bill the
 * provider twice. A verified candidate checkpoint remains recoverable by the
 * normal checkpoint path and is therefore not rewritten here.
 */
async function settleEscapedClaimedTaskFailure(input: {
  scope: WorkspaceScope
  productionId: number
  build: { id: number; controlEpoch: number; failureJson: string }
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
}, error: unknown): Promise<void> {
  let snapshot = await readAgentRunV1(input.scope, input.snapshot.run.id)
  const step = snapshot.projection.steps[input.task.taskKey]
  if (!step || step.status !== 'running') throw error

  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
  if (checkpoint?.resumePayload || step.candidateHash) throw error

  const current = await db.productBuilds.get(input.build.id)
  if (!current || current.controlEpoch !== input.build.controlEpoch
    || ['paused', 'cancelled', 'failed', 'recovery-required', 'archived', 'released'].includes(current.status)) {
    await append(input.scope, snapshot, 'run.cancelled', { reason: 'task-error-after-control-epoch-change' })
    return
  }

  const providerRequested = snapshot.events.some(event => (
    event.type === 'model.requested' || event.type === 'tool.called'
  ))
  const providerResponded = snapshot.events.some(event => (
    event.type === 'model.responded' || event.type === 'tool.returned'
  ))
  const budgetPreflightFailed = error instanceof Error
    && error.message.includes('Build lifetime budget')
  const code = budgetPreflightFailed
    ? 'task-budget-exceeded'
    : providerResponded
      ? 'task-finalization-failed'
      : providerRequested ? 'task-result-unknown' : 'task-preflight-failed'
  const failure = {
    taskKey: input.task.taskKey,
    code,
    attempt: Math.max(1, step.attempt),
    detail: safeExecutorError(error),
    failureProvenance: {
      runId: snapshot.run.id,
      rootRunId: snapshot.run.parentRunId,
      controlEpoch: input.build.controlEpoch,
      planHash: snapshot.contract.scope.productProduction?.planHash,
      attempt: Math.max(1, step.attempt),
    },
  }
  snapshot = await append(input.scope, snapshot, 'step.failed', {
    stepId: input.task.taskKey,
    attempt: failure.attempt,
    code,
    retryable: false,
    category: providerRequested ? 'unknown' : 'deterministic',
    action: 'fail',
  })
  snapshot = await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
  await settleLedger({
    buildId: input.build.id,
    controlEpoch: input.build.controlEpoch,
    taskKey: input.task.taskKey,
    unknownUsageHold: providerRequested ? reservationUsage(input.task.budgetReservation) : null,
    entry: {
      runId: snapshot.run.id,
      attempt: failure.attempt,
      status: 'failed',
      idempotencyKey: '',
      candidateHash: null,
      terminalReceiptHash: null,
      passedGateIds: [],
      usage: null,
      errorCode: code,
    },
  })
  await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productProductions), async () => {
    const build = await db.productBuilds.get(input.build.id)
    const production = await db.productProductions.get(input.productionId)
    if (!build || !production || build.controlEpoch !== input.build.controlEpoch) return
    const status = input.task.failurePolicy === 'fail-build' ? 'failed' : 'recovery-required'
    const updatedAt = Date.now()
    await db.productBuilds.update(input.build.id, {
      status,
      failureJson: canonicalProductProductionJsonV2(taskFailureEnvelope(build.failureJson, failure)),
      updatedAt,
    })
    if (status === 'failed') {
      await db.productProductions.update(input.productionId, {
        status: 'failed',
        stateRevision: production.stateRevision + 1,
        updatedAt,
      })
    }
  })
}

async function runClaimedTask(input: Parameters<typeof runClaimedTaskCore>[0]): Promise<void> {
  try {
    await runClaimedTaskCore(input)
  } catch (error) {
    if (error instanceof ProductProductionDurableBoundaryInterruptionV1) throw error
    await settleEscapedClaimedTaskFailure(input, error)
  }
}

function attemptHasEvent(
  snapshot: AgentRunSnapshotV1,
  type: 'model.requested' | 'model.responded' | 'candidate.persisted',
  taskKey: string,
  attempt: number,
): boolean {
  return snapshot.events.some(event => event.type === type
    && event.payload.stepId === taskKey
    && event.payload.attempt === attempt)
}

function attemptHasMediaEvent(
  snapshot: AgentRunSnapshotV1,
  type: 'tool.called' | 'tool.returned',
  taskKey: string,
  attempt: number,
): boolean {
  return snapshot.events.some(event => event.type === type
    && event.payload.stepId === taskKey
    && event.payload.attempt === attempt
    && event.payload.toolName === 'game-media-provider')
}

/**
 * A browser refresh/HMR discards the promise that owned an in-flight child
 * Run, but its append-only events remain. Re-entry must classify those events
 * before they consume concurrency forever or dispatch the provider twice.
 *
 * - no external provider boundary: fail the abandoned attempt with zero usage
 *   and let the frozen maxAttempts contract decide whether it can be reclaimed;
 * - provider requested without a verified candidate checkpoint: preserve an
 *   unknown-usage hold and stop at an explicit author recovery boundary;
 * - provider responded/candidate hash without a checkpoint payload: the bytes
 *   cannot be reconstructed, so finalization also requires author recovery.
 */
async function reconcileAbandonedTaskRunsV1(input: {
  scope: WorkspaceScope
  build: { id: number; controlEpoch: number; failureJson: string }
  plan: ProductProductionPlanV3
  children: Map<string, AgentRunSnapshotV1>
}): Promise<{ blocked: boolean; reclaimableRunIds: Set<number> }> {
  const reclaimableRunIds = new Set<number>()
  const blockers: Array<Record<string, unknown>> = []

  for (const task of input.plan.tasks) {
    let snapshot = input.children.get(task.taskKey)
    if (!snapshot || !['planned', 'running'].includes(snapshot.projection.state)) continue
    const lastDurableEventAt = snapshot.events[snapshot.events.length - 1]?.createdAt
      ?? snapshot.run.updatedAt
    const localProceduralBoundary = snapshot.events.some(event => (
      event.type === 'tool.called'
      && event.payload.toolName === LOCAL_PROCEDURAL_MEDIA_TOOL
    ))
    const recoveryGraceMs = localProceduralBoundary ? 0 : ABANDONED_TASK_GRACE_MS
    const deadlineExpired = Date.now() - lastDurableEventAt > task.timeoutMs + recoveryGraceMs
    if (!deadlineExpired) {
      // Process-local ownership cannot see a legitimate request in another
      // browser tab/worker. A recent durable heartbeat/boundary therefore
      // remains running until its frozen task timeout plus grace has elapsed.
      continue
    }
    // An in-memory owner is not authority beyond the frozen deadline. Browser
    // background throttling, lock-screen suspension or HMR can preserve a
    // stale module-local Set while delaying/lossing the timeout callback. A
    // second scheduler cycle must still enforce the durable absolute deadline
    // and classify any post-provider attempt as result-unknown rather than
    // leaving the Build permanently `building`.
    const step = snapshot.projection.steps[task.taskKey]
    if (!step) {
      // The process stopped after the child contract was claimed but before
      // step.started/provider dispatch. The same immutable Run can be resumed.
      reclaimableRunIds.add(snapshot.run.id)
      continue
    }
    if (step.status !== 'running') continue

    const attempt = Math.max(1, step.attempt)
    const providerRequested = task.executionMode === 'model'
      ? attemptHasEvent(snapshot, 'model.requested', task.taskKey, attempt)
      : task.executionMode === 'media-provider'
        ? attemptHasMediaEvent(snapshot, 'tool.called', task.taskKey, attempt)
        : false
    const providerResponded = task.executionMode === 'model'
      ? attemptHasEvent(snapshot, 'model.responded', task.taskKey, attempt)
      : task.executionMode === 'media-provider'
        ? attemptHasMediaEvent(snapshot, 'tool.returned', task.taskKey, attempt)
        : false
    const candidatePersisted = attemptHasEvent(
      snapshot, 'candidate.persisted', task.taskKey, attempt,
    ) || step.candidateHash != null
    const ledger = parseLedger((await db.productBuilds.get(input.build.id))!.budgetLedgerJson)
    const claimed = ledger.tasks[task.taskKey]
    const idempotencyKey = claimed?.runId === snapshot.run.id
      && claimed.attempt === attempt ? claimed.idempotencyKey : ''

    if (!providerRequested && !providerResponded && !candidatePersisted) {
      const code = 'task-timeout-before-dispatch'
      const retryable = attempt < task.maxAttempts
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: task.taskKey, attempt, code, retryable,
        category: 'transient', action: retryable ? 'retry' : 'fail',
      })
      if (!retryable) {
        snapshot = await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
      }
      await settleLedger({
        buildId: input.build.id, controlEpoch: input.build.controlEpoch, taskKey: task.taskKey,
        entry: {
          runId: snapshot.run.id, attempt, status: 'failed', idempotencyKey,
          candidateHash: null, terminalReceiptHash: null, passedGateIds: [],
          usage: zeroUsage(), errorCode: code,
        },
      })
      if (!retryable) blockers.push({
        taskKey: task.taskKey, code, attempt,
        detail: '调度进程在 provider 调用前中断，且本任务的冻结重试次数已经耗尽。',
      })
      continue
    }

    const code = providerRequested && !providerResponded && !candidatePersisted
      ? 'provider-result-unknown' : 'task-finalization-failed'
    const detail = code === 'provider-result-unknown'
      ? '调度进程在 provider 请求后中断；结果与实际用量均未知，禁止自动重复调用，必须由作者显式确认重试。'
      : 'provider 已返回或候选 hash 已记录，但缺少可验证的候选检查点 payload；禁止自动重复调用，必须由作者显式确认重试。'
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: task.taskKey, attempt, code, retryable: false,
      category: 'unknown', action: 'fail',
    })
    snapshot = await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
    await settleLedger({
      buildId: input.build.id, controlEpoch: input.build.controlEpoch, taskKey: task.taskKey,
      unknownUsageHold: costBearing(task) ? reservationUsage(task.budgetReservation) : null,
      entry: {
        runId: snapshot.run.id, attempt, status: 'failed', idempotencyKey,
        candidateHash: null, terminalReceiptHash: null, passedGateIds: [],
        usage: null, errorCode: code,
      },
    })
    blockers.push({ taskKey: task.taskKey, code, attempt, detail })
  }

  if (blockers.length > 0) {
    await db.transaction('rw', db.productBuilds, async () => {
      const build = await db.productBuilds.get(input.build.id)
      if (!build || build.controlEpoch !== input.build.controlEpoch) return
      let failureJson = build.failureJson
      blockers.forEach((failure, index) => {
        failureJson = canonicalProductProductionJsonV2(taskFailureEnvelope(
          failureJson, failure, { preservePrimary: index > 0 },
        ))
      })
      await db.productBuilds.update(build.id!, {
        status: 'recovery-required', failureJson, updatedAt: Date.now(),
      })
    })
  }
  return { blocked: blockers.length > 0, reclaimableRunIds }
}

async function compileTerminalBuild(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  root: AgentRunSnapshotV1
  plan: ProductProductionPlanV3
  brief: ProductProductionBriefV3
}): Promise<string> {
  const build = await db.productBuilds.get(input.buildId)
  const production = await db.productProductions.get(input.productionId)
  if (!build || !production || build.controlEpoch !== input.plan.controlEpoch) {
    throw new Error('[product-production-scheduler] terminal join Build 已过期')
  }
  const artifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .filter(row => row.controlEpoch === build.controlEpoch && (row.status === 'accepted' || row.status === 'carried-forward'))
    .sort((a, b) => a.artifactKey.localeCompare(b.artifactKey) || a.version - b.version)
  if (new Set(artifacts.map(row => row.artifactKey)).size !== artifacts.length) {
    throw new Error('[product-production-scheduler] terminal Artifact key 不唯一')
  }
  const terminalArtifactKeys = productProductionTerminalArtifactKeysV1(input.plan.productType)
  const packageArtifact = artifacts.find(row => row.artifactKey === terminalArtifactKeys.runtimePackage)
  const qualityArtifact = artifacts.find(row => row.artifactKey === terminalArtifactKeys.qualityReport)
  if (!packageArtifact || !qualityArtifact) throw new Error('[product-production-scheduler] terminal package/quality Artifact 缺失')
  const runtimePackage = parseProductRuntimePackageV1(packageArtifact.payloadJson)
  const packageHash = await hashProductProductionValueV2(runtimePackage)
  if (packageArtifact.contentHash !== packageHash) throw new Error('[product-production-scheduler] package Artifact hash 不一致')
  let previousPackage: Parameters<typeof createProductBuildCompatibilityReportV1>[0]['previous'] = null
  if (build.parentBuildNumber != null) {
    const lineageParent = await db.productBuilds
      .where('[productionId+buildNumber]').equals([build.productionId, build.parentBuildNumber]).first()
    if (!lineageParent?.id
      || !await assertRecordInScope(input.scope, 'productBuilds', lineageParent, { owner: 'work' })) {
      throw new Error('[product-production-scheduler] compatibility lineage parent Build 缺失')
    }
    const scopedPriorBuilds: ProductBuildRecordV1[] = []
    for (const priorBuild of await db.productBuilds.where('productionId').equals(build.productionId).toArray()) {
      if (priorBuild.buildNumber < build.buildNumber
        && await assertRecordInScope(input.scope, 'productBuilds', priorBuild, { owner: 'work' })) {
        scopedPriorBuilds.push(priorBuild)
      }
    }
    const parentBuild = selectProductBuildCompatibilityBaselineV1({
      currentBuildNumber: build.buildNumber,
      parentBuildNumber: build.parentBuildNumber,
      priorBuilds: scopedPriorBuilds,
    })
    if (parentBuild?.id != null) {
      let parentArtifacts = (await db.productBuildArtifacts
        .where('[buildId+artifactKey]')
        .equals([parentBuild.id, terminalArtifactKeys.runtimePackage]).toArray())
        .filter(row => row.controlEpoch === parentBuild.controlEpoch
          && (row.status === 'accepted' || row.status === 'carried-forward'))
      // Builds created before the dedicated text-open-world DAG used the
      // generic package key. It is valid as compatibility input only; every
      // new Build still emits the dedicated terminal key above.
      if (parentArtifacts.length === 0 && input.plan.productType === 'text-open-world') {
        parentArtifacts = (await db.productBuildArtifacts
          .where('[buildId+artifactKey]').equals([parentBuild.id, 'runtime.package']).toArray())
          .filter(row => row.controlEpoch === parentBuild.controlEpoch
            && (row.status === 'accepted' || row.status === 'carried-forward'))
      }
      if (parentArtifacts.length !== 1) {
        throw new Error('[product-production-scheduler] compatibility parent package Artifact 缺失')
      }
      const parentArtifact = parentArtifacts[0]
      const parentRuntimePackage = parseProductRuntimePackageV1(parentArtifact.payloadJson)
      if (await hashProductProductionValueV2(parentRuntimePackage) !== parentBuild.packageHash) {
        throw new Error('[product-production-scheduler] compatibility parent package hash 不一致')
      }
      previousPackage = {
        buildNumber: parentBuild.buildNumber, packageHash: parentBuild.packageHash,
        runtimePackage: parentRuntimePackage,
      }
    }
  }
  const compatibility = await createProductBuildCompatibilityReportV1({
    previous: previousPackage,
    current: { buildNumber: build.buildNumber, packageHash, runtimePackage },
  })
  const quality = parseProductBuildQualityReportV1(qualityArtifact.payloadJson)
  const qualityReportHash = await hashProductProductionValueV2(quality)
  if (qualityArtifact.contentHash !== qualityReportHash || quality.packageHash !== packageHash) {
    throw new Error('[product-production-scheduler] quality Artifact/package hash 不一致')
  }
  const ledger = parseLedger(build.budgetLedgerJson)
  const children = await childSnapshots(input.scope, build.id!, input.root.run.id)
  const taskReceipts = input.plan.tasks.map(task => {
    const child = children.get(task.taskKey)
    const entry = ledger.tasks[task.taskKey]
    if (!child?.projection.terminalReceiptHash || entry?.status !== 'settled'
      || entry.terminalReceiptHash !== child.projection.terminalReceiptHash) {
      throw new Error(`[product-production-scheduler] terminal child receipt 未结算:${task.taskKey}`)
    }
    return { taskKey: task.taskKey, receiptHash: child.projection.terminalReceiptHash }
  })
  const completedGateIds = [...new Set(Object.values(ledger.tasks).flatMap(entry => entry.passedGateIds))].sort()
  const artifactReceipts = artifacts.map(row => ({
    artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash,
    producerReceiptHash: row.producerReceiptHash,
  }))
  const fallbackSummary = runtimePackage.textOpenWorldVNext == null
    ? []
    : parseTextOpenWorldModulesV1(runtimePackage.textOpenWorldVNext).presentation.mediaSlots
      .filter(slot => slot.assetKey == null)
      .map(slot => `媒资槽 ${slot.key} 使用${slot.kind}降级表现`)
      .sort()
  const manifest = {
    schema: 'storyforge.product-build-manifest' as const, version: 1 as const,
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    briefRevision: build.briefRevision, briefHash: build.briefHash, planHash: build.planHash,
    controlEpoch: build.controlEpoch, runtimePackageHash: packageHash,
    artifactReceipts, completedGateIds, fallbackSummary,
  }
  const manifestHash = await hashProductProductionValueV2(manifest)
  const mediaBindings = (runtimePackage.presentation?.assets ?? []).map(asset => {
    const artifact = artifacts.find(row => row.blobObjectId != null && row.contentHash === asset.blobContentHash)
    if (!artifact || artifact.mimeType !== asset.mimeType || artifact.byteSize !== asset.byteSize) {
      throw new Error(`[product-production-scheduler] RuntimePackage 媒资未绑定 accepted Artifact:${asset.assetKey}`)
    }
    return { assetKey: asset.assetKey, artifactKey: artifact.artifactKey, blobContentHash: asset.blobContentHash }
  })
  const preview = await createProductBuildPreviewManifestV1({
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    buildManifestHash: manifestHash, runtimePackage, mediaBindings, fallbackSummary,
  })
  const rootTerminalReceiptHash = await createProductBuildRootTerminalReceiptV1({
    planHash: build.planHash, manifestHash, packageHash, qualityReportHash,
    controlEpoch: build.controlEpoch, budgetLedgerJson: build.budgetLedgerJson, artifacts,
  })
  let root = input.root
  const importedRootReceipt = importedScopeReboundReceiptV1(root)
  if (importedRootReceipt) {
    const rootStep = root.projection.steps[ROOT_STEP_ID]
    if (rootStep?.status !== 'succeeded' || importedRootReceipt !== build.rootTerminalReceiptHash) {
      throw new Error('[product-production-scheduler] 导入 root 完成证据无法在新 scope 复验')
    }
    root = await append(input.scope, root, 'verification.started', {
      verifierSetVersion: 'product-production-root-import-rebind-v1',
    })
    root = await append(input.scope, root, 'verification.accepted', {
      receiptHash: rootTerminalReceiptHash,
    })
  } else if (root.projection.state !== 'completed') {
    root = await append(input.scope, root, 'step.succeeded', {
      stepId: ROOT_STEP_ID, attempt: 1,
      outputHash: await hashProductProductionValueV2({ manifestHash, taskReceipts }),
    })
    root = await append(input.scope, root, 'verification.started', { verifierSetVersion: 'product-production-root-v1' })
    root = await append(input.scope, root, 'verification.accepted', { receiptHash: rootTerminalReceiptHash })
  } else if (root.projection.terminalReceiptHash !== rootTerminalReceiptHash) {
    throw new Error('[product-production-scheduler] root Run terminal receipt 与 Build join 不一致')
  }
  await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productProductions, db.productBuildArtifacts), async () => {
    const current = await db.productBuilds.get(build.id!)
    const currentProduction = await db.productProductions.get(production.id!)
    if (!current || !currentProduction || current.controlEpoch !== build.controlEpoch || current.planHash !== build.planHash) {
      throw new Error('[product-production-scheduler] terminal commit CAS 已过期')
    }
    const currentArtifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
      .filter(row => row.controlEpoch === build.controlEpoch && (row.status === 'accepted' || row.status === 'carried-forward'))
    if (currentArtifacts.length !== artifacts.length) throw new Error('[product-production-scheduler] terminal commit Artifact 集合变化')
    const packageQualityReady = quality.playable && quality.releaseReady
      && quality.hardGateResults.every(gate => gate.passed)
    // A commercial Build is playable after package QA, but it is not release
    // ready until the latest real-browser performance receipt passes. The
    // receipt service performs that later, evidence-bound promotion.
    const releaseReady = packageQualityReady && input.brief.qualityProfile !== 'commercial-candidate'
    await db.productBuilds.update(build.id!, {
      status: releaseReady ? 'release-ready' : 'preview-ready',
      stateRevision: current.stateRevision + 1,
      manifestJson: canonicalProductProductionJsonV2(manifest), manifestHash, packageHash,
      previewManifestJson: canonicalProductProductionJsonV2(preview), previewHash: preview.previewHash,
      qualityReportJson: canonicalProductProductionJsonV2(quality), qualityReportHash,
      compatibilityJson: canonicalProductProductionJsonV2(compatibility),
      rootTerminalReceiptHash, completedAt: Date.now(), updatedAt: Date.now(),
    })
    await db.productProductions.update(production.id!, {
      status: 'preview-ready', stateRevision: currentProduction.stateRevision + 1, updatedAt: Date.now(),
    })
  })
  return rootTerminalReceiptHash
}

export async function projectProductProductionSchedulerV1(input: {
  scope: WorkspaceScope
  productionId: number
  suppliedPlan?: ProductProductionPlanV3
}): Promise<ProductProductionSchedulerProjectionV1> {
  const scope = await resolveScope({ scope: input.scope })
  const current = await currentProductionBuild(scope, input.productionId)
  let plan: ProductProductionPlanV3 | null = null
  try {
    plan = input.suppliedPlan
      ? parseProductProductionPlanV3(input.suppliedPlan, current.brief, current.briefRow.briefHash)
      : parseProductProductionPlanV3(current.build.planJson, current.brief, current.briefRow.briefHash)
  } catch { plan = null }
  const build = current.build
  const ledger = parseLedger(build.budgetLedgerJson)
  const rootRunId = ledger.rootRunId
  const root: AgentRunSnapshotV1 | null = rootRunId == null ? null : await readAgentRunV1(scope, rootRunId)
  const children = root ? await childSnapshots(scope, build.id!, root.run.id) : new Map<string, AgentRunSnapshotV1>()
  const completed = new Map<string, string>()
  for (const [taskKey, child] of children) {
    if (child.projection.state === 'completed' && child.projection.terminalReceiptHash) {
      completed.set(taskKey, child.projection.terminalReceiptHash)
    }
  }
  const recordedTaskFailures = textAdventureTaskFailures(build.failureJson)
  const tasks = await Promise.all((plan?.tasks ?? []).map(async task => {
    const child = children.get(task.taskKey)
    const recordedFailure = recordedTaskFailures.get(task.taskKey)
    const failureDetail = typeof recordedFailure?.detail === 'string'
      ? recordedFailure.detail.slice(0, 500) : null
    const dependenciesReady = task.requiredReceipts.every(edge => {
      const receipt = completed.get(edge.taskKey)
      return !!receipt && (edge.receiptHash == null || edge.receiptHash === receipt)
    })
    let status: ProductProductionTaskProjectionV1['status'] = dependenciesReady ? 'ready' : 'waiting'
    let blocker: string | null = null
    let recoveryCheckAt: number | null = null
    if (child) {
      const step = child.projection.steps[task.taskKey]
      if (child.contract.scope.productProduction?.controlEpoch !== build.controlEpoch) status = 'stale'
      else if (child.projection.state === 'completed') status = 'completed'
      else if (['failed', 'cancelled', 'recovery_required', 'paused'].includes(child.projection.state)) {
        status = 'blocked'
        blocker = failureDetail ?? step?.failureCode ?? `run-${child.projection.state}`
      } else if (step?.status === 'failed' && permitsAutomaticTaskRetry(step.failureCode)
        && step.attempt < task.maxAttempts) {
        status = 'retry-ready'
        blocker = failureDetail ?? step.failureCode ?? 'task-executor-failed'
      } else {
        status = 'running'
        const lastDurableEventAt = child.events[child.events.length - 1]?.createdAt
          ?? child.run.updatedAt
        recoveryCheckAt = lastDurableEventAt + task.timeoutMs + ABANDONED_TASK_GRACE_MS
      }
    }
    const latestEvent = child?.events[child.events.length - 1]
    return {
      taskKey: task.taskKey, lane: task.lane, status,
      runId: child?.run.id ?? null, attempt: child?.projection.steps[task.taskKey]?.attempt ?? 0,
      terminalReceiptHash: child?.projection.terminalReceiptHash ?? null, blocker, recoveryCheckAt,
      latestDurableBoundary: latestEvent ? durableBoundaryFromEventV1(latestEvent) : null,
      checkpoint: child ? await projectTaskCheckpointV1(scope, child) : null,
      steps: child ? projectTaskStepsV1(child) : [],
    }
  }))
  // Build-lifetime accounting includes every terminal attempt, including
  // failed retries and previous recovery epochs. Current task projection is
  // intentionally not a source of budget truth.
  const settledUsage = ledger.attempts.flatMap(entry => entry.usage ? [entry.usage] : [])
  const knownCosts = settledUsage.map(usage => usage.costUsd)
  const usage: ProductProductionTaskUsageV1 = {
    modelCalls: settledUsage.reduce((sum, item) => sum + item.modelCalls, 0),
    inputTokens: settledUsage.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: settledUsage.reduce((sum, item) => sum + item.outputTokens, 0),
    mediaCalls: settledUsage.reduce((sum, item) => sum + item.mediaCalls, 0),
    costUsd: knownCosts.some(value => value == null)
      ? null : knownCosts.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    durationMs: settledUsage.reduce((sum, item) => sum + item.durationMs, 0),
    storageBytes: settledUsage.reduce((sum, item) => sum + item.storageBytes, 0),
  }
  return {
    productionId: input.productionId, buildId: build.id!, buildNumber: build.buildNumber,
    buildStatus: build.status, controlEpoch: build.controlEpoch, planHash: build.planHash,
    rootRunId: root?.run.id ?? null, terminal: root?.projection.state === 'completed',
    budget: { usage, limits: structuredClone(current.brief.productionBudget) }, tasks,
  }
}

function importedScopeReboundReceiptV1(snapshot: AgentRunSnapshotV1): string | null {
  const last = snapshot.events[snapshot.events.length - 1]
  if (snapshot.projection.state !== 'running'
    || last?.type !== 'verification.staled'
    || last.payload.reason !== 'project-import-scope-rebound'
    || !isSha256Hash(last.payload.previousReceiptHash)
    || Object.values(snapshot.projection.steps).some(step => step.status !== 'succeeded')) {
    return null
  }
  return last.payload.previousReceiptHash
}

async function revalidateImportedCheckpointedTaskV1(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
  candidate: ResumeCandidateV1
}): Promise<AgentRunSnapshotV1 | null> {
  const previousReceiptHash = importedScopeReboundReceiptV1(input.snapshot)
  if (!previousReceiptHash) return null
  const candidateHash = await hashProductProductionValueV2(input.candidate.result)
  const receiptHash = await hashProductProductionValueV2({
    schema: 'storyforge.product-production-task-receipt', version: 1,
    taskKey: input.task.taskKey, attempt: input.candidate.attempt,
    inputHash: input.candidate.inputHash, candidateHash,
    passedGateIds: input.candidate.result.passedGateIds,
    usage: input.candidate.result.usage,
    controlEpoch: input.controlEpoch,
  })
  const build = await db.productBuilds.get(input.buildId)
  const ledger = build == null ? null : parseLedger(build.budgetLedgerJson).tasks[input.task.taskKey]
  const rows = build == null ? [] : (await db.productBuildArtifacts
    .where('buildId').equals(input.buildId).toArray())
    .filter(row => row.controlEpoch === input.controlEpoch
      && row.status === 'accepted'
      && input.task.outputArtifactKeys.includes(row.artifactKey))
  const expectedKeys = [...input.task.outputArtifactKeys].sort()
  const actualKeys = rows.map(row => row.artifactKey).sort()
  if (!build || build.controlEpoch !== input.controlEpoch
    || candidateHash !== input.candidate.candidateHash
    || receiptHash !== previousReceiptHash
    || ledger?.status !== 'settled'
    || ledger.runId !== input.snapshot.run.id
    || ledger.attempt !== input.candidate.attempt
    || ledger.idempotencyKey !== input.candidate.inputHash
    || ledger.candidateHash !== candidateHash
    || ledger.terminalReceiptHash !== receiptHash
    || ledger.errorCode !== null
    || canonicalProductProductionJsonV2(ledger.passedGateIds)
      !== canonicalProductProductionJsonV2(input.candidate.result.passedGateIds)
    || canonicalProductProductionJsonV2(ledger.usage)
      !== canonicalProductProductionJsonV2(input.candidate.result.usage)
    || rows.length !== expectedKeys.length
    || expectedKeys.some((key, index) => key !== actualKeys[index])
    || rows.some(row => row.producerRunId !== input.snapshot.run.id
      || row.producerReceiptHash !== receiptHash
      || row.inputHash !== input.candidate.inputHash)) {
    throw new Error(
      `[product-production-scheduler] 导入 task 完成证据无法在新 scope 复验:${input.task.taskKey}`,
    )
  }
  let snapshot = await append(input.scope, input.snapshot, 'verification.started', {
    verifierSetVersion: 'product-production-task-import-rebind-v1',
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash })
  return snapshot
}

async function revalidateImportedCarriedTaskV1(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
  dependencies: Array<{ taskKey: string; receiptHash: string }>
  candidateHash: string
  outputs: ProductBuildArtifactRecordV1[]
}): Promise<AgentRunSnapshotV1 | null> {
  const previousReceiptHash = importedScopeReboundReceiptV1(input.snapshot)
  if (!previousReceiptHash) return null
  const build = await db.productBuilds.get(input.buildId)
  const ledger = build == null ? null : parseLedger(build.budgetLedgerJson).tasks[input.task.taskKey]
  const executionIdentityHash = await productProductionTaskExecutionIdentityHashV1(input.task)
  const receiptHash = ledger == null ? '' : await hashProductProductionValueV2({
    schema: 'storyforge.product-production-carried-task-receipt', version: 1,
    taskKey: input.task.taskKey, inputHash: ledger.idempotencyKey,
    candidateHash: input.candidateHash, dependencies: input.dependencies,
    executionIdentityHash,
    passedGateIds: input.task.acceptanceGateIds,
    controlEpoch: input.controlEpoch,
  })
  const step = input.snapshot.projection.steps[input.task.taskKey]
  if (!build || build.controlEpoch !== input.controlEpoch
    || receiptHash !== previousReceiptHash
    || ledger?.status !== 'settled'
    || ledger.runId !== input.snapshot.run.id
    || ledger.attempt !== 1
    || ledger.candidateHash !== input.candidateHash
    || ledger.terminalReceiptHash !== receiptHash
    || ledger.errorCode !== null
    || canonicalProductProductionJsonV2(ledger.passedGateIds)
      !== canonicalProductProductionJsonV2(input.task.acceptanceGateIds)
    || canonicalProductProductionJsonV2(ledger.usage) !== canonicalProductProductionJsonV2(zeroUsage())
    || step?.status !== 'succeeded' || step.attempt !== 1
    || step.candidateHash != null || step.outputHash !== input.candidateHash
    || input.outputs.length !== input.task.outputArtifactKeys.length
    || input.outputs.some(row => row.producerRunId !== input.snapshot.run.id
      || row.producerReceiptHash !== receiptHash
      || row.inputHash !== ledger.idempotencyKey)) {
    throw new Error(
      `[product-production-scheduler] 导入 carried task 完成证据无法在新 scope 复验:${input.task.taskKey}`,
    )
  }
  let snapshot = await append(input.scope, input.snapshot, 'verification.started', {
    verifierSetVersion: 'product-production-carried-task-import-rebind-v1',
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash })
  return snapshot
}

/**
 * Complete project backup import deliberately invalidates cloned Harness
 * receipts after local IDs are rebound. A sealed text-open-world Build carries
 * every candidate checkpoint, Artifact envelope, ledger entry and root seal,
 * so the proof can be reconstructed locally without another provider call.
 */
export async function recoverImportedProductProductionProofsV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<ProductProductionSchedulerProjectionV1> {
  const scope = await resolveScope({ scope: input.scope })
  const current = await currentProductionBuild(scope, input.productionId)
  if (current.brief.intent.productType !== 'text-open-world') {
    throw new Error('[product-production-scheduler] 当前产品不使用开放世界导入证明复验协议')
  }
  if (!['preview-ready', 'release-ready', 'released'].includes(current.build.status)) {
    throw new Error('[product-production-scheduler] 只有已封存的导入 Build 可以执行本地证明复验')
  }
  const plan = parseProductProductionPlanV3(
    current.build.planJson,
    current.brief,
    current.briefRow.briefHash,
  )
  const ledger = parseLedger(current.build.budgetLedgerJson)
  if (ledger.rootRunId == null
    || ledger.attempts.some(attempt => !attempt.usageKnown && attempt.resolution == null)) {
    throw new Error('[product-production-scheduler] 导入 Build 缺少已结算 root/预算证明')
  }
  let root = await readAgentRunV1(scope, ledger.rootRunId)
  if (root.projection.state !== 'completed' && !importedScopeReboundReceiptV1(root)) {
    throw new Error('[product-production-scheduler] root 不是可复验的导入完成态')
  }
  const children = await childSnapshots(scope, current.build.id!, root.run.id)
  if (children.size !== plan.tasks.length) {
    throw new Error('[product-production-scheduler] 导入 Build 的 task Run 集合不完整')
  }
  let progressed = true
  while (progressed) {
    progressed = false
    const completed = new Map([...children].flatMap(([taskKey, snapshot]) => (
      snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash
        ? [[taskKey, snapshot.projection.terminalReceiptHash] as const] : []
    )))
    for (const task of plan.tasks) {
      const snapshot = children.get(task.taskKey)
      if (!snapshot || snapshot.projection.state === 'completed'
        || task.dependsOn.some(dependency => !completed.has(dependency))) continue
      const outputs = (await db.productBuildArtifacts
        .where('buildId').equals(current.build.id!).toArray())
        .filter(row => row.controlEpoch === current.build.controlEpoch
          && task.outputArtifactKeys.includes(row.artifactKey)
          && (row.status === 'accepted' || row.status === 'carried-forward'))
      const statuses = new Set(outputs.map(row => row.status))
      let recovered: AgentRunSnapshotV1 | null = null
      if (statuses.size === 1 && statuses.has('accepted')) {
        const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, snapshot.run.id)
        if (!checkpoint?.resumePayload) {
          throw new Error(
            `[product-production-scheduler] 导入 task 缺少可复验 checkpoint:${task.taskKey}`,
          )
        }
        recovered = await revalidateImportedCheckpointedTaskV1({
          scope,
          buildId: current.build.id!,
          controlEpoch: current.build.controlEpoch,
          task,
          snapshot,
          candidate: parseResumeCandidate(
            checkpoint.resumePayload,
            task,
            current.build.controlEpoch,
          ),
        })
      } else if (statuses.size === 1 && statuses.has('carried-forward')) {
        const candidateHash = await hashProductProductionValueV2(outputs.map(row => ({
          artifactKey: row.artifactKey,
          contentHash: row.contentHash,
          carriedFrom: row.carriedFrom,
          parentArtifactHash: row.parentArtifactHash,
        })).sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)))
        recovered = await revalidateImportedCarriedTaskV1({
          scope,
          buildId: current.build.id!,
          controlEpoch: current.build.controlEpoch,
          task,
          snapshot,
          dependencies: task.dependsOn.map(taskKey => ({
            taskKey,
            receiptHash: completed.get(taskKey)!,
          })),
          candidateHash,
          outputs,
        })
      }
      if (!recovered) {
        throw new Error(
          `[product-production-scheduler] 导入 task 不是单一可复验完成证据:${task.taskKey}`,
        )
      }
      children.set(task.taskKey, recovered)
      progressed = true
    }
  }
  if ([...children.values()].some(child => child.projection.state !== 'completed'
    || !child.projection.terminalReceiptHash)) {
    throw new Error('[product-production-scheduler] 导入 task 依赖闭包无法完成本地复验')
  }
  root = await readAgentRunV1(scope, root.run.id)
  await compileTerminalBuild({
    scope,
    productionId: input.productionId,
    buildId: current.build.id!,
    root,
    plan,
    brief: current.brief,
  })
  return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
}

function durableBoundaryFromEventV1(
  event: AgentRunSnapshotV1['events'][number],
): ProductProductionDurableBoundaryProjectionV1 {
  const payload = event.payload as { stepId?: unknown; attempt?: unknown }
  return {
    eventType: event.type,
    sequence: event.sequence,
    createdAt: event.createdAt,
    stepId: typeof payload.stepId === 'string' ? payload.stepId : null,
    attempt: Number.isInteger(payload.attempt) ? Number(payload.attempt) : null,
  }
}

async function projectTaskCheckpointV1(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
): Promise<ProductProductionCheckpointProjectionV1 | null> {
  const storedRows = await db.agentRunCheckpoints.where('runId').equals(snapshot.run.id).sortBy('throughSequence')
  const stored = storedRows[storedRows.length - 1]
  if (!stored) return null
  try {
    const verified = await readLatestVerifiedAgentRunCheckpointV1(scope, snapshot.run.id)
    if (!verified) return null
    const payload = verified.resumePayload as Partial<ResumeCandidateV1> | null
    const taskCandidate = payload?.schema === 'storyforge.product-production-task-candidate'
      && payload.version === 1
      && typeof payload.taskKey === 'string'
      && Number.isInteger(payload.attempt)
      && typeof payload.candidateHash === 'string'
      && isSha256Hash(payload.candidateHash)
    return {
      status: 'verified',
      checkpointHash: verified.checkpoint.checkpointHash,
      throughSequence: verified.checkpoint.throughSequence,
      createdAt: verified.checkpoint.createdAt,
      resumeKind: taskCandidate ? 'task-candidate' : 'other',
      candidateHash: taskCandidate ? payload!.candidateHash! : null,
      attempt: taskCandidate ? Number(payload!.attempt) : null,
    }
  } catch {
    return {
      status: 'invalid',
      checkpointHash: isSha256Hash(stored.checkpointHash) ? stored.checkpointHash : null,
      throughSequence: Number.isInteger(stored.throughSequence) ? stored.throughSequence : null,
      createdAt: Number.isFinite(stored.createdAt) ? stored.createdAt : null,
      resumeKind: 'invalid',
      candidateHash: null,
      attempt: null,
    }
  }
}

function projectTaskStepsV1(snapshot: AgentRunSnapshotV1): ProductProductionStepProjectionV1[] {
  interface MutableAttemptProjection extends ProductProductionAttemptProjectionV1 {
    order: number
  }
  const attemptsByStep = new Map<string, Map<number, MutableAttemptProjection>>()
  const stepOrder = new Map<string, number>()
  for (const event of snapshot.events) {
    const boundary = durableBoundaryFromEventV1(event)
    if (boundary.stepId == null || boundary.attempt == null || boundary.attempt < 1) continue
    if (!stepOrder.has(boundary.stepId)) stepOrder.set(boundary.stepId, event.sequence)
    const attempts = attemptsByStep.get(boundary.stepId) ?? new Map<number, MutableAttemptProjection>()
    attemptsByStep.set(boundary.stepId, attempts)
    const attempt = attempts.get(boundary.attempt) ?? {
      attempt: boundary.attempt,
      status: 'running' as const,
      startedAt: null,
      finishedAt: null,
      failureCode: null,
      latestDurableBoundary: null,
      order: event.sequence,
    }
    attempt.latestDurableBoundary = boundary
    if (event.type === 'step.started') {
      attempt.status = 'running'
      attempt.startedAt = event.createdAt
    } else if (event.type === 'candidate.persisted' && event.payload.requiresConfirmation) {
      attempt.status = 'awaiting_confirmation'
    } else if (event.type === 'step.succeeded') {
      attempt.status = 'succeeded'
      attempt.finishedAt = event.createdAt
    } else if (event.type === 'step.failed') {
      attempt.status = 'failed'
      attempt.finishedAt = event.createdAt
      attempt.failureCode = event.payload.code
    }
    attempts.set(boundary.attempt, attempt)
  }
  return Object.values(snapshot.projection.steps)
    .sort((left, right) => (
      (stepOrder.get(left.stepId) ?? Number.MAX_SAFE_INTEGER)
      - (stepOrder.get(right.stepId) ?? Number.MAX_SAFE_INTEGER)
      || left.stepId.localeCompare(right.stepId)
    ))
    .map(step => {
      const attempts = [...(attemptsByStep.get(step.stepId)?.values() ?? [])]
        .sort((left, right) => left.attempt - right.attempt)
        .map(attempt => ({
          attempt: attempt.attempt,
          status: attempt.status,
          startedAt: attempt.startedAt,
          finishedAt: attempt.finishedAt,
          failureCode: attempt.failureCode,
          latestDurableBoundary: attempt.latestDurableBoundary,
        }))
      const current = attempts.find(attempt => attempt.attempt === step.attempt)
      if (current) {
        current.status = step.status
        current.failureCode = step.failureCode ?? current.failureCode
      }
      return {
        stepId: step.stepId,
        status: step.status,
        currentAttempt: step.attempt,
        candidateHash: step.candidateHash ?? null,
        outputHash: step.outputHash ?? null,
        failureCode: step.failureCode ?? null,
        attempts,
      }
    })
}

function costBearing(task: ProductProductionPlanTaskV3): boolean {
  return task.budgetReservation.modelCalls > 0 || task.budgetReservation.mediaCalls > 0
    || (task.budgetReservation.maximumCostUsd ?? 0) > 0
}

async function pauseBeforeMediaForFailedTextAdventureReviewV1(input: {
  buildId: number
  controlEpoch: number
  failureJson: string
  plan: ProductProductionPlanV3
  completedTaskKeys: ReadonlySet<string>
}): Promise<boolean> {
  if (input.plan.productType !== 'text-adventure'
    || !input.completedTaskKeys.has('content.adventure-quality-review')) return false
  const rows = (await db.productBuildArtifacts
    .where('[buildId+artifactKey]').equals([input.buildId, 'quality.adventure-review']).toArray())
    .filter(row => row.controlEpoch === input.controlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (rows.length !== 1) {
    throw new Error('[product-production-scheduler] 当前 epoch 的叙事质量审查 Artifact 不唯一')
  }
  const review = parseTextAdventureQualityReviewArtifactV1(JSON.parse(rows[0].payloadJson))
  if (review.passed) return false
  const failure = {
    taskKey: 'integration.package',
    code: 'task-executor-failed',
    attempt: 1,
    detail: '[product-production-executor] 文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
  }
  await db.transaction('rw', db.productBuilds, async () => {
    const current = await db.productBuilds.get(input.buildId)
    if (!current || current.controlEpoch !== input.controlEpoch
      || ['recovery-required', 'failed', 'cancelled', 'archived', 'released'].includes(current.status)) return
    await db.productBuilds.update(input.buildId, {
      status: 'recovery-required',
      failureJson: canonicalProductProductionJsonV2(taskFailureEnvelope(input.failureJson, failure)),
      updatedAt: Date.now(),
    })
  })
  return true
}

export async function runProductProductionSchedulerCycleV1(input: {
  scope: WorkspaceScope
  productionId: number
  executor: ProductProductionTaskExecutorV1
  suppliedPlan?: ProductProductionPlanV3
  capabilityBindings?: ProductProductionCapabilityBindingV1[]
  signal?: AbortSignal
  onDurableBoundary?: (boundary: ProductProductionSchedulerBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<ProductProductionSchedulerProjectionV1> {
  const scope = await resolveScope({ scope: input.scope })
  const current = await currentProductionBuild(scope, input.productionId)
  if (['paused', 'cancelled', 'failed', 'recovery-required', 'archived', 'released'].includes(current.build.status)) {
    await cancelNonTerminalBuildRunsAfterStopV1({
      scope, buildId: current.build.id!, controlEpoch: current.build.controlEpoch,
    })
    return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  }
  const state = await ensureRootRun({ scope, productionId: input.productionId, suppliedPlan: input.suppliedPlan })
  await invalidateStaleCarriedTextAdventureVisionClosureV1({
    scope,
    buildId: state.build.id!,
    buildNumber: state.build.buildNumber,
    controlEpoch: state.build.controlEpoch,
    plan: state.plan,
    capabilityBindings: input.capabilityBindings ?? [],
  })
  let children = await childSnapshots(scope, state.build.id!, state.root.run.id)
  for (const task of state.plan.tasks) {
    const child = children.get(task.taskKey)
    if (child && (child.projection.state === 'completed'
      || child.projection.steps[task.taskKey]?.candidateHash)) {
      await recoverCompletedOrCheckpointed({
        scope, buildId: state.build.id!, controlEpoch: state.build.controlEpoch, task, snapshot: child,
      })
    }
  }
  await ensureCarriedForwardTaskRuns({
    scope, build: {
      id: state.build.id!, buildNumber: state.build.buildNumber,
      controlEpoch: state.build.controlEpoch, planHash: state.build.planHash,
    },
    root: state.root, plan: state.plan, capabilityBindings: input.capabilityBindings ?? [],
    onDurableBoundary: input.onDurableBoundary,
  })
  children = await childSnapshots(scope, state.build.id!, state.root.run.id)
  const abandoned = await reconcileAbandonedTaskRunsV1({
    scope,
    build: {
      id: state.build.id!,
      controlEpoch: state.build.controlEpoch,
      failureJson: state.build.failureJson,
    },
    plan: state.plan,
    children,
  })
  if (abandoned.blocked) {
    await cancelNonTerminalBuildRunsAfterStopV1({
      scope, buildId: state.build.id!, controlEpoch: state.build.controlEpoch,
    })
    return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  }
  children = await childSnapshots(scope, state.build.id!, state.root.run.id)
  const completed = new Map([...children].flatMap(([key, child]) => (
    child.projection.state === 'completed' && child.projection.terminalReceiptHash
      ? [[key, child.projection.terminalReceiptHash] as const] : []
  )))
  if (await pauseBeforeMediaForFailedTextAdventureReviewV1({
    buildId: state.build.id!, controlEpoch: state.build.controlEpoch,
    failureJson: state.build.failureJson, plan: state.plan,
    completedTaskKeys: new Set(completed.keys()),
  })) {
    await cancelNonTerminalBuildRunsAfterStopV1({
      scope, buildId: state.build.id!, controlEpoch: state.build.controlEpoch,
    })
    return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  }
  if (completed.size === state.plan.tasks.length) {
    await compileTerminalBuild({
      scope, productionId: input.productionId, buildId: state.build.id!, root: state.root,
      plan: state.plan, brief: state.brief,
    })
    await input.onDurableBoundary?.('root.completed', await readAgentRunV1(scope, state.root.run.id))
    return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  }
  const activeTasks = state.plan.tasks.filter(task => {
    const child = children.get(task.taskKey)
    return !!child && child.projection.state === 'running'
      && child.projection.steps[task.taskKey]?.status === 'running'
      && !abandoned.reclaimableRunIds.has(child.run.id)
  })
  let costSlots = Math.max(0, state.plan.concurrency.maximumCostBearingTasks - activeTasks.filter(costBearing).length)
  const effectiveTextLimit = effectiveTextProviderConcurrencyV1(
    state.plan.concurrency.maximumTextProviderTasks,
    input.capabilityBindings ?? [],
  )
  let textSlots = Math.max(0, effectiveTextLimit
    - activeTasks.filter(task => task.concurrencyGroup === 'text-provider').length)
  let mediaSlots = Math.max(0, state.plan.concurrency.maximumMediaProviderTasks
    - activeTasks.filter(task => task.concurrencyGroup === 'media-provider').length)
  const locked = new Set(activeTasks.flatMap(task => task.subjectLockKeys))
  const ready = state.plan.tasks
    .filter(task => {
      const child = children.get(task.taskKey)
      if (child && ['failed', 'cancelled', 'recovery_required', 'paused'].includes(child.projection.state)) return false
      const retryReady = child?.projection.steps[task.taskKey]?.status === 'failed'
        && permitsAutomaticTaskRetry(child.projection.steps[task.taskKey]?.failureCode)
        && (child.projection.steps[task.taskKey]?.attempt ?? 0) < task.maxAttempts
      const interruptedBeforeStep = !!child && abandoned.reclaimableRunIds.has(child.run.id)
      if (child && !retryReady && !interruptedBeforeStep) return false
      return task.requiredReceipts.every(edge => {
        const receipt = completed.get(edge.taskKey)
        return !!receipt && (edge.receiptHash == null || edge.receiptHash === receipt)
      })
    })
    .sort((a, b) => b.priority - a.priority || a.taskKey.localeCompare(b.taskKey))
  const selected: ProductProductionPlanTaskV3[] = []
  for (const task of ready) {
    if (task.subjectLockKeys.some(key => locked.has(key))) continue
    if (costBearing(task) && costSlots < 1) continue
    if (task.concurrencyGroup === 'text-provider' && textSlots < 1) continue
    if (task.concurrencyGroup === 'media-provider' && mediaSlots < 1) continue
    selected.push(task)
    task.subjectLockKeys.forEach(key => locked.add(key))
    if (costBearing(task)) costSlots--
    if (task.concurrencyGroup === 'text-provider') textSlots--
    if (task.concurrencyGroup === 'media-provider') mediaSlots--
  }
  const claimed: Array<{ task: ProductProductionPlanTaskV3; snapshot: AgentRunSnapshotV1 }> = []
  const ownedRunIds = new Set<number>()
  try {
    for (const task of selected) {
      const existing = children.get(task.taskKey)
      if (existing) {
        claimed.push({ task, snapshot: existing })
        ownedRunIds.add(existing.run.id)
        ACTIVE_TASK_RUN_IDS.add(existing.run.id)
        continue
      }
      const bindings = normalizedBindings(task, input.capabilityBindings ?? [])
      const capabilityBindingHash = bindings.length > 0 ? await hashProductProductionValueV2(bindings) : undefined
      try {
        const snapshot = await createAgentRunV1({
          scope, productBuildId: state.build.id!,
          contract: await taskContract({
            scope, rootRunId: state.root.run.id,
            build: {
              id: state.build.id!, buildNumber: state.build.buildNumber,
              controlEpoch: state.build.controlEpoch, planHash: state.build.planHash,
            },
            task, capabilityBindingHash,
          }),
        })
        claimed.push({ task, snapshot })
        ownedRunIds.add(snapshot.run.id)
        ACTIVE_TASK_RUN_IDS.add(snapshot.run.id)
        await settleLedger({
          buildId: state.build.id!, controlEpoch: state.build.controlEpoch, taskKey: task.taskKey,
          entry: {
            runId: snapshot.run.id, attempt: 0, status: 'claimed', idempotencyKey: '',
            candidateHash: null, terminalReceiptHash: null, passedGateIds: [], usage: zeroUsage(), errorCode: null,
          },
        })
        await input.onDurableBoundary?.('task.claimed', snapshot)
      } catch (error) {
        if (!(error instanceof Error) || !/duplicate_child|已经存在子运行/.test(error.message)) throw error
      }
    }
    const controller = new AbortController()
    const abort = () => controller.abort(input.signal?.reason)
    if (input.signal?.aborted) abort()
    else input.signal?.addEventListener('abort', abort, { once: true })
    try {
      await Promise.all(claimed.map(({ task, snapshot }) => runClaimedTask({
        scope, productionId: input.productionId,
        build: {
          id: state.build.id!, buildNumber: state.build.buildNumber,
          controlEpoch: state.build.controlEpoch, planHash: state.build.planHash,
          failureJson: state.build.failureJson,
        },
        task, snapshot, executor: input.executor,
        repairAuthority: state.repairAuthority,
        mediaAuthority: state.mediaAuthority,
        capabilityBindings: input.capabilityBindings ?? [], signal: controller.signal,
        onDurableBoundary: input.onDurableBoundary,
      })))
    } finally {
      input.signal?.removeEventListener('abort', abort)
    }
  } finally {
    const currentBuild = await db.productBuilds.get(state.build.id!)
    if (currentBuild?.controlEpoch === state.build.controlEpoch
      && ['paused', 'cancelled', 'failed', 'recovery-required', 'archived', 'released']
        .includes(currentBuild.status)) {
      await cancelNonTerminalBuildRunsAfterStopV1({
        scope, buildId: state.build.id!, controlEpoch: state.build.controlEpoch,
      })
    }
    ownedRunIds.forEach(runId => ACTIVE_TASK_RUN_IDS.delete(runId))
  }
  return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
}

export async function runProductProductionUntilBlockedV1(input: {
  scope: WorkspaceScope
  productionId: number
  executor: ProductProductionTaskExecutorV1
  suppliedPlan?: ProductProductionPlanV3
  capabilityBindings?: ProductProductionCapabilityBindingV1[]
  signal?: AbortSignal
  maximumCycles?: number
  onDurableBoundary?: (boundary: ProductProductionSchedulerBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<ProductProductionSchedulerProjectionV1> {
  const maximumCycles = input.maximumCycles ?? 100
  let previousSignature = ''
  let projection!: ProductProductionSchedulerProjectionV1
  for (let cycle = 0; cycle < maximumCycles; cycle++) {
    projection = await runProductProductionSchedulerCycleV1(input)
    if (projection.terminal || ['paused', 'failed', 'cancelled', 'archived', 'released', 'preview-ready', 'release-ready'].includes(projection.buildStatus)) {
      return projection
    }
    const signature = canonicalProductProductionJsonV2(projection.tasks.map(task => ({
      taskKey: task.taskKey, status: task.status, attempt: task.attempt, receipt: task.terminalReceiptHash,
    })))
    const allTasksCompleted = projection.tasks.every(task => task.status === 'completed')
    if (!allTasksCompleted && (signature === previousSignature
      || !projection.tasks.some(task => task.status === 'ready' || task.status === 'retry-ready'))) {
      return projection
    }
    previousSignature = signature
  }
  throw new Error('[product-production-scheduler] 超出最大调度 cycle，拒绝隐藏循环')
}
