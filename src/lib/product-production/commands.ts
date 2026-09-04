import Dexie from 'dexie'
import { db } from '../db/schema'
import type {
  ConfirmedProductBriefV1,
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductProductionCommandV1,
  ProductProductionRecordV1,
  ProductSourcePlanV1,
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

function safeJson(value: unknown): string {
  const json = canonicalProductProductionJsonV2(value)
  if (json.length > 100_000) throw new Error('[product-production] command result 超出安全上限')
  return json
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
  emptyHash: string
  now: number
}): Promise<{ production: ProductProductionRecordV1 & { id: number }; result: Record<string, unknown> }> {
  const { scope, command, now } = input
  let production = input.production

  if (command.type !== 'create-intent' && command.expectedStateRevision !== production.stateRevision) {
    reject('production-state-conflict', `Production revision 已从 ${command.expectedStateRevision} 变为 ${production.stateRevision}`)
  }

  if (command.type === 'create-intent') {
    if (command.productType !== production.productType) {
      reject('production-state-conflict', 'productionKey 已绑定其他产品，不能跨产品复用')
    }
    return { production, result: { status: production.status, productType: production.productType, created: production.createdAt === now } }
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

  if (command.type === 'authorize-start') {
    if (production.currentBriefRevision !== command.briefRevision || production.status !== 'brief-ready') {
      reject('brief-not-authorized', '当前 Production 没有待授权的 Brief')
    }
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([production.id, command.briefRevision]).first()
    if (!briefRow || briefRow.status !== 'draft' || briefRow.briefHash !== command.briefHash) {
      reject('brief-not-authorized', 'Brief revision/hash/status 不一致')
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

  if (command.type === 'pause') {
    if (!['producing', 'preview-ready'].includes(production.status)) reject('invalid-state-transition', '当前 Production 不能暂停')
    const build = await currentBuild(production)
    if (['released', 'cancelled', 'failed', 'archived', 'paused'].includes(build.status)) reject('invalid-state-transition', '当前 Build 不能暂停')
    const controlEpoch = production.controlEpoch + 1
    const stateRevision = production.stateRevision + 1
    await db.productBuilds.update(build.id, {
      status: 'paused', resumeState: build.status, controlEpoch, stateRevision: build.stateRevision + 1,
      failureJson: safeJson({ code: 'user-paused', reason: command.reason }), updatedAt: now,
    })
    await db.productProductions.update(production.id, { status: 'paused', controlEpoch, stateRevision, updatedAt: now })
    production = { ...production, status: 'paused', controlEpoch, stateRevision, updatedAt: now }
    return { production, result: { buildNumber: build.buildNumber, controlEpoch, resumeState: build.status } }
  }

  if (command.type === 'resume') {
    if (production.status !== 'paused') reject('invalid-state-transition', 'Production 不在暂停态')
    const build = await currentBuild(production)
    if (build.status !== 'paused' || !build.resumeState) reject('invalid-state-transition', 'Build 没有可恢复状态')
    const restored = build.resumeState
    const controlEpoch = production.controlEpoch + 1
    const stateRevision = production.stateRevision + 1
    await db.productBuilds.update(build.id, {
      status: restored, resumeState: null, controlEpoch, stateRevision: build.stateRevision + 1,
      failureJson: '{}', updatedAt: now,
    })
    const productionStatus = restored === 'preview-ready' || restored === 'release-ready' ? 'preview-ready' as const : 'producing' as const
    await db.productProductions.update(production.id, { status: productionStatus, controlEpoch, stateRevision, updatedAt: now })
    production = { ...production, status: productionStatus, controlEpoch, stateRevision, updatedAt: now }
    return { production, result: { buildNumber: build.buildNumber, controlEpoch, restored } }
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
    if (!['retry', 'change-capability', 'cancel'].includes(command.resolution.action)) {
      reject('invalid-state-transition', '当前 blocker 只允许重试、更换能力后重试或取消；降级/豁免必须先生成新 Brief')
    }
    const controlEpoch = production.controlEpoch + 1
    const stateRevision = production.stateRevision + 1
    if (command.resolution.action === 'cancel') {
      await db.productBuilds.update(build.id, {
        status: 'cancelled', resumeState: null, controlEpoch,
        failureJson: safeJson({ blockerKey: command.blockerKey, resolution: command.resolution }),
        stateRevision: build.stateRevision + 1, completedAt: now, updatedAt: now,
      })
      await db.productProductions.update(production.id, {
        status: 'stopped', controlEpoch, stateRevision, updatedAt: now,
      })
      production = { ...production, status: 'stopped', controlEpoch, stateRevision, updatedAt: now }
    } else {
      await db.productBuilds.update(build.id, {
        status: 'building', resumeState: null, controlEpoch,
        failureJson: safeJson({ blockerKey: command.blockerKey, resolution: command.resolution, resolvedAt: now }),
        stateRevision: build.stateRevision + 1, updatedAt: now,
      })
      await db.productProductions.update(production.id, {
        status: 'producing', controlEpoch, stateRevision, updatedAt: now,
      })
      production = { ...production, status: 'producing', controlEpoch, stateRevision, updatedAt: now }
    }
    return { production, result: {
      buildNumber: build.buildNumber, blockerKey: command.blockerKey,
      action: command.resolution.action, controlEpoch,
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
  preparedWorldReferenceHash: string | null
  emptyHash: string
  now: number
}): Promise<ProductProductionCommandReceiptV1> {
  const { scope, command, now } = input
  return db.transaction('rw', scopeTransactionTables(
    db.productReleases,
    db.productProductions, db.productProductionBriefs, db.productProductionCommands,
    db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects,
  ), async () => {
    let production: ProductProductionRecordV1 & { id: number }
    if (command.type === 'create-intent') {
      if (!input.preparedWorldReferenceHash) reject('source-stale', 'create-intent 缺少经中立边界验证的 WorldReference')
      const existing = await db.productProductions.where('[workId+productionKey]').equals([scope.workId, command.productionKey]).first()
      if (existing) {
        if (!await assertRecordInScope(scope, 'productProductions', existing, { owner: 'work' })) reject('production-state-conflict', 'productionKey 跨 Work 冲突')
        production = existing as ProductProductionRecordV1 & { id: number }
      } else {
        const row = stampNewRecord(scope, 'productProductions', {
          projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
          productionKey: command.productionKey, productType: command.productType,
          title: command.userText.slice(0, 120), status: 'consulting' as const,
          stateRevision: 0, controlEpoch: 0, currentBriefRevision: null, currentBuildNumber: null,
          currentProductReleaseId: null, lastErrorJson: '{}', createdAt: now, updatedAt: now,
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

    const claim = stampNewRecord(scope, 'productProductionCommands', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, productionId: production.id,
      commandId: command.commandId, type: command.type, payloadHash: input.payloadHash,
      expectedStateRevision: command.type === 'create-intent' ? null : command.expectedStateRevision,
      status: 'claimed' as const, resultJson: '{}', errorCode: null, createdAt: now, completedAt: null,
    } satisfies ProductProductionCommandRecordV1, { owner: 'work' })
    const claimId = await db.productProductionCommands.add(claim) as number

    try {
      const applied = await applyCommand({
        scope, production, command,
        preparedBriefHash: input.preparedBriefHash,
        preparedSourcePlan: input.preparedSourcePlan,
        preparedConfirmedBrief: input.preparedConfirmedBrief,
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
  if (command.type !== 'create-intent' && Number.isInteger(input.productionId)) {
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
  const request = {
    scope,
    productionId: input.productionId,
    command,
    payloadHash,
    preparedBriefHash,
    preparedSourcePlan,
    preparedConfirmedBrief,
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
