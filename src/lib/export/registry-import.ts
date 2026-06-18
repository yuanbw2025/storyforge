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
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import { remapWorldPortalTargets } from '../utils/world-portals'
import { transactionTablesFor } from '../registry/lifecycle'
import { importLegacyArraysToCodex } from '../migrations/legacy-to-codex-upgrade'
import type { TableSpec } from '../registry/types'
import type { ProjectExportData } from './json-export'
import { normalizeCharacterAxes } from '../character/character-axes'

/** 表级拓扑排序:被 remapVia 指向的表必须先导入(selfTree 不算表间依赖) */
function deriveImportOrder(specs: TableSpec[]): TableSpec[] {
  const done = new Set<string>()
  const order: TableSpec[] = []
  let guard = 0
  while (order.length < specs.length) {
    if (guard++ > specs.length + 2) throw new Error('[deriveImport] 表依赖存在环,无法拓扑排序')
    for (const spec of specs) {
      if (done.has(spec.name)) continue
      const deps = (spec.exportRemap ?? [])
        .filter(rm => !rm.selfTree && rm.remapVia !== spec.name)
        .map(rm => rm.remapVia)
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

/**
 * 派生导入:把 ProjectExportData 写成一个新项目,返回新项目 id。
 * 与手写 importProjectJSON 行为一致(往返完整性由 R-export-fullcoverage 锁死)。
 */
export async function deriveImportProjectJSON(data: ProjectExportData): Promise<number> {
  if (!data.version || !data.project) throw new Error('无效的导出文件格式')
  const now = Date.now()
  const specs = PROJECT_TABLES.filter(s => s.exportable && s.name !== 'projects')
  const order = deriveImportOrder(specs)

  return await db.transaction('rw', transactionTablesFor('importProject'), async () => {
    const newProjectId = await db.projects.add({
      ...data.project,
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

    for (const spec of order) {
      const rawRows: any[] = (data as any)[spec.name] ?? []
      const rows = spec.tree ? topoSortTreeRows(rawRows) : rawRows
      const newIdMap = new Map<number, number>()
      const pendingRefRemap: Array<{ newId: number; stashed: Record<string, any> }> = []

      let exportIndex = -1
      for (const row of rows) {
        exportIndex++
        const obj: any = { ...row }
        const exportId = obj._exportId
        delete obj._exportId

        // 外键:_exportAs → 真实 db id
        let dropRow = false
        for (const rm of spec.exportRemap ?? []) {
          const exportVal = obj[rm.exportAs]
          delete obj[rm.exportAs]
          let mappedId: number | null = null
          if (exportVal != null) {
            const m = rm.selfTree ? newIdMap : newIdMaps.get(rm.remapVia)
            const got = m?.get(exportVal)
            if (got == null) {
              if (rm.onUnmapped === 'drop') { dropRow = true; break }
              if (rm.onUnmapped === 'require') {
                throw new Error(`[deriveImport] 缺失必填外键映射:${spec.name}.${rm.field}=${exportVal}`)
              }
            }
            mappedId = got ?? null
          }
          obj[rm.field] = mappedId
        }
        if (dropRow) continue

        if (spec.owner === 'project') obj.projectId = newProjectId
        if (spec.name === 'characters') {
          Object.assign(obj, normalizeCharacterAxes(obj))
        }

        // JSON 引用字段(portals)先剥离,待全表映射建好后两阶段回填
        let stashed: Record<string, any> | null = null
        if ((spec.exportRefRemap ?? []).length > 0) {
          stashed = {}
          for (const rr of spec.exportRefRemap!) { stashed[rr.field] = obj[rr.field]; delete obj[rr.field] }
        }

        const newId = await (db as any)[spec.name].add(obj) as number
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
            if (remapped) await (db as any)[spec.name].update(p.newId, { [rr.field]: remapped, updatedAt: now })
          }
        }
      }

      newIdMaps.set(spec.name, newIdMap)
    }

    return newProjectId
  })
}
