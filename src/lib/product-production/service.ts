import { db } from '../db/schema'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import type {
  ProductBuildRecordV1,
  ProductEvolutionAffectedLaneV1,
  ProductEvolutionBaseV1,
  ProductProductionBriefRecordV1,
  ProductProductionBriefV3,
  ProductProductionCommandRecordV1,
  ProductProductionRecordV1,
  ProductionProductKindV1,
  TextOpenWorldCreatorProductionPreflightConfirmationV1,
  TextOpenWorldCreatorProductionPreflightV1,
  TextOpenWorldCreatorSourceLocatorV1,
  TextOpenWorldSourceRightsBasisV1,
  WorkspaceScope,
  WorldReferenceCatalogEntryV1,
} from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { listWorldReferenceCatalogV1 } from '../product/source'
import { prepareProductProductionAdoption, publishProductProductionBuild } from './adoption'
import {
  executeProductProductionCommand,
  type ProductProductionCommandReceiptV1,
} from './commands'
import {
  inspectProductProductionBuildRecoveryPolicyV1,
  readProductProductionRecoveryTaskKeyV1,
} from './recovery-policy'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from './consultation'
import { parseProductProductionBriefV3 } from './contracts'
import {
  inspectConfiguredTextCapabilityV1,
  resolveConfiguredTextCapabilityV1,
  type ConfiguredTextCapabilityReadinessV1,
} from './capabilities'
import {
  createBuiltInProductionCapabilityBindingV1,
  createConfiguredProductProductionExecutorV1,
} from './production-executor'
import { createTextOpenWorldProductionExecutorV1 } from '../open-world/production-executor'
import {
  createTextOpenWorldCreatorStartPreparationV1,
  readTextOpenWorldCreatorExecutionBriefV1,
  type TextOpenWorldCreatorStartPreparationV1,
} from '../open-world/creator-production-start'
import { verifyTextOpenWorldCreatorProductionPreflightConfirmationV1 } from '../open-world/creator-production-preflight'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  assertProductProductionBudgetLedgerV1,
  projectProductProductionSchedulerV1,
  runProductProductionUntilBlockedV1,
  type ProductProductionCapabilityBindingV1,
  type ProductProductionSchedulerProjectionV1,
} from './scheduler'
import { createProductRuntimeInstanceFromSource } from '../product/runtime-instances'
import {
  listProductMediaProviderCapabilitiesV1,
  type ProductMediaProviderCapabilityV1,
} from './media-adapters'
import {
  configuredMediaRelayUrlV1,
  inspectConfiguredAgnesImageCapabilityV1,
  inspectTrustedRelayMediaConfigurationV1,
  resolveConfiguredAgnesImageCapabilityV1,
  resolveTrustedRelayMediaCapabilityV1,
  type ConfiguredAgnesImageReadinessV1,
  type ResolvedProductMediaCapabilityV1,
} from './media-transport'

export interface ProductProductionDetailsV1 {
  production: ProductProductionRecordV1
  brief: ProductProductionBriefRecordV1 | null
  /** Frozen scheduler/runtime envelope. Creator rows retain their own author
   * Brief in `briefJson`; this projection is available only after start. */
  executionBrief: ProductProductionBriefV3 | null
  build: ProductBuildRecordV1 | null
  artifactCount: number
  recentCommands: ProductProductionCommandRecordV1[]
  briefHistory: ProductProductionBriefRecordV1[]
  buildHistory: ProductBuildRecordV1[]
}

export type ProductProductionProgressV1 = ProductProductionSchedulerProjectionV1

/** Author-only inspection of evidence already bound to the current Build task. */
export async function readProductProductionTaskEvidenceV1(input: {
  scope: WorkspaceScope
  productionId: number
  taskKey: string
}): Promise<Array<{ attempt: number; kind: string; content: string }>> {
  const scope = await resolveScope({ scope: input.scope })
  const progress = await projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  const task = progress.tasks.find(item => item.taskKey === input.taskKey)
  if (!task?.runId) return []
  const snapshot = await readAgentRunV1(scope, task.runId)
  const boundary = snapshot.contract.scope.productProduction
  if (snapshot.run.productBuildId !== progress.buildId
    || snapshot.run.parentRunId !== progress.rootRunId
    || snapshot.run.parentRelation !== `task:${input.taskKey}`
    || !boundary
    || boundary.productBuildId !== progress.buildId
    || boundary.controlEpoch !== progress.controlEpoch
    || boundary.planHash !== progress.planHash
    || boundary.taskKey !== input.taskKey) {
    throw new Error('任务证据不属于当前 Build/task Run')
  }
  const isCurrentGovernedAttempt = (stepId: string | undefined, attempt: number | undefined) => {
    if (stepId == null || attempt == null) return false
    const step = snapshot.projection.steps[stepId]
    if (!step || step.attempt !== attempt) return false
    if (stepId === input.taskKey) return true
    return input.taskKey === 'p1.source-curation'
      && stepId.startsWith(`${input.taskKey}.world.source-curation.batch.`)
      && ['succeeded', 'failed'].includes(step.status)
  }
  const result: Array<{ attempt: number; kind: string; content: string }> = []
  for (const event of snapshot.events) {
    if (event.type === 'evidence.artifact.recorded'
      && isCurrentGovernedAttempt(event.payload.stepId, event.payload.attempt)
      && ['raw-response', 'source-snapshot', 'tool-result'].includes(event.payload.artifactKind)) {
      const content = await readAgentRunArtifactExactV1({
        projectId: scope.projectId, artifactKind: event.payload.artifactKind,
        contentHash: event.payload.contentHash,
      })
      result.push({ attempt: event.payload.attempt ?? 0, kind: event.payload.artifactKind, content })
    }
    if (event.type === 'step.failed'
      && isCurrentGovernedAttempt(event.payload.stepId, event.payload.attempt)) {
      result.push({ attempt: event.payload.attempt, kind: 'failure', content: event.payload.code })
    }
  }
  return result
}

