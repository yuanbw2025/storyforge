import { assertFrozenRuntimePackageSessionV1, parseProductRuntimeState } from '../product/runtime-core'
import type { AnyProductBuildPreviewManifest } from '../types'
import { avgExecutableModule } from '../avg/executable-module'
import { verifyAvgBranchOriginV1 } from '../avg/branch-origin'
import { isTtrpgRuntimeContentV2 } from '../ttrpg/content-version'
/**
 * 注册表派生的项目导出引擎(AUDIT-1)
 *
 * 取代 json-export.ts 中 580 行手写枚举:遍历 PROJECT_TABLES 中 exportable 的表,
 * 按其元数据(worldScoped / tree / exportRemap / exportIdField / exportRefRemap)自动
 * 把库内记录转成可移植的 ProjectExportData——加新表只需在注册表登记一行,自动进出导出。
 *
 * 输出只遵循当前便携备份契约；不存在历史格式分支。
 */
import Dexie from 'dexie'
import { prepareProductBuildRootBudgetEvidenceExportV1 } from '../product-production/root-budget-evidence-portability'
import { db } from '../db/schema'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../registry/project-tables'
import { parseWorldPortals, remapWorldPortalTargets } from '../utils/world-portals'
import type { TableSpec } from '../registry/types'
import type { ProjectExportData } from './json-export'
import { redactAuthoringSecrets } from '../node-authoring/contracts'
import { resolveWorkspaceOwnership } from '../workspace/ownership'
import { portableizeAgentRunLedgerExportV1 } from '../agent/run/ledger-portability'
import { assertAgentRunArtifactRecordIntegrityV1 } from '../memory/artifact-record'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { assertProductRuntimeSourceSnapshotV3 } from '../product/runtime-source-branch'
import { remapNarrativeDomainFieldV1 } from '../narrative-domain/references'
import { assertNarrativeDomainReferenceRowsV1 } from '../narrative-domain/integrity'
import { assertNarrativeLineageRowsV1 } from '../world-engine/narrative-lineage-lifecycle'
import type { AnyProductReleaseManifest, ProductRuntimeEvent } from '../types'
import { mapNarrativeDomainReferencesV1 } from '../narrative-domain/codec'
import { narrativeDomainReferenceTargetV1 } from '../narrative-domain/references'
import { canonicalNarrativeJsonV1, compareUnicodeCodePointsV1 } from '../narrative-domain/json'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'

/** 当前完整便携备份契约。 */
export const CURRENT_EXPORT_VERSION = 17

export interface StrictProjectExportSnapshot {
  data: ProjectExportData
  exportIds: ReadonlyMap<string, ReadonlyMap<number, number>>
}

/** The release compiler supplies an already captured semantic scope. Reuse
 * the backup encoder without reading or materializing product/media tables.
 * Unlike a best-effort backup, an explicit release selection may not silently
 * drop a row or turn a live reference into a tombstone. */
