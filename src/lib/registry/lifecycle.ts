/**
 * 当前表生命周期派生 API。所有事务表集合从 PROJECT_TABLES 派生，
 * 禁止在 Store 或 service 中维护第二份手写清单。
 */
import type { Collection, Table } from 'dexie'
import { db } from '../db/schema'
import { removeCodexEntryReferences } from '../codex/references'
import { clearCultivationSystemReferences } from '../cultivation/lifecycle'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from './project-tables'
import { markAndSweepAgentRunArtifactsV1 } from '../memory/artifact-retention-store'
import type { TableSpec } from './types'
import { remapNarrativeDomainReferencesV1 } from '../narrative-domain/lifecycle'
import { readOwnedRows } from '../workspace/scope'
import { includeReferenceOwnerTables, registeredArrayReferencesTo } from './array-references'

// ─────────────────────────────────────────────────────────────
// 派生选择器
// ─────────────────────────────────────────────────────────────

/** 参与删项目级联的表(project / direct-child / indirect / transient / blob,不含 global) */
export function projectScopedTables(): TableSpec[] {
  return PROJECT_TABLES.filter(s => s.owner !== 'global')
}

/** 带 worldGroupId 的表(多世界隔离 / 盖章 / 删世界级联) */
export function worldScopedTables(): TableSpec[] {
  return PROJECT_TABLES.filter(s => s.worldScoped)
}

/** 可导出表 */
export function exportableTables(): TableSpec[] {
  return PROJECT_TABLES.filter(s => s.exportable)
}

/** Runtime side tables are selected by their declared owner, including newly registered extensions. */
export function runtimeInstanceTablesV1(): Table[] {
  return PROJECT_TABLES.filter(spec => spec.domainOwner?.allowed.includes('instance')).map(spec => spec.table)
}

/**
 * 某个生命周期操作需要的 Dexie 事务表清单。
 * 防止事务声明漏表。
 */
export function transactionTablesFor(
  op: 'deleteProject' | 'deleteGroup' | 'assignPrimaryWorld' | 'importProject' | 'deleteChapters',
): Table[] {
  if (op === 'deleteProject' || op === 'importProject' || op === 'deleteChapters') {
    // 删项目/导入项目/删章节:所有非 global 表。导入与局部删除事务保持宽表声明,
    // 避免完整性断言或新增 project-scoped 表漏进事务。
    return projectScopedTables().map(s => s.table)
  }
  if (op === 'deleteGroup') {
    // 删世界组:所有 worldScoped 表 + 角色(homeWorldGroupId setNull)+ 大纲(worldGroupId setNull)+ 世界组本身
    const set = new Set<Table>(worldScopedTables().map(s => s.table))
    set.add(db.characters)
    set.add(db.outlineNodes)
    set.add(db.worldGroups)
    set.add(db.worldGroupLinks)
    for (const spec of PROJECT_TABLES) if (spec.worldSemantic?.projector) set.add(spec.table)
    return [...set]
  }
  // 归属时还校验 World/Work 根、父记录，并与工作区开关原子提交。
  // 从注册表派生完整作用域，不能只声明待更新的叶表。
  return projectScopedTables().map(s => s.table)
}

/**
 * 根记录及其在 PROJECT_TABLES.refs 中声明的直接引用方。
 * 供领域级生命周期事务使用；新增引用表时只改注册表，事务边界会自动扩展。
 */
