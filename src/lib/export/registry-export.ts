/**
 * 注册表派生的项目导出引擎(AUDIT-1)
 *
 * 取代 json-export.ts 中 580 行手写枚举:遍历 PROJECT_TABLES 中 exportable 的表,
 * 按其元数据(worldScoped / tree / exportRemap / exportIdField / exportRefRemap)自动
 * 把库内记录转成可移植的 ProjectExportData——加新表只需在注册表登记一行,自动进出导出。
 *
 * 产物与旧手写版**逐字段等价**(R-export-derive-equivalence 锁死),故旧备份格式、Gist
 * 云存档全部兼容。
 */
import { db } from '../db/schema'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../registry/project-tables'
import { remapWorldPortalTargets } from '../utils/world-portals'
import { parseCharacterDrivenPlanArcs } from '../types/character-driven-plan'
import type { TableSpec } from '../registry/types'
import type { ProjectExportData } from './json-export'
import { redactAuthoringSecrets } from '../node-authoring/contracts'
import { ensureWorkspaceOwnership } from '../world-engine/ownership'

/** 当前导出格式版本(与手写版保持一致) */
const EXPORT_VERSION = 3
export const STRICT_EXPORT_VERSION = 4

export interface StrictProjectExportSnapshot {
  data: ProjectExportData
  exportIds: ReadonlyMap<string, ReadonlyMap<number, number>>
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
    if (rr.kind === 'portals') {
      const map = idMaps.get(rr.remapVia)
      obj[rr.field] = remapWorldPortalTargets(obj[rr.field], (targetId: number) => map?.get(targetId))
    } else if (rr.kind === 'id-array') {
      const map = idMaps.get(rr.remapVia)
      const raw = parseIdArray(obj[rr.field])
      obj[rr.exportAs] = raw.map(id => map?.get(id)).filter((id): id is number => id != null)
    } else if (rr.kind === 'scene-character-ids') {
      const map = idMaps.get(rr.remapVia)
      obj[rr.exportAs] = Array.isArray(obj[rr.field])
        ? obj[rr.field].map((scene: any) => Array.isArray(scene?.characterIds)
          ? scene.characterIds.map((id: unknown) => typeof id === 'number' ? map?.get(id) : undefined).filter((id: unknown): id is number => typeof id === 'number')
          : [])
        : []
    } else if (rr.kind === 'character-plan-arcs') {
      const map = idMaps.get(rr.remapVia)
      obj[rr.exportAs] = parseCharacterDrivenPlanArcs(obj[rr.field]).map(arc =>
        arc.characterId == null ? null : (map?.get(arc.characterId) ?? null),
      )
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
    }
  }

  return spec.name === 'nodeFlows' || spec.name === 'nodeRuns'
    ? redactAuthoringSecrets(obj)
    : obj
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

/**
 * 派生导出:产出与手写 exportProjectJSON 逐字段等价的 ProjectExportData。
 */
export async function deriveExportProjectJSON(
  projectId: number,
  options: { strict?: boolean } = {},
): Promise<ProjectExportData> {
  return options.strict
    ? deriveStrictExportProjectJSON(projectId)
    : deriveProjectExport(projectId, EXPORT_VERSION, false)
}

async function captureProjectExportInTransaction(
  projectId: number,
  version: number,
  strictOwners: boolean,
): Promise<StrictProjectExportSnapshot> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')

  const specs = PROJECT_TABLES.filter(s => s.exportable && s.name !== 'projects')

  // 第一遍:查询每张表 + 建 dbId → 导出序号 映射
  const rowsByTable = new Map<string, any[]>()
  const idMaps = new Map<string, Map<number, number>>()
  for (const spec of specs) {
    const rows = await queryRows(spec, projectId)
    rowsByTable.set(spec.name, rows)
    const idMap = new Map<number, number>()
    rows.forEach((r, i) => { if (r.id != null) idMap.set(r.id, i) })
    idMaps.set(spec.name, idMap)
  }

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

  return { data: result as ProjectExportData, exportIds: idMaps }
}

async function captureProjectExport(projectId: number, version: number, strictOwners: boolean): Promise<StrictProjectExportSnapshot> {
  const tables = [...new Set(PROJECT_TABLES.filter(spec => spec.exportable).map(spec => spec.table))]
  return db.transaction('r', tables, () => captureProjectExportInTransaction(projectId, version, strictOwners))
}

async function deriveProjectExport(projectId: number, version: number, strictOwners: boolean): Promise<ProjectExportData> {
  return (await captureProjectExport(projectId, version, strictOwners)).data
}

/**
 * WORLD-2C C4 strict export. The v3 derivation remains available for old
 * fixture equivalence tests, while all user-facing backups use this boundary.
 * Logical World/Work ownership is represented only by portable shadow IDs;
 * physical IDs never cross the backup boundary.
 */
export async function deriveStrictExportProjectJSON(projectId: number): Promise<ProjectExportData> {
  return (await deriveStrictExportProjectSnapshot(projectId)).data
}

export async function deriveStrictExportProjectSnapshot(projectId: number): Promise<StrictProjectExportSnapshot> {
  const existingWorlds = await db.worlds.where('projectId').equals(projectId).count()
  const existingWorks = await db.works.where('projectId').equals(projectId).count()
  if (existingWorlds === 0 && existingWorks === 0) {
    // Preserve the zero-data backup contract: there is no ownership to
    // migrate, so an empty workspace remains a compact v3-compatible file.
    return captureProjectExport(projectId, EXPORT_VERSION, false)
  }
  const ownership = await ensureWorkspaceOwnership(projectId)
  const snapshot = await captureProjectExport(projectId, STRICT_EXPORT_VERSION, true)
  const worldExportId = snapshot.exportIds.get('worlds')?.get(ownership.scope.worldId)
  const workExportId = snapshot.exportIds.get('works')?.get(ownership.scope.workId)
  if (worldExportId == null || workExportId == null) throw new Error('[strictExport] ownership 根不在导出快照中')
  snapshot.data.ownership = {
    contractVersion: 1,
    worldExportId,
    workExportId,
  }
  // Keep the ownership resolver observable to callers and make an accidental
  // unused migration result impossible to hide in diagnostics.
  if (!ownership.scope.worldId || !ownership.scope.workId) throw new Error('[strictExport] ownership 根不完整')
  return snapshot
}
