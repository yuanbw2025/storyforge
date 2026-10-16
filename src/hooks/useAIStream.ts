import { useCallback, useMemo, useRef, useState } from 'react'
import { resolveRequestConfig, type StreamResult, type AIRequestConfigResolution } from '../lib/ai/client'
import {
  streamRegisteredAIEntryV1,
  type FormalAICallMetaV1,
} from '../lib/agent/formal-ai-entry'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../lib/ai/config-readiness'
import { useAIConfigStore } from '../stores/ai-config'
import {
  type AIGenerationSession,
  selectAIGenerationSession,
  useAIGenerationSessionStore,
} from '../stores/ai-generation-session'
import type { AIConfig, ChatMessage } from '../lib/types'
import type { TokenUsage } from '../lib/ai/logger'

export interface UseAIStreamReturn {
  /** 当前累积的输出文本 */
  output: string
  /** 是否正在生成 */
  isStreaming: boolean
  /** 错误信息 */
  error: string | null
  /** 本次生成的 token 用量（流结束后可用） */
  tokenUsage: TokenUsage | null
  /** 当前会话对应的操作类型，用于组件卸载后恢复正确的采纳/重试语义。 */
  operation: string | null
  /**
   * 开始流式生成。
   * @param messages 聊天消息
   * @param overrideConfig 临时覆盖的配置片段（例如导入面板需要 maxTokens=16384）
   */
  start: (messages: ChatMessage[], overrideConfig: Partial<AIConfig> | undefined, meta: FormalAICallMetaV1, resolution?: AIRequestConfigResolution, result?: StreamResult) => Promise<string>
  /** 停止生成 */
  stop: () => void
  /** 重置状态 */
  reset: () => void
  /** 设置当前会话的操作类型。 */
  setOperation: (operation: string | null) => void
  /** 从持久化候选恢复已完成输出；不会发起模型调用。 */
  restore: (session: Pick<AIGenerationSession, 'output' | 'operation'> & Partial<Pick<AIGenerationSession, 'error'>>) => void
}

const sharedAbortControllers = new Map<string, AbortController>()

/**
 * 流式 AI 输出 Hook
 * 封装 streamChat，提供 start/stop/reset 控制
 *
 * 传入 sessionKey 后，状态与请求控制器脱离组件生命周期：
 * 一级标签切换导致组件卸载时，生成仍继续，重新挂载可恢复输出。
 */
