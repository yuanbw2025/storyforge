import { db } from '../db/schema'
import { PROJECT_TABLES } from './project-tables'
import type { TableSpec } from './types'
import type { OwnershipScopeChange, WorkspaceScope } from '../types'
import { assertRecordInScope, getTableSpec, resolveScope } from '../workspace/scope'

type MovableOwner = 'world' | 'work'

interface ReferenceEdge {
  spec: TableSpec
  field: string
}

function parseRefTarget(target: string): { tableName: string; field: string } | null {
  const match = /^([A-Za-z0-9]+)\[([A-Za-z0-9]+)\]$/.exec(target)
  return match ? { tableName: match[1], field: match[2] } : null
}

function referenceEdges(target: TableSpec): ReferenceEdge[] {
  const edges: ReferenceEdge[] = []
  for (const spec of PROJECT_TABLES) {
    for (const remap of spec.exportRemap ?? []) {
      if (remap.remapVia === target.name) edges.push({ spec, field: remap.field })
    }
  }
  for (const ref of target.refs ?? []) {
    if (ref.kind !== 'simple') continue
    const parsed = parseRefTarget(ref.target)
    if (parsed) edges.push({ spec: getTableSpec(parsed.tableName), field: parsed.field })
  }
  const unique = new Map(edges.map(edge => [`${edge.spec.name}:${edge.field}`, edge]))
  return [...unique.values()]
}

async function rowLogicalScope(
  spec: TableSpec,
  row: Record<string, unknown>,
  visited = new Set<string>(),
): Promise<{ worldId?: number; workId?: number }> {
  const rowId = typeof row.id === 'number' ? row.id : undefined
  const visitKey = `${spec.name}:${rowId ?? 'unknown'}`
  if (visited.has(visitKey)) throw new Error(`[scope-change] ${visitKey} 的 parent owner 形成循环`)
  visited.add(visitKey)

  if (spec.name === 'works') {
    return {
      worldId: typeof row.worldId === 'number' ? row.worldId : undefined,
      workId: rowId,
    }
  }
  const locator = spec.domainOwner?.locator
  if (!locator || locator.kind === 'workspace') return {}
  if (locator.kind === 'field') {
    if (locator.owner === 'world') return { worldId: row[locator.field] as number | undefined }
    if (locator.owner === 'work') {
      const workId = row[locator.field] as number | undefined
      const work = workId == null ? undefined : await db.works.get(workId)
      return { worldId: work?.worldId, workId }
    }
    return {}
  }
  if (locator.kind === 'exclusive-fields') {
    const worldId = row[locator.worldField] as number | undefined
    const workId = row[locator.workField] as number | undefined
    const work = workId == null ? undefined : await db.works.get(workId)
    return { worldId: worldId ?? work?.worldId, workId }
  }
  if (locator.kind === 'exclusive-work-instance') {
    const workId = row[locator.workField] as number | undefined
    if (workId != null) {
      const work = await db.works.get(workId)
      return { worldId: work?.worldId, workId }
    }
    const instanceId = row[locator.instanceField] as number | undefined
    const instance = instanceId == null ? undefined : await db.productRuntimeSessions.get(instanceId)
    return {
      worldId: instance?.worldId ?? undefined,
      workId: instance?.workId ?? undefined,
    }
  }
  const parentId = row[locator.field]
  const parentSpec = getTableSpec(locator.table)
  const parent = parentId == null ? undefined : await parentSpec.table.get(parentId as number)
  if (!parent) throw new Error(`[scope-change] ${spec.name}.${locator.field} 的 owner parent 不存在`)
  return rowLogicalScope(parentSpec, parent as Record<string, unknown>, visited)
}

function edgeInheritsMovedOwner(edge: ReferenceEdge, targetName: string): boolean {
  const locator = edge.spec.domainOwner?.locator
  return locator?.kind === 'parent' && locator.table === targetName && locator.field === edge.field
}

/**
 * Atomically move one registry-declared dual-scope record between the current
 * Work and World. Inbound references are resolved from registry metadata and
 * fail closed when the move would hide their target from another scope.
 */
export async function changeRecordScope(input: {
  scope: WorkspaceScope
  tableName: string
  recordId: number
  targetOwner: MovableOwner
}): Promise<OwnershipScopeChange> {
  const scope = await resolveScope({ scope: input.scope })
  const spec = getTableSpec(input.tableName)
  const locator = spec.domainOwner?.locator
  if (!spec.domainOwner?.allowed.includes(input.targetOwner) || locator?.kind !== 'exclusive-fields') {
    throw new Error(`[scope-change] ${input.tableName} 未登记为可转换的 World/Work 双作用域表`)
  }
  const edges = referenceEdges(spec)
  const tables = [...new Set(PROJECT_TABLES.map(item => item.table))]
  return db.transaction('rw', tables, async () => {
    const row = await spec.table.get(input.recordId) as Record<string, unknown> | undefined
    if (!row || !await assertRecordInScope(scope, spec.name, row)) {
      throw new Error(`[scope-change] ${input.tableName} 记录不属于当前 scope`)
    }
    const hasWorld = row[locator.worldField] != null
    const hasWork = row[locator.workField] != null
    if (hasWorld === hasWork) throw new Error(`[scope-change] ${input.tableName} owner 互斥合同损坏`)
    const previousOwner: MovableOwner = hasWorld ? 'world' : 'work'
    const now = Date.now()
    if (previousOwner === input.targetOwner) {
      return { tableName: spec.name, recordId: input.recordId, previousOwner, targetOwner: input.targetOwner, changedAt: now }
    }

    for (const edge of edges) {
      const rows = await edge.spec.table.toArray() as Record<string, unknown>[]
      for (const referencingRow of rows.filter(candidate => candidate[edge.field] === input.recordId)) {
        if (edgeInheritsMovedOwner(edge, spec.name)) continue
        const owner = await rowLogicalScope(edge.spec, referencingRow)
        const compatible = input.targetOwner === 'world'
          ? owner.worldId === scope.worldId
          : owner.workId === scope.workId
        if (!compatible) {
          throw new Error(`[scope-change] ${edge.spec.name}.${edge.field} 存在其它作用域引用，拒绝转换`)
        }
      }
    }

    const patch = input.targetOwner === 'world'
      ? { [locator.worldField]: scope.worldId, [locator.workField]: null, updatedAt: now }
      : { [locator.worldField]: null, [locator.workField]: scope.workId, updatedAt: now }
    await spec.table.update(input.recordId, patch)
    const changed = { ...row, ...patch }
    if (!await assertRecordInScope(scope, spec.name, changed, { owner: input.targetOwner })) {
      throw new Error(`[scope-change] ${input.tableName} 转换后未通过 owner gate`)
    }

    const audit: OwnershipScopeChange = {
      tableName: spec.name,
      recordId: input.recordId,
      previousOwner,
      targetOwner: input.targetOwner,
      changedAt: now,
    }
    const receipt = await db.ownershipMigrations.where('projectId').equals(scope.projectId).first()
    if (!receipt || receipt.status !== 'ready') throw new Error('[scope-change] ownership migration receipt 不可用')
    await db.ownershipMigrations.update(receipt.id!, {
      scopeChanges: [...(receipt.scopeChanges ?? []), audit],
      updatedAt: now,
    })
    return audit
  })
}
