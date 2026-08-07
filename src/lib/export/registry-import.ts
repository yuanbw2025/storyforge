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
import { remapWorldPortalTargets } from '../utils/world-portals'
import { transactionTablesFor } from '../registry/lifecycle'
import { importLegacyArraysToCodex } from '../migrations/legacy-to-codex-upgrade'
import { migrateStateCardsToTemporalFactCandidates } from '../migrations/state-cards-to-temporal-facts'
import type { TableSpec } from '../registry/types'
import type { ProjectExportData } from './json-export'
import { normalizeCharacterAxes } from '../character/character-axes'
import {
  parseCharacterDrivenPlanArcs,
  stringifyCharacterDrivenPlanArcs,
} from '../types/character-driven-plan'
import { ensureWorkspaceOwnership } from '../world-engine/ownership'
import { rebindPortableAgentRunContractV1 } from '../agent/run/contract-portability'
import { finalizeImportedAgentRunLedgersV1 } from '../agent/run/ledger-portability'

const STRICT_EXPORT_VERSION = 4

function strictOwnerShadow(spec: TableSpec, row: Record<string, any>): {
  kind: 'world' | 'work'
  exportId: number
  field: string
} | null {
  if (spec.name === 'worlds' || spec.name === 'works') return null
  const locator = spec.domainOwner?.locator
  if (!locator || locator.kind === 'workspace' || locator.kind === 'compat-project') return null
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
  return null
}

function validateStrictOwnership(data: ProjectExportData): void {
  if (data.version !== STRICT_EXPORT_VERSION) return
  const value = data as unknown as Record<string, any>
  if (!Array.isArray(value.worlds) || !value.worlds.length || !Array.isArray(value.works) || !value.works.length) {
    throw new Error('[deriveImport] v4 备份缺少 World/Work 根')
  }
  const worldIds = new Set(value.worlds.map((row: any) => row?._exportId))
  const workIds = new Set(value.works.map((row: any) => row?._exportId))
  if (worldIds.size !== value.worlds.length || workIds.size !== value.works.length
    || [...worldIds].some(id => !Number.isInteger(id)) || [...workIds].some(id => !Number.isInteger(id))) {
    throw new Error('[deriveImport] v4 World/Work 便携 ID 重复或无效')
  }
  const ownership = value.ownership
  if (!ownership || !worldIds.has(ownership.worldExportId) || !workIds.has(ownership.workExportId)) {
    throw new Error('[deriveImport] v4 active owner 指针缺失或越界')
  }
  for (const spec of PROJECT_TABLES) {
    if (!spec.exportable || spec.name === 'projects' || spec.name === 'worlds' || spec.name === 'works') continue
    const rows = value[spec.name]
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new Error(`[deriveImport] ${spec.name} 包含非法记录`)
      if ('worldId' in row || 'workId' in row) throw new Error(`[deriveImport] v4 ${spec.name} 泄露本地主键 owner`)
      const shadow = strictOwnerShadow(spec, row)
      if (!shadow) continue
      const validIds = shadow.kind === 'world' ? worldIds : workIds
      if (!validIds.has(shadow.exportId)) throw new Error(`[deriveImport] v4 owner 越界:${spec.name}`)
    }
  }
}

function restoreStrictOwner(
  dataVersion: number,
  spec: TableSpec,
  obj: Record<string, any>,
  newIdMaps: Map<string, Map<number, number>>,
): void {
  if (dataVersion !== STRICT_EXPORT_VERSION) return
  const shadow = strictOwnerShadow(spec, obj)
  delete obj._worldOwnerExportId
  delete obj._workOwnerExportId
  if (!shadow) return
  const ownerMap = newIdMaps.get(shadow.kind === 'world' ? 'worlds' : 'works')
  const mapped = ownerMap?.get(shadow.exportId)
  if (mapped == null) throw new Error(`[deriveImport] v4 owner 无法重映射:${spec.name}`)
  if (obj[shadow.field] != null && obj[shadow.field] !== mapped) {
    throw new Error(`[deriveImport] v4 owner 与外键冲突:${spec.name}.${shadow.field}`)
  }
  obj[shadow.field] = mapped
  const locator = spec.domainOwner?.locator
  if (locator?.kind === 'exclusive-fields') {
    obj[shadow.kind === 'world' ? locator.workField : locator.worldField] = null
  }
}

/** 表级拓扑排序:被 remapVia 指向的表必须先导入(selfTree 不算表间依赖) */
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
        .filter(rm => !rm.selfTree && rm.remapVia !== spec.name)
        .map(rm => rm.remapVia)
      const refDeps = (spec.exportRefRemap ?? [])
        .filter(ref => ref.remapVia !== spec.name)
        .map(ref => ref.remapVia)
      const ownerDeps = spec.domainOwner?.locator?.kind === 'field'
        ? [spec.domainOwner.locator.owner === 'world' ? 'worlds' : spec.domainOwner.locator.owner === 'work' ? 'works' : null]
        : spec.domainOwner?.locator?.kind === 'exclusive-fields' ? ['worlds', 'works'] : []
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
        if (spec.portableData?.kind === 'agent-run-root') {
          const rebound = await Dexie.waitFor(rebindPortableAgentRunContractV1({
            contractJson: obj[spec.portableData.contractField],
            contractHash: obj[spec.portableData.contractHashField],
            projectId: newProjectId,
            idMaps: newIdMaps,
          }))
          obj[spec.portableData.contractField] = rebound.contractJson
          obj[spec.portableData.contractHashField] = rebound.contractHash
        }
        if (spec.name === 'characters') {
          Object.assign(obj, normalizeCharacterAxes(obj))
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
            if (remapped) await (db as any)[spec.name].update(p.newId, { [rr.field]: remapped, updatedAt: now })
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
                : await remapCharacterPlanArcIndexes(
                  (db as any)[spec.name],
                  pending.newId,
                  rr.field,
                  portableRefs,
                  refMap,
                )
            if (patch !== undefined) {
              await (db as any)[spec.name].update(pending.newId, { [rr.field]: patch, updatedAt: now })
            }
          }
        }
      }

      newIdMaps.set(spec.name, newIdMap)
    }

    for (const deferred of deferredForeignKeys) {
      const mapped = newIdMaps.get(deferred.target)?.get(deferred.exportId)
      if (mapped != null) await deferred.table.update(deferred.id, { [deferred.field]: mapped, updatedAt: now })
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

    return newProjectId
  })
  // v1-v3 had no portable owner shadows. Upgrade only after the import
  // transaction commits; the ownership service performs its own preflight and
  // atomic stamping without guessing external IDs.
  if (data.version < STRICT_EXPORT_VERSION) await ensureWorkspaceOwnership(importedProjectId)
  return importedProjectId
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

async function remapCharacterPlanArcIndexes(
  table: any,
  rowId: number,
  field: string,
  portableRefs: unknown,
  idMap: Map<number, number>,
): Promise<string | undefined> {
  if (!Array.isArray(portableRefs)) return undefined
  const row = await table.get(rowId)
  const arcs = parseCharacterDrivenPlanArcs(row?.[field])
  return stringifyCharacterDrivenPlanArcs(arcs.map((arc, index) => {
    const exportIndex = portableRefs[index]
    return {
      ...arc,
      characterId: typeof exportIndex === 'number' ? (idMap.get(exportIndex) ?? null) : null,
    }
  }))
}