export function deriveRegisteredSemanticRowsV1(input: {
  rows: ReadonlyMap<string, readonly Record<string, unknown>[]>
  worldId: number
  workId: number
}): { records: Record<string, Record<string, unknown>[]>; exportIds: Map<string, Map<number, number>> } {
  assertNarrativeDomainReferenceRowsV1(new Map([
    ...input.rows,
    ['worlds', [{ id: input.worldId }]],
    ['works', [{ id: input.workId, worldId: input.worldId }]],
  ]), 'local')
  const idMaps = new Map<string, Map<number, number>>([
    ['worlds', new Map([[input.worldId, 0]])], ['works', new Map([[input.workId, 0]])],
  ])
  const ordered = new Map<string, Record<string, unknown>[]>()
  for (const [table, rows] of input.rows) {
    const spec = REGISTRY_BY_NAME.get(table)
    if (!spec?.worldSemantic || !spec.resourceIdentity || !spec.exportable) throw new Error(`[semanticExport] ${table} 未登记为可发布语义`)
    const identity = spec.resourceIdentity
    const seen = new Set<string>(), ids = new Map<number, number>()
    for (const row of rows) {
      const uid = row[identity.field]
      if (!isPortableResourceUidV1(uid, identity.resourceKind) || seen.has(uid.toLowerCase())
        || !Number.isSafeInteger(row.id) || (row.id as number) <= 0) throw new Error(`[semanticExport] ${table} 稳定身份缺失或重复`)
      seen.add(uid.toLowerCase())
    }
    const sorted = [...rows].sort((a, b) => compareUnicodeCodePointsV1(String(a[identity.field]), String(b[identity.field])))
    sorted.forEach((row, index) => {
      if (ids.has(row.id as number)) throw new Error(`[semanticExport] ${table} 本地坐标重复`)
      ids.set(row.id as number, index)
    })
    ordered.set(table, sorted); idMaps.set(table, ids)
  }
  const records: Record<string, Record<string, unknown>[]> = {}
  const exactArray = (value: unknown, label: string): unknown[] => {
    if (value === undefined || value === null || value === '') return []
    if (typeof value === 'string') {
      try { value = JSON.parse(value) } catch { throw new Error(`[semanticExport] ${label} 不是合法数组`) }
    }
    if (!Array.isArray(value)) throw new Error(`[semanticExport] ${label} 不是合法数组`)
    return value
  }
  const cleanOptionalFields = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(cleanOptionalFields)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, cleanOptionalFields(item)]))
    }
    return value
  }
  for (const [table, rows] of ordered) {
    const spec = REGISTRY_BY_NAME.get(table)!
    records[table] = rows.map((row, index) => {
      for (const ref of spec.exportRemap ?? []) {
        const id = row[ref.field]
        if (id == null && (ref.onUnmapped === 'require' || ref.onUnmapped === 'drop')) throw new Error(`[semanticExport] ${table}.${ref.field} 必填引用缺失`)
        if (id != null && !idMaps.get(ref.selfTree ? table : ref.remapVia)?.has(id as number)) {
          throw new Error(`[semanticExport] ${table}.${ref.field} 引用不在封存范围内`)
        }
      }
      for (const ref of spec.exportRefRemap ?? []) {
        if (ref.kind === 'narrative-source-refs-v1') {
          if (row[ref.field] !== undefined) mapNarrativeDomainReferencesV1(ref.field, row[ref.field], source => {
            const target = narrativeDomainReferenceTargetV1(source)
            if (target.id !== null && !idMaps.get(target.table)?.has(target.id)) throw new Error(`[semanticExport] ${table}.${ref.field} 证据或依赖未选入`)
            return source
          })
          continue
        }
        const requireTarget = (id: unknown) => {
          if (!Number.isSafeInteger(id) || !idMaps.get(ref.remapVia)?.has(id as number)) throw new Error(`[semanticExport] ${table}.${ref.field} 嵌套引用未选入`)
        }
        const items = exactArray(row[ref.field], `${table}.${ref.field}`)
        if (ref.kind === 'id-array') items.forEach(requireTarget)
        else if (ref.kind === 'scene-character-ids') for (const scene of items) {
          if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw new Error(`[semanticExport] ${table}.${ref.field} 场景无效`)
          exactArray((scene as Record<string, unknown>).characterIds, `${table}.${ref.field}.characterIds`).forEach(requireTarget)
        }
        else if (ref.kind === 'portals') {
          const portals = parseWorldPortals(row[ref.field] as string | undefined)
          if (items.length !== portals.length) throw new Error(`[semanticExport] ${table}.${ref.field} 通道无效`)
          portals.forEach(portal => requireTarget(portal.targetWorldId))
        } else if (row[ref.field] !== undefined) throw new Error(`[semanticExport] ${table}.${ref.field} 需要新的语义导出版本`)
      }
      const portable = toExportRow(spec, row, index, idMaps, true)
      if (!portable) throw new Error(`[semanticExport] ${table} 不能丢弃已选来源`)
      for (const ref of spec.exportRefRemap ?? []) if (ref.kind === 'scene-character-ids' && Array.isArray(portable[ref.field])) {
        portable[ref.field] = portable[ref.field].map((scene: Record<string, unknown>) => ({ ...scene, characterIds: [] }))
      }
      const cleaned = cleanOptionalFields(portable) as Record<string, unknown>
      canonicalNarrativeJsonV1(cleaned)
      return cleaned
    })
  }
  return { records, exportIds: idMaps }
}

interface CapturedProjectExportSnapshot extends StrictProjectExportSnapshot {
  integrityRows: ReadonlyMap<string, readonly any[]>
}

