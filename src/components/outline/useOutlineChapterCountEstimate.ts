import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  DEFAULT_WORDS_PER_CHAPTER,
  estimateChaptersPerVolume,
} from '../../lib/outline/selectors'

interface Options {
  selectedVolumeId: number | null
  selectedVolumeExists: boolean
  targetWordCount: number
  volumeCount: number
  parameterValues: Record<string, unknown>
  setParameterValues: Dispatch<SetStateAction<Record<string, unknown>>>
}

export function useOutlineChapterCountEstimate({
  selectedVolumeId,
  selectedVolumeExists,
  targetWordCount,
  volumeCount,
  parameterValues,
  setParameterValues,
}: Options) {
  const lastEstimateRef = useRef<number | null>(null)

  useEffect(() => {
    if (!selectedVolumeExists) return
    const wordsPerChapter = Number(parameterValues.wordsPerChapter) || DEFAULT_WORDS_PER_CHAPTER
    const estimate = estimateChaptersPerVolume(targetWordCount, volumeCount, wordsPerChapter)
    setParameterValues(previous => {
      const current = previous.chaptersPerVolume
      const untouched = current == null || current === '' || current === lastEstimateRef.current
      if (!untouched) return previous
      lastEstimateRef.current = estimate
      return { ...previous, chaptersPerVolume: estimate }
    })
    // User changes to chaptersPerVolume are deliberately excluded: they must remain authoritative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVolumeId, parameterValues.wordsPerChapter])
}
