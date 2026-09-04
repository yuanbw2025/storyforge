import { useCallback, useEffect, useRef, useState } from 'react'
import {
  runBatchOutlineGeneration,
  type BatchOutlineProgress,
} from '../../lib/ai/batch-outline-runner'
import {
  parseChapterOutlineOutput,
  type ParsedChapter,
} from '../../lib/ai/parse-outline-output'
import type { RunOptions } from '../../lib/ai/adapters/outline-adapter'
import {
  adoptOutlineGenerationCandidateV1,
  rejectOutlineGenerationCandidateV1,
  restoreLatestOutlineGenerationBatchV1,
  type OutlineGenerationCandidateV1,
} from '../../lib/outline/harness'
import { decodeGenerationOperation } from '../../lib/outline/generation-request'
import type { OutlineGenerationRequest } from '../../lib/outline/generation-request'
import type { AssembleContextResult } from '../../lib/registry/types'
import type { OutlineNode, Project, Work } from '../../lib/types'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

interface Options {
  project: Project
  work: Work | null
  multiWorldEnabled: boolean
  volumes: OutlineNode[]
  nodes: OutlineNode[]
  hint: string
  runOptions: RunOptions
  assembleContext: (
    request: OutlineGenerationRequest,
    worldGroupId: number | null,
    outlineNodeId?: number | null,
    priorOutlineCandidateText?: string,
  ) => Promise<AssembleContextResult>
  reloadOutline: () => Promise<void>
  onInfo: (message: string) => void
  onError: (message: string) => void
}

async function rejectCandidates(candidates: Iterable<OutlineGenerationCandidateV1>, reason: string): Promise<void> {
  for (const candidate of candidates) {
    await rejectOutlineGenerationCandidateV1(candidate, reason).catch(error => {
      console.warn('[Outline Batch Harness] 候选拒绝证据记录失败。', error)
    })
  }
}

function projectRestoredBatch(input: Awaited<ReturnType<typeof restoreLatestOutlineGenerationBatchV1>>): {
  chapters: Map<number, ParsedChapter[]>
  candidates: Map<number, OutlineGenerationCandidateV1>
} | null {
  if (!input) return null
  const chapters = new Map<number, ParsedChapter[]>()
  const candidates = new Map<number, OutlineGenerationCandidateV1>()
  for (const candidate of input.candidates) {
    const request = decodeGenerationOperation(candidate.operation)
    if (request?.kind !== 'chapters') continue
    const parsed = parseChapterOutlineOutput(candidate.output)
    if (parsed.length === 0) continue
    chapters.set(request.volumeId, parsed)
    candidates.set(request.volumeId, candidate)
  }
  return candidates.size > 0 ? { chapters, candidates } : null
}

