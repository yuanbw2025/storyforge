import { db } from '../db/schema'
import type {
  ProductBuildRecordV1,
  ProductEvolutionAffectedLaneV1,
  ProductEvolutionBaseV1,
  ProductProductionBriefRecordV1,
  ProductProductionBriefV3,
  ProductProductionCommandRecordV1,
  ProductProductionRecordV1,
  ProductionProductKindV1,
  WorkspaceScope,
  WorldReferenceCatalogEntryV1,
} from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { listWorldReferenceCatalogV1 } from '../product/source'
import { prepareProductProductionAdoption, publishProductProductionBuild } from './adoption'
import { executeProductProductionCommand } from './commands'
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
import {
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
  build: ProductBuildRecordV1 | null
  artifactCount: number
  recentCommands: ProductProductionCommandRecordV1[]
  briefHistory: ProductProductionBriefRecordV1[]
  buildHistory: ProductBuildRecordV1[]
}

export type ProductProductionProgressV1 = ProductProductionSchedulerProjectionV1

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
      category: 'product-production.content',
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
  return {
    production,
    brief: brief ?? null,
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
}): Promise<'paused' | 'resumed'> {
  const paused = input.production.status === 'paused'
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.production.id!,
    command: paused
      ? { type: 'resume', commandId: commandId('resume'), expectedStateRevision: input.production.stateRevision }
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
}): Promise<void> {
  if (!input.details.build || input.details.build.status !== 'recovery-required') {
    throw new Error('[product-production-service] 当前 Build 没有可重试 blocker')
  }
  let blockerKey = 'build-recovery'
  try {
    const failure = JSON.parse(input.details.build.failureJson) as { taskKey?: unknown }
    if (typeof failure.taskKey === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(failure.taskKey)) {
      blockerKey = failure.taskKey
    }
  } catch { /* command still records a generic blocker key */ }
  const receipt = await executeProductProductionCommand({
    scope: input.scope, productionId: input.details.production.id!,
    command: {
      type: 'resolve-blocker', commandId: commandId('resolve-blocker'),
      expectedStateRevision: input.details.production.stateRevision, blockerKey,
      resolution: {
        action: input.afterCapabilityChange ? 'change-capability' : 'retry',
        note: input.afterCapabilityChange ? '作者已调整全局能力配置并要求重试' : '作者从制作工作台要求重试',
      },
    },
  })
  if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? 'blocker 重试失败'))
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
  const brief = parseProductProductionBriefV3(details.brief.briefJson)
  const textRequirements = brief.capabilityRequirements.filter(requirement => requirement.mediaClass === 'text')
  if (textRequirements.length !== 1) throw new Error('[product-production-service] 正式制作需要唯一文本 capability requirement')
  const textCapability = await resolveConfiguredTextCapabilityV1({
    projectId: scope.projectId, category: 'product-production', requirementKey: textRequirements[0].requirementKey,
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
  const executor = createConfiguredProductProductionExecutorV1({
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
  const brief = parseProductProductionBriefV3(details.brief.briefJson)
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
