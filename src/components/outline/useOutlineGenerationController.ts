import { useCallback, useMemo, useRef, useState } from 'react'
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
import { createOutlineGenerationShadowTraceV1 } from '../../lib/outline/harness'
import type { ChatMessage, OutlineNode, Project } from '../../lib/types'

type GenerationAI = Pick<
  UseAIStreamReturn,
  'operation' | 'reset' | 'setOperation' | 'start'
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
}: Options) {
  const [activeModuleKey, setActiveModuleKey] = useState<'outline.volume' | 'outline.chapter'>('outline.volume')
  const [pendingRequest, setPendingRequest] = useState<OutlineGenerationRequest | null>(null)
  const [preparedContext, setPreparedContext] = useState<PreparedGenerationContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState('')
  const [transparentMode, setTransparentModeState] = useState(false)
  const [promptReviewOpen, setPromptReviewOpen] = useState(false)
  const contextRequestRef = useRef(0)

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
    setActiveModuleKey(outlineGenerationModuleKey(request))
    ai.setOperation(encodeGenerationOperation(request))
    clearPreview()

    const targetError = outlineGenerationTargetError(request, nodes, volumes)
    if (targetError) {
      ai.reset()
      onError(targetError)
      return
    }

    try {
      const targetVolume = findGenerationTargetVolume(request, nodes, volumes)
      const assembled = contextSnapshot
        ?? await assembleContext(targetVolume?.worldGroupId ?? null, targetVolume?.id)
      const node = buildNode(request)
      const prepared = preparedSnapshot ?? prepareGenerationNode(node, assembled)
      const shadowTrace = await createOutlineGenerationShadowTraceV1({
        projectId: project.id!,
        worldGroupId: targetVolume?.worldGroupId ?? null,
        request,
        assembled,
      }).catch(error => {
        console.warn('[Outline Harness shadow] 无法建立影子运行，不影响本次生成。', error)
        return undefined
      })
      await runGenerationNode(node, prepared, { messages: messageOverride, shadowTrace })
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
  }, [ai, assembleContext, buildNode, clearPreview, nodes, onError, onInfo, project.id, volumes])

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
  }
}
