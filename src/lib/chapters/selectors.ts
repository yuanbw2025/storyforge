import type { Chapter } from '../types'
import { countWords, htmlToPlainText } from '../utils/html'

export function chapterContentWordCount(chapter: Chapter): number {
  const plain = htmlToPlainText(chapter.content || '').trim()
  return countWords(plain)
}

function effectiveWordCount(chapter: Chapter): number {
  return Math.max(chapter.wordCount || 0, chapterContentWordCount(chapter))
}

function hasBodyContent(chapter: Chapter): boolean {
  return chapterContentWordCount(chapter) > 0
}

function compareChapterCandidates(a: Chapter, b: Chapter): number {
  const aHasBody = hasBodyContent(a)
  const bHasBody = hasBodyContent(b)
  if (aHasBody !== bHasBody) return aHasBody ? -1 : 1

  const wordDelta = effectiveWordCount(b) - effectiveWordCount(a)
  if (wordDelta !== 0) return wordDelta

  const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
  if (updatedDelta !== 0) return updatedDelta

  return (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER)
}

/**
 * Pick the canonical chapter row for one outline node.
 *
 * A damaged or concurrent write can leave duplicate `chapters` rows for the
 * same `outlineNodeId`. Prefer the row that actually has prose, then the larger
 * effective word count, then the latest edit time. Ties keep the lowest id so
 * corruption recovery remains deterministic.
 */
export function pickBestChapterForOutline(chapters: Chapter[]): Chapter | undefined {
  if (chapters.length === 0) return undefined
  return [...chapters].sort(compareChapterCandidates)[0]
}

export function buildBestChapterByOutlineMap(chapters: Chapter[]): Map<number, Chapter> {
  const grouped = new Map<number, Chapter[]>()
  for (const chapter of chapters) {
    const list = grouped.get(chapter.outlineNodeId) ?? []
    list.push(chapter)
    grouped.set(chapter.outlineNodeId, list)
  }

  const result = new Map<number, Chapter>()
  for (const [outlineNodeId, mapped] of grouped) {
    const best = pickBestChapterForOutline(mapped)
    if (best) result.set(outlineNodeId, best)
  }
  return result
}

/**
 * Recompute the real manuscript size from canonical chapter bodies.
 * Cached Chapter.wordCount values are deliberately ignored here because they
 * can drift and must never decide short-novel profile or completion gates.
 */
export function canonicalManuscriptWordCount(chapters: Chapter[]): number {
  return [...buildBestChapterByOutlineMap(chapters).values()]
    .reduce((sum, chapter) => sum + chapterContentWordCount(chapter), 0)
}
