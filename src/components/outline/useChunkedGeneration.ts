import { useState, useCallback, useRef } from 'react'
import type {
  BlockChoice,
  ChunkedGenerationProgress,
  ChunkedGenerationResult,
} from '../../lib/outline/chunked-generator'
import { 
  runChunkedOutlineGeneration,
} from '../../lib/outline/chunked-generator'
import type { ChunkedGenerationConfig } from '../../lib/outline/generation-modes'
import type { AssembleContextResult } from '../../lib/registry/types'
import type { Project } from '../../lib/types'

interface Options {
  project: Project
  volumeId: number
  volumeTitle: string
  volumeSummary: string
  totalChapters: number
  config: ChunkedGenerationConfig
  assembled: AssembleContextResult
  storyArcContext?: string  // 故事线上下文（新增）
  onProgress?: (progress: ChunkedGenerationProgress) => void
  onInfo?: (message: string) => void
  onError?: (message: string) => void
}

interface PendingChoice {
  resolve: (result: { action: 'accept'; choiceId: string } | { action: 'cancel' }) => void
  reject: (reason?: unknown) => void
  regenerate?: () => Promise<BlockChoice>
}

export function useChunkedGeneration() {
  const [progress, setProgress] = useState<ChunkedGenerationProgress | null>(null)
  const [result, setResult] = useState<ChunkedGenerationResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const signalRef = useRef<AbortController | null>(null)
  const pendingChoiceRef = useRef<PendingChoice | null>(null)
  const currentOptionsRef = useRef<Options | null>(null)

  const start = useCallback(async (options: Options) => {
    currentOptionsRef.current = options
    setFavorites(new Set())
    setIsRunning(true)
    setResult(null)
    setProgress({
      currentBlockIndex: 0,
      totalBlocks: options.config.blockCount,
      currentBlockLabel: '准备中',
      stage: '正在初始化分块生成...',
      waitingForChoice: false,
    })

    const controller = new AbortController()
    signalRef.current = controller

    try {
      const assembled = options.assembled
      const worldContext = assembled.included.includes('worldContext')
        ? assembled.segments[assembled.included.indexOf('worldContext')]?.content ?? ''
        : assembled.text

      const characterContext = assembled.included.includes('characters')
        ? assembled.segments[assembled.included.indexOf('characters')]?.content ?? ''
        : ''

      const worldRulesContext = assembled.included.includes('worldRules')
        ? assembled.segments[assembled.included.indexOf('worldRules')]?.content ?? ''
        : ''

      const progressCallback = (p: ChunkedGenerationProgress) => {
        setProgress(p)
        options.onProgress?.(p)
      }

      const choiceNeededCallback = (
        _currentChoice: BlockChoice | null,
        _favoriteChoices: BlockChoice[],
        regenerate: () => Promise<BlockChoice>,
      ) => {
        return new Promise<{ action: 'accept'; choiceId: string } | { action: 'cancel' }>((resolve) => {
          pendingChoiceRef.current = { resolve, reject: () => {}, regenerate }
        })
      }

      const result = await runChunkedOutlineGeneration({
        volumeId: options.volumeId,
        volumeTitle: options.volumeTitle,
        volumeSummary: options.volumeSummary,
        worldContext,
        characterContext,
        worldRulesContext,
        storyArcContext: options.storyArcContext,  // 传入故事线上下文
        config: options.config,
        totalChapters: options.totalChapters,
        onProgress: progressCallback,
        onChoiceNeeded: choiceNeededCallback,
        signal: controller.signal,
      })

      if (!result.cancelled) {
        setResult(result)
        options.onInfo?.(`精细生成完成：共 ${result.totalChapters} 章`)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('[ChunkedGeneration] 生成失败:', error)
        options.onError?.(`精细生成失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    } finally {
      setIsRunning(false)
      setProgress(null)
      signalRef.current = null
    }
  }, [])

  const selectChoice = useCallback(async (choiceId: string) => {
    if (pendingChoiceRef.current) {
      pendingChoiceRef.current.resolve({ action: 'accept', choiceId })
      pendingChoiceRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    if (pendingChoiceRef.current) {
      pendingChoiceRef.current.resolve({ action: 'cancel' })
      pendingChoiceRef.current = null
    }
    signalRef.current?.abort()
    setIsRunning(false)
    setProgress(null)
  }, [])

  const regenerateChoice = useCallback(async () => {
    if (!pendingChoiceRef.current?.regenerate || !progress) return
    
    setIsRegenerating(true)
    
    try {
      const newChoice = await pendingChoiceRef.current.regenerate()
      
      const currentChoices = progress.choices || []
      const favChoices = currentChoices.filter(c => favorites.has(c.id))
      
      setProgress({
        ...progress,
        choices: [newChoice, ...favChoices],
      })
    } catch (error) {
      console.error('[ChunkedGeneration] 重新生成失败:', error)
    } finally {
      setIsRegenerating(false)
    }
  }, [progress, favorites])

  const toggleFavorite = useCallback(async (choiceId: string) => {
    if (!pendingChoiceRef.current || !progress) return
    
    const newFavorites = new Set(favorites)
    if (newFavorites.has(choiceId)) {
      newFavorites.delete(choiceId)
    } else {
      newFavorites.add(choiceId)
    }
    setFavorites(newFavorites)
    
    const currentChoices = progress.choices || []
    const favChoices = currentChoices.filter(c => newFavorites.has(c.id))
    const others = currentChoices.filter(c => !newFavorites.has(c.id))
    
    setProgress({
      ...progress,
      choices: [...others, ...favChoices],
    })
  }, [progress, favorites])

  const reset = useCallback(() => {
    setProgress(null)
    setResult(null)
    setIsRegenerating(false)
    setFavorites(new Set())
    pendingChoiceRef.current = null
    currentOptionsRef.current = null
  }, [])

  return {
    progress,
    result,
    isRunning,
    isRegenerating,
    favorites,
    start,
    selectChoice,
    regenerateChoice,
    toggleFavorite,
    cancel,
    reset,
  }
}
