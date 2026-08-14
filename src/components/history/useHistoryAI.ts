import { useCallback, useEffect, useRef, useState } from 'react'
import type { AIConfig } from '../../lib/types'
import type { HistoryAIMode, HistoryAITarget } from '../../lib/history/ai-plan'
import {
  abandonHistoryAgentRunV1,
  adoptHistoryAgentCandidateV1,
  generateHistoryAgentCandidateV1,
  readPendingHistoryAgentCandidateV1,
  readRecoverableHistoryAgentRunV1,
  rejectHistoryAgentCandidateV1,
  type HistoryAgentCandidateV1,
} from '../../lib/agent/run/history-agent-durable'
import { resolveScopeLike } from '../../lib/world-engine/scope'

export interface HistoryAgentLaneState {
  candidate: HistoryAgentCandidateV1 | null
  runId: number | null
  busy: boolean
  message: string | null
  unsafeRunId: number | null
  adoptionPending: boolean
}

interface Options {
  projectId: number
  worldGroupId: number | null
  aiConfig: AIConfig
  reloadEvents: () => Promise<unknown>
  reloadKeywords: () => Promise<unknown>
  onError: (message: string) => void
}

const emptyLane = (): HistoryAgentLaneState => ({
  candidate: null,
  runId: null,
  busy: false,
  message: null,
  unsafeRunId: null,
  adoptionPending: false,
})

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useHistoryAI(options: Options) {
  const {
    projectId,
    worldGroupId,
    aiConfig,
    reloadEvents,
    reloadKeywords,
    onError,
  } = options
  const [consult, setConsult] = useState<HistoryAgentLaneState>(emptyLane)
  const [storm, setStorm] = useState<HistoryAgentLaneState>(emptyLane)
  const consultRef = useRef(consult)
  const stormRef = useRef(storm)
  const generationRef = useRef({ consult: 0, storm: 0 })
  const reloadEventsRef = useRef(reloadEvents)
  const reloadKeywordsRef = useRef(reloadKeywords)
  const onErrorRef = useRef(onError)
  consultRef.current = consult
  stormRef.current = storm
  reloadEventsRef.current = reloadEvents
  reloadKeywordsRef.current = reloadKeywords
  onErrorRef.current = onError

  const lane = (mode: HistoryAIMode) => mode === 'consult' ? consultRef.current : stormRef.current
  const setLane = useCallback((mode: HistoryAIMode, next: HistoryAgentLaneState | ((current: HistoryAgentLaneState) => HistoryAgentLaneState)) => {
    const setter = mode === 'consult' ? setConsult : setStorm
    setter(next)
  }, [])

  const recover = useCallback(async (mode: HistoryAIMode): Promise<HistoryAgentLaneState> => {
    const scope = await resolveScopeLike(projectId)
    const pending = await readPendingHistoryAgentCandidateV1({ scope, worldGroupId, mode })
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
    const recoverable = await readRecoverableHistoryAgentRunV1({ scope, worldGroupId, mode })
    if (recoverable?.safeToResume && recoverable.candidate) {
      return {
        candidate: recoverable.candidate,
        runId: recoverable.snapshot.run.id,
        busy: false,
        message: recoverable.adoptionPending
          ? '采纳意图已冻结；继续确认会沿原运行幂等收敛，不会重复调用模型。'
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
  }, [projectId, worldGroupId])

  useEffect(() => {
    let cancelled = false
    generationRef.current.consult++
    generationRef.current.storm++
    setConsult(emptyLane())
    setStorm(emptyLane())
    void Promise.all([recover('consult'), recover('storm')])
      .then(([nextConsult, nextStorm]) => {
        if (cancelled) return
        setConsult(nextConsult)
        setStorm(nextStorm)
      })
      .catch(error => {
        if (!cancelled) onErrorRef.current(`历史 Agent 恢复失败：${messageOf(error)}。`)
      })
    return () => { cancelled = true }
  }, [recover])

  const runRequest = useCallback(async (
    mode: HistoryAIMode,
    request: { targetKind: 'event' | 'keyword'; targetId: number },
  ) => {
    const current = lane(mode)
    if (current.busy || current.candidate || current.unsafeRunId != null) return
    const token = ++generationRef.current[mode]
    setLane(mode, {
      ...emptyLane(),
      busy: true,
      message: '正在从登记 Context 生成持久候选…',
    })
    try {
      const scope = await resolveScopeLike(projectId)
      const generated = await generateHistoryAgentCandidateV1({
        scope,
        worldGroupId,
        mode,
        targetKind: request.targetKind,
        targetId: request.targetId,
        aiConfig,
      })
      if (generationRef.current[mode] !== token) return
      setLane(mode, {
        candidate: generated.candidate,
        runId: generated.snapshot.run.id,
        busy: false,
        message: '候选已持久化；确认前不会写入正式历史条目。',
        unsafeRunId: null,
        adoptionPending: false,
      })
    } catch (error) {
      if (generationRef.current[mode] !== token) return
      const recovered = await recover(mode).catch(() => emptyLane())
      const message = messageOf(error)
      setLane(mode, { ...recovered, busy: false, message: recovered.message ?? message })
      onErrorRef.current(`历史 Agent 生成失败：${message}。`)
    }
  }, [aiConfig, projectId, recover, setLane, worldGroupId])

  const run = useCallback(async (mode: HistoryAIMode, target: HistoryAITarget) => {
    if (!target.item.id) {
      onErrorRef.current('历史 Agent 目标尚未保存。')
      return
    }
    await runRequest(mode, { targetKind: target.kind, targetId: target.item.id })
  }, [runRequest])

  const accept = useCallback(async (mode: HistoryAIMode) => {
    const current = lane(mode)
    if (current.busy || current.runId == null || !current.candidate) return
    setLane(mode, { ...current, busy: true, message: '正在确认写入并执行终验…' })
    try {
      const scope = await resolveScopeLike(projectId)
      await adoptHistoryAgentCandidateV1({ scope, runId: current.runId })
      if (current.candidate.request.targetKind === 'event') await reloadEventsRef.current()
      else await reloadKeywordsRef.current()
      setLane(mode, { ...emptyLane(), message: '已写入对应结果字段并完成终验。' })
    } catch (error) {
      const recovered = await recover(mode).catch(() => current)
      const message = messageOf(error)
      setLane(mode, { ...recovered, busy: false, message })
      onErrorRef.current(`历史 Agent 确认失败：${message}。`)
    }
  }, [projectId, recover, setLane])

  const reject = useCallback(async (mode: HistoryAIMode) => {
    const current = lane(mode)
    if (current.busy || current.runId == null || !current.candidate || current.adoptionPending) return
    setLane(mode, { ...current, busy: true })
    try {
      await rejectHistoryAgentCandidateV1({ scope: await resolveScopeLike(projectId), runId: current.runId })
      setLane(mode, { ...emptyLane(), message: '候选已拒绝；正式历史条目没有变化。' })
    } catch (error) {
      const message = messageOf(error)
      setLane(mode, { ...current, busy: false, message })
      onErrorRef.current(`历史 Agent 拒绝失败：${message}。`)
    }
  }, [projectId, setLane])

  const retry = useCallback(async (mode: HistoryAIMode) => {
    const current = lane(mode)
    if (!current.candidate || current.runId == null || current.busy || current.adoptionPending) return
    const request = {
      targetKind: current.candidate.request.targetKind,
      targetId: current.candidate.request.targetId,
    }
    setLane(mode, { ...current, busy: true, message: '正在拒绝旧候选…' })
    try {
      await rejectHistoryAgentCandidateV1({ scope: await resolveScopeLike(projectId), runId: current.runId })
      setLane(mode, emptyLane())
      await runRequest(mode, request)
    } catch (error) {
      const message = messageOf(error)
      setLane(mode, { ...current, busy: false, message })
      onErrorRef.current(`历史 Agent 重试失败：${message}。`)
    }
  }, [projectId, runRequest, setLane])

  const abandonUnsafe = useCallback(async (mode: HistoryAIMode) => {
    const current = lane(mode)
    if (current.busy || current.unsafeRunId == null) return
    setLane(mode, { ...current, busy: true })
    try {
      await abandonHistoryAgentRunV1({
        scope: await resolveScopeLike(projectId),
        runId: current.unsafeRunId,
      })
      setLane(mode, { ...emptyLane(), message: '已放弃结果不可判定的旧运行，可以重新生成。' })
    } catch (error) {
      const message = messageOf(error)
      setLane(mode, { ...current, busy: false, message })
      onErrorRef.current(`历史 Agent 放弃失败：${message}。`)
    }
  }, [projectId, setLane])

  const activeId = (state: HistoryAgentLaneState, kind: 'event' | 'keyword') => (
    state.candidate?.request.targetKind === kind ? state.candidate.request.targetId : null
  )

  return {
    consult,
    storm,
    consultEventId: activeId(consult, 'event'),
    stormEventId: activeId(storm, 'event'),
    consultKeywordId: activeId(consult, 'keyword'),
    stormKeywordId: activeId(storm, 'keyword'),
    run,
    accept,
    reject,
    retry,
    abandonUnsafe,
  }
}