export function useAIStream(sessionKey?: string): UseAIStreamReturn {
  const [output, setOutput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null)
  const [operation, setLocalOperation] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sharedSession = useAIGenerationSessionStore(selectAIGenerationSession(sessionKey))

  const currentOutput = sessionKey ? sharedSession.output : output
  const currentIsStreaming = sessionKey ? sharedSession.isStreaming : isStreaming
  const currentError = sessionKey ? sharedSession.error : error
  const currentTokenUsage = sessionKey ? sharedSession.tokenUsage : tokenUsage
  const currentOperation = sessionKey ? sharedSession.operation : operation

  const patchShared = useCallback((patch: Partial<AIGenerationSession>) => {
    if (sessionKey) useAIGenerationSessionStore.getState().patchSession(sessionKey, patch)
  }, [sessionKey])

  const stop = useCallback(() => {
    if (sessionKey) {
      sharedAbortControllers.get(sessionKey)?.abort()
      sharedAbortControllers.delete(sessionKey)
      patchShared({ isStreaming: false })
      return
    }
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [sessionKey, patchShared])

  const reset = useCallback(() => {
    stop()
    if (sessionKey) {
      useAIGenerationSessionStore.getState().resetSession(sessionKey)
      return
    }
    setOutput('')
    setError(null)
    setTokenUsage(null)
    setLocalOperation(null)
  }, [sessionKey, stop])

  const setOperation = useCallback((nextOperation: string | null) => {
    if (sessionKey) {
      patchShared({ operation: nextOperation })
    } else {
      setLocalOperation(nextOperation)
    }
  }, [sessionKey, patchShared])

  const restore = useCallback((session: Pick<AIGenerationSession, 'output' | 'operation'> & Partial<Pick<AIGenerationSession, 'error'>>) => {
    stop()
    if (sessionKey) {
      patchShared({
        output: session.output,
        operation: session.operation,
        error: session.error ?? null,
        tokenUsage: null,
        isStreaming: false,
      })
      return
    }
    setOutput(session.output)
    setLocalOperation(session.operation)
    setError(session.error ?? null)
    setTokenUsage(null)
    setIsStreaming(false)
  }, [patchShared, sessionKey, stop])

  const start = useCallback(async (
    messages: ChatMessage[],
    overrideConfig: Partial<AIConfig> | undefined,
    meta: FormalAICallMetaV1,
    frozenResolution?: AIRequestConfigResolution,
    providedResult?: StreamResult,
  ): Promise<string> => {
    // 重置状态
    if (sessionKey) {
      sharedAbortControllers.get(sessionKey)?.abort()
      patchShared({ output: '', error: null, tokenUsage: null, isStreaming: true })
    } else {
      abortRef.current?.abort()
      setOutput('')
      setError(null)
      setTokenUsage(null)
      setIsStreaming(true)
    }

    const controller = new AbortController()
    if (sessionKey) sharedAbortControllers.set(sessionKey, controller)
    else abortRef.current = controller

    const baseConfig = useAIConfigStore.getState().config
    const config: AIConfig = overrideConfig
      ? { ...baseConfig, ...overrideConfig }
      : baseConfig
    meta = overrideConfig ? { ...meta, configOverrides: overrideConfig } : meta
    const effectiveConfig = (frozenResolution ?? resolveRequestConfig(config, meta)).config

    if (!isAIConfigReady(effectiveConfig)) {
      const errMsg = getAIConfigRequiredMessage(effectiveConfig)
      console.warn('[AI] 未配置可用 AI 服务，provider:', effectiveConfig.provider)
      if (sessionKey) {
        patchShared({ error: errMsg, isStreaming: false })
        sharedAbortControllers.delete(sessionKey)
      } else {
        setError(errMsg)
        setIsStreaming(false)
      }
      return ''
    }

    let accumulated = ''
    const streamResult: StreamResult = providedResult ?? {}
    delete streamResult.completion
    delete streamResult.finishReason
    delete streamResult.usage
    // A provider can deliver hundreds of deltas in one network read. Publishing
    // every delta to Zustand synchronously can exhaust React's nested-update
    // limit and cut off the model output. Coalesce only the view; retain every
    // character in the result returned to the durable generation controller.
    let publishTimer: ReturnType<typeof setTimeout> | null = null
    const ownsRequest = () => sessionKey
      ? sharedAbortControllers.get(sessionKey) === controller
      : abortRef.current === controller
    const publishOutput = () => {
      publishTimer = null
      if (controller.signal.aborted) return
      if (sessionKey) {
        if (sharedAbortControllers.get(sessionKey) === controller) patchShared({ output: accumulated })
      } else if (abortRef.current === controller) {
        setOutput(accumulated)
      }
    }

    try {
      const stream = streamRegisteredAIEntryV1(messages, config, meta, controller.signal, streamResult, frozenResolution)
      for await (const chunk of stream) {
        if (controller.signal.aborted) break
        accumulated += chunk
        if (sessionKey) {
          if (sharedAbortControllers.get(sessionKey) !== controller) break
        }
        if (publishTimer == null) publishTimer = setTimeout(publishOutput, 32)
      }
      if (controller.signal.aborted || !ownsRequest()) streamResult.completion = 'cancelled'
    } catch (err: unknown) {
      streamResult.completion = controller.signal.aborted || (err as Error).name === 'AbortError' ? 'cancelled' : 'failed'
      if ((err as Error).name === 'AbortError') {
        // 用户主动停止，不算错误
      } else if (!controller.signal.aborted && ownsRequest()) {
        const errMsg = err instanceof Error ? err.message : '未知错误'
        if (sessionKey) patchShared({ error: errMsg })
        else setError(errMsg)
      }
    } finally {
      if (publishTimer != null) clearTimeout(publishTimer)
      publishOutput()
      if (sessionKey) {
        // 同一会话可能已被重试；旧请求不得覆盖新请求状态。
        if (sharedAbortControllers.get(sessionKey) === controller) {
          sharedAbortControllers.delete(sessionKey)
          patchShared({
            isStreaming: false,
            ...(streamResult.usage ? { tokenUsage: streamResult.usage } : {}),
          })
        }
      } else if (ownsRequest()) {
        setIsStreaming(false)
        abortRef.current = null
        // 流结束后写入 token 用量（若 provider 返回了 usage）
        if (streamResult.usage) {
          setTokenUsage(streamResult.usage)
        }
      }
    }

    return accumulated
  }, [sessionKey, patchShared])

  return useMemo(
    () => ({
      output: currentOutput,
      isStreaming: currentIsStreaming,
      error: currentError,
      tokenUsage: currentTokenUsage,
      operation: currentOperation,
      start,
      stop,
      reset,
      setOperation,
      restore,
    }),
    [
      currentOutput,
      currentIsStreaming,
      currentError,
      currentTokenUsage,
      currentOperation,
      start,
      stop,
      reset,
      setOperation,
      restore,
    ],
  )
}
