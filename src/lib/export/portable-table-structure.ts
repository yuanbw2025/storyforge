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

type ReferenceSpec = Pick<TableSpec, 'name' | 'exportIdField' | 'exportRemap' | 'domainOwner'>
type PortableOwnerShadow = { kind: 'world' | 'work' | 'instance'; exportId: number; field: string }

/** Interpret the existing portable owner shadows once at both boundaries. A
 * malformed non-null opposite value is never the same thing as an empty slot. */
export function readPortableOwnerShadowV1(spec: ReferenceSpec, row: Record<string, unknown>): PortableOwnerShadow | null {
  if (spec.name === 'worlds' || spec.name === 'works') return null
  const locator = spec.domainOwner?.locator
  if (!locator || locator.kind === 'workspace' || locator.kind === 'parent') return null
  const world = row._worldOwnerExportId
  const work = row._workOwnerExportId
  const instance = row._instanceOwnerExportId
  const invalid = () => { throw new Error(`${spec.name} owner 缺失或越界：便携归属无效或存在多个 owner。`) }
  if (locator.kind === 'field') {
    if (locator.owner === 'world') return isPortableId(world) && work == null && instance == null
      ? { kind: 'world', exportId: world, field: locator.field } : invalid()
    if (locator.owner === 'work') return isPortableId(work) && world == null && instance == null
      ? { kind: 'work', exportId: work, field: locator.field } : invalid()
    // The runtime instance table is itself the root; it has no owner shadow.
    return null
  }
  if (locator.kind === 'exclusive-fields') {
    if (isPortableId(world) && work == null && instance == null) return { kind: 'world', exportId: world, field: locator.worldField }
    if (isPortableId(work) && world == null && instance == null) return { kind: 'work', exportId: work, field: locator.workField }
  } else {
    if (isPortableId(work) && world == null && instance == null) return { kind: 'work', exportId: work, field: locator.workField }
    if (isPortableId(instance) && work == null && world == null) return { kind: 'instance', exportId: instance, field: locator.instanceField }
  }
  return invalid()
}

/** Pure structure/ownership preflight shared by public inspection and direct
 * derive import. Existing nullable remaps still validate only when supplied. */
export function inspectPortableRequiredReferencesV1(
  specs: readonly ReferenceSpec[], backup: Record<string, unknown>,
): string[] {
  const errors: string[] = []
  const specByName = new Map(specs.map(spec => [spec.name, spec]))
  const idMaps = new Map<string, Map<number, Record<string, unknown>>>()
  function indexFor(name: string) {
    const cached = idMaps.get(name)
    if (cached) return cached
    const index = new Map<number, Record<string, unknown>>()
    const spec = specByName.get(name)
    const rows = backup[name]
    if (spec && Array.isArray(rows)) rows.forEach((row, position) => {
      if (!isRecord(row)) return
      const id = spec.exportIdField ? row._exportId : position
      if (isPortableId(id)) index.set(id, row)
    })
    idMaps.set(name, index)
    return index
  }
  const worldOfWork = (work: Record<string, unknown> | undefined) => {
    const worldRef = specByName.get('works')?.exportRemap?.find(ref => ref.field === 'worldId')
    return worldRef && work?.[worldRef.exportAs]
  }

  for (const spec of specs) {
    const rows = spec.name === 'projects' ? [backup.project] : backup[spec.name]
    if (!Array.isArray(rows)) continue
    for (const [position, row] of rows.entries()) {
      if (!isRecord(row)) continue
      const path = spec.name === 'projects' ? 'project' : `${spec.name}[${position}]`
      for (const ref of spec.exportRemap ?? []) {
        if (!ref.requiredOnImport && ref.onUnmapped !== 'require') continue
        const portable = row[ref.exportAs]
        const label = `${path}.${ref.exportAs}`
        if (portable == null && !ref.requiredOnImport) continue
        if (!isPortableId(portable)) {
          errors.push(`${label} 必须是非空的非负安全整数。`)
          continue
        }
        const target = indexFor(ref.remapVia).get(portable)
        if (!target) {
          errors.push(`${label}=${portable} 没有对应的 ${ref.remapVia} 记录。`)
          continue
        }
        if (ref.sameWorkOnImport && (!isPortableId(row._workOwnerExportId) || row._workOwnerExportId !== target._workOwnerExportId))
          errors.push(`${label} 只允许指向同一 Work 的记录。`)
      }

      let shadow: PortableOwnerShadow | null
      try { shadow = readPortableOwnerShadowV1(spec, row) }
      catch (error) {
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (!shadow) continue
      const targetTable = shadow.kind === 'world' ? 'worlds' : shadow.kind === 'work' ? 'works' : 'productRuntimeSessions'
      if (!indexFor(targetTable).has(shadow.exportId))
        errors.push(`${path} owner 越界：没有对应的 ${targetTable} 根。`)
      const locator = spec.domainOwner?.locator
      const same = spec.exportRemap?.find(ref => ref.field === shadow.field)
      if (same && row[same.exportAs] != null && row[same.exportAs] !== shadow.exportId)
        errors.push(`${path}.${same.exportAs} 与便携 owner 不一致。`)
      if (locator?.kind === 'exclusive-fields' || locator?.kind === 'exclusive-work-instance') {
        const oppositeField = locator.kind === 'exclusive-fields'
          ? shadow.kind === 'world' ? locator.workField : locator.worldField
          : shadow.kind === 'work' ? locator.instanceField : locator.workField
        const opposite = spec.exportRemap?.find(ref => ref.field === oppositeField)
        if (opposite && row[opposite.exportAs] != null) errors.push(`${path}.${opposite.exportAs} 与互斥 owner 冲突。`)
      }
    }
  }

  const ownership = backup.ownership
  if (isRecord(ownership) && ownership.contractVersion === 1) {
    const world = ownership.worldExportId
    const work = ownership.workExportId
    if (!isPortableId(world) || !indexFor('worlds').has(world) ||
      !isPortableId(work) || worldOfWork(indexFor('works').get(work)) !== world)
      errors.push('ownership 的 active Work 不属于指定 World，或引用了不存在的根。')
    const project = backup.project
    if (isRecord(project)) {
      const refs = specByName.get('projects')?.exportRemap
      const activeWorld = refs?.find(ref => ref.field === 'activeWorldId')
      const activeWork = refs?.find(ref => ref.field === 'activeWorkId')
      if (activeWorld && project[activeWorld.exportAs] !== world) errors.push(`project.${activeWorld.exportAs} 与 ownership 不一致。`)
      if (activeWork && project[activeWork.exportAs] !== work) errors.push(`project.${activeWork.exportAs} 与 ownership 不一致。`)
    }
  }
  return errors
}
