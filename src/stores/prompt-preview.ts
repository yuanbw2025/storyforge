/**
 * PIPELINE-1 · 发送前预览门闩的命令式 API
 *
 * 任意生成入口可 `await maybePreviewMessages(messages)`：
 * - 未开开关 → 原样返回 messages
 * - 开了开关 → 弹出 PromptPreviewGate，确认返回编辑后 messages，取消返回 null
 */

import { create } from 'zustand'
import type { ChatMessage } from '../lib/types'
import {
  readPromptPreviewEnabled,
  writePromptPreviewEnabled,
} from '../lib/ai/prompt-preview'

export interface PromptPreviewRequest {
  messages: ChatMessage[]
  title?: string
  subtitle?: string
  resolve: (result: ChatMessage[] | null) => void
}

interface PromptPreviewStore {
  pending: PromptPreviewRequest | null
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  open: (req: Omit<PromptPreviewRequest, 'resolve'>) => Promise<ChatMessage[] | null>
  settle: (result: ChatMessage[] | null) => void
}

export const usePromptPreviewStore = create<PromptPreviewStore>((set, get) => ({
  pending: null,
  enabled: typeof localStorage !== 'undefined' ? readPromptPreviewEnabled() : false,
  setEnabled: (enabled) => {
    writePromptPreviewEnabled(enabled)
    set({ enabled })
  },
  open: (req) => new Promise<ChatMessage[] | null>((resolve) => {
    const current = get().pending
    if (current) current.resolve(null)
    set({ pending: { ...req, resolve } })
  }),
  settle: (result) => {
    const current = get().pending
    if (!current) return
    set({ pending: null })
    current.resolve(result)
  },
}))

/**
 * 若开启「发送前提示词预览」则弹出门闩；否则直接返回原 messages。
 * 用户取消 → null（调用方应中止 ai.start）。
 */
export async function maybePreviewMessages(
  messages: ChatMessage[],
  options?: { title?: string; subtitle?: string; force?: boolean },
): Promise<ChatMessage[] | null> {
  const { enabled, open } = usePromptPreviewStore.getState()
  if (!options?.force && !enabled) return messages
  return open({
    messages,
    title: options?.title,
    subtitle: options?.subtitle,
  })
}
