import type { ImportantLocation } from '../types/location'

export interface LocationTreeNode extends ImportantLocation {
  children: LocationTreeNode[]
  hierarchyIssue?: 'cycle' | 'missing-parent'
}

/** A view of the stored graph, never a repair writer. Keep original parentId
 * on each copy while cutting invalid display edges so every row is visible. */
export function projectLocationForestV1(locations: readonly ImportantLocation[]): LocationTreeNode[] {
  const nodes = new Map<number, LocationTreeNode>()
  for (const location of locations) nodes.set(location.id!, { ...location, children: [] })
  const parents = new Map<number, number | null>()
  for (const [id, node] of nodes) {
    if (node.parentId != null && !nodes.has(node.parentId)) {
      node.hierarchyIssue = 'missing-parent'
      parents.set(id, null)
    } else parents.set(id, node.parentId)
  }
  const finished = new Set<number>()
  for (const id of nodes.keys()) {
    if (finished.has(id)) continue
    const path: number[] = [], positions = new Map<number, number>()
    let current: number | null = id
    while (current != null && !finished.has(current)) {
      const cycleStart = positions.get(current)
      if (cycleStart !== undefined) {
        for (const cycleId of path.slice(cycleStart)) {
          parents.set(cycleId, null)
          nodes.get(cycleId)!.hierarchyIssue = 'cycle'
        }
        break
      }
      positions.set(current, path.length); path.push(current)
      current = parents.get(current) ?? null
    }
    for (const visited of path) finished.add(visited)
  }
  const roots: LocationTreeNode[] = []
  for (const [id, node] of nodes) {
    const parent = parents.get(id)
    if (parent == null) roots.push(node)
    else nodes.get(parent)!.children.push(node)
  }
  return roots
}

function childIndex(locations: readonly ImportantLocation[]): Map<number, number[]> {
  const result = new Map<number, number[]>()
  for (const row of locations) if (row.id != null && row.parentId != null) {
    const children = result.get(row.parentId) ?? []
    children.push(row.id); result.set(row.parentId, children)
  }
  return result
}

/** Includes self and terminates even for a historical cycle. Used only to
 * exclude invalid parent choices; the native writer independently validates. */
export function locationDescendantsV1(locations: readonly ImportantLocation[], id: number): Set<number> {
  const children = childIndex(locations), result = new Set<number>(), pending = [id]
  while (pending.length) {
    const current = pending.pop()!
    if (result.has(current)) continue
    result.add(current)
    for (const child of children.get(current) ?? []) pending.push(child)
  }
  return result
}

/** A cyclic subtree cannot be silently selected for destructive deletion. */
export function collectLocationSubtreeV1(locations: readonly ImportantLocation[], id: number): Set<number> {
  const children = childIndex(locations), result = new Set<number>(), pending = [id]
  while (pending.length) {
    const current = pending.pop()!
    if (result.has(current)) throw new Error('地点层级存在循环，请先调整上级地点再删除。')
    result.add(current)
    for (const child of children.get(current) ?? []) pending.push(child)
  }
  return result
}