function maximumRuntimeSequenceForExport(sequences: ReadonlySet<number> | undefined): number {
  let maximum = 0
  for (const sequence of sequences ?? []) maximum = Math.max(maximum, sequence)
  return maximum
}

/** Fail closed before a corrupt runtime tree or derived checkpoint leaves IndexedDB. */
async function assertProductRuntimeExportIntegrityV1(
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

/** 取一张 exportable 表的库内记录(项目级按 projectId;direct-child 经 projectResolver) */
async function queryRows(spec: TableSpec, projectId: number): Promise<any[]> {
  if (spec.owner === 'project') {
    const coll = (db as any)[spec.name].where('projectId').equals(projectId)
    return spec.exportOrderBy ? await coll.sortBy(spec.exportOrderBy) : await coll.toArray()
  }
  // direct-child / indirect:用 projectResolver 拿父键,再用关联字段 anyOf 查
  if (!spec.projectResolver) return []
  const parentIds = await spec.projectResolver(projectId)
  if (!parentIds.length) return []
  const linkRemap = (spec.exportRemap ?? []).find(rm => REGISTRY_BY_NAME.get(rm.remapVia)?.owner === 'project')
  if (!linkRemap) return []
  return await (db as any)[spec.name].where(linkRemap.field).anyOf(parentIds).toArray()
}

/** 把一行库记录转成导出对象(剥 id/projectId、外键→导出序号、写 _exportId、JSON 引用重映射) */
function toExportRow(
  spec: TableSpec,
  row: any,
  index: number,
  idMaps: Map<string, Map<number, number>>,
  strictOwners = false,
): any | null {
  const obj: any = { ...row }
  delete obj.id
  if ('projectId' in obj) delete obj.projectId

  for (const rm of spec.exportRemap ?? []) {
    const val = obj[rm.field]
    delete obj[rm.field]
    const targetMap = rm.selfTree ? idMaps.get(spec.name) : idMaps.get(rm.remapVia)
    let mapped: number | null = null
    if (val != null) {
      const got = targetMap?.get(val)
      mapped = got ?? null
      if (got == null && rm.onUnmapped === 'drop') return null // 孤儿行丢弃
    }
    obj[rm.exportAs] = mapped
  }

  if (spec.exportIdField) obj._exportId = index

  for (const rr of spec.exportRefRemap ?? []) {
    if (rr.kind === 'narrative-source-refs-v1') {
      if (Object.prototype.hasOwnProperty.call(obj, rr.field)) {
        obj[rr.exportAs] = remapNarrativeDomainFieldV1(rr.field, obj[rr.field], 'export', idMaps)
        delete obj[rr.field]
      }
    } else if (rr.kind === 'portals') {
      const map = idMaps.get(rr.remapVia)
      obj[rr.field] = remapWorldPortalTargets(obj[rr.field], (targetId: number) => map?.get(targetId))
    } else if (rr.kind === 'id-array') {
      const map = idMaps.get(rr.remapVia)
      const raw = parseIdArray(obj[rr.field])
      const mapped = raw.map(id => map?.get(id))
      if (rr.onUnmapped === 'require' && mapped.some(id => id == null)) {
        throw new Error(`[deriveExport] ${spec.name}.${rr.field} 缺少必填引用映射`)
      }
      obj[rr.exportAs] = mapped.filter((id): id is number => id != null)
      // Portable shadow indexes are authoritative; local numeric IDs must not
      // leak into or destabilize a later restore.
      if (strictOwners) delete obj[rr.field]
    } else if (rr.kind === 'scene-character-ids') {
      const map = idMaps.get(rr.remapVia)
      obj[rr.exportAs] = Array.isArray(obj[rr.field])
        ? obj[rr.field].map((scene: any) => Array.isArray(scene?.characterIds)
          ? scene.characterIds.map((id: unknown) => typeof id === 'number' ? map?.get(id) : undefined).filter((id: unknown): id is number => typeof id === 'number')
          : [])
        : []
    } else if (rr.kind === 'object-array-id') {
      const map = idMaps.get(rr.remapVia)
      const items = parseObjectArray(obj[rr.field])
      obj[rr.exportAs] = items.map(item => {
        const id = item[rr.itemField]
        return typeof id === 'number' ? (map?.get(id) ?? null) : null
      })
      if (strictOwners) {
        const sanitized = items.map(item => rr.itemField in item ? { ...item, [rr.itemField]: null } : item)
        obj[rr.field] = rr.storage === 'json-string' ? JSON.stringify(sanitized) : sanitized
      }
    } else if (rr.kind === 'json-id-paths') {
      obj[rr.exportAs] = remapJsonIdPathsForExport(
        obj[rr.field],
        rr.paths,
        idMaps.get(rr.remapVia),
        rr.onUnmapped ?? 'null',
        `${spec.name}.${rr.field}`,
        rr.keyedMaps,
      )
      // The portable shadow is authoritative. Never leak embedded local IDs
      // into either ordinary or strict backups.
      delete obj[rr.field]
    }
  }

  if (strictOwners && spec.name !== 'worlds' && spec.name !== 'works') {
    const locator = spec.domainOwner?.locator
    if (locator?.kind === 'field' && (locator.owner === 'world' || locator.owner === 'work')) {
      const ownerMap = idMaps.get(locator.owner === 'world' ? 'worlds' : 'works')
      const portableId = ownerMap?.get(row[locator.field])
      if (portableId == null) throw new Error(`[strictExport] ${spec.name}.${locator.field} 缺失或越界`)
      obj[locator.owner === 'world' ? '_worldOwnerExportId' : '_workOwnerExportId'] = portableId
      delete obj.worldId
      delete obj.workId
    } else if (locator?.kind === 'exclusive-fields') {
      const hasWorld = row[locator.worldField] != null
      const hasWork = row[locator.workField] != null
      if (hasWorld === hasWork) throw new Error(`[strictExport] ${spec.name} 必须且只能有一个 owner`)
      const kind = hasWorld ? 'world' : 'work'
      const portableId = idMaps.get(kind === 'world' ? 'worlds' : 'works')
        ?.get(row[hasWorld ? locator.worldField : locator.workField])
      if (portableId == null) throw new Error(`[strictExport] ${spec.name} owner 缺失或越界`)
      obj[kind === 'world' ? '_worldOwnerExportId' : '_workOwnerExportId'] = portableId
      delete obj.worldId
      delete obj.workId
    } else if (locator?.kind === 'exclusive-work-instance') {
      const hasWork = row[locator.workField] != null
      const hasInstance = row[locator.instanceField] != null
      if (hasWork === hasInstance) throw new Error(`[strictExport] ${spec.name} 必须且只能有一个 Work/Instance owner`)
      if (hasWork) {
        const portableId = idMaps.get('works')?.get(row[locator.workField])
        if (portableId == null) throw new Error(`[strictExport] ${spec.name} Work owner 缺失或越界`)
        obj._workOwnerExportId = portableId
      } else if (!Number.isInteger(obj._productRuntimeSessionExportId)) {
        throw new Error(`[strictExport] ${spec.name} Instance owner 缺失或越界`)
      } else {
        obj._instanceOwnerExportId = obj._productRuntimeSessionExportId
      }
      delete obj[locator.workField]
      delete obj[locator.instanceField]
    }
  }

  return spec.name === 'nodeFlows' || spec.name === 'nodeRuns'
    ? redactAuthoringSecrets(obj)
    : obj
}

function remapJsonIdPathsForExport(
  value: unknown,
  paths: readonly string[],
  idMap: Map<number, number> | undefined,
  onUnmapped: 'require' | 'require-if-present' | 'null',
  label: string,
  keyedMaps?: readonly { path: string; keyFields: readonly string[]; separator: string }[],
): string | null {
  if (value == null) return null
  let parsed: unknown
  try { parsed = typeof value === 'string' ? JSON.parse(value) : structuredClone(value) } catch {
    throw new Error(`[deriveExport] ${label} 不是合法 JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[deriveExport] ${label} 必须是 JSON 对象`)
  }
  for (const path of paths) {
    const parts = path.split('.').filter(Boolean)
    const field = parts[parts.length - 1]
    if (!field) continue
    const owners: Array<Record<string, unknown>> = []
    const visit = (value: unknown, index: number): void => {
      if (!value || typeof value !== 'object') {
        if (onUnmapped === 'require') throw new Error(`[deriveExport] ${label}.${path} 缺失`)
        return
      }
      const part = parts[index]
      if (Array.isArray(value)) {
        if (part === '*') {
          for (const child of value) visit(child, index + 1)
          return
        }
        if (onUnmapped === 'require') throw new Error(`[deriveExport] ${label}.${path} 缺失`)
        return
      }
      const owner = value as Record<string, unknown>
      if (index >= parts.length - 1) {
        owners.push(owner)
        return
      }
      if (part === '*') {
        for (const child of Object.values(owner)) visit(child, index + 1)
        return
      }
      if (!(part in owner)) {
        if (onUnmapped === 'require') throw new Error(`[deriveExport] ${label}.${path} 缺失`)
        return
      }
      visit(owner[part], index + 1)
    }
    visit(parsed, 0)
    for (const owner of owners) {
      if (!(field in owner)) {
        if (onUnmapped === 'require') throw new Error(`[deriveExport] ${label}.${path} 缺失`)
        if (onUnmapped === 'require-if-present') continue
      }
      const localId = owner[field]
      if (localId == null) {
        if (onUnmapped !== 'null') {
          throw new Error(`[deriveExport] ${label}.${path} 缺少便携映射`)
        }
        owner[field] = null
        continue
      }
      const portableId = typeof localId === 'number' ? idMap?.get(localId) : undefined
      if (portableId == null && onUnmapped !== 'null') {
        throw new Error(`[deriveExport] ${label}.${path} 缺少便携映射`)
      }
      owner[field] = portableId ?? null
    }
  }
  for (const keyed of keyedMaps ?? []) {
    const parts = keyed.path.split('.').filter(Boolean)
    let owner = parsed as Record<string, unknown>
    let missing = false
    for (const part of parts.slice(0, -1)) {
      const child = owner[part]
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        if (onUnmapped === 'require-if-present') {
          missing = true
          break
        }
        throw new Error(`[deriveExport] ${label}.${keyed.path} keyed map 缺失`)
      }
      owner = child as Record<string, unknown>
    }
    if (missing) continue
    const field = parts[parts.length - 1]
    if (field && !(field in owner) && onUnmapped === 'require-if-present') continue
    const current = field ? owner[field] : undefined
    if (!field || !current || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`[deriveExport] ${label}.${keyed.path} keyed map 无效`)
    }
    const rebuilt: Record<string, unknown> = {}
    for (const value of Object.values(current as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`[deriveExport] ${label}.${keyed.path} keyed map value 无效`)
      }
      const row = value as Record<string, unknown>
      const values = keyed.keyFields.map(key => row[key])
      if (values.some(candidate => typeof candidate !== 'string' && typeof candidate !== 'number')) {
        throw new Error(`[deriveExport] ${label}.${keyed.path} keyed map identity 无效`)
      }
      const key = values.map(String).join(keyed.separator)
      if (!key || key in rebuilt) {
        throw new Error(`[deriveExport] ${label}.${keyed.path} keyed map identity 重复`)
      }
      rebuilt[key] = value
    }
    owner[field] = rebuilt
  }
  return JSON.stringify(parsed)
}

