/**
 * PIPELINE-1 · 发送前提示词预览/编辑（纯函数层）
 *
 * 在 messages 已拼好 → ai.start 之间提供一次性覆盖能力。
 * 覆盖不写回模板/字段；默认由调用方决定是否弹出 UI。
 */

import type { ChatMessage } from '../types'
import { estimateTokens } from './context-budget'

export interface PromptPreviewDraft {
  system: string
  user: string
  /** 若原 messages 含 assistant 等其它角色，原样保留在尾部 */
  trailing: ChatMessage[]
}

export interface PromptPreviewStats {
  systemTokens: number
  userTokens: number
  totalTokens: number
}

/** 将 ChatMessage[] 拆成可编辑草稿（取首个 system + 首个 user；其余保留） */
export function messagesToPreviewDraft(messages: ChatMessage[]): PromptPreviewDraft {
  const systemMsg = messages.find(m => m.role === 'system')
  const userMsg = messages.find(m => m.role === 'user')
  const used = new Set<ChatMessage>()
  if (systemMsg) used.add(systemMsg)
  if (userMsg) used.add(userMsg)
  return {
    system: systemMsg?.content ?? '',
    user: userMsg?.content ?? '',
    trailing: messages.filter(m => !used.has(m)),
  }
}

/** 把编辑后的草稿还原为 messages（保持 system → user → trailing 顺序） */
export function previewDraftToMessages(draft: PromptPreviewDraft): ChatMessage[] {
  const next: ChatMessage[] = []
  if (draft.system.trim()) next.push({ role: 'system', content: draft.system })
  if (draft.user.trim()) next.push({ role: 'user', content: draft.user })
  for (const msg of draft.trailing) next.push({ ...msg })
  return next
}

export function summarizePreviewDraft(draft: PromptPreviewDraft): PromptPreviewStats {
  const systemTokens = estimateTokens(draft.system)
  const userTokens = estimateTokens(draft.user)
  const trailingTokens = draft.trailing.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  return {
    systemTokens,
    userTokens,
    totalTokens: systemTokens + userTokens + trailingTokens,
  }
}

/** 判断编辑后是否相对原文有改动（忽略尾部引用相等性，按内容比） */
export function isPreviewDraftDirty(original: ChatMessage[], draft: PromptPreviewDraft): boolean {
  const baseline = messagesToPreviewDraft(original)
  return baseline.system !== draft.system || baseline.user !== draft.user
}

export const PROMPT_PREVIEW_STORAGE_KEY = 'storyforge-prompt-preview-enabled'

export function readPromptPreviewEnabled(): boolean {
  try {
    return localStorage.getItem(PROMPT_PREVIEW_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writePromptPreviewEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PROMPT_PREVIEW_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}
