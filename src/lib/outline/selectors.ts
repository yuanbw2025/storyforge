import type { OutlineNode } from '../types'
import { normalizeOutlineNode } from './normalize'

type OutlineLike = Pick<OutlineNode, 'type' | 'parentId'>

export function isTopLevelVolumeNode(node: OutlineLike): boolean {
  return node.type === 'volume' && node.parentId === null
}

export function getTopLevelVolumes(nodes: OutlineNode[]): OutlineNode[] {
  return nodes
    .map(normalizeOutlineNode)
    .filter(isTopLevelVolumeNode)
    .sort((a, b) => a.order - b.order)
}

/** 每章字数默认值（仅当用户未自定义时用；用户可在「每章字数」里按自己的更新习惯改） */
export const DEFAULT_WORDS_PER_CHAPTER = 3000

/**
 * 按「项目目标字数 ÷ 卷数 ÷ 每章字数」估算单卷章节数（仅作「用户没手动设时」的智能默认值）。
 * 不限制用户:每章字数由用户自定义；章节数算出来后用户还能随意滑/填覆盖。只兜下限 1（不出 0/负）。
 */
export function estimateChaptersPerVolume(
  totalWordCount: number,
  volumeCount: number,
  wordsPerChapter: number = DEFAULT_WORDS_PER_CHAPTER,
): number {
  const total = totalWordCount > 0 ? totalWordCount : 500000
  const vols = Math.max(1, volumeCount || Math.ceil(total / 300000))
  const perChapter = wordsPerChapter > 0 ? wordsPerChapter : DEFAULT_WORDS_PER_CHAPTER
  const perVolumeWords = total / vols
  return Math.max(1, Math.round(perVolumeWords / perChapter))
}

/** All chapters below a volume, including nested story blocks. */
export function getDescendantChapters(nodes: OutlineNode[], rootId: number): OutlineNode[] {
  const byParent = new Map<number, OutlineNode[]>()
  for (const node of nodes) if (node.parentId != null) {
    const children = byParent.get(node.parentId) ?? []
    children.push(node); byParent.set(node.parentId, children)
  }
  for (const children of byParent.values()) children.sort((a, b) => a.order - b.order || a.id! - b.id!)
  const byId = new Map(nodes.map(node => [node.id, node]))
  const seen = new Set<number>(), ordered: OutlineNode[] = [], pending = [rootId]
  while (pending.length) {
    const id = pending.pop()!
    if (seen.has(id)) throw new Error('大纲层级形成循环，请先恢复原数据。')
    seen.add(id)
    const node = byId.get(id)
    if (id !== rootId && node?.type === 'chapter') ordered.push(node)
    pending.push(...(byParent.get(id) ?? []).map(child => child.id!).reverse())
  }
  return ordered
}
