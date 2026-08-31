import Dexie from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import type {
  WorldRelease,
  WorldReleaseManifestV2,
  WorldRevision,
  WorkspaceScope,
} from '../types'
import { WORLD_CAPABILITY_AREAS, type TableSpec, type WorldReleaseSection } from '../registry/types'
import { resolveScope, scopeTransactionTables } from './scope'
import type { ProjectExportData } from '../export/json-export'
import {
  deriveStrictExportProjectSnapshot,
  deriveStrictExportProjectSnapshotInCurrentTransaction,
  type StrictProjectExportSnapshot,
} from '../export/registry-export'
import { isShareableWorld } from '../product/world-identity'
import { effectiveWorkKind } from './work-kind'

// Release snapshots are deliberately sparse world-share packages, not v6+
// full-project backups. v5 predates mandatory adaptation-private tables.
const WORLD_RELEASE_PORTABLE_BACKUP_VERSION = 5

export const WORLD_RELEASE_SECTIONS: ReadonlyArray<{
  key: WorldReleaseSection
  label: string
  description: string
}> = [
  { key: 'foundation', label: '世界基础', description: '自然、人文、规则、地点、实体、词条与多世界结构' },
  { key: 'characters', label: '角色与关系', description: '角色主档、关系与已确认认知' },
  { key: 'narrative', label: '故事设计', description: '故事核心、主线支线、年表、事实与伏笔' },
  { key: 'outline', label: '大纲、细纲与正文', description: '卷章结构、场景级细纲及作者确认正文' },
]

export function worldReleaseSectionTables(section: WorldReleaseSection): string[] {
  const areas = section === 'foundation'
    ? new Set(['foundation', 'entities', 'multi-world'])
    : section === 'characters'
      ? new Set(['characters', 'relations'])
      : section === 'narrative'
        ? new Set(['story', 'storylines'])
        : new Set(['outline', 'detailed-outline', 'manuscript'])
  return PROJECT_TABLES
    .filter(spec => spec.worldSemantic && areas.has(spec.worldSemantic.area))
    .map(spec => spec.name)
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function strictSnapshotContentJson(snapshot: StrictProjectExportSnapshot): string {
  // exportedAt is backup transport metadata, not source content. Normalizing
  // it lets the transaction compare two exact registry snapshots without
  // invoking WebCrypto while IndexedDB must remain live. `ownership` is also
  // transport metadata: an explicit non-active Work release legitimately uses
  // a different export root while the stored project/World/Work rows remain
  // identical and are still compared below.
  const { ownership: _transportOwnership, ...content } = snapshot.data
  return stableJson({ ...content, exportedAt: 0 })
}

async function sha256(value: unknown): Promise<string> {
  const digestPromise = crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))
  const digest = Dexie.currentTransaction
    ? await Dexie.waitFor(digestPromise)
    : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Canonical content hash used by WorldRevision and WorldRelease integrity checks. */
export async function hashWorldReleaseManifestV1(value: unknown): Promise<string> {
  return sha256(value)
}

/** Portable, content-bound identity. The local numeric row id is deliberately
 * excluded so export/import reference remapping cannot change the identity. */
