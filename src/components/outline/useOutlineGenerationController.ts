import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UseAIStreamReturn } from '../../hooks/useAIStream'
import type { RunOptions } from '../../lib/ai/adapters/outline-adapter'
import {
  prepareGenerationNode,
  runGenerationNode,
  type PreparedGenerationNode,
} from '../../lib/generation/generation-node'
import {
  findGenerationTargetVolume,
  outlineGenerationTargetError,
} from '../../lib/outline/generation-plan'
import {
  createOutlineGenerationNode,
  OutlineGenerationSkipError,
} from '../../lib/outline/generation-node'
import {
  decodeGenerationOperation,
  encodeGenerationOperation,
  outlineGenerationModuleKey,
  type OutlineGenerationRequest,
  type PreparedGenerationContext,
} from '../../lib/outline/generation-request'
import type { AssembleContextResult } from '../../lib/registry/types'
import {
  beginOutlineGenerationAdoptionV1,
  commitOutlineGenerationAdoptionV1,
  createOutlineGenerationTraceV1,
  isOutlineDurableHarnessEnabledV1,
  rejectOutlineGenerationCandidateV1,
  recoverPendingOutlineGenerationAdoptionsV1,
  restoreLatestOutlineGenerationCandidateV1,
  staleOutlineGenerationCandidateV1,
  type OutlineGenerationCandidateV1,
  type OutlineGenerationAdoptionIntentV1,
} from '../../lib/outline/harness'
import type { ChatMessage, OutlineNode, Project } from '../../lib/types'

type GenerationAI = Pick<
  UseAIStreamReturn,
  'isStreaming' | 'operation' | 'output' | 'reset' | 'restore' | 'setOperation' | 'start'
>

interface Options {
  project: Project
  nodes: OutlineNode[]
  volumes: OutlineNode[]
  hint: string
  runOptions: RunOptions
  ai: GenerationAI
  assembleContext: (
    worldGroupId: number | null,
    outlineNodeId?: number | null,
  ) => Promise<AssembleContextResult>
  openPromptPanel: () => void
  clearPreview: () => void
  onInfo: (message: string) => void
  onError: (message: string) => void
  onOutlineRecovered?: () => Promise<void>
}