export interface ProductProductionCapabilityReadinessV1 {
  text: ConfiguredTextCapabilityReadinessV1
  image: ConfiguredAgnesImageReadinessV1
  mediaRelayConfigured: boolean
  mediaRelayReady: boolean
  mediaRelayOrigin: string | null
  mediaRelayIssue: string | null
}

export interface ProductProductionAuthorizationReadinessV1 {
  ready: boolean
  blockerCode: 'capability-unbound' | null
  blockerMessages: string[]
  requiredMediaRequirementKeys: string[]
}

/** Safe preflight only; never returns a provider credential or performs a call. */
export function inspectProductProductionCapabilityReadinessV1(input: {
  projectId: number
}): ProductProductionCapabilityReadinessV1 {
  const relay = inspectTrustedRelayMediaConfigurationV1()
  return {
    text: inspectConfiguredTextCapabilityV1({
      projectId: input.projectId,
      category: 'product-production',
    }),
    image: inspectConfiguredAgnesImageCapabilityV1({ projectId: input.projectId }),
    mediaRelayConfigured: relay.configured,
    mediaRelayReady: relay.ready,
    mediaRelayOrigin: relay.relayOrigin,
    mediaRelayIssue: relay.issue,
  }
}

/**
 * Pure authorization gate shared by service and UI. A Brief may be drafted
 * while capabilities are unavailable, but no Build is created until every
 * capability required by that frozen Brief is bound.
 */
export function evaluateProductProductionAuthorizationReadinessV1(input: {
  brief: Pick<ProductProductionBriefV3, 'capabilityRequirements'>
  readiness: ProductProductionCapabilityReadinessV1
}): ProductProductionAuthorizationReadinessV1 {
  const blockerMessages: string[] = []
  if (!input.readiness.text.ready) {
    blockerMessages.push(input.readiness.text.issue || '设置中的文本生成能力尚未就绪。')
  }
  const requiredMediaRequirementKeys = input.brief.capabilityRequirements
    .filter(requirement => requirement.required && ['image', 'music', 'sfx'].includes(requirement.mediaClass))
    .map(requirement => requirement.requirementKey)
  const requiresImage = input.brief.capabilityRequirements
    .some(requirement => requirement.required && requirement.mediaClass === 'image')
  const requiresAudio = input.brief.capabilityRequirements
    .some(requirement => requirement.required && ['music', 'sfx'].includes(requirement.mediaClass))
  if (requiresImage && !input.readiness.image.ready && !input.readiness.mediaRelayReady) {
    blockerMessages.push(input.readiness.image.issue || '全局 Agnes 图片能力尚未就绪。')
  }
  if (requiresAudio && !input.readiness.mediaRelayReady) {
    blockerMessages.push(input.readiness.mediaRelayIssue || '商业音乐与音效可信中继尚未绑定。')
  }
  return {
    ready: blockerMessages.length === 0,
    blockerCode: blockerMessages.length === 0 ? null : 'capability-unbound',
    blockerMessages,
    requiredMediaRequirementKeys,
  }
}

/**
 * Read-only provider catalog for capability selection and blocker UI. Listing
 * it never resolves credentials or makes a provider request.
 */
export function listProductProductionMediaCapabilitiesV1(): ProductMediaProviderCapabilityV1[] {
  return listProductMediaProviderCapabilitiesV1()
}

function commandId(prefix: string): string {
  return `${prefix}.${crypto.randomUUID()}`
}

export interface TextOpenWorldCreatorStartInputV1 {
  scope: WorkspaceScope
  productionId: number
  briefRevision: number
  briefHash: string
  expectedStateRevision: number
  sourceLocator: TextOpenWorldCreatorSourceLocatorV1
  preflight: TextOpenWorldCreatorProductionPreflightV1
  confirmation: TextOpenWorldCreatorProductionPreflightConfirmationV1
  rightsBasis: TextOpenWorldSourceRightsBasisV1
  rightsNote: string
  authorizationNonce: string
  authorizedAt: number
}

