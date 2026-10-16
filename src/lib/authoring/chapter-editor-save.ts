import type { Chapter, ChapterStatus } from '../types'

export interface ChapterEditorDraftV1 {
  chapterId: number
  html: string
  plainText: string
}

/** Author input keeps its original record identity until a successful save. */
export function createChapterEditorDraftBufferV1(persist: (draft: ChapterEditorDraftV1) => Promise<void>) {
  const drafts = new Map<number, ChapterEditorDraftV1>()
  let flushing: Promise<void> | null = null
  return {
    stage(draft: ChapterEditorDraftV1) { drafts.set(draft.chapterId, { ...draft }) },
    read(chapterId: number) { return drafts.get(chapterId) },
    hasPending() { return drafts.size > 0 },
    flush(): Promise<void> {
      if (flushing) return flushing
      if (!drafts.size) return Promise.resolve()
      const operation = (async () => {
        while (drafts.size) {
          for (const [id, draft] of [...drafts]) {
            await persist(draft)
            // A late receipt cannot discard text typed while the save was running.
            if (drafts.get(id) === draft) drafts.delete(id)
          }
        }
      })()
      flushing = operation
      void operation.finally(() => { if (flushing === operation) flushing = null }).catch(() => undefined)
      return operation
    },
  }
}

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