export function useOutlineGenerationController({
  project,
  nodes,
  volumes,
  hint,
  runOptions,
  ai,
  assembleContext,
  openPromptPanel,
  clearPreview,
  onInfo,
  onError,
  onOutlineRecovered,
}: Options) {
  const [activeModuleKey, setActiveModuleKey] = useState<'outline.volume' | 'outline.chapter'>('outline.volume')
  const [pendingRequest, setPendingRequest] = useState<OutlineGenerationRequest | null>(null)
  const [preparedContext, setPreparedContext] = useState<PreparedGenerationContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState('')
  const [transparentMode, setTransparentModeState] = useState(false)
  const [promptReviewOpen, setPromptReviewOpen] = useState(false)
  const [activeCandidate, setActiveCandidate] = useState<OutlineGenerationCandidateV1 | null>(null)
  const contextRequestRef = useRef(0)
  const restoreProjectRef = useRef<number | null>(null)
  const activeAdoptionIntentRef = useRef<OutlineGenerationAdoptionIntentV1 | null>(null)
  const restoreCallbacksRef = useRef({ ai, onError, onInfo, onOutlineRecovered })
  restoreCallbacksRef.current = { ai, onError, onInfo, onOutlineRecovered }

  const moduleKey: 'outline.volume' | 'outline.chapter' = pendingRequest
    ? outlineGenerationModuleKey(pendingRequest)
    : ai.operation?.startsWith('outline.chapter')
      ? 'outline.chapter'
      : ai.operation?.startsWith('outline.volume')
        ? 'outline.volume'
        : activeModuleKey

  const buildNode = useCallback((request: OutlineGenerationRequest) => (
    createOutlineGenerationNode({
      request,
      project,
      nodes,
      volumes,
      hint,
      runOptions,
      ai,
    })
  ), [ai, hint, nodes, project, runOptions, volumes])

  const preparedNodeResult = useMemo<{
    prepared: PreparedGenerationNode | null
    error: string
  }>(() => {
    if (!pendingRequest || !preparedContext) return { prepared: null, error: '' }
    if (preparedContext.operation !== encodeGenerationOperation(pendingRequest)) {
      return { prepared: null, error: '' }
    }
    try {
      return {
        prepared: prepareGenerationNode(
          buildNode(pendingRequest),
          preparedContext.assembled,
        ),
        error: '',
      }
    } catch (error) {
      return {
        prepared: null,
        error: error instanceof Error ? error.message : '无法装配最终提示词',
      }
    }
  }, [buildNode, pendingRequest, preparedContext])

  const execute = useCallback(async (
    request: OutlineGenerationRequest,
    contextSnapshot?: AssembleContextResult | null,
    preparedSnapshot?: PreparedGenerationNode | null,
    messageOverride?: ChatMessage[],
  ) => {
    const targetError = outlineGenerationTargetError(request, nodes, volumes)
    if (targetError) {
      ai.reset()
      onError(targetError)
      return
    }

    if (activeCandidate) {
      try {
        await staleOutlineGenerationCandidateV1(activeCandidate)
        setActiveCandidate(null)
        activeAdoptionIntentRef.current = null
      } catch (error) {
        console.warn('[Outline Harness] 旧候选标旧失败，新生成仍按原路径继续。', error)
      }
    }
    setActiveModuleKey(outlineGenerationModuleKey(request))
    ai.setOperation(encodeGenerationOperation(request))
    clearPreview()

    try {
      const targetVolume = findGenerationTargetVolume(request, nodes, volumes)
      const assembled = contextSnapshot
        ?? await assembleContext(targetVolume?.worldGroupId ?? null, targetVolume?.id)
      const node = buildNode(request)
      const prepared = preparedSnapshot ?? prepareGenerationNode(node, assembled)
      const generationTrace = await createOutlineGenerationTraceV1({
        projectId: project.id!,
        worldGroupId: targetVolume?.worldGroupId ?? null,
        request,
        assembled,
      }).catch(error => {
        console.warn('[Outline Harness] 运行追踪不可用，本次继续沿原生成路径。', error)
        return undefined
      })
      if (generationTrace?.initializationError) {
        console.warn('[Outline Harness] durable 账本不可用，已降级为内存影子。', generationTrace.initializationError)
      }
      const result = await runGenerationNode(node, prepared, {
        messages: messageOverride,
        shadowTrace: generationTrace,
      })
      if (result.gate?.status !== 'blocked' && result.output.trim()) {
        try {
          const candidate = await generationTrace?.persistCandidate(result.output)
          if (candidate) setActiveCandidate(candidate)
        } catch (error) {
          console.warn('[Outline Harness] 候选持久化失败，本次结果仍保留在原预览。', error)
        }
      }
    } catch (error) {
      if (error instanceof OutlineGenerationSkipError) {
        ai.reset()
        if (error.message.includes('无需继续生成')) onInfo(error.message)
        else onError(error.message)
        return
      }
      console.error('[Outline] 准备生成失败:', error)
      ai.reset()
      onError(`准备大纲生成时出错：${error instanceof Error ? error.message : '未知错误'}。`)
    }
  }, [activeCandidate, ai, assembleContext, buildNode, clearPreview, nodes, onError, onInfo, project.id, volumes])

  useEffect(() => {
    if (project.id == null || ai.isStreaming || restoreProjectRef.current === project.id) return
    restoreProjectRef.current = project.id
    if (!isOutlineDurableHarnessEnabledV1()) return
    let cancelled = false
    void (async () => {
      const recovery = await recoverPendingOutlineGenerationAdoptionsV1(project.id!)
      if (cancelled) return
      const callbacks = restoreCallbacksRef.current
      if (recovery.recoveredRunIds.length > 0) {
        await callbacks.onOutlineRecovered?.()
        callbacks.onInfo(`已恢复 ${recovery.recoveredRunIds.length} 个确认后中断的大纲写入。`)
      }
      if (recovery.failed.length > 0) {
        callbacks.onError(`有 ${recovery.failed.length} 个已确认的大纲写入无法自动恢复，请保留当前项目并查看诊断。`)
      }
      const candidate = await restoreLatestOutlineGenerationCandidateV1(project.id!)
      if (!cancelled && candidate) {
        setActiveCandidate(candidate)
        const request = decodeGenerationOperation(candidate.operation)
        if (request) setActiveModuleKey(outlineGenerationModuleKey(request))
        if (!callbacks.ai.output) {
          callbacks.ai.restore({ output: candidate.output, operation: candidate.operation })
          callbacks.onInfo('已恢复刷新前尚未确认的大纲候选。')
        }
      }
    })()
      .catch(error => {
        console.warn('[Outline Harness] 未能恢复持久化候选，已保持原界面状态。', error)
      })
    return () => { cancelled = true }
  }, [ai.isStreaming, project.id])

  const prepare = useCallback(async (request: OutlineGenerationRequest) => {
    const requestId = contextRequestRef.current + 1
    contextRequestRef.current = requestId
    const operation = encodeGenerationOperation(request)
    setActiveModuleKey(outlineGenerationModuleKey(request))
    setPendingRequest(request)
    setPreparedContext(null)
    setContextLoading(true)
    setContextError('')
    setTransparentModeState(false)
    setPromptReviewOpen(false)
    openPromptPanel()
    clearPreview()

    try {
      const targetVolume = findGenerationTargetVolume(request, nodes, volumes)
      const assembled = await assembleContext(
        targetVolume?.worldGroupId ?? null,
        targetVolume?.id,
      )
      if (contextRequestRef.current !== requestId) return
      setPreparedContext({ operation, assembled })
    } catch (error) {
      if (contextRequestRef.current !== requestId) return
      setContextError(error instanceof Error ? error.message : '未知错误')
    } finally {
      if (contextRequestRef.current === requestId) setContextLoading(false)
    }
  }, [assembleContext, clearPreview, nodes, openPromptPanel, volumes])

  const cancel = useCallback(() => {
    contextRequestRef.current += 1
    setPendingRequest(null)
    setPreparedContext(null)
    setContextLoading(false)
    setContextError('')
    setTransparentModeState(false)
    setPromptReviewOpen(false)
  }, [])

  const confirm = useCallback(async () => {
    if (!pendingRequest || contextLoading || contextError || preparedNodeResult.error) return
    const operation = encodeGenerationOperation(pendingRequest)
    const contextSnapshot = preparedContext?.operation === operation
      ? preparedContext.assembled
      : null
    if (!contextSnapshot || !preparedNodeResult.prepared) return
    if (transparentMode) {
      setPromptReviewOpen(true)
      return
    }
    const request = pendingRequest
    setPendingRequest(null)
    setPreparedContext(null)
    await execute(request, contextSnapshot, preparedNodeResult.prepared)
  }, [
    contextError,
    contextLoading,
    execute,
    pendingRequest,
    preparedContext,
    preparedNodeResult,
    transparentMode,
  ])

  const confirmMessages = useCallback(async (messages: ChatMessage[]) => {
    if (!pendingRequest || !promptReviewOpen || !preparedNodeResult.prepared) return
    const operation = encodeGenerationOperation(pendingRequest)
    const contextSnapshot = preparedContext?.operation === operation
      ? preparedContext.assembled
      : null
    if (!contextSnapshot) return
    const request = pendingRequest
    setPromptReviewOpen(false)
    setPendingRequest(null)
    setPreparedContext(null)
    await execute(
      request,
      contextSnapshot,
      preparedNodeResult.prepared,
      messages,
    )
  }, [
    execute,
    pendingRequest,
    preparedContext,
    preparedNodeResult,
    promptReviewOpen,
  ])

  const setTransparentMode = useCallback((enabled: boolean) => {
    setTransparentModeState(enabled)
    setPromptReviewOpen(false)
  }, [])

  const retry = useCallback(async () => {
    const request = decodeGenerationOperation(ai.operation)
    if (request) await execute(request)
  }, [ai.operation, execute])

  const beginAdoption = useCallback(async (intent: OutlineGenerationAdoptionIntentV1) => {
    if (!activeCandidate) return
    activeAdoptionIntentRef.current = intent
    try {
      await beginOutlineGenerationAdoptionV1(activeCandidate, intent)
    } catch (error) {
      console.warn('[Outline Harness] 采纳开始事件记录失败，正式采纳仍按原入口继续。', error)
    }
  }, [activeCandidate])

  const completeAdoption = useCallback(async (evidence: unknown) => {
    const candidate = activeCandidate
    if (!candidate) return
    try {
      await commitOutlineGenerationAdoptionV1(
        candidate,
        evidence,
        activeAdoptionIntentRef.current ?? undefined,
      )
    } catch (error) {
      console.warn('[Outline Harness] 采纳提交证据记录失败，已写入的大纲不受影响。', error)
    } finally {
      setActiveCandidate(null)
      activeAdoptionIntentRef.current = null
    }
  }, [activeCandidate])

  const failAdoption = useCallback(async (reason: string) => {
    const candidate = activeCandidate
    if (!candidate) return
    try {
      await rejectOutlineGenerationCandidateV1(candidate, reason)
    } catch (error) {
      console.warn('[Outline Harness] 采纳失败事件记录失败。', error)
    } finally {
      setActiveCandidate(null)
      activeAdoptionIntentRef.current = null
    }
  }, [activeCandidate])

  const dismissCandidate = useCallback(async () => {
    const candidate = activeCandidate
    if (candidate) {
      try {
        await rejectOutlineGenerationCandidateV1(candidate, '作者关闭了本次大纲候选，没有写入项目。')
      } catch (error) {
        console.warn('[Outline Harness] 候选关闭事件记录失败。', error)
      }
    }
    setActiveCandidate(null)
    activeAdoptionIntentRef.current = null
    clearPreview()
    ai.reset()
  }, [activeCandidate, ai, clearPreview])

  return {
    moduleKey,
    pendingRequest,
    preparedContext,
    preparedNode: preparedNodeResult.prepared,
    contextLoading,
    contextError: contextError || preparedNodeResult.error,
    transparentMode,
    promptReviewOpen,
    prepare,
    cancel,
    confirm,
    confirmMessages,
    closePromptReview: () => setPromptReviewOpen(false),
    setTransparentMode,
    retry,
    beginAdoption,
    completeAdoption,
    failAdoption,
    dismissCandidate,
  }
}
