import Dexie from 'dexie'
import { db } from '../db/schema'
import type {
  ConfirmedProductBriefV1,
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductProductionCommandV1,
  ProductProductionRecordV1,
  ProductSourcePlanV1,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorSourceBindingV1,
  TextOpenWorldCreatorSourceLocatorV1,
  TextOpenWorldCreatorSourceSummaryV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from './hash'
import { parseProductProductionBriefV3, parseProductProductionCommandV1 } from './contracts'
import {
  createConfirmedProductBriefV1,
  createProductProductionSourcePlanV1,
  parseProductProductionSourcePlanV1,
} from './source-contracts'
import { assertFormalProductProductionStartV1 } from '../product/source-contracts'
import { createWorldReferenceV1 } from '../product/source'
import { inspectProductProductionBuildRecoveryPolicyV1 } from './recovery-policy'
import { validateProductProductionRecoveryDirectiveV1 } from './context'
import { readAgentRunV1 } from '../agent/run/event-store'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import {
  inspectTextOpenWorldCreatorSourceLocatorV1,
  TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_BRIEF_VERIFIER_V1,
  textOpenWorldCreatorLocatorColumnsV1,
  textOpenWorldCreatorProductionLocatorColumnsV1,
  verifyTextOpenWorldCreatorBriefV1,
} from '../open-world/creator-brief-persistence'
import {
  assertTextOpenWorldCreatorProductionSourceCurrentV1,
  createTextOpenWorldCreatorStartPreparationV1,
  textOpenWorldCreatorProductionSourceTransactionTablesV1,
  type TextOpenWorldCreatorStartPreparationV1,
} from '../open-world/creator-production-start'
import { verifyTextOpenWorldCreatorProductionPreflightConfirmationV1 } from '../open-world/creator-production-preflight'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  assertProductProductionBudgetLedgerV1,
  resolveProductProductionUnknownResultReservationLedgerV2,
} from './scheduler'
import {
  assertTextOpenWorldCreatorRepairPreparationCurrentV1,
  createTextOpenWorldCreatorRepairAuthorizationV1,
  prepareTextOpenWorldCreatorArtifactRepairV1,
  type TextOpenWorldCreatorRepairPreparationV1,
} from '../open-world/creator-artifact-repair'
import type { TextOpenWorldCreatorRepairAuthorizationV1 } from '../open-world/creator-artifact-repair-contract'
import { hashTextOpenWorldCreatorEditImpactPlanHandoffV1 } from '../open-world/creator-artifact-edit'
import {
  assertTextOpenWorldCreatorMediaPreparationCurrentV1,
  createTextOpenWorldCreatorMediaAuthorizationV1,
  prepareTextOpenWorldCreatorMediaV1,
  type TextOpenWorldCreatorMediaPreparationV1,
} from '../open-world/creator-media'
import type { TextOpenWorldCreatorMediaAuthorizationV1 } from '../open-world/creator-media-contract'

export type ProductProductionErrorCodeV1 =
  | 'production-not-found'
  | 'production-state-conflict'
  | 'command-id-payload-conflict'
  | 'command-in-progress'
  | 'invalid-state-transition'
  | 'brief-unresolved'
  | 'brief-not-authorized'
  | 'source-stale'
  | 'capability-unbound'
  | 'cost-authorization-required'
  | 'storage-budget-insufficient'
  | 'control-epoch-stale'
  | 'dependency-receipt-stale'
  | 'quality-hard-gate-failed'
  | 'rights-incomplete'
  | 'repair-impact-stale'
  | 'creator-media-stale'
  | 'preview-stale'
  | 'publication-intent-stale'
  | 'publication-transaction-failed'

export interface ProductProductionCommandReceiptV1 {
  ok: boolean
  commandId: string
  commandType: ProductProductionCommandV1['type']
  productionId: number
  stateRevision: number
  result: Record<string, unknown>
  errorCode: ProductProductionErrorCodeV1 | null
  replayed: boolean
}

class ExpectedCommandFailure extends Error {
  constructor(readonly code: ProductProductionErrorCodeV1, message: string) {
    super(message)
  }
}

function reject(code: ProductProductionErrorCodeV1, message: string): never {
  throw new ExpectedCommandFailure(code, message)
}

// authorDraftJson is contractually capped at 120k characters. Keep enough
// envelope room for blocker identity, repair note and canonical JSON keys.
const SAFE_COMMAND_JSON_MAX_CHARS = 140_000

function safeJson(value: unknown): string {
  const json = canonicalProductProductionJsonV2(value)
  if (json.length > SAFE_COMMAND_JSON_MAX_CHARS) {
    throw new Error('[product-production] command result 超出安全上限')
  }
  return json
}

interface PausedLedgerReservationV1 {
  taskKey: string
  runId: number
  attempt: number
  controlEpoch: number
  providerCallPossible: boolean
}

interface PausedReservationAccountingV1 {
  taskKey: string
  runId: number
  attempt: number
  controlEpoch: number
  requestedDisposition: 'confirmed-not-charged' | 'charge-reservation-upper-bound' | null
  effectiveDisposition:
    | 'provider-actual-charge'
    | 'author-confirmed-not-charged'
    | 'author-charged-reservation-upper-bound'
    | 'system-released-before-dispatch'
    | 'system-released-no-usage-reported'
  usage: {
    modelCalls: number
    inputTokens: number
    outputTokens: number
    mediaCalls: number
    costUsd: number | null
    durationMs: number
    storageBytes: number
  }
}

/** Read only after the scheduler's strict public ledger guard succeeds. */
function pausedLedgerReservations(value: string): PausedLedgerReservationV1[] {
  assertProductProductionBudgetLedgerV1(value)
  if (value === '{}' || !value.trim()) return []
  const ledger = JSON.parse(value) as {
    version: number
    reservations?: Record<string, {
      runId: number
      attempt: number
      controlEpoch: number
      taskKey: string
      budget: { modelCalls: number; mediaCalls: number }
    }>
  }
  if (ledger.version !== 2 || !ledger.reservations) return []
  return Object.values(ledger.reservations).map(reservation => ({
    taskKey: reservation.taskKey,
    runId: reservation.runId,
    attempt: reservation.attempt,
    controlEpoch: reservation.controlEpoch,
    providerCallPossible: reservation.budget.modelCalls > 0 || reservation.budget.mediaCalls > 0,
  })).sort((left, right) => (
    left.runId - right.runId || left.attempt - right.attempt || left.taskKey.localeCompare(right.taskKey)
  ))
}

function pauseReservationIdentity(value: Pick<PausedLedgerReservationV1, 'taskKey' | 'runId' | 'attempt' | 'controlEpoch'>): string {
  return `${value.taskKey}:${value.runId}:${value.attempt}:${value.controlEpoch}`
}

type PausedLedgerAttemptStateV1 =
  | { kind: 'absent' }
  | {
      kind: 'reservation'
      taskKey: string
      runId: number
      attempt: number
      controlEpoch: number
    }
  | {
      kind: 'charge'
      taskKey: string
      runId: number
      attempt: number
      controlEpoch: number | null
      usage: PausedReservationAccountingV1['usage']
      resolution:
        | null
        | 'author-confirmed-not-charged'
        | 'author-charged-reservation-upper-bound'
        | 'system-released-before-dispatch'
        | 'system-released-no-usage-reported'
    }

function pausedLedgerAttemptState(
  value: string,
  identity: Pick<PausedLedgerReservationV1, 'runId' | 'attempt'>,
): PausedLedgerAttemptStateV1 {
  assertProductProductionBudgetLedgerV1(value)
  if (value === '{}' || !value.trim()) return { kind: 'absent' }
  const ledger = JSON.parse(value) as {
    version: number
    charges?: Record<string, {
      taskKey: string
      runId: number
      attempt: number
      controlEpoch: number | null
      usage: PausedReservationAccountingV1['usage']
      resolution?:
        | null
        | 'author-confirmed-not-charged'
        | 'author-charged-reservation-upper-bound'
        | 'system-released-before-dispatch'
        | 'system-released-no-usage-reported'
    }>
    reservations?: Record<string, {
      taskKey: string
      runId: number
      attempt: number
      controlEpoch: number
    }>
  }
  if (ledger.version !== 2) return { kind: 'absent' }
  const key = `${identity.runId}:${identity.attempt}`
  const reservation = ledger.reservations?.[key]
  if (reservation) return { kind: 'reservation', ...reservation }
  const charge = ledger.charges?.[key]
  if (charge) return { kind: 'charge', ...charge, resolution: charge.resolution ?? null }
  return { kind: 'absent' }
}

function requirePausedLedgerAttemptState(
  value: string,
  identity: Pick<PausedLedgerReservationV1, 'runId' | 'attempt'>,
): PausedLedgerAttemptStateV1 {
  try {
    return pausedLedgerAttemptState(value, identity)
  } catch {
    reject('invalid-state-transition', '暂停恢复预算账本损坏')
  }
}

function readResult(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

async function productionInScope(scope: WorkspaceScope, productionId: number): Promise<ProductProductionRecordV1 & { id: number }> {
  const production = await db.productProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    reject('production-not-found', 'Production 不存在或不属于当前 Work')
  }
  return production as ProductProductionRecordV1 & { id: number }
}

async function currentBuild(production: ProductProductionRecordV1 & { id: number }): Promise<ProductBuildRecordV1 & { id: number }> {
  if (production.currentBuildNumber == null) reject('invalid-state-transition', 'Production 尚无当前 Build')
  const build = await db.productBuilds
    .where('[productionId+buildNumber]').equals([production.id, production.currentBuildNumber]).first()
  if (!build) reject('invalid-state-transition', 'Production 当前 Build 指针损坏')
  return build as ProductBuildRecordV1 & { id: number }
}

async function nextBuildNumber(productionId: number): Promise<number> {
  const rows = await db.productBuilds.where('productionId').equals(productionId).toArray()
  return Math.max(0, ...rows.map(row => row.buildNumber)) + 1
}

async function nextBriefRevision(productionId: number): Promise<number> {
  const rows = await db.productProductionBriefs.where('productionId').equals(productionId).toArray()
  return Math.max(0, ...rows.map(row => row.revision)) + 1
}