/** Zero-write deterministic plan preview shown before the author starts. */
export async function previewTextOpenWorldCreatorProductionStartV1(
  input: TextOpenWorldCreatorStartInputV1,
): Promise<TextOpenWorldCreatorStartPreparationV1> {
  const state = useAIConfigStore.getState()
  return createTextOpenWorldCreatorStartPreparationV1({
    ...input,
    aiConfig: state.config,
    rememberApiKey: state.rememberApiKey,
  })
}

/** Repeats the full CAS and atomically freezes SourcePlan/Start/Plan/Build. */
export async function authorizeTextOpenWorldCreatorProductionStartV1(
  input: TextOpenWorldCreatorStartInputV1 & { expectedPlanHash: string },
): Promise<ProductProductionCommandReceiptV1> {
  const receipt = await executeProductProductionCommand({
    scope: input.scope,
    productionId: input.productionId,
    now: input.authorizedAt,
    command: {
      type: 'authorize-text-open-world-creator-start',
      commandId: 'text-open-world.start.' + input.confirmation.confirmationHash.slice(0, 16)
        + '.' + input.expectedPlanHash.slice(0, 12),
      expectedStateRevision: input.expectedStateRevision,
      briefRevision: input.briefRevision,
      briefHash: input.briefHash,
      sourceLocator: input.sourceLocator,
      preflight: input.preflight,
      confirmation: input.confirmation,
      rightsBasis: input.rightsBasis,
      rightsNote: input.rightsNote,
      authorizationNonce: input.authorizationNonce,
      expectedPlanHash: input.expectedPlanHash,
      authorizedAt: input.authorizedAt,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '文字开放世界启动失败'))
  return receipt
}

export async function listProductProductionWorkspaceV1(
  scopeInput: WorkspaceScope,
  allowedProducts: readonly ProductionProductKindV1[],
): Promise<{
  worldReleases: WorldReferenceCatalogEntryV1[]
  productions: ProductProductionRecordV1[]
}> {
  const scope = await resolveScope({ scope: scopeInput })
  const [worldReleases, rows] = await Promise.all([
    listWorldReferenceCatalogV1(scope),
    db.productProductions.where('workId').equals(scope.workId).toArray(),
  ])
  const productions: ProductProductionRecordV1[] = []
  for (const row of rows) {
    if (allowedProducts.includes(row.productType)
      && await assertRecordInScope(scope, 'productProductions', row, { owner: 'work' })) productions.push(row)
  }
  worldReleases.sort((left, right) => (
    right.reference.releaseVersion - left.reference.releaseVersion || right.createdAt - left.createdAt
  ))
  productions.sort((left, right) => right.updatedAt - left.updatedAt)
  return { worldReleases, productions }
}

export async function readProductProductionDetailsV1(
  scopeInput: WorkspaceScope,
  productionId: number,
  allowedProducts?: readonly ProductionProductKindV1[],
): Promise<ProductProductionDetailsV1> {
  const scope = await resolveScope({ scope: scopeInput })
  const production = await db.productProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[product-production-service] Production 不存在或跨 Work')
  }
  if (allowedProducts && !allowedProducts.includes(production.productType)) {
    throw new Error('[product-production-service] Production 不属于当前产品入口')
  }
  const [brief, build, commandRows, briefRows, buildRows] = await Promise.all([
    production.currentBriefRevision == null ? null : db.productProductionBriefs
      .where('[productionId+revision]').equals([productionId, production.currentBriefRevision]).first(),
    production.currentBuildNumber == null ? null : db.productBuilds
      .where('[productionId+buildNumber]').equals([productionId, production.currentBuildNumber]).first(),
    db.productProductionCommands.where('productionId').equals(productionId).toArray(),
    db.productProductionBriefs.where('productionId').equals(productionId).toArray(),
    db.productBuilds.where('productionId').equals(productionId).toArray(),
  ])
  if (brief && !await assertRecordInScope(scope, 'productProductionBriefs', brief, { owner: 'work' })) {
    throw new Error('[product-production-service] Brief 跨 Work')
  }
  if (build && !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
    throw new Error('[product-production-service] Build 跨 Work')
  }
  const recentCommands: ProductProductionCommandRecordV1[] = []
  for (const command of commandRows
    .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
    .slice(0, 8)) {
    if (!await assertRecordInScope(scope, 'productProductionCommands', command, { owner: 'work' })) {
      throw new Error('[product-production-service] Command 跨 Work')
    }
    recentCommands.push(command)
  }
  const briefHistory: ProductProductionBriefRecordV1[] = []
  for (const row of briefRows.sort((left, right) => right.revision - left.revision)) {
    if (!await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' })) {
      throw new Error('[product-production-service] Brief history 跨 Work')
    }
    briefHistory.push(row)
  }
  const buildHistory: ProductBuildRecordV1[] = []
  for (const row of buildRows.sort((left, right) => right.buildNumber - left.buildNumber)) {
    if (!await assertRecordInScope(scope, 'productBuilds', row, { owner: 'work' })) {
      throw new Error('[product-production-service] Build history 跨 Work')
    }
    buildHistory.push(row)
  }
  const executionBrief = brief?.briefKind === 'text-open-world-creator-v1'
    ? brief.status === 'authorized' && build
      ? (await readTextOpenWorldCreatorExecutionBriefV1({
          briefRow: brief,
          planJson: build.planJson,
        })).executionBrief
      : null
    : brief ? parseProductProductionBriefV3(brief.briefJson) : null
  return {
    production,
    brief: brief ?? null,
    executionBrief,
    build: build ?? null,
    artifactCount: build?.id == null ? 0 : await db.productBuildArtifacts.where('buildId').equals(build.id).count(),
    recentCommands,
    briefHistory,
    buildHistory,
  }
}