export function worldReleaseUidV1(input: {
  worldCode: string
  version: number
  contentHash: string
}): string {
  return `WR-${encodeURIComponent(input.worldCode)}-v${input.version}-${input.contentHash.slice(0, 24)}`
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function rowMatchesScope(row: Record<string, unknown>, worldExportId: number, workExportId: number): boolean {
  return row._worldOwnerExportId === worldExportId || row._workOwnerExportId === workExportId
}

function isSemanticCanonRow(spec: TableSpec, row: Record<string, unknown>): boolean {
  const policy = spec.worldSemantic
  if (!policy) return false
  if (policy.canonPolicy === 'authoritative-table') return true
  const status = policy.statusField ? row[policy.statusField] : undefined
  return typeof status === 'string' && Boolean(policy.confirmedStatusValues?.includes(status))
}

interface SemanticSelectionStatsV1 {
  table: string
  selected: boolean
  confirmedRowCount: number
  candidateRowCount: number
  conflictRowCount: number
  omittedRowCount: number
  latestRevision: number | null
}

function semanticExcludedState(
  spec: TableSpec,
  row: Record<string, unknown>,
): 'candidate' | 'conflict' | 'omitted' {
  const status = spec.worldSemantic?.statusField
    ? String(row[spec.worldSemantic.statusField] ?? '').trim().toLocaleLowerCase('en-US')
    : ''
  if (['conflict', 'conflicted', 'contradicted', 'disputed', 'stale', 'source-missing', 'invalid-range'].includes(status)) return 'conflict'
  if (['candidate', 'proposed', 'proposal', 'pending', 'draft', 'suggested'].includes(status)) return 'candidate'
  return 'omitted'
}

function latestSemanticRevision(rows: readonly Record<string, unknown>[]): number | null {
  const values = rows.flatMap(row => [row.updatedAt, row.createdAt, row.revision, row.version])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return values.length ? Math.max(...values) : null
}

async function buildPortableReleaseProject(input: {
  scope: WorkspaceScope
  requestedTables: string[]
  strictSnapshot?: StrictProjectExportSnapshot
}): Promise<{
  portableProject: ProjectExportData
  selectedNarrativeModules: WorldReleaseManifestV2['selectedNarrativeModules']
  semanticSelectionStats: SemanticSelectionStatsV1[]
}> {
  const snapshot = input.strictSnapshot
    ?? await deriveStrictExportProjectSnapshot(input.scope.projectId)
  const backup = snapshot.data
  if (backup.version < 4 || !backup.ownership || !backup.worlds || !backup.works) {
    throw new Error('[release] 世界发布必须基于 v4+ 严格便携快照')
  }
  const worldExportId = snapshot.exportIds.get('worlds')?.get(input.scope.worldId)
  const workExportId = snapshot.exportIds.get('works')?.get(input.scope.workId)
  const worldRoot = backup.worlds.find(row => row._exportId === worldExportId)
  const workRoot = backup.works.find(row => row._exportId === workExportId)
  if (!worldRoot || !workRoot) throw new Error('[release] 当前 World/Work 不在严格备份中')
  const portableWorldId = worldRoot._exportId
  const portableWorkId = workRoot._exportId
  const sourceProject = clone(backup.project) as Record<string, unknown>
  const project: Record<string, unknown> = {
    workspaceUid: sourceProject.workspaceUid,
    workspacePurpose: 'world-engine',
    workspacePurposeDecision: 'explicit',
    name: worldRoot.name ?? workRoot.title,
    description: worldRoot.description ?? workRoot.description ?? '',
    genres: Array.isArray(workRoot.genres) ? [...workRoot.genres] : ['other'],
    genre: Array.isArray(workRoot.genres) ? workRoot.genres[0] ?? 'other' : 'other',
    status: 'drafting',
    targetWordCount: 0,
    currentWordCount: 0,
    enableMultiWorld: Boolean(sourceProject.enableMultiWorld),
    worldCode: worldRoot.code,
    worldVersion: worldRoot.currentVersion,
    communityOrigin: worldRoot.communityOrigin,
    ownershipSchemaVersion: 1,
    _activeWorldExportId: portableWorldId,
    _activeWorkExportId: portableWorkId,
    _activeCharacterDrivenPlanExportId: null,
    createdAt: 0,
    updatedAt: 0,
  }
  const portable: Record<string, unknown> = {
    version: Math.min(backup.version, WORLD_RELEASE_PORTABLE_BACKUP_VERSION),
    // Release content hashes must depend on content, not the wall clock used
    // while deriving an otherwise identical portable snapshot.
    exportedAt: 0,
    ownership: { contractVersion: 1, worldExportId: portableWorldId, workExportId: portableWorkId },
    project,
    worlds: [clone(worldRoot)],
    works: [{ ...clone(workRoot), _activeCharacterDrivenPlanExportId: null }],
  }
  const source = backup as unknown as Record<string, unknown>
  const requestedTableSet = new Set(input.requestedTables)
  const semanticSelectionStats = PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => {
    const rows = Array.isArray(source[spec.name])
      ? clone(source[spec.name] as Record<string, unknown>[])
        .filter(row => rowMatchesScope(row, portableWorldId, portableWorkId))
      : []
    const selected = requestedTableSet.has(spec.name)
    if (!selected) {
      return {
        table: spec.name,
        selected,
        confirmedRowCount: 0,
        candidateRowCount: 0,
        conflictRowCount: 0,
        omittedRowCount: rows.length,
        latestRevision: latestSemanticRevision(rows),
      }
    }
    const confirmed = rows.filter(row => isSemanticCanonRow(spec, row))
    const excluded = rows.filter(row => !isSemanticCanonRow(spec, row)).map(row => semanticExcludedState(spec, row))
    return {
      table: spec.name,
      selected,
      confirmedRowCount: confirmed.length,
      candidateRowCount: excluded.filter(state => state === 'candidate').length,
      conflictRowCount: excluded.filter(state => state === 'conflict').length,
      omittedRowCount: excluded.filter(state => state === 'omitted').length,
      latestRevision: latestSemanticRevision(rows),
    }
  })
  for (const tableName of input.requestedTables) {
    if (tableName === 'worlds' || tableName === 'works' || tableName === 'worldReleases') continue
    const rows = Array.isArray(source[tableName]) ? clone(source[tableName] as Record<string, unknown>[]) : []
    const spec = PROJECT_TABLES.find(candidate => candidate.name === tableName)
    if (!spec?.worldSemantic) throw new Error(`[release] ${tableName} 未登记为世界语义资源`)
    portable[tableName] = rows
      .filter(row => rowMatchesScope(row, portableWorldId, portableWorkId))
      .filter(row => isSemanticCanonRow(spec, row))
  }
  const portableWorks = portable.works as Array<Record<string, unknown>>
  portableWorks[0]._activeNarrativeModuleExportId = null
  for (const field of [
    'coverImage', 'writingStyleId', 'methodologyId', 'activeCharacterDrivenPlanId',
    'postAdoptionPolicy', 'postAdoptionTaskTypes', 'postAdoptionBudget',
  ]) delete portableWorks[0][field]
  // A WorldRelease owns semantic world content, not the source product's
  // long/short/screenplay/comic workflow identity. Keep only a neutral Work
  // compatibility root; derivation provenance records the true source kind.
  portableWorks[0].kind = 'novel'
  portableWorks[0].novelProfile = 'long'
  portableWorks[0].targetWordCount = 0
  portableWorks[0].currentWordCount = 0
  return {
    portableProject: portable as unknown as ProjectExportData,
    selectedNarrativeModules: [],
    semanticSelectionStats,
  }
}