async function applyCommand(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1 & { id: number }
  command: ProductProductionCommandV1
  preparedBriefHash: string | null
  preparedSourcePlan: ProductSourcePlanV1 | null
  preparedConfirmedBrief: ConfirmedProductBriefV1 | null
  preparedCreatorSource: {
    locator: TextOpenWorldCreatorSourceLocatorV1
    binding: TextOpenWorldCreatorSourceBindingV1
    bindingHash: string
    summary: TextOpenWorldCreatorSourceSummaryV1
  } | null
  preparedCreatorBrief: TextOpenWorldCreatorBriefV1 | null
  preparedCreatorEvidence: {
    runId: number
    localContractHash: string
    bindingHash: string
    candidateHash: string
    terminalReceiptHash: string
  } | null
  preparedCreatorStart?: TextOpenWorldCreatorStartPreparationV1 | null
  preparedCreatorRepair?: TextOpenWorldCreatorRepairPreparationV1 | null
  preparedCreatorRepairAuthorization?: TextOpenWorldCreatorRepairAuthorizationV1 | null
  preparedCreatorMedia?: TextOpenWorldCreatorMediaPreparationV1 | null
  preparedCreatorMediaAuthorization?: TextOpenWorldCreatorMediaAuthorizationV1 | null
  emptyHash: string
  now: number
}): Promise<{ production: ProductProductionRecordV1 & { id: number }; result: Record<string, unknown> }> {
  const { scope, command, now } = input
  let production = input.production

  if (command.type !== 'create-intent' && command.type !== 'create-text-open-world-intent'
    && command.expectedStateRevision !== production.stateRevision) {
    reject('production-state-conflict', `Production revision 已从 ${command.expectedStateRevision} 变为 ${production.stateRevision}`)
  }

  if (command.type === 'create-intent') {
    if (command.productType !== production.productType) {
      reject('production-state-conflict', 'productionKey 已绑定其他产品，不能跨产品复用')
    }
    return { production, result: { status: production.status, productType: production.productType, created: production.createdAt === now } }
  }

  if (command.type === 'create-text-open-world-intent') {
    if (production.productType !== 'text-open-world' || command.productType !== production.productType) {
      reject('production-state-conflict', 'productionKey 已绑定其他产品，不能跨产品复用')
    }
    if (!input.preparedCreatorSource
      || input.preparedCreatorSource.bindingHash !== command.expectedSourceBindingHash) {
      reject('source-stale', '文字开放世界 intent 缺少当前来源的有效复验')
    }
    if (production.creatorSourceBindingHash !== input.preparedCreatorSource.bindingHash
      || production.creatorSourceKind !== input.preparedCreatorSource.binding.kind) {
      reject('source-stale', 'productionKey 已绑定另一来源，不能静默换源')
    }
    return {
      production,
      result: {
        status: production.status,
        productType: production.productType,
        sourceKind: input.preparedCreatorSource.binding.kind,
        sourceBindingHash: input.preparedCreatorSource.bindingHash,
        created: production.createdAt === now,
      },
    }
  }

  if (command.type === 'save-brief-revision') {
    const brief = command.brief
    if (brief.intent.productType !== production.productType) {
      reject('production-state-conflict', 'Brief 产品身份与 Production 根记录不一致')
    }
    const expectedParent = production.currentBriefRevision
    if (command.parentRevision !== expectedParent) reject('production-state-conflict', 'Brief parent revision 已过期')
    const revision = await nextBriefRevision(production.id)
    const briefHash = input.preparedBriefHash!
    const sourcePlan = input.preparedSourcePlan
    if (!sourcePlan || sourcePlan.productInstanceKey !== production.productionKey
      || sourcePlan.productType !== brief.intent.productType
      || sourcePlan.worldReference.localReleaseRecordId !== brief.source.worldReleaseId
      || sourcePlan.worldReference.releaseHash !== brief.source.worldContentHash) {
      reject('source-stale', '保存 Brief 缺少与当前 Production/WorldRelease 一致的 SourcePlan')
    }
    const row = stampNewRecord(scope, 'productProductionBriefs', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: production.id, revision, parentRevision: command.parentRevision, status: 'draft' as const,
      briefKind: 'product-production-v3' as const, sourceKind: 'world-release' as const,
      sourceWorldReleaseId: brief.source.worldReleaseId, sourceWorldContentHash: brief.source.worldContentHash,
      userIntentSummary: brief.intent.openingSituation, unresolvedJson: safeJson(brief.unresolvedDecisionKeys),
      estimateJson: safeJson({
        scale: brief.scale, media: brief.media, productionBudget: brief.productionBudget,
        qualityProfile: brief.qualityProfile, externalDataPolicy: brief.externalDataPolicy,
      }),
      briefJson: canonicalProductProductionJsonV2(brief), briefHash,
      sourcePlanJson: canonicalProductProductionJsonV2(sourcePlan), sourcePlanHash: sourcePlan.planHash,
      confirmedBriefJson: '{}', confirmedBriefHash: '',
      authorizedAt: null, createdAt: now,
    } satisfies ProductProductionBriefRecordV1, { owner: 'work' })
    await db.productProductionBriefs.add(row)
    const stateRevision = production.stateRevision + 1
    const status = brief.unresolvedDecisionKeys.length === 0 ? 'brief-ready' as const : 'consulting' as const
    await db.productProductions.update(production.id, { currentBriefRevision: revision, status, stateRevision, updatedAt: now })
    production = { ...production, currentBriefRevision: revision, status, stateRevision, updatedAt: now }
    return { production, result: { briefRevision: revision, briefHash, status } }
  }

  if (command.type === 'save-text-open-world-creator-brief') {
    const brief = input.preparedCreatorBrief
    const source = input.preparedCreatorSource
    if (production.productType !== 'text-open-world' || !brief || !source) {
      reject('production-state-conflict', '文字开放世界 Brief 缺少已验证的产品或来源合同')
    }
    if (brief.productInstanceKey !== production.productionKey
      || brief.sourceBindingHash !== source.bindingHash
      || production.creatorSourceBindingHash !== source.bindingHash
      || production.creatorSourceKind !== source.binding.kind
    ) {
      reject('source-stale', 'Creator Brief、Production 与来源绑定不一致')
    }
    const expectedParent = production.currentBriefRevision
    if (command.parentRevision !== expectedParent) reject('production-state-conflict', 'Brief parent revision 已过期')
    const revision = await nextBriefRevision(production.id)
    if (brief.revision !== revision) reject('production-state-conflict', 'Creator Brief revision 与不可变历史不一致')
    const evidence = input.preparedCreatorEvidence
    const evidenceRun = await db.agentRuns.get(command.candidateRunId)
    if (!evidence || evidence.runId !== command.candidateRunId
      || evidence.bindingHash !== brief.candidateEvidence.runBindingHash
      || evidence.candidateHash !== brief.candidateEvidence.candidateHash
      || !evidenceRun || evidenceRun.status !== 'completed'
      || evidenceRun.contractHash !== evidence.localContractHash
      || evidenceRun.terminalReceiptHash !== evidence.terminalReceiptHash
      || !await assertRecordInScope(scope, 'agentRuns', evidenceRun, { owner: 'work' })) {
      reject('brief-not-authorized', 'Creator Brief 缺少当前 Work 内的 durable Run 证据')
    }
    const locatorColumns = textOpenWorldCreatorLocatorColumnsV1(source.locator)
    const row = stampNewRecord(scope, 'productProductionBriefs', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: production.id, revision, parentRevision: command.parentRevision, status: 'draft' as const,
      briefKind: 'text-open-world-creator-v1' as const,
      sourceKind: source.binding.kind,
      ...locatorColumns,
      sourceWorldContentHash: source.binding.kind === 'world-release' ? source.binding.releaseHash : null,
      sourceVersionHash: source.binding.kind === 'world-release'
        ? source.binding.releaseHash
        : source.binding.sourceVersionHash,
      sourceBoundaryHash: source.binding.kind === 'world-release'
        ? source.binding.referenceHash
        : source.binding.sourceBoundaryHash,
      sourceBindingJson: canonicalProductProductionJsonV2(source.binding),
      sourceBindingHash: source.bindingHash,
      candidateRunId: command.candidateRunId,
      userIntentSummary: brief.draft.coreGoal,
      unresolvedJson: '[]',
      estimateJson: safeJson({
        scale: brief.draft.scale,
        media: brief.draft.media,
        completion: brief.draft.completion,
      }),
      briefJson: canonicalProductProductionJsonV2(brief),
      briefHash: brief.briefHash,
      // G5-02 confirms creator intent only. G5-04 must create the formal,
      // rights-bearing SourcePlan before authorize-start can create a Build.
      sourcePlanJson: '{}',
      sourcePlanHash: input.emptyHash,
      confirmedBriefJson: '{}', confirmedBriefHash: '',
      authorizedAt: null, createdAt: now,
    } satisfies ProductProductionBriefRecordV1, { owner: 'work' })
    await db.productProductionBriefs.add(row)
    const stateRevision = production.stateRevision + 1
    await db.productProductions.update(production.id, {
      currentBriefRevision: revision,
      status: 'brief-ready',
      title: brief.draft.gameTitle,
      stateRevision,
      updatedAt: now,
    })
    production = {
      ...production,
      currentBriefRevision: revision,
      status: 'brief-ready',
      title: brief.draft.gameTitle,
      stateRevision,
      updatedAt: now,
    }
    return {
      production,
      result: {
        briefRevision: revision,
        briefHash: brief.briefHash,
        sourceBindingHash: source.bindingHash,
        status: 'brief-ready',
      },
    }
  }

  if (command.type === 'authorize-start') {
    if (production.currentBriefRevision !== command.briefRevision || production.status !== 'brief-ready') {
      reject('brief-not-authorized', '当前 Production 没有待授权的 Brief')
    }
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([production.id, command.briefRevision]).first()
    if (!briefRow || briefRow.status !== 'draft' || briefRow.briefHash !== command.briefHash) {
      reject('brief-not-authorized', 'Brief revision/hash/status 不一致')
    }
    if (briefRow.briefKind === 'text-open-world-creator-v1') {
      reject('brief-not-authorized', 'Creator Brief 尚未完成 G5-04 正式来源计划，不能创建 Build')
    }
    const brief = parseProductProductionBriefV3(briefRow.briefJson)
    if (brief.unresolvedDecisionKeys.length > 0) reject('brief-unresolved', 'Brief 仍有未解决决策')
    const confirmedBrief = input.preparedConfirmedBrief
    if (!confirmedBrief || confirmedBrief.productInstanceKey !== production.productionKey
      || confirmedBrief.productType !== brief.intent.productType
      || confirmedBrief.sourcePlanHash !== briefRow.sourcePlanHash
      || confirmedBrief.briefRevision !== briefRow.revision
      || confirmedBrief.briefContentHash !== briefRow.briefHash
      || confirmedBrief.authorStartRevision !== command.expectedStateRevision) {
      reject('brief-not-authorized', 'authorize-start 缺少与当前 SourcePlan/Brief/revision 一致的确认合同')
    }
    const buildNumber = await nextBuildNumber(production.id)
    const build = stampNewRecord(scope, 'productBuilds', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: production.id, buildNumber, briefRevision: briefRow.revision, briefHash: briefRow.briefHash,
      parentBuildNumber: production.currentBuildNumber, sourceProductReleaseId: production.currentProductReleaseId,
      status: 'authorized' as const, resumeState: null, stateRevision: 0, controlEpoch: production.controlEpoch,
      planRevision: 0, planJson: '{}', planHash: input.emptyHash, budgetLedgerJson: '{}',
      manifestJson: '{}', manifestHash: input.emptyHash, packageHash: '', previewManifestJson: '{}',
      previewHash: '', qualityReportJson: '{}', qualityReportHash: input.emptyHash, compatibilityJson: '{}',
      rootTerminalReceiptHash: null, adoptionIntentHash: null,
      releasedProductReleaseId: null, failureJson: '{}', authorizedAt: now, startedAt: null,
      completedAt: null, createdAt: now, updatedAt: now,
    } satisfies ProductBuildRecordV1, { owner: 'work' })
    const buildId = await db.productBuilds.add(build) as number
    await db.productProductionBriefs.where('[productionId+status]').equals([production.id, 'authorized'])
      .modify({ status: 'superseded' })
    await db.productProductionBriefs.update(briefRow.id!, {
      status: 'authorized',
      confirmedBriefJson: canonicalProductProductionJsonV2(confirmedBrief),
      confirmedBriefHash: confirmedBrief.confirmationHash,
      authorizedAt: now,
    })
    const stateRevision = production.stateRevision + 1
    await db.productProductions.update(production.id, {
      status: 'producing', currentBuildNumber: buildNumber, stateRevision, updatedAt: now,
    })
    production = { ...production, status: 'producing', currentBuildNumber: buildNumber, stateRevision, updatedAt: now }
    return { production, result: { buildId, buildNumber, briefRevision: briefRow.revision, briefHash: briefRow.briefHash } }
  }

  if (command.type === 'authorize-text-open-world-creator-start') {
    if (production.currentBriefRevision !== command.briefRevision || production.status !== 'brief-ready'
      || production.currentBuildNumber != null) {
      reject('brief-not-authorized', '当前文字开放世界 Production 没有待授权 Creator Brief')
    }
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([production.id, command.briefRevision]).first()
    const prepared = input.preparedCreatorStart
    if (!briefRow?.id || briefRow.status !== 'draft'
      || briefRow.briefKind !== 'text-open-world-creator-v1'
      || briefRow.briefHash !== command.briefHash
      || !prepared || prepared.production.id !== production.id
      || prepared.briefRow.id !== briefRow.id
      || prepared.start.authorStartRevision !== command.expectedStateRevision
      || prepared.plan.briefHash !== briefRow.briefHash
      || prepared.start.productionPlanHash !== command.expectedPlanHash
      || await hashProductProductionValueV2(prepared.plan) !== command.expectedPlanHash) {
      reject('brief-not-authorized', 'Creator Brief、来源、预检确认或生产计划已经变化')
    }
    const buildNumber = await nextBuildNumber(production.id)
    if (buildNumber !== prepared.buildNumber) {
      reject('production-state-conflict', 'Build 序号已被其他启动命令占用')
    }
    const build = stampNewRecord(scope, 'productBuilds', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: production.id, buildNumber, briefRevision: briefRow.revision, briefHash: briefRow.briefHash,
      parentBuildNumber: production.currentBuildNumber, sourceProductReleaseId: production.currentProductReleaseId,
      status: 'authorized' as const, resumeState: null, stateRevision: 0, controlEpoch: production.controlEpoch,
      planRevision: 1,
      planJson: canonicalProductProductionJsonV2(prepared.plan),
      planHash: prepared.start.productionPlanHash,
      budgetLedgerJson: '{}',
      manifestJson: '{}', manifestHash: input.emptyHash, packageHash: '', previewManifestJson: '{}',
      previewHash: '', qualityReportJson: '{}', qualityReportHash: input.emptyHash, compatibilityJson: '{}',
      rootTerminalReceiptHash: null, adoptionIntentHash: null,
      releasedProductReleaseId: null, failureJson: '{}', authorizedAt: prepared.start.authorizedAt,
      startedAt: null, completedAt: null, createdAt: now, updatedAt: now,
    } satisfies ProductBuildRecordV1, { owner: 'work' })
    const buildId = await db.productBuilds.add(build) as number
    await db.productProductionBriefs.where('[productionId+status]').equals([production.id, 'authorized'])
      .modify({ status: 'superseded' })
    await db.productProductionBriefs.update(briefRow.id, {
      status: 'authorized',
      sourcePlanJson: canonicalProductProductionJsonV2(prepared.sourcePlan),
      sourcePlanHash: prepared.sourcePlan.planHash,
      confirmedBriefJson: canonicalProductProductionJsonV2(prepared.start),
      confirmedBriefHash: prepared.start.startHash,
      authorizedAt: prepared.start.authorizedAt,
    })
    const stateRevision = production.stateRevision + 1
    await db.productProductions.update(production.id, {
      status: 'producing', currentBuildNumber: buildNumber, stateRevision, updatedAt: now,
    })
    production = {
      ...production,
      status: 'producing',
      currentBuildNumber: buildNumber,
      stateRevision,
      updatedAt: now,
    }
    return {
      production,
      result: {
        buildId,
        buildNumber,
        briefRevision: briefRow.revision,
        briefHash: briefRow.briefHash,
        sourcePlanHash: prepared.sourcePlan.planHash,
        planHash: prepared.start.productionPlanHash,
        startHash: prepared.start.startHash,
      },
    }
  }

  if (command.type === 'pause') {
    if (!['producing', 'preview-ready'].includes(production.status)) reject('invalid-state-transition', '当前 Production 不能暂停')
    const build = await currentBuild(production)
    if (['released', 'cancelled', 'failed', 'archived', 'paused'].includes(build.status)) reject('invalid-state-transition', '当前 Build 不能暂停')
    const reservations = pausedLedgerReservations(build.budgetLedgerJson)
    let budgetLedgerJson = build.budgetLedgerJson
    const automaticallySettledReservations: PausedReservationAccountingV1[] = []
    for (const reservation of reservations.filter(item => !item.providerCallPossible)) {
      const settled = resolveProductProductionUnknownResultReservationLedgerV2({
        budgetLedgerJson,
        taskKey: reservation.taskKey,
        runId: reservation.runId,
        attempt: reservation.attempt,
        controlEpoch: reservation.controlEpoch,
        disposition: 'confirmed-not-charged',
      })
      budgetLedgerJson = settled.budgetLedgerJson
      automaticallySettledReservations.push({
        taskKey: reservation.taskKey,
        runId: reservation.runId,
        attempt: reservation.attempt,
        controlEpoch: reservation.controlEpoch,
        ...settled.accounting,
      })
    }
    const providerReservations = reservations
      .filter(item => item.providerCallPossible)
      .map(({ providerCallPossible: _providerCallPossible, ...reservation }) => reservation)
    const controlEpoch = production.controlEpoch + 1
    const stateRevision = production.stateRevision + 1
    await db.productBuilds.update(build.id, {
      status: 'paused',
      resumeState: build.status,
      controlEpoch,
      stateRevision: build.stateRevision + 1,
      budgetLedgerJson,
      failureJson: safeJson(providerReservations.length ? {
        code: 'pause-provider-result-unknown',
        detail: '暂停时仍有供应商请求未返回；恢复前必须逐项封账。',
        reason: command.reason,
        pausedProviderReservations: providerReservations,
        automaticallySettledReservations,
      } : {
        code: 'user-paused',
        reason: command.reason,
        automaticallySettledReservations,
      }),
      updatedAt: now,
    })
    await db.productProductions.update(production.id, { status: 'paused', controlEpoch, stateRevision, updatedAt: now })
    production = { ...production, status: 'paused', controlEpoch, stateRevision, updatedAt: now }
    return { production, result: {
      buildNumber: build.buildNumber,
      controlEpoch,
      resumeState: build.status,
      requiresReservationResolution: providerReservations.length > 0,
      pausedProviderReservations: providerReservations,
      automaticallySettledReservations,
    } }
  }

  if (command.type === 'authorize-text-open-world-creator-repair') {
    const prepared = input.preparedCreatorRepair
    const authorization = input.preparedCreatorRepairAuthorization
    if (production.productType !== 'text-open-world'
      || !prepared || !authorization
      || production.status !== 'preview-ready'
      || production.currentBuildNumber !== command.baseBuildNumber
      || production.currentBriefRevision !== prepared.baseBuild.briefRevision
      || prepared.production.id !== production.id
      || prepared.production.stateRevision !== command.expectedStateRevision
      || prepared.baseBuild.buildNumber !== command.baseBuildNumber
      || prepared.baseBuild.planHash !== command.expectedBasePlanHash
      || prepared.impactPlan.handoffSetHash !== command.expectedHandoffSetHash
      || prepared.impactPlan.impactPlanHash !== command.expectedImpactPlanHash
      || prepared.targetPlanHash !== command.expectedTargetPlanHash
      || authorization.expectedStateRevision !== command.expectedStateRevision
      || authorization.impactPlanHash !== command.expectedImpactPlanHash
      || authorization.targetPlanHash !== command.expectedTargetPlanHash) {
      reject('repair-impact-stale', 'Creator 修复预览、生产状态或作者授权已经变化')
    }
    const buildNumber = await nextBuildNumber(production.id)
    if (buildNumber !== prepared.impactPlan.targetBuildNumber) {
      reject('production-state-conflict', '修复 Build 序号已被其他命令占用')
    }
    const build = stampNewRecord(scope, 'productBuilds', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      productionId: production.id,
      buildNumber,
      briefRevision: prepared.baseBuild.briefRevision,
      briefHash: prepared.baseBuild.briefHash,
      parentBuildNumber: prepared.baseBuild.buildNumber,
      sourceProductReleaseId: prepared.baseBuild.sourceProductReleaseId,
      status: 'authorized' as const,
      resumeState: null,
      stateRevision: 0,
      controlEpoch: production.controlEpoch,
      planRevision: 1,
      planJson: canonicalProductProductionJsonV2(prepared.targetPlan),
      planHash: prepared.targetPlanHash,
      budgetLedgerJson: '{}',
      manifestJson: '{}',
      manifestHash: input.emptyHash,
      packageHash: '',
      previewManifestJson: '{}',
      previewHash: '',
      qualityReportJson: '{}',
      qualityReportHash: input.emptyHash,
      compatibilityJson: '{}',
      rootTerminalReceiptHash: null,
      adoptionIntentHash: null,
      releasedProductReleaseId: null,
      failureJson: '{}',
      authorizedAt: authorization.authorizedAt,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    } satisfies ProductBuildRecordV1, { owner: 'work' })
    const buildId = await db.productBuilds.add(build) as number
    for (const handoff of prepared.handoffs) {
      const impactHandoffHash = await Dexie.waitFor(
        hashTextOpenWorldCreatorEditImpactPlanHandoffV1(handoff.intent),
      )
      for (const artifact of handoff.candidate.rebuiltArtifacts) {
        await db.productBuildArtifacts.add(stampNewRecord(scope, 'productBuildArtifacts', {
          projectId: scope.projectId,
          worldId: scope.worldId,
          workId: scope.workId,
          buildId,
          artifactKey: artifact.artifactKey,
          requirementKey: artifact.requirementKey,
          version: 1,
          kind: artifact.kind,
          mediaKind: null,
          status: 'candidate' as const,
          producerRunId: handoff.snapshot.run.id,
          producerReceiptHash: handoff.verificationReceipt.receiptHash,
          controlEpoch: production.controlEpoch,
          inputHash: impactHandoffHash,
          contentHash: artifact.contentHash,
          payloadJson: canonicalProductProductionJsonV2(artifact.payload),
          metadataJson: canonicalProductProductionJsonV2(artifact.metadata),
          qualityJson: canonicalProductProductionJsonV2(artifact.quality),
          rightsJson: canonicalProductProductionJsonV2(artifact.rights),
          blobObjectId: null,
          mimeType: null,
          byteSize: artifact.byteSize,
          parentArtifactHash: artifact.baseContentHash,
          carriedFrom: null,
          createdAt: now,
          updatedAt: now,
        } satisfies ProductBuildArtifactRecordV1, { owner: 'work' }))
      }
    }
    const stateRevision = production.stateRevision + 1
    await db.productProductions.update(production.id, {
      status: 'producing',
      currentBuildNumber: buildNumber,
      stateRevision,
      updatedAt: now,
    })
    production = {
      ...production,
      status: 'producing',
      currentBuildNumber: buildNumber,
      stateRevision,
      updatedAt: now,
    }
    return { production, result: { ...authorization } }
  }

  if (command.type === 'authorize-text-open-world-creator-media') {
    const prepared = input.preparedCreatorMedia
    const authorization = input.preparedCreatorMediaAuthorization
    if (production.productType !== 'text-open-world'
      || !prepared || !authorization
      || production.status !== 'preview-ready'
      || production.currentBuildNumber !== command.baseBuildNumber
      || production.currentBriefRevision !== prepared.baseBuild.briefRevision
      || prepared.production.id !== production.id
      || prepared.production.stateRevision !== command.expectedStateRevision
      || prepared.baseBuild.buildNumber !== command.baseBuildNumber
      || prepared.baseBuild.planHash !== command.expectedBasePlanHash
      || prepared.mediaPlan.planHash !== command.expectedMediaPlanHash
      || prepared.targetPlanHash !== command.expectedTargetPlanHash
      || prepared.mediaPlan.mode !== command.mode
      || authorization.expectedStateRevision !== command.expectedStateRevision
      || authorization.mediaPlanHash !== command.expectedMediaPlanHash
      || authorization.targetProductionPlanHash !== command.expectedTargetPlanHash) {
      reject('creator-media-stale', 'Creator 媒资预览、生产状态或作者授权已经变化')
    }
    const buildNumber = await nextBuildNumber(production.id)
    if (buildNumber !== prepared.mediaPlan.targetBuildNumber) {
      reject('production-state-conflict', '媒资 Build 序号已被其他命令占用')
    }
    const build = stampNewRecord(scope, 'productBuilds', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      productionId: production.id,
      buildNumber,
      briefRevision: prepared.baseBuild.briefRevision,
      briefHash: prepared.baseBuild.briefHash,
      parentBuildNumber: prepared.baseBuild.buildNumber,
      sourceProductReleaseId: prepared.baseBuild.sourceProductReleaseId,
      status: 'authorized' as const,
      resumeState: null,
      stateRevision: 0,
      controlEpoch: production.controlEpoch,
      planRevision: 1,
      planJson: canonicalProductProductionJsonV2(prepared.targetPlan),
      planHash: prepared.targetPlanHash,
      budgetLedgerJson: '{}',
      manifestJson: '{}',
      manifestHash: input.emptyHash,
      packageHash: '',
      previewManifestJson: '{}',
      previewHash: '',
      qualityReportJson: '{}',
      qualityReportHash: input.emptyHash,
      compatibilityJson: '{}',
      rootTerminalReceiptHash: null,
      adoptionIntentHash: null,
      releasedProductReleaseId: null,
      failureJson: '{}',
      authorizedAt: authorization.authorizedAt,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    } satisfies ProductBuildRecordV1, { owner: 'work' })
    const buildId = await db.productBuilds.add(build) as number
    if (prepared.mediaPlan.mode === 'author-import') {
      const sourceRows = await db.productBuildArtifacts.where('buildId')
        .equals(prepared.baseBuild.id).toArray()
      const activeByKey = new Map(sourceRows.filter(row => (
        row.controlEpoch === prepared.baseBuild.controlEpoch
        && (row.status === 'accepted' || row.status === 'carried-forward')
      )).map(row => [row.artifactKey, row]))
      const localByKey = new Map(prepared.imports.map(item => [item.descriptor.artifactKey, item]))
      for (const [index, slot] of prepared.mediaPlan.slots.entries()) {
        const imported = prepared.mediaPlan.imports[index]
        const local = localByKey.get(slot.artifactKey)
        const parent = activeByKey.get(slot.artifactKey)
        if (!imported || imported.artifactKey !== slot.artifactKey
          || local?.descriptor.contentHash !== imported.contentHash || !parent) {
          reject('creator-media-stale', `Creator 导入媒资暂存集合已变化:${slot.artifactKey}`)
        }
        await db.productBuildArtifacts.add(stampNewRecord(scope, 'productBuildArtifacts', {
          projectId: scope.projectId,
          worldId: scope.worldId,
          workId: scope.workId,
          buildId,
          artifactKey: slot.artifactKey,
          requirementKey: prepared.mediaPlan.capability.requirementKey,
          version: 1,
          kind: 'image' as const,
          mediaKind: slot.mediaKind,
          status: 'candidate' as const,
          producerRunId: null,
          producerReceiptHash: authorization.authorizationHash,
          controlEpoch: production.controlEpoch,
          inputHash: prepared.mediaPlan.planHash,
          contentHash: imported.contentHash,
          payloadJson: canonicalProductProductionJsonV2({
            schema: 'storyforge.generated-media-artifact',
            version: 1,
            assetKey: imported.assetKey,
            request: {
              beatKey: slot.subjectKey,
              slotKey: slot.slotKey,
              sceneTag: slot.subjectKey,
              mediaKind: slot.mediaKind,
              width: imported.width,
              height: imported.height,
              altText: imported.altText,
            },
          }),
          metadataJson: canonicalProductProductionJsonV2({
            assetKey: imported.assetKey,
            name: imported.name,
            width: imported.width,
            height: imported.height,
            durationMs: null,
            altText: imported.altText,
            characterTag: slot.slotKind === 'character-portrait' ? slot.subjectKey : '',
            sceneTag: slot.subjectKey,
            source: imported.source,
            license: imported.license,
          }),
          qualityJson: canonicalProductProductionJsonV2({
            adapterId: prepared.mediaPlan.capability.adapterId,
            imported: true,
            mimeVerified: true,
            dimensionsVerified: true,
            importReceiptHash: authorization.authorizationHash,
            authorizationHash: authorization.authorizationHash,
          }),
          rightsJson: canonicalProductProductionJsonV2({
            origin: 'imported',
            adapterId: prepared.mediaPlan.capability.adapterId,
            source: imported.source,
            license: imported.license,
            commercialUse: true,
            rightsBasis: imported.rightsBasis,
            rightsNote: imported.rightsNote,
            importReceiptHash: authorization.authorizationHash,
          }),
          blobObjectId: local.blobObjectId,
          mimeType: imported.mimeType,
          byteSize: imported.byteSize,
          parentArtifactHash: parent.contentHash,
          carriedFrom: null,
          createdAt: now,
          updatedAt: now,
        } satisfies ProductBuildArtifactRecordV1, { owner: 'work' }))
      }
    }
    const stateRevision = production.stateRevision + 1
    await db.productProductions.update(production.id, {
      status: 'producing', currentBuildNumber: buildNumber, stateRevision, updatedAt: now,
    })
    production = {
      ...production, status: 'producing', currentBuildNumber: buildNumber, stateRevision, updatedAt: now,
    }
    return { production, result: { ...authorization } }
  }

  if (command.type === 'resume') {
    if (production.status !== 'paused') reject('invalid-state-transition', 'Production 不在暂停态')
    const build = await currentBuild(production)
    if (build.status !== 'paused' || !build.resumeState) {
      reject('invalid-state-transition', 'Build 没有可恢复状态')
    }
    let budgetLedgerJson = build.budgetLedgerJson
    let pausedReservationAccountings: PausedReservationAccountingV1[] = []
    let failure: Record<string, unknown>
    try {
      const parsed = JSON.parse(build.failureJson) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      failure = parsed as Record<string, unknown>
    } catch {
      reject('invalid-state-transition', '暂停恢复证据损坏')
    }
    if (failure!.code === 'pause-provider-result-unknown') {
      if (!Array.isArray(failure!.pausedProviderReservations)
        || failure!.pausedProviderReservations.length < 1) {
        reject('invalid-state-transition', '暂停恢复 reservation 证据损坏')
      }
      const frozen = (failure!.pausedProviderReservations as unknown[]).map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          reject('invalid-state-transition', '暂停恢复 reservation 证据损坏')
        }
        const row = value as Record<string, unknown>
        if (typeof row.taskKey !== 'string'
          || !Number.isSafeInteger(row.runId) || Number(row.runId) < 1
          || !Number.isSafeInteger(row.attempt) || Number(row.attempt) < 1
          || !Number.isSafeInteger(row.controlEpoch) || Number(row.controlEpoch) < 0) {
          reject('invalid-state-transition', '暂停恢复 reservation 身份损坏')
        }
        return {
          taskKey: row.taskKey,
          runId: Number(row.runId),
          attempt: Number(row.attempt),
          controlEpoch: Number(row.controlEpoch),
        }
      }).sort((left, right) => pauseReservationIdentity(left).localeCompare(pauseReservationIdentity(right)))
      const requested = [...(command.pausedReservationDispositions ?? [])]
        .sort((left, right) => pauseReservationIdentity(left).localeCompare(pauseReservationIdentity(right)))
      const frozenByIdentity = new Map(frozen.map(reservation => [pauseReservationIdentity(reservation), reservation]))
      if (frozenByIdentity.size !== frozen.length) {
        reject('invalid-state-transition', '暂停恢复 reservation 证据包含重复身份')
      }
      if (requested.some(reservation => !frozenByIdentity.has(pauseReservationIdentity(reservation)))) {
        reject('invalid-state-transition', '恢复处置包含不属于本次暂停的 Run/attempt/epoch reservation')
      }
      const requestedByIdentity = new Map(requested.map(reservation => [pauseReservationIdentity(reservation), reservation]))
      for (const reservation of frozen) {
        const attempt = requirePausedLedgerAttemptState(budgetLedgerJson, reservation)
        if (attempt.kind === 'absent') {
          reject('invalid-state-transition', '暂停 reservation 缺少可验证的 charge 或 release tombstone')
        }
        if (attempt.taskKey !== reservation.taskKey
          || attempt.runId !== reservation.runId
          || attempt.attempt !== reservation.attempt
          || attempt.controlEpoch !== reservation.controlEpoch) {
          reject('invalid-state-transition', '暂停 reservation 已变化或不再属于冻结的 epoch')
        }
        if (attempt.kind === 'reservation'
          && !requestedByIdentity.has(pauseReservationIdentity(reservation))) {
          reject('invalid-state-transition', '恢复前必须精确处置仍未封账的 Run/attempt/epoch reservation')
        }
      }
      pausedReservationAccountings = frozen.map(reservation => {
        const identity = pauseReservationIdentity(reservation)
        const disposition = requestedByIdentity.get(identity)?.disposition ?? null
        const attempt = requirePausedLedgerAttemptState(budgetLedgerJson, reservation)
        if (attempt.kind === 'reservation' || (attempt.kind === 'charge' && disposition)) {
          if (!disposition) {
            reject('invalid-state-transition', '恢复前必须处置仍未封账的 reservation')
          }
          let settled: ReturnType<typeof resolveProductProductionUnknownResultReservationLedgerV2>
          try {
            settled = resolveProductProductionUnknownResultReservationLedgerV2({
              budgetLedgerJson,
              taskKey: reservation.taskKey,
              runId: reservation.runId,
              attempt: reservation.attempt,
              controlEpoch: reservation.controlEpoch,
              disposition,
            })
          } catch {
            reject('invalid-state-transition', '暂停 reservation 已由不同处置封账或身份发生变化')
          }
          budgetLedgerJson = settled.budgetLedgerJson
          return {
            taskKey: reservation.taskKey,
            runId: reservation.runId,
            attempt: reservation.attempt,
            controlEpoch: reservation.controlEpoch,
            ...settled.accounting,
          }
        }
        if (attempt.kind === 'charge') {
          return {
            taskKey: reservation.taskKey,
            runId: reservation.runId,
            attempt: reservation.attempt,
            controlEpoch: reservation.controlEpoch,
            requestedDisposition: null,
            effectiveDisposition: attempt.resolution ?? 'provider-actual-charge',
            usage: structuredClone(attempt.usage),
          }
        }
        if (attempt.kind === 'absent') {
          reject('invalid-state-transition', '暂停 reservation 缺少封账证据')
        }
        reject('invalid-state-transition', '暂停 reservation 未能完成封账')
      })
      if (pausedLedgerReservations(budgetLedgerJson).length > 0) {
        reject('invalid-state-transition', '恢复前仍存在未封账 reservation')
      }
    } else if (failure!.code !== 'user-paused') {
      reject('invalid-state-transition', '当前暂停证据不能恢复')
    } else if (command.pausedReservationDispositions) {
      reject('invalid-state-transition', '普通暂停没有待处置 provider reservation')
    }
    const restored = build.resumeState
    const controlEpoch = production.controlEpoch + 1
    const stateRevision = production.stateRevision + 1
    await db.productBuilds.update(build.id, {
      status: restored,
      resumeState: null,
      controlEpoch,
      stateRevision: build.stateRevision + 1,
      budgetLedgerJson,
      failureJson: pausedReservationAccountings.length ? safeJson({
        code: 'user-pause-resolved',
        previousFailureCode: 'pause-provider-result-unknown',
        pausedReservationAccountings,
        resolvedAt: now,
      }) : '{}',
      updatedAt: now,
    })
    const productionStatus = restored === 'preview-ready' || restored === 'release-ready' ? 'preview-ready' as const : 'producing' as const
    await db.productProductions.update(production.id, { status: productionStatus, controlEpoch, stateRevision, updatedAt: now })
    production = { ...production, status: productionStatus, controlEpoch, stateRevision, updatedAt: now }
    return { production, result: {
      buildNumber: build.buildNumber,
      controlEpoch,
      restored,
      pausedReservationAccountings,
    } }
  }

  if (command.type === 'stop') {
    const build = await currentBuild(production)
    if (build.status === 'released' || production.status === 'released') reject('invalid-state-transition', '已发布 Build 不允许 stop 回滚')
    const controlEpoch = production.controlEpoch + 1
    const stateRevision = production.stateRevision + 1
    await db.productBuilds.update(build.id, {
      status: 'cancelled', resumeState: null, controlEpoch, stateRevision: build.stateRevision + 1,
      failureJson: safeJson({ code: 'user-stopped', retention: command.retention }), completedAt: now, updatedAt: now,
    })
    if (command.retention === 'discard-unreleased') {
      await db.productBuildArtifacts.where('buildId').equals(build.id).filter(row => row.status !== 'orphaned').modify({ status: 'orphaned', updatedAt: now })
    }
    await db.productProductions.update(production.id, { status: 'stopped', controlEpoch, stateRevision, updatedAt: now })
    production = { ...production, status: 'stopped', controlEpoch, stateRevision, updatedAt: now }
    return { production, result: { buildNumber: build.buildNumber, controlEpoch, retention: command.retention } }
  }

  if (command.type === 'archive') {
    if (production.status === 'archived') reject('invalid-state-transition', 'Production 已归档')
    if (production.status === 'producing' || production.status === 'paused') {
      reject('invalid-state-transition', '制作中或暂停中的 Production 必须先停止，不能用归档代替 stop')
    }
    const previousStatus = production.status
    const controlEpoch = production.controlEpoch + 1
    let archivedBuildNumber: number | null = null
    if (production.currentBuildNumber != null) {
      const build = await currentBuild(production)
      archivedBuildNumber = build.buildNumber
      if (!['released', 'cancelled', 'failed', 'archived'].includes(build.status)) {
        await db.productBuilds.update(build.id, {
          status: 'archived', resumeState: build.status, controlEpoch,
          stateRevision: build.stateRevision + 1, updatedAt: now,
        })
      }
    }
    const stateRevision = production.stateRevision + 1
    try { JSON.parse(production.lastErrorJson) } catch {
      reject('invalid-state-transition', 'Production 原错误证据不是合法 JSON，不能安全归档')
    }
    const archiveState = safeJson({
      code: 'user-archived', previousStatus,
      previousLastErrorJson: production.lastErrorJson,
      reason: command.reason,
    })
    await db.productProductions.update(production.id, {
      status: 'archived', controlEpoch, stateRevision, lastErrorJson: archiveState, updatedAt: now,
    })
    production = {
      ...production, status: 'archived', controlEpoch, stateRevision,
      lastErrorJson: archiveState, updatedAt: now,
    }
    return { production, result: { previousStatus, buildNumber: archivedBuildNumber, controlEpoch } }
  }

  if (command.type === 'restore') {
    if (production.status !== 'archived') reject('invalid-state-transition', 'Production 不在归档态')
    let archiveState: { code?: unknown; previousStatus?: unknown; previousLastErrorJson?: unknown } = {}
    try { archiveState = JSON.parse(production.lastErrorJson) as typeof archiveState } catch { /* rejected below */ }
    const allowedStatuses: ProductProductionRecordV1['status'][] = [
      'consulting', 'brief-ready', 'preview-ready', 'released', 'stopped', 'failed',
    ]
    if (archiveState.code !== 'user-archived'
      || typeof archiveState.previousStatus !== 'string'
      || !allowedStatuses.includes(archiveState.previousStatus as ProductProductionRecordV1['status'])
      || typeof archiveState.previousLastErrorJson !== 'string') {
      reject('invalid-state-transition', '归档恢复元数据缺失或损坏')
    }
    try { JSON.parse(archiveState.previousLastErrorJson) } catch {
      reject('invalid-state-transition', '归档中的原错误证据损坏')
    }
    const restoredStatus = archiveState.previousStatus as ProductProductionRecordV1['status']
    const controlEpoch = production.controlEpoch + 1
    let restoredBuildStatus: ProductBuildRecordV1['status'] | null = null
    if (production.currentBuildNumber != null) {
      const build = await currentBuild(production)
      if (build.status === 'archived') {
        if (!build.resumeState || ['archived', 'paused'].includes(build.resumeState)) {
          reject('invalid-state-transition', '归档 Build 缺少可恢复状态')
        }
        restoredBuildStatus = build.resumeState
        await db.productBuilds.update(build.id, {
          status: build.resumeState, resumeState: null, controlEpoch,
          stateRevision: build.stateRevision + 1, updatedAt: now,
        })
      } else restoredBuildStatus = build.status
    }
    const stateRevision = production.stateRevision + 1
    await db.productProductions.update(production.id, {
      status: restoredStatus, controlEpoch, stateRevision,
      lastErrorJson: archiveState.previousLastErrorJson, updatedAt: now,
    })
    production = {
      ...production, status: restoredStatus, controlEpoch, stateRevision,
      lastErrorJson: archiveState.previousLastErrorJson, updatedAt: now,
    }
    return { production, result: { restoredStatus, restoredBuildStatus, controlEpoch } }
  }

  if (command.type === 'resolve-blocker') {
    const build = await currentBuild(production)
    if (!['recovery-required', 'paused'].includes(build.status)) reject('invalid-state-transition', '当前 Build 没有待处理 blocker')
    if (!['retry', 'author-edit', 'change-capability', 'cancel'].includes(command.resolution.action)) {
      reject('invalid-state-transition', '当前 blocker 只允许重试、更换能力后重试或取消；降级/豁免必须先生成新 Brief')
    }
    let failure: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(build.failureJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        failure = parsed as Record<string, unknown>
      }
    } catch {
      reject('invalid-state-transition', '当前 blocker 失败证据损坏')
    }
    if (command.resolution.action !== 'cancel'
      && (build.status !== 'recovery-required' || failure.taskKey !== command.blockerKey)) {
      reject('invalid-state-transition', '重试必须精确对应当前失败任务；暂停态请使用恢复命令')
    }
    if (command.resolution.action !== 'cancel') {
      try {
        await validateProductProductionRecoveryDirectiveV1({
          scope,
          productProductionId: production.id,
          productBuildId: build.id!,
          productProductionTaskKey: command.blockerKey,
          expectedState: 'blocked',
          requestedAction: command.resolution.action as 'retry' | 'author-edit' | 'change-capability',
          allowLegacyRetry: true,
        })
      } catch {
        reject('invalid-state-transition', '当前 blocker 缺少与失败 Run/epoch/attempt 一致的恢复证据')
      }
    }
    if (command.resolution.action === 'author-edit') {
      let authorDraftAllowed = false
      try {
        authorDraftAllowed = inspectProductProductionBuildRecoveryPolicyV1({
          productType: production.productType,
          planJson: build.planJson,
          taskKey: command.blockerKey,
        }).authorDraftAllowed
      } catch { /* a corrupt or unrelated Plan can never authorize an author draft */ }
      if (!authorDraftAllowed) {
        reject('invalid-state-transition', '作者修订必须对应当前失败且支持作者修订的模型任务')
      }
    }
    const unknownResultReservation = command.resolution.unknownResultReservation
    let resolvedUnknownReservation: ReturnType<
      typeof resolveProductProductionUnknownResultReservationLedgerV2
    > | null = null
    const providerReservationFailure = failure.code === 'unknown-result'
      || failure.code === 'provider-response-uncheckpointed'
    if (providerReservationFailure) {
      if (command.resolution.action !== 'cancel' && !unknownResultReservation) {
        reject('invalid-state-transition', failure.code === 'provider-response-uncheckpointed'
          ? '已观察到供应商响应但用量未结算；必须按冻结预留上限封账后才能重试'
          : '结果未知的任务必须先明确确认未计费，或按预留上限记账')
      }
      if (unknownResultReservation) {
        if (failure.code === 'provider-response-uncheckpointed'
          && unknownResultReservation.disposition !== 'charge-reservation-upper-bound') {
          reject('invalid-state-transition', '已观察到供应商响应，不能声明为未计费')
        }
        const provenance = failure.failureProvenance != null
          && typeof failure.failureProvenance === 'object'
          && !Array.isArray(failure.failureProvenance)
          ? failure.failureProvenance as Record<string, unknown>
          : null
        if (!provenance
          || provenance.runId !== unknownResultReservation.runId
          || provenance.attempt !== unknownResultReservation.attempt
          || provenance.controlEpoch !== unknownResultReservation.controlEpoch
          || failure.taskKey !== command.blockerKey) {
          reject('invalid-state-transition', 'unknown-result 处置没有精确命中当前失败 Run/attempt/epoch')
        }
        try {
          resolvedUnknownReservation = resolveProductProductionUnknownResultReservationLedgerV2({
            budgetLedgerJson: build.budgetLedgerJson,
            taskKey: command.blockerKey,
            ...unknownResultReservation,
          })
        } catch {
          reject('invalid-state-transition', 'unknown-result reservation 已变化或不再可处置')
        }
      }
    } else if (unknownResultReservation) {
      reject('invalid-state-transition', '只有 provider 结果未结算 blocker 可以处置 reservation')
    }
    const unknownResultAccounting = resolvedUnknownReservation && unknownResultReservation
      ? {
          runId: unknownResultReservation.runId,
          attempt: unknownResultReservation.attempt,
          controlEpoch: unknownResultReservation.controlEpoch,
          ...resolvedUnknownReservation.accounting,
        }
      : null
    // `command.resolution` is the immutable author request. The resolved
    // failure state records the effective accounting outcome separately so a
    // provider charge that wins the race cannot be misrepresented as an
    // author-confirmed zero charge.
    const persistedResolution = unknownResultAccounting
      ? {
          action: command.resolution.action,
          note: command.resolution.note,
          ...(command.resolution.authorDraftJson
            ? { authorDraftJson: command.resolution.authorDraftJson }
            : {}),
          unknownResultAccounting,
        }
      : command.resolution
    const previousFailure = {
      taskKey: failure.taskKey,
      code: failure.code,
      failureProvenance: failure.failureProvenance ?? null,
    }
    const controlEpoch = production.controlEpoch + 1
    const stateRevision = production.stateRevision + 1
    if (command.resolution.action === 'cancel') {
      await db.productBuilds.update(build.id, {
        status: 'cancelled', resumeState: null, controlEpoch,
        budgetLedgerJson: resolvedUnknownReservation?.budgetLedgerJson ?? build.budgetLedgerJson,
        failureJson: safeJson({
          blockerKey: command.blockerKey,
          resolution: persistedResolution,
          unknownResultAccounting,
          previousFailure,
        }),
        stateRevision: build.stateRevision + 1, completedAt: now, updatedAt: now,
      })
      await db.productProductions.update(production.id, {
        status: 'stopped', controlEpoch, stateRevision, updatedAt: now,
      })
      production = { ...production, status: 'stopped', controlEpoch, stateRevision, updatedAt: now }
    } else {
      await db.productBuilds.update(build.id, {
        status: 'building', resumeState: null, controlEpoch,
        budgetLedgerJson: resolvedUnknownReservation?.budgetLedgerJson ?? build.budgetLedgerJson,
        failureJson: safeJson({
          blockerKey: command.blockerKey,
          resolution: persistedResolution,
          unknownResultAccounting,
          previousFailure,
          resolvedAt: now,
        }),
        stateRevision: build.stateRevision + 1, updatedAt: now,
      })
      await db.productProductions.update(production.id, {
        status: 'producing', controlEpoch, stateRevision, updatedAt: now,
      })
      production = { ...production, status: 'producing', controlEpoch, stateRevision, updatedAt: now }
    }
    return { production, result: {
      buildNumber: build.buildNumber, blockerKey: command.blockerKey,
      action: command.resolution.action, controlEpoch, unknownResultAccounting,
    } }
  }

  if (command.type === 'request-preview') {
    const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, command.buildNumber]).first()
    if (!build || !['preview-ready', 'release-ready', 'released'].includes(build.status) || !build.previewHash) {
      reject('preview-stale', 'Build 尚无可验证 Preview')
    }
    return { production, result: { buildNumber: build.buildNumber, previewHash: build.previewHash, packageHash: build.packageHash } }
  }

  if (command.type === 'publish') {
    reject('publication-transaction-failed', '发布必须由 product-production/adoption.ts 原子事务入口执行')
  }

  if (!['preview-ready', 'released'].includes(production.status)) reject('invalid-state-transition', '当前 Production 不能开始演化会谈')
  if (command.base.kind === 'build') {
    const base = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, command.base.buildNumber]).first()
    if (!base || base.manifestHash !== command.base.manifestHash || !['preview-ready', 'release-ready', 'released'].includes(base.status)) {
      reject('source-stale', '演化 Build 基线不可验证')
    }
  } else {
    const release = await db.productReleases.get(command.base.productReleaseId)
    if (!release || release.workId !== scope.workId || release.contentHash !== command.base.contentHash) reject('source-stale', '演化 Release 基线不可验证')
  }
  if (production.currentBriefRevision == null) reject('brief-not-authorized', '演化缺少上一版 Brief')
  const previous = await db.productProductionBriefs
    .where('[productionId+revision]').equals([production.id, production.currentBriefRevision]).first()
  if (!previous) reject('brief-not-authorized', '上一版 Brief 缺失')
  if (previous.briefKind === 'text-open-world-creator-v1') {
    reject('brief-not-authorized', 'Creator Brief 尚未进入可演化的正式生产版本')
  }
  const priorBrief = parseProductProductionBriefV3(previous.briefJson)
  const evolutionGoal = command.userText.trim().slice(0, 2000)
  const affectedLanes = [...new Set(command.affectedLanes)]
  const contentAffected = affectedLanes.includes('content') || affectedLanes.includes('world-source')
  const baseRef = command.base.kind === 'build'
    ? `game-build:${command.base.buildNumber}:${command.base.manifestHash}`
    : `product-release:${command.base.productReleaseId}:${command.base.contentHash}`
  const nextBrief = parseProductProductionBriefV3({
    ...priorBrief,
    source: contentAffected ? {
      ...priorBrief.source,
      startingPoint: {
        ...priorBrief.source.startingPoint,
        kind: 'custom' as const,
        title: `继续演化：${evolutionGoal.slice(0, 120)}`,
        summary: `承接不可变 ${command.base.kind} 基线，按作者本轮目标继续生产。`,
        sourceRefs: [...new Set([...priorBrief.source.startingPoint.sourceRefs, baseRef])],
        openingConflict: evolutionGoal,
      },
    } : priorBrief.source,
    intent: contentAffected ? {
      ...priorBrief.intent,
      openingSituation: evolutionGoal,
      coreExperience: [...new Set([...priorBrief.intent.coreExperience, `本轮演化：${evolutionGoal}`])],
    } : priorBrief.intent,
    unresolvedDecisionKeys: [],
    evolution: {
      schema: 'storyforge.product-evolution-impact', version: 1,
      base: command.base, userGoal: evolutionGoal, affectedLanes,
    },
  })
  const revision = await nextBriefRevision(production.id)
  const briefHash = await Dexie.waitFor(hashProductProductionValueV2(nextBrief))
  await db.productProductionBriefs.add(stampNewRecord(scope, 'productProductionBriefs', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionId: production.id, revision, parentRevision: previous.revision, status: 'draft' as const,
    briefKind: 'product-production-v3' as const, sourceKind: 'world-release' as const,
    sourceWorldReleaseId: previous.sourceWorldReleaseId, sourceWorldContentHash: previous.sourceWorldContentHash,
    userIntentSummary: command.userText, unresolvedJson: safeJson(nextBrief.unresolvedDecisionKeys),
    estimateJson: safeJson({
      ...JSON.parse(previous.estimateJson) as Record<string, unknown>,
      evolutionImpact: nextBrief.evolution,
    }),
    briefJson: canonicalProductProductionJsonV2(nextBrief), briefHash,
    sourcePlanJson: previous.sourcePlanJson,
    sourcePlanHash: previous.sourcePlanHash,
    confirmedBriefJson: '{}',
    confirmedBriefHash: '',
    authorizedAt: null, createdAt: now,
  } satisfies ProductProductionBriefRecordV1, { owner: 'work' }))
  const stateRevision = production.stateRevision + 1
  await db.productProductions.update(production.id, { status: 'brief-ready', currentBriefRevision: revision, stateRevision, updatedAt: now })
  production = { ...production, status: 'brief-ready', currentBriefRevision: revision, stateRevision, updatedAt: now }
  return { production, result: { briefRevision: revision, briefHash, base: command.base } }
}

