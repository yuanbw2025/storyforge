import Dexie from 'dexie'
import { db } from '../db/schema'
import type {
  ConfirmedProductBriefV1,
  MediaBlobObjectRecordV1,
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionPlanV3,
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
import {
  createProductProductionPlanV3,
  parseProductProductionPlanV3,
  textAdventureProductionBudgetFloorV1,
} from './plan'
import { readMediaBlobObjectData } from './media-blob-store'

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
  | 'media-revision-invalid'
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

/** Compatibility path for Builds made before deterministic assembly failures became recoverable blockers. */
export function isRepairRetryableFailedProductBuildV1(
  build: Pick<ProductBuildRecordV1, 'status' | 'failureJson'>,
): boolean {
  if (build.status !== 'failed') return false
  try {
    const failure = JSON.parse(build.failureJson) as { taskKey?: unknown; code?: unknown }
    return (failure.taskKey === 'integration.package' || failure.taskKey === 'qa.release')
      && (failure.code === 'task-executor-failed' || failure.code === 'task-timeout')
  } catch { return false }
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

type ReviseMediaCommandV1 = Extract<ProductProductionCommandV1, { type: 'revise-media-asset' }>

function objectJson(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { reject('media-revision-invalid', `${label} 不是合法 JSON`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    reject('media-revision-invalid', `${label} 必须是对象`)
  }
  return parsed as Record<string, unknown>
}

function mediaArtifactLocked(row: ProductBuildArtifactRecordV1): boolean {
  const metadata = objectJson(row.metadataJson, `${row.artifactKey}.metadata`)
  const revision = metadata.authorRevision
  return !!revision && typeof revision === 'object' && !Array.isArray(revision)
    && (revision as Record<string, unknown>).locked === true
}

function invalidatedMediaTaskKeys(plan: ProductProductionPlanV3, targetTaskKey: string): Set<string> {
  const invalidated = new Set([targetTaskKey])
  let changed = true
  while (changed) {
    changed = false
    for (const task of plan.tasks) {
      if (!invalidated.has(task.taskKey) && task.dependsOn.some(key => invalidated.has(key))) {
        invalidated.add(task.taskKey)
        changed = true
      }
    }
  }
  return invalidated
}

async function createMediaRevisionPlan(input: {
  parentBuild: ProductBuildRecordV1 & { id: number }
  brief: ReturnType<typeof parseProductProductionBriefV3>
  command: ReviseMediaCommandV1
  buildNumber: number
  controlEpoch: number
  artifacts: ProductBuildArtifactRecordV1[]
}): Promise<{ plan: ProductProductionPlanV3; carriedArtifactKeys: string[]; targetTaskKey: string }> {
  const base = await createProductProductionPlanV3({
    brief: input.brief,
    briefHash: input.parentBuild.briefHash,
    buildNumber: input.buildNumber,
    controlEpoch: input.controlEpoch,
  })
  const target = base.tasks.find(task => task.taskKey === input.command.artifactKey)
  if (!target || target.executionMode !== 'media-provider' || target.kind !== 'image-asset'
    || target.outputArtifactKeys.length !== 1 || target.outputArtifactKeys[0] !== input.command.artifactKey) {
    reject('media-revision-invalid', '目标不是当前文字冒险 Build 的单项图片任务')
  }
  const artifacts = new Map(input.artifacts.map(row => [row.artifactKey, row]))
  if (artifacts.size !== input.artifacts.length) reject('media-revision-invalid', '当前 Build 存在重复有效 Artifact')
  const invalidated = invalidatedMediaTaskKeys(base, target.taskKey)
  const carriedArtifactKeys: string[] = []
  const tasks = [] as ProductProductionPlanV3['tasks']
  for (const task of base.tasks) {
    if (task.taskKey === target.taskKey) {
      if (input.command.action === 'regenerate') {
        tasks.push(task)
      } else {
        tasks.push({
          ...task,
          skillId: null,
          executionMode: 'human-import' as const,
          capabilityRequirementKeys: [],
          concurrencyGroup: 'human-import',
          budgetReservation: {
            modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
            maximumCostUsd: 0, durationMs: task.budgetReservation.durationMs, storageBytes: 0,
          },
          maxAttempts: 1,
          failurePolicy: 'pause' as const,
          fallbackTaskKey: null,
        })
      }
      continue
    }
    if (invalidated.has(task.taskKey)) {
      tasks.push(task)
      continue
    }
    const outputs = task.outputArtifactKeys.map(key => artifacts.get(key))
    if (outputs.some(row => !row)) {
      reject('media-revision-invalid', `父 Build 缺少可复用输出:${task.taskKey}`)
    }
    const proven = outputs as ProductBuildArtifactRecordV1[]
    const reuseKey = await hashProductProductionValueV2({
      schema: 'storyforge.text-adventure-media-revision-reuse', version: 1,
      sourceBuildNumber: input.parentBuild.buildNumber,
      targetBuildNumber: input.buildNumber,
      taskKey: task.taskKey,
      commandId: input.command.commandId,
      artifacts: proven.map(row => ({ artifactKey: row.artifactKey, contentHash: row.contentHash })),
    })
    carriedArtifactKeys.push(...task.outputArtifactKeys)
    tasks.push({
      ...task,
      reuse: {
        sourceBuildNumber: input.parentBuild.buildNumber,
        sourceArtifactKey: proven[0].artifactKey,
        sourceContentHash: proven[0].contentHash,
        reuseKey,
        requiresRevalidation: true,
        reason: `单项媒资修订 ${input.command.artifactKey} 未影响本任务依赖闭包`,
      },
    })
  }
  const plan = parseProductProductionPlanV3({ ...base, tasks }, input.brief, input.parentBuild.briefHash)
  return { plan, carriedArtifactKeys, targetTaskKey: target.taskKey }
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
    const previousFailure = readResult(build.failureJson)
    const repairingLegacyFailure = isRepairRetryableFailedProductBuildV1(build)
    if (!['recovery-required', 'paused'].includes(build.status) && !repairingLegacyFailure) {
      reject('invalid-state-transition', '当前 Build 没有待处理 blocker')
    }
    if (repairingLegacyFailure && command.resolution.action === 'change-capability') {
      reject('invalid-state-transition', '确定性装配失败不能用更换模型能力修复')
    }
    const sourceExpansionDecision = command.resolution.action === 'accept-product-private-expansion'
    if (sourceExpansionDecision && (production.productType !== 'text-adventure'
      || command.blockerKey !== 'source.author-gate'
      || previousFailure.taskKey !== 'source.author-gate')) {
      reject('invalid-state-transition', '产品私域补充只能用于文字冒险来源作者闸门')
    }
    const mediaAnchorDecision = command.resolution.action === 'confirm-character-anchors'
    if (mediaAnchorDecision && (production.productType !== 'text-adventure'
      || command.blockerKey !== 'media.anchor-author-gate'
      || previousFailure.taskKey !== 'media.anchor-author-gate')) {
      reject('invalid-state-transition', '角色视觉锚点确认只能用于文字冒险商业美术作者闸门')
    }
    if (![
      'retry', 'change-capability', 'accept-product-private-expansion',
      'confirm-character-anchors', 'cancel',
    ].includes(command.resolution.action)) {
      reject('invalid-state-transition', '当前 blocker 只允许重试、更换能力、处理已登记作者闸门或取消；降级/豁免必须先生成新 Brief')
    }
    const controlEpoch = production.controlEpoch + 1
    const stateRevision = production.stateRevision + 1
    if (command.resolution.action === 'cancel') {
      await db.productBuilds.update(build.id, {
        status: 'cancelled', resumeState: null, controlEpoch,
        failureJson: safeJson({
          commandId: command.commandId, blockerKey: command.blockerKey,
          resolution: command.resolution, previousFailure,
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
        failureJson: safeJson({
          commandId: command.commandId, blockerKey: command.blockerKey, resolution: command.resolution,
          previousFailure, resolvedAt: now,
        }),
        stateRevision: build.stateRevision + 1, completedAt: null, updatedAt: now,
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

  if (command.type === 'revise-media-asset') {
    if (production.productType !== 'text-adventure' || production.status !== 'preview-ready') {
      reject('invalid-state-transition', '仅已完成预览的文字冒险 Production 可发起单项媒资修订')
    }
    const parentBuild = await currentBuild(production)
    if (parentBuild.buildNumber !== command.buildNumber
      || !['preview-ready', 'release-ready'].includes(parentBuild.status)
      || parentBuild.releasedProductReleaseId != null) {
      reject('invalid-state-transition', '只能从当前未发布且已完成预览的 Build 派生媒资修订')
    }
    if (parentBuild.briefRevision !== production.currentBriefRevision) {
      reject('brief-not-authorized', '当前 Build 与已授权 Brief 指针不一致')
    }
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([production.id, parentBuild.briefRevision]).first()
    if (!briefRow || briefRow.status !== 'authorized' || briefRow.briefHash !== parentBuild.briefHash) {
      reject('brief-not-authorized', '媒资修订缺少父 Build 的已授权 Brief')
    }
    const brief = parseProductProductionBriefV3(briefRow.briefJson)
    const parentPlan = parseProductProductionPlanV3(parentBuild.planJson, brief, briefRow.briefHash)
    if (parentBuild.planHash !== await hashProductProductionValueV2(parentPlan)) {
      reject('source-stale', '父 Build 的生产 Plan hash 已失效')
    }
    const parentArtifacts = (await db.productBuildArtifacts.where('buildId').equals(parentBuild.id).toArray())
      .filter(row => row.controlEpoch === parentBuild.controlEpoch
        && (row.status === 'accepted' || row.status === 'carried-forward'))
    const targetRows = parentArtifacts.filter(row => row.artifactKey === command.artifactKey)
    if (targetRows.length !== 1) reject('media-revision-invalid', '目标图片 Artifact 缺失或重复')
    const targetArtifact = targetRows[0]
    if (targetArtifact.contentHash !== command.expectedArtifactHash
      || targetArtifact.kind !== 'image' || targetArtifact.blobObjectId == null
      || targetArtifact.mimeType == null || targetArtifact.mediaKind == null) {
      reject('source-stale', '目标图片已变化或不是可修订的冻结图片')
    }
    const targetBlob = await db.mediaBlobObjects.get(targetArtifact.blobObjectId)
    if (!targetBlob || !await assertRecordInScope(scope, 'mediaBlobObjects', targetBlob, { owner: 'work' })
      || targetBlob.storageState !== 'ready' || targetBlob.contentHash !== targetArtifact.contentHash
      || targetBlob.mimeType !== targetArtifact.mimeType || targetBlob.byteSize !== targetArtifact.byteSize) {
      reject('media-revision-invalid', '目标图片的物理 Blob 不完整或已损坏')
    }
    const locked = mediaArtifactLocked(targetArtifact)
    if (command.action === 'regenerate' && locked) {
      reject('media-revision-invalid', '图片已被作者锁定，必须先派生解锁 Build')
    }
    if (command.action === 'lock' && locked) reject('media-revision-invalid', '图片已经处于锁定状态')
    if (command.action === 'unlock' && !locked) reject('media-revision-invalid', '图片尚未锁定')

    let replacementBlob: MediaBlobObjectRecordV1 | undefined
    if (command.replacement) {
      replacementBlob = await db.mediaBlobObjects.get(command.replacement.blobObjectId)
      if (!replacementBlob
        || !await assertRecordInScope(scope, 'mediaBlobObjects', replacementBlob, { owner: 'work' })
        || replacementBlob.storageState !== 'ready'
        || replacementBlob.contentHash !== command.replacement.contentHash
        || replacementBlob.mimeType !== command.replacement.mimeType
        || replacementBlob.byteSize !== command.replacement.byteSize) {
        reject('media-revision-invalid', '作者上传 Blob 不存在、跨 Work、损坏或与命令不一致')
      }
      if (brief.qualityProfile === 'commercial-candidate'
        && (!command.replacement.commercialUse || !command.replacement.redistribution)) {
        reject('rights-incomplete', '商业候选的作者图片必须确认商用与再分发权利')
      }
    }

    const buildNumber = await nextBuildNumber(production.id)
    const controlEpoch = production.controlEpoch + 1
    const revisionPlan = await createMediaRevisionPlan({
      parentBuild, brief, command, buildNumber, controlEpoch, artifacts: parentArtifacts,
    })
    const planHash = await hashProductProductionValueV2(revisionPlan.plan)
    const sourceByKey = new Map(parentArtifacts.map(row => [row.artifactKey, row]))
    for (const artifactKey of revisionPlan.carriedArtifactKeys) {
      const source = sourceByKey.get(artifactKey)!
      if (source.blobObjectId == null) continue
      const blob = await db.mediaBlobObjects.get(source.blobObjectId)
      if (!blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
        || blob.storageState !== 'ready' || blob.contentHash !== source.contentHash
        || blob.mimeType !== source.mimeType || blob.byteSize !== source.byteSize) {
        reject('media-revision-invalid', `父 Build 媒资对象不可复用:${artifactKey}`)
      }
    }
    let humanArtifact: {
      contentHash: string
      blobObjectId: number
      mimeType: string
      byteSize: number
      inputHash: string
      payloadJson: string
      metadataJson: string
      qualityJson: string
      rightsJson: string
    } | null = null
    if (command.action !== 'regenerate') {
      const oldPayload = objectJson(targetArtifact.payloadJson, `${targetArtifact.artifactKey}.payload`)
      const oldMetadata = objectJson(targetArtifact.metadataJson, `${targetArtifact.artifactKey}.metadata`)
      const oldRights = objectJson(targetArtifact.rightsJson, `${targetArtifact.artifactKey}.rights`)
      const frozenRequirement = oldPayload.request && typeof oldPayload.request === 'object'
        && !Array.isArray(oldPayload.request) ? oldPayload.request as Record<string, unknown> : null
      if (!frozenRequirement) reject('media-revision-invalid', '目标图片缺少冻结需求合同')
      if (command.replacement && (command.replacement.width !== frozenRequirement.width
        || command.replacement.height !== frozenRequirement.height)) {
        reject('media-revision-invalid', '作者替换图片尺寸必须与冻结媒资需求一致')
      }
      const nextLocked = command.action === 'lock'
        ? true
        : command.action === 'unlock' ? false : locked
      const assetKey = `${production.productionKey}.build-${buildNumber}.${command.artifactKey}`
      const replacement = command.replacement
      const contentHash = replacement?.contentHash ?? targetArtifact.contentHash
      const metadata = {
        ...oldMetadata,
        assetKey,
        source: replacement ? 'author-upload' : oldMetadata.source,
        width: replacement?.width ?? oldMetadata.width,
        height: replacement?.height ?? oldMetadata.height,
        altText: replacement?.altText ?? oldMetadata.altText,
        license: replacement?.license ?? oldMetadata.license,
        authorRevision: {
          schema: 'storyforge.text-adventure-media-revision', version: 1,
          commandId: command.commandId, action: command.action, parentBuildNumber: parentBuild.buildNumber,
          priorContentHash: targetArtifact.contentHash, locked: nextLocked, revisedAt: now,
        },
      }
      const rights = replacement ? {
        origin: 'author-upload', license: replacement.license,
        commercialUse: replacement.commercialUse, redistribution: replacement.redistribution,
        declaration: replacement.declaration, attribution: replacement.attribution,
      } : oldRights
      humanArtifact = {
        contentHash,
        blobObjectId: replacement?.blobObjectId ?? targetArtifact.blobObjectId,
        mimeType: replacement?.mimeType ?? targetArtifact.mimeType,
        byteSize: replacement?.byteSize ?? targetArtifact.byteSize,
        inputHash: await hashProductProductionValueV2({
          schema: 'storyforge.text-adventure-human-media-input', version: 1,
          commandId: command.commandId, planHash, artifactKey: command.artifactKey,
          contentHash, parentArtifactHash: targetArtifact.contentHash,
        }),
        payloadJson: canonicalProductProductionJsonV2({ ...oldPayload, assetKey }),
        metadataJson: canonicalProductProductionJsonV2(metadata),
        qualityJson: canonicalProductProductionJsonV2({
          authorManaged: true, byteHashVerified: true, dimensionsVerified: true, providerCalls: 0,
        }),
        rightsJson: canonicalProductProductionJsonV2(rights),
      }
    }
    const build = stampNewRecord(scope, 'productBuilds', {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
      productionId: production.id, buildNumber, briefRevision: briefRow.revision, briefHash: briefRow.briefHash,
      parentBuildNumber: parentBuild.buildNumber, sourceProductReleaseId: parentBuild.sourceProductReleaseId,
      status: 'building' as const, resumeState: null, stateRevision: 0, controlEpoch,
      planRevision: 1, planJson: canonicalProductProductionJsonV2(revisionPlan.plan), planHash,
      budgetLedgerJson: '{}', manifestJson: '{}', manifestHash: input.emptyHash,
      packageHash: '', previewManifestJson: '{}', previewHash: '', qualityReportJson: '{}',
      qualityReportHash: input.emptyHash, compatibilityJson: '{}', rootTerminalReceiptHash: null,
      adoptionIntentHash: null, releasedProductReleaseId: null, failureJson: '{}',
      authorizedAt: now, startedAt: now, completedAt: null, createdAt: now, updatedAt: now,
    } satisfies ProductBuildRecordV1, { owner: 'work' })
    const buildId = await db.productBuilds.add(build) as number
    for (const artifactKey of revisionPlan.carriedArtifactKeys) {
      const source = sourceByKey.get(artifactKey)!
      let payloadJson = source.payloadJson
      let metadataJson = source.metadataJson
      let inputHash = source.inputHash
      if (source.kind === 'image' || source.kind === 'audio') {
        const payload = objectJson(source.payloadJson, `${artifactKey}.payload`)
        const metadata = objectJson(source.metadataJson, `${artifactKey}.metadata`)
        if (payload.schema !== 'storyforge.generated-media-artifact' || payload.version !== 1
          || typeof payload.assetKey !== 'string' || !payload.assetKey.trim()
          || typeof metadata.assetKey !== 'string' || !metadata.assetKey.trim()) {
          reject('media-revision-invalid', `父 Build 媒资缺少可重绑定的生成合同:${artifactKey}`)
        }
        const assetKey = `${production.productionKey}.build-${buildNumber}.${artifactKey}`
        payloadJson = canonicalProductProductionJsonV2({ ...payload, assetKey })
        metadataJson = canonicalProductProductionJsonV2({ ...metadata, assetKey })
        inputHash = await Dexie.waitFor(hashProductProductionValueV2({
          schema: 'storyforge.text-adventure-carried-media-input', version: 1,
          commandId: command.commandId, sourceBuildNumber: parentBuild.buildNumber,
          targetBuildNumber: buildNumber, artifactKey, assetKey,
          sourceInputHash: source.inputHash, contentHash: source.contentHash,
        }))
      }
      await db.productBuildArtifacts.add(stampNewRecord(scope, 'productBuildArtifacts', {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        buildId, artifactKey, requirementKey: source.requirementKey, version: 1,
        kind: source.kind, mediaKind: source.mediaKind, status: 'carried-forward' as const,
        producerRunId: null, producerReceiptHash: source.producerReceiptHash, controlEpoch,
        inputHash, contentHash: source.contentHash, payloadJson,
        metadataJson, qualityJson: source.qualityJson, rightsJson: source.rightsJson,
        blobObjectId: source.blobObjectId, mimeType: source.mimeType, byteSize: source.byteSize,
        parentArtifactHash: source.contentHash,
        carriedFrom: {
          buildNumber: parentBuild.buildNumber, artifactKey, version: source.version,
          contentHash: source.contentHash,
        },
        createdAt: now, updatedAt: now,
      } satisfies ProductBuildArtifactRecordV1, { owner: 'work' }))
    }

    if (humanArtifact) {
      await db.productBuildArtifacts.add(stampNewRecord(scope, 'productBuildArtifacts', {
        projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
        buildId, artifactKey: command.artifactKey, requirementKey: targetArtifact.requirementKey,
        version: 1, kind: targetArtifact.kind, mediaKind: targetArtifact.mediaKind,
        status: 'accepted' as const, producerRunId: null, producerReceiptHash: null,
        controlEpoch, inputHash: humanArtifact.inputHash, contentHash: humanArtifact.contentHash,
        payloadJson: humanArtifact.payloadJson, metadataJson: humanArtifact.metadataJson,
        qualityJson: humanArtifact.qualityJson, rightsJson: humanArtifact.rightsJson,
        blobObjectId: humanArtifact.blobObjectId, mimeType: humanArtifact.mimeType,
        byteSize: humanArtifact.byteSize,
        parentArtifactHash: targetArtifact.contentHash,
        carriedFrom: {
          buildNumber: parentBuild.buildNumber, artifactKey: targetArtifact.artifactKey,
          version: targetArtifact.version, contentHash: targetArtifact.contentHash,
        },
        createdAt: now, updatedAt: now,
      } satisfies ProductBuildArtifactRecordV1, { owner: 'work' }))
    }
    const stateRevision = production.stateRevision + 1
    await db.productProductions.update(production.id, {
      status: 'producing', currentBuildNumber: buildNumber, controlEpoch, stateRevision,
      lastErrorJson: '{}', updatedAt: now,
    })
    production = {
      ...production, status: 'producing', currentBuildNumber: buildNumber,
      controlEpoch, stateRevision, lastErrorJson: '{}', updatedAt: now,
    }
    return { production, result: {
      action: command.action, artifactKey: command.artifactKey,
      parentBuildNumber: parentBuild.buildNumber, buildId, buildNumber, controlEpoch,
      carriedArtifactCount: revisionPlan.carriedArtifactKeys.length,
      rerunTaskKeys: [...invalidatedMediaTaskKeys(revisionPlan.plan, revisionPlan.targetTaskKey)].sort(),
    } }
  }

  if (command.type === 'publish') {
    reject('publication-transaction-failed', '发布必须由 product-production/adoption.ts 原子事务入口执行')
  }

  const affectedLanes = [...new Set(command.affectedLanes)]
  const recoveryBase = command.base.kind === 'recovery-build' ? command.base : null
  const budgetRecovery = recoveryBase != null
    && affectedLanes.length === 1 && affectedLanes[0] === 'production-budget'
  if (budgetRecovery) {
    if (production.productType !== 'text-adventure' || production.status !== 'producing'
      || production.currentBuildNumber !== recoveryBase.buildNumber) {
      reject('invalid-state-transition', '只有当前文字冒险恢复 Build 可以扩充生产预算')
    }
    const base = await db.productBuilds
      .where('[productionId+buildNumber]').equals([production.id, recoveryBase.buildNumber]).first()
    if (!base || base.status !== 'recovery-required'
      || base.briefHash !== recoveryBase.briefHash
      || base.planHash !== recoveryBase.planHash
      || base.controlEpoch !== recoveryBase.controlEpoch) {
      reject('source-stale', '预算恢复 Build 基线不可验证')
    }
  } else {
    if (affectedLanes.includes('production-budget') || command.base.kind === 'recovery-build') {
      reject('invalid-state-transition', '生产预算只能从当前恢复 Build 单独扩充')
    }
    if (!['preview-ready', 'released'].includes(production.status)) reject('invalid-state-transition', '当前 Production 不能开始演化会谈')
  }
  if (command.base.kind === 'build') {
    const base = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, command.base.buildNumber]).first()
    if (!base || base.manifestHash !== command.base.manifestHash || !['preview-ready', 'release-ready', 'released'].includes(base.status)) {
      reject('source-stale', '演化 Build 基线不可验证')
    }
  } else if (command.base.kind === 'release') {
    const release = await db.productReleases.get(command.base.productReleaseId)
    if (!release || release.workId !== scope.workId || release.contentHash !== command.base.contentHash) reject('source-stale', '演化 Release 基线不可验证')
  }
  if (production.currentBriefRevision == null) reject('brief-not-authorized', '演化缺少上一版 Brief')
  const previous = await db.productProductionBriefs
    .where('[productionId+revision]').equals([production.id, production.currentBriefRevision]).first()
  if (!previous) reject('brief-not-authorized', '上一版 Brief 缺失')
  const priorBrief = parseProductProductionBriefV3(previous.briefJson)
  const evolutionGoal = command.userText.trim().slice(0, 2000)
  const contentAffected = affectedLanes.includes('content') || affectedLanes.includes('world-source')
  const baseRef = command.base.kind === 'build'
    ? `game-build:${command.base.buildNumber}:${command.base.manifestHash}`
    : command.base.kind === 'release'
      ? `product-release:${command.base.productReleaseId}:${command.base.contentHash}`
      : `recovery-build:${command.base.buildNumber}:${command.base.briefHash}:${command.base.planHash}:${command.base.controlEpoch}`
  const budgetFloor = budgetRecovery ? textAdventureProductionBudgetFloorV1(priorBrief) : null
  if (budgetFloor && priorBrief.productionBudget.maximumModelCalls >= budgetFloor.minimumModelCalls
    && priorBrief.productionBudget.maximumInputTokens >= budgetFloor.minimumInputTokens
    && priorBrief.productionBudget.maximumOutputTokens >= budgetFloor.minimumOutputTokens) {
    reject('invalid-state-transition', '当前 Brief 已满足专业生产预算底线，不能创建无变化的预算恢复版本')
  }
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
    productionBudget: budgetFloor ? {
      ...priorBrief.productionBudget,
      maximumModelCalls: Math.max(priorBrief.productionBudget.maximumModelCalls, budgetFloor.minimumModelCalls),
      maximumInputTokens: Math.max(priorBrief.productionBudget.maximumInputTokens, budgetFloor.minimumInputTokens),
      maximumOutputTokens: Math.max(priorBrief.productionBudget.maximumOutputTokens, budgetFloor.minimumOutputTokens),
    } : priorBrief.productionBudget,
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
      productionBudget: nextBrief.productionBudget,
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
  if (command.type === 'revise-media-asset' && command.replacement) {
    await readMediaBlobObjectData({
      scope,
      blobObjectId: command.replacement.blobObjectId,
      expected: {
        contentHash: command.replacement.contentHash,
        byteSize: command.replacement.byteSize,
        mimeType: command.replacement.mimeType,
      },
    })
  }
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
