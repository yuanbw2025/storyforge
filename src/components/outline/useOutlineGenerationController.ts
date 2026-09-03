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
import type { GenerationMode, ChunkedGenerationConfig } from '../../lib/outline/generation-modes'
import type { AssembleContextResult } from '../../lib/registry/types'
import {
  adoptOutlineGenerationCandidateV1,
  createOutlineGenerationTraceV1,
  rejectOutlineGenerationCandidateV1,
  recoverPendingOutlineGenerationAdoptionsV1,
  restoreLatestOutlineGenerationCandidateV1,
  staleOutlineGenerationCandidateV1,
  type OutlineGenerationTraceV1,
  type OutlineGenerationCandidateV1,
  type OutlineGenerationAdoptionIntentV1,
} from '../../lib/outline/harness'
import type { ChatMessage, OutlineNode, Project } from '../../lib/types'
import type { AgentExecutionBoundaryV1 } from '../../lib/types'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import {
  assertWorkspaceContentRevisionFreshV1,
  captureWorkspaceContentRevisionV1,
  type WorkspaceContentRevisionVectorV1,
} from '../../lib/authoring/content-revision'
import { resolveScopeLike } from '../../lib/workspace/scope'

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
    request: OutlineGenerationRequest,
    worldGroupId: number | null,
    outlineNodeId?: number | null,
    priorOutlineCandidateText?: string,
  ) => Promise<AssembleContextResult>
  openPromptPanel: () => void
  clearPreview: () => void
  onInfo: (message: string) => void
  onError: (message: string) => void
  onOutlineRecovered?: () => Promise<void>
  executionBoundary?: AgentExecutionBoundaryV1
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
  executionBoundary = 'formal',
}: Options) {
  const [activeModuleKey, setActiveModuleKey] = useState<'outline.volume' | 'outline.chapter'>('outline.volume')
  const [pendingRequest, setPendingRequest] = useState<OutlineGenerationRequest | null>(null)
  const [preparedContext, setPreparedContext] = useState<PreparedGenerationContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState('')
  const [transparentMode, setTransparentModeState] = useState(false)
  const [promptReviewOpen, setPromptReviewOpen] = useState(false)
  const [activeCandidate, setActiveCandidate] = useState<OutlineGenerationCandidateV1 | null>(null)
  const [adoptionRecoveryRequired, setAdoptionRecoveryRequired] = useState(false)
  const contextRequestRef = useRef(0)
  const restoreProjectRef = useRef<number | null>(null)
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
    contentRevisionSnapshot?: WorkspaceContentRevisionVectorV1,
  ) => {
    try {
      await flushPendingEditsV1()
    } catch (error) {
      onError(error instanceof Error ? error.message : '作者编辑保存失败，已阻止正式生成。')
      return
    }
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
        setAdoptionRecoveryRequired(false)
      } catch (error) {
        ai.reset()
        onError(`旧候选无法安全标旧，已阻止新生成：${error instanceof Error ? error.message : '未知错误'}。`)
        return
      }
    }
    setActiveModuleKey(outlineGenerationModuleKey(request))
    ai.setOperation(encodeGenerationOperation(request))
    clearPreview()

    let generationTrace: OutlineGenerationTraceV1 | undefined
    try {
      const targetVolume = findGenerationTargetVolume(request, nodes, volumes)
      const targetWorldGroupId = targetVolume?.worldGroupId ?? null
      const scope = await resolveScopeLike(project.id!)
      const contentRevision = contentRevisionSnapshot ?? await captureWorkspaceContentRevisionV1({
        scope,
        worldGroupId: targetWorldGroupId,
      })
      const assembled = contextSnapshot
        ?? await assembleContext(request, targetWorldGroupId, targetVolume?.id)
      await assertWorkspaceContentRevisionFreshV1(contentRevision, {
        scope,
        worldGroupId: targetWorldGroupId,
      })
      const node = buildNode(request)
      const prepared = preparedSnapshot ?? prepareGenerationNode(node, assembled)
      generationTrace = await createOutlineGenerationTraceV1({
        projectId: project.id!,
        worldGroupId: targetWorldGroupId,
        request,
        assembled,
        executionBoundary,
        contentRevision,
      })
      const result = await runGenerationNode(node, prepared, {
        messages: messageOverride,
        shadowTrace: generationTrace,
        traceFailureMode: executionBoundary === 'formal' ? 'throw' : 'ignore',
      })
      if (result.gate?.status === 'blocked') {
        await generationTrace?.terminateRun({
          status: 'failed',
          code: result.gate.issues.map(issue => issue.code).join(',') || 'outline_generation_gate_blocked',
        })
      }
      if (result.gate?.status !== 'blocked' && result.output.trim()) {
        const candidate = await generationTrace.persistCandidate(result.output)
        if (executionBoundary === 'formal' && !candidate) {
          throw new Error('正式大纲结果缺少 durable candidate，已阻止预览与采纳。')
        }
        setActiveCandidate(candidate)
        setAdoptionRecoveryRequired(false)
      }
    } catch (error) {
      if (error instanceof OutlineGenerationSkipError) {
        ai.reset()
        if (error.message.includes('无需继续生成')) onInfo(error.message)
        else onError(error.message)
        return
      }
      let terminationError: unknown
      try {
        await generationTrace?.terminateRun({
          status: error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed',
          code: error instanceof Error ? error.message : 'outline_generation_failed',
        })
      } catch (traceError) {
        terminationError = traceError
      }
      console.error('[Outline] 准备生成失败:', error)
      ai.reset()
      const primary = error instanceof Error ? error.message : '未知错误'
      const suffix = terminationError
        ? `；终止证据也未能写入：${terminationError instanceof Error ? terminationError.message : '未知错误'}`
        : ''
      onError(`准备大纲生成时出错：${primary}${suffix}。`)
    }
  }, [activeCandidate, ai, assembleContext, buildNode, clearPreview, executionBoundary, nodes, onError, onInfo, project.id, volumes])

  useEffect(() => {
    if (project.id == null || ai.isStreaming || restoreProjectRef.current === project.id) return
    restoreProjectRef.current = project.id
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
        setAdoptionRecoveryRequired(false)
        const request = decodeGenerationOperation(candidate.operation)
        if (request) setActiveModuleKey(outlineGenerationModuleKey(request))
        if (!callbacks.ai.output) {
          callbacks.ai.restore({ output: candidate.output, operation: candidate.operation })
          callbacks.onInfo('已恢复刷新前尚未确认的大纲候选。')
        }
      }
    })()
      .catch(error => {
        const message = error instanceof Error ? error.message : '未知错误'
        restoreCallbacksRef.current.onError(`大纲 durable 恢复失败：${message}。请勿重复采纳，保留项目以供诊断。`)
      })
    return () => { cancelled = true }
  }, [ai.isStreaming, executionBoundary, project.id])

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
      await flushPendingEditsV1()
      const targetVolume = findGenerationTargetVolume(request, nodes, volumes)
      const targetWorldGroupId = targetVolume?.worldGroupId ?? null
      const scope = await resolveScopeLike(project.id!)
      const contentRevision = await captureWorkspaceContentRevisionV1({
        scope,
        worldGroupId: targetWorldGroupId,
      })
      const assembled = await assembleContext(
        request,
        targetWorldGroupId,
        targetVolume?.id,
      )
      await assertWorkspaceContentRevisionFreshV1(contentRevision, {
        scope,
        worldGroupId: targetWorldGroupId,
      })
      if (contextRequestRef.current !== requestId) return
      setPreparedContext({ operation, assembled, contentRevision })
    } catch (error) {
      if (contextRequestRef.current !== requestId) return
      setContextError(error instanceof Error ? error.message : '未知错误')
    } finally {
      if (contextRequestRef.current === requestId) setContextLoading(false)
    }
  }, [assembleContext, clearPreview, nodes, openPromptPanel, project.id, volumes])

  const cancel = useCallback(() => {
    contextRequestRef.current += 1
    setPendingRequest(null)
    setPreparedContext(null)
    setContextLoading(false)
    setContextError('')
    setTransparentModeState(false)
    setPromptReviewOpen(false)
  }, [])

  const confirm = useCallback(async (mode?: GenerationMode, chunkedConfig?: ChunkedGenerationConfig) => {
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
    const request = pendingRequest.kind === 'chapters'
      ? { ...pendingRequest, mode, chunkedConfig }
      : pendingRequest
    setPendingRequest(null)
    setPreparedContext(null)
    await execute(
      request,
      contextSnapshot,
      preparedNodeResult.prepared,
      undefined,
      preparedContext!.contentRevision,
    )
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
      preparedContext!.contentRevision,
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

  const adoptCandidate = useCallback(async (intent: OutlineGenerationAdoptionIntentV1) => {
    const candidate = activeCandidate
    if (!candidate) throw new Error('当前没有可采纳的 durable 大纲候选')
    if (executionBoundary !== 'formal') throw new Error(`${executionBoundary} 大纲结果不可采纳`)
    try {
      const result = await adoptOutlineGenerationCandidateV1({ candidate, intent })
      setActiveCandidate(null)
      setAdoptionRecoveryRequired(false)
      return result
    } catch (error) {
      setAdoptionRecoveryRequired(true)
      throw error
    }
  }, [activeCandidate, executionBoundary])

  const failAdoption = useCallback(async (reason: string) => {
    const candidate = activeCandidate
    if (!candidate) return
    if (adoptionRecoveryRequired) {
      onError('该大纲采纳已进入恢复态，不能拒绝或覆盖；请刷新页面执行同一 Run 的幂等恢复。')
      return
    }
    try {
      await rejectOutlineGenerationCandidateV1(candidate, reason)
    } catch (error) {
      console.warn('[Outline Harness] 采纳失败事件记录失败。', error)
    } finally {
      setActiveCandidate(null)
    }
  }, [activeCandidate, adoptionRecoveryRequired, onError])

  const dismissCandidate = useCallback(async () => {
    const candidate = activeCandidate
    if (adoptionRecoveryRequired) {
      onError('该大纲采纳已进入恢复态，不能关闭并丢弃；请刷新页面完成恢复。')
      return
    }
    if (candidate) {
      try {
        await rejectOutlineGenerationCandidateV1(candidate, '作者关闭了本次大纲候选，没有写入项目。')
      } catch (error) {
        console.warn('[Outline Harness] 候选关闭事件记录失败。', error)
      }
    }
    setActiveCandidate(null)
    clearPreview()
    ai.reset()
  }, [activeCandidate, adoptionRecoveryRequired, ai, clearPreview, onError])

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
    canAdopt: executionBoundary === 'formal' && activeCandidate != null && !adoptionRecoveryRequired,
    adoptionRecoveryRequired,
    adoptCandidate,
    failAdoption,
    dismissCandidate,
  }
}
