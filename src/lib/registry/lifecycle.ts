/**
 * 生命周期派生 API(Phase 1.1a)
 *
 * 全部从 PROJECT_TABLES 派生,不再手写表清单。
 *   - cascadeDeleteProject(projectId)
 *   - cascadeDeleteGroup(projectId, wgId)
 *   - stampPrimaryWorld(projectId, primaryId)
 *   - transactionTablesFor(operation)
 *
 * 设计依据:docs/MASTER-BLUEPRINT.md §5.1。
 *
 * ⚠️ Phase 1.1a 阶段:本文件【纯新增】,现有 stores 暂未切换调用。
 *    1.1b 才把 deleteProject/deleteGroup/migrate 改成调这里。
 */
import type { Table } from 'dexie'
import { db } from '../db/schema'
import { removeCodexEntryReferences } from '../codex/references'
import { clearCultivationSystemReferences } from '../cultivation/lifecycle'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from './project-tables'
import type { TableSpec } from './types'

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

/**
 * 某个生命周期操作需要的 Dexie 事务表清单。
 * 防止"事务声明漏表"(Phase 0 反复踩的坑)。
 */
export function transactionTablesFor(
  op: 'deleteProject' | 'deleteGroup' | 'migrate' | 'importProject' | 'deleteChapters',
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
    set.add(db.codexCategories)
    set.add(db.outlineNodes)
    set.add(db.worldGroups)
    set.add(db.worldGroupLinks)
    return [...set]
  }
  // migrate:所有 worldScoped 表
  return worldScopedTables().map(s => s.table)
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
  return [...names].map(name => REGISTRY_BY_NAME.get(name)!.table)
}

// ─────────────────────────────────────────────────────────────
// cascadeDeleteProject - 删项目级联清理(派生自注册表)
// ─────────────────────────────────────────────────────────────

export async function cascadeDeleteProject(projectId: number): Promise<void> {
  // ── Step 1:事务前预收集间接归属/blob 的父键 ──
  // (父表会在事务中被删,所以必须先把关联键拿到手)
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

  // ── Step 2:事务内删除 ──
  await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
    for (const spec of projectScopedTables()) {
      if (spec.name === 'projects') continue // 根表最后删

      if (spec.owner === 'project' || spec.owner === 'transient') {
        await spec.table.where('projectId').equals(projectId).delete()
      } else if (spec.owner === 'direct-child' || spec.owner === 'indirect') {
        const parentKeys = indirectKeys.get(spec.name) ?? []
        const linkField = resolveLinkField(spec)
        if (parentKeys.length && linkField) {
          await (spec.table as any).where(linkField).anyOf(parentKeys).delete()
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
      // 老式直接挂 importSessionId 的
      const legacy = owners
        .map(row => row.importSessionId)
        .filter((v: unknown): v is number => v != null)
      if (legacy.length) await db.importFiles.bulkDelete(legacy)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// cascadeDeleteGroup - 删世界组级联清理(派生自注册表)
// ─────────────────────────────────────────────────────────────

export async function cascadeDeleteGroup(projectId: number, wgId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('deleteGroup'), async () => {
    // 分类 schema 已改为项目级共享；旧备份可能仍带 worldGroupId。删除世界时只清
    // 这个历史归属值，绝不删除分类及其它世界复用的字段结构。
    const legacyCategories = await db.codexCategories.where('projectId').equals(projectId).toArray()
    for (const category of legacyCategories) {
      if (category.id != null && category.worldGroupId === wgId) {
        await db.codexCategories.update(category.id, { worldGroupId: null, updatedAt: Date.now() })
      }
    }
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
        if (row[wgField] === wgId) await spec.table.delete(row.id)
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
    await db.worldGroups.delete(wgId)
  })
}

// ─────────────────────────────────────────────────────────────
// stampPrimaryWorld - 开启多世界时盖章(派生自注册表)
// ─────────────────────────────────────────────────────────────

export async function stampPrimaryWorld(projectId: number, primaryId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('migrate'), async () => {
    for (const spec of worldScopedTables()) {
      const wgField = spec.worldGroupField ?? 'worldGroupId'
      const rows = await spec.table.where('projectId').equals(projectId).toArray()
      for (const row of rows as any[]) {
        if (row[wgField] == null) {
          await spec.table.update(row.id, { [wgField]: primaryId })
        }
      }
    }
  })
}
