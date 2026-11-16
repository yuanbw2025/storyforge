import { assertFrozenRuntimePackageSessionV1, parseProductRuntimeState } from '../product/runtime-core'
import type { AnyProductBuildPreviewManifest } from '../types'
import { avgExecutableModule } from '../avg/executable-module'
import { verifyAvgBranchOriginV1 } from '../avg/branch-origin'
import { isTtrpgRuntimeContentV2 } from '../ttrpg/content-version'
import { assertProductRuntimeSourceSnapshotV3 } from '../product/runtime-source-branch'
import type { AnyProductReleaseManifest, ProductRuntimeEvent } from '../types'

function maximumRuntimeSequenceForExport(sequences: ReadonlySet<number> | undefined): number {
  let maximum = 0
  for (const sequence of sequences ?? []) maximum = Math.max(maximum, sequence)
  return maximum
}

/** Fail closed before a corrupt runtime tree or derived checkpoint leaves IndexedDB. */
export async function assertProductRuntimeExportIntegrityV1(
  rowsByTable: ReadonlyMap<string, readonly any[]>,
): Promise<void> {
  const { validateEnhancedProductSourcePlanRecordV2 } = await import('../product/exact-source-contracts')
  for (const brief of rowsByTable.get('productProductionBriefs') ?? []) {
    if (typeof brief.sourcePlanJson === 'string') await validateEnhancedProductSourcePlanRecordV2(brief)
  }
  const builds = rowsByTable.get('productBuilds') ?? []
  const qualityReceipts = rowsByTable.get('productQualityGateReceipts') ?? []
  const sessions = rowsByTable.get('productRuntimeSessions') ?? []
  const events = rowsByTable.get('productRuntimeEvents') ?? []
  const checkpoints = rowsByTable.get('productRuntimeCheckpoints') ?? []
  const releases = rowsByTable.get('productReleases') ?? []
  const releasesById = new Map<number, any>()
  const releaseManifestsById = new Map<number, AnyProductReleaseManifest>()
  const buildsById = new Map<number, any>()
  const productionsById = new Map((rowsByTable.get('productProductions') ?? []).map(row => [row.id, row]))
  const buildPreviewVersions = new Map<number, 1 | 2>()
  const executableAvgBuilds = new Set<number>()
  const executableAvgPreviews = new Map<number, AnyProductBuildPreviewManifest>()
  const previewCodec = builds.length ? await import('../product-production/preview-manifest') : null
  for (const build of builds) {
    if (!Number.isSafeInteger(build.id) || build.id < 1 || buildsById.has(build.id)) {
      throw new Error('[deriveExport] ProductBuild 本地主键无效')
    }
    buildsById.set(build.id, build)
    try {
      const preview = await previewCodec!.verifyStoredProductBuildPreview(build, { ttrpgProtocol: 2 })
      if (preview) {
        const production = productionsById.get(build.productionId)
        if (!production || preview.productionKey !== production.productionKey
          || preview.runtimePackage.productType !== production.productType
          || build.projectId !== production.projectId || build.worldId !== production.worldId
          || build.workId !== production.workId) throw new Error('production-mismatch')
        buildPreviewVersions.set(build.id, preview.version)
        if (avgExecutableModule(preview.runtimePackage)) { executableAvgBuilds.add(build.id); executableAvgPreviews.set(build.id, preview) }
      }
    } catch (error) {
      throw new Error(`[deriveExport] ProductBuild Preview 无效:${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (qualityReceipts.length > 0) {
    const { verifyProductQualityGateReceiptRecordV1 } = await import('../product-production/quality-receipts')
    for (const row of qualityReceipts) {
      const build = buildsById.get(row.buildId)
      if (!build || row.projectId !== build.projectId || row.worldId !== build.worldId
        || row.workId !== build.workId) {
        throw new Error('[deriveExport] ProductQualityGateReceipt Build或owner无效')
      }
      try {
        await verifyProductQualityGateReceiptRecordV1(row)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`[deriveExport] ProductQualityGateReceipt 内容或Hash无效:${detail}`)
      }
    }
  }
  if (releases.length > 0) {
    const [runtimePackage, productionHash] = await Promise.all([
      import('../product-production/runtime-package'),
      import('../product-production/hash'),
    ])
    for (const release of releases) {
      if (!Number.isSafeInteger(release.id) || release.id < 1 || releasesById.has(release.id)) {
        throw new Error('[deriveExport] ProductRelease 本地主键无效')
      }
      try {
        const manifest = await runtimePackage.verifyProductReleaseManifest(release.manifestJson, { ttrpgProtocol: 2 })
        if (await productionHash.hashProductProductionValueV2(manifest) !== release.contentHash
          || release.productType !== manifest.productType
          || release.productionKey !== manifest.productionProvenance.productionKey
          || release.version !== manifest.lineage.releaseVersion) {
          throw new Error('release-root-mismatch')
        }
        releasesById.set(release.id, release)
        releaseManifestsById.set(release.id, manifest)
      } catch {
        throw new Error('[deriveExport] ProductRelease 内容、身份或Hash无效')
      }
    }
  }
  const sessionsById = new Map<number, any>()
  const sourceManifestContract = await import('../product/runtime-source-manifest')
  const briefsByRevision = new Map((rowsByTable.get('productProductionBriefs') ?? [])
    .map(brief => [`${brief.productionId}:${brief.revision}`, brief]))
  let migrationContract: typeof import('../open-world/player-save-migration-contract') | null = null
  for (const session of sessions) {
    if (!Number.isSafeInteger(session.id) || session.id < 1 || sessionsById.has(session.id)) {
      throw new Error('[deriveExport] ProductRuntimeSession 本地主键无效')
    }
    if ((session.productReleaseId != null && releaseManifestsById.get(session.productReleaseId)?.version === 2
      && !avgExecutableModule(releaseManifestsById.get(session.productReleaseId)!.runtimePackage))
      || (session.productBuildId != null && buildPreviewVersions.get(session.productBuildId) === 2 && !executableAvgBuilds.has(session.productBuildId))) {
      throw new Error('[deriveExport] V2 未登记可玩模块，不能包含运行会话')
    }
    const avgSource = (session.productReleaseId != null ? releaseManifestsById.get(session.productReleaseId) : executableAvgPreviews.get(session.productBuildId))
    if (avgSource && avgExecutableModule(avgSource.runtimePackage)) {
      const sourceRow = session.productReleaseId != null ? releasesById.get(session.productReleaseId) : buildsById.get(session.productBuildId)
      if (!sourceRow || ['projectId','worldId','workId'].some(key => session[key] !== sourceRow[key])) throw new Error('[deriveExport] AVG 会话跨 owner')
      if (session.runtimeSourceHash !== avgSource.packageHash) throw new Error('[avg] 备份会话来源 hash 不一致')
      const branchOrigin = await verifyAvgBranchOriginV1({ canonSnapshotJson: session.canonSnapshotJson,
        initialState: JSON.parse(session.initialStateJson), runtimeSourceHash: avgSource.packageHash })
      assertFrozenRuntimePackageSessionV1({ session: { kind: session.kind, initialState: parseProductRuntimeState(session.initialStateJson) },
        runtimePackage: avgSource.runtimePackage, runtimeSourceHash: avgSource.packageHash,
        origin: session.parentSessionId != null || branchOrigin ? 'branch' : session.productReleaseId != null ? 'release' : 'preview' })
    }
    sessionsById.set(session.id, session)
    let runtimeSourceManifest = null
    if (session.productReleaseId != null) {
      const manifest = releaseManifestsById.get(session.productReleaseId)
      if (!manifest) throw new Error('[deriveExport] ProductRuntimeSession 产品来源缺失')
      runtimeSourceManifest = await sourceManifestContract.runtimeSourceManifestFromReleaseV1(manifest)
    } else if (session.productBuildId != null) {
      const build = buildsById.get(session.productBuildId)
      const brief = build && briefsByRevision.get(`${build.productionId}:${build.briefRevision}`)
      if (!build || !brief) throw new Error('[deriveExport] ProductRuntimeSession 预览来源缺失')
      runtimeSourceManifest = await sourceManifestContract.runtimeSourceManifestFromBuildRecordsV1({ build, brief })
    }
    if (runtimeSourceManifest && (session.runtimeSourceHash !== runtimeSourceManifest.packageHash
      || session.kind !== runtimeSourceManifest.productType)) throw new Error('[deriveExport] ProductRuntimeSession 来源身份不一致')
    await assertProductRuntimeSourceSnapshotV3({ session, manifest: runtimeSourceManifest })
  }

  const sequencesBySession = new Map<number, Set<number>>()
  const eventsBySession = new Map<number, ProductRuntimeEvent[]>()
  for (const event of events) {
    const session = sessionsById.get(event.sessionId)
    if (!session || event.projectId !== session.projectId
      || (event.worldGroupId ?? null) !== (session.worldGroupId ?? null)
      || !Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      throw new Error('[deriveExport] ProductRuntimeEvent lineage 或序号无效')
    }
    const sequences = sequencesBySession.get(session.id) ?? new Set<number>()
    if (sequences.has(event.sequence)) {
      throw new Error('[deriveExport] ProductRuntimeEvent 序号重复')
    }
    sequences.add(event.sequence)
    sequencesBySession.set(session.id, sequences)
    const ownedEvents = eventsBySession.get(session.id) ?? []
    ownedEvents.push(event as ProductRuntimeEvent)
    eventsBySession.set(session.id, ownedEvents)
  }
  for (const [sessionId, sequences] of sequencesBySession) {
    const ordered = [...sequences].sort((left, right) => left - right)
    if (ordered.some((sequence, index) => sequence !== index + 1)) {
      throw new Error(`[deriveExport] ProductRuntimeEvent 序号不连续:${sessionId}`)
    }
  }

  for (const session of sessions) {
    const hasParent = session.parentSessionId != null
    const hasParentSequence = session.parentThroughSequence != null
    if (hasParent !== hasParentSequence) {
      throw new Error('[deriveExport] ProductRuntimeSession 分支 lineage 配对无效')
    }
    const upgradeReceipts = (eventsBySession.get(session.id) ?? []).filter(event => event.type === 'interaction.release.upgraded')
    if (upgradeReceipts.length > 1) throw new Error('[deriveExport] 升级回执不能重复')
    const upgradeReceipt = upgradeReceipts[0]
    if (upgradeReceipt) {
      const childManifest = releaseManifestsById.get(session.productReleaseId)
      if (!childManifest) throw new Error('[deriveExport] 角色聊天升级副本缺少冻结版本')
      if (childManifest.version !== 1 || childManifest.productType !== 'character-interaction') {
        throw new Error('[deriveExport] 角色聊天升级副本的发布协议或产品类型不匹配')
      }
      const contract = await import('../character-interaction/release-upgrade-branch')
      const {parseProductReleaseManifestV1} = await import('../product-production/runtime-package')

      await contract.verifyChatReleaseUpgradeReceiptV1({childSession: session, childManifest: parseProductReleaseManifestV1(childManifest), receipt: upgradeReceipt})
    }
    if (!hasParent) continue
    const parent = sessionsById.get(session.parentSessionId)
    const parentMaximumSequence = maximumRuntimeSequenceForExport(
      sequencesBySession.get(session.parentSessionId),
    )
    if (!parent || parent === session || !Number.isSafeInteger(session.parentThroughSequence)
      || session.parentThroughSequence < 0 || session.parentThroughSequence > parentMaximumSequence
      || parent.projectId !== session.projectId
      || (parent.worldGroupId ?? null) !== (session.worldGroupId ?? null)
      || parent.worldId !== session.worldId || parent.workId !== session.workId
      || parent.kind !== session.kind) {
      throw new Error('[deriveExport] ProductRuntimeSession 分支 lineage 或序号无效')
    }
    const sameSource = parent.runtimeSourceHash === session.runtimeSourceHash
      && parent.productReleaseId === session.productReleaseId
      && parent.productBuildId === session.productBuildId
    if (sameSource && !upgradeReceipt) continue
    if (parent.productReleaseId == null || session.productReleaseId == null
      || parent.productBuildId != null || session.productBuildId != null) {
      throw new Error('[deriveExport] ProductRuntimeSession 分支 lineage 或序号无效')
    }
    const parentRelease = releasesById.get(parent.productReleaseId)
    const childRelease = releasesById.get(session.productReleaseId)
    const parentManifest = releaseManifestsById.get(parent.productReleaseId)
    const childManifest = releaseManifestsById.get(session.productReleaseId)
    if (!parentRelease || !childRelease || !parentManifest || !childManifest
      || parentManifest.version !== 1 || childManifest.version !== 1) {
      throw new Error('[deriveExport] ProductRuntimeSession 迁移Release缺失')
    }
    if (parent.kind === 'ttrpg' && JSON.parse(session.initialStateJson).ttrpg?.openRun?.releaseContinuation) {
      const { assertTtrpgOpenContinuationParentV1 } = await import('../ttrpg/open-release-continuation-backup')
      const parentContent = parentManifest.runtimePackage.ttrpg, targetContent = childManifest.runtimePackage.ttrpg
      if (!parentContent || !targetContent || !isTtrpgRuntimeContentV2(parentContent) || !isTtrpgRuntimeContentV2(targetContent)
        || parent.runtimeSourceHash !== parentManifest.packageHash || session.runtimeSourceHash !== childManifest.packageHash) {
        throw new Error('[deriveExport] open 续团发布或冻结来源不一致')
      }
      await assertTtrpgOpenContinuationParentV1({ parent, child: session, parentEvents: eventsBySession.get(parent.id) ?? [],
        throughSequence: session.parentThroughSequence, parentContent, targetContent, targetRuntimePackage: childManifest.runtimePackage })
      continue
    }
    try {
      if (session.kind === 'character-interaction') {
        if (parentManifest.version !== 1 || childManifest.version !== 1
          || parentManifest.productType !== 'character-interaction' || childManifest.productType !== 'character-interaction') {
          throw new Error('[deriveExport] 角色聊天升级分支的发布协议或产品类型不匹配')
        }
        const contract = await import('../character-interaction/release-upgrade-branch')
        const {parseProductReleaseManifestV1} = await import('../product-production/runtime-package')

        await contract.verifyChatReleaseUpgradeBranchV1({parentSession: parent, childSession: session, parentManifest: parseProductReleaseManifestV1(parentManifest), childManifest: parseProductReleaseManifestV1(childManifest),
          parentEvents: eventsBySession.get(parent.id) ?? [], childEvents: eventsBySession.get(session.id) ?? []})
        continue
      }
      migrationContract ??= await import('../open-world/player-save-migration-contract')
      const { parseProductReleaseManifestV1 } = await import('../product-production/runtime-package')
      const sourceStateHash = await migrationContract.replayTextOpenWorldMigrationSourceStateHashV1({
        session: parent,
        events: eventsBySession.get(parent.id) ?? [],
        throughSequence: session.parentThroughSequence,
      })
      await migrationContract.verifyTextOpenWorldSaveMigrationBranchV1({
        parentSession: parent,
        childSession: session,
        parentRelease,
        childRelease,
        parentManifest: parseProductReleaseManifestV1(parentManifest),
        childManifest: parseProductReleaseManifestV1(childManifest),
        sourceStateHash,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`[deriveExport] ProductRuntimeSession 迁移lineage无效:${detail}`)
    }
  }
  for (const session of sessions) {
    const seen = new Set<number>([session.id])
    let parentSessionId = session.parentSessionId
    while (parentSessionId != null) {
      if (seen.has(parentSessionId)) {
        throw new Error('[deriveExport] ProductRuntimeSession 分支 lineage 形成循环')
      }
      seen.add(parentSessionId)
      parentSessionId = sessionsById.get(parentSessionId)?.parentSessionId ?? null
    }
  }

  if (checkpoints.length > 0) {
    const runtimeCore = await import('../product/runtime-core')
    for (const checkpoint of checkpoints) {
      let parsed
      try {
        parsed = runtimeCore.parseProductRuntimeCheckpointV1(checkpoint)
      } catch {
        throw new Error('[deriveExport] ProductRuntimeCheckpoint 内容、purpose、序号或 Hash 无效')
      }
      const session = sessionsById.get(parsed.sessionId)
      if (!session || parsed.projectId !== session.projectId
        || parsed.worldGroupId !== (session.worldGroupId ?? null)
        || parsed.throughSequence > maximumRuntimeSequenceForExport(
          sequencesBySession.get(parsed.sessionId),
        )
        || await runtimeCore.hashStateJson(parsed.stateJson) !== parsed.stateHash) {
        throw new Error('[deriveExport] ProductRuntimeCheckpoint 内容、purpose、序号或 Hash 无效')
      }
    }
  }
}