async function executeTransaction(input: {
  scope: WorkspaceScope
  productionId?: number
  command: ProductProductionCommandV1
  payloadHash: string
  preparedBriefHash: string | null
  preparedSourcePlan: ProductSourcePlanV1 | null
  preparedConfirmedBrief: ConfirmedProductBriefV1 | null
  preparedCreatorSource: {
    locator: TextOpenWorldCreatorSourceLocatorV1
    binding: TextOpenWorldCreatorSourceBindingV1
    bindingHash: string
    summary: TextOpenWorldCreatorSourceSummaryV1
  } | null
  preparedCreatorBrief: TextOpenWorldCreatorBriefV1 | null
  preparedCreatorEvidence: {
    runId: number
    localContractHash: string
    bindingHash: string
    candidateHash: string
    terminalReceiptHash: string
  } | null
  preparedCreatorStart?: TextOpenWorldCreatorStartPreparationV1 | null
  preparedCreatorRepair?: TextOpenWorldCreatorRepairPreparationV1 | null
  preparedCreatorRepairAuthorization?: TextOpenWorldCreatorRepairAuthorizationV1 | null
  preparedCreatorMedia?: TextOpenWorldCreatorMediaPreparationV1 | null
  preparedCreatorMediaAuthorization?: TextOpenWorldCreatorMediaAuthorizationV1 | null
  preparedWorldReferenceHash: string | null
  emptyHash: string
  now: number
}): Promise<ProductProductionCommandReceiptV1> {
  const { scope, command, now } = input
  const transactionTables = scopeTransactionTables(
    db.productReleases,
    db.productProductions, db.productProductionBriefs, db.productProductionCommands,
    db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects,
    db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.agentRunArtifacts,
    ...(command.type === 'authorize-text-open-world-creator-start'
      // Creator source adapters expose only opaque transaction capabilities;
      // the command layer never learns physical WorldRelease/novel table names.
      ? textOpenWorldCreatorProductionSourceTransactionTablesV1(command.sourceLocator)
      : []),
  )
  return db.transaction('rw', transactionTables, async () => {
    let production: ProductProductionRecordV1 & { id: number }
    if (command.type === 'create-intent' || command.type === 'create-text-open-world-intent') {
      const existing = await db.productProductions.where('[workId+productionKey]').equals([scope.workId, command.productionKey]).first()
      if (existing) {
        if (!await assertRecordInScope(scope, 'productProductions', existing, { owner: 'work' })) reject('production-state-conflict', 'productionKey 跨 Work 冲突')
        production = existing as ProductProductionRecordV1 & { id: number }
      } else {
        if (command.type === 'create-intent' && !input.preparedWorldReferenceHash) {
          reject('source-stale', 'create-intent 缺少经中立边界验证的 WorldReference')
        }
        if (command.type === 'create-text-open-world-intent'
          && input.preparedCreatorSource?.bindingHash !== command.expectedSourceBindingHash) {
          reject('source-stale', '文字开放世界 intent 缺少当前来源复验')
        }
        const row = stampNewRecord(scope, 'productProductions', {
          projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
          productionKey: command.productionKey, productType: command.productType,
          title: command.userText.slice(0, 120), status: 'consulting' as const,
          stateRevision: 0, controlEpoch: 0, currentBriefRevision: null, currentBuildNumber: null,
          currentProductReleaseId: null, lastErrorJson: '{}', createdAt: now, updatedAt: now,
          ...(command.type === 'create-text-open-world-intent' && input.preparedCreatorSource
            ? textOpenWorldCreatorProductionLocatorColumnsV1(
                input.preparedCreatorSource.locator,
                input.preparedCreatorSource.binding,
                input.preparedCreatorSource.bindingHash,
              )
            : {}),
        } satisfies ProductProductionRecordV1, { owner: 'work' })
        const id = await db.productProductions.add(row) as number
        production = { ...row, id }
      }
    } else {
      if (!Number.isInteger(input.productionId)) reject('production-not-found', '命令缺少 productionId')
      production = await productionInScope(scope, input.productionId!)
    }

    const existingCommand = await db.productProductionCommands
      .where('[productionId+commandId]').equals([production.id, command.commandId]).first()
    if (existingCommand) {
      if (existingCommand.payloadHash !== input.payloadHash) reject('command-id-payload-conflict', '相同 commandId 的 payload 不同')
      if (existingCommand.status === 'claimed') reject('command-in-progress', '命令已被其他执行者 claim')
      return {
        ok: existingCommand.status === 'succeeded', commandId: command.commandId, commandType: command.type,
        productionId: production.id, stateRevision: production.stateRevision,
        result: readResult(existingCommand.resultJson),
        errorCode: existingCommand.errorCode as ProductProductionErrorCodeV1 | null, replayed: true,
      }
    }

    const transactionCreatorStart = input.preparedCreatorStart ?? null

    const claim = stampNewRecord(scope, 'productProductionCommands', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, productionId: production.id,
      commandId: command.commandId, type: command.type, payloadHash: input.payloadHash,
      expectedStateRevision: command.type === 'create-intent' || command.type === 'create-text-open-world-intent'
        ? null
        : command.expectedStateRevision,
      status: 'claimed' as const, resultJson: '{}', errorCode: null, createdAt: now, completedAt: null,
    } satisfies ProductProductionCommandRecordV1, { owner: 'work' })
    const claimId = await db.productProductionCommands.add(claim) as number

    try {
      if (command.type === 'authorize-text-open-world-creator-start') {
        if (!transactionCreatorStart) {
          throw new Error('[product-production] Creator start 缺少事务外完整预检结果')
        }
        // The immutable Plan and its hashes were generated before opening the
        // transaction. Re-read only the mutable external facts here while all
        // source stores and Production stores are locked; no provider call is
        // permitted in this boundary. Expected source races become a durable,
        // stable source-stale command result instead of an unclassified throw.
        try {
          await assertTextOpenWorldCreatorProductionSourceCurrentV1({
            scope,
            sourceLocator: command.sourceLocator,
            novelSourceCasWitness: transactionCreatorStart.novelSourceCasWitness,
          })
        } catch {
          reject('source-stale', 'source-stale：Creator 来源在原子授权边界已经变化')
        }
        const aiState = useAIConfigStore.getState()
        const confirmation = await Dexie.waitFor(
          verifyTextOpenWorldCreatorProductionPreflightConfirmationV1({
            brief: transactionCreatorStart.brief,
            preflight: command.preflight,
            confirmation: command.confirmation,
            projectId: scope.projectId,
            aiConfig: aiState.config,
            rememberApiKey: aiState.rememberApiKey,
          }),
        )
        if (confirmation.confirmationHash !== transactionCreatorStart.start.confirmation.confirmationHash
          || transactionCreatorStart.start.productionPlanHash !== command.expectedPlanHash) {
          reject('source-stale', 'source-stale：Creator 来源、模型或冻结计划在原子授权边界发生变化')
        }
      }
      if (command.type === 'authorize-text-open-world-creator-repair') {
        if (!input.preparedCreatorRepair || !input.preparedCreatorRepairAuthorization) {
          throw new Error('[product-production] Creator repair 缺少事务外完整影响计划')
        }
        try {
          await Dexie.waitFor(assertTextOpenWorldCreatorRepairPreparationCurrentV1(
            input.preparedCreatorRepair,
          ))
        } catch {
          reject('repair-impact-stale', 'Creator repair 的 Production、Build、Handoff 或 Artifact 已变化')
        }
      }
      if (command.type === 'authorize-text-open-world-creator-media') {
        if (!input.preparedCreatorMedia || !input.preparedCreatorMediaAuthorization) {
          throw new Error('[product-production] Creator media 缺少事务外完整媒资计划')
        }
        try {
          await Dexie.waitFor(assertTextOpenWorldCreatorMediaPreparationCurrentV1(
            input.preparedCreatorMedia,
          ))
        } catch {
          reject('creator-media-stale', 'Creator media 的 Production、Build、Artifact、Blob 或命令链已变化')
        }
      }
      const applied = await applyCommand({
        scope, production, command,
        preparedBriefHash: input.preparedBriefHash,
        preparedSourcePlan: input.preparedSourcePlan,
        preparedConfirmedBrief: input.preparedConfirmedBrief,
        preparedCreatorSource: input.preparedCreatorSource,
        preparedCreatorBrief: input.preparedCreatorBrief,
        preparedCreatorEvidence: input.preparedCreatorEvidence,
        preparedCreatorStart: transactionCreatorStart,
        preparedCreatorRepair: input.preparedCreatorRepair,
        preparedCreatorRepairAuthorization: input.preparedCreatorRepairAuthorization,
        preparedCreatorMedia: input.preparedCreatorMedia,
        preparedCreatorMediaAuthorization: input.preparedCreatorMediaAuthorization,
        emptyHash: input.emptyHash,
        now,
      })
      const resultJson = safeJson(applied.result)
      await db.productProductionCommands.update(claimId, { status: 'succeeded', resultJson, completedAt: now })
      return {
        ok: true, commandId: command.commandId, commandType: command.type, productionId: production.id,
        stateRevision: applied.production.stateRevision, result: applied.result, errorCode: null, replayed: false,
      }
    } catch (cause) {
      if (!(cause instanceof ExpectedCommandFailure)) throw cause
      const result = { message: cause.message }
      await db.productProductionCommands.update(claimId, {
        status: 'failed', resultJson: safeJson(result), errorCode: cause.code, completedAt: now,
      })
      return {
        ok: false, commandId: command.commandId, commandType: command.type, productionId: production.id,
        stateRevision: production.stateRevision, result, errorCode: cause.code, replayed: false,
      }
    }
  })
}