export async function consultProductProductionStartV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}) {
  return suggestProductStartingPoints(input)
}

export async function compileProductProductionBriefV3(
  input: Parameters<typeof draftProductProductionBriefV3>[0],
) {
  return draftProductProductionBriefV3(input)
}

export async function createProductProductionWithBriefV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  title: string
  brief: ProductProductionBriefV3
}): Promise<number> {
  const title = input.title.trim()
  if (!title) throw new Error('[product-production-service] 游戏标题不能为空')
  const productionKey = `productprod.${Date.now().toString(36)}.${crypto.randomUUID().slice(0, 8)}`
  const created = await executeProductProductionCommand({
    scope: input.scope,
    command: {
      type: 'create-intent', commandId: commandId('intent'), productionKey,
      productType: input.brief.intent.productType,
      worldReleaseId: input.worldReleaseId, userText: title,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: input.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: commandId('brief'), expectedStateRevision: 0,
      parentRevision: null, brief: input.brief,
    },
  })
  if (!saved.ok) throw new Error(String(saved.result.message ?? saved.errorCode ?? 'Brief 保存失败'))
  return created.productionId
}

export async function authorizeProductProductionStartV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
}): Promise<void> {
  const brief = input.details.brief
  if (!brief) throw new Error('[product-production-service] 缺少当前 Brief')
  const parsedBrief = parseProductProductionBriefV3(brief.briefJson)
  const readiness = evaluateProductProductionAuthorizationReadinessV1({
    brief: parsedBrief,
    readiness: inspectProductProductionCapabilityReadinessV1({ projectId: input.scope.projectId }),
  })
  if (!readiness.ready) {
    throw new Error(`[product-production-service] capability-unbound: ${readiness.blockerMessages.join('；')}`)
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.details.production.id!,
    command: {
      type: 'authorize-start', commandId: commandId('authorize'),
      expectedStateRevision: input.details.production.stateRevision,
      briefRevision: brief.revision, briefHash: brief.briefHash,
      authorizationNonce: `author.${crypto.randomUUID()}`,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '授权失败'))
}

