import { db } from '../db/schema'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
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
  ContextManifestV2,
  ProductBuildArtifactKindV1,
  ProductBuildArtifactRecordV1,
  ProductProductionBriefV3,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductTaskBudgetReservationV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../workspace/scope'
import {
  acceptProductBuildArtifact,
  carryForwardProductBuildArtifactsAcrossBuildsV1,
  carryForwardProductBuildArtifactsToEpochV1,
} from './artifact-store'
import { parseProductBuildQualityReportV1 } from './adoption'
import { createProductBuildCompatibilityReportV1 } from './compatibility'
import { parseProductProductionBriefV3 } from './contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from './plan'
import { createProductBuildPreviewManifestV1 } from './preview-manifest'
import { createProductBuildRootTerminalReceiptV1 } from './receipts'
import { parseProductRuntimePackageV1 } from './runtime-package'
import {
  executeProductProductionWorldGatewayV1,
  productProductionTaskUsesWorldGatewayV1,
  parseConfirmedProductBriefV1,
  parseProductProductionSourcePlanV1,
} from './source-contracts'
import { assertFormalProductProductionStartV1 } from '../product/source-contracts'

const ROOT_TASK_KEY = '$root'
const ROOT_STEP_ID = '$join'
const CLAIM_TTL_MS = 15_000
const DETERMINISTIC_WORLD_TOOL = 'product-production-deterministic-world-integrator'

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