async function buildWorldReleaseManifestInternal(input: {
  scope: WorkspaceScope
  selectedTables?: string[]
  selectedNarrativeModuleIds?: number[]
}, strictSnapshot?: StrictProjectExportSnapshot, options?: {
  allowInternalSource?: boolean
  sourceKind?: 'world-draft' | 'independent-work-derivation'
}): Promise<WorldReleaseManifestV2> {
  const scope = await resolveScope({ scope: input.scope })
  const world = await db.worlds.get(scope.worldId)
  if (!world || world.projectId !== scope.projectId) throw new Error('[release] World 不属于当前工作区')
  if (!options?.allowInternalSource && !isShareableWorld(world)) {
    throw new Error('[release] 独立作品的内部作用域不能直接发布；请先显式派生世界草稿')
  }
  const publishable = PROJECT_TABLES.filter(spec => spec.worldSemantic)
  const requested = input.selectedTables ?? publishable.map(spec => spec.name)
  const unknown = requested.filter(name => !publishable.some(spec => spec.name === name))
  if (unknown.length) throw new Error(`[release] 表未登记为可发布:${unknown.join(', ')}`)
  if (input.selectedNarrativeModuleIds?.length) {
    throw new Error('[release] 可执行叙事模块属于上层产品，不能封存进语义 WorldRelease')
  }
  const selectedTables = [...new Set(requested)]
  const { portableProject, selectedNarrativeModules, semanticSelectionStats } = await buildPortableReleaseProject({
    scope,
    requestedTables: selectedTables,
    strictSnapshot,
  })
  const portableRecord = portableProject as unknown as Record<string, unknown>
  const records = Object.fromEntries(selectedTables.map(name => [
    name,
    Array.isArray(portableRecord[name]) ? clone(portableRecord[name] as unknown[]) : [],
  ]))
  const dependencies = await Promise.all(Object.entries(records).map(async ([table, rows]) => ({
    table,
    rowCount: rows.length,
    contentHash: await sha256(rows),
  })))
  const resourceCatalog = dependencies.map(dependency => {
    const semantic = PROJECT_TABLES.find(spec => spec.name === dependency.table)!.worldSemantic!
    const stats = semanticSelectionStats.find(item => item.table === dependency.table)!
    return {
      // Public release coordinates describe semantic capabilities. The
      // physical table remains an internal import locator and must never leak
      // into product adapters or prompts.
      resourceId: `world:${world.code}:semantic:${semantic.area}:${semantic.resourceKind}`,
      resourceKind: semantic.resourceKind,
      area: semantic.area,
      table: dependency.table,
      rowCount: dependency.rowCount,
      contentHash: dependency.contentHash,
      confirmedRowCount: stats.confirmedRowCount,
      candidateRowCount: stats.candidateRowCount,
      conflictRowCount: stats.conflictRowCount,
      omittedRowCount: stats.omittedRowCount,
      latestRevision: stats.latestRevision,
    }
  })
  const capabilityProfile = WORLD_CAPABILITY_AREAS.map(area => {
    const areaSpecs = PROJECT_TABLES.filter(spec => spec.worldSemantic?.area === area)
    const areaStats = semanticSelectionStats.filter(item => areaSpecs.some(spec => spec.name === item.table))
    const resources = resourceCatalog.filter(resource => resource.area === area)
    const rowCount = resources.reduce((sum, resource) => sum + resource.rowCount, 0)
    const selectedResourceCount = areaStats.filter(item => item.selected).length
    const omittedResourceCount = areaStats.length - selectedResourceCount
    const latestRevisions = areaStats.map(item => item.latestRevision).filter((value): value is number => value != null)
    return {
      area,
      resourceCount: areaStats.length,
      rowCount,
      status: rowCount === 0
        ? 'missing' as const
        : omittedResourceCount === 0 && resources.every(resource => resource.rowCount > 0)
          ? 'available' as const
          : 'partial' as const,
      selectionStatus: selectedResourceCount === 0
        ? 'omitted' as const
        : omittedResourceCount === 0
          ? 'selected' as const
          : 'partial-selection' as const,
      selectedResourceCount,
      omittedResourceCount,
      confirmedRowCount: areaStats.reduce((sum, item) => sum + item.confirmedRowCount, 0),
      candidateRowCount: areaStats.reduce((sum, item) => sum + item.candidateRowCount, 0),
      conflictRowCount: areaStats.reduce((sum, item) => sum + item.conflictRowCount, 0),
      omittedRowCount: areaStats.reduce((sum, item) => sum + item.omittedRowCount, 0),
      latestRevision: latestRevisions.length ? Math.max(...latestRevisions) : null,
      originalEvidenceAvailable: rowCount > 0,
      queryableIndexAvailable: rowCount > 0,
    }
  })
  const work = await db.works.get(scope.workId)
  const project = await db.projects.get(scope.projectId)
  const semanticResourceId = (spec: TableSpec) =>
    `world:${world.code}:semantic:${spec.worldSemantic!.area}:${spec.worldSemantic!.resourceKind}`
  const selectedResourceIds = publishable.filter(spec => selectedTables.includes(spec.name)).map(semanticResourceId)
  const omittedResourceIds = publishable.filter(spec => !selectedTables.includes(spec.name)).map(semanticResourceId)
  const sourceManifestBase = {
    sourceKind: options?.sourceKind ?? 'world-draft' as const,
    sourceWorkspaceUid: project?.workspaceUid ?? `legacy:${scope.projectId}`,
    sourceWorldCode: world.code,
    sourceWorkCode: work?.code ?? `legacy:${scope.workId}`,
    selectedResourceIds,
    omittedResourceIds,
  }
  const sourceManifest = { ...sourceManifestBase, contentHash: await sha256(sourceManifestBase) }
  return {
    schema: 'storyforge.world-package',
    version: 2,
    semanticContract: 3,
    worldCode: world.code,
    worldName: world.name,
    workTitle: (await db.works.get(scope.workId))?.title ?? '',
    selectedTables,
    selectedNarrativeModules,
    dependencies,
    records,
    portableProject: portableProject as unknown as Record<string, unknown>,
    capabilityProfile,
    resourceCatalog,
    sourceManifest,
  }
}

