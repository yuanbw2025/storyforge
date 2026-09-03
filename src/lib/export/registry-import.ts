/**
 * 注册表派生的项目导入引擎(AUDIT-1)
 *
 * 取代 json-export.ts 中手写的逐表导入:按表依赖拓扑排序(被引用表先于引用方)遍历
 * exportable 表,树表内再按 _parentExportId 拓扑排序,逐行把导出序号外键重映射回新 db id。
 * 加新表只需在注册表登记一行,自动进出导入。
 *
 * 必填外键(onUnmapped: 'require')缺失映射 → 抛错整体回滚(完整性保护);孤儿(onUnmapped:
 * 'drop')跳过该行;portals 等 JSON 自引用走两阶段(先建全表映射,再回填重映射)。
 */
import Dexie from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import { backfillResourceUidsInCurrentTransactionV1 } from '../context-gateway/resource-identity'
import { remapWorldPortalTargets } from '../utils/world-portals'
import { transactionTablesFor } from '../registry/lifecycle'
import { importLegacyArraysToCodex } from '../migrations/legacy-to-codex-upgrade'
import { migrateStateCardsToTemporalFactCandidates } from '../migrations/state-cards-to-temporal-facts'
import type { TableSpec } from '../registry/types'
import type { ProjectExportData } from './json-export'
import { upgradeImportedCharacterAxesV32 } from '../migrations/character-axes-upgrade'
import { ensureWorkspaceOwnership } from '../workspace/ownership'
import { rebindPortableAgentRunContractV1 } from '../agent/run/contract-portability'
import { finalizeImportedAgentRunLedgersV1 } from '../agent/run/ledger-portability'
import {
  generateWorkspaceUid,
  generateWorkCode,
  isWorkspaceUid,
  isWorkCode,
} from '../memory/identity'
import { assertAgentRunArtifactRecordIntegrityV1 } from '../memory/artifact-record'
import { assertStoredWorkClassification } from '../workspace/work-kind'
import { assertAdaptationProjectInvariant } from '../adaptation/contracts'
import { validateScreenplayBlocksV1 } from '../screenplay/contracts'
import { assertComicLetteringV1, assertComicMediaAssetV1, assertNormalizedFrameV1, framesOverlap } from '../comic/contracts'
import type { AdaptationProject, ComicLetteringItemV1, ComicMediaAsset, ScreenplayBlock, Work } from '../types'
import { PRODUCTION_PRODUCT_KINDS_V1 } from '../types'

const PORTABLE_OWNER_VERSION = 4
const WORK_CLASSIFICATION_VERSION = 5
const ADAPTATION_VERSION = 6
const SCREENPLAY_VERSION = 7
const COMIC_STORYBOARD_VERSION = 8
const COMIC_MEDIA_VERSION = 9
const PRODUCT_ARCHITECTURE_VERSION = 10

function portableRows(value: Record<string, any>, name: string): Record<string, any>[] {
  const rows = value[name]
  if (!Array.isArray(rows)) throw new Error(`[deriveImport] v10 备份缺少 ${name}`)
  const ids = new Set<number>()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !Number.isInteger(row._exportId) || ids.has(row._exportId)) {
      throw new Error(`[deriveImport] v10 ${name} 便携 ID 重复或无效`)
    }
    ids.add(row._exportId)
  }
  return rows
}

function validateProductArchitectureBackup(value: Record<string, any>): void {
  const productKinds = new Set<string>(PRODUCTION_PRODUCT_KINDS_V1)
  const productions = new Map(portableRows(value, 'productProductions').map(row => [row._exportId, row]))
  const briefs = portableRows(value, 'productProductionBriefs')
  const commands = portableRows(value, 'productProductionCommands')
  const builds = new Map(portableRows(value, 'productBuilds').map(row => [row._exportId, row]))
  const artifacts = portableRows(value, 'productBuildArtifacts')
  const receipts = portableRows(value, 'productQualityGateReceipts')
  const releases = new Map(portableRows(value, 'productReleases').map(row => [row._exportId, row]))
  const runtimeSessions = portableRows(value, 'productRuntimeSessions')
  const runtimeSessionById = new Map(runtimeSessions.map(row => [row._exportId, row]))
  const mediaAssets = portableRows(value, 'productMediaAssets')
  portableRows(value, 'productRuntimeEvents')
  portableRows(value, 'productRuntimeCheckpoints')
  const worldReleases = new Map(portableRows(value, 'worldReleases').map(row => [row._exportId, row]))

  for (const production of productions.values()) {
    if (!productKinds.has(production.productType) || typeof production.productionKey !== 'string' || !production.productionKey.trim()) {
      throw new Error('[deriveImport] v10 ProductProduction 身份无效')
    }
  }
  const sameOwner = (child: Record<string, any>, parent: Record<string, any>, label: string) => {
    if (child._worldExportId !== parent._worldExportId || child._workExportId !== parent._workExportId) {
      throw new Error(`[deriveImport] v10 ${label} owner 与父记录不一致`)
    }
  }
  for (const brief of briefs) {
    const production = productions.get(brief._productionExportId)
    const worldRelease = worldReleases.get(brief._sourceWorldReleaseExportId)
    if (!production || !worldRelease) throw new Error('[deriveImport] v10 ProductBrief 来源引用越界')
    sameOwner(brief, production, 'ProductBrief')
    if (brief._worldExportId !== worldRelease._worldExportId) {
      throw new Error('[deriveImport] v10 ProductBrief 与 WorldRelease 世界不一致')
    }
  }
  for (const command of commands) {
    const production = productions.get(command._productionExportId)
    if (!production) throw new Error('[deriveImport] v10 ProductCommand 生产引用越界')
    sameOwner(command, production, 'ProductCommand')
  }
  for (const build of builds.values()) {
    const production = productions.get(build._productionExportId)
    if (!production) throw new Error('[deriveImport] v10 ProductBuild 生产引用越界')
    sameOwner(build, production, 'ProductBuild')
  }
  for (const row of [...artifacts, ...receipts]) {
    const build = builds.get(row._buildExportId)
    if (!build) throw new Error('[deriveImport] v10 Build 子记录引用越界')
    sameOwner(row, build, 'Build 子记录')
  }
  for (const release of releases.values()) {
    if (!productKinds.has(release.productType) || !/^[a-f0-9]{64}$/.test(String(release.contentHash ?? ''))) {
      throw new Error('[deriveImport] v10 ProductRelease 身份或 hash 无效')
    }
    let manifest: Record<string, any>
    try { manifest = JSON.parse(String(release.manifestJson ?? '')) }
    catch { throw new Error('[deriveImport] v10 ProductRelease manifest 不是 JSON') }
    if (manifest.schema !== 'storyforge.product-release' || manifest.version !== 1
      || manifest.productType !== release.productType) {
      throw new Error('[deriveImport] v10 ProductRelease manifest 与根身份不一致')
    }
  }
  for (const session of runtimeSessions) {
    const releaseId = session._productReleaseExportId
    const buildId = session._productBuildExportId
    if (!productKinds.has(session.kind) || (releaseId == null) === (buildId == null)
      || !/^[a-f0-9]{64}$/.test(String(session.runtimeSourceHash ?? ''))) {
      throw new Error('[deriveImport] v10 ProductRuntime 必须具有唯一、有效的产品来源')
    }
    const sourceProductType = releaseId != null
      ? releases.get(releaseId)?.productType
      : productions.get(builds.get(buildId)?._productionExportId)?.productType
    if (sourceProductType !== session.kind) {
      throw new Error('[deriveImport] v10 ProductRuntime 身份与来源产品不一致')
    }
  }
  for (const asset of mediaAssets) {
    const releaseId = asset._productReleaseExportId
    const runtimeSessionId = asset._productRuntimeSessionExportId
    if (!productKinds.has(asset.productType) || (releaseId == null) === (runtimeSessionId == null)
      || (asset.ownerKind === 'release') !== (releaseId != null)
      || (asset.ownerKind === 'runtime') !== (runtimeSessionId != null)) {
      throw new Error('[deriveImport] v10 ProductMedia 必须具有唯一、有效的产品所有者')
    }
    const owner = releaseId != null ? releases.get(releaseId) : runtimeSessionById.get(runtimeSessionId)
    if (!owner || owner.productType !== asset.productType && owner.kind !== asset.productType) {
      throw new Error('[deriveImport] v10 ProductMedia 身份与所属产品不一致')
    }
    sameOwner(asset, owner, 'ProductMedia')
  }
}