function parseObjectArray(value: unknown): Array<Record<string, unknown>> {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return [] }
  }
  return Array.isArray(parsed)
    ? parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : []
}

function parseIdArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.filter((id): id is number => typeof id === 'number')
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch {
    return []
  }
}

/** 派生当前架构的完整、严格便携备份。 */
export async function deriveExportProjectJSON(projectId: number): Promise<ProjectExportData> {
  return deriveStrictExportProjectJSON(projectId)
}

async function captureProjectExportInTransaction(
  projectId: number,
  version: number,
  strictOwners: boolean,
): Promise<CapturedProjectExportSnapshot> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')

  const specs = PROJECT_TABLES.filter(s => s.exportable && s.name !== 'projects')

  // 第一遍:查询每张表 + 建 dbId → 导出序号 映射
  const rowsByTable = new Map<string, any[]>()
  const idMaps = new Map<string, Map<number, number>>()
  // Schedule every registered read before awaiting. With 100+ tables, a
  // sequential chain can leave IndexedDB without a pending request between
  // empty-table resolutions and let the browser auto-commit the snapshot.
  const capturedRows = await Promise.all(specs.map(async spec => ({
    spec,
    rows: await queryRows(spec, projectId),
  })))
  for (const { spec, rows } of capturedRows) {
    rowsByTable.set(spec.name, rows)
    const idMap = new Map<number, number>()
    rows.forEach((r, i) => { if (r.id != null) idMap.set(r.id, i) })
    idMaps.set(spec.name, idMap)
  }
  assertNarrativeDomainReferenceRowsV1(rowsByTable, 'local')
  await Dexie.waitFor(assertNarrativeLineageRowsV1(rowsByTable, 'local'))
  // 第二遍:逐行转导出对象
  const projectSpec = REGISTRY_BY_NAME.get('projects')
  if (!projectSpec) throw new Error('[deriveExport] PROJECT_TABLES 缺少 projects 根表')
  const projectData = toExportRow(projectSpec, project, 0, idMaps, strictOwners)
  const result: any = {
    version,
    exportedAt: Date.now(),
    project: projectData,
  }
  for (const spec of specs) {
    const rows = rowsByTable.get(spec.name)!
    const out: any[] = []
    rows.forEach((row, i) => {
      const exported = toExportRow(spec, row, i, idMaps, strictOwners)
      if (exported != null) out.push(exported)
    })
    result[spec.name] = out
  }

  return { data: result as ProjectExportData, exportIds: idMaps, integrityRows: rowsByTable }
}

