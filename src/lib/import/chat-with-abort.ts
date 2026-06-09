/**
 * 带 AbortSignal 支持的非流式 chat 调用。
 *
 * 原本在 pipeline.ts 内部。为了让 character-merge.ts 也能复用同一份取消逻辑，
 * 抽到这里。非流式 chat() 已把 signal 传给 fetch,取消会真正中断请求。
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
  return await chat(messages, config, undefined, signal)
}
