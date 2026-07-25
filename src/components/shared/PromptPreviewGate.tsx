/**
 * PIPELINE-1 · PromptPreviewGate
 *
 * 发送前预览/编辑最终拼接后的 system + user messages。
 * 一次性覆盖，不写回模板或项目字段。
 */

import { useEffect, useMemo, useState } from 'react'
import { Eye, RotateCcw, Send, X } from 'lucide-react'
import {
  isPreviewDraftDirty,
  messagesToPreviewDraft,
  previewDraftToMessages,
  summarizePreviewDraft,
  type PromptPreviewDraft,
} from '../../lib/ai/prompt-preview'
import { usePromptPreviewStore } from '../../stores/prompt-preview'

export default function PromptPreviewGateHost() {
  const pending = usePromptPreviewStore(s => s.pending)
  const settle = usePromptPreviewStore(s => s.settle)

  if (!pending) return null

  return (
    <PromptPreviewGateModal
      messages={pending.messages}
      title={pending.title ?? '发送前提示词预览'}
      subtitle={pending.subtitle ?? '可编辑本次最终提示词。改动只影响这一次发送，不会写回模板或设定。'}
      onConfirm={(edited) => settle(edited)}
      onCancel={() => settle(null)}
    />
  )
}

interface ModalProps {
  messages: import('../../lib/types').ChatMessage[]
  title: string
  subtitle: string
  onConfirm: (messages: import('../../lib/types').ChatMessage[]) => void
  onCancel: () => void
}

function PromptPreviewGateModal({ messages, title, subtitle, onConfirm, onCancel }: ModalProps) {
  const [draft, setDraft] = useState<PromptPreviewDraft>(() => messagesToPreviewDraft(messages))

  useEffect(() => {
    setDraft(messagesToPreviewDraft(messages))
  }, [messages])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const stats = useMemo(() => summarizePreviewDraft(draft), [draft])
  const dirty = isPreviewDraftDirty(messages, draft)

  const handleReset = () => setDraft(messagesToPreviewDraft(messages))

  const handleConfirm = () => {
    onConfirm(previewDraftToMessages(draft))
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/55" role="dialog" aria-modal="true" aria-labelledby="prompt-preview-title">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-border bg-bg-surface shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <h2 id="prompt-preview-title" className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Eye className="w-4 h-4 text-accent shrink-0" />
              {title}
            </h2>
            <p className="text-xs text-text-muted mt-1">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-border flex flex-wrap items-center gap-3 text-[11px] text-text-secondary">
          <span>System ≈ {stats.systemTokens.toLocaleString()} token</span>
          <span>User ≈ {stats.userTokens.toLocaleString()} token</span>
          <span className="text-text-primary font-medium">合计 ≈ {stats.totalTokens.toLocaleString()} token</span>
          {dirty && (
            <span className="px-1.5 py-0.5 rounded bg-warning/15 text-warning">已编辑（仅本次）</span>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">System</span>
              <span className="text-[10px] text-text-muted">模型行为与硬约束</span>
            </div>
            <textarea
              value={draft.system}
              onChange={e => setDraft(d => ({ ...d, system: e.target.value }))}
              rows={8}
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary font-mono leading-relaxed resize-y focus:outline-none focus:border-accent"
            />
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">User</span>
              <span className="text-[10px] text-text-muted">本章任务 + 已注入的上下文</span>
            </div>
            <textarea
              value={draft.user}
              onChange={e => setDraft(d => ({ ...d, user: e.target.value }))}
              rows={14}
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-xs text-text-primary font-mono leading-relaxed resize-y focus:outline-none focus:border-accent"
            />
          </label>

          {draft.trailing.length > 0 && (
            <p className="text-[11px] text-text-muted">
              另有 {draft.trailing.length} 条非 system/user 消息将原样保留发送。
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-bg-elevated">
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            还原原文
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary"
            >
              取消发送
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent-hover"
            >
              <Send className="w-3.5 h-3.5" />
              {dirty ? '按编辑后发送' : '确认发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
