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
import { ContextSourceBudgetErrorV1, type AssembleContextResult } from '../registry/types'
import type {
  AgentRunStepState,
  AgentRunEventPayloadByTypeV1,
  AgentRunEventTypeV1,
  AnyAgentRunEventV1,
  ContextManifestV2,
  ProductBuildArtifactKindV1,
  ProductBuildArtifactRecordV1,
  ProductProductionBriefV3,
  ProductionProductKindV1,
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
  assertProductBuildTerminalReadSetUnchangedV1,
  verifyProductBuildTerminalArtifactSetV1,
} from './artifact-store'
import { parseProductBuildQualityReportV1 } from './adoption'
import { createProductBuildCompatibilityReportV1 } from './compatibility'
import { parseProductProductionBriefV3 } from './contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from './plan'
import { createTextOpenWorldProductionPlanV1 } from '../open-world/production-contract'
import { readTextOpenWorldCreatorExecutionBriefV1 } from '../open-world/creator-production-start'
import { parseTextOpenWorldModulesV1 } from '../open-world/modules'
import { createProductBuildPreviewManifestV1 } from './preview-manifest'
import { createProductBuildRootTerminalReceiptV1 } from './receipts'
import { parseProductRuntimePackageV1, productProductionTerminalArtifactKeysV1 } from './runtime-package'
import {
  hashProductProductionCarriedCandidateV1,
  hashProductProductionCarriedReceiptV1,
  hashProductProductionTaskCandidateV1,
  hashProductProductionTaskReceiptV1,
} from './task-evidence'
import {
  executeProductProductionWorldGatewayV1,
  productProductionTaskOwnsWorldGatewayV1,
  productProductionTaskUsesWorldGatewayV1,
  parseConfirmedProductBriefV1,
  parseProductProductionSourcePlanV1,
} from './source-contracts'
import { assertFormalProductProductionStartV1 } from '../product/source-contracts'
import {
  preserveProductProductionContextV1,
  ProductProductionContextBudgetErrorV1,
  validateProductProductionRecoveryDirectiveV1,
} from './context'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'
import { resolveProductProductionTaskRecoveryPolicyV1 } from './recovery-policy'

const ROOT_TASK_KEY = '$root'
const ROOT_STEP_ID = '$join'
const CLAIM_TTL_MS = 15_000
const DETERMINISTIC_WORLD_TOOL = 'product-production-deterministic-world-integrator'
const LOCAL_PROCEDURAL_MEDIA_TOOL = 'product-production-local-procedural-media'

export interface ProductProductionCapabilityBindingV1 {
  requirementKey: string
  bindingHash: string
  adapterId: string
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

/**
 * A known safely repeatable failure whose provider boundary and paid usage are
 * fully accounted (for example a transient response or one bounded fragment
 * schema rejection). The same durable task may retry; callers must report only
 * usage newly incurred by the current outer attempt.
 */
export class ProductProductionRetryableExecutionErrorV1 extends Error {
  constructor(message: string, readonly usage: ProductProductionTaskUsageV1) {
    super(message)
    this.name = 'ProductProductionRetryableExecutionErrorV1'
  }
}

/**
 * The provider request crossed the dispatch boundary, but no definitive
 * response was observed. Retrying automatically could duplicate both the
 * content and the charge, so the scheduler must retain the attempt's full
 * reservation until an author explicitly resolves the blocker.
 */
export class ProductProductionResultUnknownErrorV1 extends Error {
  readonly requestDispatched = true
  readonly reservationDisposition = 'retain' as const

