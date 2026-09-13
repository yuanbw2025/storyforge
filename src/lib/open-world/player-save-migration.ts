import Dexie from 'dexie'
import { db } from '../db/schema'
import {
  hashProductRuntimeStateV1,
  insertPreparedProductRuntimeSessionV1,
  prepareReleasedProductRuntimeSessionRecordV1,
  readVerifiedProductRuntimeHeadV1,
  stableJson,
} from '../product/runtime-core'
import { rebaseProductRuntimeStateForBranchV1 } from '../product/runtime-product-adapters'
import {
  createProductInitialStateV1,
  createProductRuntimeCanonSnapshotV1,
} from '../product/runtime-instances'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { createProductBuildCompatibilityReportV1 } from '../product-production/compatibility'
import type {
  ProductNarrativeRuntimeState,
  ProductRuntimeSession,
  ProductRuntimeState,
  WorkspaceScope,
} from '../types'
import { resolveScope } from '../workspace/scope'
import { parseTextOpenWorldModulesV1 } from './modules'
import { parseTextOpenWorldSessionProjectionV1 } from './session-projection'
import {
  textOpenWorldPlayerCompatibilityDeclarationV1,
  verifyOwnedTextOpenWorldPlayerReleaseV1,
  type VerifiedTextOpenWorldPlayerReleaseV1,
} from './player-version-compatibility'

export const TEXT_OPEN_WORLD_SAVE_MIGRATION_VERSION_V1 = 1 as const

export interface TextOpenWorldSaveMigrationActionIdentityV1 {
  sourceSessionId: number
  targetProductReleaseId: number
}

export interface TextOpenWorldSaveMigrationPreviewV1 {
  version: typeof TEXT_OPEN_WORLD_SAVE_MIGRATION_VERSION_V1
  status: 'ready'
  previewHash: string
  actionIdentity: TextOpenWorldSaveMigrationActionIdentityV1
  source: {
    releaseVersion: number
    releaseLabel: string
    throughSequence: number
    stateHash: string
  }
  target: {
    releaseVersion: number
    releaseLabel: string
  }
  summary: {
    playerLevel: number
    locationLabel: string
    activeQuestCount: number
    worldMinute: number
  }
  guarantees: {
    originalSessionUnchanged: true
    originalReleasePinned: true
    createsChildSession: true
    targetReleaseVerified: true
    stateValidatedAgainstTargetPackage: true
  }
  warnings: string[]
}

export interface TextOpenWorldSaveMigrationReceiptV1 {
  version: typeof TEXT_OPEN_WORLD_SAVE_MIGRATION_VERSION_V1
  sessionId: number
  parentSessionId: number
  parentThroughSequence: number
  targetReleaseVersion: number
  previewHash: string
  preservedOriginalBranch: true
  receiptHash: string
}

interface PreparedMigrationV1 {
  scope: WorkspaceScope
  sourceSession: ProductRuntimeSession & { id: number }
  sourceRelease: VerifiedTextOpenWorldPlayerReleaseV1
  targetRelease: VerifiedTextOpenWorldPlayerReleaseV1
  migratedState: ProductRuntimeState
  preview: TextOpenWorldSaveMigrationPreviewV1
  portablePlan: Record<string, unknown>
}

function fail(message: string): never {
  throw new Error(`[text-open-world-save-migration] ${message}`)
}

function isVNextOnlyRelease(release: VerifiedTextOpenWorldPlayerReleaseV1): boolean {
  const runtime = release.manifest.runtimePackage
  return runtime.textOpenWorldVNext != null
    && runtime.interaction == null
    && runtime.adventure == null
    && runtime.openWorldEvolution == null
    && runtime.openWorld == null
}

