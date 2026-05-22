/**
 * 带 AbortSignal 支持的非流式 chat 调用。
 *
 * 原本在 pipeline.ts 内部。为了让 character-merge.ts 也能复用同一份取消逻辑，
 * 抽到这里。逻辑本身很短：用 Promise.race 让 chat() 响应 abort。
 */

import { chat } from '../ai/client'
import type { AIConfig, ChatMessage } from '../types'

export async function chatWithAbort(
  messages: ChatMessage[],
  config: AIConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    const e = new Error('aborted')
    e.name = 'AbortError'
    throw e
  }
  // 用 chat() 非流式（流式取消处理稍麻烦；解析任务不需要 token-by-token）
  // 用 Promise.race 监听 abort
  return await Promise.race([
    chat(messages, config),
    new Promise<string>((_, reject) => {
      if (!signal) return
      const onAbort = () => {
        const e = new Error('aborted')
        e.name = 'AbortError'
        reject(e)
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }),
  ])
}