export async function buildWorldReleaseManifest(input: {
  scope: WorkspaceScope
  selectedTables?: string[]
  selectedNarrativeModuleIds?: number[]
}, strictSnapshot?: StrictProjectExportSnapshot): Promise<WorldReleaseManifestV2> {
  return buildWorldReleaseManifestInternal(input, strictSnapshot)
}

/**
 * ARCH-01: capture a novel's confirmed semantic Canon for an explicit,
 * immutable derivation.  This never publishes the source's internal scope.
 */
export async function buildIndependentWorkWorldSnapshot(input: {
  scope: WorkspaceScope
  selectedTables?: string[]
}): Promise<WorldReleaseManifestV2> {
  const scope = await resolveScope({ scope: input.scope })
  const [project, world, work] = await Promise.all([
    db.projects.get(scope.projectId),
    db.worlds.get(scope.worldId),
    db.works.get(scope.workId),
  ])
  if (!project || !world || !work) throw new Error('[derivation] 源作品作用域不存在')
  if (project.workspacePurpose === 'world-engine' || isShareableWorld(world)) {
    throw new Error('[derivation] 该来源已经是世界引擎，不需要再次派生')
  }
  if (effectiveWorkKind(work) !== 'novel') {
    throw new Error('[derivation] 只有长篇或短篇小说可以显式派生世界')
  }
  const manifest = await buildWorldReleaseManifestInternal({
    scope,
    selectedTables: input.selectedTables,
  }, undefined, {
    allowInternalSource: true,
    sourceKind: 'independent-work-derivation',
  })
  manifest.workTitle = work.title
  return manifest
}