export async function setProductProductionPausedV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
  build?: ProductBuildRecordV1 | null
  pausedReservationDisposition?: 'confirmed-not-charged' | 'charge-reservation-upper-bound'
}): Promise<'paused' | 'resumed'> {
  const paused = input.production.status === 'paused'
  let pausedReservationDispositions: Extract<
    import('../types').ProductProductionCommandV1,
    { type: 'resume' }
  >['pausedReservationDispositions']
  if (paused && input.build?.status === 'paused') {
    let failure: Record<string, unknown>
    try {
      const parsed = JSON.parse(input.build.failureJson) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      failure = parsed as Record<string, unknown>
    } catch {
      throw new Error('[product-production-service] 暂停恢复证据损坏')
    }
    if (failure!.code !== 'pause-provider-result-unknown') {
      if (input.pausedReservationDisposition) {
        throw new Error('[product-production-service] 普通暂停没有待结算 provider reservation')
      }
    } else if (!Array.isArray(failure!.pausedProviderReservations)
      || failure!.pausedProviderReservations.length < 1) {
      throw new Error('[product-production-service] 暂停 reservation 证据损坏')
    } else {
      assertProductProductionBudgetLedgerV1(input.build.budgetLedgerJson)
      const ledger = input.build.budgetLedgerJson === '{}' || !input.build.budgetLedgerJson.trim()
        ? {
            version: 2,
            charges: {} as Record<string, unknown>,
            reservations: {} as Record<string, unknown>,
          }
        : JSON.parse(input.build.budgetLedgerJson) as {
            version: number
            charges?: Record<string, unknown>
            reservations?: Record<string, unknown>
          }
      const currentReservations = ledger.version === 2 && ledger.reservations
        ? ledger.reservations
        : {}
      const currentCharges = ledger.version === 2 && ledger.charges
        ? ledger.charges
        : {}
      const unresolved = (failure!.pausedProviderReservations as unknown[]).flatMap((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 损坏`)
        }
        const reservation = value as Record<string, unknown>
        if (typeof reservation.taskKey !== 'string'
          || !Number.isSafeInteger(reservation.runId) || Number(reservation.runId) < 1
          || !Number.isSafeInteger(reservation.attempt) || Number(reservation.attempt) < 1
          || !Number.isSafeInteger(reservation.controlEpoch) || Number(reservation.controlEpoch) < 0) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 身份损坏`)
        }
        const attemptKey = `${Number(reservation.runId)}:${Number(reservation.attempt)}`
        const pending = currentReservations[attemptKey]
        const closed = currentCharges[attemptKey]
        if (pending != null && closed != null) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 重复封账`)
        }
        const current = pending ?? closed
        if (current == null) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 缺少精确封账证据`)
        }
        if (typeof current !== 'object' || Array.isArray(current)) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 当前账本损坏`)
        }
        const row = current as Record<string, unknown>
        if (row.taskKey !== reservation.taskKey
          || row.runId !== reservation.runId
          || row.attempt !== reservation.attempt
          || row.controlEpoch !== reservation.controlEpoch) {
          throw new Error(`[product-production-service] 暂停 reservation #${index + 1} 与当前账本不一致`)
        }
        return pending == null ? [] : [{
          taskKey: reservation.taskKey,
          runId: Number(reservation.runId),
          attempt: Number(reservation.attempt),
          controlEpoch: Number(reservation.controlEpoch),
        }]
      })
      if (unresolved.length > 0 && !input.pausedReservationDisposition) {
        throw new Error('[product-production-service] 恢复前请先结算暂停时仍在途的供应商请求')
      }
      pausedReservationDispositions = unresolved.length > 0
        ? unresolved.map(reservation => ({
            ...reservation,
            disposition: input.pausedReservationDisposition!,
          }))
        : undefined
    }
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.production.id!,
    command: paused
      ? {
          type: 'resume',
          commandId: commandId('resume'),
          expectedStateRevision: input.production.stateRevision,
          ...(pausedReservationDispositions ? { pausedReservationDispositions } : {}),
        }
      : {
          type: 'pause', commandId: commandId('pause'), expectedStateRevision: input.production.stateRevision,
          reason: '作者从制作工作台暂停',
        },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '状态切换失败'))
  return paused ? 'resumed' : 'paused'
}

export async function stopProductProductionV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
}): Promise<void> {
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.production.id!,
    command: {
      type: 'stop', commandId: commandId('stop'), expectedStateRevision: input.production.stateRevision,
      retention: 'keep-build',
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '停止失败'))
}

export async function archiveProductProductionV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
}): Promise<void> {
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.production.id!,
    command: {
      type: 'archive', commandId: commandId('archive'),
      expectedStateRevision: input.production.stateRevision,
      reason: '作者从版本页归档 Production；保留 Build、Release、receipt 与存档引用',
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '归档失败'))
}

export async function restoreArchivedProductProductionV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
}): Promise<void> {
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.production.id!,
    command: {
      type: 'restore', commandId: commandId('restore'),
      expectedStateRevision: input.production.stateRevision,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '恢复归档失败'))
}

export async function retryProductProductionBlockerV1(input: {
  scope: WorkspaceScope
  details: ProductProductionDetailsV1
  afterCapabilityChange?: boolean
  repairNote?: string
  authorDraftJson?: string
  unknownResultDisposition?: 'confirmed-not-charged' | 'charge-reservation-upper-bound'
}): Promise<
  | 'provider-actual-charge'
  | 'author-confirmed-not-charged'
  | 'author-charged-reservation-upper-bound'
  | null