function strictOwnerShadow(spec: TableSpec, row: Record<string, any>): {
  kind: 'world' | 'work' | 'instance'
  exportId: number
  field: string
} | null {
  if (spec.name === 'worlds' || spec.name === 'works') return null
  const locator = spec.domainOwner?.locator
  if (!locator || locator.kind === 'workspace') return null
  if (locator.kind === 'field') {
    if (locator.owner !== 'world' && locator.owner !== 'work') return null
    const shadowField = locator.owner === 'world' ? '_worldOwnerExportId' : '_workOwnerExportId'
    const opposite = locator.owner === 'world' ? '_workOwnerExportId' : '_worldOwnerExportId'
    if (row[opposite] != null || !Number.isInteger(row[shadowField])) {
      throw new Error(`[deriveImport] v4 owner 缺失或越界:${spec.name}.${shadowField}`)
    }
    return { kind: locator.owner, exportId: row[shadowField], field: locator.field }
  }
  if (locator.kind === 'exclusive-fields') {
    const hasWorld = Number.isInteger(row._worldOwnerExportId)
    const hasWork = Number.isInteger(row._workOwnerExportId)
    if (hasWorld === hasWork) throw new Error(`[deriveImport] v4 owner 必须且只能有一个:${spec.name}`)
    return hasWorld
      ? { kind: 'world', exportId: row._worldOwnerExportId, field: locator.worldField }
      : { kind: 'work', exportId: row._workOwnerExportId, field: locator.workField }
  }
  if (locator.kind === 'exclusive-work-instance') {
    const hasWork = Number.isInteger(row._workOwnerExportId)
    const hasInstance = Number.isInteger(row._instanceOwnerExportId)
    if (hasWork === hasInstance) throw new Error(`[deriveImport] v4 Work/Instance owner 必须且只能有一个:${spec.name}`)
    return hasWork
      ? { kind: 'work', exportId: row._workOwnerExportId, field: locator.workField }
      : { kind: 'instance', exportId: row._instanceOwnerExportId, field: locator.instanceField }
  }
  return null
}