export async function createWorldRevision(input: {
  scope: WorkspaceScope
  label: string
  parentRevisionId?: number | null
  selectedTables?: string[]
  selectedNarrativeModuleIds?: number[]
}): Promise<WorldRevision> {
  const scope = await resolveScope({ scope: input.scope })
  if (input.parentRevisionId != null) {
    const parent = await db.worldRevisions.get(input.parentRevisionId)
    if (!parent || parent.worldId !== scope.worldId || parent.projectId !== scope.projectId) {
      throw new Error('[release] 父修订不属于当前 World')
    }
  }
  const sourceSnapshot = await deriveStrictExportProjectSnapshot(scope.projectId)
  const sourceSnapshotJson = strictSnapshotContentJson(sourceSnapshot)
  const manifest = await buildWorldReleaseManifest({ ...input, scope }, sourceSnapshot)
  const manifestJson = stableJson(manifest)
  const contentHash = await hashWorldReleaseManifestV1(manifest)
  return db.transaction('rw', scopeTransactionTables(
    ...PROJECT_TABLES.map(spec => spec.table),
  ), async () => {
    const currentScope = await resolveScope({ scope })
    if (input.parentRevisionId != null) {
      const parent = await db.worldRevisions.get(input.parentRevisionId)
      if (!parent || parent.worldId !== currentScope.worldId || parent.projectId !== currentScope.projectId) {
        throw new Error('[release] 父修订不属于当前 World')
      }
    }
    const strictSnapshot = await deriveStrictExportProjectSnapshotInCurrentTransaction(
      currentScope.projectId,
      currentScope,
    )
    if (strictSnapshotContentJson(strictSnapshot) !== sourceSnapshotJson) {
      throw new Error('[release] 世界内容在修订冻结过程中发生变化，请重试')
    }
    const revisions = await db.worldRevisions.where('worldId').equals(currentScope.worldId).toArray()
    const ts = Date.now()
    const row: WorldRevision = {
      projectId: currentScope.projectId,
      worldId: currentScope.worldId,
      parentRevisionId: input.parentRevisionId ?? null,
      revision: Math.max(0, ...revisions.map(item => item.revision)) + 1,
      label: input.label.trim() || `修订 ${revisions.length + 1}`,
      manifestJson,
      contentHash,
      createdAt: ts,
      updatedAt: ts,
    }
    const id = await db.worldRevisions.add(row) as number
    return { ...row, id }
  })
}

