import { useCallback, useEffect, useRef, useState } from 'react'
import type { AIConfig } from '../../lib/types'
import type { ReferenceDerivedModeV1 } from '../../lib/reference-analysis/derived-agent-baseline'
import {
  abandonReferenceDerivedRunV1,
  adoptReferenceDerivedCandidateV1,
  generateReferenceDerivedCandidateV1,
  readPendingReferenceDerivedCandidateV1,
  readRecoverableReferenceDerivedRunV1,
  rejectReferenceDerivedCandidateV1,
  type ReferenceDerivedCandidateV1,
} from '../../lib/agent/run/reference-derived-durable'
import { resolveScopeLike } from '../../lib/world-engine/scope'

export interface ReferenceDerivedLaneState {
  candidate: ReferenceDerivedCandidateV1 | null
  runId: number | null
  busy: boolean
  message: string | null
  unsafeRunId: number | null
  adoptionPending: boolean
}

interface Options {
  projectId: number
  analysisRunId: number
  aiConfig: AIConfig
  onCommitted: (mode: ReferenceDerivedModeV1, resultJson: string) => void | Promise<void>
  onError: (message: string) => void
}

const emptyLane = (): ReferenceDerivedLaneState => ({
  candidate: null,
  runId: null,
  busy: false,
  message: null,
  unsafeRunId: null,
  adoptionPending: false,
})

