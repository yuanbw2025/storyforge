import type { OutlineNode } from '../types'

export type OutlineWalkAnomalyKind =
  | 'orphan-outline-node'
  | 'outline-cycle'
  | 'duplicate-sibling-order'

export interface OutlineWalkAnomaly {
  kind: OutlineWalkAnomalyKind
  detail: string
}

export interface CanonicalOutlineChapter {
  outlineNode: OutlineNode
  worldGroupId: number | null
  ordinal: number
}

export interface CanonicalOutlineWalk {
  chapters: CanonicalOutlineChapter[]
  anomalies: OutlineWalkAnomaly[]
  nodeById: Map<number, OutlineNode>
}

export interface CanonicalVolumeChapterGroup {
  /** Presentation identity only; never a persisted outline node id. */
  key: string
  volume: OutlineNode | null
  chapters: OutlineNode[]
}

export function byOutlineOrderThenId(a: OutlineNode, b: OutlineNode): number {
  return a.order - b.order || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER)
}

/**
 * Traverse the outline tree in the single canonical chapter order used by
 * continuity, display numbering, extraction ranges, and future outline tools.
 */
export function walkOutlineChaptersInCanonicalOrder(outlineNodes: OutlineNode[]): CanonicalOutlineWalk {
  const anomalies: OutlineWalkAnomaly[] = []
  const nodes = [...outlineNodes].sort(byOutlineOrderThenId)
  const nodeById = new Map(nodes.filter(node => node.id != null).map(node => [node.id!, node]))
  const children = new Map<number | null, OutlineNode[]>()

  for (const node of nodes) {
    const parentId = node.parentId ?? null
    if (parentId != null && !nodeById.has(parentId)) {
      anomalies.push({ kind: 'orphan-outline-node', detail: `outline ${node.id ?? '?'} parent ${parentId} missing` })
    }
    const effectiveParent = parentId != null && nodeById.has(parentId) ? parentId : null
    const list = children.get(effectiveParent) ?? []
    list.push(node)
    children.set(effectiveParent, list)
  }

  for (const [parentId, siblings] of children) {
    siblings.sort(byOutlineOrderThenId)
    const seenOrders = new Set<number>()
    for (const sibling of siblings) {
      if (seenOrders.has(sibling.order)) {
        anomalies.push({
          kind: 'duplicate-sibling-order',
          detail: `parent ${parentId ?? 'root'} has duplicate order ${sibling.order}`,
        })
      }
      seenOrders.add(sibling.order)
    }
  }

  const chapters: CanonicalOutlineChapter[] = []
  const visited = new Set<number>()
  const visiting = new Set<number>()
  let ordinal = 0

  const visit = (node: OutlineNode, inheritedWorldGroupId: number | null) => {
    if (node.id == null) return
    if (visiting.has(node.id)) {
      anomalies.push({ kind: 'outline-cycle', detail: `cycle reaches outline ${node.id}` })
      return
    }
    if (visited.has(node.id)) return

    visiting.add(node.id)
    const worldGroupId = node.worldGroupId ?? inheritedWorldGroupId
    if (node.type === 'chapter') {
      ordinal += 1
      chapters.push({ outlineNode: node, worldGroupId, ordinal })
    }
    for (const child of children.get(node.id) ?? []) visit(child, worldGroupId)
    visiting.delete(node.id)
    visited.add(node.id)
  }

  for (const root of children.get(null) ?? []) visit(root, root.worldGroupId ?? null)
  for (const node of nodes) if (node.id != null && !visited.has(node.id)) visit(node, node.worldGroupId ?? null)

  return { chapters, anomalies, nodeById }
}

/**
 * Partition canonical chapters into real volume groups and consecutive
 * unvolumed sections. Empty real volumes still separate those sections.
 * Chapter membership/order comes from the canonical walk; parent paths only
 * determine the presentation group and never manufacture outline records.
 */
export function groupOutlineChaptersByTopLevelVolume(
  outlineNodes: OutlineNode[],
): CanonicalVolumeChapterGroup[] {
  const walk = walkOutlineChaptersInCanonicalOrder(outlineNodes)
  const roots = [...walk.nodeById.values()]
    .filter(node => node.parentId == null || !walk.nodeById.has(node.parentId))
    .sort(byOutlineOrderThenId)
  const byRoot = new Map<number, OutlineNode[]>()
  const assigned = new Set<number>()

  for (const { outlineNode } of walk.chapters) {
    let root = outlineNode
    const seen = new Set<number>()
    while (root.parentId != null && walk.nodeById.has(root.parentId)) {
      if (seen.has(root.id!)) break
      seen.add(root.id!)
      root = walk.nodeById.get(root.parentId)!
    }
    // Cyclic components have no effective root. They retain the existing
    // canonical fallback sequence below, without following their parents again.
    if (root.parentId != null && walk.nodeById.has(root.parentId)) continue
    const chapters = byRoot.get(root.id!) ?? []
    chapters.push(outlineNode)
    byRoot.set(root.id!, chapters)
  }

  const groups: CanonicalVolumeChapterGroup[] = []
  const append = (chapters: OutlineNode[], volume: OutlineNode | null) => {
    if (volume) {
      groups.push({ key: `volume:${volume.id}`, volume, chapters })
    } else if (chapters.length > 0) {
      const previous = groups[groups.length - 1]
      if (previous?.volume === null) previous.chapters.push(...chapters)
      else groups.push({ key: `unvolumed:${chapters[0].id}`, volume: null, chapters: [...chapters] })
    }
    chapters.forEach(chapter => assigned.add(chapter.id!))
  }
  for (const root of roots) append(byRoot.get(root.id!) ?? [], root.type === 'volume' ? root : null)
  append(walk.chapters.map(item => item.outlineNode).filter(chapter => !assigned.has(chapter.id!)), null)
  return groups
}