export async function publishWorldRevision(revisionId: number, label?: string): Promise<WorldRelease> {
  const revision = await db.worldRevisions.get(revisionId)
  if (!revision) throw new Error('[release] 修订不存在')
  const recalculated = await hashWorldReleaseManifestV1(JSON.parse(revision.manifestJson))
  if (recalculated !== revision.contentHash) throw new Error('[release] 修订内容哈希不匹配')
  return db.transaction('rw', db.worldRevisions, db.worldReleases, db.worlds, db.projects, async () => {
    const currentRevision = await db.worldRevisions.get(revisionId)
    if (!currentRevision
      || currentRevision.manifestJson !== revision.manifestJson
      || currentRevision.contentHash !== revision.contentHash) {
      throw new Error('[release] 修订在发布过程中发生变化')
    }
    const existing = await db.worldReleases.where('revisionId').equals(revisionId).first()
    if (existing) return existing
    const world = await db.worlds.get(currentRevision.worldId)
    if (!world || world.projectId !== currentRevision.projectId) throw new Error('[release] 修订 World 不存在')
    if (!isShareableWorld(world)) throw new Error('[release] 内部作用域不能发布为 WorldRelease')
    const releases = await db.worldReleases.where('worldId').equals(currentRevision.worldId).toArray()
    const row: WorldRelease = {
      releaseUid: worldReleaseUidV1({
        worldCode: world.code,
        version: Math.max(0, ...releases.map(item => item.version)) + 1,
        contentHash: currentRevision.contentHash,
      }),
      projectId: currentRevision.projectId,
      worldId: currentRevision.worldId,
      revisionId: currentRevision.id!,
      version: Math.max(0, ...releases.map(item => item.version)) + 1,
      label: label?.trim() || currentRevision.label,
      manifestJson: currentRevision.manifestJson,
      contentHash: currentRevision.contentHash,
      sourceWorldCode: world.code,
      createdAt: Date.now(),
    }
    const id = await db.worldReleases.add(row) as number
    const updatedAt = Date.now()
    await db.worlds.update(world.id!, { currentVersion: row.version, updatedAt })
    if ((await db.projects.get(world.projectId))?.activeWorldId === world.id) {
      await db.projects.update(world.projectId, { worldVersion: row.version, updatedAt })
    }
    return { ...row, id }
  })
}