  constructor() {
    super('[product-production-model] 请求结果未知；为避免重复生成或计费，必须由作者确认后再处理。')
    this.name = 'ProductProductionResultUnknownErrorV1'
  }
}

class ProductProductionAttemptBudgetExceededErrorV1 extends Error {
  constructor() {
    super('[product-production-scheduler] 本次执行用量超过任务剩余预算预留')
    this.name = 'ProductProductionAttemptBudgetExceededErrorV1'
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
  /** Remaining reservation after all paid attempts for this Build task, including prior control epochs. */
  attemptBudgetReservation?: ProductTaskBudgetReservationV1
  attempt: number
  idempotencyKey: string
  /** Present on every formal scheduler execution. Specialized bounded-batch
   * executors use this run to persist the exact per-call evidence. */
  taskRunId?: number
  contextText: string
  inputArtifacts: ProductBuildArtifactRecordV1[]
  capabilityBindings: ProductProductionCapabilityBindingV1[]
  signal: AbortSignal
  /** Persist the received model text before parsing, including rejected drafts.
   * `discarded-stale` tells a multi-call protocol to stop before another paid
   * request because this attempt no longer owns its Run/Build epoch. */
  onModelOutput?: (output: string) => Promise<void | 'discarded-stale'>
  /** Re-fence a bounded protocol immediately before each paid call after the
   * first; this closes the timeout window between one persisted response and
   * dispatch of the next request. */
  beforeAdditionalModelRequest?: () => Promise<void | 'discarded-stale'>
  authorDraftJson?: string
  /** Registered repair evidence is kept separate from atomic task JSON. */
  repairFeedbackText?: string
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
  | 'terminal.proof.checked'
  | 'root.step.succeeded'
  | 'root.verification.started'
  | 'root.verification.accepted'
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

interface LedgerChargeV2 {
  runId: number
  attempt: number
  controlEpoch: number | null
  taskKey: string
  costUpperBoundUsd: number | null
  usage: ProductProductionTaskUsageV1
  /** Non-null when an author or a proven pre-dispatch system path closed a reservation. */
  resolution:
    | null
    | 'author-confirmed-not-charged'
    | 'author-charged-reservation-upper-bound'
    | 'system-released-before-dispatch'
    | 'system-released-no-usage-reported'
}

interface LedgerReservationV2 {
  runId: number
  attempt: number
  controlEpoch: number
  taskKey: string
  budget: ProductTaskBudgetReservationV1
}

interface SchedulerLedgerV2 {
  schema: 'storyforge.product-production-budget-ledger'
  version: 2
  rootRunId: number | null
  rootClaim: { owner: string; expiresAt: number } | null
  charges: Record<string, LedgerChargeV2>
  reservations: Record<string, LedgerReservationV2>
  tasks: Record<string, LedgerTaskV1>
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
  dependsOn: string[]
  requiredReceipts: Array<{ taskKey: string; receiptHash: string | null }>
  concurrencyGroup: string
  maxAttempts: number
  timeoutMs: number
  subjectLocks: string[]
  latestDurableBoundary: ProductProductionDurableBoundaryProjectionV1 | null
  checkpoint: ProductProductionCheckpointProjectionV1 | null
  steps: ProductProductionStepProjectionV1[]
  staleReason: string | null
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

function emptyLedger(history?: Pick<SchedulerLedgerV2, 'charges' | 'reservations'>): SchedulerLedgerV2 {
  return {
    schema: 'storyforge.product-production-budget-ledger',
    version: 2,
    rootRunId: null,
    rootClaim: null,
    charges: structuredClone(history?.charges ?? {}),
    reservations: structuredClone(history?.reservations ?? {}),
    tasks: {},
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

function parseLedgerReservation(value: unknown, label: string): ProductTaskBudgetReservationV1 {
  const row = ledgerRecord(value, label)
  exactLedgerKeys(row, [
    'modelCalls', 'inputTokens', 'outputTokens', 'mediaCalls', 'maximumCostUsd', 'durationMs', 'storageBytes',
  ], label)
  const maximumCostUsd = row.maximumCostUsd === null ? null : row.maximumCostUsd
  if (maximumCostUsd !== null
    && (typeof maximumCostUsd !== 'number' || !Number.isFinite(maximumCostUsd) || maximumCostUsd < 0)) {
    throw new Error(`[product-production-scheduler] ${label}.maximumCostUsd 无效`)
  }
  return {
    modelCalls: ledgerInteger(row.modelCalls, `${label}.modelCalls`),
    inputTokens: ledgerInteger(row.inputTokens, `${label}.inputTokens`),
    outputTokens: ledgerInteger(row.outputTokens, `${label}.outputTokens`),
    mediaCalls: ledgerInteger(row.mediaCalls, `${label}.mediaCalls`),
    maximumCostUsd,
    durationMs: ledgerInteger(row.durationMs, `${label}.durationMs`),
    storageBytes: ledgerInteger(row.storageBytes, `${label}.storageBytes`),
  }
}

function ledgerTaskKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new Error(`[product-production-scheduler] ${label} 无效`)
  }
  return value
}

function ledgerAttemptKey(runId: number, attempt: number): string {
  return `${runId}:${attempt}`
}

function parseLedger(value: string): SchedulerLedgerV2 {
  if (value === '{}' || !value.trim()) return emptyLedger()
  let candidate: unknown
  try { candidate = JSON.parse(value) } catch { throw new Error('[product-production-scheduler] budget ledger JSON 损坏') }
  const row = ledgerRecord(candidate, 'budget ledger')
  if (row.version === 1) {
    exactLedgerKeys(row, ['schema', 'version', 'rootRunId', 'rootClaim', 'tasks'], 'budget ledger')
  } else if (row.version === 2) {
    exactLedgerKeys(row, [
      'schema', 'version', 'rootRunId', 'rootClaim', 'charges', 'reservations', 'tasks',
    ], 'budget ledger')
  } else {
    throw new Error('[product-production-scheduler] budget ledger 版本无效')
  }
  if (row.schema !== 'storyforge.product-production-budget-ledger'
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
    ledgerTaskKey(taskKey, 'ledger taskKey')
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
  const charges: Record<string, LedgerChargeV2> = {}
  const reservations: Record<string, LedgerReservationV2> = {}
  if (row.version === 1) {
    // v1 only retained the latest task settlement. Promote every known
    // terminal usage to an idempotent charge; claimed zero placeholders are
    // deliberately excluded so a result arriving after migration can settle.
    for (const [taskKey, task] of Object.entries(tasks)) {
      if (task.status === 'claimed' || task.usage == null) continue
      const key = ledgerAttemptKey(task.runId, task.attempt)
      charges[key] = {
        runId: task.runId, attempt: task.attempt, controlEpoch: null, taskKey,
        costUpperBoundUsd: task.usage.costUsd,
        usage: structuredClone(task.usage),
        resolution: null,
      }
    }
  } else {
    const rawCharges = ledgerRecord(row.charges, 'charges')
    for (const [key, rawCharge] of Object.entries(rawCharges)) {
      const charge = ledgerRecord(rawCharge, `charges.${key}`)
      const hasResolution = Object.prototype.hasOwnProperty.call(charge, 'resolution')
      exactLedgerKeys(charge, [
        'runId', 'attempt', 'controlEpoch', 'taskKey', 'costUpperBoundUsd', 'usage',
        ...(hasResolution ? ['resolution'] : []),
      ], `charges.${key}`)
      const runId = ledgerInteger(charge.runId, `charges.${key}.runId`, 1)
      const attempt = ledgerInteger(charge.attempt, `charges.${key}.attempt`, 1)
      if (key !== ledgerAttemptKey(runId, attempt)) {
        throw new Error(`[product-production-scheduler] charges.${key} key 与 run/attempt 不一致`)
      }
      const costUpperBoundUsd = charge.costUpperBoundUsd === null ? null : charge.costUpperBoundUsd
      if (costUpperBoundUsd !== null
        && (typeof costUpperBoundUsd !== 'number' || !Number.isFinite(costUpperBoundUsd) || costUpperBoundUsd < 0)) {
        throw new Error(`[product-production-scheduler] charges.${key}.costUpperBoundUsd 无效`)
      }
      const resolution = !hasResolution || charge.resolution === null
        ? null
        : charge.resolution === 'author-confirmed-not-charged'
          || charge.resolution === 'author-charged-reservation-upper-bound'
          || charge.resolution === 'system-released-before-dispatch'
          || charge.resolution === 'system-released-no-usage-reported'
          ? charge.resolution
          : (() => { throw new Error(`[product-production-scheduler] charges.${key}.resolution 无效`) })()
      const usage = parseLedgerUsage(charge.usage, `charges.${key}.usage`)
      if ((resolution === 'author-confirmed-not-charged'
        || resolution === 'system-released-before-dispatch'
        || resolution === 'system-released-no-usage-reported')
        && (costUpperBoundUsd !== 0
          || usage.modelCalls !== 0
          || usage.inputTokens !== 0
          || usage.outputTokens !== 0
          || usage.mediaCalls !== 0
          || usage.costUsd !== 0
          || usage.durationMs !== 0
          || usage.storageBytes !== 0)) {
        throw new Error(`[product-production-scheduler] charges.${key} 零费用 tombstone 含非零用量`)
      }
      charges[key] = {
        runId,
        attempt,
        controlEpoch: charge.controlEpoch === null
          ? null : ledgerInteger(charge.controlEpoch, `charges.${key}.controlEpoch`),
        taskKey: ledgerTaskKey(charge.taskKey, `charges.${key}.taskKey`),
        costUpperBoundUsd,
        usage,
        resolution,
      }
    }
    const rawReservations = ledgerRecord(row.reservations, 'reservations')
    for (const [key, rawReservation] of Object.entries(rawReservations)) {
      const reservation = ledgerRecord(rawReservation, `reservations.${key}`)
      exactLedgerKeys(reservation, [
        'runId', 'attempt', 'controlEpoch', 'taskKey', 'budget',
      ], `reservations.${key}`)
      const runId = ledgerInteger(reservation.runId, `reservations.${key}.runId`, 1)
      const attempt = ledgerInteger(reservation.attempt, `reservations.${key}.attempt`, 1)
      if (key !== ledgerAttemptKey(runId, attempt) || charges[key]) {
        throw new Error(`[product-production-scheduler] reservations.${key} key 重复或与 run/attempt 不一致`)
      }
      reservations[key] = {
        runId,
        attempt,
        controlEpoch: ledgerInteger(reservation.controlEpoch, `reservations.${key}.controlEpoch`),
        taskKey: ledgerTaskKey(reservation.taskKey, `reservations.${key}.taskKey`),
        budget: parseLedgerReservation(reservation.budget, `reservations.${key}.budget`),
      }
    }
  }
  return {
    schema: 'storyforge.product-production-budget-ledger', version: 2,
    rootRunId, rootClaim, charges, reservations, tasks,
  }
}

/** Public deterministic contract guard for diagnostics, import and regression tests. */
export function assertProductProductionBudgetLedgerV1(value: string): void {
  parseLedger(value)
}

function zeroUsage(): ProductProductionTaskUsageV1 {
  return { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0 }
}

function sumLedgerUsage(values: readonly ProductProductionTaskUsageV1[]): ProductProductionTaskUsageV1 {
  const costs = values.map(value => value.costUsd)
  return {
    modelCalls: values.reduce((sum, value) => sum + value.modelCalls, 0),
    inputTokens: values.reduce((sum, value) => sum + value.inputTokens, 0),
    outputTokens: values.reduce((sum, value) => sum + value.outputTokens, 0),
    mediaCalls: values.reduce((sum, value) => sum + value.mediaCalls, 0),
    costUsd: costs.some(value => value == null)
      ? null : costs.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    durationMs: values.reduce((sum, value) => sum + value.durationMs, 0),
    storageBytes: values.reduce((sum, value) => sum + value.storageBytes, 0),
  }
}

function reservationAsUsage(reservation: ProductTaskBudgetReservationV1): ProductProductionTaskUsageV1 {
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

/**
 * Deterministically disposes the one conservative reservation left by an
 * unknown or observed-but-uncheckpointed provider result. This is deliberately
 * pure so the control command can commit the disposition and its epoch transition in one IndexedDB
 * transaction. A stale UI must name the exact run/attempt/epoch and therefore
 * cannot release a newer request's budget.
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
  const key = ledgerAttemptKey(input.runId, input.attempt)
  const existingCharge = ledger.charges[key]
  if (existingCharge) {
    if (existingCharge.runId !== input.runId
      || existingCharge.attempt !== input.attempt
      || existingCharge.controlEpoch !== input.controlEpoch
      || existingCharge.taskKey !== input.taskKey) {
      throw new Error('[product-production-scheduler] unknown-result charge 与失败 attempt 不一致')
    }
    const effectiveDisposition = existingCharge.resolution ?? 'provider-actual-charge'
    if (existingCharge.resolution != null
      && existingCharge.resolution !== 'system-released-before-dispatch'
      && existingCharge.resolution !== 'system-released-no-usage-reported'
      && existingCharge.resolution !== (input.disposition === 'confirmed-not-charged'
        ? 'author-confirmed-not-charged'
        : 'author-charged-reservation-upper-bound')) {
      throw new Error('[product-production-scheduler] unknown-result 已由另一项作者处置关闭')
    }
    return {
      budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
      chargedUsage: effectiveDisposition === 'author-confirmed-not-charged'
        || effectiveDisposition === 'system-released-before-dispatch'
        || effectiveDisposition === 'system-released-no-usage-reported'
        ? null : structuredClone(existingCharge.usage),
      accounting: {
        requestedDisposition: input.disposition,
        effectiveDisposition,
        usage: structuredClone(existingCharge.usage),
      },
    }
  }
  const reservation = ledger.reservations[key]
  if (!reservation
    || reservation.runId !== input.runId
    || reservation.attempt !== input.attempt
    || reservation.controlEpoch !== input.controlEpoch
    || reservation.taskKey !== input.taskKey) {
    throw new Error('[product-production-scheduler] unknown-result reservation 与失败 attempt 不一致')
  }
  let chargedUsage: ProductProductionTaskUsageV1 | null = null
  const accountingUsage = input.disposition === 'charge-reservation-upper-bound'
    ? reservationAsUsage(reservation.budget)
    : zeroUsage()
  if (input.disposition === 'charge-reservation-upper-bound') {
    chargedUsage = accountingUsage
  }
  ledger.charges[key] = {
    runId: reservation.runId,
    attempt: reservation.attempt,
    controlEpoch: reservation.controlEpoch,
    taskKey: reservation.taskKey,
    costUpperBoundUsd: input.disposition === 'charge-reservation-upper-bound'
      ? reservation.budget.maximumCostUsd : 0,
    usage: accountingUsage,
    resolution: input.disposition === 'charge-reservation-upper-bound'
      ? 'author-charged-reservation-upper-bound'
      : 'author-confirmed-not-charged',
  }
  delete ledger.reservations[key]
  return {
    budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
    chargedUsage,
    accounting: {
      requestedDisposition: input.disposition,
      effectiveDisposition: input.disposition === 'charge-reservation-upper-bound'
        ? 'author-charged-reservation-upper-bound'
        : 'author-confirmed-not-charged',
      usage: structuredClone(accountingUsage),
    },
  }
}

function remainingTaskReservation(
  reservation: ProductTaskBudgetReservationV1,
  paidUsage: ProductProductionTaskUsageV1,
): ProductTaskBudgetReservationV1 {
  return {
    modelCalls: Math.max(0, reservation.modelCalls - paidUsage.modelCalls),
    inputTokens: Math.max(0, reservation.inputTokens - paidUsage.inputTokens),
    outputTokens: Math.max(0, reservation.outputTokens - paidUsage.outputTokens),
    mediaCalls: Math.max(0, reservation.mediaCalls - paidUsage.mediaCalls),
    maximumCostUsd: reservation.maximumCostUsd == null
      ? null
      : Math.max(0, reservation.maximumCostUsd - (paidUsage.costUsd ?? 0)),
    durationMs: Math.max(0, reservation.durationMs - paidUsage.durationMs),
    storageBytes: Math.max(0, reservation.storageBytes - paidUsage.storageBytes),
  }
}

function proportionalCostUpperBound(
  reservation: ProductTaskBudgetReservationV1,
  usage: ProductProductionTaskUsageV1,
): number | null {
  if (reservation.maximumCostUsd == null) return null
  const reservedPaidCalls = reservation.modelCalls + reservation.mediaCalls
  const actualPaidCalls = usage.modelCalls + usage.mediaCalls
  if (reservedPaidCalls === 0) return actualPaidCalls === 0 ? 0 : reservation.maximumCostUsd
  return reservation.maximumCostUsd * Math.min(1, actualPaidCalls / reservedPaidCalls)
}

function briefBudgetViolations(
  usage: ProductProductionTaskUsageV1,
  limits: ProductProductionBriefV3['productionBudget'],
): string[] {
  const violations: string[] = []
  if (usage.modelCalls > limits.maximumModelCalls) violations.push('modelCalls')
  if (usage.inputTokens > limits.maximumInputTokens) violations.push('inputTokens')
  if (usage.outputTokens > limits.maximumOutputTokens) violations.push('outputTokens')
  if (usage.mediaCalls > limits.maximumMediaCalls) violations.push('mediaCalls')
  if (usage.durationMs > limits.maximumDurationMs) violations.push('durationMs')
  if (usage.storageBytes > limits.maximumStorageBytes) violations.push('storageBytes')
  if (limits.maximumCostUsd != null
    && (usage.costUsd == null || usage.costUsd > limits.maximumCostUsd)) violations.push('costUsd')
  return violations
}

function captureReturnedUsage(value: unknown): ProductProductionTaskUsageV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('usage' in value)) return null
  try { return parseLedgerUsage((value as { usage: unknown }).usage, 'executor result usage') }
  catch { return null }
}

function safeExecutorError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const redacted = message
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|ak)-[A-Za-z0-9_-]{8,}\b/g, '[redacted-credential]')
    .replace(/(?:authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi, 'credential=[redacted]')
    .slice(0, 1_000)
  try { assertExactRunArtifactBodySafeV1({ artifactKind: 'tool-result', body: redacted }); return redacted }
  catch { return '任务执行失败；错误详情包含不适合保存的内容。' }
}

function taskFailureProvenance(input: {
  snapshot: AgentRunSnapshotV1
  build: { controlEpoch: number; planHash: string }
  attempt: number
}) {
  if (input.snapshot.run.parentRunId == null) {
    throw new Error('[product-production-scheduler] task failure 缺少 root Run 谱系')
  }
  return {
    runId: input.snapshot.run.id,
    rootRunId: input.snapshot.run.parentRunId,
    controlEpoch: input.build.controlEpoch,
    planHash: input.build.planHash,
    attempt: input.attempt,
  }
}

function boundedUsage(usage: ProductProductionTaskUsageV1, reservation: ProductTaskBudgetReservationV1): void {
  const integers = [usage.modelCalls, usage.inputTokens, usage.outputTokens, usage.mediaCalls, usage.durationMs, usage.storageBytes]
  if (integers.some(value => !Number.isInteger(value) || value < 0)
    || (usage.costUsd != null && (!Number.isFinite(usage.costUsd) || usage.costUsd < 0))
    || usage.modelCalls > reservation.modelCalls
    || usage.inputTokens > reservation.inputTokens
    || usage.outputTokens > reservation.outputTokens
    || usage.mediaCalls > reservation.mediaCalls
    || usage.durationMs > reservation.durationMs
    || usage.storageBytes > reservation.storageBytes
    || (reservation.maximumCostUsd != null && (usage.costUsd ?? 0) > reservation.maximumCostUsd)) {
    throw new Error('[product-production-scheduler] task usage 超出 Plan 预算预留')
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
    return { requirementKey, bindingHash: binding.bindingHash, adapterId: binding.adapterId.trim() }
  })
}

/** Zero-cost Creator media lanes are an explicit local-only authorization.
 * Validate the adapter allow-list in the scheduler before a child task can
 * cross a provider boundary; the product executor repeats this check. */
function isLocalProceduralMediaTaskV1(
  task: ProductProductionPlanTaskV3,
  bindings: readonly ProductProductionCapabilityBindingV1[],
): boolean {
  if (task.executionMode !== 'media-provider'
    || !['media.visual', 'media.audio'].includes(task.taskKey)
    || task.budgetReservation.maximumCostUsd !== 0) return false
  const expectedAdapter = task.taskKey === 'media.visual'
    ? 'storyforge.procedural-svg.v1'
    : 'storyforge.procedural-audio.v1'
  if (task.capabilityRequirementKeys.length === 0) {
    throw new Error(`[product-production-scheduler] ${task.taskKey} 零费用程序化任务缺少 capability 绑定`)
  }
  for (const requirementKey of task.capabilityRequirementKeys) {
    const binding = bindings.find(item => item.requirementKey === requirementKey)
    if (!binding || binding.adapterId !== expectedAdapter || !isSha256Hash(binding.bindingHash)) {
      throw new Error(`[product-production-scheduler] ${task.taskKey} 未获外部媒资费用授权，只允许内置程序化 adapter`)
    }
  }
  return true
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
  isolateRepairFeedback = false,
): string[] {
  if (task.skillId) {
    const skill = getAgentSkillV1(task.skillId)
    return [
      ...skill.contextSourceKeys,
      ...skill.optionalContextSourceKeys.filter(key => (
        (key !== 'product-production.artifact-inputs' || task.inputArtifactKeys.length > 0)
        && (key !== 'product-production.repair-feedback' || !isolateRepairFeedback)
      )),
    ]
  }
  return ['product-production.brief', ...(task.inputArtifactKeys.length > 0 ? ['product-production.artifact-inputs'] : [])]
}

function taskContractContextSourceKeys(task: ProductProductionPlanTaskV3): string[] {
  const normal = taskContextSourceKeys(task)
  const skill = task.skillId ? getAgentSkillV1(task.skillId) : null
  return [...new Set([
    ...normal,
    ...(skill?.optionalContextSourceKeys ?? []),
    ...(skill?.contextGateway?.providerSourceKeys ?? []),
    ...(productProductionTaskUsesWorldGatewayV1(task) ? ['worldRelease'] : []),
  ])]
}

function combineRegisteredContextAssembliesV1(input: {
  primary: AssembleContextResult
  supplemental: AssembleContextResult
  inputBudget: number
}): AssembleContextResult {
  const separator = input.primary.text.trim() && input.supplemental.text.trim() ? '\n\n' : ''
  const totalInputTokens = input.primary.totalInputTokens + input.supplemental.totalInputTokens
  return {
    text: `${input.primary.text}${separator}${input.supplemental.text}`,
    segments: [...input.primary.segments, ...input.supplemental.segments],
    included: [...new Set([...input.primary.included, ...input.supplemental.included])],
    omitted: [...new Set([...input.primary.omitted, ...input.supplemental.omitted])],
    trimmed: [...new Set([...input.primary.trimmed, ...input.supplemental.trimmed])],
    sourceEvidence: [
      ...(input.primary.sourceEvidence ?? []),
      ...(input.supplemental.sourceEvidence ?? []),
    ],
    totalInputTokens,
    inputBudget: input.inputBudget,
    overBudgetBeforeTrim: input.primary.overBudgetBeforeTrim
      || input.supplemental.overBudgetBeforeTrim
      || totalInputTokens > input.inputBudget,
    overBudgetAfterTrim: input.primary.overBudgetAfterTrim
      || input.supplemental.overBudgetAfterTrim
      || totalInputTokens > input.inputBudget,
  }
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
  const runtimeBindingHash = await hashProductProductionValueV2({
    schema: 'storyforge.product-production-task-runtime',
    version: 1,
    executor: 'product-production-scheduler',
    planHash: input.build.planHash,
    taskKey: input.task.taskKey,
    taskKind: input.task.kind,
    executionMode: input.task.executionMode,
    skillId: input.task.skillId ?? null,
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
  const creatorContracts = briefRow.briefKind === 'text-open-world-creator-v1'
    ? await readTextOpenWorldCreatorExecutionBriefV1({ briefRow, planJson: build.planJson })
    : null
  const brief = creatorContracts?.executionBrief ?? parseProductProductionBriefV3(briefRow.briefJson)
  if (!creatorContracts && await hashProductProductionValueV2(brief) !== briefRow.briefHash) {
    throw new Error('[product-production-scheduler] Brief hash 校验失败')
  }
  return { production, build, briefRow, brief, creatorContracts }
}

function evolutionTaskLane(taskKey: string): 'content' | 'product' | 'visual' | 'audio' | null {
  if (taskKey === 'content.design' || taskKey === 'content.narrative') return 'content'
  if (taskKey === 'content.product-module') return 'product'
  if (taskKey === 'media.requirements' || taskKey === 'media.visual') return 'visual'
  if (taskKey === 'media.audio') return 'audio'
  return null
}

async function applyCrossBuildEvolutionReuse(input: {
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
}): Promise<{ plan: ProductProductionPlanV3; reusableArtifactKeys: string[]; sourceBuildId: number | null }> {
  const evolution = input.brief.evolution
  if (!evolution || input.build.id == null || input.build.parentBuildNumber == null) {
    return { plan: input.plan, reusableArtifactKeys: [], sourceBuildId: null }
  }
  const parentBuild = await db.productBuilds
    .where('[productionId+buildNumber]').equals([input.build.productionId, input.build.parentBuildNumber]).first()
  if (!parentBuild || parentBuild.id == null
    || !await assertRecordInScope(input.scope, 'productBuilds', parentBuild, { owner: 'work' })) {
    throw new Error('[product-production-scheduler] 演化 parent Build 缺失或跨 Work')
  }
  if (evolution.base.kind === 'build' && evolution.base.buildNumber !== parentBuild.buildNumber) {
    throw new Error('[product-production-scheduler] 演化 impact 与 parent Build 不一致')
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
    return { plan: input.plan, reusableArtifactKeys: [], sourceBuildId: parentBuild.id }
  }
  let parentPlan: ProductProductionPlanV3
  try { parentPlan = parseProductProductionPlanV3(parentBuild.planJson, parentBrief, parentBriefRow.briefHash) } catch {
    return { plan: input.plan, reusableArtifactKeys: [], sourceBuildId: parentBuild.id }
  }
  const parentTasks = new Map(parentPlan.tasks.map(task => [task.taskKey, task]))
  const parentArtifacts = (await db.productBuildArtifacts.where('buildId').equals(parentBuild.id).toArray())
    .filter(row => row.controlEpoch === parentBuild.controlEpoch
      && (row.status === 'accepted' || row.status === 'carried-forward'))
  const artifactByKey = new Map(parentArtifacts.map(row => [row.artifactKey, row]))
  const affected = new Set(evolution.affectedLanes)
  const reusableTasks = new Set<string>()
  const tasks: ProductProductionPlanV3['tasks'] = []
  const reusableArtifactKeys: string[] = []
  for (const task of input.plan.tasks) {
    const parentTask = parentTasks.get(task.taskKey)
    const lane = evolutionTaskLane(task.taskKey)
    const requirementsUnchanged = parentTask && canonicalProductProductionJsonV2(
      parentTask.capabilityRequirementKeys.map(key => parentBrief.capabilityRequirements.find(item => item.requirementKey === key)),
    ) === canonicalProductProductionJsonV2(
      task.capabilityRequirementKeys.map(key => input.brief.capabilityRequirements.find(item => item.requirementKey === key)),
    )
    const outputs = task.outputArtifactKeys.map(key => artifactByKey.get(key))
    const canReuse = task.executionMode !== 'deterministic' && lane != null && !affected.has(lane)
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
  return { plan, reusableArtifactKeys, sourceBuildId: parentBuild.id }
}

async function ensureCrossBuildCarryForPersistedPlanV1(input: {
  scope: WorkspaceScope
  build: { id: number; productionId: number; buildNumber: number; controlEpoch: number }
  plan: ProductProductionPlanV3
}): Promise<void> {
  const tasks = input.plan.tasks.filter(task => task.reuse != null)
  const sourceBuildNumbers = [...new Set(tasks.map(task => task.reuse!.sourceBuildNumber))]
  for (const sourceBuildNumber of sourceBuildNumbers) {
    const sourceBuild = await db.productBuilds.where('[productionId+buildNumber]')
      .equals([input.build.productionId, sourceBuildNumber]).first()
    if (!sourceBuild?.id) {
      throw new Error(`[product-production-scheduler] persisted reuse 来源 Build 缺失:${sourceBuildNumber}`)
    }
    const artifactKeys = tasks
      .filter(task => task.reuse!.sourceBuildNumber === sourceBuildNumber)
      .flatMap(task => task.outputArtifactKeys)
    if (artifactKeys.length > 0) await carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: input.scope,
      sourceBuildId: sourceBuild.id,
      targetBuildId: input.build.id,
      targetControlEpoch: input.build.controlEpoch,
      artifactKeys,
    })
  }
}

async function ensureSameBuildEpochCarryForPersistedPlanV1(input: {
  scope: WorkspaceScope
  build: { id: number; buildNumber: number; controlEpoch: number }
  plan: ProductProductionPlanV3
}): Promise<void> {
  const rows = await db.productBuildArtifacts.where('buildId').equals(input.build.id).toArray()
  const activePrior = rows.filter(row => row.controlEpoch < input.build.controlEpoch
    && (row.status === 'accepted' || row.status === 'carried-forward'))
  const keysByEpoch = new Map<number, string[]>()
  for (const task of input.plan.tasks) {
    if (task.executionMode === 'deterministic' || task.reuse !== null) continue
    const siblings = task.outputArtifactKeys.map(key => activePrior
      .filter(row => row.artifactKey === key)
      .sort((left, right) => right.controlEpoch - left.controlEpoch || right.version - left.version)[0])
    if (siblings.some(row => row == null)) continue
    const epochs = new Set(siblings.map(row => row!.controlEpoch))
    if (epochs.size !== 1) {
      throw new Error(`[product-production-scheduler] prior epoch task siblings 不闭合:${task.taskKey}`)
    }
    const epoch = siblings[0]!.controlEpoch
    const bucket = keysByEpoch.get(epoch) ?? []
    bucket.push(...task.outputArtifactKeys)
    keysByEpoch.set(epoch, bucket)
  }
  for (const [fromControlEpoch, artifactKeys] of keysByEpoch) {
    await carryForwardProductBuildArtifactsToEpochV1({
      scope: input.scope,
      buildId: input.build.id,
      fromControlEpoch,
      toControlEpoch: input.build.controlEpoch,
      artifactKeys,
    })
  }
}

async function invalidatePriorEpochArtifactsAfterCarryV1(input: {
  buildId: number
  controlEpoch: number
  planHash: string
}): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productBuildArtifacts), async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || build.controlEpoch !== input.controlEpoch || build.planHash !== input.planHash
      || !['building', 'validating'].includes(build.status)) {
      throw new Error('[product-production-scheduler] prior epoch Artifact 清理 CAS 已过期')
    }
    await db.productBuildArtifacts.where('buildId').equals(build.id!).filter(row => (
      row.controlEpoch !== build.controlEpoch && (row.status === 'accepted' || row.status === 'carried-forward')
    )).modify({ status: 'invalid', updatedAt: Date.now() })
  })
}

async function ensurePersistedPlanCarriesV1(input: {
  scope: WorkspaceScope
  build: { id: number; productionId: number; buildNumber: number; controlEpoch: number; planHash: string; status: string }
  plan: ProductProductionPlanV3
}): Promise<void> {
  if (input.build.status !== 'building') return
  // The target Plan is already durable here. Both APIs independently parse and
  // authorize that exact Plan, making a crash between Plan CAS and carry fully
  // recoverable on the next scheduler entry.
  await ensureCrossBuildCarryForPersistedPlanV1(input)
  await ensureSameBuildEpochCarryForPersistedPlanV1(input)
  await invalidatePriorEpochArtifactsAfterCarryV1({
    buildId: input.build.id,
    controlEpoch: input.build.controlEpoch,
    planHash: input.build.planHash,
  })
}

async function ensurePlan(input: {
  scope: WorkspaceScope
  productionId: number
  suppliedPlan?: ProductProductionPlanV3
}) {
  let state = await currentProductionBuild(input.scope, input.productionId)
  if (['paused', 'cancelled', 'failed', 'archived', 'released'].includes(state.build.status)) {
    throw new Error(`[product-production-scheduler] Build 状态 ${state.build.status} 不允许调度`)
  }
  let currentPlan: ProductProductionPlanV3 | null = null
  try {
    currentPlan = parseProductProductionPlanV3(state.build.planJson, state.brief, state.briefRow.briefHash)
  } catch { currentPlan = null }
  if (currentPlan && currentPlan.controlEpoch === state.build.controlEpoch && state.build.planHash === await hashProductProductionValueV2(currentPlan)) {
    // Creator Start already freezes a complete valid Plan while the fresh
    // Build is still `authorized`. Entering scheduling owns only this status
    // transition; it must not recompile or rewrite that Plan.
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
    await ensurePersistedPlanCarriesV1({
      scope: input.scope,
      build: {
        id: state.build.id!, productionId: state.build.productionId,
        buildNumber: state.build.buildNumber, controlEpoch: state.build.controlEpoch,
        planHash: state.build.planHash, status: state.build.status,
      },
      plan: currentPlan,
    })
    state = await currentProductionBuild(input.scope, input.productionId)
    return { ...state, plan: currentPlan }
  }
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
    // Creator Start freezes the complete DAG and budget. A control command
    // only changes task ownership, so recovery rebases that one field instead
    // of invoking today's compiler and silently changing author authorization.
    plan = parseProductProductionPlanV3({
      ...currentPlan,
      controlEpoch: state.build.controlEpoch,
    }, state.brief, state.briefRow.briefHash)
  } else {
    plan = input.suppliedPlan
      ? parseProductProductionPlanV3(input.suppliedPlan, state.brief, state.briefRow.briefHash)
      : await (state.brief.intent.productType === 'text-open-world'
        ? createTextOpenWorldProductionPlanV1({
            brief: state.brief,
            briefHash: state.briefRow.briefHash,
            buildNumber: state.build.buildNumber,
            controlEpoch: state.build.controlEpoch,
          })
        : createProductProductionPlanV3({
          brief: state.brief,
          briefHash: state.briefRow.briefHash,
          buildNumber: state.build.buildNumber,
          controlEpoch: state.build.controlEpoch,
        }))
  }
  if (!input.suppliedPlan && !state.creatorContracts) {
    const reuse = await applyCrossBuildEvolutionReuse({
      scope: input.scope, build: state.build, brief: state.brief, plan,
    })
    plan = reuse.plan
  }
  if (plan.controlEpoch !== state.build.controlEpoch || plan.buildNumber !== state.build.buildNumber) {
    throw new Error('[product-production-scheduler] Plan 与 Build epoch/number 不一致')
  }
  const planHash = await hashProductProductionValueV2(plan)
  await db.transaction('rw', scopeTransactionTables(db.productBuilds), async () => {
    const build = await db.productBuilds.get(state.build.id!)
    if (!build || build.controlEpoch !== state.build.controlEpoch || build.stateRevision !== state.build.stateRevision) {
      throw new Error('[product-production-scheduler] Plan CAS 已过期')
    }
    const previousLedger = parseLedger(build.budgetLedgerJson)
    await db.productBuilds.update(build.id!, {
      status: 'building', planRevision: build.planRevision + 1,
      planJson: canonicalProductProductionJsonV2(plan), planHash,
      // controlEpoch changes invalidate task ownership and receipts, but do not
      // erase already incurred provider usage or an in-flight conservative
      // reservation from this same authorized Build/Brief.
      budgetLedgerJson: canonicalProductProductionJsonV2(emptyLedger({
        charges: previousLedger.charges,
        reservations: previousLedger.reservations,
      })),
      stateRevision: build.stateRevision + 1, startedAt: build.startedAt ?? Date.now(), updatedAt: Date.now(),
    })
  })
  state = await currentProductionBuild(input.scope, input.productionId)
  await ensurePersistedPlanCarriesV1({
    scope: input.scope,
    build: {
      id: state.build.id!, productionId: state.build.productionId,
      buildNumber: state.build.buildNumber, controlEpoch: state.build.controlEpoch,
      planHash: state.build.planHash, status: state.build.status,
    },
    plan,
  })
  state = await currentProductionBuild(input.scope, input.productionId)
  return { ...state, plan }
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
  plan: ProductProductionPlanV3
  snapshot: AgentRunSnapshotV1
  inputHash: string
  candidateHash: string
}): Promise<void> {
  const receiptHash = input.snapshot.projection.terminalReceiptHash
  if (!receiptHash) throw new Error('[product-production-scheduler] carried task 缺少 terminal receipt')
  await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productBuildArtifacts), async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || build.controlEpoch !== input.controlEpoch || build.status !== 'building') {
      throw new Error('[product-production-scheduler] carried task settlement epoch 已过期')
    }
    const allArtifactRows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    assertCarriedForwardRowsAuthorizedV1({
      build: { id: build.id!, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch },
      plan: input.plan,
      rows: allArtifactRows,
    })
    const artifacts = allArtifactRows
      .filter(row => row.controlEpoch === input.controlEpoch
        && row.status === 'carried-forward' && input.task.outputArtifactKeys.includes(row.artifactKey))
    if (artifacts.length !== input.task.outputArtifactKeys.length) {
      throw new Error(`[product-production-scheduler] carried task 输出不完整:${input.task.taskKey}`)
    }
    const now = Date.now()
    for (const artifact of artifacts) await db.productBuildArtifacts.update(artifact.id!, {
      producerRunId: input.snapshot.run.id, producerReceiptHash: receiptHash,
      inputHash: input.inputHash, updatedAt: now,
    })
    const ledger = parseLedger(build.budgetLedgerJson)
    ledger.tasks[input.task.taskKey] = {
      runId: input.snapshot.run.id, attempt: 1, status: 'settled', idempotencyKey: input.inputHash,
      candidateHash: input.candidateHash, terminalReceiptHash: receiptHash,
      passedGateIds: [...input.task.acceptanceGateIds], usage: zeroUsage(), errorCode: null,
    }
    await db.productBuilds.update(build.id!, {
      budgetLedgerJson: canonicalProductProductionJsonV2(ledger), updatedAt: now,
    })
  })
}

