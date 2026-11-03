import type { TableSpec } from '../registry/types'

type StructureSpec = Pick<TableSpec, 'name' | 'exportIdField' | 'tree' | 'exportRemap'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPortableId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function inspectRows(spec: StructureSpec, input: readonly unknown[]) {
  const errors: string[] = []
  const ordered: Record<string, unknown>[] = []
  if (!spec.exportIdField && !spec.tree) return { errors, ordered }
  const rows = new Map<number, Record<string, unknown>>()
  for (const [index, row] of input.entries()) {
    const path = `${spec.name}[${index}]`
    if (!isRecord(row)) { errors.push(`${path} 必须是对象。`); continue }
    if (!isPortableId(row._exportId)) { errors.push(`${path}._exportId 必须是非负安全整数。`); continue }
    if (rows.has(row._exportId)) errors.push(`${path}._exportId=${row._exportId} 重复。`)
    rows.set(row._exportId, row)
  }
  if (errors.length || !spec.tree) return { errors, ordered }
  const parent = spec.exportRemap?.find(ref => ref.selfTree && ref.field === spec.tree!.parentField)
  if (!spec.exportIdField || !parent) throw new Error(`${spec.name} 的树形便携身份/父引用未登记。`)
  const roots: number[] = []
  const children = new Map<number, number[]>()
  for (const [id, row] of rows) {
    const parentId = row[parent.exportAs]
    if (parentId == null) { roots.push(id); continue }
    if (!isPortableId(parentId) || !rows.has(parentId)) {
      errors.push(`${spec.name}[_exportId=${id}].${parent.exportAs}=${String(parentId)} 父记录缺失或 ID 无效。`)
      continue
    }
    const siblings = children.get(parentId) ?? []
    siblings.push(id); children.set(parentId, siblings)
  }
  if (errors.length) return { errors, ordered }
  // Iterative O(n) traversal supports arbitrarily ordered long chains without
  // recursion or a fallback that silently drops rows or changes their parent.
  for (let index = 0; index < roots.length; index++) {
    const id = roots[index]
    ordered.push(rows.get(id)!)
    for (const child of children.get(id) ?? []) roots.push(child)
  }
  if (ordered.length !== rows.size) {
    const placed = new Set(roots)
    const blocked = [...rows.keys()].find(id => !placed.has(id))!
    errors.push(`${spec.name}[_exportId=${blocked}] 的父链形成循环。`)
  }
  return { errors, ordered }
}

/** Shared by the read-only preflight and the direct registry import boundary. */
export function inspectPortableTableStructure(spec: StructureSpec, rows: readonly unknown[]): string[] {
  return inspectRows(spec, rows).errors
}

export function orderPortableTreeRows<T extends Record<string, unknown>>(spec: StructureSpec, rows: T[]): T[] {
  if (!spec.tree) throw new Error(`${spec.name} 未登记为树表。`)
  const result = inspectRows(spec, rows)
  if (result.errors.length) throw new Error(`[deriveImport] ${result.errors.join('；')}`)
  return result.ordered as T[]
}
