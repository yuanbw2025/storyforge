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
  beginOutlineGenerationBatchAdoptionV1,
  rejectOutlineGenerationCandidateV1,
  restoreLatestOutlineGenerationBatchV1,
  type OutlineGenerationCandidateV1,
  type OutlineGenerationAdoptionIntentV1,
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

async function rejectCandidates(candidates: Iterable<OutlineGenerationCandidateV1>, reason: string) {
  const failed: Array<{ candidate: OutlineGenerationCandidateV1; reason: string }> = []
  for (const candidate of candidates) {
    try { await rejectOutlineGenerationCandidateV1(candidate, reason) }
    catch (error) { failed.push({ candidate, reason: error instanceof Error ? error.message : String(error) }) }
  }
  return failed
}

function projectRestoredBatch(input: Awaited<ReturnType<typeof restoreLatestOutlineGenerationBatchV1>>): {
  chapters: Map<number, ParsedChapter[]>
  candidates: Map<number, OutlineGenerationCandidateV1>
  intents: Map<number, OutlineGenerationAdoptionIntentV1>
} | null {
  if (!input) return null
  const chapters = new Map<number, ParsedChapter[]>()
  const candidates = new Map<number, OutlineGenerationCandidateV1>()
  const intents = new Map<number, OutlineGenerationAdoptionIntentV1>()
  for (const candidate of input.candidates) {
    const request = decodeGenerationOperation(candidate.operation)
    if (request?.kind !== 'chapters') continue
    const intent = input.adoptionIntents?.get(candidate.runId)
    const parsed = intent?.kind === 'chapters' ? intent.items.map(item => ({ ...item })) : parseChapterOutlineOutput(candidate.output)
    if (parsed.length === 0) continue
    chapters.set(request.volumeId, parsed)
    candidates.set(request.volumeId, candidate)
    if (intent) intents.set(candidate.runId, intent)
  }
  return candidates.size > 0 ? { chapters, candidates, intents } : null
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
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<Map<number, ParsedChapter[]> | null>(null)
  const [candidates, setCandidates] = useState<Map<number, OutlineGenerationCandidateV1>>(new Map())
  const abortRef = useRef<AbortController | null>(null)
  const rejectionRef = useRef<{ owner: string } | null>(null)
  const adoptionIntentsRef = useRef(new Map<number, OutlineGenerationAdoptionIntentV1>())
  const ownerKey = project.id != null && work?.id != null ? `${project.id}:${work.worldId}:${work.id}` : ''
  const currentOwnerRef = useRef(ownerKey)
  currentOwnerRef.current = ownerKey
  const resultOwnerRef = useRef<string | null>(null)
  const restoreCallbacksRef = useRef({ onInfo, onError })
  restoreCallbacksRef.current = { onInfo, onError }
  const restorationRef = useRef<{ key: string; applied: boolean; promise: ReturnType<typeof restoreLatestOutlineGenerationBatchV1> } | null>(null)

  useEffect(() => {
    if (!ownerKey || project.id == null || work?.id == null) return
    let restoration = restorationRef.current
    if (!restoration || restoration.key !== ownerKey) {
      const scope = { projectId: project.id, worldId: work.worldId, workId: work.id }
      restoration = { key: ownerKey, applied: false, promise: restoreLatestOutlineGenerationBatchV1(scope) }
      restorationRef.current = restoration
      resultOwnerRef.current = null
      adoptionIntentsRef.current = new Map()
      setResult(null); setCandidates(new Map()); setProgress(null); setRunning(false); setConfirming(false)
    }
    if (restoration.applied) return
    const request = restoration
    let cancelled = false
    void request.promise.then(restored => {
      if (cancelled || request.applied || currentOwnerRef.current !== ownerKey) return
      request.applied = true
      const projected = projectRestoredBatch(restored)
      if (!projected) return
      resultOwnerRef.current = ownerKey
      adoptionIntentsRef.current = projected.intents
      setResult(projected.chapters); setCandidates(projected.candidates)
      restoreCallbacksRef.current.onInfo(`已恢复刷新前尚未确认的批量章纲候选，共 ${projected.candidates.size} 卷。`)
    }).catch(error => {
      if (cancelled || currentOwnerRef.current !== ownerKey) return
      restoreCallbacksRef.current.onError(`批量章纲候选恢复失败：${error instanceof Error ? error.message : String(error)}。请保留作品并重新读取。`)
    })
    return () => { cancelled = true }
  }, [ownerKey, project.id, work?.id, work?.worldId])

  const rejectBatch = useCallback(async (
    pending: Map<number, OutlineGenerationCandidateV1>,
    chapters: Map<number, ParsedChapter[]> | null,
    reason: string,
  ): Promise<boolean> => {
    if (rejectionRef.current?.owner === ownerKey) return false
    const token = { owner: ownerKey }
    rejectionRef.current = token
    try {
      const failed = await rejectCandidates(pending.values(), reason)
      if (currentOwnerRef.current !== ownerKey) return false
      const failedRuns = new Set(failed.map(item => item.candidate.runId))
      const remaining = new Map([...pending].filter(([, candidate]) => failedRuns.has(candidate.runId)))
      const remainingChapters = new Map([...remaining].map(([volumeId, candidate]) => [
        volumeId, chapters?.get(volumeId) ?? parseChapterOutlineOutput(candidate.output),
      ]))
      resultOwnerRef.current = ownerKey
      setCandidates(remaining)
      setResult(remaining.size ? remainingChapters : null)
      if (!remaining.size) setProgress(null)
      if (failed.length) {
        onError(`批量章纲拒绝有 ${failed.length} 卷失败：${failed.map(item => item.reason).join('；')}。候选与修改已保留，可重试。`)
      }
      return failed.length === 0
    } finally {
      if (rejectionRef.current === token) rejectionRef.current = null
    }
  }, [onError, ownerKey])

  const generate = useCallback(async () => {
    if (project.id == null || !work || volumes.length === 0) return
    if (rejectionRef.current?.owner === ownerKey) return
    if (restorationRef.current) restorationRef.current.applied = true
    if (candidates.size > 0 && resultOwnerRef.current === ownerKey) {
      const rejected = await rejectBatch(candidates, result, '作者启动了新的批量章纲任务，旧批量候选已失效。')
      if (!rejected) return
    }
    setRunning(true)
    setResult(null)
    setCandidates(new Map())
    adoptionIntentsRef.current = new Map()
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
        await rejectBatch(
          generationResult.candidatesByVolume,
          generationResult.chaptersByVolume,
          '作者取消了批量章纲生成，已生成候选不进入正式数据。',
        )
        return
      }
      if (generationResult.candidatesByVolume.size === 0) {
        const first = generationResult.failures[0]?.reason ?? '没有卷生成出可确认候选'
        onError(`批量生成章节失败：${first}。`)
        return
      }
      if (currentOwnerRef.current !== ownerKey) return
      resultOwnerRef.current = ownerKey
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
      if (currentOwnerRef.current === ownerKey) setRunning(false)
    }
  }, [
    assembleContext,
    candidates,
    hint,
    multiWorldEnabled,
    nodes,
    onError,
    onInfo,
    ownerKey,
    project,
    rejectBatch,
    result,
    runOptions,
    volumes,
    work,
  ])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const confirm = useCallback(async () => {
    if (rejectionRef.current?.owner === ownerKey) return
    if (project.id == null || !result || candidates.size === 0 || resultOwnerRef.current !== ownerKey || currentOwnerRef.current !== ownerKey) return
    const token = { owner: ownerKey }
    rejectionRef.current = token
    setConfirming(true)
    const errors: string[] = []
    const completed = new Map<number, true>()
    const ordered = [...candidates.entries()].sort((left, right) => (
      (left[1].batch?.batchIndex ?? 0) - (right[1].batch?.batchIndex ?? 0)
    ))
    try {
      const entries: Array<{ candidate: OutlineGenerationCandidateV1; intent: OutlineGenerationAdoptionIntentV1 }> = []
      for (const [volumeId, candidate] of ordered) {
        const chapters = result.get(volumeId)
        const volume = nodes.find(node => node.id === volumeId && node.type === 'volume')
        if (!chapters?.length || !volume) {
          throw new Error(`目标卷 ${volumeId} 或其候选内容已不存在`)
        }
        const existingChapters = nodes.filter(node => node.parentId === volumeId && node.type === 'chapter')
          .sort((left, right) => left.order - right.order)
        const intent = adoptionIntentsRef.current.get(candidate.runId) ?? {
          version: 1 as const, kind: 'chapters' as const, destinationVolumeId: volumeId,
          items: chapters.map(chapter => ({ ...chapter })), startingOrder: existingChapters.length,
          baseExistingTitles: existingChapters.map(chapter => chapter.title),
        }
        entries.push({ candidate, intent })
      }
      if (entries.length) {
        await beginOutlineGenerationBatchAdoptionV1(entries)
        if (currentOwnerRef.current !== ownerKey) return
        for (const entry of entries) adoptionIntentsRef.current.set(entry.candidate.runId, entry.intent)
        for (const { candidate, intent } of entries) {
          if (currentOwnerRef.current !== ownerKey) break
          try {
            await adoptOutlineGenerationCandidateV1({ candidate, intent })
            const request = decodeGenerationOperation(candidate.operation)
            if (request?.kind === 'chapters') completed.set(request.volumeId, true)
          } catch (error) {
            const title = intent.kind === 'chapters' ? nodes.find(node => node.id === intent.destinationVolumeId)?.title : undefined
            errors.push(`「${title ?? '待完成卷'}」：${error instanceof Error ? error.message : String(error)}`)
            break
          }
        }
      }
      if (currentOwnerRef.current !== ownerKey) return
      const remaining = new Map([...candidates].filter(([volumeId]) => !completed.has(volumeId)))
      setCandidates(remaining)
      setResult(remaining.size ? new Map([...result].filter(([volumeId]) => remaining.has(volumeId))) : null)
      if (!remaining.size) setProgress(null)
      try { await reloadOutline() }
      catch (error) { errors.push(`大纲回读失败：${error instanceof Error ? error.message : String(error)}`) }
      if (currentOwnerRef.current === ownerKey && errors.length) onError(`批量写入未全部完成：${errors.join('；')}。未完成候选与修改已保留，可明确重试。`)
    } catch (error) {
      if (currentOwnerRef.current === ownerKey) onError(`批量确认失败：${error instanceof Error ? error.message : String(error)}。候选与修改已保留，可重试。`)
    } finally {
      if (rejectionRef.current === token) rejectionRef.current = null
      if (currentOwnerRef.current === ownerKey) setConfirming(false)
    }
  }, [candidates, nodes, onError, ownerKey, project.id, reloadOutline, result])

  const dismiss = useCallback(async () => {
    if (resultOwnerRef.current !== ownerKey || currentOwnerRef.current !== ownerKey) return
    await rejectBatch(candidates, result, '作者关闭了批量章纲候选，没有写入项目。')
  }, [candidates, ownerKey, rejectBatch, result])

  return { progress, running, confirming, result: resultOwnerRef.current === ownerKey ? result : null, generate, cancel, confirm, dismiss }
}