function sameCarrySourceEnvelopeV1(
  carried: ProductBuildArtifactRecordV1,
  source: ProductBuildArtifactRecordV1,
): boolean {
  return carried.artifactKey === source.artifactKey
    && carried.requirementKey === source.requirementKey
    && carried.kind === source.kind && carried.mediaKind === source.mediaKind
    && carried.contentHash === source.contentHash && carried.payloadJson === source.payloadJson
    && carried.metadataJson === source.metadataJson && carried.qualityJson === source.qualityJson
    && carried.rightsJson === source.rightsJson && carried.blobObjectId === source.blobObjectId
    && carried.mimeType === source.mimeType && carried.byteSize === source.byteSize
    && carried.parentArtifactHash === source.contentHash
}

function assertCarriedForwardRowsAuthorizedV1(input: {
  build: { id: number; buildNumber: number; controlEpoch: number }
  plan: ProductProductionPlanV3
  rows: ProductBuildArtifactRecordV1[]
}): void {
  const carried = input.rows.filter(row => row.controlEpoch === input.build.controlEpoch
    && row.status === 'carried-forward')
  if (carried.length === 0) return
  if (new Set(carried.map(row => row.artifactKey)).size !== carried.length) {
    throw new Error('[product-production-scheduler] carried-forward Artifact key 重复')
  }
  const byKey = new Map(carried.map(row => [row.artifactKey, row]))
  const ownerTasks = new Map<string, ProductProductionPlanTaskV3>()
  for (const row of carried) {
    const owners = input.plan.tasks.filter(task => task.outputArtifactKeys.includes(row.artifactKey))
    if (owners.length !== 1 || !row.carriedFrom || row.carriedFrom.artifactKey !== row.artifactKey
      || row.carriedFrom.contentHash !== row.contentHash || row.parentArtifactHash !== row.contentHash
      || !isSha256Hash(row.carriedFrom.proofHash)) {
      throw new Error(`[product-production-scheduler] carried-forward row 未获 Plan/lineage 授权:${row.artifactKey}`)
    }
    ownerTasks.set(owners[0].taskKey, owners[0])
  }
  for (const task of ownerTasks.values()) {
    const siblings = task.outputArtifactKeys.map(key => byKey.get(key))
    if (siblings.some(row => row == null)) {
      throw new Error(`[product-production-scheduler] carried-forward task siblings 不完整:${task.taskKey}`)
    }
    const rows = siblings as ProductBuildArtifactRecordV1[]
    const sourceBuildNumbers = new Set(rows.map(row => row.carriedFrom!.buildNumber))
    if (sourceBuildNumbers.size !== 1) {
      throw new Error(`[product-production-scheduler] carried-forward task 来源不唯一:${task.taskKey}`)
    }
    const sourceBuildNumber = rows[0].carriedFrom!.buildNumber
    if (sourceBuildNumber !== input.build.buildNumber) {
      const representative = rows.find(row => row.artifactKey === task.reuse?.sourceArtifactKey)
      if (!task.reuse || task.reuse.sourceBuildNumber !== sourceBuildNumber
        || task.reuse.requiresRevalidation !== true || !representative
        || representative.contentHash !== task.reuse.sourceContentHash
        || !isSha256Hash(task.reuse.reuseKey)) {
        throw new Error(`[product-production-scheduler] carried-forward task 缺少 cross-build reuse 授权:${task.taskKey}`)
      }
      continue
    }
    if (task.executionMode === 'deterministic' || task.reuse !== null) {
      throw new Error(`[product-production-scheduler] carried-forward task 未获 same-build epoch 授权:${task.taskKey}`)
    }
    for (const row of rows) {
      const ref = row.carriedFrom!
      const source = input.rows.find(candidate => candidate.artifactKey === ref.artifactKey
        && candidate.version === ref.version && candidate.contentHash === ref.contentHash
        && candidate.controlEpoch < input.build.controlEpoch)
      if (!source || !sameCarrySourceEnvelopeV1(row, source)) {
        throw new Error(`[product-production-scheduler] carried-forward same-build lineage 不闭合:${row.artifactKey}`)
      }
    }
  }
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
    const allArtifactRows = await db.productBuildArtifacts.where('buildId').equals(input.build.id).toArray()
    assertCarriedForwardRowsAuthorizedV1({
      build: input.build,
      plan: input.plan,
      rows: allArtifactRows,
    })
    const artifacts = allArtifactRows
      .filter(row => row.controlEpoch === input.build.controlEpoch && row.status === 'carried-forward')
    for (const task of input.plan.tasks) {
      if (task.executionMode === 'deterministic') continue
      const outputs = artifacts.filter(row => task.outputArtifactKeys.includes(row.artifactKey))
      if (outputs.length !== task.outputArtifactKeys.length
        || task.dependsOn.some(dependency => !completed.has(dependency))) continue
      const dependencies = task.dependsOn.map(taskKey => ({ taskKey, receiptHash: completed.get(taskKey)! }))
      const candidateHash = await hashProductProductionCarriedCandidateV1(outputs)
      const bindings = normalizedBindings(task, input.capabilityBindings)
      const inputHash = await hashProductProductionValueV2({
        schema: 'storyforge.product-production-carried-task-input', version: 1,
        planHash: input.build.planHash, taskKey: task.taskKey,
        controlEpoch: input.build.controlEpoch, dependencies, candidateHash, capabilityBindings: bindings,
      })
      const existing = children.get(task.taskKey)
      if (existing) {
        if (existing.projection.state !== 'completed') continue
        const receiptHash = existing.projection.terminalReceiptHash!
        const alreadySettled = outputs.every(artifact => (
          artifact.producerRunId === existing.run.id && artifact.producerReceiptHash === receiptHash
            && artifact.inputHash === inputHash
        ))
        if (!alreadySettled) {
          await settleCarriedTask({
            scope: input.scope, buildId: input.build.id, controlEpoch: input.build.controlEpoch,
            task, plan: input.plan, snapshot: existing, inputHash, candidateHash,
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
      const receiptHash = await hashProductProductionCarriedReceiptV1({
        taskKey: task.taskKey, inputHash, candidateHash, dependencies,
        passedGateIds: task.acceptanceGateIds, controlEpoch: input.build.controlEpoch,
      })
      snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash })
      await settleCarriedTask({
        scope: input.scope, buildId: input.build.id, controlEpoch: input.build.controlEpoch,
        task, plan: input.plan, snapshot, inputHash, candidateHash,
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

async function reserveLedgerBudget(input: {
  buildId: number
  controlEpoch: number
  taskKey: string
  runId: number
  expectedLastSequence: number
  attempt: number
  budget: ProductTaskBudgetReservationV1
  limits: ProductProductionBriefV3['productionBudget']
  requiredProviderCall: 'model' | 'media' | null
}): Promise<
  { ok: true; budget: ProductTaskBudgetReservationV1 }
  | { ok: false; violations: string[]; projected: ProductProductionTaskUsageV1 }
> {
  return db.transaction('rw', db.productBuilds, db.agentRuns, async () => {
    const [build, run] = await Promise.all([
      db.productBuilds.get(input.buildId),
      db.agentRuns.get(input.runId),
    ])
    if (!build || build.controlEpoch !== input.controlEpoch || build.status !== 'building') {
      throw new Error('[product-production-scheduler] budget reservation Build 已过期或不在 building')
    }
    if (!run || run.productBuildId !== input.buildId || run.status !== 'running'
      || run.lastSequence !== input.expectedLastSequence) {
      throw new Error('[product-production-scheduler] budget reservation task Run 已被其它执行者推进')
    }
    const ledger = parseLedger(build.budgetLedgerJson)
    const key = ledgerAttemptKey(input.runId, input.attempt)
    if (ledger.charges[key]) {
      throw new Error('[product-production-scheduler] 已计费 attempt 不得重复执行')
    }
    const priorCommittedUsage = sumLedgerUsage([
      ...Object.values(ledger.charges)
        .filter(charge => charge.taskKey === input.taskKey)
        .map(charge => ({
          ...charge.usage,
          costUsd: charge.usage.costUsd ?? charge.costUpperBoundUsd,
        })),
      ...Object.entries(ledger.reservations)
        .filter(([reservationKey, reservation]) => (
          reservationKey !== key && reservation.taskKey === input.taskKey
        ))
        .map(([, reservation]) => reservationAsUsage(reservation.budget)),
    ])
    const remainingBudget = remainingTaskReservation(input.budget, priorCommittedUsage)
    const requested: LedgerReservationV2 = {
      runId: input.runId,
      attempt: input.attempt,
      controlEpoch: input.controlEpoch,
      taskKey: input.taskKey,
      budget: structuredClone(remainingBudget),
    }
    const existing = ledger.reservations[key]
    if (existing && canonicalProductProductionJsonV2(existing) !== canonicalProductProductionJsonV2(requested)) {
      throw new Error('[product-production-scheduler] attempt budget reservation 与已冻结记录不一致')
    }
    const projected = sumLedgerUsage([
      ...Object.values(ledger.charges).map(charge => ({
        ...charge.usage,
        costUsd: charge.usage.costUsd ?? charge.costUpperBoundUsd,
      })),
      ...Object.entries(ledger.reservations)
        .filter(([reservationKey]) => reservationKey !== key)
        .map(([, reservation]) => reservationAsUsage(reservation.budget)),
      reservationAsUsage(remainingBudget),
    ])
    const providerCallViolations = input.requiredProviderCall === 'model' && remainingBudget.modelCalls < 1
      ? ['task-model-calls-depleted']
      : input.requiredProviderCall === 'media' && remainingBudget.mediaCalls < 1
        ? ['task-media-calls-depleted']
        : []
    const violations = [...providerCallViolations, ...briefBudgetViolations(projected, input.limits)]
    if (violations.length > 0) return { ok: false as const, violations, projected }
    ledger.reservations[key] = requested
    await db.productBuilds.update(build.id!, {
      budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
      updatedAt: Date.now(),
    })
    return { ok: true as const, budget: remainingBudget }
  })
}

async function releaseLedgerReservation(input: {
  buildId: number
  runId: number
  attempt: number
  reason: 'pre-dispatch' | 'no-usage-reported'
}): Promise<void> {
  await db.transaction('rw', db.productBuilds, async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build) return
    const ledger = parseLedger(build.budgetLedgerJson)
    const key = ledgerAttemptKey(input.runId, input.attempt)
    if (!ledger.reservations[key]) return
    if (['validating', 'preview-ready', 'release-ready', 'released', 'archived'].includes(build.status)) {
      throw new Error('[product-production-scheduler] terminal claim 后不得释放 provider reservation')
    }
    const reservation = ledger.reservations[key]!
    // Absence is not evidence: retain the exact reason and attempt identity so
    // a deleted/corrupt entry can never let a paused Build enter a new epoch.
    ledger.charges[key] = {
      runId: reservation.runId,
      attempt: reservation.attempt,
      controlEpoch: reservation.controlEpoch,
      taskKey: reservation.taskKey,
      costUpperBoundUsd: 0,
      usage: zeroUsage(),
      resolution: input.reason === 'pre-dispatch'
        ? 'system-released-before-dispatch'
        : 'system-released-no-usage-reported',
    }
    delete ledger.reservations[key]
    await db.productBuilds.update(build.id!, {
      budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
      updatedAt: Date.now(),
    })
  })
}

async function stillOwnsExecutorDispatch(input: {
  scope: WorkspaceScope
  productionId: number
  productType: ProductionProductKindV1
  build: { id: number; buildNumber: number; controlEpoch: number; planHash: string }
}): Promise<boolean> {
  return db.transaction(
    'r',
    scopeTransactionTables(db.productProductions, db.productBuilds),
    async () => {
      const [production, build] = await Promise.all([
        db.productProductions.get(input.productionId),
        db.productBuilds.get(input.build.id),
      ])
      if (!production || !build
        || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })
        || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) return false
      return production.id === input.productionId
        && production.productType === input.productType
        && production.status === 'producing'
        && production.currentBuildNumber === input.build.buildNumber
        && production.controlEpoch === input.build.controlEpoch
        && build.productionId === input.productionId
        && build.buildNumber === input.build.buildNumber
        && build.status === 'building'
        && build.controlEpoch === input.build.controlEpoch
        && build.planHash === input.build.planHash
    },
  )
}

async function recordLedgerCharge(input: {
  buildId: number
  controlEpoch: number
  taskKey: string
  runId: number
  attempt: number
  costUpperBoundUsd: number | null
  usage: ProductProductionTaskUsageV1
}): Promise<'recorded' | 'idempotent' | 'resolution-final'> {
  const usage = parseLedgerUsage(input.usage, 'charged usage')
  return db.transaction('rw', db.productBuilds, async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build) throw new Error('[product-production-scheduler] 计费 Build 已不存在')
    const ledger = parseLedger(build.budgetLedgerJson)
    const key = ledgerAttemptKey(input.runId, input.attempt)
    const existing = ledger.charges[key]
    if (existing) {
      if (existing.taskKey !== input.taskKey
        || (existing.controlEpoch != null && existing.controlEpoch !== input.controlEpoch)) {
        throw new Error('[product-production-scheduler] attempt 计费记录不一致')
      }
      // The author explicitly reconciled an unknown result. That decision is
      // the final accounting authority for this attempt: a callback from the
      // abandoned local executor may never reopen a sealed/new-epoch Build.
      // Upper-bound disposition already covers it; confirmed-not-charged is a
      // deliberate human override after checking the provider account.
      if (existing.resolution != null) return 'resolution-final'
      if (canonicalProductProductionJsonV2(existing.usage)
        !== canonicalProductProductionJsonV2(usage)) {
        throw new Error('[product-production-scheduler] attempt 计费记录不一致')
      }
      if (existing.controlEpoch == null) {
        existing.controlEpoch = input.controlEpoch
        existing.costUpperBoundUsd = input.costUpperBoundUsd
        await db.productBuilds.update(build.id!, {
          budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
          updatedAt: Date.now(),
        })
      }
      return 'idempotent'
    } else {
      const reservation = ledger.reservations[key]
      if (!reservation || reservation.runId !== input.runId
        || reservation.attempt !== input.attempt
        || reservation.taskKey !== input.taskKey
        || reservation.controlEpoch !== input.controlEpoch) {
        throw new Error('[product-production-scheduler] 迟到计费缺少同 attempt 的冻结 reservation')
      }
      if (['validating', 'preview-ready', 'release-ready', 'released', 'archived'].includes(build.status)) {
        throw new Error('[product-production-scheduler] terminal claim 后不得新增 provider charge')
      }
      ledger.charges[key] = {
        runId: input.runId,
        attempt: input.attempt,
        controlEpoch: input.controlEpoch,
        taskKey: input.taskKey,
        costUpperBoundUsd: input.costUpperBoundUsd,
        usage,
        resolution: null,
      }
    }
    delete ledger.reservations[key]
    await db.productBuilds.update(build.id!, {
      budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
      updatedAt: Date.now(),
    })
    return 'recorded'
  })
}

