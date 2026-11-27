import type { Chapter, ChapterStatus } from '../types'
/** Ownership metadata is read-only evidence, not an editable Chapter field. */
export type ChapterEditorRecordV1 = Chapter & { readonly workId?: number }

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

/** A successful callback alone cannot acknowledge the original editor buffer.
 * Compare its actual record identity and only the submitted editor fields. */
export function assertChapterEditorSavedV1(
  before: ChapterEditorRecordV1,
  actual: ChapterEditorRecordV1 | undefined,
  patch: Partial<Pick<Chapter, 'content' | 'wordCount' | 'status'>>,
): void {
  if (!actual || actual.id !== before.id || actual.projectId !== before.projectId || actual.workId !== before.workId
    || actual.ragDocumentId !== before.ragDocumentId) throw new Error('原章节身份已变化；修改仍保留，未确认保存。')
  if ('content' in patch && (actual.content ?? '') !== (patch.content ?? '')
    || 'wordCount' in patch && (actual.wordCount ?? 0) !== (patch.wordCount ?? 0)
    || patch.status !== undefined && actual.status !== patch.status) throw new Error('正文尚未保存成功；修改已保留，请重试保存。')
}