export function transactionTablesForReferences(sourceTableName: string): Table[] {
  const source = REGISTRY_BY_NAME.get(sourceTableName)
  if (!source) throw new Error(`未知 PROJECT_TABLES 表: ${sourceTableName}`)
  const names = new Set([sourceTableName])
  for (const ref of source.refs ?? []) {
    if (ref.kind !== 'simple' && ref.kind !== 'json') continue
    const targetName = ref.target.match(/^([^[]+)\[/)?.[1]
    if (targetName) names.add(targetName)
  }
  for (const spec of PROJECT_TABLES) if (spec.refs?.some(ref =>
    ref.kind === 'narrative-source-refs-v1' && ref.targetTables.includes(sourceTableName))) names.add(spec.name)
  const arrays = registeredArrayReferencesTo(sourceTableName)
  for (const { holder } of arrays) names.add(holder.name)
  if (arrays.length) includeReferenceOwnerTables(names)
  return [...names].map(name => {
    const spec = REGISTRY_BY_NAME.get(name)
    if (!spec) throw new Error(`PROJECT_TABLES 引用目标未登记: ${sourceTableName} → ${name}`)
    return spec.table
  })
}

/** Recursive transaction closure for a lifecycle that follows registered
 * cascade refs beyond one level (for example Instance -> Run -> Event). */
export function transactionTablesForReferenceCascade(sourceTableName: string): Table[] {
  const source = REGISTRY_BY_NAME.get(sourceTableName)
  if (!source) throw new Error(`未知 PROJECT_TABLES 表: ${sourceTableName}`)
  const names = new Set([sourceTableName])
  const pending = [source]
  while (pending.length > 0) {
    const current = pending.shift()!
    for (const ref of current.refs ?? []) {
      if (ref.kind !== 'simple' && ref.kind !== 'json') continue
      const targetName = ref.target.match(/^([^[]+)\[/)?.[1]
      if (!targetName || names.has(targetName)) continue
      const target = REGISTRY_BY_NAME.get(targetName)
      if (!target) throw new Error(`PROJECT_TABLES 引用目标未登记: ${current.name} → ${targetName}`)
      names.add(targetName)
      pending.push(target)
    }
  }
  const sources = [...names]
  for (const spec of PROJECT_TABLES) if (spec.refs?.some(ref =>
    ref.kind === 'narrative-source-refs-v1' && sources.some(name => ref.targetTables.includes(name)))) names.add(spec.name)
  const arrays = sources.flatMap(name => registeredArrayReferencesTo(name))
  for (const { holder } of arrays) names.add(holder.name)
  if (arrays.length) includeReferenceOwnerTables(names)
  return [...names].map(name => REGISTRY_BY_NAME.get(name)!.table)
}

// ─────────────────────────────────────────────────────────────
// cascadeDeleteProject - 删项目级联清理(派生自注册表)
// ─────────────────────────────────────────────────────────────

/** Called inside the existing lifecycle write transaction. Batch exact,
 * consecutive integer keys so IndexedDB can remove each index range once.
 * Count the complete primary-key range before deleting: an imported fractional
 * or foreign key between two integers must never be swept into this scope. */
async function deleteScopedRows(table: Table, rows: Collection): Promise<void> {
  const keys = await rows.primaryKeys()
  if (!keys.length) return
  if (keys.some(key => typeof key !== 'number' || !Number.isSafeInteger(key))) {
    await rows.delete()
    return
  }
  const sorted = (keys as number[]).sort((left, right) => left - right)
  for (let start = 0; start < sorted.length;) {
    let end = start + 1
    while (end < sorted.length && sorted[end] === sorted[end - 1] + 1) end += 1
    if (end === start + 1) {
      await table.delete(sorted[start])
    } else {
      const range = table.where(':id').between(sorted[start], sorted[end - 1], true, true)
      if (await range.count() === end - start) await range.delete()
      else await table.where(':id').anyOf(sorted.slice(start, end)).delete()
    }
    start = end
  }
}

export async function cascadeDeleteProject(projectId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
    // 同一写事务内先固定全部父键，再删任何父行；并发新导入不得漏入快照。
    // 写入端也在相同父表锁内复验根，删除提交后的旧任务不能再建子项。
    const indirectKeys = new Map<string, number[]>()
    for (const spec of projectScopedTables()) {
      if ((spec.owner === 'direct-child' || spec.owner === 'indirect') && spec.projectResolver) {
        indirectKeys.set(spec.name, await spec.projectResolver(projectId))
      }
    }
    // blob owner 父行(用于计算 blob key)
    const blobOwnerRows = new Map<string, any[]>()
    for (const spec of PROJECT_TABLES) {
      if (spec.refs?.some(r => r.kind === 'blob-owner')) {
        blobOwnerRows.set(spec.name, await (spec.table as any).where('projectId').equals(projectId).toArray())
      }
    }
    const importSessionIds = (await db.importSessions
      .where('projectId').equals(projectId).primaryKeys()) as number[]

    for (const spec of projectScopedTables()) {
      if (spec.name === 'projects') continue // 根表最后删

      if (spec.owner === 'project' || spec.owner === 'transient') {
        await deleteScopedRows(spec.table, spec.table.where('projectId').equals(projectId))
      } else if (spec.owner === 'direct-child' || spec.owner === 'indirect') {
        const parentKeys = indirectKeys.get(spec.name) ?? []
        const linkField = resolveLinkField(spec)
        if (parentKeys.length && linkField) {
          await deleteScopedRows(spec.table, spec.table.where(linkField).anyOf(parentKeys))
        }
      } else if (spec.owner === 'blob') {
        await deleteBlobsInTransaction(importSessionIds, blobOwnerRows)
      }
    }
    await db.projects.delete(projectId) // 根表最后删
  })
}

/** 取间接归属表的关联字段名(从 indirect ref 里读;direct-child 用约定) */
function resolveLinkField(spec: TableSpec): string | null {
  for (const ref of spec.refs ?? []) {
    if (ref.kind === 'indirect') return ref.via.field
  }
  if (spec.name === 'referenceChunkAnalysis') return 'referenceId'
  return null
}

/** 事务内清理 blob(用预收集的数据,不重新查已被删的父表) */
async function deleteBlobsInTransaction(
  importSessionIds: number[],
  blobOwnerRows: Map<string, any[]>,
): Promise<void> {
  // (1) 普通导入 blob:importFiles 主键 = importSessions.id
  if (importSessionIds.length) await db.importFiles.bulkDelete(importSessionIds)

  // (2) blob-owner ref:用 keyResolver 计算 importFiles key(通用机制,当前无表使用)
  for (const spec of PROJECT_TABLES) {
    for (const ref of spec.refs ?? []) {
      if (ref.kind !== 'blob-owner') continue
      const owners = blobOwnerRows.get(spec.name) ?? []
      const keys = owners.map(row => ref.keyResolver(row)) as number[]
      if (keys.length) await db.importFiles.bulkDelete(keys)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// cascadeDeleteGroup - 删世界组级联清理(派生自注册表)
// ─────────────────────────────────────────────────────────────

export async function cascadeDeleteGroup(projectId: number, wgId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('deleteGroup'), async () => {
    for (const spec of worldScopedTables()) {
      const wgField = spec.worldGroupField ?? 'worldGroupId'

      // outlineNodes 特殊:不删,只 setNull(卷脱离该世界)
      if (spec.name === 'outlineNodes') {
        const all = await spec.table.where('projectId').equals(projectId).toArray()
        for (const row of all as any[]) {
          if (row[wgField] === wgId) await spec.table.update(row.id, { [wgField]: null })
        }
        continue
      }
      if (spec.name === 'codexEntries') {
        const rows = await db.codexEntries.where('projectId').equals(projectId).toArray()
        const deletedIds = new Set(rows
          .filter(row => row.worldGroupId === wgId)
          .map(row => row.id)
          .filter((id): id is number => id != null))
        await removeCodexEntryReferences(projectId, deletedIds)
        if (deletedIds.size) await db.codexEntries.bulkDelete([...deletedIds])
        continue
      }
      if (spec.name === 'cultivationSystems') {
        const rows = await db.cultivationSystems.where('projectId').equals(projectId).toArray()
        const deletedIds = new Set(rows
          .filter(row => row.worldGroupId === wgId)
          .map(row => row.id)
          .filter((id): id is number => id != null))
        await clearCultivationSystemReferences(projectId, deletedIds)
        if (deletedIds.size) await db.cultivationSystems.bulkDelete([...deletedIds])
        continue
      }

      const rows = await spec.table.where('projectId').equals(projectId).toArray()
      for (const row of rows as any[]) {
        if (row[wgField] === wgId) {
          await remapNarrativeDomainReferencesV1({ table: spec.name, fromId: row.id })
          await spec.table.delete(row.id)
        }
      }
    }

    // 角色 homeWorldGroupId setNull
    const chars = await db.characters.where('projectId').equals(projectId).toArray()
    for (const c of chars as any[]) {
      if (c.homeWorldGroupId === wgId) await db.characters.update(c.id, { homeWorldGroupId: null })
    }

    // 世界关系链接 + 世界组本身
    await db.worldGroupLinks.where('fromGroupId').equals(wgId).delete()
    await db.worldGroupLinks.where('toGroupId').equals(wgId).delete()
    await remapNarrativeDomainReferencesV1({ table: 'worldGroups', fromId: wgId })
    await db.worldGroups.delete(wgId)
  })
  await markAndSweepAgentRunArtifactsV1(projectId)
}

// ─────────────────────────────────────────────────────────────
// assignUnscopedRecordsToPrimaryWorld - 开启多世界时归属无主记录
// ─────────────────────────────────────────────────────────────

export async function assignUnscopedRecordsToPrimaryWorld(projectId: number, primaryId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('assignPrimaryWorld'), async () => {
    const primary = await db.worldGroups.get(primaryId)
    const primaryWorldId = primary?.worldId
    const world = typeof primaryWorldId === 'number' ? await db.worlds.get(primaryWorldId) : undefined
    if (!primary || typeof primaryWorldId !== 'number' || primary.projectId !== projectId || primary.type !== 'primary' || world?.projectId !== projectId) {
      throw new Error('主世界归属无效；未调整任何记录。')
    }
    const works = await db.works.where('projectId').equals(projectId).filter(work => work.worldId === primaryWorldId).toArray()
    for (const spec of worldScopedTables()) {
      const wgField = spec.worldGroupField ?? 'worldGroupId'
      const owned = new Map<number, Record<string, unknown>>()
      for (const work of works) {
        for (const row of await readOwnedRows<Record<string, unknown>>({ projectId, worldId: primaryWorldId, workId: work.id! }, spec.name)) {
          if (row[wgField] == null) owned.set(row.id as number, row)
        }
      }
      for (const id of owned.keys()) {
        await spec.table.update(id, { [wgField]: primaryId })
      }
    }
  })
}