> {
  if (!input.details.build || input.details.build.status !== 'recovery-required') {
    throw new Error('[product-production-service] 当前 Build 没有可重试 blocker')
  }
  const taskKey = readProductProductionRecoveryTaskKeyV1(input.details.build.failureJson)
  const blockerKey = taskKey ?? 'build-recovery'
  const repairNote = input.repairNote?.trim() || undefined
  const authorDraftJson = input.authorDraftJson?.trim() || undefined
  if (repairNote || authorDraftJson) {
    if (!taskKey) throw new Error('[product-production-service] 当前 blocker 不支持作者引导修复')
    const policy = inspectProductProductionBuildRecoveryPolicyV1({
      productType: input.details.production.productType,
      planJson: input.details.build.planJson,
      taskKey,
    })
    if (repairNote && !policy.repairNoteAllowed) {
      throw new Error('[product-production-service] 当前任务不支持作者修复要求')
    }
    if (authorDraftJson && !policy.authorDraftAllowed) {
      throw new Error('[product-production-service] 当前任务不支持作者完整 JSON 修订')
    }
  }
  let unknownResultReservation: {
    runId: number
    attempt: number
    controlEpoch: number
    disposition: 'confirmed-not-charged' | 'charge-reservation-upper-bound'
  } | undefined
  let failure: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(input.details.build.failureJson) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      failure = parsed as Record<string, unknown>
    }
  } catch { /* command boundary will reject corrupt failure evidence */ }
  const providerReservationFailure = failure.code === 'unknown-result'
    || failure.code === 'provider-response-uncheckpointed'
  if (providerReservationFailure) {
    if (!input.unknownResultDisposition) {
      throw new Error(failure.code === 'provider-response-uncheckpointed'
        ? '[product-production-service] 已收到供应商响应证据；请按冻结预留上限封账后重试'
        : '[product-production-service] 结果未知；请先确认供应商是否计费')
    }
    if (failure.code === 'provider-response-uncheckpointed'
      && input.unknownResultDisposition !== 'charge-reservation-upper-bound') {
      throw new Error('[product-production-service] 已收到供应商响应证据，不能声明为未计费')
    }
    const provenance = failure.failureProvenance != null
      && typeof failure.failureProvenance === 'object'
      && !Array.isArray(failure.failureProvenance)
      ? failure.failureProvenance as Record<string, unknown>
      : null
    if (!provenance
      || !Number.isSafeInteger(provenance.runId) || Number(provenance.runId) < 1
      || !Number.isSafeInteger(provenance.attempt) || Number(provenance.attempt) < 1
      || !Number.isSafeInteger(provenance.controlEpoch) || Number(provenance.controlEpoch) < 0) {
      throw new Error('[product-production-service] unknown-result 缺少可核对的 Run/attempt/epoch')
    }
    unknownResultReservation = {
      runId: Number(provenance.runId),
      attempt: Number(provenance.attempt),
      controlEpoch: Number(provenance.controlEpoch),
      disposition: input.unknownResultDisposition,
    }
  } else if (input.unknownResultDisposition) {
    throw new Error('[product-production-service] 当前 blocker 不存在待结算 provider reservation')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.details.production.id!,
    command: {
      type: 'resolve-blocker', commandId: commandId('resolve-blocker'),
      expectedStateRevision: input.details.production.stateRevision, blockerKey,
      resolution: {
        action: authorDraftJson ? 'author-edit' : input.afterCapabilityChange ? 'change-capability' : 'retry',
        ...(authorDraftJson ? { authorDraftJson } : {}),
        ...(unknownResultReservation ? { unknownResultReservation } : {}),
        note: repairNote || (input.afterCapabilityChange ? '作者已调整全局能力配置并要求重试' : '作者从制作工作台要求重试'),
      },
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? 'blocker 重试失败'))
  const accounting = receipt.result.unknownResultAccounting
  if (accounting == null) return null
  if (!accounting || typeof accounting !== 'object' || Array.isArray(accounting)) {
    throw new Error('[product-production-service] unknown-result 结算回执损坏')
  }
  const effectiveDisposition = (accounting as Record<string, unknown>).effectiveDisposition
  if (effectiveDisposition !== 'provider-actual-charge'
    && effectiveDisposition !== 'author-confirmed-not-charged'
    && effectiveDisposition !== 'author-charged-reservation-upper-bound') {
    throw new Error('[product-production-service] unknown-result 结算回执缺少有效处置')
  }
  return effectiveDisposition
}

