/**
 * PromptInjectionInspectorModal（H4 — 大纲 / 正文「查看注入 prompt」）
 *
 * 设计：
 * - 仅高级模式开启时由父组件渲染本 Modal（按钮也只在高级模式下显示）。
 * - 父组件传入一个 builder：把当前面板真实使用的 `messages` 与 `assembled` 装配结果一并返回；
 *   Modal 自己不去重新装配，避免与生产链路出现"看到的不是真的发出的"漂移。
 *
 * 展示三层信息：
 *   ① assembleContext 装配后的每段 segment（label / layer / 字符 / token 估算 / 来源 source key）；
 *   ② messages 数组（system / user 各自占用 token）；
 *   ③ 总计：input token / 模型上限 / 是否超 assembleContext 总闸（`overBudgetBeforeTrim`）/
 *      被裁剪的层（`trimmed`）/ 被排除的源（`omitted`）。
 */
import { useEffect, useState } from 'react'
import { X, Layers, FileText, AlertTriangle, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { estimateTokens, formatTokenCount } from '../../lib/ai/context-budget'
import type { AssembleContextResult } from '../../lib/registry/types'
import type { ChatMessage } from '../../lib/types'

export interface InspectorPayload {
  /** 真实送给 AI 的 messages */
  messages: ChatMessage[]
  /** assembleContext 返回结果（如有） */
  assembled?: AssembleContextResult | null
  /** 调用入口的标签（如「卷级大纲」「章节正文」），仅展示用 */
  category: string
  /** 模型上限 token（可选；用于侧栏显示窗口比例） */
  modelMaxContext?: number
}

interface Props {
  open: boolean
  /** 父组件按需调用、按需返回 */
  buildPayload: () => Promise<InspectorPayload | null> | InspectorPayload | null
  onClose: () => void
}

export default function PromptInjectionInspectorModal({ open, buildPayload, onClose }: Props) {
  const [payload, setPayload] = useState<InspectorPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPayload(null)
    Promise.resolve()
      .then(buildPayload)
      .then(p => {
        if (cancelled) return
        if (!p) setError('当前没有可用的 prompt 装配结果（可能字段没填、章节未选中等）。')
        else setPayload(p)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // buildPayload 可能由父组件内联生成；只在 open 切换 true 时触发，避免父组件 re-render 抖动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col bg-bg-base border border-border rounded-xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-surface">
          <div>
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-amber-500" />
              注入 prompt 预览
              {payload && <span className="text-xs text-text-muted font-normal">· {payload.category}</span>}
            </h2>
            <p className="text-[11px] text-text-muted mt-0.5">
              展示当前点击「生成」按钮时实际会发送给 AI 的全部上下文段、messages 与各段 token 占用。
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {loading && <div className="text-text-muted">正在装配 prompt…</div>}
          {error && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {payload && (
            <>
              <SummaryBar payload={payload} />
              <SegmentsTable payload={payload} />
              <MessagesPreview payload={payload} />
            </>
          )}
        </div>

        {/* 底部 */}
        <footer className="px-5 py-2 border-t border-border bg-bg-surface flex items-center justify-end gap-2">
          <span className="text-[10px] text-text-muted mr-auto">
            数据基于 assembleContext 装配后再加上各 adapter 拼装的 user / system，与真实发出的 prompt 一致。
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-bg-elevated text-text-secondary rounded hover:bg-bg-hover transition-colors"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}

function SummaryBar({ payload }: { payload: InspectorPayload }) {
  const { messages, assembled, modelMaxContext } = payload
  const messagesTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  const overAssemble = !!assembled?.overBudgetBeforeTrim
  const ratio = modelMaxContext ? messagesTokens / modelMaxContext : null

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="message 总 token" value={formatTokenCount(messagesTokens)} valueClass="text-amber-400" />
      <Stat
        label="assembleContext 总闸"
        value={assembled ? `${formatTokenCount(assembled.totalInputTokens)} / ${formatTokenCount(assembled.inputBudget)}` : '—'}
        valueClass={overAssemble ? 'text-amber-400' : 'text-text-primary'}
        hint={overAssemble ? '装配前已超总闸，按 L3→L2→L1 已裁剪。' : undefined}
      />
      <Stat
        label="模型窗口占比"
        value={ratio != null ? `${(ratio * 100).toFixed(1)}%` : '—'}
        valueClass={ratio != null && ratio > 0.85 ? 'text-amber-400' : 'text-text-primary'}
        hint={modelMaxContext ? `模型窗口 ${formatTokenCount(modelMaxContext)} token` : undefined}
      />
      <Stat
        label="message 数"
        value={String(messages.length)}
        valueClass="text-text-primary"
        hint={`system: ${messages.filter(m => m.role === 'system').length} / user: ${messages.filter(m => m.role === 'user').length}`}
      />
    </section>
  )
}

function Stat({ label, value, valueClass, hint }: { label: string; value: string; valueClass?: string; hint?: string }) {
  return (
    <div className="p-3 bg-bg-surface border border-border rounded-lg">
      <div className="text-[10px] text-text-muted uppercase tracking-wide">{label}</div>
      <div className={`text-base font-mono mt-0.5 ${valueClass ?? 'text-text-primary'}`}>{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-0.5">{hint}</div>}
    </div>
  )
}

function SegmentsTable({ payload }: { payload: InspectorPayload }) {
  const a = payload.assembled
  if (!a) {
    return (
      <section className="p-3 bg-bg-surface border border-border rounded-lg text-text-muted">
        本次调用未通过 assembleContext 装配（或装配结果未传入），仅展示 messages。
      </section>
    )
  }
  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-amber-500" />
          上下文段（assembleContext）
          <span className="text-[10px] text-text-muted font-normal">已装入 {a.included.length} 段</span>
        </h3>
        <div className="text-[10px] text-text-muted">
          {a.trimmed.length > 0 && <span className="text-amber-400">已裁剪：{a.trimmed.join(' / ')}</span>}
          {a.trimmed.length > 0 && a.omitted.length > 0 && <span className="mx-1">·</span>}
          {a.omitted.length > 0 && <span>未启用：{a.omitted.length} 个 source</span>}
        </div>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full">
          <thead className="bg-bg-elevated">
            <tr className="text-left text-[10px] text-text-muted uppercase">
              <th className="px-3 py-1.5 font-normal">段</th>
              <th className="px-3 py-1.5 font-normal">层级</th>
              <th className="px-3 py-1.5 font-normal">字符</th>
              <th className="px-3 py-1.5 font-normal">token（估算）</th>
              <th className="px-3 py-1.5 font-normal">截断标记</th>
            </tr>
          </thead>
          <tbody>
            {a.segments.map((seg, i) => {
              const truncated = seg.content.includes('（该上下文源已按预算截断）')
              return (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-3 py-1.5 text-text-primary">{seg.label}</td>
                  <td className="px-3 py-1.5 text-text-muted font-mono">{seg.layer}</td>
                  <td className="px-3 py-1.5 text-text-muted font-mono">{seg.content.length.toLocaleString()}</td>
                  <td className="px-3 py-1.5 font-mono text-amber-400">{formatTokenCount(seg.tokens)}</td>
                  <td className="px-3 py-1.5">
                    {truncated
                      ? <span className="text-amber-400 text-[10px]">已按 source 预算截断</span>
                      : <span className="text-text-muted text-[10px]">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {a.omitted.length > 0 && (
        <div className="text-[10px] text-text-muted">
          未启用 source（缺前置条件 / 字段为空 / enabled() 返回 false）：
          <span className="font-mono ml-1">{a.omitted.join(' / ')}</span>
        </div>
      )}
    </section>
  )
}

function MessagesPreview({ payload }: { payload: InspectorPayload }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-text-primary flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5 text-amber-500" />
        Messages（最终发送给 AI）
      </h3>
      {payload.messages.map((m, i) => (
        <CollapsibleMessage key={i} index={i} message={m} />
      ))}
    </section>
  )
}

function CollapsibleMessage({ index, message }: { index: number; message: ChatMessage }) {
  const [open, setOpen] = useState(message.role === 'user')
  const [copied, setCopied] = useState(false)
  const tokens = estimateTokens(message.content)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const roleColor =
    message.role === 'system' ? 'text-blue-400 border-blue-400/30 bg-blue-500/5' :
    message.role === 'user'   ? 'text-purple-400 border-purple-400/30 bg-purple-500/5' :
    'text-text-secondary border-border bg-bg-surface'

  return (
    <div className={`rounded-lg border ${roleColor.split(' ').slice(1).join(' ')}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className={`text-[10px] font-medium uppercase tracking-wide ${roleColor.split(' ')[0]}`}>
          {open ? <ChevronDown className="w-3 h-3 inline mr-1" /> : <ChevronRight className="w-3 h-3 inline mr-1" />}
          message #{index + 1} · {message.role}
        </span>
        <span className="text-[10px] text-text-muted font-mono">
          {message.content.length.toLocaleString()} 字 · {formatTokenCount(tokens)} token
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={handleCopy}
              className="text-[10px] text-text-muted hover:text-text-primary flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors"
            >
              {copied
                ? <><Check className="w-3 h-3 text-green-400" /> 已复制</>
                : <><Copy className="w-3 h-3" /> 复制</>}
            </button>
          </div>
          <pre className="whitespace-pre-wrap break-words text-[11px] text-text-secondary bg-bg-base border border-border/60 rounded p-2 max-h-64 overflow-y-auto">
            {message.content}
          </pre>
        </div>
      )}
    </div>
  )
}
