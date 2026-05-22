import { useCallback, useRef, useState, useMemo } from 'react'
import { streamChat, type StreamResult } from '../lib/ai/client'
import { useAIConfigStore } from '../stores/ai-config'
import type { AIConfig, ChatMessage } from '../lib/types'
import type { TokenUsage } from '../lib/ai/logger'

export interface UseAIStreamReturn {
  output: string
  isStreaming: boolean
  error: string | null
  tokenUsage: TokenUsage | null
  start: (messages: ChatMessage[], overrideConfig?: Partial<AIConfig>) => Promise<string>
  stop: () => void
  reset: () => void
}

export function useAIStream(): UseAIStreamReturn {
  const [output, setOutput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
  }, [])

  const reset = useCallback(() => {
    // 🔒 只有在运行中或有状态时才执行物理 abort，防止空震荡
    abortRef.current?.abort()
    abortRef.current = null
    setOutput('')
    setError(null)
    setTokenUsage(null)
    setIsStreaming(false)
  }, [])

  const start = useCallback(async (
    messages: ChatMessage[],
    overrideConfig?: Partial<AIConfig>,
  ): Promise<string> => {
    setOutput('')
    setError(null)
    setTokenUsage(null)
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    const baseConfig = useAIConfigStore.getState().config
    const config: AIConfig = overrideConfig
      ? { ...baseConfig, ...overrideConfig }
      : baseConfig

    if (!config.apiKey) {
      const errMsg = '请先在左侧栏底部「⚙️ 设置」中配置 AI API Key，选择服务商并填入密钥'
      setError(errMsg)
      setIsStreaming(false)
      return ''
    }

    let accumulated = ''
    const streamResult: StreamResult = {}

    try {
      const stream = streamChat(messages, config, controller.signal, streamResult)
      for await (const chunk of stream) {
        if (controller.signal.aborted) break
        accumulated += chunk
        setOutput(accumulated)
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        const errMsg = err instanceof Error ? err.message : '未知错误'
        setError(errMsg)
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
      if (streamResult.usage) {
        setTokenUsage(streamResult.usage)
      }
    }

    return accumulated
  }, [])

  // 🟢 核心补丁：利用 useMemo 彻底封印指针漂移，绝缘全站重渲噪音
  return useMemo(() => ({
    output, isStreaming, error, tokenUsage, start, stop, reset
  }), [output, isStreaming, error, tokenUsage, start, stop, reset])
}