/**
 * Regression-only semantic release for historical product-kernel fixtures.
 *
 * Legacy AVG/adventure/chat/etc. unit tests keep their product draft in an
 * independent workspace, while the current production architecture requires a
 * product release to bind an immutable semantic WorldRelease.  Creating a
 * second derived project in every kernel test would obscure the algorithm
 * under test, so this helper freezes the same pure-semantic manifest in the
 * fixture's internal scope without promoting that scope to a public world.
 *
 * Production code can never use this path: the environment guard is
 * unconditional, and architecture checks forbid UI/service imports.  Formal
 * products must use an explicit WorldReference and the stage-two/three
 * production flow.
 */
export async function createInternalProductWorldReleaseFixtureV1(input: {
  scope: WorkspaceScope
  label: string
  parentRevisionId?: number | null
  selectedTables?: string[]
}): Promise<{ revision: WorldRevision; release: WorldRelease }> {
  if (import.meta.env.MODE !== 'test') {
    throw new Error('createInternalProductWorldReleaseFixtureV1 仅允许隔离测试环境使用')
  }
  const scope = await resolveScope({ scope: input.scope })
  const world = await db.worlds.get(scope.worldId)
  if (!world || world.projectId !== scope.projectId) throw new Error('[fixture] World 不属于当前工作区')

  // A real world-engine fixture should exercise the real public boundary.
  if (isShareableWorld(world)) {
    const revisions = await listWorldRevisions(scope)
    const revision = await createWorldRevision({
      scope,
      label: input.label,
      parentRevisionId: input.parentRevisionId === undefined
        ? revisions[0]?.id ?? null
        : input.parentRevisionId,
      selectedTables: input.selectedTables,
    })
    return { revision, release: await publishWorldRevision(revision.id!, input.label) }
  }

  const revisions = await db.worldRevisions.where('worldId').equals(scope.worldId).toArray()
  const parentRevisionId = input.parentRevisionId === undefined
    ? revisions.sort((left, right) => right.revision - left.revision)[0]?.id ?? null
    : input.parentRevisionId
  if (parentRevisionId != null) {
    const parent = await db.worldRevisions.get(parentRevisionId)
    if (!parent || parent.projectId !== scope.projectId || parent.worldId !== scope.worldId) {
      throw new Error('[fixture] 父修订不属于当前内部作用域')
    }
  }
  const sourceSnapshot = await deriveStrictExportProjectSnapshot(scope.projectId)
  const sourceSnapshotJson = strictSnapshotContentJson(sourceSnapshot)
  const manifest = await buildWorldReleaseManifestInternal({
    scope,
    selectedTables: input.selectedTables,
  }, sourceSnapshot, {
    allowInternalSource: true,
    sourceKind: 'independent-work-derivation',
  })
  const manifestJson = stableJson(manifest)
  const contentHash = await hashWorldReleaseManifestV1(manifest)

  return db.transaction('rw', scopeTransactionTables(
    ...PROJECT_TABLES.map(spec => spec.table),
  ), async () => {
    const currentScope = await resolveScope({ scope })
    const currentWorld = await db.worlds.get(currentScope.worldId)
    if (!currentWorld || currentWorld.projectId !== currentScope.projectId || isShareableWorld(currentWorld)) {
      throw new Error('[fixture] 内部作用域身份在冻结期间发生变化')
    }
    if (parentRevisionId != null) {
      const parent = await db.worldRevisions.get(parentRevisionId)
      if (!parent || parent.projectId !== currentScope.projectId || parent.worldId !== currentScope.worldId) {
        throw new Error('[fixture] 父修订在冻结期间发生变化')
      }
    }
    const strictSnapshot = await deriveStrictExportProjectSnapshotInCurrentTransaction(
      currentScope.projectId,
      currentScope,
    )
    if (strictSnapshotContentJson(strictSnapshot) !== sourceSnapshotJson) {
      throw new Error('[fixture] 内部语义内容在冻结期间发生变化')
    }

    const [currentRevisions, currentReleases] = await Promise.all([
      db.worldRevisions.where('worldId').equals(currentScope.worldId).toArray(),
      db.worldReleases.where('worldId').equals(currentScope.worldId).toArray(),
    ])
    const timestamp = Date.now()
    const revisionRow: WorldRevision = {
      projectId: currentScope.projectId,
      worldId: currentScope.worldId,
      parentRevisionId,
      revision: Math.max(0, ...currentRevisions.map(item => item.revision)) + 1,
      label: input.label.trim() || `fixture revision ${currentRevisions.length + 1}`,
      manifestJson,
      contentHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const revisionId = await db.worldRevisions.add(revisionRow) as number
    const version = Math.max(0, ...currentReleases.map(item => item.version)) + 1
    const releaseRow: WorldRelease = {
      releaseUid: worldReleaseUidV1({
        worldCode: currentWorld.code,
        version,
        contentHash,
      }),
      projectId: currentScope.projectId,
      worldId: currentScope.worldId,
      revisionId,
      version,
      label: revisionRow.label,
      manifestJson,
      contentHash,
      sourceWorldCode: currentWorld.code,
      createdAt: timestamp,
    }
    const releaseId = await db.worldReleases.add(releaseRow) as number
    return {
      revision: { ...revisionRow, id: revisionId },
      release: { ...releaseRow, id: releaseId },
    }
  })
}

export async function diffWorldRevisions(leftId: number, rightId: number): Promise<{
  added: string[]
  removed: string[]
  changed: string[]
}> {
  const [left, right] = await Promise.all([db.worldRevisions.get(leftId), db.worldRevisions.get(rightId)])
  if (!left || !right || left.worldId !== right.worldId) throw new Error('[release] 只能比较同一 World 的修订')
  const leftRecords = (JSON.parse(left.manifestJson) as WorldReleaseManifestV2).records
  const rightRecords = (JSON.parse(right.manifestJson) as WorldReleaseManifestV2).records
  const names = new Set([...Object.keys(leftRecords), ...Object.keys(rightRecords)])
  const added: string[] = []; const removed: string[] = []; const changed: string[] = []
  for (const name of names) {
    if (!(name in leftRecords)) added.push(name)
    else if (!(name in rightRecords)) removed.push(name)
    else if (stableJson(leftRecords[name]) !== stableJson(rightRecords[name])) changed.push(name)
  }
  return { added, removed, changed }
}

export async function assertReleaseUnchanged(releaseId: number): Promise<void> {
  const release = await db.worldReleases.get(releaseId)
  if (!release) throw new Error('[release] 发布版本不存在')
  if (await hashWorldReleaseManifestV1(JSON.parse(release.manifestJson)) !== release.contentHash) {
    throw new Error('[release] 发布版本已被篡改')
  }
}

export async function listWorldRevisions(scope: WorkspaceScope): Promise<WorldRevision[]> {
  scope = await resolveScope({ scope })
  const world = await db.worlds.get(scope.worldId)
  if (!world || world.projectId !== scope.projectId) throw new Error('[release] World 不属于当前工作区')
  const rows = await db.worldRevisions.where('worldId').equals(scope.worldId).toArray()
  return rows.sort((left, right) => right.revision - left.revision)
}

export async function listWorldReleases(scope: WorkspaceScope): Promise<WorldRelease[]> {
  scope = await resolveScope({ scope })
  const world = await db.worlds.get(scope.worldId)
  if (!world || world.projectId !== scope.projectId) throw new Error('[release] World 不属于当前工作区')
  const rows = await db.worldReleases.where('worldId').equals(scope.worldId).toArray()
  return rows.sort((left, right) => right.version - left.version)
}