function notifyProductionChanged(receipt: ProductProductionCommandReceiptV1): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel('storyforge-product-production')
  try { channel.postMessage({ productionId: receipt.productionId, stateRevision: receipt.stateRevision }) }
  finally { channel.close() }
}

/** The only public mutation entry for user/Agent/UI production control. */
export async function executeProductProductionCommand(input: {
  scope: WorkspaceScope
  productionId?: number
  command: ProductProductionCommandV1 | unknown
  /** Non-portable local locators used only while atomically authorizing a
   * Creator media Build. The durable command/result stores hashes and rights,
   * never browser-local Blob ids. */
  preparedCreatorMedia?: TextOpenWorldCreatorMediaPreparationV1 | null
  now?: number
}): Promise<ProductProductionCommandReceiptV1> {
  const scope = await resolveScope({ scope: input.scope })
  const command = parseProductProductionCommandV1(input.command)
  const payloadHash = await hashProductProductionValueV2(command)
  const emptyHash = await hashProductProductionValueV2({})
  const now = input.now ?? Date.now()
  // Durable command replay must not depend on the source still being locally
  // resolvable. The first execution already froze and verified those inputs;
  // a refresh/retry replays that receipt before doing any WebCrypto/Gateway
  // preflight that could now fail for unrelated reasons.
  if (command.type !== 'create-intent' && command.type !== 'create-text-open-world-intent'
    && Number.isInteger(input.productionId)) {
    const existing = await db.productProductionCommands
      .where('[productionId+commandId]').equals([input.productionId!, command.commandId]).first()
    if (existing) {
      const replay = await executeTransaction({
        scope,
        productionId: input.productionId,
        command,
        payloadHash,
        preparedBriefHash: null,
        preparedSourcePlan: null,
        preparedConfirmedBrief: null,
        preparedCreatorSource: null,
        preparedCreatorBrief: null,
        preparedCreatorEvidence: null,
        preparedCreatorRepair: null,
        preparedCreatorRepairAuthorization: null,
        preparedCreatorMedia: null,
        preparedCreatorMediaAuthorization: null,
        preparedWorldReferenceHash: null,
        emptyHash,
        now,
      })
      notifyProductionChanged(replay)
      return replay
    }
  }
  if (command.type === 'create-text-open-world-intent') {
    const production = await db.productProductions
      .where('[workId+productionKey]').equals([scope.workId, command.productionKey]).first()
    const existing = production?.id == null ? null : await db.productProductionCommands
      .where('[productionId+commandId]').equals([production.id, command.commandId]).first()
    if (production?.id != null && existing) {
      const replay = await executeTransaction({
        scope,
        command,
        payloadHash,
        preparedBriefHash: null,
        preparedSourcePlan: null,
        preparedConfirmedBrief: null,
        preparedCreatorSource: null,
        preparedCreatorBrief: null,
        preparedCreatorEvidence: null,
        preparedCreatorRepair: null,
        preparedCreatorRepairAuthorization: null,
        preparedCreatorMedia: null,
        preparedCreatorMediaAuthorization: null,
        preparedWorldReferenceHash: null,
        emptyHash,
        now,
      })
      notifyProductionChanged(replay)
      return replay
    }
  }
  const preparedBriefHash = command.type === 'save-brief-revision'
    ? await hashProductProductionValueV2(command.brief)
    : null
  let preparedSourcePlan: ProductSourcePlanV1 | null = null
  let preparedConfirmedBrief: ConfirmedProductBriefV1 | null = null
  let preparedCreatorSource: {
    locator: TextOpenWorldCreatorSourceLocatorV1
    binding: TextOpenWorldCreatorSourceBindingV1
    bindingHash: string
    summary: TextOpenWorldCreatorSourceSummaryV1
  } | null = null
  let preparedCreatorBrief: TextOpenWorldCreatorBriefV1 | null = null
  let preparedCreatorEvidence: {
    runId: number
    localContractHash: string
    bindingHash: string
    candidateHash: string
    terminalReceiptHash: string
  } | null = null
  let preparedCreatorStart: TextOpenWorldCreatorStartPreparationV1 | null = null
  let preparedCreatorRepair: TextOpenWorldCreatorRepairPreparationV1 | null = null
  let preparedCreatorRepairAuthorization: TextOpenWorldCreatorRepairAuthorizationV1 | null = null
  let preparedCreatorMedia: TextOpenWorldCreatorMediaPreparationV1 | null = input.preparedCreatorMedia ?? null
  let preparedCreatorMediaAuthorization: TextOpenWorldCreatorMediaAuthorizationV1 | null = null
  const preparedWorldReferenceHash = command.type === 'create-intent'
    ? (await createWorldReferenceV1(command.worldReleaseId)).referenceHash
    : null
  if (command.type === 'save-brief-revision') {
    if (!Number.isInteger(input.productionId)) {
      throw new Error('[product-production] save-brief-revision 缺少 productionId')
    }
    const production = await productionInScope(scope, input.productionId!)
    preparedSourcePlan = await createProductProductionSourcePlanV1({
      scope,
      productionKey: production.productionKey,
      brief: command.brief,
      createdAt: input.now,
    })
  } else if (command.type === 'create-text-open-world-intent'
    || command.type === 'save-text-open-world-creator-brief') {
    const inspected = await inspectTextOpenWorldCreatorSourceLocatorV1({
      scope,
      locator: command.sourceLocator,
    })
    if (command.type === 'create-text-open-world-intent') {
      if (inspected.bindingHash !== command.expectedSourceBindingHash) {
        throw new Error('[product-production] 文字开放世界 intent 来源已变化')
      }
      preparedCreatorSource = {
        locator: command.sourceLocator,
        binding: inspected.binding,
        bindingHash: inspected.bindingHash,
        summary: inspected.summary,
      }
    } else {
      if (!Number.isInteger(input.productionId)) {
        throw new Error('[product-production] save-text-open-world-creator-brief 缺少 productionId')
      }
      const production = await productionInScope(scope, input.productionId!)
      preparedCreatorBrief = await verifyTextOpenWorldCreatorBriefV1(command.brief)
      if (production.productType !== 'text-open-world'
        || preparedCreatorBrief.productInstanceKey !== production.productionKey
        || preparedCreatorBrief.sourceBindingHash !== inspected.bindingHash
        || canonicalProductProductionJsonV2(preparedCreatorBrief.sourceBinding)
          !== canonicalProductProductionJsonV2(inspected.binding)
        || canonicalProductProductionJsonV2(preparedCreatorBrief.sourceSummary)
          !== canonicalProductProductionJsonV2(inspected.summary)) {
        throw new Error('[product-production] Creator Brief 与当前来源复验不一致')
      }
      const snapshot = await readAgentRunV1(scope, command.candidateRunId)
      const step = snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1]
      const runContextManifestHashes = snapshot.events.flatMap(event => (
        event.type === 'context.assembled'
          && event.payload.stepId === TEXT_OPEN_WORLD_CREATOR_BRIEF_STEP_ID_V1
          ? [event.payload.manifestHash]
          : []
      ))
      const expectedTerminalReceipt = await createVerificationReceiptV1({
        version: 1,
        runId: snapshot.run.id,
        generation: snapshot.projection.generation,
        contractHash: snapshot.run.contractHash,
        contextManifestHashes: preparedCreatorBrief.candidateEvidence.contextManifestHashes,
        candidateHashes: [
          preparedCreatorBrief.candidateEvidence.candidateHash,
          preparedCreatorBrief.briefHash,
        ],
        adoptionEventIds: [],
        postStateHash: preparedCreatorBrief.briefHash,
        verifierSetVersion: TEXT_OPEN_WORLD_CREATOR_BRIEF_VERIFIER_V1,
        criteria: [
          { id: 'creator-brief.protocol-valid', status: 'passed', evidenceRefs: [`brief:${preparedCreatorBrief.briefHash}`] },
          { id: 'creator-brief.source-bound', status: 'passed', evidenceRefs: [`source:${preparedCreatorBrief.sourceBindingHash}`] },
          { id: 'creator-brief.author-confirmed', status: 'passed', evidenceRefs: [`candidate:${preparedCreatorBrief.candidateEvidence.candidateHash}`] },
          { id: 'creator-brief.no-unresolved-items', status: 'passed', evidenceRefs: ['unresolved:0'] },
        ],
        acceptedAt: preparedCreatorBrief.confirmedAt,
      })
      if (snapshot.projection.state !== 'completed' || !snapshot.projection.terminalReceiptHash
        || snapshot.contract.runtimeBindingHash !== preparedCreatorBrief.candidateEvidence.runBindingHash
        || step?.confirmation !== 'adopt'
        || step?.candidateHash !== preparedCreatorBrief.candidateEvidence.candidateHash
        || step.outputHash !== preparedCreatorBrief.briefHash
        || runContextManifestHashes.length !== preparedCreatorBrief.candidateEvidence.contextManifestHashes.length
        || runContextManifestHashes.some((hash, index) => (
          hash !== preparedCreatorBrief!.candidateEvidence.contextManifestHashes[index]
        ))
        || snapshot.projection.terminalReceiptHash !== expectedTerminalReceipt.receiptHash) {
        throw new Error('[product-production] Creator Brief 的 durable Run 尚未完成或候选证据不一致')
      }
      preparedCreatorEvidence = {
        runId: snapshot.run.id,
        localContractHash: snapshot.run.contractHash,
        bindingHash: snapshot.contract.runtimeBindingHash,
        candidateHash: step.candidateHash,
        terminalReceiptHash: snapshot.projection.terminalReceiptHash,
      }
      preparedCreatorSource = {
        locator: command.sourceLocator,
        binding: inspected.binding,
        bindingHash: inspected.bindingHash,
        summary: inspected.summary,
      }
    }
  } else if (command.type === 'authorize-text-open-world-creator-start') {
    if (!Number.isInteger(input.productionId)) {
      throw new Error('[product-production] Creator start 缺少 productionId')
    }
    const aiState = useAIConfigStore.getState()
    preparedCreatorStart = await createTextOpenWorldCreatorStartPreparationV1({
      scope,
      productionId: input.productionId!,
      briefRevision: command.briefRevision,
      briefHash: command.briefHash,
      expectedStateRevision: command.expectedStateRevision,
      sourceLocator: command.sourceLocator,
      preflight: command.preflight,
      confirmation: command.confirmation,
      aiConfig: aiState.config,
      rememberApiKey: aiState.rememberApiKey,
      rightsBasis: command.rightsBasis,
      rightsNote: command.rightsNote,
      authorizationNonce: command.authorizationNonce,
      authorizedAt: command.authorizedAt,
    })
    if (preparedCreatorStart.start.productionPlanHash !== command.expectedPlanHash) {
      throw new Error('[product-production] 作者核对后的生产 Plan 已变化')
    }
  } else if (command.type === 'authorize-start') {
    if (!Number.isInteger(input.productionId)) {
      throw new Error('[product-production] authorize-start 缺少 productionId')
    }
    const production = await productionInScope(scope, input.productionId!)
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([production.id, command.briefRevision]).first()
    if (!briefRow || briefRow.briefHash !== command.briefHash) {
      throw new Error('[product-production] authorize-start 的 Brief 不存在或 hash 已变化')
    }
    if (briefRow.briefKind !== 'text-open-world-creator-v1') {
      preparedSourcePlan = await parseProductProductionSourcePlanV1(briefRow)
      preparedConfirmedBrief = await createConfirmedProductBriefV1({
        productionKey: production.productionKey,
        briefRow,
        sourcePlan: preparedSourcePlan,
        authorStartRevision: command.expectedStateRevision,
        confirmedAt: input.now,
      })
      await assertFormalProductProductionStartV1({
        sourcePlan: preparedSourcePlan,
        confirmedBrief: preparedConfirmedBrief,
        authorStartRevision: command.expectedStateRevision,
      })
    }
  } else if (command.type === 'authorize-text-open-world-creator-repair') {
    if (!Number.isInteger(input.productionId)) {
      throw new Error('[product-production] Creator repair 缺少 productionId')
    }
    const production = await productionInScope(scope, input.productionId!)
    const build = await db.productBuilds
      .where('[productionId+buildNumber]')
      .equals([production.id, command.baseBuildNumber])
      .first()
    if (!build?.id) throw new Error('[product-production] Creator repair base Build 不存在')
    preparedCreatorRepair = await prepareTextOpenWorldCreatorArtifactRepairV1({
      scope,
      productionId: production.id,
      buildId: build.id,
    })
    if (preparedCreatorRepair.baseBuild.planHash !== command.expectedBasePlanHash
      || preparedCreatorRepair.impactPlan.handoffSetHash !== command.expectedHandoffSetHash
      || preparedCreatorRepair.impactPlan.impactPlanHash !== command.expectedImpactPlanHash
      || preparedCreatorRepair.targetPlanHash !== command.expectedTargetPlanHash) {
      throw new Error('[product-production] Creator repair 预览 Hash 已变化')
    }
    preparedCreatorRepairAuthorization = await createTextOpenWorldCreatorRepairAuthorizationV1({
      prepared: preparedCreatorRepair,
      expectedStateRevision: command.expectedStateRevision,
      authorizationNonce: command.authorizationNonce,
      authorizedAt: command.authorizedAt,
    })
  } else if (command.type === 'authorize-text-open-world-creator-media') {
    const supplied = preparedCreatorMedia
    if (!Number.isInteger(input.productionId) || !supplied) {
      throw new Error('[product-production] Creator media 缺少 productionId 或本地媒资准备结果')
    }
    const production = await productionInScope(scope, input.productionId!)
    preparedCreatorMedia = await prepareTextOpenWorldCreatorMediaV1({
      scope,
      productionId: production.id,
      buildId: supplied.baseBuild.id,
      mode: supplied.mediaPlan.mode,
      maximumCostUsd: supplied.mediaPlan.mode === 'provider-generate'
        ? supplied.mediaPlan.capability.maximumCostUsd
        : undefined,
      provider: supplied.provider,
      imports: supplied.imports.map(item => ({
        artifactKey: item.descriptor.artifactKey,
        slotKey: item.descriptor.slotKey,
        blobObjectId: item.blobObjectId,
        name: item.descriptor.name,
        altText: item.descriptor.altText,
        source: item.descriptor.source,
        license: item.descriptor.license,
        rightsBasis: item.descriptor.rightsBasis,
        rightsNote: item.descriptor.rightsNote,
      })),
    })
    if (preparedCreatorMedia.production.id !== production.id
      || preparedCreatorMedia.production.stateRevision !== command.expectedStateRevision
      || preparedCreatorMedia.baseBuild.buildNumber !== command.baseBuildNumber
      || preparedCreatorMedia.baseBuild.planHash !== command.expectedBasePlanHash
      || preparedCreatorMedia.mediaPlan.planHash !== command.expectedMediaPlanHash
      || preparedCreatorMedia.targetPlanHash !== command.expectedTargetPlanHash
      || preparedCreatorMedia.mediaPlan.mode !== command.mode) {
      throw new Error('[product-production] Creator media 预览 Hash 或本地准备结果已变化')
    }
    preparedCreatorMediaAuthorization = await createTextOpenWorldCreatorMediaAuthorizationV1({
      prepared: preparedCreatorMedia,
      expectedStateRevision: command.expectedStateRevision,
      authorizationNonce: command.authorizationNonce,
      authorizedAt: command.authorizedAt,
    })
  }
  const request = {
    scope,
    productionId: input.productionId,
    command,
    payloadHash,
    preparedBriefHash,
    preparedSourcePlan,
    preparedConfirmedBrief,
    preparedCreatorSource,
    preparedCreatorBrief,
    preparedCreatorEvidence,
    preparedCreatorStart,
    preparedCreatorRepair,
    preparedCreatorRepairAuthorization,
    preparedCreatorMedia,
    preparedCreatorMediaAuthorization,
    preparedWorldReferenceHash,
    emptyHash,
    now,
  }
  let receipt: ProductProductionCommandReceiptV1
  try {
    receipt = await executeTransaction(request)
  } catch (cause) {
    if (!(cause instanceof Dexie.ConstraintError)) throw cause
    // Another connection won a unique command/production claim. Re-read the
    // durable receipt instead of blindly replaying domain mutations.
    receipt = await executeTransaction(request)
  }
  notifyProductionChanged(receipt)
  return receipt
}
