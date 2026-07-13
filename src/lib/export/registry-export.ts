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
import type { TableSpec } from '../registry/types'
import type { ProjectExportData } from './json-export'

/** 当前导出格式版本(与手写版保持一致) */
const EXPORT_VERSION = 3

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
    }
  }

  return obj
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
export async function deriveExportProjectJSON(projectId: number): Promise<ProjectExportData> {
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
  const { id: _pid, ...projectData } = project
  const result: any = {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    project: projectData,
  }
  for (const spec of specs) {
    const rows = rowsByTable.get(spec.name)!
    const out: any[] = []
    rows.forEach((row, i) => {
      const exported = toExportRow(spec, row, i, idMaps)
      if (exported != null) out.push(exported)
    })
    result[spec.name] = out
  }

  return result as ProjectExportData
}
