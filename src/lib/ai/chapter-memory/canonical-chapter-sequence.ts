import type { Chapter, OutlineNode } from '../../types'
import { walkOutlineChaptersInCanonicalOrder } from '../../outline/canonical-outline-walk'
import { pickBestChapterForOutline } from '../../chapters/selectors'

export interface ChapterSequenceAnomaly {
  kind:
    | 'orphan-outline-node'
    | 'outline-cycle'
    | 'duplicate-sibling-order'
    | 'duplicate-chapter-mapping'
    | 'chapter-without-outline'
  detail: string
}

export interface CanonicalChapterEntry {
  chapter: Chapter
  outlineNode: OutlineNode | null
  worldGroupId: number | null
}

export interface CanonicalChapterSequence {
  sequence: CanonicalChapterEntry[]
  anomalies: ChapterSequenceAnomaly[]
}

export function resolveCanonicalChapterSequence(
  outlineNodes: OutlineNode[],
  chapters: Chapter[],
): CanonicalChapterSequence {
  const walk = walkOutlineChaptersInCanonicalOrder(outlineNodes)
  const anomalies: ChapterSequenceAnomaly[] = [...walk.anomalies]
  const nodeById = walk.nodeById

  const chaptersByOutline = new Map<number, Chapter[]>()
  const chaptersWithoutOutline: Chapter[] = []
  for (const chapter of chapters) {
    if (!nodeById.has(chapter.outlineNodeId)) {
      chaptersWithoutOutline.push(chapter)
      anomalies.push({
        kind: 'chapter-without-outline',
        detail: `chapter ${chapter.id ?? '?'} outline ${chapter.outlineNodeId} missing`,
      })
      continue
    }
    const list = chaptersByOutline.get(chapter.outlineNodeId) ?? []
    list.push(chapter)
    chaptersByOutline.set(chapter.outlineNodeId, list)
  }
  for (const [outlineNodeId, mapped] of chaptersByOutline) {
    if (mapped.length > 1) {
      anomalies.push({
        kind: 'duplicate-chapter-mapping',
        detail: `outline ${outlineNodeId} maps ${mapped.length} chapters; best content row wins`,
      })
    }
  }

  const sequence: CanonicalChapterEntry[] = []
  for (const item of walk.chapters) {
    const id = item.outlineNode.id
    if (id == null) continue
    const mapped = chaptersByOutline.get(id) ?? []
    const chapter = pickBestChapterForOutline(mapped)
    if (chapter) sequence.push({ chapter, outlineNode: item.outlineNode, worldGroupId: item.worldGroupId })
  }

  chaptersWithoutOutline
    .sort((a, b) => a.order - b.order || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER))
    .forEach(chapter => sequence.push({ chapter, outlineNode: null, worldGroupId: null }))

  return { sequence, anomalies }
}

export function findPreviousCanonicalChapter(
  outlineNodes: OutlineNode[],
  chapters: Chapter[],
  currentChapter: Chapter | null | undefined,
): Chapter | undefined {
  return findAdjacentCanonicalChapter(outlineNodes, chapters, currentChapter, -1)
}

export function findNextCanonicalChapter(
  outlineNodes: OutlineNode[],
  chapters: Chapter[],
  currentChapter: Chapter | null | undefined,
): Chapter | undefined {
  return findAdjacentCanonicalChapter(outlineNodes, chapters, currentChapter, 1)
}

function findAdjacentCanonicalChapter(
  outlineNodes: OutlineNode[],
  chapters: Chapter[],
  currentChapter: Chapter | null | undefined,
  offset: -1 | 1,
): Chapter | undefined {
  if (!currentChapter) return undefined
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const index = sequence.findIndex(entry => {
    if (currentChapter.id != null && entry.chapter.id != null) return entry.chapter.id === currentChapter.id
    return entry.chapter.outlineNodeId === currentChapter.outlineNodeId
  })
  return index >= 0 ? sequence[index + offset]?.chapter : undefined
}