export async function readProductProductionProgressV1(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<ProductProductionSchedulerProjectionV1> {
  return projectProductProductionSchedulerV1(input)
}

/**
 * Formal production entry. It reuses the existing global/task-routed AI
 * configuration and only freezes non-secret provider identity in the Build.
 * No production-scoped API key form or secret copy is allowed here.
 */
export async function runAuthorizedProductProductionV1(input: {
  scope: WorkspaceScope
  productionId: number
  signal?: AbortSignal
  onProgress?: (projection: ProductProductionSchedulerProjectionV1) => void | Promise<void>
}): Promise<ProductProductionSchedulerProjectionV1> {
  const scope = await resolveScope({ scope: input.scope })
  const details = await readProductProductionDetailsV1(scope, input.productionId)
  if (!details.brief || !details.build) throw new Error('[product-production-service] Production 尚未授权 Build')
  if (!['producing', 'preview-ready'].includes(details.production.status)) {
    throw new Error(`[product-production-service] Production 状态 ${details.production.status} 不允许自动制作`)
  }
  if (['preview-ready', 'release-ready', 'released'].includes(details.build.status)) {
    return projectProductProductionSchedulerV1({ scope, productionId: input.productionId })
  }
  const creatorContracts = details.brief.briefKind === 'text-open-world-creator-v1'
    ? await readTextOpenWorldCreatorExecutionBriefV1({
        briefRow: details.brief,
        planJson: details.build.planJson,
      })
    : null
  if (creatorContracts) {
    // Creator authorization freezes the complete non-secret route identity,
    // pricing and generation settings. Re-prove it before every run/resume;
    // resolving a fresh capability receipt alone would otherwise silently
    // authorize whatever route happens to be configured now.
    const aiState = useAIConfigStore.getState()
    const confirmation = await verifyTextOpenWorldCreatorProductionPreflightConfirmationV1({
      brief: creatorContracts.creatorBrief,
      preflight: creatorContracts.start.preflight,
      confirmation: creatorContracts.start.confirmation,
      projectId: scope.projectId,
      aiConfig: aiState.config,
      rememberApiKey: aiState.rememberApiKey,
    })
    if (confirmation.confirmationHash !== creatorContracts.start.confirmation.confirmationHash) {
      throw new Error('[product-production-service] Creator 模型授权已变化，请重新检查并确认生产')
    }
  }
  const brief = creatorContracts?.executionBrief
    ?? parseProductProductionBriefV3(details.brief.briefJson)
  const textRequirements = brief.capabilityRequirements.filter(requirement => requirement.mediaClass === 'text')
  if (textRequirements.length !== 1) throw new Error('[product-production-service] 正式制作需要唯一文本 capability requirement')
  const textCapability = await resolveConfiguredTextCapabilityV1({
    projectId: scope.projectId, category: 'product-production', requirementKey: textRequirements[0].requirementKey,
    ...(creatorContracts ? {
      expectedProviderIdentity: {
        provider: creatorContracts.start.preflight.providerBinding.provider,
        model: creatorContracts.start.preflight.providerBinding.model,
        endpointOrigin: creatorContracts.start.preflight.providerBinding.endpointOrigin,
        endpointRouteHash: creatorContracts.start.preflight.providerBinding.endpointRouteHash,
        temperature: creatorContracts.start.preflight.providerBinding.temperature,
        configuredMaxTokens: creatorContracts.start.preflight.providerBinding.maxTokens,
        contextWindow: creatorContracts.start.preflight.providerBinding.contextWindow,
      },
    } : {}),
  })
  const capabilityBindings: ProductProductionCapabilityBindingV1[] = [{
    requirementKey: textRequirements[0].requirementKey,
    adapterId: textCapability.receipt.adapterId,
    bindingHash: textCapability.receipt.capabilityHash,
  }]
  const mediaCapabilities = new Map<string, ResolvedProductMediaCapabilityV1>()
  const relayUrl = configuredMediaRelayUrlV1()
  const agnesImageReadiness = inspectConfiguredAgnesImageCapabilityV1({ projectId: scope.projectId })
  const useExternalMedia = brief.qualityProfile !== 'prototype'
  for (const requirement of brief.capabilityRequirements) {
    if (!['image', 'music', 'sfx'].includes(requirement.mediaClass)) continue
    if (requirement.mediaClass === 'image' && useExternalMedia && agnesImageReadiness.ready) {
      const resolved = await resolveConfiguredAgnesImageCapabilityV1({
        projectId: scope.projectId, requirement,
      })
      mediaCapabilities.set(requirement.requirementKey, resolved)
      capabilityBindings.push(resolved.binding)
    } else if (useExternalMedia && relayUrl != null) {
      const resolved = await resolveTrustedRelayMediaCapabilityV1({ requirement, relayUrl })
      mediaCapabilities.set(requirement.requirementKey, resolved)
      capabilityBindings.push(resolved.binding)
    } else if (brief.qualityProfile === 'commercial-candidate') {
      throw new Error(`[product-production-service] capability-unbound: ${requirement.mediaClass === 'image'
        ? agnesImageReadiness.issue || '全局 Agnes 图片能力尚未就绪。'
        : '商业音乐与音效可信中继尚未绑定。'}`)
    } else if (requirement.mediaClass === 'image') {
      capabilityBindings.push(await createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-svg.v1',
      }))
    } else {
      capabilityBindings.push(await createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-audio.v1',
      }))
    }
  }
  const executor = brief.intent.productType === 'text-open-world'
    ? createTextOpenWorldProductionExecutorV1({
      production: details.production, brief, mediaCapabilities,
      textCapabilityReceipt: textCapability.receipt,
    })
    : createConfiguredProductProductionExecutorV1({
      production: details.production, brief, mediaCapabilities,
    })
  const projection = await runProductProductionUntilBlockedV1({
    scope, productionId: input.productionId, executor, capabilityBindings, signal: input.signal,
    async onDurableBoundary() {
      if (input.onProgress) await input.onProgress(await projectProductProductionSchedulerV1({
        scope, productionId: input.productionId,
      }))
    },
  })
  if (input.onProgress) await input.onProgress(projection)
  if (projection.buildStatus === 'failed' || projection.buildStatus === 'recovery-required') {
    const build = await db.productBuilds.get(projection.buildId)
    let detail = ''
    try {
      const failure = JSON.parse(build?.failureJson ?? '{}') as { detail?: unknown; taskKey?: unknown }
      detail = typeof failure.detail === 'string'
        ? `${typeof failure.taskKey === 'string' ? `${failure.taskKey}: ` : ''}${failure.detail}` : ''
    } catch { /* corrupted failureJson is reported by the status fallback */ }
    throw new Error(detail || `自动制作停在 ${projection.buildStatus}，请查看任务阻塞信息。`)
  }
  return projection
}