function migrateNarrativeStateV1(input: {
  source: ProductNarrativeRuntimeState
  target: ProductNarrativeRuntimeState
}): ProductNarrativeRuntimeState {
  const source = input.source
  const target = input.target
  if (source.version !== 2 || target.version !== 2) fail('叙事运行态版本不支持迁移')
  const nodeKeys = new Set(target.nodes.map(node => node.key))
  const choiceKeys = new Set(target.choices.map(choice => choice.choiceKey))
  const referencedNodeKeys = [
    source.currentNodeKey,
    ...source.visitedNodeKeys,
    ...source.availableNodeKeys,
    source.endingKey,
    ...source.choiceHistory.flatMap(entry => [entry.fromNodeKey, entry.toNodeKey]),
  ].filter((value): value is string => value != null)
  if (referencedNodeKeys.some(key => !nodeKeys.has(key))) {
    fail('新 Release 缺少旧存档已经引用的叙事节点')
  }
  if (source.visibleChoiceKeys.some(key => !choiceKeys.has(key))
    || source.availableChoiceKeys.some(key => !choiceKeys.has(key))
    || source.choiceHistory.some(entry => !choiceKeys.has(entry.choiceKey))) {
    fail('新 Release 缺少旧存档已经引用的叙事选择')
  }
  return {
    ...target,
    currentNodeKey: source.currentNodeKey,
    visitedNodeKeys: [...source.visitedNodeKeys],
    availableNodeKeys: [...source.availableNodeKeys],
    visibleChoiceKeys: [...source.visibleChoiceKeys],
    availableChoiceKeys: [...source.availableChoiceKeys],
    choiceHistory: structuredClone(source.choiceHistory),
    variables: { ...structuredClone(target.variables), ...structuredClone(source.variables) },
    completed: source.completed,
    endingKey: source.endingKey,
    completedAtSequence: source.completedAtSequence,
    lastEnteredNodeSequence: source.lastEnteredNodeSequence,
  }
}

function migrateRuntimeStateV1(input: {
  source: ProductRuntimeState
  targetInitial: ProductRuntimeState
  throughSequence: number
}): ProductRuntimeState {
  if (!input.source.narrative || !input.targetInitial.narrative
    || !input.source.textOpenWorld || !input.targetInitial.textOpenWorld) {
    fail('迁移只支持已经发布的文字开放世界 vNext 存档')
  }
  const migrated = structuredClone(input.source)
  rebaseProductRuntimeStateForBranchV1(migrated, input.throughSequence)
  migrated.narrative = migrateNarrativeStateV1({
    source: input.source.narrative,
    target: input.targetInitial.narrative,
  })
  migrated.textOpenWorld = parseTextOpenWorldSessionProjectionV1({
    ...migrated.textOpenWorld,
    runtimePackage: input.targetInitial.textOpenWorld.runtimePackage,
    ruleset: input.targetInitial.textOpenWorld.ruleset,
    lastEventSequence: 0,
  })
  migrated.lastSequence = 0
  return migrated
}

function sessionMatchesScope(session: ProductRuntimeSession, scope: WorkspaceScope): boolean {
  return session.projectId === scope.projectId
    && session.worldId === scope.worldId
    && session.workId === scope.workId
    && session.kind === 'text-open-world'
}

