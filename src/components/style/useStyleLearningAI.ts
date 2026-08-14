import { useCallback, useEffect, useRef, useState } from 'react'
import {
  abandonStyleLearningRunV1,
  adoptStyleLearningCandidateV1,
  generateStyleLearningCandidateV1,
  readPendingStyleLearningCandidateV1,
  readRecoverableStyleLearningRunV1,
  rejectStyleLearningCandidateV1,
  type StyleLearningCandidateV1,
} from '../../lib/agent/run/style-learning-durable'
import type { AIConfig } from '../../lib/types'
import { resolveScopeLike } from '../../lib/world-engine/scope'

export interface StyleLearningLaneState {
  candidate: StyleLearningCandidateV1 | null
  runId: number | null
  busy: boolean
  message: string | null
  unsafeRunId: number | null
  adoptionPending: boolean
}

interface Options {
  projectId: number
  aiConfig: AIConfig
  onCommitted: () => void | Promise<void>
  onError: (message: string) => void
}

const emptyLane = (): StyleLearningLaneState => ({
  candidate: null,
  runId: null,
  busy: false,
  message: null,
  unsafeRunId: null,
  adoptionPending: false,
})

const recoveringLane = (): StyleLearningLaneState => ({
  ...emptyLane(),
  busy: true,
  message: '正在检查可恢复的文风学习运行…',
})

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useStyleLearningAI(options: Options) {
  const { projectId, aiConfig, onCommitted, onError } = options
  const [lane, setLane] = useState<StyleLearningLaneState>(recoveringLane)
  const laneRef = useRef(lane)
  const generationRef = useRef(0)
  const onCommittedRef = useRef(onCommitted)
  const onErrorRef = useRef(onError)
  laneRef.current = lane
  onCommittedRef.current = onCommitted
  onErrorRef.current = onError

  const recover = useCallback(async (): Promise<StyleLearningLaneState> => {
    const scope = await resolveScopeLike(projectId)
    const pending = await readPendingStyleLearningCandidateV1({ scope })
    if (pending) {
      return {
        candidate: pending.candidate,
        runId: pending.snapshot.run.id,
        busy: false,
        message: '已恢复待确认文风候选；没有重复调用模型。',
        unsafeRunId: null,
        adoptionPending: false,
      }
    }
    const recoverable = await readRecoverableStyleLearningRunV1({ scope })
    if (recoverable?.safeToResume && recoverable.candidate) {
      return {
        candidate: recoverable.candidate,
        runId: recoverable.snapshot.run.id,
        busy: false,
        message: recoverable.adoptionPending
          ? '采纳意图已冻结；继续确认会沿原运行幂等收敛。'
          : '已恢复待确认文风候选；没有重复调用模型。',
        unsafeRunId: null,
        adoptionPending: !!recoverable.adoptionPending,
      }
    }
    if (recoverable && !recoverable.safeToResume) {
      return {
        ...emptyLane(),
        message: '上次学习停在模型结果不可判定窗口，系统不会自动重试。请先放弃旧运行。',
        unsafeRunId: recoverable.snapshot.run.id,
      }
    }
    return emptyLane()
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    generationRef.current++
    setLane(recoveringLane())
    void recover()
      .then(next => { if (!cancelled) setLane(next) })
      .catch(error => {
        if (!cancelled) {
          setLane(emptyLane())
          onErrorRef.current(`文风学习恢复失败：${messageOf(error)}。`)
        }
      })
    return () => { cancelled = true }
  }, [recover])

  const runRequest = useCallback(async (chapterIds: readonly number[], retrying = false) => {
    const current = laneRef.current
    if (!retrying && (current.busy || current.candidate || current.unsafeRunId != null)) return
    const token = ++generationRef.current
    setLane({ ...emptyLane(), busy: true, message: '正在从登记 Context 生成持久候选…' })
    try {
      const generated = await generateStyleLearningCandidateV1({
        scope: await resolveScopeLike(projectId),
        chapterIds,
        aiConfig,
      })
      if (generationRef.current !== token) return
      setLane({
        candidate: generated.candidate,
        runId: generated.snapshot.run.id,
        busy: false,
        message: '候选已持久化；确认前不会修改或开启正式文风画像。',
        unsafeRunId: null,
        adoptionPending: false,
      })
    } catch (error) {
      if (generationRef.current !== token) return
      const recovered = await recover().catch(() => emptyLane())
      const message = messageOf(error)
      setLane({ ...recovered, busy: false, message: recovered.message ?? message })
      onErrorRef.current(`文风学习失败：${message}。`)
    }
  }, [aiConfig, projectId, recover])

  const accept = useCallback(async () => {
    const current = laneRef.current
    if (current.busy || current.runId == null || !current.candidate) return
    setLane({ ...current, busy: true, message: '正在确认写入并执行终验…' })
    try {
      await adoptStyleLearningCandidateV1({
        scope: await resolveScopeLike(projectId),
        runId: current.runId,
      })
      await onCommittedRef.current()
      setLane({ ...emptyLane(), message: '文风画像已确认写入并完成终验。' })
    } catch (error) {
      const recovered = await recover().catch(() => current)
      const message = messageOf(error)
      setLane({ ...recovered, busy: false, message })
      onErrorRef.current(`文风画像确认失败：${message}。`)
    }
  }, [projectId, recover])

  const reject = useCallback(async () => {
    const current = laneRef.current
    if (current.busy || current.runId == null || !current.candidate || current.adoptionPending) return
    setLane({ ...current, busy: true })
    try {
      await rejectStyleLearningCandidateV1({
        scope: await resolveScopeLike(projectId),
        runId: current.runId,
      })
      setLane({ ...emptyLane(), message: '候选已拒绝；正式文风画像没有变化。' })
    } catch (error) {
      const message = messageOf(error)
      setLane({ ...current, busy: false, message })
      onErrorRef.current(`文风候选拒绝失败：${message}。`)
    }
  }, [projectId])

  const retry = useCallback(async () => {
    const current = laneRef.current
    if (!current.candidate || current.runId == null || current.busy || current.adoptionPending) return
    const chapterIds = current.candidate.request.chapterIds
    setLane({ ...current, busy: true, message: '正在拒绝旧候选…' })
    try {
      await rejectStyleLearningCandidateV1({
        scope: await resolveScopeLike(projectId),
        runId: current.runId,
      })
      setLane(emptyLane())
      await runRequest(chapterIds, true)
    } catch (error) {
      const message = messageOf(error)
      setLane({ ...current, busy: false, message })
      onErrorRef.current(`文风学习重试失败：${message}。`)
    }
  }, [projectId, runRequest])

  const abandonUnsafe = useCallback(async () => {
    const current = laneRef.current
    if (current.busy || current.unsafeRunId == null) return
    setLane({ ...current, busy: true })
    try {
      await abandonStyleLearningRunV1({
        scope: await resolveScopeLike(projectId),
        runId: current.unsafeRunId,
      })
      setLane({ ...emptyLane(), message: '已放弃结果不可判定的旧运行，可以重新学习。' })
    } catch (error) {
      const message = messageOf(error)
      setLane({ ...current, busy: false, message })
      onErrorRef.current(`文风学习旧运行放弃失败：${message}。`)
    }
  }, [projectId])

  return { lane, run: runRequest, accept, reject, retry, abandonUnsafe }
}
