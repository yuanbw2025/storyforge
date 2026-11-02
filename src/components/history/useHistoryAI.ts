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
import { resolveScopeLike } from '../../lib/workspace/scope'

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
  activeWorldId?: number | null
  activeWorkId?: number | null
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
    activeWorldId,
    activeWorkId,
    worldGroupId,
    aiConfig,
    reloadEvents,
    reloadKeywords,
    onError,
  } = options
  const [consult, setConsult] = useState<HistoryAgentLaneState>(emptyLane)
  const [storm, setStorm] = useState<HistoryAgentLaneState>(emptyLane)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const consultRef = useRef(consult)
  const stormRef = useRef(storm)
  const generationRef = useRef({ consult: 0, storm: 0 })
  const reloadEventsRef = useRef(reloadEvents)
  const reloadKeywordsRef = useRef(reloadKeywords)
  const onErrorRef = useRef(onError)
  reloadEventsRef.current = reloadEvents
  reloadKeywordsRef.current = reloadKeywords
  onErrorRef.current = onError

  const lane = (mode: HistoryAIMode) => mode === 'consult' ? consultRef.current : stormRef.current
  const setLane = useCallback((mode: HistoryAIMode, next: HistoryAgentLaneState | ((current: HistoryAgentLaneState) => HistoryAgentLaneState)) => {
    const ref = mode === 'consult' ? consultRef : stormRef
    const value = typeof next === 'function' ? next(ref.current) : next
    // The next action can run before React renders (notably reject → retry).
    ref.current = value
    const setter = mode === 'consult' ? setConsult : setStorm
    setter(value)
  }, [])

  const resolveCurrentScope = useCallback(async () => {
    const scope = await resolveScopeLike(projectId)
    if ((activeWorldId != null && scope.worldId !== activeWorldId)
      || (activeWorkId != null && scope.workId !== activeWorkId)) {
      throw new Error('历史 Agent 的当前世界或作品已切换，请返回对应作用域后操作')
    }
    return scope
  }, [projectId, activeWorldId, activeWorkId])

  const recover = useCallback(async (mode: HistoryAIMode): Promise<HistoryAgentLaneState> => {
    const scope = await resolveCurrentScope()
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
  }, [resolveCurrentScope, worldGroupId])

  useEffect(() => {
    // This shared object is never replaced; cleanup increments its live counters.
    const generations = generationRef.current
    let cancelled = false
    generations.consult++
    generations.storm++
    setRecoveryError(null)
    const recovering = { ...emptyLane(), busy: true, message: '正在检查可恢复的历史候选…' }
    setLane('consult', recovering)
    setLane('storm', recovering)
    void Promise.all([recover('consult'), recover('storm')])
      .then(([nextConsult, nextStorm]) => {
        if (cancelled) return
        setLane('consult', nextConsult)
        setLane('storm', nextStorm)
      })
      .catch(error => {
        if (cancelled) return
        const message = `历史候选读取失败：${messageOf(error)}。重新检查只读取已有记录，不会调用模型。`
        setRecoveryError(message)
        onErrorRef.current(message)
      })
    return () => {
      cancelled = true
      generations.consult++
      generations.storm++
    }
  }, [recover, setLane, recoveryAttempt])

  const retryRecovery = useCallback(() => {
    if (!recoveryError) return
    setRecoveryError(null)
    setRecoveryAttempt(attempt => attempt + 1)
  }, [recoveryError])

  const runRequest = useCallback(async (
    mode: HistoryAIMode,
    request: { targetKind: 'event' | 'keyword'; targetId: number },
  ) => {
    const current = lane(mode)
    if (current.busy || current.candidate || current.unsafeRunId != null || current.adoptionPending) return
    const token = ++generationRef.current[mode]
    setLane(mode, {
      ...emptyLane(),
      busy: true,
      message: '正在从登记 Context 生成持久候选…',
    })
    try {
      const scope = await resolveCurrentScope()
      if (generationRef.current[mode] !== token) return
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
      if (generationRef.current[mode] !== token) return
      const message = messageOf(error)
      setLane(mode, { ...recovered, busy: false, message: recovered.message ?? message })
      onErrorRef.current(`历史 Agent 生成失败：${message}。`)
    }
  }, [aiConfig, resolveCurrentScope, recover, setLane, worldGroupId])

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
    const token = ++generationRef.current[mode]
    setLane(mode, { ...current, busy: true, message: '正在确认写入并执行终验…' })
    try {
      const scope = await resolveCurrentScope()
      if (generationRef.current[mode] !== token) return
      await adoptHistoryAgentCandidateV1({ scope, runId: current.runId })
      if (generationRef.current[mode] !== token) return
      if (current.candidate.request.targetKind === 'event') await reloadEventsRef.current()
      else await reloadKeywordsRef.current()
      if (generationRef.current[mode] !== token) return
      setLane(mode, { ...emptyLane(), message: '已写入对应结果字段并完成终验。' })
    } catch (error) {
      if (generationRef.current[mode] !== token) return
      const recovered = await recover(mode).catch(() => current)
      if (generationRef.current[mode] !== token) return
      const message = messageOf(error)
      setLane(mode, { ...recovered, busy: false, message })
      onErrorRef.current(`历史 Agent 确认失败：${message}。`)
    }
  }, [resolveCurrentScope, recover, setLane])

  const reject = useCallback(async (mode: HistoryAIMode) => {
    const current = lane(mode)
    if (current.busy || current.runId == null || !current.candidate || current.adoptionPending) return
    const token = ++generationRef.current[mode]
    setLane(mode, { ...current, busy: true })
    try {
      const scope = await resolveCurrentScope()
      if (generationRef.current[mode] !== token) return
      await rejectHistoryAgentCandidateV1({ scope, runId: current.runId })
      if (generationRef.current[mode] !== token) return
      setLane(mode, { ...emptyLane(), message: '候选已拒绝；正式历史条目没有变化。' })
    } catch (error) {
      if (generationRef.current[mode] !== token) return
      const message = messageOf(error)
      setLane(mode, { ...current, busy: false, message })
      onErrorRef.current(`历史 Agent 拒绝失败：${message}。`)
    }
  }, [resolveCurrentScope, setLane])

  const retry = useCallback(async (mode: HistoryAIMode) => {
    const current = lane(mode)
    if (!current.candidate || current.runId == null || current.busy || current.adoptionPending || current.unsafeRunId != null) return
    const token = ++generationRef.current[mode]
    const request = {
      targetKind: current.candidate.request.targetKind,
      targetId: current.candidate.request.targetId,
    }
    setLane(mode, { ...current, busy: true, message: '正在拒绝旧候选…' })
    try {
      const scope = await resolveCurrentScope()
      if (generationRef.current[mode] !== token) return
      await rejectHistoryAgentCandidateV1({ scope, runId: current.runId })
      if (generationRef.current[mode] !== token) return
      setLane(mode, emptyLane())
      await runRequest(mode, request)
    } catch (error) {
      if (generationRef.current[mode] !== token) return
      const message = messageOf(error)
      setLane(mode, { ...current, busy: false, message })
      onErrorRef.current(`历史 Agent 重试失败：${message}。`)
    }
  }, [resolveCurrentScope, runRequest, setLane])

  const abandonUnsafe = useCallback(async (mode: HistoryAIMode) => {
    const current = lane(mode)
    if (current.busy || current.unsafeRunId == null) return
    const token = ++generationRef.current[mode]
    setLane(mode, { ...current, busy: true })
    try {
      const scope = await resolveCurrentScope()
      if (generationRef.current[mode] !== token) return
      await abandonHistoryAgentRunV1({
        scope,
        runId: current.unsafeRunId,
      })
      if (generationRef.current[mode] !== token) return
      setLane(mode, { ...emptyLane(), message: '已放弃结果不可判定的旧运行，可以重新生成。' })
    } catch (error) {
      if (generationRef.current[mode] !== token) return
      const message = messageOf(error)
      setLane(mode, { ...current, busy: false, message })
      onErrorRef.current(`历史 Agent 放弃失败：${message}。`)
    }
  }, [resolveCurrentScope, setLane])

  const activeId = (state: HistoryAgentLaneState, kind: 'event' | 'keyword') => (
    state.candidate?.request.targetKind === kind ? state.candidate.request.targetId : null
  )

  return {
    consult,
    storm,
    recoveryError,
    retryRecovery,
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