export function useOutlineBatchGeneration({
  project,
  work,
  multiWorldEnabled,
  volumes,
  nodes,
  hint,
  runOptions,
  assembleContext,
  reloadOutline,
  onInfo,
  onError,
}: Options) {
  const [progress, setProgress] = useState<BatchOutlineProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Map<number, ParsedChapter[]> | null>(null)
  const [candidates, setCandidates] = useState<Map<number, OutlineGenerationCandidateV1>>(new Map())
  const abortRef = useRef<AbortController | null>(null)
  const restoredProjectRef = useRef<number | null>(null)

  useEffect(() => {
    if (project.id == null || restoredProjectRef.current === project.id) return
    restoredProjectRef.current = project.id
    let cancelled = false
    void restoreLatestOutlineGenerationBatchV1(project.id)
      .then(restored => {
        if (cancelled) return
        const projected = projectRestoredBatch(restored)
        if (!projected) return
        setResult(projected.chapters)
        setCandidates(projected.candidates)
        onInfo(`已恢复刷新前尚未确认的批量章纲候选，共 ${projected.candidates.size} 卷。`)
      })
      .catch(error => {
        console.warn('[Outline Batch Harness] 批量候选恢复失败，已保持当前界面状态。', error)
      })
    return () => { cancelled = true }
  }, [onInfo, project.id])

  const generate = useCallback(async () => {
    if (project.id == null || !work || volumes.length === 0) return
    if (candidates.size > 0) {
      await rejectCandidates(candidates.values(), '作者启动了新的批量章纲任务，旧批量候选已失效。')
    }
    setRunning(true)
    setResult(null)
    setCandidates(new Map())
    setProgress(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await flushPendingEditsV1()
      const generationResult = await runBatchOutlineGeneration({
        project,
        work,
        nodes,
        volumes,
        userHint: hint || undefined,
        runOptions,
        assembleContext: ({ volume, priorOutlineCandidateText }) => assembleContext(
          { kind: 'chapters', volumeId: volume.id! },
          multiWorldEnabled ? (volume.worldGroupId ?? null) : null,
          volume.id,
          priorOutlineCandidateText,
        ),
        signal: controller.signal,
        onProgress: setProgress,
      })
      if (generationResult.cancelled) {
        await rejectCandidates(
          generationResult.candidatesByVolume.values(),
          '作者取消了批量章纲生成，已生成候选不进入正式数据。',
        )
        return
      }
      if (generationResult.candidatesByVolume.size === 0) {
        const first = generationResult.failures[0]?.reason ?? '没有卷生成出可确认候选'
        onError(`批量生成章节失败：${first}。`)
        return
      }
      setResult(generationResult.chaptersByVolume)
      setCandidates(generationResult.candidatesByVolume)
      if (generationResult.failures.length > 0) {
        onInfo(`已生成 ${generationResult.candidatesByVolume.size} 卷，另有 ${generationResult.failures.length} 卷失败并保留了诊断。`)
      }
    } catch (error) {
      console.error('[BatchOutline] 失败:', error)
      onError(`批量生成章节失败：${error instanceof Error ? error.message : '未知错误'}。`)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunning(false)
    }
  }, [
    assembleContext,
    candidates,
    hint,
    multiWorldEnabled,
    nodes,
    onError,
    onInfo,
    project,
    runOptions,
    volumes,
    work,
  ])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const confirm = useCallback(async () => {
    if (project.id == null || !result || candidates.size === 0) return
    const errors: string[] = []
    const ordered = [...candidates.entries()].sort((left, right) => (
      (left[1].batch?.batchIndex ?? 0) - (right[1].batch?.batchIndex ?? 0)
    ))
    for (const [volumeId, candidate] of ordered) {
      const chapters = result.get(volumeId)
      const volume = nodes.find(node => node.id === volumeId && node.type === 'volume')
      if (!chapters?.length || !volume) {
        const reason = `目标卷 ${volumeId} 或其候选内容已不存在`
        errors.push(reason)
        await rejectOutlineGenerationCandidateV1(candidate, reason).catch(() => undefined)
        continue
      }
      const existingChapters = nodes.filter(node => node.parentId === volumeId && node.type === 'chapter')
      const intent = {
        version: 1 as const,
        kind: 'chapters' as const,
        destinationVolumeId: volumeId,
        items: chapters,
        startingOrder: existingChapters.length,
        baseExistingTitles: existingChapters.map(chapter => chapter.title),
      }
      try {
        await adoptOutlineGenerationCandidateV1({ candidate, intent })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        errors.push(`「${volume.title}」：${reason}`)
      }
    }
    await reloadOutline()
    setResult(null)
    setCandidates(new Map())
    setProgress(null)
    if (errors.length > 0) onError(`批量写入有 ${errors.length} 卷失败：${errors.join('；')}`)
  }, [candidates, nodes, onError, project.id, reloadOutline, result])

  const dismiss = useCallback(async () => {
    await rejectCandidates(candidates.values(), '作者关闭了批量章纲候选，没有写入项目。')
    setResult(null)
    setCandidates(new Map())
    setProgress(null)
  }, [candidates])

  return { progress, running, result, generate, cancel, confirm, dismiss }
}
