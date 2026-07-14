import { useCallback, useRef, useState } from 'react'
import type { ChapterDragPayload } from './chapter-drag'

export function useOutlineChapterDrag() {
  const [activeChapterDrag, setActiveChapterDrag] = useState<ChapterDragPayload | null>(null)
  const activeChapterDragRef = useRef<ChapterDragPayload | null>(null)

  const beginChapterDrag = useCallback((payload: ChapterDragPayload) => {
    activeChapterDragRef.current = payload
    setActiveChapterDrag(payload)
  }, [])

  const clearActiveChapterDrag = useCallback(() => {
    activeChapterDragRef.current = null
    setActiveChapterDrag(null)
  }, [])

  const getActiveChapterDrag = useCallback(() => activeChapterDragRef.current, [])

  return {
    activeChapterDrag,
    beginChapterDrag,
    clearActiveChapterDrag,
    getActiveChapterDrag,
  }
}