const recoveringLane = (): ReferenceDerivedLaneState => ({
  ...emptyLane(),
  busy: true,
  message: '正在检查可恢复运行…',
})

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useReferenceDerivedAI(options: Options) {
  const { projectId, analysisRunId, aiConfig, onCommitted, onError } = options
  const [summary, setSummary] = useState<ReferenceDerivedLaneState>(recoveringLane)
  const [characters, setCharacters] = useState<ReferenceDerivedLaneState>(recoveringLane)
  const summaryRef = useRef(summary)
  const charactersRef = useRef(characters)
  const generationRef = useRef({ summary: 0, characters: 0 })
  const onCommittedRef = useRef(onCommitted)
  const onErrorRef = useRef(onError)
  summaryRef.current = summary
  charactersRef.current = characters
  onCommittedRef.current = onCommitted
  onErrorRef.current = onError

  const lane = (mode: ReferenceDerivedModeV1) => mode === 'summary' ? summaryRef.current : charactersRef.current
  const setLane = useCallback((
    mode: ReferenceDerivedModeV1,
    next: ReferenceDerivedLaneState | ((current: ReferenceDerivedLaneState) => ReferenceDerivedLaneState),
  ) => {
    const setter = mode === 'summary' ? setSummary : setCharacters
    setter(next)
  }, [])

  const recover = useCallback(async (mode: ReferenceDerivedModeV1): Promise<ReferenceDerivedLaneState> => {
    const scope = await resolveScopeLike(projectId)
    const pending = await readPendingReferenceDerivedCandidateV1({ scope, mode, analysisRunId })
    if (pending) {
      return {
        candidate: pending.candidate,
        runId: pending.snapshot.run.id,
        busy: false,
        message: '已恢复待确认候选；没有重复调用模型。',
        unsafeRunId: null,
        adoptionPending: false,
      }
    }
    const recoverable = await readRecoverableReferenceDerivedRunV1({ scope, mode, analysisRunId })
    if (recoverable?.safeToResume && recoverable.candidate) {
      return {
        candidate: recoverable.candidate,
        runId: recoverable.snapshot.run.id,
        busy: false,
        message: recoverable.adoptionPending
          ? '采纳意图已冻结；继续确认会沿原运行幂等收敛。'
          : '已恢复待确认候选；没有重复调用模型。',
        unsafeRunId: null,
        adoptionPending: !!recoverable.adoptionPending,
      }
    }
    if (recoverable && !recoverable.safeToResume) {
      return {
        ...emptyLane(),
        message: '上次运行停在模型结果不可判定窗口，系统不会自动重试。请先放弃旧运行。',
        unsafeRunId: recoverable.snapshot.run.id,
      }
    }
    return emptyLane()
  }, [analysisRunId, projectId])

  useEffect(() => {
    let cancelled = false
    generationRef.current.summary++
    generationRef.current.characters++
    setSummary(recoveringLane())
    setCharacters(recoveringLane())
    void Promise.all([recover('summary'), recover('characters')])
      .then(([nextSummary, nextCharacters]) => {
        if (cancelled) return
        setSummary(nextSummary)
        setCharacters(nextCharacters)
      })
      .catch(error => {
        if (!cancelled) onErrorRef.current(`参考派生 Agent 恢复失败：${messageOf(error)}。`)
      })
    return () => { cancelled = true }
  }, [recover])

  const runRequest = useCallback(async (mode: ReferenceDerivedModeV1, retrying = false) => {
    const current = lane(mode)
    if (!retrying && (current.busy || current.candidate || current.unsafeRunId != null)) return
    const token = ++generationRef.current[mode]
    setLane(mode, { ...emptyLane(), busy: true, message: '正在从登记 Context 生成持久候选…' })
    try {
      const scope = await resolveScopeLike(projectId)
      const generated = await generateReferenceDerivedCandidateV1({
        scope,
        mode,
        runId: analysisRunId,
        aiConfig,
      })
      if (generationRef.current[mode] !== token) return
      setLane(mode, {
        candidate: generated.candidate,
        runId: generated.snapshot.run.id,
        busy: false,
        message: '候选已持久化；确认前不会写入分析版本或参考投影。',
        unsafeRunId: null,
        adoptionPending: false,
      })
    } catch (error) {
      if (generationRef.current[mode] !== token) return
      const recovered = await recover(mode).catch(() => emptyLane())
      const message = messageOf(error)
      setLane(mode, { ...recovered, busy: false, message: recovered.message ?? message })
      onErrorRef.current(`参考派生 Agent 生成失败：${message}。`)
    }
  }, [aiConfig, analysisRunId, projectId, recover, setLane])

  const accept = useCallback(async (mode: ReferenceDerivedModeV1) => {
    const current = lane(mode)
    if (current.busy || current.runId == null || !current.candidate) return
    setLane(mode, { ...current, busy: true, message: '正在确认写入并执行终验…' })
    try {
      const scope = await resolveScopeLike(projectId)
      await adoptReferenceDerivedCandidateV1({ scope, runId: current.runId })
      await onCommittedRef.current(mode, current.candidate.resultJson)
      setLane(mode, { ...emptyLane(), message: '已写入版本化派生字段并完成终验。' })
    } catch (error) {
      const recovered = await recover(mode).catch(() => current)
      const message = messageOf(error)
      setLane(mode, { ...recovered, busy: false, message })
      onErrorRef.current(`参考派生 Agent 确认失败：${message}。`)
    }
  }, [projectId, recover, setLane])

  const reject = useCallback(async (mode: ReferenceDerivedModeV1) => {
    const current = lane(mode)
    if (current.busy || current.runId == null || !current.candidate || current.adoptionPending) return
    setLane(mode, { ...current, busy: true })
    try {
      await rejectReferenceDerivedCandidateV1({ scope: await resolveScopeLike(projectId), runId: current.runId })
      setLane(mode, { ...emptyLane(), message: '候选已拒绝；正式分析结果没有变化。' })
    } catch (error) {
      const message = messageOf(error)
      setLane(mode, { ...current, busy: false, message })
      onErrorRef.current(`参考派生 Agent 拒绝失败：${message}。`)
    }
  }, [projectId, setLane])

  const retry = useCallback(async (mode: ReferenceDerivedModeV1) => {
    const current = lane(mode)
    if (!current.candidate || current.runId == null || current.busy || current.adoptionPending) return
    setLane(mode, { ...current, busy: true, message: '正在拒绝旧候选…' })
    try {
      await rejectReferenceDerivedCandidateV1({ scope: await resolveScopeLike(projectId), runId: current.runId })
      setLane(mode, emptyLane())
      await runRequest(mode, true)
    } catch (error) {
      const message = messageOf(error)
      setLane(mode, { ...current, busy: false, message })
      onErrorRef.current(`参考派生 Agent 重试失败：${message}。`)
    }
  }, [projectId, runRequest, setLane])

  const abandonUnsafe = useCallback(async (mode: ReferenceDerivedModeV1) => {
    const current = lane(mode)
    if (current.busy || current.unsafeRunId == null) return
    setLane(mode, { ...current, busy: true })
    try {
      await abandonReferenceDerivedRunV1({
        scope: await resolveScopeLike(projectId),
        runId: current.unsafeRunId,
      })
      setLane(mode, { ...emptyLane(), message: '已放弃结果不可判定的旧运行，可以重新生成。' })
    } catch (error) {
      const message = messageOf(error)
      setLane(mode, { ...current, busy: false, message })
      onErrorRef.current(`参考派生 Agent 放弃失败：${message}。`)
    }
  }, [projectId, setLane])

  return { summary, characters, run: runRequest, accept, reject, retry, abandonUnsafe }
}