async function settleLedger(input: {
  buildId: number
  controlEpoch: number
  taskKey: string
  entry: LedgerTaskV1
}): Promise<void> {
  await db.transaction('rw', db.productBuilds, async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || build.controlEpoch !== input.controlEpoch || build.status !== 'building') {
      throw new Error('[product-production-scheduler] ledger epoch 已过期或已进入 terminal claim')
    }
    const ledger = parseLedger(build.budgetLedgerJson)
    const existing = ledger.tasks[input.taskKey]
    if (existing && canonicalProductProductionJsonV2(existing)
      === canonicalProductProductionJsonV2(input.entry)) {
      return
    }
    if (existing?.status === 'settled') {
      throw new Error('[product-production-scheduler] task ledger settled 重放内容不一致')
    }
    const validClaimTransition = existing?.status === 'claimed'
      && existing.runId === input.entry.runId
    const validRetryTransition = existing?.status === 'failed'
      && existing.runId === input.entry.runId
      && input.entry.attempt > existing.attempt
    if (existing && !validClaimTransition && !validRetryTransition) {
      throw new Error('[product-production-scheduler] task ledger 不能从当前状态结算')
    }
    ledger.tasks[input.taskKey] = input.entry
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
  // Checkpoint recovery may reach acceptance after a process crash. Charging
  // by run/attempt is idempotent, so replay can neither lose nor double usage.
  await recordLedgerCharge({
    buildId: input.buildId,
    controlEpoch: input.controlEpoch,
    taskKey: input.task.taskKey,
    runId: input.snapshot.run.id,
    attempt: input.candidate.attempt,
    costUpperBoundUsd: proportionalCostUpperBound(
      input.task.budgetReservation,
      input.candidate.result.usage,
    ),
    usage: input.candidate.result.usage,
  })
  const settledEntry: LedgerTaskV1 = {
    runId: input.snapshot.run.id, attempt: input.candidate.attempt, status: 'settled',
    idempotencyKey: input.candidate.inputHash, candidateHash: input.candidate.candidateHash,
    terminalReceiptHash: receiptHash, passedGateIds: input.candidate.result.passedGateIds,
    usage: input.candidate.result.usage, errorCode: null,
  }
  if (input.task.taskKey === 'p0.source-lock') {
    const pinArtifact = input.candidate.result.artifacts.find(artifact => (
      artifact.artifactKey === 'text-open-world.source-pin'
        && artifact.kind === 'text-open-world.source-pin'
    ))
    if (!pinArtifact) throw new Error('[product-production-scheduler] P0 candidate 缺少 SourcePin closure marker')
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
    // Settle first: a concurrent cycle can never observe a partial source
    // package as runnable input. If persistence crashes, recovery replays this
    // idempotent ledger entry and then atomically writes the complete bundle.
    await settleLedger({
      buildId: input.buildId, controlEpoch: input.controlEpoch,
      taskKey: input.task.taskKey, entry: settledEntry,
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
    entry: settledEntry,
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
  const receiptHash = await hashProductProductionTaskReceiptV1({
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
  if (snapshot.projection.state === 'completed' && input.task.taskKey !== 'p0.source-lock') {
    const build = await db.productBuilds.get(input.buildId)
    const settled = build == null ? null : parseLedger(build.budgetLedgerJson).tasks[input.task.taskKey]
    if (settled?.status === 'settled') {
      const rows = (await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray())
        .filter(row => row.controlEpoch === input.controlEpoch
          && row.status === 'accepted'
          && input.task.outputArtifactKeys.includes(row.artifactKey))
      const actualKeys = rows.map(row => row.artifactKey).sort()
      const expectedKeys = [...input.task.outputArtifactKeys].sort()
      if (rows.length !== expectedKeys.length
        || expectedKeys.some((key, index) => key !== actualKeys[index])
        || rows.some(row => row.producerRunId !== snapshot.run.id
          || row.producerReceiptHash !== snapshot.projection.terminalReceiptHash
          || row.inputHash !== candidate.inputHash)) {
        throw new Error(`[product-production-scheduler] settled task Artifact set 已删除或篡改:${input.task.taskKey}`)
      }
    }
  }
  if (snapshot.projection.state !== 'completed') {
    const step = snapshot.projection.steps[input.task.taskKey]
    if (!step || step.candidateHash !== candidate.candidateHash || step.status !== 'running') return false
    snapshot = await finishCandidateRun({ scope: input.scope, snapshot, task: input.task, candidate })
  }
  await acceptCandidate({ ...input, snapshot, candidate })
  return true
}

type TimedOutRunningTaskStateV1 = 'pre-dispatch' | 'request-result-unknown' | 'response-uncheckpointed'

function timedOutRunningTaskState(input: {
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
  now: number
}): { state: TimedOutRunningTaskStateV1; attempt: number; startedAt: number } | null {
  const step = input.snapshot.projection.steps[input.task.taskKey]
  if (input.snapshot.projection.state !== 'running' || step?.status !== 'running' || step.attempt < 1) return null
  const started = [...input.snapshot.events].reverse().find(event => (
    event.type === 'step.started'
    && event.payload.stepId === input.task.taskKey
    && event.payload.attempt === step.attempt
  ))
  if (!started || input.now < started.createdAt + input.task.timeoutMs) return null
  const attemptEvents = input.snapshot.events.filter(event => event.sequence >= started.sequence)
  const pending = new Map<string, AnyAgentRunEventV1>()
  let responseObserved = false
  const executorOwnsNestedModelBoundaries = productProductionTaskOwnsWorldGatewayV1(input.task)
  for (const event of attemptEvents) {
    const mainAttemptBoundary = 'stepId' in event.payload && 'attempt' in event.payload
      && event.payload.stepId === input.task.taskKey
      && event.payload.attempt === step.attempt
    const ownedNestedModelBoundary = executorOwnsNestedModelBoundaries
      && 'stepId' in event.payload
      && typeof event.payload.stepId === 'string'
      && event.payload.stepId.startsWith(`${input.task.taskKey}.`)
    if (input.task.executionMode === 'model' && event.type === 'model.requested'
      && (mainAttemptBoundary || ownedNestedModelBoundary)) {
      pending.set(`model:${event.payload.stepId}:${event.payload.attempt}`, event)
    } else if (input.task.executionMode === 'model' && event.type === 'model.responded'
      && (mainAttemptBoundary || ownedNestedModelBoundary)) {
      responseObserved = true
      pending.delete(`model:${event.payload.stepId}:${event.payload.attempt}`)
    } else if (input.task.executionMode === 'model'
      && event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'raw-response'
      && (mainAttemptBoundary || ownedNestedModelBoundary)) {
      // onModelOutput is the first durable boundary after the provider body is
      // observed. A scheduler timeout can win before the executor returns and
      // before the outer candidate hash exists, but this exact evidence still
      // proves that the request result is no longer unknown. Keep its
      // reservation for the returning executor to settle; never offer the
      // author a confirmed-not-charged disposition for this ordering.
      responseObserved = true
      pending.delete(`model:${event.payload.stepId}:${event.payload.attempt}`)
    } else if (input.task.executionMode === 'media-provider'
      && event.type === 'tool.called' && event.payload.toolName === 'game-media-provider'
      && mainAttemptBoundary) {
      pending.set(`media:${event.payload.stepId}:${event.payload.attempt}`, event)
    } else if (input.task.executionMode === 'media-provider'
      && event.type === 'tool.returned' && event.payload.toolName === 'game-media-provider'
      && mainAttemptBoundary) {
      responseObserved = true
      pending.delete(`media:${event.payload.stepId}:${event.payload.attempt}`)
    }
  }
  return {
    state: pending.size > 0
      ? 'request-result-unknown'
      : responseObserved || step.candidateHash ? 'response-uncheckpointed' : 'pre-dispatch',
    attempt: step.attempt,
    startedAt: started.createdAt,
  }
}

async function recoverTimedOutRunningTask(input: {
  scope: WorkspaceScope
  build: { id: number; buildNumber: number; controlEpoch: number; planHash: string }
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
  now?: number
}): Promise<'unchanged' | 'retry-ready' | 'blocked'> {
  const interrupted = timedOutRunningTaskState({
    task: input.task,
    snapshot: input.snapshot,
    now: input.now ?? Date.now(),
  })
  if (!interrupted) return 'unchanged'
  let snapshot = await readAgentRunV1(input.scope, input.snapshot.run.id)
  const step = snapshot.projection.steps[input.task.taskKey]
  if (snapshot.projection.state !== 'running' || step?.status !== 'running'
    || step.attempt !== interrupted.attempt) return 'unchanged'
  const buildBeforeRecovery = await db.productBuilds.get(input.build.id)
  if (!buildBeforeRecovery || buildBeforeRecovery.controlEpoch !== input.build.controlEpoch
    || buildBeforeRecovery.planHash !== input.build.planHash) return 'unchanged'

  const canRetryBeforeDispatch = interrupted.state === 'pre-dispatch'
    && interrupted.attempt < input.task.maxAttempts
  const code = interrupted.state === 'request-result-unknown'
    ? 'unknown-result'
    : interrupted.state === 'response-uncheckpointed'
      ? 'provider-response-uncheckpointed'
      : 'task-timeout-before-dispatch'
  snapshot = await append(input.scope, snapshot, 'step.failed', {
    stepId: input.task.taskKey,
    attempt: interrupted.attempt,
    code,
    retryable: canRetryBeforeDispatch,
    category: canRetryBeforeDispatch ? 'transient' : 'unknown',
    action: canRetryBeforeDispatch ? 'retry' : 'fail',
  })

  const build = await db.productBuilds.get(input.build.id)
  if (!build || build.controlEpoch !== input.build.controlEpoch || build.planHash !== input.build.planHash) {
    return 'unchanged'
  }
  const ledger = parseLedger(build.budgetLedgerJson)
  const key = ledgerAttemptKey(snapshot.run.id, interrupted.attempt)
  const chargedUsage = ledger.charges[key]?.usage ?? null
  if (interrupted.state === 'pre-dispatch') {
    await releaseLedgerReservation({
      buildId: input.build.id,
      runId: snapshot.run.id,
      attempt: interrupted.attempt,
      reason: 'pre-dispatch',
    })
  }
  if (canRetryBeforeDispatch) {
    await settleLedger({
      buildId: input.build.id,
      controlEpoch: input.build.controlEpoch,
      taskKey: input.task.taskKey,
      entry: {
        runId: snapshot.run.id,
        attempt: interrupted.attempt,
        status: 'failed',
        idempotencyKey: '',
        candidateHash: null,
        terminalReceiptHash: null,
        passedGateIds: [],
        usage: zeroUsage(),
        errorCode: code,
      },
    })
    return 'retry-ready'
  }

  snapshot = await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
  await settleLedger({
    buildId: input.build.id,
    controlEpoch: input.build.controlEpoch,
    taskKey: input.task.taskKey,
    entry: {
      runId: snapshot.run.id,
      attempt: interrupted.attempt,
      status: 'failed',
      idempotencyKey: '',
      candidateHash: step.candidateHash ?? null,
      terminalReceiptHash: null,
      passedGateIds: [],
      usage: chargedUsage,
      errorCode: code,
    },
  })
  await db.transaction('rw', scopeTransactionTables(db.productBuilds), async () => {
    const current = await db.productBuilds.get(input.build.id)
    if (!current || current.controlEpoch !== input.build.controlEpoch
      || current.planHash !== input.build.planHash) return
    const currentLedger = parseLedger(current.budgetLedgerJson)
    const reservationRetained = Boolean(currentLedger.reservations[key])
    await db.productBuilds.update(current.id!, {
      status: 'recovery-required',
      updatedAt: Date.now(),
      failureJson: canonicalProductProductionJsonV2({
        taskKey: input.task.taskKey,
        code,
        attempt: interrupted.attempt,
        detail: interrupted.state === 'request-result-unknown'
          ? '任务超时前已经跨越 provider dispatch 边界，但没有持久化响应；禁止自动重发。'
          : interrupted.state === 'response-uncheckpointed'
            ? '任务已持久化 provider 响应证据，但尚未形成可恢复候选检查点；禁止自动重发。'
            : '任务在 provider dispatch 前超时，且已用尽自动尝试次数。',
        timedOutAt: interrupted.startedAt + input.task.timeoutMs,
        timeoutMs: input.task.timeoutMs,
        resultStatus: interrupted.state === 'request-result-unknown' ? 'unknown' : 'known-incomplete',
        reservationDisposition: chargedUsage ? 'settled' : reservationRetained ? 'retained' : 'none',
        automaticRetryAllowed: false,
        failureProvenance: taskFailureProvenance({ snapshot, build: input.build, attempt: interrupted.attempt }),
      }),
    })
  })
  return 'blocked'
}

async function runClaimedTask(input: {
  scope: WorkspaceScope
  productionId: number
  productType: ProductionProductKindV1
  brief: ProductProductionBriefV3
  build: { id: number; buildNumber: number; controlEpoch: number; planHash: string; failureJson: string }
  task: ProductProductionPlanTaskV3
  snapshot: AgentRunSnapshotV1
  executor: ProductProductionTaskExecutorV1
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
  const bindings = normalizedBindings(input.task, input.capabilityBindings)
  const localProceduralMedia = isLocalProceduralMediaTaskV1(input.task, bindings)
  const dependencyRuns = await Promise.all(input.task.dependsOn.map(async taskKey => {
    const row = await db.agentRuns.where('[parentRunId+parentRelation]')
      .equals([snapshot.run.parentRunId!, `task:${taskKey}`]).first()
    if (!row?.terminalReceiptHash) throw new Error(`[product-production-scheduler] dependency receipt 缺失:${taskKey}`)
    return { taskKey, receiptHash: row.terminalReceiptHash }
  }))
  const structuralInput = {
    planHash: input.build.planHash, taskKey: input.task.taskKey, controlEpoch: input.build.controlEpoch,
    dependencies: dependencyRuns, artifacts: artifacts.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
    capabilityBindings: bindings,
  }
  let repairState: Record<string, any> = {}
  try {
    const parsed = JSON.parse(input.build.failureJson)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) repairState = parsed
  } catch { /* a missing resolution means a normal first attempt */ }
  const recoveryPolicy = resolveProductProductionTaskRecoveryPolicyV1({
    productType: input.productType,
    task: input.task,
  })
  const usesDedicatedTaskContextBudget = input.productType === 'text-open-world'
    && input.task.executionMode === 'model'
  const isolateRepairFeedback = usesDedicatedTaskContextBudget
    && recoveryPolicy.repairFeedbackContextAllowed
  let matchingRepair: Record<string, unknown> | null = null
  if (repairState.blockerKey === input.task.taskKey
    && repairState.resolution && typeof repairState.resolution === 'object') {
    try {
      const validatedRepair = await validateProductProductionRecoveryDirectiveV1({
        scope: input.scope,
        productProductionId: input.productionId,
        productBuildId: input.build.id,
        productProductionTaskKey: input.task.taskKey,
        expectedState: 'resolved',
        allowLegacyRetry: true,
      })
      matchingRepair = validatedRepair.resolution
    } catch (error) {
      const code = 'task-recovery-provenance-invalid'
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: input.task.taskKey,
        attempt,
        code,
        retryable: false,
        category: 'deterministic',
        action: 'fail',
      })
      snapshot = await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
      await settleLedger({
        buildId: input.build.id,
        controlEpoch: input.build.controlEpoch,
        taskKey: input.task.taskKey,
        entry: {
          runId: snapshot.run.id,
          attempt,
          status: 'failed',
          idempotencyKey: '',
          candidateHash: null,
          terminalReceiptHash: null,
          passedGateIds: [],
          usage: zeroUsage(),
          errorCode: code,
        },
      })
      await db.transaction('rw', scopeTransactionTables(db.productBuilds), async () => {
        const build = await db.productBuilds.get(input.build.id)
        if (!build || build.controlEpoch !== input.build.controlEpoch) return
        await db.productBuilds.update(input.build.id, {
          status: 'recovery-required',
          updatedAt: Date.now(),
          failureJson: canonicalProductProductionJsonV2({
            taskKey: input.task.taskKey,
            code,
            attempt,
            detail: safeExecutorError(error),
            failureProvenance: taskFailureProvenance({ snapshot, build: input.build, attempt }),
          }),
        })
      })
      return
    }
  }
  // The repair source does not exist on a normal first attempt. Including it
  // unconditionally would either make an empty failureJson look like a repair
  // directive or leak another task's blocker into this task's context.
  const normalSourceKeys = taskContextSourceKeys(
    input.task,
    isolateRepairFeedback || matchingRepair == null || !recoveryPolicy.repairFeedbackContextAllowed,
  )
  const contractSourceKeys = taskContractContextSourceKeys(input.task)
  const totalInputBudget = Math.max(1, input.task.budgetReservation.inputTokens)
  const worldGatewayUsed = productProductionTaskUsesWorldGatewayV1(input.task)
  const executorOwnsWorldGateway = productProductionTaskOwnsWorldGatewayV1(input.task)
  const worldGatewayRequired = worldGatewayUsed && !executorOwnsWorldGateway
  const authorDraftJson = matchingRepair?.action === 'author-edit'
    && recoveryPolicy?.authorDraftAllowed === true
    && typeof matchingRepair.authorDraftJson === 'string'
    ? matchingRepair.authorDraftJson
    : undefined
  const authorDraftHash = authorDraftJson === undefined
    ? null
    : await hashProductProductionValueV2(authorDraftJson)
  const separateRepairFeedback = isolateRepairFeedback
    && matchingRepair != null
    && ['retry', 'change-capability'].includes(String(matchingRepair.action))
    && recoveryPolicy?.repairFeedbackContextAllowed === true
  const requiresExactContext = worldGatewayUsed || input.task.executionMode === 'model'
  // The actual frozen world packet is added and checked below; a fixed 40%
  // slice needlessly truncated valid Brief + repair inputs in small worlds.
  let repairAssembled: AssembleContextResult | null = null
  let normalAssembled: AssembleContextResult
  try {
    normalAssembled = await assembleContext({
      projectId: input.scope.projectId, scope: input.scope, sourceKeys: normalSourceKeys,
      productProductionId: input.productionId, productBuildId: input.build.id,
      productProductionTaskKey: input.task.taskKey,
      productArtifactKeys: input.task.inputArtifactKeys,
      // The dedicated open-world compiler owns a frozen, atomic stage packet and
      // its Plan reservation is the explicit request boundary. Shared executors
      // still cap against their selected-model fallback. P1 additionally owns
      // its own batched world-Gateway calls under the same reservation.
      ...(usesDedicatedTaskContextBudget || executorOwnsWorldGateway
        ? { inputBudgetTokens: totalInputBudget }
        : { inputBudgetMaxTokens: totalInputBudget }),
      ...(requiresExactContext ? { sourceTransformer: preserveProductProductionContextV1 } : {}),
    })
    if (requiresExactContext && (normalAssembled.overBudgetAfterTrim || !normalAssembled.sourceEvidence || normalAssembled.sourceEvidence.some(source => (
      source.status !== 'included' || source.delivery !== 'full'
    )))) {
      throw new ProductProductionContextBudgetErrorV1('[product-production-context] 制作合同或依赖产物未完整进入任务预算；未调用模型，请缩小制作范围。')
    }
    if (separateRepairFeedback) {
      // The stage packet is authoritative and atomic. Only after it passes at
      // the full Plan allowance may untrusted repair evidence consume the real
      // remainder; repair text can never squeeze or truncate the task input.
      const repairBudget = totalInputBudget - normalAssembled.totalInputTokens
      if (repairBudget < 1) {
        throw new ProductProductionContextBudgetErrorV1('[product-production-context] 权威任务上下文已用完Plan预算，无法交付修复证据；未调用模型。')
      }
      repairAssembled = await assembleContext({
        projectId: input.scope.projectId,
        scope: input.scope,
        sourceKeys: ['product-production.repair-feedback'],
        productProductionId: input.productionId,
        productBuildId: input.build.id,
        productProductionTaskKey: input.task.taskKey,
        inputBudgetTokens: repairBudget,
      })
      if (!repairAssembled.text.trim()
        || !repairAssembled.included.includes('product-production.repair-feedback')
        || repairAssembled.totalInputTokens > repairBudget) {
        throw new ProductProductionContextBudgetErrorV1('[product-production-context] 修复证据无法在权威上下文的剩余Plan预算内交付；未调用模型。')
      }
    }
  } catch (error) {
    if (!(error instanceof ProductProductionContextBudgetErrorV1)
      && !(error instanceof ContextSourceBudgetErrorV1)) throw error
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
        failureJson: canonicalProductProductionJsonV2({
          taskKey: input.task.taskKey,
          code,
          attempt,
          detail: error.message,
          failureProvenance: taskFailureProvenance({ snapshot, build: input.build, attempt }),
        }),
      })
    })
    return
  }
  let assembled = repairAssembled
    ? combineRegisteredContextAssembliesV1({
        primary: normalAssembled,
        supplemental: repairAssembled,
        inputBudget: totalInputBudget,
      })
    : normalAssembled
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
      const contracts = await readTextOpenWorldCreatorExecutionBriefV1({
        briefRow,
        planJson: build.planJson,
      })
      sourcePlanHash = contracts.sourcePlan.planHash
      confirmedBriefHash = contracts.start.startHash
      // P1 owns exact per-batch Gateway attempts. A future shared-Gateway
      // Creator task needs an explicit dual-source adapter; it may not coerce
      // the Creator plan into the legacy world-only SourcePlan contract.
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
        sourceSnapshots: gatewayExecution.sourceSnapshots,
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
      declaredSourceKeys: repairAssembled
        ? [...normalSourceKeys, 'product-production.repair-feedback']
        : normalSourceKeys,
      assembled,
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
    repairFeedbackHash: repairAssembled
      ? await hashProductProductionValueV2(repairAssembled.text)
      : null,
    authorDraftHash,
  })
  const executionReservation: ProductTaskBudgetReservationV1 = authorDraftJson
    ? {
        modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
        maximumCostUsd: 0,
        durationMs: input.task.budgetReservation.durationMs,
        storageBytes: input.task.budgetReservation.storageBytes,
      }
    : input.task.budgetReservation
  const budgetReservation = await reserveLedgerBudget({
    buildId: input.build.id,
    controlEpoch: input.build.controlEpoch,
    taskKey: input.task.taskKey,
    runId: snapshot.run.id,
    expectedLastSequence: snapshot.projection.lastSequence,
    attempt,
    budget: executionReservation,
    limits: input.brief.productionBudget,
    requiredProviderCall: authorDraftJson !== undefined
      ? null
      : input.task.executionMode === 'model'
        ? 'model'
        : input.task.executionMode === 'media-provider' ? 'media' : null,
  })
  if (!budgetReservation.ok) {
    const code = 'brief-production-budget-exhausted'
    const detail = `Brief 累计生产预算无法覆盖下一次任务预留:${budgetReservation.violations.join(',')}`
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: input.task.taskKey, attempt, code,
      retryable: false, category: 'deterministic', action: 'fail',
    })
    snapshot = await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
    await settleLedger({
      buildId: input.build.id, controlEpoch: input.build.controlEpoch, taskKey: input.task.taskKey,
      entry: {
        runId: snapshot.run.id, attempt, status: 'failed', idempotencyKey: inputHash,
        candidateHash: null, terminalReceiptHash: null, passedGateIds: [],
        usage: zeroUsage(), errorCode: code,
      },
    })
    await db.transaction('rw', scopeTransactionTables(db.productBuilds), async () => {
      const build = await db.productBuilds.get(input.build.id)
      if (!build || build.controlEpoch !== input.build.controlEpoch) return
      await db.productBuilds.update(input.build.id, {
        status: 'recovery-required',
        failureJson: canonicalProductProductionJsonV2({
          taskKey: input.task.taskKey,
          code,
          attempt,
          detail,
          violations: budgetReservation.violations,
          projectedUsage: budgetReservation.projected,
          limits: input.brief.productionBudget,
          failureProvenance: taskFailureProvenance({ snapshot, build: input.build, attempt }),
        }),
        updatedAt: Date.now(),
      })
    })
    return
  }
  const attemptReservation = budgetReservation.budget
  snapshot = await append(input.scope, snapshot, 'budget.reserved', {
    stepId: input.task.taskKey,
    modelCalls: attemptReservation.modelCalls,
    toolCalls: attemptReservation.mediaCalls,
    tokens: attemptReservation.inputTokens + attemptReservation.outputTokens,
  })
  if (authorDraftJson !== undefined || repairAssembled) {
    const recorded = await recordAgentRunArtifactV1({
      scope: input.scope, runId: snapshot.run.id, stepId: input.task.taskKey, attempt,
      artifactKind: 'source-snapshot',
      content: authorDraftJson ?? repairAssembled!.text,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = recorded.snapshot
  }
  const bindingHash = snapshot.contract.runtimeBindingHash
    ?? await hashProductProductionValueV2(snapshot.contract.executionBindings ?? { deterministic: input.task.kind })
  // step.started is the durable execution lease: it is valid for exactly the
  // task timeout and is never silently renewed. Re-check immediately before
  // the provider boundary so a slow preflight cannot dispatch after expiry.
  const expiredBeforeDispatch = await recoverTimedOutRunningTask({
    scope: input.scope,
    build: {
      id: input.build.id,
      buildNumber: input.build.buildNumber,
      controlEpoch: input.build.controlEpoch,
      planHash: input.build.planHash,
    },
    task: input.task,
    snapshot,
  })
  if (expiredBeforeDispatch !== 'unchanged') return
  if (input.task.executionMode === 'model' && !authorDraftJson && !executorOwnsWorldGateway) {
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
  await input.onDurableBoundary?.('provider.requested', snapshot)
  // A pause/stop/repair command can commit from another tab after the durable
  // request marker but before this process enters its executor. Re-read both
  // Work-owned authorities at the last local boundary. This cannot close a
  // remote provider's own race after dispatch, but it prevents a request that
  // is already stale locally from crossing that boundary.
  if (!await stillOwnsExecutorDispatch({
    scope: input.scope,
    productionId: input.productionId,
    productType: input.productType,
    build: input.build,
  })) {
    await releaseLedgerReservation({
      buildId: input.build.id,
      runId: snapshot.run.id,
      attempt,
      reason: 'pre-dispatch',
    })
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: input.task.taskKey,
      attempt,
      code: 'task-stale-before-executor-dispatch',
      retryable: false,
      category: 'stale-input',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.cancelled', {
      reason: 'task-stale-before-executor-dispatch',
    })
    return
  }
  let result: ProductProductionTaskExecutionResultV1
  let returnedUsage: ProductProductionTaskUsageV1 | null = null
  let usageCharged = false
  let lateModelOutputDiscarded = false
  const refreshExecutionAttemptAuthority = async (): Promise<boolean> => {
    snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
    const step = snapshot.projection.steps[input.task.taskKey]
    if (snapshot.projection.state !== 'running'
      || step?.status !== 'running'
      || step.attempt !== attempt) return false
    return stillOwnsExecutorDispatch({
      scope: input.scope,
      productionId: input.productionId,
      productType: input.productType,
      build: input.build,
    })
  }
  try {
    result = await input.executor({
      scope: input.scope, productionId: input.productionId, buildId: input.build.id,
      buildNumber: input.build.buildNumber, controlEpoch: input.build.controlEpoch,
      planHash: input.build.planHash, task: input.task,
      attemptBudgetReservation: attemptReservation,
      attempt,
      idempotencyKey: inputHash, taskRunId: snapshot.run.id,
      contextText: repairAssembled ? normalAssembled.text : assembled.text,
      authorDraftJson,
      repairFeedbackText: repairAssembled?.text,
      inputArtifacts: artifacts, capabilityBindings: bindings, signal: input.signal,
      beforeAdditionalModelRequest: async () => {
        if (!await refreshExecutionAttemptAuthority()) {
          lateModelOutputDiscarded = true
          return 'discarded-stale'
        }
      },
      onModelOutput: async output => {
        // A provider may return after another scheduler has timed out this
        // attempt or an author/control command has advanced the Build epoch.
        // The old Run is immutable once terminal, and the artifact store is not
        // an isolated late-response ledger, so there is no lawful owner for the
        // late body. Drop it; the charge/reservation ledger plus the Run's
        // existing terminal evidence remain the auditable record.
        if (!await refreshExecutionAttemptAuthority()) {
          lateModelOutputDiscarded = true
          return 'discarded-stale'
        }
        try {
          const recorded = await recordAgentRunArtifactV1({
            scope: input.scope, runId: snapshot.run.id, stepId: input.task.taskKey, attempt,
            artifactKind: 'raw-response', content: output,
            expectedLastSequence: snapshot.projection.lastSequence,
          })
          snapshot = recorded.snapshot
        } catch (error) {
          // Close the check/write race only when another authority actually
          // made this attempt stale. Genuine evidence failures on a live
          // attempt must still fail closed.
          if (!await refreshExecutionAttemptAuthority()) {
            lateModelOutputDiscarded = true
            return 'discarded-stale'
          }
          throw error
        }
      },
    })
    // The provider/executor has returned. Capture structurally valid usage
    // before validating artifacts and gates so a malformed candidate cannot
    // erase a real paid call or obtain a hidden free retry.
    returnedUsage = captureReturnedUsage(result)
    if (returnedUsage) {
      await recordLedgerCharge({
        buildId: input.build.id,
        controlEpoch: input.build.controlEpoch,
        taskKey: input.task.taskKey,
        runId: snapshot.run.id,
        attempt,
        costUpperBoundUsd: proportionalCostUpperBound(executionReservation, returnedUsage),
        usage: returnedUsage,
      })
      usageCharged = true
      try {
        boundedUsage(returnedUsage, attemptReservation)
      } catch {
        throw new ProductProductionAttemptBudgetExceededErrorV1()
      }
    }
    // Accounting above intentionally precedes this return. A discarded late
    // body must not be parsed into, checkpointed as, or adopted as a candidate.
    if (lateModelOutputDiscarded) return
    validateExecutionResult(input.task, result)
    // A bounded-batch executor may have appended exact per-call evidence to
    // this same durable task run. Refresh before the scheduler continues.
    snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
  } catch (error) {
    // Executors may append bounded child-step evidence through taskRunId before
    // failing. Refresh unconditionally so the scheduler never writes failure
    // evidence against a stale event sequence.
    snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
    if (!returnedUsage && (error instanceof ProductProductionDraftRejectedErrorV1
      || error instanceof ProductProductionRetryableExecutionErrorV1)) {
      try { returnedUsage = parseLedgerUsage(error.usage, 'rejected draft usage') } catch { /* invalid usage stays conservatively reserved */ }
    }
    const resultUnknown = error instanceof ProductProductionResultUnknownErrorV1
      || (error instanceof Error && error.name === 'ProductProductionResultUnknownErrorV1')
    const explicitlyRetryable = error instanceof ProductProductionRetryableExecutionErrorV1
    let attemptBudgetExceeded = error instanceof ProductProductionAttemptBudgetExceededErrorV1
    if (returnedUsage && !usageCharged) {
      await recordLedgerCharge({
        buildId: input.build.id,
        controlEpoch: input.build.controlEpoch,
        taskKey: input.task.taskKey,
        runId: snapshot.run.id,
        attempt,
        costUpperBoundUsd: proportionalCostUpperBound(executionReservation, returnedUsage),
        usage: returnedUsage,
      })
      usageCharged = true
    } else if (!returnedUsage && !resultUnknown) {
      // No executor/provider usage was returned, so there is no auditable
      // charge to carry. Known paid responses use the branch above and can
      // never be released by retry or an epoch change.
      await releaseLedgerReservation({
        buildId: input.build.id,
        runId: snapshot.run.id,
        attempt,
        reason: 'no-usage-reported',
      })
    }
    if (returnedUsage && !attemptBudgetExceeded) {
      try { boundedUsage(returnedUsage, attemptReservation) }
      catch { attemptBudgetExceeded = true }
    }
    // A concurrent timeout/control flow owns the terminal transition. Usage or
    // reservation disposition is already closed above; do not append failure
    // evidence to its immutable Run (which would itself throw and reject the
    // original scheduler promise).
    if (lateModelOutputDiscarded || !await refreshExecutionAttemptAuthority()) return
    const failure = await classifyHarnessFailureV1(error)
    const recordedFailure = await recordAgentRunArtifactV1({
      scope: input.scope, runId: snapshot.run.id, stepId: input.task.taskKey, attempt,
      artifactKind: 'tool-result',
      content: canonicalProductProductionJsonV2({
        schema: 'storyforge.product-task-failure', version: 1,
        taskKey: input.task.taskKey,
        detail: safeExecutorError(error),
        resultStatus: resultUnknown ? 'unknown' : 'known-failure',
        reservationDisposition: resultUnknown ? 'retained' : returnedUsage ? 'settled' : 'released',
        ...(resultUnknown ? { automaticRetryAllowed: false } : {}),
      }),
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = recordedFailure.snapshot
    const code = resultUnknown ? 'unknown-result'
      : attemptBudgetExceeded ? 'task-budget-exceeded'
      : error instanceof Error && error.name === 'AbortError' ? 'task-aborted'
      : error instanceof ProductProductionDraftRejectedErrorV1 ? 'task-draft-rejected'
      : explicitlyRetryable ? 'task-executor-failed'
      : error instanceof Error && error.message.includes('provider-safety-refusal')
        ? 'provider-safety-refusal' : !failure.retryable ? 'task-executor-nonretryable' : 'task-executor-failed'
    const retryable = code !== 'unknown-result'
      && code !== 'task-budget-exceeded' && code !== 'task-aborted'
      && code !== 'provider-safety-refusal' && code !== 'task-draft-rejected'
      && (explicitlyRetryable || failure.retryable) && attempt < input.task.maxAttempts
    if (returnedUsage) {
      snapshot = await append(input.scope, snapshot, 'budget.settled', {
        stepId: input.task.taskKey,
        modelCalls: returnedUsage.modelCalls,
        toolCalls: returnedUsage.mediaCalls,
        tokens: returnedUsage.inputTokens + returnedUsage.outputTokens,
      })
    }
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: input.task.taskKey, attempt, code,
      retryable,
      category: code === 'task-aborted' ? 'cancelled'
        : code === 'provider-safety-refusal' || code === 'task-budget-exceeded'
          ? 'deterministic' : 'unknown',
      action: retryable ? 'retry' : 'fail',
    })
    const current = await db.productBuilds.get(input.build.id)
    if (!current || current.controlEpoch !== input.build.controlEpoch
      || ['paused', 'cancelled', 'failed', 'archived', 'released'].includes(current.status)) {
      await append(input.scope, snapshot, 'run.cancelled', { reason: 'task-failed-after-control-epoch-change' })
      return
    }
    await settleLedger({
      buildId: input.build.id, controlEpoch: input.build.controlEpoch, taskKey: input.task.taskKey,
      entry: {
        runId: snapshot.run.id, attempt, status: 'failed', idempotencyKey: inputHash,
        candidateHash: null, terminalReceiptHash: null, passedGateIds: [],
        usage: returnedUsage, errorCode: code,
      },
    })
    if (!retryable) {
      snapshot = code === 'task-aborted'
        ? await append(input.scope, snapshot, 'run.cancelled', { reason: 'task-executor-aborted' })
        : await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
      await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productProductions), async () => {
        const build = await db.productBuilds.get(input.build.id)
        const production = await db.productProductions.get(input.productionId)
        if (!build || !production || build.controlEpoch !== input.build.controlEpoch) return
        const status = resultUnknown
          ? 'recovery-required'
          : input.task.failurePolicy === 'fail-build' ? 'failed' : 'recovery-required'
        const updatedAt = Date.now()
        await db.productBuilds.update(input.build.id, {
          status,
          failureJson: canonicalProductProductionJsonV2({
            taskKey: input.task.taskKey,
            code,
            attempt,
            detail: safeExecutorError(error),
            failureProvenance: taskFailureProvenance({ snapshot, build: input.build, attempt }),
            ...(resultUnknown ? {
              resultStatus: 'unknown',
              reservationDisposition: 'retained',
              automaticRetryAllowed: false,
            } : {}),
          }),
          updatedAt,
        })
        if (status === 'failed') await db.productProductions.update(input.productionId, {
          status: 'failed', stateRevision: production.stateRevision + 1, updatedAt,
        })
      })
    }
    return
  }
  // A concurrent scheduler may have timed this same request out and closed the
  // Run while the local executor was still awaiting its provider. Accounting
  // above is still reconciled (or covered by the author's final disposition),
  // but a terminal/stale Run must never receive response events or candidates.
  const buildAfterExecution = await db.productBuilds.get(input.build.id)
  if (snapshot.projection.state !== 'running'
    || !buildAfterExecution
    || buildAfterExecution.controlEpoch !== input.build.controlEpoch
    || buildAfterExecution.status !== 'building') {
    if (snapshot.projection.state === 'running') {
      snapshot = await append(input.scope, snapshot, 'budget.settled', {
        stepId: input.task.taskKey,
        modelCalls: result.usage.modelCalls,
        toolCalls: result.usage.mediaCalls,
        tokens: result.usage.inputTokens + result.usage.outputTokens,
      })
      await append(input.scope, snapshot, 'run.cancelled', {
        reason: 'late-result-after-control-epoch-change',
      })
    }
    return
  }
  const candidateHash = await hashProductProductionTaskCandidateV1(result)
  if (input.task.executionMode === 'model' && !authorDraftJson && !executorOwnsWorldGateway) {
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
    || ['paused', 'cancelled', 'failed', 'archived', 'released'].includes(current.status)) {
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

async function compileTerminalBuild(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  root: AgentRunSnapshotV1
  plan: ProductProductionPlanV3
  brief: ProductProductionBriefV3
  onDurableBoundary?: (boundary: ProductProductionSchedulerBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<string> {
  const build = await db.productBuilds.get(input.buildId)
  const production = await db.productProductions.get(input.productionId)
  if (!build || !production || build.controlEpoch !== input.plan.controlEpoch) {
    throw new Error('[product-production-scheduler] terminal join Build 已过期')
  }
  const initialBuildAuthorityJson = canonicalProductProductionJsonV2({
    ...build, id: build.id ?? null,
  })
  const initialProductionAuthorityJson = canonicalProductProductionJsonV2({
    ...production, id: production.id ?? null,
  })
  const verifiedArtifacts = await verifyProductBuildTerminalArtifactSetV1({
    scope: input.scope,
    productionId: input.productionId,
    buildId: build.id!,
    expectedControlEpoch: build.controlEpoch,
    expectedPlanHash: build.planHash,
  })
  const artifacts = verifiedArtifacts.artifacts
  const artifactReadSetJson = verifiedArtifacts.artifactReadSetJson
  const terminalArtifactKeys = productProductionTerminalArtifactKeysV1(input.brief.intent.productType)
  const packageArtifact = artifacts.find(row => row.artifactKey === terminalArtifactKeys.runtimePackage)
  const qualityArtifact = artifacts.find(row => row.artifactKey === terminalArtifactKeys.qualityReport)
  if (!packageArtifact || !qualityArtifact) throw new Error('[product-production-scheduler] terminal package/quality Artifact 缺失')
  const runtimePackage = parseProductRuntimePackageV1(packageArtifact.payloadJson)
  const packageHash = await hashProductProductionValueV2(runtimePackage)
  if (packageArtifact.contentHash !== packageHash) throw new Error('[product-production-scheduler] package Artifact hash 不一致')
  let previousPackage: Parameters<typeof createProductBuildCompatibilityReportV1>[0]['previous'] = null
  if (build.parentBuildNumber != null) {
    const parentBuild = await db.productBuilds
      .where('[productionId+buildNumber]').equals([build.productionId, build.parentBuildNumber]).first()
    if (!parentBuild?.id || !parentBuild.packageHash) {
      throw new Error('[product-production-scheduler] compatibility parent Build 缺失')
    }
    let parentArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([parentBuild.id, terminalArtifactKeys.runtimePackage]).first()
    // A production created before the dedicated DAG may evolve from the old
    // generic text-open-world package. It remains a valid compatibility input
    // but can never become the output key of a new dedicated Build.
    if (!parentArtifact && input.brief.intent.productType === 'text-open-world') {
      parentArtifact = await db.productBuildArtifacts
        .where('[buildId+artifactKey]').equals([parentBuild.id, 'runtime.package']).first()
    }
    if (!parentArtifact || !['accepted', 'carried-forward'].includes(parentArtifact.status)) {
      throw new Error('[product-production-scheduler] compatibility parent package Artifact 缺失')
    }
    const parentRuntimePackage = parseProductRuntimePackageV1(parentArtifact.payloadJson)
    if (await hashProductProductionValueV2(parentRuntimePackage) !== parentBuild.packageHash) {
      throw new Error('[product-production-scheduler] compatibility parent package hash 不一致')
    }
    previousPackage = {
      buildNumber: parentBuild.buildNumber, packageHash: parentBuild.packageHash,
      runtimePackage: parentRuntimePackage,
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
  if (Object.keys(ledger.reservations).length > 0) {
    throw new Error('[product-production-scheduler] terminal join 仍存在未结算 provider reservation')
  }
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
  const preparedTerminalFields = {
    manifestJson: canonicalProductProductionJsonV2(manifest), manifestHash, packageHash,
    previewManifestJson: canonicalProductProductionJsonV2(preview), previewHash: preview.previewHash,
    qualityReportJson: canonicalProductProductionJsonV2(quality), qualityReportHash,
    compatibilityJson: canonicalProductProductionJsonV2(compatibility),
    rootTerminalReceiptHash,
  }
  const claimVerification = await verifyProductBuildTerminalArtifactSetV1({
    scope: input.scope,
    productionId: input.productionId,
    buildId: build.id!,
    expectedControlEpoch: build.controlEpoch,
    expectedPlanHash: build.planHash,
  })
  if (claimVerification.artifactReadSetJson !== artifactReadSetJson
    || claimVerification.verificationReadSetJson !== verifiedArtifacts.verificationReadSetJson) {
    throw new Error('[product-production-scheduler] terminal verifier readset 在 claim 前已变化')
  }
  await input.onDurableBoundary?.('terminal.proof.checked', input.root)
  // First freeze the exact active Artifact read-set. `validating` is a durable
  // terminal-join claim: every official Artifact mutation boundary rejects it.
  // Therefore a crash before the root receipt is appended is recoverable by
  // rerunning this join, while a same-key replacement racing the claim either
  // commits first and fails this exact CAS or observes `validating` and fails.
  const terminalClaim: { alreadyCommitted: boolean; claimedBuildRowJson: string | null } = {
    alreadyCommitted: false,
    claimedBuildRowJson: null,
  }
  await db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productProductions, db.productProductionBriefs,
    db.productBuildArtifacts, db.agentRuns, db.agentRunEvents,
    db.agentRunCheckpoints, db.mediaBlobObjects,
  ), async () => {
    await assertProductBuildTerminalReadSetUnchangedV1({
      readSet: claimVerification.casReadSet,
    })
    const current = await db.productBuilds.get(build.id!)
    const currentProduction = await db.productProductions.get(production.id!)
    if (!current || !currentProduction || current.productionId !== production.id
      || currentProduction.currentBuildNumber !== build.buildNumber
      || current.controlEpoch !== build.controlEpoch || current.planHash !== build.planHash
      || canonicalProductProductionJsonV2({ ...current, id: current.id ?? null })
        !== initialBuildAuthorityJson
      || canonicalProductProductionJsonV2({ ...currentProduction, id: currentProduction.id ?? null })
        !== initialProductionAuthorityJson) {
      throw new Error('[product-production-scheduler] terminal claim CAS 已过期')
    }
    const currentArtifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
      .filter(row => row.controlEpoch === build.controlEpoch
        && (row.status === 'accepted' || row.status === 'carried-forward'))
      .sort((a, b) => a.artifactKey.localeCompare(b.artifactKey) || a.version - b.version)
    if (canonicalProductProductionJsonV2(
      currentArtifacts.map(row => ({ ...row, id: row.id ?? null })),
    ) !== artifactReadSetJson) {
      throw new Error('[product-production-scheduler] terminal claim Artifact 集合或 envelope 已变化')
    }
    if (current.status === 'building') {
      const claimTime = Date.now()
      await db.productBuilds.update(build.id!, {
        status: 'validating', stateRevision: current.stateRevision + 1,
        ...preparedTerminalFields, updatedAt: claimTime,
      })
      const claimed = await db.productBuilds.get(build.id!)
      if (!claimed) throw new Error('[product-production-scheduler] terminal claim 写入后不可见')
      terminalClaim.claimedBuildRowJson = canonicalProductProductionJsonV2({
        ...claimed, id: claimed.id ?? null,
      })
      return
    }
    if (current.status === 'validating') {
      const existingPrepared = {
        manifestJson: current.manifestJson, manifestHash: current.manifestHash,
        packageHash: current.packageHash, previewManifestJson: current.previewManifestJson,
        previewHash: current.previewHash, qualityReportJson: current.qualityReportJson,
        qualityReportHash: current.qualityReportHash, compatibilityJson: current.compatibilityJson,
        rootTerminalReceiptHash: current.rootTerminalReceiptHash,
      }
      if (canonicalProductProductionJsonV2(existingPrepared)
        !== canonicalProductProductionJsonV2(preparedTerminalFields)) {
        throw new Error('[product-production-scheduler] terminal claim 与已冻结 join 不一致')
      }
      terminalClaim.claimedBuildRowJson = canonicalProductProductionJsonV2({
        ...current, id: current.id ?? null,
      })
      return
    }
    if (['preview-ready', 'release-ready'].includes(current.status)
      && current.rootTerminalReceiptHash === rootTerminalReceiptHash) {
      terminalClaim.alreadyCommitted = true
      return
    }
    throw new Error(`[product-production-scheduler] Build 状态 ${current.status} 不能取得 terminal claim`)
  })
  if (terminalClaim.alreadyCommitted) {
    if (input.root.projection.state !== 'completed'
      || input.root.projection.terminalReceiptHash !== rootTerminalReceiptHash) {
      throw new Error('[product-production-scheduler] 已封存 Build 缺少匹配 root terminal receipt')
    }
    return rootTerminalReceiptHash
  }
  if (terminalClaim.claimedBuildRowJson == null) {
    throw new Error('[product-production-scheduler] terminal claim 未返回冻结 Build')
  }
  let root = input.root
  if (root.projection.state === 'running') {
    const rootStep = root.projection.steps[ROOT_STEP_ID]
    if (rootStep?.status === 'running') {
      root = await append(input.scope, root, 'step.succeeded', {
        stepId: ROOT_STEP_ID, attempt: 1,
        outputHash: await hashProductProductionValueV2({ manifestHash, taskReceipts }),
      })
      await input.onDurableBoundary?.('root.step.succeeded', root)
    } else if (rootStep?.status !== 'succeeded') {
      throw new Error('[product-production-scheduler] validating Build 的 root step 不可恢复')
    }
    if (root.projection.state === 'running') {
      root = await append(input.scope, root, 'verification.started', {
        verifierSetVersion: 'product-production-root-v1',
      })
      await input.onDurableBoundary?.('root.verification.started', root)
    }
  }
  if (root.projection.state === 'verifying') {
    root = await append(input.scope, root, 'verification.accepted', { receiptHash: rootTerminalReceiptHash })
    await input.onDurableBoundary?.('root.verification.accepted', root)
  } else if (root.projection.state !== 'completed') {
    throw new Error(`[product-production-scheduler] validating Build 的 root 状态 ${root.projection.state} 不可恢复`)
  }
  if (root.projection.terminalReceiptHash !== rootTerminalReceiptHash) {
    throw new Error('[product-production-scheduler] root Run terminal receipt 与 Build join 不一致')
  }
  // The root Run and its event stream deliberately change after the first
  // terminal claim. Re-read the complete proof closure now that the root is
  // terminal, then use this fresh raw-row set for the final transaction CAS.
  // Reusing the pre-root read set with a mutable-root exemption would leave a
  // window where contract/projection/event tampering could preserve only the
  // status/receipt columns and still publish the Build.
  const finalVerification = await verifyProductBuildTerminalArtifactSetV1({
    scope: input.scope,
    productionId: input.productionId,
    buildId: build.id!,
    expectedControlEpoch: build.controlEpoch,
    expectedPlanHash: build.planHash,
  })
  if (finalVerification.artifactReadSetJson !== artifactReadSetJson) {
    throw new Error('[product-production-scheduler] terminal Artifact readset 在 root 完成后已变化')
  }
  await db.transaction('rw', scopeTransactionTables(
    db.productBuilds, db.productProductions, db.productProductionBriefs,
    db.productBuildArtifacts, db.agentRuns, db.agentRunEvents,
    db.agentRunCheckpoints, db.mediaBlobObjects,
  ), async () => {
    await assertProductBuildTerminalReadSetUnchangedV1({
      readSet: finalVerification.casReadSet,
    })
    const current = await db.productBuilds.get(build.id!)
    const currentProduction = await db.productProductions.get(production.id!)
    const currentRoot = await db.agentRuns.get(root.run.id)
    if (!current || !currentProduction || current.controlEpoch !== build.controlEpoch
      || current.planHash !== build.planHash || current.status !== 'validating'
      || current.rootTerminalReceiptHash !== rootTerminalReceiptHash
      || !currentRoot || currentRoot.status !== 'completed'
      || currentRoot.terminalReceiptHash !== rootTerminalReceiptHash
      || canonicalProductProductionJsonV2({ ...current, id: current.id ?? null })
        !== terminalClaim.claimedBuildRowJson
      || canonicalProductProductionJsonV2({ ...currentProduction, id: currentProduction.id ?? null })
        !== initialProductionAuthorityJson) {
      throw new Error('[product-production-scheduler] terminal commit CAS 已过期')
    }
    const currentArtifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
      .filter(row => row.controlEpoch === build.controlEpoch && (row.status === 'accepted' || row.status === 'carried-forward'))
      .sort((a, b) => a.artifactKey.localeCompare(b.artifactKey) || a.version - b.version)
    if (canonicalProductProductionJsonV2(
      currentArtifacts.map(row => ({ ...row, id: row.id ?? null })),
    ) !== artifactReadSetJson) {
      throw new Error('[product-production-scheduler] terminal commit Artifact 集合或 envelope 已变化')
    }
    const packageQualityReady = quality.playable && quality.releaseReady
      && quality.hardGateResults.every(gate => gate.passed)
    // A commercial Build is playable after package QA, but it is not release
    // ready until the latest real-browser performance receipt passes. The
    // receipt service performs that later, evidence-bound promotion.
    const releaseReady = packageQualityReady && input.brief.qualityProfile !== 'commercial-candidate'
    await db.productBuilds.update(build.id!, {
      status: releaseReady ? 'release-ready' : 'preview-ready',
      stateRevision: current.stateRevision + 1,
      ...preparedTerminalFields, completedAt: Date.now(), updatedAt: Date.now(),
    })
    await db.productProductions.update(production.id!, {
      status: 'preview-ready', stateRevision: currentProduction.stateRevision + 1, updatedAt: Date.now(),
    })
  })
  return rootTerminalReceiptHash
}

function durableBoundaryFromEvent(event: AnyAgentRunEventV1): ProductProductionDurableBoundaryProjectionV1 {
  const payload = event.payload as { stepId?: unknown; attempt?: unknown }
  return {
    eventType: event.type,
    sequence: event.sequence,
    createdAt: event.createdAt,
    stepId: typeof payload.stepId === 'string' ? payload.stepId : null,
    attempt: Number.isInteger(payload.attempt) ? Number(payload.attempt) : null,
  }
}

function projectTaskSteps(snapshot: AgentRunSnapshotV1): ProductProductionStepProjectionV1[] {
  interface MutableAttemptProjection extends ProductProductionAttemptProjectionV1 {
    order: number
  }
  const attemptsByStep = new Map<string, Map<number, MutableAttemptProjection>>()
  const stepOrder = new Map<string, number>()
  for (const event of snapshot.events) {
    const boundary = durableBoundaryFromEvent(event)
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

async function projectTaskCheckpoint(
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

function taskStaleReason(
  task: ProductProductionPlanTaskV3,
  child: AgentRunSnapshotV1,
  build: { controlEpoch: number; planHash: string },
): string | null {
  const boundary = child.contract.scope.productProduction
  if (!boundary) return 'missing-product-production-boundary'
  if (boundary.controlEpoch !== build.controlEpoch) {
    return `control-epoch-mismatch:${boundary.controlEpoch}->${build.controlEpoch}`
  }
  if (boundary.planHash !== build.planHash) return 'plan-hash-mismatch'
  const stale = [...child.events].reverse().find(event => (
    event.type === 'candidate.staled' && event.payload.stepId === task.taskKey
  ))
  return stale?.type === 'candidate.staled' ? stale.payload.reason : null
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
  const tasks: ProductProductionTaskProjectionV1[] = []
  for (const task of plan?.tasks ?? []) {
    const child = children.get(task.taskKey)
    const dependenciesReady = task.requiredReceipts.every(edge => {
      const receipt = completed.get(edge.taskKey)
      return !!receipt && (edge.receiptHash == null || edge.receiptHash === receipt)
    })
    let status: ProductProductionTaskProjectionV1['status'] = dependenciesReady ? 'ready' : 'waiting'
    let blocker: string | null = null
    let staleReason: string | null = null
    if (child) {
      const step = child.projection.steps[task.taskKey]
      staleReason = taskStaleReason(task, child, build)
      if (staleReason) {
        status = 'stale'
        blocker = staleReason
      } else if (child.projection.state === 'completed') status = 'completed'
      else if (['failed', 'cancelled', 'recovery_required', 'paused'].includes(child.projection.state)) {
        status = 'blocked'; blocker = `run-${child.projection.state}`
      } else if (step?.status === 'failed' && step.failureCode !== 'provider-safety-refusal'
        && step.attempt < task.maxAttempts) status = 'retry-ready'
      else status = 'running'
    }
    const latestEvent = child?.events[child.events.length - 1]
    tasks.push({
      taskKey: task.taskKey, lane: task.lane, status,
      runId: child?.run.id ?? null, attempt: child?.projection.steps[task.taskKey]?.attempt ?? 0,
      terminalReceiptHash: child?.projection.terminalReceiptHash ?? null, blocker,
      dependsOn: [...task.dependsOn],
      requiredReceipts: task.requiredReceipts.map(edge => ({ ...edge })),
      concurrencyGroup: task.concurrencyGroup,
      maxAttempts: task.maxAttempts,
      timeoutMs: task.timeoutMs,
      subjectLocks: [...task.subjectLockKeys],
      latestDurableBoundary: latestEvent ? durableBoundaryFromEvent(latestEvent) : null,
      checkpoint: child ? await projectTaskCheckpoint(scope, child) : null,
      steps: child ? projectTaskSteps(child) : [],
      staleReason,
    })
  }
  const usage = sumLedgerUsage(Object.values(ledger.charges).map(charge => charge.usage))
  return {
    productionId: input.productionId, buildId: build.id!, buildNumber: build.buildNumber,
    buildStatus: build.status, controlEpoch: build.controlEpoch, planHash: build.planHash,
    rootRunId: root?.run.id ?? null, terminal: root?.projection.state === 'completed',
    budget: { usage, limits: structuredClone(current.brief.productionBudget) }, tasks,
  }
}

function costBearing(task: ProductProductionPlanTaskV3): boolean {
  return task.budgetReservation.modelCalls > 0 || task.budgetReservation.mediaCalls > 0
    || (task.budgetReservation.maximumCostUsd ?? 0) > 0
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
  if (['paused', 'cancelled', 'failed', 'archived', 'released'].includes(current.build.status)) {
    return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  }
  const state = await ensureRootRun({ scope, productionId: input.productionId, suppliedPlan: input.suppliedPlan })
  // Fail closed before claiming or dispatching any zero-cost Creator media
  // task. This also prevents test/extension executor overrides from turning a
  // local-only authorization into an external provider call.
  for (const task of state.plan.tasks) {
    isLocalProceduralMediaTaskV1(task, input.capabilityBindings ?? [])
  }
  let children = await childSnapshots(scope, state.build.id!, state.root.run.id)
  let interruptedTaskBlocked = false
  let interruptedTaskRecovered = false
  if (state.build.status !== 'validating') {
    for (const task of state.plan.tasks) {
      const child = children.get(task.taskKey)
      if (!child || child.contract.scope.productProduction?.controlEpoch !== state.build.controlEpoch
        || child.contract.scope.productProduction.planHash !== state.build.planHash) continue
      if (child && (child.projection.state === 'completed'
        || child.projection.steps[task.taskKey]?.candidateHash)) {
        const recovered = await recoverCompletedOrCheckpointed({
          scope, buildId: state.build.id!, controlEpoch: state.build.controlEpoch, task, snapshot: child,
        })
        if (recovered) continue
      }
      const interruption = await recoverTimedOutRunningTask({
        scope,
        build: {
          id: state.build.id!,
          buildNumber: state.build.buildNumber,
          controlEpoch: state.build.controlEpoch,
          planHash: state.build.planHash,
        },
        task,
        snapshot: child,
      })
      if (interruption === 'blocked') interruptedTaskBlocked = true
      else if (interruption === 'retry-ready') interruptedTaskRecovered = true
    }
    if (interruptedTaskBlocked) {
      return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
    }
    if (interruptedTaskRecovered) {
      children = await childSnapshots(scope, state.build.id!, state.root.run.id)
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
  }
  const completed = new Map([...children].flatMap(([key, child]) => (
    child.projection.state === 'completed' && child.projection.terminalReceiptHash
      ? [[key, child.projection.terminalReceiptHash] as const] : []
  )))
  if (completed.size === state.plan.tasks.length) {
    await compileTerminalBuild({
      scope, productionId: input.productionId, buildId: state.build.id!, root: state.root,
      plan: state.plan, brief: state.brief,
      onDurableBoundary: input.onDurableBoundary,
    })
    await input.onDurableBoundary?.('root.completed', await readAgentRunV1(scope, state.root.run.id))
    return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  }
  if (state.build.status === 'validating') {
    throw new Error('[product-production-scheduler] validating Build 的 child receipt 集合不完整')
  }
  const activeTasks = state.plan.tasks.filter(task => {
    const child = children.get(task.taskKey)
    return !!child && child.projection.state === 'running'
      && child.projection.steps[task.taskKey]?.status === 'running'
  })
  let costSlots = Math.max(0, state.plan.concurrency.maximumCostBearingTasks - activeTasks.filter(costBearing).length)
  let textSlots = Math.max(0, state.plan.concurrency.maximumTextProviderTasks
    - activeTasks.filter(task => task.concurrencyGroup === 'text-provider').length)
  let mediaSlots = Math.max(0, state.plan.concurrency.maximumMediaProviderTasks
    - activeTasks.filter(task => task.concurrencyGroup === 'media-provider').length)
  const locked = new Set(activeTasks.flatMap(task => task.subjectLockKeys))
  const ready = state.plan.tasks
    .filter(task => {
      const child = children.get(task.taskKey)
      if (child && ['failed', 'cancelled', 'recovery_required', 'paused'].includes(child.projection.state)) return false
      const step = child?.projection.steps[task.taskKey]
      const retryReady = step?.status === 'failed' && step.attempt < task.maxAttempts
      // A process may stop after the durable child claim or after scheduling
      // the step but before step.started. Neither boundary can have dispatched
      // a provider request, so the existing child is safe to resume in-place.
      const preDispatchReady = child?.projection.state === 'planned'
        || (child?.projection.state === 'running' && step?.status === 'scheduled')
      if (child && !retryReady && !preDispatchReady) return false
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
  for (const task of selected) {
    const existing = children.get(task.taskKey)
    if (existing) {
      claimed.push({ task, snapshot: existing })
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
      productType: state.plan.productType,
      brief: state.brief,
      build: {
        id: state.build.id!, buildNumber: state.build.buildNumber,
        controlEpoch: state.build.controlEpoch, planHash: state.build.planHash, failureJson: state.build.failureJson,
      },
      task, snapshot, executor: input.executor,
      capabilityBindings: input.capabilityBindings ?? [], signal: controller.signal,
      onDurableBoundary: input.onDurableBoundary,
    })))
  } finally {
    input.signal?.removeEventListener('abort', abort)
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