export interface ProductProductionTaskExecutionInputV1 {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  buildNumber: number
  controlEpoch: number
  planHash: string
  task: ProductProductionPlanTaskV3
  attempt: number
  idempotencyKey: string
  contextText: string
  inputArtifacts: ProductBuildArtifactRecordV1[]
  capabilityBindings: ProductProductionCapabilityBindingV1[]
  signal: AbortSignal
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

interface SchedulerLedgerV1 {
  schema: 'storyforge.product-production-budget-ledger'
  version: 1
  rootRunId: number | null
  rootClaim: { owner: string; expiresAt: number } | null
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

function emptyLedger(): SchedulerLedgerV1 {
  return {
    schema: 'storyforge.product-production-budget-ledger',
    version: 1,
    rootRunId: null,
    rootClaim: null,
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

function parseLedger(value: string): SchedulerLedgerV1 {
  if (value === '{}' || !value.trim()) return emptyLedger()
  let candidate: unknown
  try { candidate = JSON.parse(value) } catch { throw new Error('[product-production-scheduler] budget ledger JSON 损坏') }
  const row = ledgerRecord(candidate, 'budget ledger')
  exactLedgerKeys(row, ['schema', 'version', 'rootRunId', 'rootClaim', 'tasks'], 'budget ledger')
  if (row.schema !== 'storyforge.product-production-budget-ledger' || row.version !== 1
    || !row.tasks || typeof row.tasks !== 'object' || Array.isArray(row.tasks)) {
    throw new Error('[product-production-scheduler] budget ledger 基础字段无效')
  }
  const rootRunId = row.rootRunId === null ? null : ledgerInteger(row.rootRunId, 'rootRunId', 1)
  let rootClaim: SchedulerLedgerV1['rootClaim'] = null
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
  return {
    schema: 'storyforge.product-production-budget-ledger', version: 1,
    rootRunId, rootClaim, tasks,
  }
}

/** Public deterministic contract guard for diagnostics, import and regression tests. */
export function assertProductProductionBudgetLedgerV1(value: string): void {
  parseLedger(value)
}

function zeroUsage(): ProductProductionTaskUsageV1 {
  return { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0 }
}

function safeExecutorError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/\b(?:sk|ak)-[A-Za-z0-9_-]{8,}\b/g, '[redacted-credential]')
    .replace(/(?:authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi, 'credential=[redacted]')
    .slice(0, 1_000)
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

function taskContextSourceKeys(task: ProductProductionPlanTaskV3): string[] {
  if (task.skillId) {
    const skill = getAgentSkillV1(task.skillId)
    return [
      ...skill.contextSourceKeys,
      ...(task.inputArtifactKeys.length > 0 ? skill.optionalContextSourceKeys : []),
    ]
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

function rootContract(scope: WorkspaceScope, build: { id: number; buildNumber: number; controlEpoch: number; planHash: string }) {
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

function taskContract(input: {
  scope: WorkspaceScope
  rootRunId: number
  build: { id: number; buildNumber: number; controlEpoch: number; planHash: string }
  task: ProductProductionPlanTaskV3
  capabilityBindingHash?: string
}) {
  const sourceKeys = taskContractContextSourceKeys(input.task)
  const skill = input.task.skillId ? getAgentSkillV1(input.task.skillId) : null
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
    ...(input.capabilityBindingHash ? { runtimeBindingHash: input.capabilityBindingHash } : {}),
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
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (await hashProductProductionValueV2(brief) !== briefRow.briefHash) {
    throw new Error('[product-production-scheduler] Brief hash 校验失败')
  }
  return { production, build, briefRow, brief }
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
    return { ...state, plan: currentPlan }
  }
  let plan = input.suppliedPlan
    ? parseProductProductionPlanV3(input.suppliedPlan, state.brief, state.briefRow.briefHash)
    : await createProductProductionPlanV3({
        brief: state.brief,
        briefHash: state.briefRow.briefHash,
        buildNumber: state.build.buildNumber,
        controlEpoch: state.build.controlEpoch,
      })
  if (!input.suppliedPlan) {
    const reuse = await applyCrossBuildEvolutionReuse({
      scope: input.scope, build: state.build, brief: state.brief, plan,
    })
    plan = reuse.plan
    if (reuse.sourceBuildId != null && reuse.reusableArtifactKeys.length > 0) {
      await carryForwardProductBuildArtifactsAcrossBuildsV1({
        scope: input.scope, sourceBuildId: reuse.sourceBuildId, targetBuildId: state.build.id!,
        targetControlEpoch: state.build.controlEpoch, artifactKeys: reuse.reusableArtifactKeys,
      })
    }
  }
  if (plan.controlEpoch !== state.build.controlEpoch || plan.buildNumber !== state.build.buildNumber) {
    throw new Error('[product-production-scheduler] Plan 与 Build epoch/number 不一致')
  }
  const planHash = await hashProductProductionValueV2(plan)
  if (currentPlan && currentPlan.controlEpoch < plan.controlEpoch
    && currentPlan.briefHash === plan.briefHash && currentPlan.buildNumber === plan.buildNumber) {
    const previousTasks = new Map(currentPlan.tasks.map(task => [task.taskKey, task]))
    const reusableArtifactKeys = plan.tasks.flatMap(task => {
      const previous = previousTasks.get(task.taskKey)
      return task.executionMode !== 'deterministic' && previous
        && canonicalProductProductionJsonV2(previous.outputArtifactKeys) === canonicalProductProductionJsonV2(task.outputArtifactKeys)
        ? task.outputArtifactKeys : []
    })
    if (reusableArtifactKeys.length > 0) await carryForwardProductBuildArtifactsToEpochV1({
      scope: input.scope, buildId: state.build.id!, fromControlEpoch: currentPlan.controlEpoch,
      toControlEpoch: plan.controlEpoch, artifactKeys: reusableArtifactKeys,
    })
  }
  await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productBuildArtifacts), async () => {
    const build = await db.productBuilds.get(state.build.id!)
    if (!build || build.controlEpoch !== state.build.controlEpoch || build.stateRevision !== state.build.stateRevision) {
      throw new Error('[product-production-scheduler] Plan CAS 已过期')
    }
    await db.productBuildArtifacts.where('buildId').equals(build.id!).filter(row => (
      row.controlEpoch !== build.controlEpoch && (row.status === 'accepted' || row.status === 'carried-forward')
    )).modify({ status: 'invalid', updatedAt: Date.now() })
    await db.productBuilds.update(build.id!, {
      status: 'building', planRevision: build.planRevision + 1,
      planJson: canonicalProductProductionJsonV2(plan), planHash,
      budgetLedgerJson: canonicalProductProductionJsonV2(emptyLedger()),
      stateRevision: build.stateRevision + 1, startedAt: build.startedAt ?? Date.now(), updatedAt: Date.now(),
    })
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
    contract: rootContract(input.scope, {
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
      .filter(row => row.controlEpoch === input.build.controlEpoch && row.status === 'carried-forward')
    for (const task of input.plan.tasks) {
      if (task.executionMode === 'deterministic') continue
      const outputs = artifacts.filter(row => task.outputArtifactKeys.includes(row.artifactKey))
      if (outputs.length !== task.outputArtifactKeys.length
        || task.dependsOn.some(dependency => !completed.has(dependency))) continue
      const dependencies = task.dependsOn.map(taskKey => ({ taskKey, receiptHash: completed.get(taskKey)! }))
      const candidateHash = await hashProductProductionValueV2(outputs.map(row => ({
        artifactKey: row.artifactKey, contentHash: row.contentHash,
        carriedFrom: row.carriedFrom, parentArtifactHash: row.parentArtifactHash,
      })).sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)))
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
          contract: taskContract({
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

async function settleLedger(input: {
  buildId: number
  controlEpoch: number
  taskKey: string
  entry: LedgerTaskV1
}): Promise<void> {
  await db.transaction('rw', db.productBuilds, async () => {
    const build = await db.productBuilds.get(input.buildId)
    if (!build || build.controlEpoch !== input.controlEpoch) throw new Error('[product-production-scheduler] ledger epoch 已过期')
    const ledger = parseLedger(build.budgetLedgerJson)
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

async function runClaimedTask(input: {
  scope: WorkspaceScope
  productionId: number
  build: { id: number; buildNumber: number; controlEpoch: number; planHash: string }
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
  const normalSourceKeys = taskContextSourceKeys(input.task)
  const contractSourceKeys = taskContractContextSourceKeys(input.task)
  const totalInputBudget = Math.max(1, input.task.budgetReservation.inputTokens)
  const worldGatewayRequired = productProductionTaskUsesWorldGatewayV1(input.task)
  const normalInputBudget = worldGatewayRequired
    ? Math.max(1, Math.floor(totalInputBudget * 0.4))
    : totalInputBudget
  const normalAssembled = await assembleContext({
    projectId: input.scope.projectId, scope: input.scope, sourceKeys: normalSourceKeys,
    productProductionId: input.productionId, productBuildId: input.build.id,
    productArtifactKeys: input.task.inputArtifactKeys,
    inputBudgetMaxTokens: normalInputBudget,
  })
  let assembled = normalAssembled
  let gatewayExecution: ContextGatewayExecutionV1 | null = null
  let gatewayBaseManifest: ContextManifestV2 | null = null
  let gatewayPreflight: ContextGatewayPreflightEvidenceV1 | null = null
  let sourcePlanHash: string | null = null
  let confirmedBriefHash: string | null = null
  if (worldGatewayRequired) {
    const production = await db.productProductions.get(input.productionId)
    if (!production?.id || production.currentBriefRevision == null) {
      throw new Error('[product-production-scheduler] 模型任务缺少当前 Production/Brief')
    }
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([production.id, production.currentBriefRevision]).first()
    if (!briefRow || briefRow.status !== 'authorized') {
      throw new Error('[product-production-scheduler] 模型任务缺少已授权 Brief')
    }
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
    const worldBudget = Math.max(1, totalInputBudget - normalInputBudget)
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
  })
  snapshot = await append(input.scope, snapshot, 'budget.reserved', {
    stepId: input.task.taskKey,
    modelCalls: input.task.budgetReservation.modelCalls,
    toolCalls: input.task.budgetReservation.mediaCalls,
    tokens: input.task.budgetReservation.inputTokens + input.task.budgetReservation.outputTokens,
  })
  const bindingHash = snapshot.contract.runtimeBindingHash
    ?? await hashProductProductionValueV2(snapshot.contract.executionBindings ?? { deterministic: input.task.kind })
  if (input.task.executionMode === 'model') {
    snapshot = await append(input.scope, snapshot, 'model.requested', { stepId: input.task.taskKey, attempt, bindingHash })
  } else if (input.task.executionMode === 'media-provider') {
    snapshot = await append(input.scope, snapshot, 'tool.called', {
      stepId: input.task.taskKey, attempt, toolName: 'game-media-provider', callHash: inputHash,
    })
  } else if (worldGatewayRequired) {
    snapshot = await append(input.scope, snapshot, 'tool.called', {
      stepId: input.task.taskKey, attempt, toolName: DETERMINISTIC_WORLD_TOOL, callHash: inputHash,
    })
  }
  await input.onDurableBoundary?.('provider.requested', snapshot)
  let result: ProductProductionTaskExecutionResultV1
  try {
    result = await input.executor({
      scope: input.scope, productionId: input.productionId, buildId: input.build.id,
      buildNumber: input.build.buildNumber, controlEpoch: input.build.controlEpoch,
      planHash: input.build.planHash, task: input.task, attempt,
      idempotencyKey: inputHash, contextText: assembled.text,
      inputArtifacts: artifacts, capabilityBindings: bindings, signal: input.signal,
    })
    validateExecutionResult(input.task, result)
  } catch (error) {
    const code = error instanceof Error && error.name === 'AbortError' ? 'task-aborted'
      : error instanceof Error && error.message.includes('provider-safety-refusal')
        ? 'provider-safety-refusal' : 'task-executor-failed'
    const retryable = code !== 'task-aborted' && code !== 'provider-safety-refusal'
      && attempt < input.task.maxAttempts
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: input.task.taskKey, attempt, code,
      retryable,
      category: code === 'task-aborted' ? 'cancelled'
        : code === 'provider-safety-refusal' ? 'deterministic' : 'unknown',
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
        candidateHash: null, terminalReceiptHash: null, passedGateIds: [], usage: null, errorCode: code,
      },
    })
    if (code === 'task-aborted' || code === 'provider-safety-refusal' || attempt >= input.task.maxAttempts) {
      snapshot = code === 'task-aborted'
        ? await append(input.scope, snapshot, 'run.cancelled', { reason: 'task-executor-aborted' })
        : await append(input.scope, snapshot, 'run.failed', { code, retryable: false })
      await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productProductions), async () => {
        const build = await db.productBuilds.get(input.build.id)
        const production = await db.productProductions.get(input.productionId)
        if (!build || !production || build.controlEpoch !== input.build.controlEpoch) return
        const status = input.task.failurePolicy === 'fail-build' ? 'failed' : 'recovery-required'
        const updatedAt = Date.now()
        await db.productBuilds.update(input.build.id, {
          status,
          failureJson: canonicalProductProductionJsonV2({
            taskKey: input.task.taskKey, code, attempt, detail: safeExecutorError(error),
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
  const candidateHash = await hashProductProductionValueV2(result)
  if (input.task.executionMode === 'model') {
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: input.task.taskKey, attempt, outputHash: candidateHash,
    })
  } else if (input.task.executionMode === 'media-provider') {
    snapshot = await append(input.scope, snapshot, 'tool.returned', {
      stepId: input.task.taskKey, attempt, toolName: 'game-media-provider', resultHash: candidateHash,
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
      executionBoundary: input.task.executionMode === 'model'
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
  const packageArtifact = artifacts.find(row => row.artifactKey === 'runtime.package')
  const qualityArtifact = artifacts.find(row => row.artifactKey === 'quality.report')
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
    const parentArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([parentBuild.id, 'runtime.package']).first()
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
  const manifest = {
    schema: 'storyforge.product-build-manifest' as const, version: 1 as const,
    productionKey: production.productionKey, buildNumber: build.buildNumber,
    briefRevision: build.briefRevision, briefHash: build.briefHash, planHash: build.planHash,
    controlEpoch: build.controlEpoch, runtimePackageHash: packageHash,
    artifactReceipts, completedGateIds, fallbackSummary: [],
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
    buildManifestHash: manifestHash, runtimePackage, mediaBindings, fallbackSummary: [],
  })
  const rootTerminalReceiptHash = await createProductBuildRootTerminalReceiptV1({
    planHash: build.planHash, manifestHash, packageHash, qualityReportHash,
    controlEpoch: build.controlEpoch, budgetLedgerJson: build.budgetLedgerJson, artifacts,
  })
  let root = input.root
  if (root.projection.state !== 'completed') {
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
  const tasks = (plan?.tasks ?? []).map(task => {
    const child = children.get(task.taskKey)
    const dependenciesReady = task.requiredReceipts.every(edge => {
      const receipt = completed.get(edge.taskKey)
      return !!receipt && (edge.receiptHash == null || edge.receiptHash === receipt)
    })
    let status: ProductProductionTaskProjectionV1['status'] = dependenciesReady ? 'ready' : 'waiting'
    let blocker: string | null = null
    if (child) {
      const step = child.projection.steps[task.taskKey]
      if (child.contract.scope.productProduction?.controlEpoch !== build.controlEpoch) status = 'stale'
      else if (child.projection.state === 'completed') status = 'completed'
      else if (step?.status === 'failed' && step.failureCode !== 'provider-safety-refusal'
        && step.attempt < task.maxAttempts) status = 'retry-ready'
      else if (['failed', 'cancelled', 'recovery_required', 'paused'].includes(child.projection.state)) {
        status = 'blocked'; blocker = `run-${child.projection.state}`
      } else status = 'running'
    }
    return {
      taskKey: task.taskKey, lane: task.lane, status,
      runId: child?.run.id ?? null, attempt: child?.projection.steps[task.taskKey]?.attempt ?? 0,
      terminalReceiptHash: child?.projection.terminalReceiptHash ?? null, blocker,
    }
  })
  const settledUsage = Object.values(ledger.tasks).flatMap(entry => entry.usage ? [entry.usage] : [])
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
  const completed = new Map([...children].flatMap(([key, child]) => (
    child.projection.state === 'completed' && child.projection.terminalReceiptHash
      ? [[key, child.projection.terminalReceiptHash] as const] : []
  )))
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
      const retryReady = child?.projection.steps[task.taskKey]?.status === 'failed'
        && (child.projection.steps[task.taskKey]?.attempt ?? 0) < task.maxAttempts
      if (child && !retryReady) return false
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
        contract: taskContract({
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
      build: {
        id: state.build.id!, buildNumber: state.build.buildNumber,
        controlEpoch: state.build.controlEpoch, planHash: state.build.planHash,
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
