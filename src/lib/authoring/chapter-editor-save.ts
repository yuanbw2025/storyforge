import type { Chapter, ChapterStatus } from '../types'

/**
 * Loading or switching chapters updates the editor's local state. That state
 * synchronization must not be mistaken for an author edit: a no-op write would
 * advance the chapter revision and make an in-flight durable prose candidate
 * stale even though the Canon did not actually change.
 */
export function shouldPersistChapterEditorContentV1(
  chapter: Pick<Chapter, 'content' | 'wordCount'> | null | undefined,
  html: string,
  wordCount: number,
): boolean {
  if (!chapter) return false
  return (chapter.content ?? '') !== html || (chapter.wordCount ?? 0) !== wordCount
}

/**
 * Status changes are a persistence boundary too. Include the current editor
 * buffer in the same database update so a React rerender cannot replace dirty
 * prose with the previously persisted chapter before autosave fires.
 */
export function buildChapterStatusPatchV1(
  html: string,
  wordCount: number,
  status: ChapterStatus,
): Pick<Chapter, 'content' | 'wordCount' | 'status'> {
  return { content: html, wordCount, status }
}
