import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import type { NarrativeModule, WorldRelease, WorldReleaseManifestV2, WorldRevision, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from './scope'
import type { ProjectExportData } from '../export/json-export'
import { deriveStrictExportProjectSnapshot } from '../export/registry-export'

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function rowMatchesScope(row: Record<string, unknown>, worldExportId: number, workExportId: number): boolean {
  return row._worldOwnerExportId === worldExportId || row._workOwnerExportId === workExportId
}

async function buildPortableReleaseProject(input: {
  scope: WorkspaceScope
  requestedTables: string[]
  selectedNarrativeModules: NarrativeModule[]
}): Promise<{
  portableProject: ProjectExportData
  selectedNarrativeModules: WorldReleaseManifestV2['selectedNarrativeModules']
}> {
  const snapshot = await deriveStrictExportProjectSnapshot(input.scope.projectId)
  const backup = snapshot.data
  if (backup.version !== 4 || !backup.ownership || !backup.worlds || !backup.works) {
    throw new Error('[release] 世界发布必须基于严格 v4 便携快照')
  }
  const worldExportId = snapshot.exportIds.get('worlds')?.get(input.scope.worldId)
  const workExportId = snapshot.exportIds.get('works')?.get(input.scope.workId)
  const worldRoot = backup.worlds.find(row => row._exportId === worldExportId)
  const workRoot = backup.works.find(row => row._exportId === workExportId)
  if (!worldRoot || !workRoot) throw new Error('[release] 当前 World/Work 不在严格备份中')
  const portableWorldId = worldRoot._exportId
  const portableWorkId = workRoot._exportId
  const moduleRows = input.selectedNarrativeModules.map(module => {
    const exportId = module.id == null ? undefined : snapshot.exportIds.get('narrativeModules')?.get(module.id)
    const exported = backup.narrativeModules?.find(row => row._exportId === exportId)
    return { module, exported }
  })
  if (moduleRows.some(item => !item.exported)) throw new Error('[release] 叙事模块无法映射为便携 ID')
  const selectedModuleExportIds = new Set(moduleRows.map(item => item.exported!._exportId))
  const selectedNarrativeModules = moduleRows.map(item => ({
    exportId: item.exported!._exportId,
    kind: item.module.kind,
    title: item.module.title,
  }))

  const project = clone(backup.project) as Record<string, unknown>
  project._activeWorldExportId = portableWorldId
  project._activeWorkExportId = portableWorkId
  project._activeCharacterDrivenPlanExportId = null
  project.worldCode = worldRoot.code
  project.worldVersion = worldRoot.currentVersion
  project.communityOrigin = worldRoot.communityOrigin
  project.name = workRoot.title
  project.description = workRoot.description
  project.genres = [...workRoot.genres]
  project.genre = workRoot.genres[0] ?? 'other'
  project.status = workRoot.status
  project.targetWordCount = workRoot.targetWordCount
  for (const field of ['currentWordCount', 'coverImage', 'writingStyleId', 'methodologyId'] as const) {
    project[field] = workRoot[field]
  }
  const portable: Record<string, unknown> = {
    version: backup.version,
    exportedAt: backup.exportedAt,
    ownership: { contractVersion: 1, worldExportId: portableWorldId, workExportId: portableWorkId },
    project,
    worlds: [clone(worldRoot)],
    works: [{ ...clone(workRoot), _activeCharacterDrivenPlanExportId: null }],
  }
  const source = backup as unknown as Record<string, unknown>
  for (const tableName of input.requestedTables) {
    if (tableName === 'worlds' || tableName === 'works' || tableName === 'worldReleases') continue
    const rows = Array.isArray(source[tableName]) ? clone(source[tableName] as Record<string, unknown>[]) : []
    if (tableName === 'narrativeModules') {
      portable[tableName] = rows.filter(row => selectedModuleExportIds.has(row._exportId as number))
    } else if (tableName === 'narrativeNodes') {
      portable[tableName] = rows.filter(row => selectedModuleExportIds.has(row._moduleExportId as number))
    } else {
      portable[tableName] = rows.filter(row => rowMatchesScope(row, portableWorldId, portableWorkId))
    }
  }
  const portableWorks = portable.works as Array<Record<string, unknown>>
  portableWorks[0]._activeNarrativeModuleExportId = selectedNarrativeModules[0]?.exportId ?? null
  return { portableProject: portable as unknown as ProjectExportData, selectedNarrativeModules }
}

export async function buildWorldReleaseManifest(input: {
  scope: WorkspaceScope
  selectedTables?: string[]
  selectedNarrativeModuleIds?: number[]
}): Promise<WorldReleaseManifestV2> {
  const scope = await resolveScope({ scope: input.scope })
  const world = await db.worlds.get(scope.worldId)
  if (!world || world.projectId !== scope.projectId) throw new Error('[release] World 不属于当前工作区')
  const publishable = PROJECT_TABLES.filter(spec => spec.communityShare === 'world' && spec.name !== 'worldReleases')
  const requested = input.selectedTables ?? publishable.map(spec => spec.name)
  const unknown = requested.filter(name => !publishable.some(spec => spec.name === name))
  if (unknown.length) throw new Error(`[release] 表未登记为可发布:${unknown.join(', ')}`)
  const moduleIds = [...new Set(input.selectedNarrativeModuleIds ?? [])]
  const modules: NarrativeModule[] = []
  for (const moduleId of moduleIds) {
    const module = await db.narrativeModules.get(moduleId)
    if (!module || !await assertRecordInScope(scope, 'narrativeModules', module)) {
      throw new Error(`[release] 叙事模块 ${moduleId} 不属于当前 scope`)
    }
    modules.push(module)
  }
  const selectedTables = [...new Set([...requested, 'narrativeModules', 'narrativeNodes'])]
  const { portableProject, selectedNarrativeModules } = await buildPortableReleaseProject({
    scope,
    requestedTables: selectedTables,
    selectedNarrativeModules: modules,
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
  return {
    schema: 'storyforge.world-package',
    version: 2,
    worldCode: world.code,
    worldName: world.name,
    workTitle: (await db.works.get(scope.workId))?.title ?? '',
    selectedTables,
    selectedNarrativeModules,
    dependencies,
    records,
    portableProject: portableProject as unknown as Record<string, unknown>,
  }
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
  const manifest = await buildWorldReleaseManifest({ ...input, scope })
  const manifestJson = stableJson(manifest)
  const contentHash = await sha256(manifest)
  return db.transaction('rw', scopeTransactionTables(db.worldRevisions), async () => {
    const currentScope = await resolveScope({ scope })
    if (input.parentRevisionId != null) {
      const parent = await db.worldRevisions.get(input.parentRevisionId)
      if (!parent || parent.worldId !== currentScope.worldId || parent.projectId !== currentScope.projectId) {
        throw new Error('[release] 父修订不属于当前 World')
      }
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
  const recalculated = await sha256(JSON.parse(revision.manifestJson))
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
    const releases = await db.worldReleases.where('worldId').equals(currentRevision.worldId).toArray()
    const row: WorldRelease = {
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
  if (await sha256(JSON.parse(release.manifestJson)) !== release.contentHash) {
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
