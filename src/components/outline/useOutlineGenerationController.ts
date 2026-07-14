import { useCallback, useRef, useState } from 'react'
import type { UseAIStreamReturn } from '../../hooks/useAIStream'
import type { RunOptions } from '../../lib/ai/adapters/outline-adapter'
import {
  buildOutlineGenerationPlan,
  findGenerationTargetVolume,
  outlineGenerationTargetError,
} from '../../lib/outline/generation-plan'
import {
  decodeGenerationOperation,
  encodeGenerationOperation,
  outlineGenerationModuleKey,
  type OutlineGenerationRequest,
  type PreparedGenerationContext,
} from '../../lib/outline/generation-request'
import type { AssembleContextResult } from '../../lib/registry/types'
import type { OutlineNode, Project } from '../../lib/types'

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
  const contextRequestRef = useRef(0)

  const moduleKey: 'outline.volume' | 'outline.chapter' = pendingRequest
    ? outlineGenerationModuleKey(pendingRequest)
    : ai.operation?.startsWith('outline.chapter')
      ? 'outline.chapter'
      : ai.operation?.startsWith('outline.volume')
        ? 'outline.volume'
        : activeModuleKey

  const execute = useCallback(async (
    request: OutlineGenerationRequest,
    contextSnapshot?: AssembleContextResult | null,
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
      const plan = buildOutlineGenerationPlan({
        request,
        project,
        nodes,
        volumes,
        assembled,
        hint,
        options: runOptions,
      })
      if (plan.status === 'skip') {
        ai.reset()
        if (plan.reason.includes('无需继续生成')) onInfo(plan.reason)
        else onError(plan.reason)
        return
      }
      if (plan.category === 'outline.volume') {
        await ai.start(plan.messages, undefined, { category: 'outline.volume', projectId: project.id! })
      } else {
        await ai.start(plan.messages, undefined, { category: 'outline.chapter', projectId: project.id! })
      }
    } catch (error) {
      console.error('[Outline] 准备生成失败:', error)
      ai.reset()
      onError(`准备大纲生成时出错：${error instanceof Error ? error.message : '未知错误'}。`)
    }
  }, [ai, assembleContext, clearPreview, hint, nodes, onError, onInfo, project, runOptions, volumes])

  const prepare = useCallback(async (request: OutlineGenerationRequest) => {
    const requestId = contextRequestRef.current + 1
    contextRequestRef.current = requestId
    const operation = encodeGenerationOperation(request)
    setActiveModuleKey(outlineGenerationModuleKey(request))
    setPendingRequest(request)
    setPreparedContext(null)
    setContextLoading(true)
    setContextError('')
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
  }, [])

  const confirm = useCallback(async () => {
    if (!pendingRequest || contextLoading || contextError) return
    const operation = encodeGenerationOperation(pendingRequest)
    const contextSnapshot = preparedContext?.operation === operation
      ? preparedContext.assembled
      : null
    if (!contextSnapshot) return
    const request = pendingRequest
    setPendingRequest(null)
    setPreparedContext(null)
    await execute(request, contextSnapshot)
  }, [contextError, contextLoading, execute, pendingRequest, preparedContext])

  const retry = useCallback(async () => {
    const request = decodeGenerationOperation(ai.operation)
    if (request) await execute(request)
  }, [ai.operation, execute])

  return {
    moduleKey,
    pendingRequest,
    preparedContext,
    contextLoading,
    contextError,
    prepare,
    cancel,
    confirm,
    retry,
  }
}
