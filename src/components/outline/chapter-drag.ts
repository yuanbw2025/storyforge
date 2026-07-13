import type { DragEvent as ReactDragEvent } from 'react'

export const OUTLINE_CHAPTER_DRAG_MIME = 'application/x-storyforge-outline-chapter'

export interface ChapterDragPayload {
  chapterId: number
  sourceParentId: number | null
}

export function readChapterDragPayload(event: ReactDragEvent): ChapterDragPayload | null {
  const raw = event.dataTransfer?.getData(OUTLINE_CHAPTER_DRAG_MIME) ?? ''
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ChapterDragPayload>
    const chapterId = Number(parsed.chapterId)
    const sourceParentId = parsed.sourceParentId == null ? null : Number(parsed.sourceParentId)
    if (!Number.isFinite(chapterId)) return null
    if (sourceParentId != null && !Number.isFinite(sourceParentId)) return null
    return { chapterId, sourceParentId }
  } catch {
    const legacyId = Number(raw)
    return Number.isFinite(legacyId) ? { chapterId: legacyId, sourceParentId: null } : null
  }
}

export function hasChapterDragPayload(event: ReactDragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(OUTLINE_CHAPTER_DRAG_MIME)
}

export type GetActiveChapterDrag = () => ChapterDragPayload | null

export function chapterDropProps({
  targetParentId,
  targetIndex,
  onMoveChapter,
  getActiveChapterDrag,
  clearActiveChapterDrag,
}: {
  targetParentId: number
  targetIndex: number
  onMoveChapter: (chapterId: number, targetParentId: number, index: number) => Promise<void>
  getActiveChapterDrag: GetActiveChapterDrag
  clearActiveChapterDrag: () => void
}) {
  return {
    onDragOver: (event: ReactDragEvent) => {
      if (!getActiveChapterDrag() && !hasChapterDragPayload(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    },
    onDrop: async (event: ReactDragEvent) => {
      const payload = readChapterDragPayload(event) ?? getActiveChapterDrag()
      if (!payload) return
      event.preventDefault()
      event.stopPropagation()
      try {
        await onMoveChapter(payload.chapterId, targetParentId, targetIndex)
      } finally {
        clearActiveChapterDrag()
      }
    },
  }
}