function validateStrictOwnership(data: ProjectExportData): void {
  if (data.version < PORTABLE_OWNER_VERSION) return
  const value = data as unknown as Record<string, any>
  if (!Array.isArray(value.worlds) || !value.worlds.length || !Array.isArray(value.works) || !value.works.length) {
    throw new Error('[deriveImport] v4 备份缺少 World/Work 根')
  }
  const worldIds = new Set(value.worlds.map((row: any) => row?._exportId))
  const workIds = new Set(value.works.map((row: any) => row?._exportId))
  const instanceIds = new Set((value.productRuntimeSessions ?? []).map((row: any) => row?._exportId))
  if (worldIds.size !== value.worlds.length || workIds.size !== value.works.length
    || [...worldIds].some(id => !Number.isInteger(id)) || [...workIds].some(id => !Number.isInteger(id))) {
    throw new Error('[deriveImport] v4 World/Work 便携 ID 重复或无效')
  }
  const ownership = value.ownership
  if (!ownership || !worldIds.has(ownership.worldExportId) || !workIds.has(ownership.workExportId)) {
    throw new Error('[deriveImport] v4 active owner 指针缺失或越界')
  }
  if (data.version >= WORK_CLASSIFICATION_VERSION) {
    for (const row of value.works as Array<Record<string, unknown>>) {
      try {
        assertStoredWorkClassification(row as any)
      } catch (error) {
        throw new Error(`[deriveImport] v5 Work 分类非法：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  if (data.version >= ADAPTATION_VERSION) validateAdaptationBackup(value)
  if (data.version >= SCREENPLAY_VERSION) validateScreenplayBackup(value)
  if (data.version >= COMIC_STORYBOARD_VERSION) validateComicStoryboardBackup(value)
  if (data.version >= COMIC_MEDIA_VERSION) validateComicMediaBackup(value)
  if (data.version >= PRODUCT_ARCHITECTURE_VERSION) validateProductArchitectureBackup(value)
  for (const spec of PROJECT_TABLES) {
    if (!spec.exportable || spec.name === 'projects' || spec.name === 'worlds' || spec.name === 'works') continue
    const rows = value[spec.name]
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new Error(`[deriveImport] ${spec.name} 包含非法记录`)
      if ('worldId' in row || 'workId' in row) throw new Error(`[deriveImport] v4 ${spec.name} 泄露本地主键 owner`)
      const shadow = strictOwnerShadow(spec, row)
      if (!shadow) continue
      const validIds = shadow.kind === 'world' ? worldIds : shadow.kind === 'work' ? workIds : instanceIds
      if (!validIds.has(shadow.exportId)) throw new Error(`[deriveImport] v4 owner 越界:${spec.name}`)
    }
  }
}

function validateAdaptationBackup(value: Record<string, any>): void {
  if (!Array.isArray(value.adaptationProjects) || !Array.isArray(value.adaptationSourceUnits)) {
    throw new Error('[deriveImport] v6 备份缺少改编必需表')
  }
  const works = new Map<number, Record<string, any>>((value.works ?? []).map((row: Record<string, any>) => [row._exportId, row]))
  const roots = new Map<number, Record<string, any>>()
  for (const row of value.adaptationProjects as Record<string, any>[]) {
    if (!Number.isInteger(row._exportId) || roots.has(row._exportId)) throw new Error('[deriveImport] v6 adaptationProject 便携 ID 重复或无效')
    const target = works.get(row._workExportId)
    const source = row._sourceWorkExportId == null ? null : works.get(row._sourceWorkExportId)
    if (!target || (row._sourceWorkExportId != null && !source)) throw new Error('[deriveImport] v6 改编 Work 引用越界')
    const root = {
      ...row,
      id: row._exportId,
      projectId: 1,
      worldId: row._worldExportId,
      workId: row._workExportId,
      sourceWorkId: row._sourceWorkExportId ?? null,
      sourceOutlineRootId: row._sourceOutlineRootExportId ?? null,
      sourceStartChapterId: row._sourceStartChapterExportId ?? null,
      sourceEndChapterId: row._sourceEndChapterExportId ?? null,
    } as AdaptationProject
    const targetWork = { ...target, id: row._workExportId, projectId: 1, worldId: row._worldExportId } as Work
    const sourceWork = source ? { ...source, id: row._sourceWorkExportId, projectId: 1, worldId: row._worldExportId } as Work : null
    try {
      assertAdaptationProjectInvariant(root, targetWork, sourceWork)
    } catch (error) {
      throw new Error(`[deriveImport] v6 改编根非法：${error instanceof Error ? error.message : String(error)}`)
    }
    roots.set(row._exportId, row)
  }
  const unique = new Set<string>()
  for (const row of value.adaptationSourceUnits as Record<string, any>[]) {
    if (!roots.has(row._adaptationProjectExportId)) throw new Error('[deriveImport] v6 来源单元 adaptation 引用越界')
    if (!Number.isInteger(row.manifestVersion) || row.manifestVersion <= 0 || !Number.isInteger(row.order) || row.order < 0) throw new Error('[deriveImport] v6 来源单元版本或顺序非法')
    if (!/^[a-f0-9]{64}$/i.test(row.contentHash) || typeof row.sourceUnitKey !== 'string' || !row.sourceUnitKey) throw new Error('[deriveImport] v6 来源单元 key/hash 非法')
    const identity = `${row._adaptationProjectExportId}:${row.manifestVersion}:${row.sourceUnitKey}`
    if (unique.has(identity)) throw new Error('[deriveImport] v6 来源单元 stable key 重复')
    unique.add(identity)
    if (row.sourceKind === 'work') {
      if (row._sourceOutlineExportId != null || row._sourceChapterExportId != null) throw new Error('[deriveImport] v6 work 来源单元引用组合非法')
    } else if (row.sourceKind === 'outline-node') {
      if (row._sourceChapterExportId != null) throw new Error('[deriveImport] v6 outline 来源单元引用组合非法')
    } else if (row.sourceKind === 'chapter') {
      if (row._sourceOutlineExportId != null) throw new Error('[deriveImport] v6 chapter 来源单元引用组合非法')
    } else {
      throw new Error('[deriveImport] v6 来源单元 kind 非法')
    }
  }
  for (const [rootId, root] of roots) {
    const activeUnits = (value.adaptationSourceUnits as Record<string, any>[]).filter(row => row._adaptationProjectExportId === rootId && row.manifestVersion === root.activeSourceManifestVersion)
    if (activeUnits.filter(row => row.sourceKind === 'work').length !== 1) throw new Error('[deriveImport] v6 活动 manifest 必须恰有一个 work 单元')
  }
}

function validateScreenplayBackup(value: Record<string, any>): void {
  if (!Array.isArray(value.screenplayScenes)) throw new Error('[deriveImport] v7 备份缺少 screenplayScenes')
  const roots = new Map<number, Record<string, any>>((value.adaptationProjects ?? []).map((row: Record<string, any>) => [row._exportId, row]))
  const units = new Map<number, Record<string, any>>((value.adaptationSourceUnits ?? []).map((row: Record<string, any>) => [row._exportId, row]))
  const characterCount = Array.isArray(value.characters) ? value.characters.length : 0
  const ids = new Set<number>()
  const stable = new Set<string>()
  const episodeNumbers = new Set<string>()
  const orders = new Set<string>()
  for (const row of value.screenplayScenes as Record<string, any>[]) {
    const root = roots.get(row._adaptationProjectExportId)
    if (!root || root.medium !== 'screenplay' || row._workExportId !== root._workExportId) throw new Error('[deriveImport] v7 剧本场景 owner 或媒介越界')
    if (!Number.isInteger(row._exportId) || ids.has(row._exportId)) throw new Error('[deriveImport] v7 剧本场景便携 ID 重复或无效')
    ids.add(row._exportId)
    const stableIdentity = `${row._adaptationProjectExportId}:${row.stableKey}`
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(row.stableKey) || stable.has(stableIdentity)) throw new Error('[deriveImport] v7 剧本场景 stableKey 非法或重复')
    stable.add(stableIdentity)
    if (!Number.isInteger(row.episodeNumber) || row.episodeNumber < 1 || !Number.isInteger(row.sceneNumber) || row.sceneNumber < 1 || !Number.isInteger(row.order) || row.order < 0) throw new Error('[deriveImport] v7 剧本场景编号非法')
    const numberIdentity = `${row._adaptationProjectExportId}:${row.episodeNumber}:${row.sceneNumber}`
    const orderIdentity = `${row._adaptationProjectExportId}:${row.order}`
    if (episodeNumbers.has(numberIdentity) || orders.has(orderIdentity)) throw new Error('[deriveImport] v7 剧本场景编号或顺序重复')
    episodeNumbers.add(numberIdentity); orders.add(orderIdentity)
    const spec = root.targetSpec as AdaptationProject['targetSpec']
    if (spec.format === 'film' && row.episodeNumber !== 1) throw new Error('[deriveImport] v7 电影场景集号必须为 1')
    if ('episodeCount' in spec && spec.episodeCount != null && row.episodeNumber > spec.episodeCount) throw new Error('[deriveImport] v7 剧本场景集号越界')
    if (!['INT', 'EXT', 'INT_EXT'].includes(row.intExt) || typeof row.location !== 'string' || !row.location.trim() || typeof row.timeOfDay !== 'string' || !row.timeOfDay.trim()) throw new Error('[deriveImport] v7 剧本场景标题非法')
    if (!Number.isFinite(row.estimatedSeconds) || row.estimatedSeconds <= 0 || !Number.isInteger(row.sourceReviewManifestVersion) || row.sourceReviewManifestVersion < 1) throw new Error('[deriveImport] v7 剧本时长或来源版本非法')
    if (!Array.isArray(row._sourceUnitExportIds) || !row._sourceUnitExportIds.length || new Set(row._sourceUnitExportIds).size !== row._sourceUnitExportIds.length) throw new Error('[deriveImport] v7 剧本来源证据非法')
    for (const unitId of row._sourceUnitExportIds) {
      const unit = units.get(unitId)
      if (!unit || unit._adaptationProjectExportId !== row._adaptationProjectExportId || unit.manifestVersion !== row.sourceReviewManifestVersion) throw new Error('[deriveImport] v7 剧本来源单元越界')
    }
    if (!Array.isArray(row.blocks) || !validateScreenplayBlocksV1(row.blocks as ScreenplayBlock[]).valid) throw new Error('[deriveImport] v7 剧本块非法')
    if (!Array.isArray(row._blockCharacterExportIds) || row._blockCharacterExportIds.length !== row.blocks.length) throw new Error('[deriveImport] v7 剧本角色影子映射非法')
    row._blockCharacterExportIds.forEach((id: unknown, index: number) => {
      if (id != null && (!Number.isInteger(id) || (id as number) < 0 || (id as number) >= characterCount)) throw new Error('[deriveImport] v7 剧本角色引用越界')
      const block = row.blocks[index]
      if (block?.characterId != null) throw new Error('[deriveImport] v7 剧本块泄露本地角色 ID')
    })
    const section = root.plan?.sections?.find((item: Record<string, unknown>) => item.stableKey === row.planSectionKey)
    if (!section || root.planSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[deriveImport] v7 剧本场景计划引用无效')
  }
}

function validateComicStoryboardBackup(value: Record<string, any>): void {
  if (!Array.isArray(value.comicPages) || !Array.isArray(value.comicPanels) || !Array.isArray(value.comicVisualSubjects)) throw new Error('[deriveImport] v8 备份缺少漫画页格或视觉条目表')
  const roots = new Map<number, Record<string, any>>((value.adaptationProjects ?? []).map((row: Record<string, any>) => [row._exportId, row]))
  const units = new Map<number, Record<string, any>>((value.adaptationSourceUnits ?? []).map((row: Record<string, any>) => [row._exportId, row]))
  const pages = new Map<number, Record<string, any>>()
  const stablePages = new Set<string>(); const pageOrders = new Set<string>()
  for (const page of value.comicPages as Record<string, any>[]) {
    const root = roots.get(page._adaptationProjectExportId)
    if (!root || root.medium !== 'comic' || page._workExportId !== root._workExportId || !Number.isInteger(page._exportId) || pages.has(page._exportId)) throw new Error('[deriveImport] v8 漫画页面 owner 或便携 ID 非法')
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(page.stableKey) || stablePages.has(`${page._workExportId}:${page.stableKey}`) || !Number.isInteger(page.order) || page.order < 0 || pageOrders.has(`${page._adaptationProjectExportId}:${page.order}`)) throw new Error('[deriveImport] v8 漫画页面 stableKey 或顺序非法')
    if (!Number.isInteger(page.chapterNumber) || page.chapterNumber < 1 || page.chapterNumber > root.targetSpec.chapterCount || typeof page.allowPanelOverlap !== 'boolean' || typeof page.summary !== 'string') throw new Error('[deriveImport] v8 漫画页面内容非法')
    pages.set(page._exportId, page); stablePages.add(`${page._workExportId}:${page.stableKey}`); pageOrders.add(`${page._adaptationProjectExportId}:${page.order}`)
  }
  const stablePanels = new Set<string>(); const panelsByPage = new Map<number, Record<string, any>[]>()
  for (const panel of value.comicPanels as Record<string, any>[]) {
    const page = pages.get(panel._pageExportId); const root = page ? roots.get(page._adaptationProjectExportId) : null
    if (!page || !root || panel._workExportId !== page._workExportId || !/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(panel.stableKey) || stablePanels.has(`${panel._workExportId}:${panel.stableKey}`)) throw new Error('[deriveImport] v8 漫画格 owner 或 stableKey 非法')
    assertNormalizedFrameV1(panel.frame, `导入格 ${panel.stableKey}`, 0.04)
    if (!Number.isInteger(panel.order) || panel.order < 0 || !Number.isInteger(panel.sourceReviewManifestVersion) || panel.sourceReviewManifestVersion !== root.activeSourceManifestVersion || !Array.isArray(panel._sourceUnitExportIds) || !panel._sourceUnitExportIds.length || new Set(panel._sourceUnitExportIds).size !== panel._sourceUnitExportIds.length) throw new Error('[deriveImport] v8 漫画格顺序或来源版本非法')
    for (const unitId of panel._sourceUnitExportIds) {
      const unit = units.get(unitId)
      if (!unit || unit._adaptationProjectExportId !== page._adaptationProjectExportId || unit.manifestVersion !== panel.sourceReviewManifestVersion) throw new Error('[deriveImport] v8 漫画格来源单元越界')
    }
    assertComicLetteringV1(panel.lettering as ComicLetteringItemV1[])
    if (!Array.isArray(panel.continuityRefs) || typeof panel.action !== 'string' || !panel.action.trim() || typeof panel.visualPrompt !== 'string' || typeof panel.negativePrompt !== 'string') throw new Error('[deriveImport] v8 漫画格内容非法')
    stablePanels.add(`${panel._workExportId}:${panel.stableKey}`)
    const siblings = panelsByPage.get(panel._pageExportId) ?? []; siblings.push(panel); panelsByPage.set(panel._pageExportId, siblings)
  }
  for (const [pageId, panels] of panelsByPage) {
    const page = pages.get(pageId)!
    const sorted = [...panels].sort((left, right) => left.order - right.order)
    if (sorted.some((panel, index) => panel.order !== index)) throw new Error('[deriveImport] v8 漫画格顺序必须连续')
    if (!page.allowPanelOverlap) for (let left = 0; left < sorted.length; left++) for (let right = left + 1; right < sorted.length; right++) if (framesOverlap(sorted[left].frame, sorted[right].frame)) throw new Error('[deriveImport] v8 漫画格非法重叠')
  }
  const characterCount = Array.isArray(value.characters) ? value.characters.length : 0
  const subjectKeys = new Set<string>()
  for (const subject of value.comicVisualSubjects as Record<string, any>[]) {
    const root = roots.get(subject._adaptationProjectExportId)
    if (!root || root.medium !== 'comic' || subject._workExportId !== root._workExportId || !/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(subject.stableKey) || subjectKeys.has(`${subject._workExportId}:${subject.stableKey}`)) throw new Error('[deriveImport] v8 视觉条目 owner 或 stableKey 非法')
    if (subject._characterExportId != null && (!Number.isInteger(subject._characterExportId) || subject._characterExportId < 0 || subject._characterExportId >= characterCount)) throw new Error('[deriveImport] v8 视觉条目角色引用越界')
    if (subject.characterId != null || !Array.isArray(subject._sourceUnitExportIds) || !subject._sourceUnitExportIds.length) throw new Error('[deriveImport] v8 视觉条目泄露本地 ID 或缺来源')
    if (subject.kind === 'character' ? subject.locationRefKey != null : subject.kind === 'location' ? subject._characterExportId != null : (subject._characterExportId != null || subject.locationRefKey != null)) throw new Error('[deriveImport] v8 视觉条目 kind/ref 组合非法')
    subjectKeys.add(`${subject._workExportId}:${subject.stableKey}`)
  }
  for (const panel of value.comicPanels as Record<string, any>[]) for (const ref of panel.continuityRefs) if (!subjectKeys.has(`${panel._workExportId}:${ref.subjectKey}`)) throw new Error('[deriveImport] v8 漫画格连续性引用不存在')
}

function validateComicMediaBackup(value: Record<string, any>): void {
  if (!Array.isArray(value.comicMediaAssets) || !Array.isArray(value.mediaBlobObjects)) throw new Error('[deriveImport] v9 备份缺少漫画媒体或共享 Blob 表')
  const blobs = new Map<number, Record<string, any>>()
  for (const blob of value.mediaBlobObjects as Record<string, any>[]) {
    // mediaBlobObjects is product-neutral. Comic validation may constrain the
    // subset it references to image media, but must not reject valid audio,
    // fonts or other upper-product objects stored in the same shared table.
    if (!Number.isInteger(blob._exportId) || blobs.has(blob._exportId)
      || !/^[a-f0-9]{64}$/.test(blob.contentHash)
      || typeof blob.mimeType !== 'string' || !blob.mimeType.trim()
      || !Number.isInteger(blob.byteSize) || blob.byteSize < 1
      || typeof blob.data !== 'string') {
      throw new Error('[deriveImport] v9 Blob 元数据或便携内容非法')
    }
    blobs.set(blob._exportId, blob)
  }
  const panels = new Map<number, Record<string, any>>((value.comicPanels ?? []).map((row: Record<string, any>) => [row._exportId, row]))
  const subjects = new Map<string, Record<string, any>>((value.comicVisualSubjects ?? []).map((row: Record<string, any>) => [`${row._workExportId}:${row.stableKey}`, row]))
  const assets = new Map<string, Record<string, any>>()
  for (const row of value.comicMediaAssets as Record<string, any>[]) {
    const key = `${row._workExportId}:${row.stableKey}`
    const blob = blobs.get(row._blobObjectExportId)
    if (assets.has(key) || !blob) throw new Error('[deriveImport] v9 asset stableKey 重复或 Blob 引用越界')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.mimeType)
      || !Number.isInteger(blob.width) || blob.width < 1
      || !Number.isInteger(blob.height) || blob.height < 1) {
      throw new Error('[deriveImport] v9 漫画 asset 必须引用带尺寸的图片 Blob')
    }
    assertComicMediaAssetV1({ ...row, projectId: 1, workId: row._workExportId, adaptationProjectId: row._adaptationProjectExportId, panelId: row._panelExportId ?? null, blobObjectId: row._blobObjectExportId } as ComicMediaAsset)
    if (row.role === 'panel-render' && (!panels.has(row._panelExportId) || panels.get(row._panelExportId)!._workExportId !== row._workExportId)) throw new Error('[deriveImport] v9 panel-render owner 越界')
    if (row.role !== 'panel-render' && !subjects.has(`${row._workExportId}:${row.subjectKey}`)) throw new Error('[deriveImport] v9 subject asset owner 越界')
    assets.set(key, row)
  }
  for (const panel of value.comicPanels as Record<string, any>[]) if (panel.selectedMediaAssetKey) {
    const asset = assets.get(`${panel._workExportId}:${panel.selectedMediaAssetKey}`)
    if (!asset || asset.role !== 'panel-render' || asset._panelExportId !== panel._exportId) throw new Error('[deriveImport] v9 格所选 asset 不匹配')
  }
  for (const subject of value.comicVisualSubjects as Record<string, any>[]) if (subject.selectedMediaAssetKey) {
    const asset = assets.get(`${subject._workExportId}:${subject.selectedMediaAssetKey}`)
    if (!asset || asset.subjectKey !== subject.stableKey) throw new Error('[deriveImport] v9 视觉条目所选 asset 不匹配')
  }
  for (const [key, asset] of assets) for (const reference of asset.referenceAssetKeys ?? []) if (reference === asset.stableKey || !assets.has(`${asset._workExportId}:${reference}`)) throw new Error(`[deriveImport] v9 asset 参考引用非法：${key}`)
  const visiting = new Set<string>(); const visited = new Set<string>()
  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error(`[deriveImport] v9 asset 参考引用形成环：${key}`)
    if (visited.has(key)) return
    const asset = assets.get(key)
    if (!asset) throw new Error(`[deriveImport] v9 asset 参考引用缺失：${key}`)
    visiting.add(key)
    for (const reference of asset.referenceAssetKeys ?? []) visit(`${asset._workExportId}:${reference}`)
    visiting.delete(key); visited.add(key)
  }
  assets.forEach((_asset, key) => visit(key))
}

function restoreStrictOwner(
  dataVersion: number,
  spec: TableSpec,
  obj: Record<string, any>,
  newIdMaps: Map<string, Map<number, number>>,
): void {
  if (dataVersion < PORTABLE_OWNER_VERSION) return
  const shadow = strictOwnerShadow(spec, obj)
  delete obj._worldOwnerExportId
  delete obj._workOwnerExportId
  delete obj._instanceOwnerExportId
  if (!shadow) return
  const ownerMap = newIdMaps.get(shadow.kind === 'world' ? 'worlds' : shadow.kind === 'work' ? 'works' : 'productRuntimeSessions')
  const mapped = ownerMap?.get(shadow.exportId)
  if (mapped == null) throw new Error(`[deriveImport] v4 owner 无法重映射:${spec.name}`)
  if (obj[shadow.field] != null && obj[shadow.field] !== mapped) {
    throw new Error(`[deriveImport] v4 owner 与外键冲突:${spec.name}.${shadow.field}`)
  }
  obj[shadow.field] = mapped
  const locator = spec.domainOwner?.locator
  if (locator?.kind === 'exclusive-fields') {
    obj[shadow.kind === 'world' ? locator.workField : locator.worldField] = null
  } else if (locator?.kind === 'exclusive-work-instance') {
    obj[shadow.kind === 'work' ? locator.instanceField : locator.workField] = null
  }
}

/**
 * 表级拓扑排序：被 remapVia 指向的表通常必须先导入。注册表显式标记
 * deferred 的可空反向外键可先落 null，再由 deferredForeignKeys 在所有
 * 映射可用后回填，用于表达 Character ↔ Chapter 等合法双向可空引用。
 */
function deriveImportOrder(specs: TableSpec[]): TableSpec[] {
  const done = new Set<string>()
  const order: TableSpec[] = []
  // World/Work are ownership roots, so v4 must materialize them before any
  // domain-owned row. Optional backward references (for example Work -> active
  // character plan) are patched after all tables have been imported.
  for (const rootName of ['worlds', 'works']) {
    const root = specs.find(spec => spec.name === rootName)
    if (root) {
      order.push(root)
      done.add(root.name)
    }
  }
  let guard = 0
  while (order.length < specs.length) {
    if (guard++ > specs.length + 2) throw new Error('[deriveImport] 表依赖存在环,无法拓扑排序')
    for (const spec of specs) {
      if (done.has(spec.name)) continue
      const fieldDeps = (spec.exportRemap ?? [])
        .filter(rm => !rm.selfTree
          && rm.remapVia !== spec.name
          && rm.deferred !== true
          && rm.deferImport !== true)
        .map(rm => rm.remapVia)
      const refDeps = (spec.exportRefRemap ?? [])
        .filter(ref => ref.remapVia !== spec.name)
        .map(ref => ref.remapVia)
      const ownerDeps = spec.domainOwner?.locator?.kind === 'field'
        ? [spec.domainOwner.locator.owner === 'world' ? 'worlds' : spec.domainOwner.locator.owner === 'work' ? 'works' : null]
        : spec.domainOwner?.locator?.kind === 'exclusive-fields' ? ['worlds', 'works']
          : spec.domainOwner?.locator?.kind === 'exclusive-work-instance' ? ['works', 'productRuntimeSessions'] : []
      const portableDeps = spec.portableData?.kind === 'agent-run-root'
        ? spec.portableData.dependencies
        : []
      const deps = [...new Set([...fieldDeps, ...refDeps, ...ownerDeps, ...portableDeps].filter((d): d is string => !!d && d !== spec.name))]
      if (deps.every(d => done.has(d))) {
        order.push(spec)
        done.add(spec.name)
      }
    }
  }
  return order
}

/** 树表行级拓扑排序:_parentExportId 为空或父已就位的行优先,保证 parent 先于 child 落库 */
function topoSortTreeRows(rows: any[]): any[] {
  const sorted: any[] = []
  const placed = new Set<number>()
  let guard = 0
  while (sorted.length < rows.length) {
    if (guard++ > rows.length + 2) {
      for (const r of rows) if (!placed.has(r._exportId)) sorted.push(r) // 防环兜底
      break
    }
    for (const r of rows) {
      if (placed.has(r._exportId)) continue
      if (r._parentExportId == null || placed.has(r._parentExportId)) {
        sorted.push(r)
        placed.add(r._exportId)
      }
    }
  }
  return sorted
}

function patchSelfIdPaths(obj: Record<string, any>, paths: string[], newId: number): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const path of paths) {
    const [root, ...rest] = path.split('.')
    if (!root || rest.length === 0 || obj[root] == null || typeof obj[root] !== 'object') continue
    // 导入输入本就是 JSON 契约，按 JSON 语义深拷贝可避免修改原始备份对象。
    const rootCopy = JSON.parse(JSON.stringify(obj[root]))
    let cursor: Record<string, any> = rootCopy
    for (const part of rest.slice(0, -1)) {
      if (cursor[part] == null || typeof cursor[part] !== 'object') cursor[part] = {}
      cursor = cursor[part]
    }
    cursor[rest[rest.length - 1]] = newId
    patch[root] = rootCopy
  }
  return patch
}

function restorePortableBinaryBlob(value: unknown, label: string): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value
  if (typeof value !== 'string') throw new Error(`[deriveImport] ${label} 缺少便携二进制`)
  const match = /^data:([^;,]+)?;base64,([A-Za-z0-9+/=]*)$/.exec(value)
  if (!match) throw new Error(`[deriveImport] ${label} 不是合法 data URL`)
  let binary: string
  try { binary = atob(match[2]) } catch { throw new Error(`[deriveImport] ${label} base64 无效`) }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

async function assertPortableBinaryIntegrity(
  spec: TableSpec,
  row: Record<string, any>,
  data: ArrayBuffer,
): Promise<void> {
  const integrity = spec.portableData?.kind === 'binary-blob' ? spec.portableData.integrity : null
  const selfIntegrity = spec.portableData?.kind === 'binary-blob' ? spec.portableData.selfIntegrity : null
  if (selfIntegrity) {
    if (row[selfIntegrity.sizeField] !== data.byteLength) throw new Error(`[deriveImport] ${spec.name} 二进制大小与本行元数据不一致`)
    const digest = await Dexie.waitFor(crypto.subtle.digest('SHA-256', data))
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    if (row[selfIntegrity.hashField] !== hash) throw new Error(`[deriveImport] ${spec.name} 二进制哈希与本行元数据不一致`)
  }
  if (!integrity) return
  const referenceId = row[integrity.referenceField]
  const metadataTable = (db as any)[integrity.metadataTable]
  const metadata = Number.isInteger(referenceId) && metadataTable ? await metadataTable.get(referenceId) : null
  if (!metadata) throw new Error(`[deriveImport] ${spec.name} 缺少二进制元数据引用`)
  if (metadata[integrity.sizeField] !== data.byteLength) throw new Error(`[deriveImport] ${spec.name} 二进制大小与元数据不一致`)
  const digest = await Dexie.waitFor(crypto.subtle.digest('SHA-256', data))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (metadata[integrity.hashField] !== hash) throw new Error(`[deriveImport] ${spec.name} 二进制哈希与元数据不一致`)
}

async function restorePortableSharedMediaObject(
  spec: TableSpec,
  row: Record<string, any>,
): Promise<void> {
  const portable = spec.portableData
  if (portable?.kind !== 'shared-media-object') return
  if (row[portable.stateField] !== 'ready') {
    throw new Error(`[deriveImport] ${spec.name} 只接受 ready 共享媒资`)
  }
  const data = restorePortableBinaryBlob(row[portable.dataField], `${spec.name}.${portable.dataField}`)
  if (row[portable.sizeField] !== data.byteLength) {
    throw new Error(`[deriveImport] ${spec.name} 二进制大小与记录不一致`)
  }
  const mimeType = row[portable.mimeField]
  if (typeof mimeType !== 'string' || !mimeType.trim()) {
    throw new Error(`[deriveImport] ${spec.name} 缺少 MIME 类型`)
  }
  const digest = await Dexie.waitFor(crypto.subtle.digest('SHA-256', data))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (row[portable.hashField] !== hash) {
    throw new Error(`[deriveImport] ${spec.name} 二进制哈希与记录不一致`)
  }
  row[portable.dataField] = data
  row[portable.backendField] = 'indexeddb'
  row[portable.stateField] = 'ready'
  row[portable.pathField] = null
  row[portable.leaseOwnerField] = null
  row[portable.leaseExpiresAtField] = null
  row[portable.lastVerifiedAtField] = Date.now()
}

/**
 * 派生导入:把 ProjectExportData 写成一个新项目,返回新项目 id。
 * 与手写 importProjectJSON 行为一致(往返完整性由 R-export-fullcoverage 锁死)。
 */
export async function deriveImportProjectJSON(data: ProjectExportData): Promise<number> {
  if (!data.version || !data.project) throw new Error('无效的导出文件格式')
  validateStrictOwnership(data)
  const now = Date.now()
  const specs = PROJECT_TABLES.filter(s => s.exportable && s.name !== 'projects')
  const order = deriveImportOrder(specs)
  const projectSpec = PROJECT_TABLES.find(spec => spec.name === 'projects')
  if (!projectSpec) throw new Error('[deriveImport] PROJECT_TABLES 缺少 projects 根表')

  const importedProjectId = await db.transaction('rw', transactionTablesFor('importProject'), async () => {
    const projectData: Record<string, any> = { ...data.project }
    const pendingProjectRefs = new Map<string, number | null>()
    for (const rm of projectSpec.exportRemap ?? []) {
      const exportValue = projectData[rm.exportAs]
      pendingProjectRefs.set(rm.field, typeof exportValue === 'number' ? exportValue : null)
      delete projectData[rm.exportAs]
      // 数据库主键不具备跨项目便携性；旧备份若只有原始 ID，宁可清空也不能误绑定。
      delete projectData[rm.field]
    }
    const requestedWorkspaceUid = projectData.workspaceUid
    const workspaceUidCollision = isWorkspaceUid(requestedWorkspaceUid)
      ? await db.projects.where('workspaceUid').equals(requestedWorkspaceUid).first()
      : null
    projectData.workspaceUid = isWorkspaceUid(requestedWorkspaceUid) && !workspaceUidCollision
      ? requestedWorkspaceUid
      : generateWorkspaceUid()
    const newProjectId = await db.projects.add({
      ...projectData,
      name: `${data.project.name}（导入）`,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    // 旧版备份兼容:factions/itemSystems 表已删除 → 并入「势力」/「人工器物」词条
    const legacyFactions = (data as any).factions as any[] | undefined
    const legacyItemSystems = (data as any).itemSystems as any[] | undefined
    if (legacyFactions?.length || legacyItemSystems?.length) {
      await importLegacyArraysToCodex(db, newProjectId, { factions: legacyFactions, itemSystems: legacyItemSystems })
    }

    const newIdMaps = new Map<string, Map<number, number>>()
    const deferredForeignKeys: Array<{ table: any; id: number; field: string; target: string; exportId: number }> = []

    for (const spec of order) {
      const rawRows: any[] = (data as any)[spec.name] ?? []
      const rows = spec.tree ? topoSortTreeRows(rawRows) : rawRows
      const newIdMap = new Map<number, number>()
      const pendingRefRemap: Array<{ newId: number; stashed: Record<string, any> }> = []

      let exportIndex = -1
      for (const row of rows) {
        exportIndex++
        // 注册表声明的兜底默认值先铺底，再用 row 覆盖：老数据/跨版本导入缺某非可选字段时，
        // 落库仍满足类型不变量（如 outlineNodes.summary 恒为 string，杜绝「导入后大纲崩」）。
        const obj: any = { ...spec.defaults, ...row }
        if (spec.name === 'works' && !isWorkCode(obj.code)) obj.code = generateWorkCode()
        const exportId = obj._exportId
        delete obj._exportId

        // 外键:_exportAs → 真实 db id
        let dropRow = false
        let hasUnmappedKnowledgeRef = false
        let hasUnmappedTemporalSourceRef = false
        let hasUnmappedCultivationProgressRef = false
        const rowDeferredForeignKeys: Array<{ field: string; target: string; exportId: number }> = []
        for (const rm of spec.exportRemap ?? []) {
          const exportVal = obj[rm.exportAs]
          delete obj[rm.exportAs]
          let mappedId: number | null = null
          if (exportVal != null) {
            const m = rm.selfTree ? newIdMap : newIdMaps.get(rm.remapVia)
            const got = m?.get(exportVal)
            if (got == null) {
              if (spec.name === 'knowledgeLedger') hasUnmappedKnowledgeRef = true
              if (spec.name === 'cultivationProgress') hasUnmappedCultivationProgressRef = true
              if (spec.name === 'temporalFacts' && rm.field.startsWith('source')) {
                hasUnmappedTemporalSourceRef = true
              }
              if (rm.onUnmapped === 'drop') { dropRow = true; break }
              if (rm.onUnmapped === 'require') {
                throw new Error(`[deriveImport] 缺失必填外键映射:${spec.name}.${rm.field}=${exportVal}`)
              }
              if (!rm.selfTree) {
                rowDeferredForeignKeys.push({ field: rm.field, target: rm.remapVia, exportId: exportVal })
              }
            }
            mappedId = got ?? null
          }
          obj[rm.field] = mappedId
        }
        if (dropRow) continue
        restoreStrictOwner(data.version, spec, obj, newIdMaps)
        if (spec.name === 'knowledgeLedger' && hasUnmappedKnowledgeRef && obj.status !== 'rejected') {
          obj.status = 'source-missing'
        }
        if (spec.name === 'cultivationProgress' && hasUnmappedCultivationProgressRef) {
          obj.status = 'source-missing'
        }
        if (spec.name === 'temporalFacts' && hasUnmappedTemporalSourceRef
          && obj.status !== 'rejected' && obj.status !== 'superseded') {
          obj.status = 'source-missing'
        }
        if (spec.name === 'temporalFacts' && obj.sourceType === 'setting' && obj.sourceFingerprint
          && obj.sourceWorldviewId == null && obj.sourcePowerSystemId == null
          && obj.sourceCultivationSystemId == null
          && obj.sourceStoryCoreId == null && obj.sourceCharacterId == null
          && obj.status !== 'rejected' && obj.status !== 'superseded') {
          obj.status = 'source-missing'
        }

        if (spec.owner === 'project') obj.projectId = newProjectId
        if (spec.portableData?.kind === 'exact-run-artifact') {
          await Dexie.waitFor(assertAgentRunArtifactRecordIntegrityV1(obj))
        }
        if (spec.portableData?.kind === 'binary-blob') {
          if (obj[spec.portableData.field] == null && spec.portableData.allowMissingWhen
            && obj[spec.portableData.allowMissingWhen.importField] != null) {
            obj[spec.portableData.field] = null
          } else {
            const binary = restorePortableBinaryBlob(
              obj[spec.portableData.field],
              `${spec.name}.${spec.portableData.field}`,
            )
            await assertPortableBinaryIntegrity(spec, obj, binary)
            obj[spec.portableData.field] = binary
          }
        }
        if (spec.portableData?.kind === 'shared-media-object') {
          await restorePortableSharedMediaObject(spec, obj)
        }
        if (spec.portableData?.kind === 'agent-run-root') {
          const contractIdMaps = new Map(newIdMaps)
          // Agent runs are a lineage tree. A child contract may reference the
          // already-imported parent in this same table before the table map is
          // published after the row loop.
          contractIdMaps.set(spec.name, newIdMap)
          const rebound = await Dexie.waitFor(rebindPortableAgentRunContractV1({
            contractJson: obj[spec.portableData.contractField],
            contractHash: obj[spec.portableData.contractHashField],
            projectId: newProjectId,
            idMaps: contractIdMaps,
          }))
          obj[spec.portableData.contractField] = rebound.contractJson
          obj[spec.portableData.contractHashField] = rebound.contractHash
        }
        if (spec.name === 'characters') {
          Object.assign(obj, upgradeImportedCharacterAxesV32(obj))
        }

        // JSON 引用字段(portals)先剥离,待全表映射建好后两阶段回填
        let stashed: Record<string, any> | null = null
        if ((spec.exportRefRemap ?? []).length > 0) {
          stashed = {}
          for (const rr of spec.exportRefRemap!) {
            if (rr.kind === 'portals') {
              stashed[rr.field] = obj[rr.field]
              delete obj[rr.field]
            } else {
              stashed[rr.exportAs] = obj[rr.exportAs]
              delete obj[rr.exportAs]
            }
          }
        }

        const newId = await (db as any)[spec.name].add(obj) as number
        for (const deferred of rowDeferredForeignKeys) {
          deferredForeignKeys.push({ table: (db as any)[spec.name], id: newId, ...deferred })
        }
        if (spec.selfIdPaths?.length) {
          const selfPatch = patchSelfIdPaths(obj, spec.selfIdPaths, newId)
          if (Object.keys(selfPatch).length > 0) {
            await (db as any)[spec.name].update(newId, selfPatch)
          }
        }
        const key = spec.exportIdField ? exportId : exportIndex
        if (key != null) newIdMap.set(key, newId)
        if (stashed) pendingRefRemap.push({ newId, stashed })
      }

      // 两阶段:JSON 引用重映射(portals 自引用,需本表 newIdMap 已全)
      for (const rr of spec.exportRefRemap ?? []) {
        if (rr.kind === 'portals') {
          const refMap = rr.remapVia === spec.name ? newIdMap : (newIdMaps.get(rr.remapVia) ?? newIdMap)
          for (const p of pendingRefRemap) {
            const remapped = remapWorldPortalTargets(p.stashed[rr.field], (exportId: number) => refMap.get(exportId))
            // Import reconstructs the same formal record under new local IDs;
            // reference remapping must not manufacture a new author edit time.
            if (remapped) await (db as any)[spec.name].update(p.newId, { [rr.field]: remapped })
          }
        } else {
          const refMap = newIdMaps.get(rr.remapVia)
          if (!refMap) continue
          for (const pending of pendingRefRemap) {
            const portableRefs = pending.stashed[rr.exportAs]
            if (portableRefs == null) continue // 旧备份没有影子字段：保留原值，不猜测旧 db id。
            const patch = rr.kind === 'id-array'
              ? remapPortableIdArray(portableRefs, refMap, rr.storage === 'json-string')
              : rr.kind === 'scene-character-ids'
                ? await remapSceneCharacterIndexes((db as any)[spec.name], pending.newId, rr.field, portableRefs, refMap)
                : rr.kind === 'object-array-id'
                  ? await remapObjectArrayIdIndexes(
                    (db as any)[spec.name],
                    pending.newId,
                    rr.field,
                    portableRefs,
                    refMap,
                    rr.itemField,
                    rr.storage === 'json-string',
                  )
                  : remapPortableJsonIdPaths(
                    portableRefs,
                    rr.paths,
                    refMap,
                    rr.onUnmapped === 'require',
                    `${spec.name}.${rr.field}`,
                  )
            if (patch !== undefined) {
              await (db as any)[spec.name].update(pending.newId, { [rr.field]: patch })
            }
          }
        }
      }

      newIdMaps.set(spec.name, newIdMap)
    }

    for (const deferred of deferredForeignKeys) {
      const mapped = newIdMaps.get(deferred.target)?.get(deferred.exportId)
      if (mapped != null) await deferred.table.update(deferred.id, { [deferred.field]: mapped })
    }

    const projectPatch: Record<string, number | null> = {}
    for (const rm of projectSpec.exportRemap ?? []) {
      const exportValue = pendingProjectRefs.get(rm.field)
      projectPatch[rm.field] = exportValue == null
        ? null
        : (newIdMaps.get(rm.remapVia)?.get(exportValue) ?? null)
    }
    if (Object.keys(projectPatch).length > 0) {
      await db.projects.update(newProjectId, projectPatch as any)
    }

    // NS-4：旧备份可能只有 stateCards、没有 temporalFacts。导入后用新项目内的
    // 新 stateCard 主键生成可审候选；旧卡保留，不自动升 Canon。函数幂等，若备份已有
    // 对应候选不会重复写。
    if (((data as any).temporalFacts?.length ?? 0) === 0) {
      await migrateStateCardsToTemporalFactCandidates(db, newProjectId)
    }

    const agentRunIds = [...(newIdMaps.get('agentRuns')?.values() ?? [])]
    if (agentRunIds.length > 0) {
      await finalizeImportedAgentRunLedgersV1({
        projectId: newProjectId,
        runIds: agentRunIds,
        idMaps: newIdMaps,
      })
    }

    await backfillResourceUidsInCurrentTransactionV1(newProjectId)

    return newProjectId
  })
  // v1-v3 had no portable owner shadows. Upgrade only after the import
  // transaction commits; the ownership service performs its own preflight and
  // atomic stamping without guessing external IDs.
  if (data.version < PORTABLE_OWNER_VERSION) await ensureWorkspaceOwnership(importedProjectId)
  return importedProjectId
}

function remapPortableJsonIdPaths(
  value: unknown,
  paths: readonly string[],
  idMap: Map<number, number>,
  required: boolean,
  label: string,
): string | null | undefined {
  if (value == null) return value === null ? null : undefined
  let parsed: unknown
  try { parsed = typeof value === 'string' ? JSON.parse(value) : structuredClone(value) } catch {
    throw new Error(`[deriveImport] ${label} 不是合法便携 JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[deriveImport] ${label} 必须是 JSON 对象`)
  }
  for (const path of paths) {
    const parts = path.split('.').filter(Boolean)
    let owner = parsed as Record<string, unknown>
    for (const part of parts.slice(0, -1)) {
      const child = owner[part]
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        if (required) throw new Error(`[deriveImport] ${label}.${path} 缺失`)
        owner = {}
        break
      }
      owner = child as Record<string, unknown>
    }
    const field = parts[parts.length - 1]
    if (!field) continue
    const portableId = owner[field]
    if (portableId == null) { owner[field] = null; continue }
    const localId = typeof portableId === 'number' ? idMap.get(portableId) : undefined
    if (localId == null && required) throw new Error(`[deriveImport] ${label}.${path} 缺少本地映射`)
    owner[field] = localId ?? null
  }
  return JSON.stringify(parsed)
}

function remapPortableIdArray(value: unknown, idMap: Map<number, number>, stringify: boolean): number[] | string {
  const mapped = Array.isArray(value)
    ? value.map(index => typeof index === 'number' ? idMap.get(index) : undefined).filter((id): id is number => id != null)
    : []
  return stringify ? JSON.stringify(mapped) : mapped
}

async function remapSceneCharacterIndexes(
  table: any,
  rowId: number,
  field: string,
  portableRefs: unknown,
  idMap: Map<number, number>,
): Promise<unknown[] | undefined> {
  if (!Array.isArray(portableRefs)) return undefined
  const row = await table.get(rowId)
  const scenes = row?.[field]
  if (!Array.isArray(scenes)) return undefined
  return scenes.map((scene: unknown, sceneIndex: number) => {
    if (!scene || typeof scene !== 'object') return scene
    const indexes = portableRefs[sceneIndex]
    const characterIds = Array.isArray(indexes)
      ? indexes.map(index => typeof index === 'number' ? idMap.get(index) : undefined).filter((id): id is number => id != null)
      : []
    return { ...(scene as Record<string, unknown>), characterIds }
  })
}

async function remapObjectArrayIdIndexes(
  table: any,
  rowId: number,
  field: string,
  portableRefs: unknown,
  idMap: Map<number, number>,
  itemField: string,
  stringify: boolean,
): Promise<Array<Record<string, unknown>> | string | undefined> {
  if (!Array.isArray(portableRefs)) return undefined
  const row = await table.get(rowId)
  let parsed: unknown = row?.[field]
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return undefined }
  }
  if (!Array.isArray(parsed)) return undefined
  const items = parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const exportIndex = portableRefs[index]
    if (!(itemField in item) && exportIndex == null) return item
    return {
      ...(item as Record<string, unknown>),
      [itemField]: typeof exportIndex === 'number' ? (idMap.get(exportIndex) ?? null) : null,
    }
  })
  return stringify ? JSON.stringify(items) : items as Array<Record<string, unknown>>
}