export async function publishProductProductionV1(input: {
  scope: WorkspaceScope
  productionId: number
}) {
  const prepared = await prepareProductProductionAdoption(input)
  const receipt = await publishProductProductionBuild({
    ...input,
    command: {
      type: 'publish', commandId: commandId('publish'),
      expectedStateRevision: prepared.intent.expectedStateRevision,
      buildNumber: prepared.intent.buildNumber,
      expectedManifestHash: prepared.intent.manifestHash,
      adoptionIntentHash: prepared.adoptionIntentHash,
    },
  })
  return { prepared, receipt }
}

/**
 * Starts a real player session from the immutable Build Preview. The author
 * command proves that opening the preview was user-triggered; the session is
 * bound to the exact preview hash and never requires publishing first.
 */
export async function startProductProductionPreviewV1(input: {
  scope: WorkspaceScope
  productionId: number
  worldGroupId?: number | null
}): Promise<{ sessionId: number; productType: ProductProductionBriefV3['intent']['productType'] }> {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId)
  if (!details.brief || !details.build || !details.build.previewHash) {
    throw new Error('[product-production-service] 当前 Production 尚无可验证 Build Preview')
  }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: details.production.id!,
    command: {
      type: 'request-preview', commandId: commandId('preview'),
      expectedStateRevision: details.production.stateRevision,
      buildNumber: details.build.buildNumber,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? 'Preview 请求失败'))
  const previewHash = typeof receipt.result.previewHash === 'string' ? receipt.result.previewHash : ''
  if (previewHash !== details.build.previewHash) {
    throw new Error('[product-production-service] Preview command 返回的 hash 已过期')
  }
  const brief = details.executionBrief
  if (!brief) throw new Error('[product-production-service] 当前 Build 缺少可验证执行 Brief')
  const session = await createProductRuntimeInstanceFromSource({
    scope: input.scope,
    source: { kind: 'build', productBuildId: details.build.id!, expectedPreviewHash: previewHash },
    title: `${details.production.title} · Build #${details.build.buildNumber} 预览`,
    worldGroupId: input.worldGroupId ?? null,
  })
  return { sessionId: session.id!, productType: brief.intent.productType }
}

/** Creates the next reviewable Brief from an explicit author evolution goal. */
export async function beginProductProductionEvolutionV1(input: {
  scope: WorkspaceScope
  productionId: number
  userText: string
  affectedLanes?: ProductEvolutionAffectedLaneV1[]
}): Promise<{ briefRevision: number }> {
  const userText = input.userText.trim()
  if (!userText) throw new Error('[product-production-service] 请先填写本轮演化目标')
  const scope = await resolveScope({ scope: input.scope })
  const affectedLanes = [...new Set(input.affectedLanes ?? ['content', 'product', 'visual', 'audio'])]
  if (!affectedLanes.length) throw new Error('[product-production-service] 演化至少影响一个生产 lane')
  if (affectedLanes.includes('world-source')) {
    throw new Error('[product-production-service] 世界来源升级必须先选择并确认新的 WorldRelease，不能在普通演化中静默替换')
  }
  const details = await readProductProductionDetailsV1(scope, input.productionId)
  if (!details.build) throw new Error('[product-production-service] 演化需要一个可验证的 Preview 或 Release 基线')
  let base: ProductEvolutionBaseV1
  if (details.production.status === 'released' && details.production.currentProductReleaseId != null) {
    const release = await db.productReleases.get(details.production.currentProductReleaseId)
    if (!release || !await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) {
      throw new Error('[product-production-service] 当前 ProductRelease 基线缺失或跨 Work')
    }
    base = { kind: 'release', productReleaseId: release.id!, contentHash: release.contentHash }
  } else {
    if (!['preview-ready', 'release-ready', 'released'].includes(details.build.status) || !details.build.manifestHash) {
      throw new Error('[product-production-service] 当前 Build 尚不能作为演化基线')
    }
    base = {
      kind: 'build', buildNumber: details.build.buildNumber, manifestHash: details.build.manifestHash,
    }
  }
  const receipt = await executeProductProductionCommand({
    scope, productionId: details.production.id!,
    command: {
      type: 'evolve', commandId: commandId('evolve'),
      expectedStateRevision: details.production.stateRevision, base, userText, affectedLanes,
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '演化 Brief 创建失败'))
  const briefRevision = receipt.result.briefRevision
  if (typeof briefRevision !== 'number') throw new Error('[product-production-service] 演化命令未返回 Brief revision')
  return { briefRevision }
}