async function prepareMigrationV1(input: {
  scope: WorkspaceScope
  sourceSessionId: number
  targetProductReleaseId: number
}): Promise<PreparedMigrationV1> {
  if (!Number.isSafeInteger(input.sourceSessionId) || input.sourceSessionId < 1
    || !Number.isSafeInteger(input.targetProductReleaseId) || input.targetProductReleaseId < 1) {
    fail('Session或目标Release身份无效')
  }
  const scope = await resolveScope({ scope: input.scope })
  const sourceSessionValue = await db.productRuntimeSessions.get(input.sourceSessionId)
  if (!sourceSessionValue?.id || !sessionMatchesScope(sourceSessionValue, scope)) {
    fail('源Session不存在或不属于当前Work')
  }
  const sourceSession = sourceSessionValue as ProductRuntimeSession & { id: number }
  if (sourceSession.status !== 'active'
    || sourceSession.productReleaseId == null
    || sourceSession.productBuildId != null) {
    fail('只有活动中的正式Release存档可以迁移')
  }
  const [sourceReleaseRoot, targetReleaseRoot] = await Promise.all([
    db.productReleases.get(sourceSession.productReleaseId),
    db.productReleases.get(input.targetProductReleaseId),
  ])
  if (!sourceReleaseRoot || !targetReleaseRoot) fail('源或目标Release不存在')
  const [sourceRelease, targetRelease] = await Promise.all([
    verifyOwnedTextOpenWorldPlayerReleaseV1(scope, sourceReleaseRoot),
    verifyOwnedTextOpenWorldPlayerReleaseV1(scope, targetReleaseRoot),
  ])
  if (!isVNextOnlyRelease(sourceRelease) || !isVNextOnlyRelease(targetRelease)) {
    fail('旧式或混合运行包不支持跨Release迁移，请继续固定旧版本')
  }
  if (sourceSession.runtimeSourceHash !== sourceRelease.manifest.packageHash
    || sourceRelease.release.productionKey !== targetRelease.release.productionKey
    || targetRelease.release.version <= sourceRelease.release.version) {
    fail('迁移Release产品族、版本顺序或Session绑定无效')
  }
  const declaration = textOpenWorldPlayerCompatibilityDeclarationV1(sourceRelease, targetRelease)
  if (declaration !== 'direct-release-lineage'
    && declaration !== 'release-lineage-and-runtime-package-hash') {
    fail('目标Release不是当前固定版本的直接兼容子版本')
  }
  const compatibilityReport = await createProductBuildCompatibilityReportV1({
    previous: {
      buildNumber: sourceRelease.manifest.productionProvenance.buildNumber,
      packageHash: sourceRelease.manifest.packageHash,
      runtimePackage: sourceRelease.manifest.runtimePackage,
    },
    current: {
      buildNumber: targetRelease.manifest.productionProvenance.buildNumber,
      packageHash: targetRelease.manifest.packageHash,
      runtimePackage: targetRelease.manifest.runtimePackage,
    },
  })
  if (compatibilityReport.level !== 'compatible') {
    fail('目标Release的实际运行语义未通过保守兼容复算')
  }
  const sourceHead = await readVerifiedProductRuntimeHeadV1(sourceSession)
  if (!sourceHead.state.textOpenWorld) fail('源Session没有vNext运行投影')
  const targetInitial = createProductInitialStateV1({
    runtimePackage: targetRelease.manifest.runtimePackage,
    runtimeSourceHash: targetRelease.manifest.packageHash,
  })
  const migratedState = migrateRuntimeStateV1({
    source: sourceHead.state,
    targetInitial,
    throughSequence: sourceHead.sequence,
  })
  const migratedStateHash = await hashProductRuntimeStateV1(migratedState)
  const modules = parseTextOpenWorldModulesV1(migratedState.textOpenWorld!.runtimePackage)
  const state = migratedState.textOpenWorld!.state
  const activeQuestCount = Object.values(state.quests.instancesByKey)
    .filter(instance => ['accepted', 'active', 'suspended'].includes(instance.status)).length
  const locationLabel = modules.world.locations.find(location => location.key === state.map.currentLocationKey)?.title
    ?? state.map.currentLocationKey
  const portablePlan = {
    schema: 'storyforge.text-open-world-save-migration-plan',
    version: 1,
    productInstanceKey: sourceRelease.release.productionKey,
    source: {
      releaseUid: sourceRelease.manifest.lineage.releaseUid,
      releaseHash: sourceRelease.manifest.releaseIdentityHash,
      releaseVersion: sourceRelease.release.version,
      packageHash: sourceRelease.manifest.packageHash,
      throughSequence: sourceHead.sequence,
      stateHash: sourceHead.stateHash,
    },
    target: {
      releaseUid: targetRelease.manifest.lineage.releaseUid,
      releaseHash: targetRelease.manifest.releaseIdentityHash,
      releaseVersion: targetRelease.release.version,
      packageHash: targetRelease.manifest.packageHash,
      migratedStateHash,
    },
    policy: {
      directCompatibleChildOnly: true,
      sourceEventsCopied: false,
      originalSessionMutated: false,
      originalReleaseMutated: false,
      compatibilityReportHash: compatibilityReport.reportHash,
    },
  }
  const previewHash = await hashProductProductionValueV2(portablePlan)
  return {
    scope,
    sourceSession,
    sourceRelease,
    targetRelease,
    migratedState,
    portablePlan,
    preview: {
      version: TEXT_OPEN_WORLD_SAVE_MIGRATION_VERSION_V1,
      status: 'ready',
      previewHash,
      actionIdentity: {
        sourceSessionId: sourceSession.id,
        targetProductReleaseId: targetRelease.release.id,
      },
      source: {
        releaseVersion: sourceRelease.release.version,
        releaseLabel: sourceRelease.release.label.trim(),
        throughSequence: sourceHead.sequence,
        stateHash: sourceHead.stateHash,
      },
      target: {
        releaseVersion: targetRelease.release.version,
        releaseLabel: targetRelease.release.label.trim(),
      },
      summary: {
        playerLevel: state.player.level,
        locationLabel,
        activeQuestCount,
        worldMinute: state.time.worldMinute,
      },
      guarantees: {
        originalSessionUnchanged: true,
        originalReleasePinned: true,
        createsChildSession: true,
        targetReleaseVerified: true,
        stateValidatedAgainstTargetPackage: true,
      },
      warnings: [
        '迁移会创建绑定新Release的子时间线，不会覆盖原存档。',
        '旧事件仍只保存在原时间线；新时间线从已验证的迁移快照继续记录。',
      ],
    },
  }
}

