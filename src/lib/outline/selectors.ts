import type { OutlineNode, Chapter } from '../types'

type OutlineLike = Pick<OutlineNode, 'type'> & { parentId?: number | null }

export function isTopLevelVolumeNode(node: OutlineLike): boolean {
  return node.type === 'volume' && node.parentId == null
}

export function getTopLevelVolumes(nodes: OutlineNode[]): OutlineNode[] {
  return nodes
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

/**
 * 章节的「叙事位置」索引：outlineNodeId → 大纲树前序 DFS 序（越小越早）。
 *
 * 为什么不用 chapter.order：`chapter.order` 是正文记录**入库时的序号**
 * （建章处写死 `order: chapters.length`），记录的是"第几个被创建"，
 * 不是章节在故事里的叙事位置。用户若先进第 2 章写作，其正文记录反而先建、
 * order 更小，导致"取前一章"错乱（第 2 章被判成第一章）。
 * 章节的真实叙事顺序由大纲树（volume → arc/storyBlock → chapter）的前序 DFS 决定，
 * 与 ChaptersListPanel 的展示序一致。本函数即该唯一口径。
 *
 * 纯函数、可单测、不碰 DB，也不依赖任何专有模块。
 */
export function buildChapterNarrativeOrder(nodes: OutlineNode[]): ReadonlyMap<number, number> {
  const byParent = new Map<number | null, OutlineNode[]>()
  for (const n of nodes) {
    const p = n.parentId ?? null
    const list = byParent.get(p) || []
    list.push(n)
    byParent.set(p, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order)

  const index = new Map<number, number>()
  let pos = 0
  const visit = (parentId: number | null) => {
    for (const n of byParent.get(parentId) || []) {
      if (n.id != null) index.set(n.id, pos++)
      visit(n.id ?? null)
    }
  }
  visit(null)
  return index
}

/**
 * 按叙事顺序取「前一章」正文记录（叙事序上紧邻当前章、且更早的那一章）。
 * currentChapter 未定位到大纲序、或它已是第一章时返回 undefined。
 * 替代旧写法 `chapters.filter(c => c.order < currentChapter.order).pop()`
 * ——后者既用错了 order 语义、又依赖数组有序（.pop()）。
 */
export function findPrevChapter(
  nodes: OutlineNode[],
  chapters: Chapter[],
  currentChapter: Chapter | null | undefined,
): Chapter | undefined {
  return adjacentChapter(nodes, chapters, currentChapter, 'prev')
}

/** 按叙事顺序取「后一章」正文记录。currentChapter 已是最后一章时返回 undefined。 */
export function findNextChapter(
  nodes: OutlineNode[],
  chapters: Chapter[],
  currentChapter: Chapter | null | undefined,
): Chapter | undefined {
  return adjacentChapter(nodes, chapters, currentChapter, 'next')
}

function adjacentChapter(
  nodes: OutlineNode[],
  chapters: Chapter[],
  currentChapter: Chapter | null | undefined,
  dir: 'prev' | 'next',
): Chapter | undefined {
  if (!currentChapter) return undefined
  const order = buildChapterNarrativeOrder(nodes)
  const curPos = order.get(currentChapter.outlineNodeId)
  if (curPos == null) return undefined

  let best: Chapter | undefined
  let bestPos = dir === 'prev' ? -Infinity : Infinity
  for (const ch of chapters) {
    if (ch.id === currentChapter.id) continue
    const pos = order.get(ch.outlineNodeId)
    if (pos == null) continue
    if (dir === 'prev' ? (pos < curPos && pos > bestPos) : (pos > curPos && pos < bestPos)) {
      best = ch
      bestPos = pos
    }
  }
  return best
}