async function captureProjectExport(projectId: number, version: number, strictOwners: boolean): Promise<CapturedProjectExportSnapshot> {
  const tables = [...new Set(PROJECT_TABLES.filter(spec => spec.exportable).map(spec => spec.table))]
  const captured = await db.transaction(
    'r',
    tables,
    () => captureProjectExportInTransaction(projectId, version, strictOwners),
  )
  // Dynamic Creator-release validators and WebCrypto run against the immutable
  // rows captured by the read transaction. Keeping them outside IndexedDB
  // avoids both premature auto-commit and an artificial Dexie.waitFor lock.
  await assertProductRuntimeExportIntegrityV1(captured.integrityRows)
  return captured
}

async function portableizeSnapshot(snapshot: CapturedProjectExportSnapshot, options: { freezeContextEvidence?: boolean } = {}): Promise<StrictProjectExportSnapshot> {
  if (PROJECT_TABLES.some(spec => spec.portableData?.kind === 'product-build-root-budget')) {
    await prepareProductBuildRootBudgetEvidenceExportV1({
      data: snapshot.data, originalRows: snapshot.integrityRows, exportIds: snapshot.exportIds,
    })
  }
  if (PROJECT_TABLES.some(spec => spec.portableData?.kind === 'agent-run-root')) {
    const portableLedger = portableizeAgentRunLedgerExportV1(snapshot.data, snapshot.exportIds, options)
    if (Dexie.currentTransaction) await Dexie.waitFor(portableLedger)
    else await portableLedger
  }
  const portable = snapshot.data as unknown as Record<string, unknown>
  for (const spec of PROJECT_TABLES) {
    if (spec.portableData?.kind === 'exact-run-artifact') {
      const rows = portable[spec.name]
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        await assertAgentRunArtifactRecordIntegrityV1(row as any, { requireProjectId: false })
      }
      continue
    }
    if (spec.portableData?.kind !== 'shared-media-object') continue
    const rows = portable[spec.name]
    if (!Array.isArray(rows)) continue
    for (const row of rows as Array<Record<string, unknown>>) {
      const portableData: NonNullable<TableSpec['portableData']> = spec.portableData
      const dataField = portableData.dataField
      const value = row[dataField]
      const blobLike = value as { arrayBuffer?: () => Promise<ArrayBuffer>; type?: string } | null
      let buffer = value instanceof ArrayBuffer
        ? value
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer
          : blobLike && typeof blobLike.arrayBuffer === 'function'
            ? (Dexie.currentTransaction ? await Dexie.waitFor(blobLike.arrayBuffer()) : await blobLike.arrayBuffer())
            : null
      if (!buffer) {
        const read = readVerifiedMediaBlobObjectData(
          row as unknown as import('../types').MediaBlobObjectRecordV1,
        )
        buffer = Dexie.currentTransaction ? await Dexie.waitFor(read) : await read
      }
      if (!buffer) throw new Error(`[deriveExport] ${spec.name}.${dataField} 不是便携二进制`)

      let mimeType = blobLike?.type || 'application/octet-stream'
      if (row[portableData.stateField] !== 'ready') {
        throw new Error(`[deriveExport] ${spec.name} 只允许导出 ready 共享媒资`)
      }
      if (row[portableData.sizeField] !== buffer.byteLength) {
        throw new Error(`[deriveExport] ${spec.name} 二进制大小与记录不一致`)
      }
      const digestPromise = crypto.subtle.digest('SHA-256', buffer)
      const digest = Dexie.currentTransaction ? await Dexie.waitFor(digestPromise) : await digestPromise
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      if (row[portableData.hashField] !== hash) {
        throw new Error(`[deriveExport] ${spec.name} 二进制哈希与记录不一致`)
      }
      const declaredMime = row[portableData.mimeField]
      if (typeof declaredMime !== 'string' || !declaredMime.trim()) {
        throw new Error(`[deriveExport] ${spec.name} 缺少 MIME 类型`)
      }
      mimeType = declaredMime
      row[portableData.backendField] = 'indexeddb'
      row[portableData.pathField] = null
      row[portableData.leaseOwnerField] = null
      row[portableData.leaseExpiresAtField] = null
      // Verification time belongs to the local storage copy, not to the
      // content-addressed portable object. A restore verifies the bytes again;
      // exporting that local timestamp would make an unchanged round-trip
      // appear different on every machine/import.
      row[portableData.lastVerifiedAtField] = null
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      }
      row[dataField] = `data:${mimeType};base64,${btoa(binary)}`
    }
  }
  return snapshot
}

