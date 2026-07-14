import { useCallback, useRef, useState } from 'react'
import {
  runBatchOutlineGeneration,
  type BatchOutlineProgress,
} from '../../lib/ai/batch-outline-runner'
import type { ParsedChapter } from '../../lib/ai/parse-outline-output'
import { adoptGeneratedOutlineItems } from '../../lib/outline/adopt-generation'
import type { AssembleContextResult } from '../../lib/registry/types'
import type { OutlineNode } from '../../lib/types'

interface Options {
  projectId: number
  multiWorldEnabled: boolean
  volumes: OutlineNode[]
  nodes: OutlineNode[]
  hint: string
  assembleContext: (worldGroupId: number | null, outlineNodeId?: number | null) => Promise<AssembleContextResult>
  reloadOutline: () => Promise<void>
  onError: (message: string) => void
}

function contextPart(assembled: AssembleContextResult, key: string): string {
  const index = assembled.included.indexOf(key)
  return index >= 0 ? assembled.segments[index]?.content ?? '' : ''
}

export function useOutlineBatchGeneration({
  projectId,
  multiWorldEnabled,
  volumes,
  nodes,
  hint,
  assembleContext,
  reloadOutline,
  onError,
}: Options) {
  const [progress, setProgress] = useState<BatchOutlineProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Map<number, ParsedChapter[]> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const generate = useCallback(async () => {
    if (volumes.length === 0) return
    setRunning(true)
    setResult(null)
    setProgress(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const assembled = await assembleContext(null)
      const generationResult = await runBatchOutlineGeneration({
        volumes,
        worldContext: assembled.text,
        worldContextResolver: multiWorldEnabled
          ? async volumeId => {
            const volume = nodes.find(node => node.id === volumeId)
            const resolved = await assembleContext(volume?.worldGroupId ?? null, volumeId)
            return resolved.text
          }
          : undefined,
        worldRulesContextResolver: multiWorldEnabled
          ? async volumeId => {
            const volume = nodes.find(node => node.id === volumeId)
            const resolved = await assembleContext(volume?.worldGroupId ?? null, volumeId)
            return contextPart(resolved, 'worldRules')
          }
          : undefined,
        userHint: hint || undefined,
        characterContext: contextPart(assembled, 'characters'),
        worldRulesContext: contextPart(assembled, 'worldRules'),
        signal: controller.signal,
        onProgress: setProgress,
      })
      if (!generationResult.cancelled) setResult(generationResult.chaptersByVolume)
    } catch (error) {
      console.error('[BatchOutline] 失败:', error)
      onError(`批量生成章节失败：${error instanceof Error ? error.message : '未知错误'}。`)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunning(false)
    }
  }, [volumes, nodes, multiWorldEnabled, hint, assembleContext, onError])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setRunning(false)
  }, [])

  const confirm = useCallback(async () => {
    if (!result) return
    try {
      for (const [volumeId, chapters] of result) {
        const existingCount = nodes.filter(node => node.parentId === volumeId && node.type === 'chapter').length
        await adoptGeneratedOutlineItems({
          projectId,
          parentId: volumeId,
          type: 'chapter',
          items: chapters,
          startingOrder: existingCount,
        })
      }
    } catch (error) {
      console.error('[Outline] 批量写入章节失败:', error)
      onError(`批量写入章节时出错：${error instanceof Error ? error.message : '未知错误'}。请查看控制台获取详情。`)
      return
    }
    await reloadOutline()
    setResult(null)
    setProgress(null)
  }, [result, nodes, projectId, reloadOutline, onError])

  const dismiss = useCallback(() => {
    setResult(null)
    setProgress(null)
  }, [])

  return { progress, running, result, generate, cancel, confirm, dismiss }
}
