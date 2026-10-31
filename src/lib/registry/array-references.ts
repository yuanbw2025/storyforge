import { db } from '../db/schema'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from './project-tables'
import type { ArrayRef, DomainOwnerKind, TableSpec } from './types'

/** Array declarations belong to the holder; their items point to the source. */
export function registeredArrayReferencesTo(sourceTableName: string): { holder: TableSpec; ref: ArrayRef }[] {
  return PROJECT_TABLES.flatMap(holder => (holder.refs ?? []).flatMap(ref =>
    ref.kind === 'array' && ref.itemTarget === sourceTableName && ref.onDelete !== 'keep'
      ? [{ holder, ref }] : []))
}

/** A reference update reads the same registered parent chain as its holder. */
export function includeReferenceOwnerTables(names: Set<string>): void {
  names.add('projects'); names.add('worlds'); names.add('works')
  const pending = [...names]
  while (pending.length) {
    const name = pending.pop()!
    const locator = REGISTRY_BY_NAME.get(name)?.domainOwner?.locator
    if (locator?.kind !== 'parent' || names.has(locator.table)) continue
    names.add(locator.table)
    pending.push(locator.table)
  }
}

type ReferenceOwner = { kind: DomainOwnerKind; id: number }

async function referenceOwner(spec: TableSpec, row: Record<string, unknown>, visited = new Set<string>()): Promise<ReferenceOwner | null> {
  const locator = spec.domainOwner?.locator
  if (!locator) return null
  if (locator.kind === 'parent') {
    const key = `${spec.name}:${String(row.id)}`
    if (visited.has(key)) return null
    visited.add(key)
    const parentSpec = REGISTRY_BY_NAME.get(locator.table)
    const parentId = row[locator.field]
    if (!parentSpec || typeof parentId !== 'number') return null
    const parent = await parentSpec.table.get(parentId) as Record<string, unknown> | undefined
    return parent && parent.projectId === row.projectId ? referenceOwner(parentSpec, parent, visited) : null
  }
  if (locator.kind === 'workspace') return typeof row.projectId === 'number' ? { kind: 'workspace', id: row.projectId } : null
  let kind: DomainOwnerKind, id: unknown
  if (locator.kind === 'field') { kind = locator.owner; id = row[locator.field] }
  else if (locator.kind === 'exclusive-fields') {
    if ((row[locator.worldField] != null) === (row[locator.workField] != null)) return null
    kind = row[locator.worldField] != null ? 'world' : 'work'
    id = row[kind === 'world' ? locator.worldField : locator.workField]
  } else {
    if ((row[locator.workField] != null) === (row[locator.instanceField] != null)) return null
    kind = row[locator.workField] != null ? 'work' : 'instance'
    id = row[kind === 'work' ? locator.workField : locator.instanceField]
  }
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? { kind, id } : null
}

async function sameReferenceOwner(source: ReferenceOwner, holder: ReferenceOwner | null, projectId: number): Promise<boolean> {
  if (!holder) return false
  if (source.kind === 'workspace') return source.id === projectId
  if (source.kind === holder.kind) return source.id === holder.id
  if (source.kind === 'world' && holder.kind === 'work') {
    const work = await db.works.get(holder.id)
    return work?.projectId === projectId && work.worldId === source.id
  }
  return false
}

/** Inside the caller's native rw transaction. Never change other owners or
 * normalize retained members, author text or an unrelated JSON string. */
export async function clearRegisteredArrayReferences(sourceTableName: string, sourceId: number): Promise<void> {
  const incoming = registeredArrayReferencesTo(sourceTableName)
  if (!incoming.length) return
  const sourceSpec = REGISTRY_BY_NAME.get(sourceTableName)!
  const source = await sourceSpec.table.get(sourceId) as Record<string, unknown> | undefined
  if (!source || typeof source.projectId !== 'number') return
  const sourceOwner = await referenceOwner(sourceSpec, source)
  // Parent roots may already be removed during a whole-owner deletion. Its
  // remaining children are deleted by that lifecycle, not assigned a new owner.
  if (!sourceOwner) return
  for (const holder of new Set(incoming.map(item => item.holder))) {
    const refs = incoming.filter(item => item.holder === holder).map(item => item.ref)
    const rows = holder.table.schema.idxByName.projectId
      ? holder.table.where('projectId').equals(source.projectId)
      : holder.table.filter(row => row.projectId === source.projectId)
    for (const key of await rows.primaryKeys()) {
      const row = await holder.table.get(key) as Record<string, unknown> | undefined
      if (!row || !await sameReferenceOwner(sourceOwner, await referenceOwner(holder, row), source.projectId)) continue
      const patch: Record<string, unknown> = {}
      for (const ref of refs) {
        const current = row[ref.field]
        if (current == null) continue
        let values: unknown = current
        if (typeof current === 'string') {
          try { values = JSON.parse(current) }
          catch { throw new Error(`引用清理遇到损坏的 ${holder.name}.${ref.field}；删除已取消，原数据保留。`) }
        }
        if (!Array.isArray(values)) throw new Error(`引用清理遇到无效的 ${holder.name}.${ref.field}；删除已取消，原数据保留。`)
        if (!values.includes(sourceId)) continue
        const next = ref.onDelete === 'setNullItem' ? values.map(value => value === sourceId ? null : value)
          : values.filter(value => value !== sourceId)
        patch[ref.field] = typeof current === 'string' ? JSON.stringify(next) : next
      }
      if (Object.keys(patch).length) await holder.table.update(key, { ...patch,
        updatedAt: Math.max(Date.now(), typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) ? row.updatedAt + 1 : 0),
      })
    }
  }
}