export async function previewTextOpenWorldSaveMigrationV1(input: {
  scope: WorkspaceScope
  sourceSessionId: number
  targetProductReleaseId: number
}): Promise<TextOpenWorldSaveMigrationPreviewV1> {
  return (await prepareMigrationV1(input)).preview
}

export async function migrateTextOpenWorldSaveToReleaseV1(input: {
  scope: WorkspaceScope
  sourceSessionId: number
  targetProductReleaseId: number
  expectedPreviewHash: string
  title?: string
}): Promise<{ session: ProductRuntimeSession & { id: number }; receipt: TextOpenWorldSaveMigrationReceiptV1 }> {
  const prepared = await prepareMigrationV1(input)
  if (prepared.preview.previewHash !== input.expectedPreviewHash) {
    fail('迁移预演已过期，请重新预演后确认')
  }
  const title = input.title?.trim()
    || `${prepared.sourceSession.title} · v${prepared.targetRelease.release.version}迁移分支`
  if (!title || title.length > 200) fail('迁移分支名称无效')
  const migrationCanon = {
    ...createProductRuntimeCanonSnapshotV1({
      runtimePackage: prepared.targetRelease.manifest.runtimePackage,
      runtimeSourceHash: prepared.targetRelease.manifest.packageHash,
    }),
    migration: {
      ...prepared.portablePlan,
      previewHash: prepared.preview.previewHash,
    },
  }
  const child = await prepareReleasedProductRuntimeSessionRecordV1({
    projectId: prepared.scope.projectId,
    worldId: prepared.scope.worldId,
    workId: prepared.scope.workId,
    worldGroupId: prepared.sourceSession.worldGroupId ?? null,
    kind: 'text-open-world',
    title,
    productReleaseId: prepared.targetRelease.release.id,
    origin: 'branch',
    canonSnapshot: migrationCanon,
    initialState: prepared.migratedState,
  })
  child.parentSessionId = prepared.sourceSession.id
  child.parentThroughSequence = prepared.preview.source.throughSequence

  const inserted = await db.transaction(
    'rw',
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    db.productReleases,
    async () => {
      const [sourceNow, sourceReleaseNow, targetReleaseNow, latestEvent] = await Promise.all([
        db.productRuntimeSessions.get(prepared.sourceSession.id),
        db.productReleases.get(prepared.sourceRelease.release.id),
        db.productReleases.get(prepared.targetRelease.release.id),
        db.productRuntimeEvents
          .where('[sessionId+sequence]')
          .between(
            [prepared.sourceSession.id, Dexie.minKey],
            [prepared.sourceSession.id, Dexie.maxKey],
          )
          .last(),
      ])
      if (!sourceNow
        || stableJson(sourceNow) !== stableJson(prepared.sourceSession)
        || !sourceReleaseNow
        || stableJson(sourceReleaseNow) !== stableJson(prepared.sourceRelease.release)
        || !targetReleaseNow
        || stableJson(targetReleaseNow) !== stableJson(prepared.targetRelease.release)
        || (latestEvent?.sequence ?? 0) !== prepared.preview.source.throughSequence) {
        fail('Session或Release在迁移提交前发生变化，请重新预演')
      }
      return insertPreparedProductRuntimeSessionV1(child)
    },
  ) as ProductRuntimeSession & { id: number }
  const receiptBody = {
    version: TEXT_OPEN_WORLD_SAVE_MIGRATION_VERSION_V1,
    sessionId: inserted.id,
    parentSessionId: prepared.sourceSession.id,
    parentThroughSequence: prepared.preview.source.throughSequence,
    targetReleaseVersion: prepared.targetRelease.release.version,
    previewHash: prepared.preview.previewHash,
    preservedOriginalBranch: true as const,
  }
  return {
    session: inserted,
    receipt: {
      ...receiptBody,
      receiptHash: await hashProductProductionValueV2(receiptBody),
    },
  }
}