/**
 * 当前架构的唯一导出路径。逻辑 World/Work 所有权只使用便携影子 ID，
 * 物理主键绝不跨越备份边界。
 */
export async function deriveStrictExportProjectJSON(projectId: number): Promise<ProjectExportData> {
  return (await deriveStrictExportProjectSnapshot(projectId)).data
}

export async function deriveStrictExportProjectSnapshot(projectId: number): Promise<StrictProjectExportSnapshot> {
  const ownership = await resolveWorkspaceOwnership(projectId)
  const captured = await captureProjectExport(projectId, CURRENT_EXPORT_VERSION, true)
  const snapshot = await Dexie.ignoreTransaction(() => portableizeSnapshot(captured))
  const worldExportId = snapshot.exportIds.get('worlds')?.get(ownership.scope.worldId)
  const workExportId = snapshot.exportIds.get('works')?.get(ownership.scope.workId)
  if (worldExportId == null || workExportId == null) throw new Error('[strictExport] ownership 根不在导出快照中')
  snapshot.data.ownership = {
    contractVersion: 1,
    worldExportId,
    workExportId,
  }
  if (!ownership.scope.worldId || !ownership.scope.workId) throw new Error('[strictExport] ownership 根不完整')
  return snapshot
}

/**
 * Capture a strict portable snapshot inside a caller-owned Dexie transaction.
 * World-release freezing uses this boundary so the source rows and release
 * manifest are observed atomically instead of nesting another transaction.
 */
export async function deriveStrictExportProjectSnapshotInCurrentTransaction(
  projectId: number,
  ownership: { worldId: number; workId: number },
): Promise<StrictProjectExportSnapshot> {
  if (!Dexie.currentTransaction) {
    throw new Error('[strictExport] 当前事务快照只能在已打开的 Dexie 事务中派生')
  }
  const captured = await captureProjectExportInTransaction(projectId, CURRENT_EXPORT_VERSION, true)
  // Conversion reads only the captured rows. Start it outside the transaction
  // context while waitFor keeps the caller's snapshot alive.
  // Passing an already-running promise would let inner hash/blob keepalives
  // join the same wait chain and prevent it from completing.
  const snapshot = await Dexie.waitFor(Dexie.ignoreTransaction(() => portableizeSnapshot(captured, { freezeContextEvidence: false })))
  const worldExportId = snapshot.exportIds.get('worlds')?.get(ownership.worldId)
  const workExportId = snapshot.exportIds.get('works')?.get(ownership.workId)
  if (worldExportId == null || workExportId == null) {
    throw new Error('[strictExport] 当前事务的 ownership 根不在导出快照中')
  }
  snapshot.data.ownership = { contractVersion: 1, worldExportId, workExportId }
  return snapshot
}
