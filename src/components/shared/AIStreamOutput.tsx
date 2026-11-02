import { useEffect, useRef, useState } from 'react'
import { CTextarea } from './CompositionInput'
import { Save, Square, Check, RotateCcw, Loader2, ThumbsUp, ThumbsDown, Braces, ChevronDown, ChevronRight, X } from 'lucide-react'
import { usePromptStore } from '../../stores/prompt'
import type { PromptModuleKey, PromptExample } from '../../lib/types/prompt'
import type { TokenUsage } from '../../lib/ai/logger'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'

interface AIStreamOutputProps {
  /** 流式输出的文本 */
  output: string
  /** 是否正在生成 */
  isStreaming: boolean
  /** 流已结束，但正式候选仍在校验或持久化。 */
  isFinalizing?: boolean
  /** 错误信息 */
  error: string | null
  /** 本次生成的 token 用量 */
  tokenUsage?: TokenUsage | null
  /** 停止生成 */
  onStop: () => void
  /** 采纳内容；结构化结果由调用方单独审查/应用时可省略 */
  onAccept?: (text: string) => void | Promise<void>
  /** Some structured results require a separate review before formal adoption. */
  acceptMode?: 'adopt' | 'preview'
  /** 重试 */
  onRetry?: () => void
  /** 关闭/弃用本次结果（不写回正文）。传入则显示「关闭」按钮 */
  onDismiss?: () => void
  /** 占位提示 */
  placeholder?: string
  /** P15：传入则显示「⭐ 好示例 / 💩 坏示例」标记按钮，写入对应模板的 examples */
  moduleKey?: PromptModuleKey
  /** 允许作者在确认前修订；由采纳或可选的 onSaveDraft 持久化。 */
  editable?: boolean
  /** Opt-in durable candidate draft save, separate from formal adoption. */
  onSaveDraft?: (text: string) => Promise<void>
}

/**
 * AI 流式输出展示组件
 * 显示 AI 生成的文字 + 操作按钮（停止/采纳/重试）
 */
export default function AIStreamOutput({
  output,
  isStreaming,
  isFinalizing = false,
  error,
  onStop,
  onAccept,
  acceptMode = 'adopt',
  onRetry,
  onDismiss,
  placeholder = '点击生成按钮，让 AI 为你创作...',
  moduleKey,
  tokenUsage,
  editable = false,
  onSaveDraft,
}: AIStreamOutputProps) {
  const acceptingRef = useRef(false)
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState('')
  const [editableOutput, setEditableOutput] = useState(output)
  const draftRef = useRef(output)
  const savedDraftRef = useRef(output)
  const [savedDraft, setSavedDraft] = useState(output)
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftSaveError, setDraftSaveError] = useState('')
  const draftSaveRef = useRef<Promise<void> | null>(null)
  const saveCallbackRef = useRef(onSaveDraft)
  saveCallbackRef.current = onSaveDraft
  const durableDraft = Boolean(onSaveDraft)
  useEffect(() => {
    if (!durableDraft || isStreaming || isFinalizing || draftRef.current === savedDraftRef.current || output === draftRef.current) {
      draftRef.current = output
      setEditableOutput(output)
    }
    savedDraftRef.current = output
    setSavedDraft(output)
  }, [output, isStreaming, isFinalizing, durableDraft])
  const persistDraft = async () => {
    const saveDraft = saveCallbackRef.current
    if (!saveDraft || draftRef.current === savedDraftRef.current) return
    if (draftSaveRef.current) return draftSaveRef.current
    const text = draftRef.current
    setSavingDraft(true)
    setDraftSaveError('')
    const operation = Promise.resolve().then(() => saveDraft(text)).then(() => {
      savedDraftRef.current = text
      setSavedDraft(text)
    }).catch(error => {
      setDraftSaveError(error instanceof Error ? error.message : '候选修改未保存，输入已保留。')
      throw error
    }).finally(() => { draftSaveRef.current = null; setSavingDraft(false) })
    draftSaveRef.current = operation
    return operation
  }
  const persistDraftRef = useRef(persistDraft)
  persistDraftRef.current = persistDraft
  const canSaveDraft = Boolean(editable && onSaveDraft && !isStreaming && !isFinalizing)
  useEffect(() => {
    if (!canSaveDraft) return
    return registerPendingDraftFlusherV1(() => acceptingRef.current ? undefined : persistDraftRef.current())
  }, [canSaveDraft])
  const displayedOutput = editable && !isStreaming && !isFinalizing ? editableOutput : output
  const hasOutput = displayedOutput.length > 0
  const [marked, setMarked] = useState<'good' | 'bad' | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  // 检测是否结构化输出（JSON）——这类内容是给程序解析的，不该让用户直接读原始 JSON
  const trimmed = displayedOutput.trimStart()
  const isStructured = hasOutput && (
    trimmed.startsWith('{') || trimmed.startsWith('[') || /^```(?:json)?\s*[[{]/.test(trimmed)
  )

  const handleAccept = async () => {
    if (!onAccept || acceptingRef.current) return
    acceptingRef.current = true
    setAccepting(true)
    setAcceptError('')
    try { await onAccept(displayedOutput) }
    catch (cause) { setAcceptError(cause instanceof Error ? cause.message : '采纳失败，请重试。') }
    finally { acceptingRef.current = false; setAccepting(false) }
  }

  /** 把当前输出存为模板的好/坏示例 */
  const handleMark = async (kind: 'good' | 'bad') => {
    if (!moduleKey || !output.trim()) return
    const tpl = usePromptStore.getState().getActive(moduleKey)
    const example: PromptExample = {
      id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: output.trim().slice(0, 2000), // 限制长度
      source: 'user-marked',
      rating: kind === 'good' ? 5 : 1,
      createdAt: Date.now(),
    }
    const examples = tpl.examples || {}
    const updated = {
      ...examples,
      [kind]: [...(examples[kind] || []), example],
    }
    await usePromptStore.getState().saveTemplate({ ...tpl, examples: updated })
    setMarked(kind)
  }

  // Phase 21.1: 生成中 token 估算（中文 ≈ 1.5 token/字，英文 ≈ 1.3 token/word）
  const estimatedOutputTokens = isStreaming && !tokenUsage && displayedOutput.length > 0
    ? Math.round(displayedOutput.length * 1.5)
    : null

  return (
    <div className="border border-border rounded-lg overflow-hidden border-l-2 border-l-accent">
      {canSaveDraft && <div className="px-4 py-2 text-xs border-b border-border">
        <p role="status">{savingDraft ? '正在保存候选修改…' : editableOutput === savedDraft ? '候选已保存，尚未采纳。' : '候选修改尚未保存；可先保存，再刷新或继续编辑。'}</p>
        {draftSaveError && <p role="alert" className="mt-1 text-error">{draftSaveError}</p>}
      </div>}
      {/* 输出区域 */}
      <div className={`${isStructured && acceptMode === 'preview' && !isStreaming ? '' : 'min-h-[200px]'} max-h-[500px] overflow-y-auto p-4 bg-accent-soft`}>
        {error ? (
          <div className="text-error text-sm">
            <p className="font-medium mb-1">⚠️ {error.includes('生成已停止') ? '生成已停止' : error.includes('未收到模型完成确认') ? '生成结果未确认' : '生成失败'}</p>
            <p className="text-text-muted">{error}</p>
            {hasOutput && <details open className="mt-3 text-text-primary"><summary>已收到的片段（未完成）</summary><div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{displayedOutput}</div></details>}
            {error.includes('Failed to fetch') && (
              <p className="mt-2 text-xs text-warning bg-warning/5 p-2 rounded">
                💡 可能的解决方法：<br />
                1. 检查网络连接是否正常<br />
                2. 在「设置」中点击「切换到本地代理」按钮<br />
                3. 确认 Base URL 是否正确
              </p>
            )}
            {error.includes('API Key') && (
              <p className="mt-2 text-xs text-warning bg-warning/5 p-2 rounded">
                💡 请在「设置」中检查 API Key 是否正确填写
              </p>
            )}
          </div>
        ) : editable && output.length > 0 && !isStreaming && !isFinalizing ? (
          <CTextarea
            aria-label="AI 候选可编辑内容"
            disabled={accepting || savingDraft}
            value={editableOutput}
            onChange={event => { draftRef.current = event.target.value; setEditableOutput(event.target.value); setDraftSaveError('') }}
            className="min-h-[260px] w-full resize-y rounded border border-border bg-bg-surface p-3 text-sm leading-7 text-text-primary outline-none focus:border-accent"
          />
        ) : isStructured ? (
          // 结构化（JSON）输出：不直接展示原始 JSON，给友好提示 + 可折叠原文
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Braces className="w-4 h-4 text-accent shrink-0" />
              {isFinalizing ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  正在校验并保存候选…
                </span>
              ) : isStreaming ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {onAccept
                    ? acceptMode === 'preview' ? 'AI 正在生成大纲候选…完成后可预览，再确认写入。' : 'AI 正在生成结构化内容…（完成后点「采纳」自动整理为可编辑内容）'
                    : 'AI 正在生成结构化内容…（完成后将在下方生成可审查计划）'}
                </span>
              ) : (
                <span>
                  {onAccept
                    ? acceptMode === 'preview' ? '候选已生成。先预览完整内容，再确认写入作品。' : '✓ 已生成结构化内容，点「采纳」自动整理填入对应栏目。'
                    : '✓ 已生成结构化内容，系统已解析为下方可审查计划。'}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowRaw(v => !v)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {showRaw ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {showRaw ? '收起原始数据' : '查看原始数据'}
            </button>
            {showRaw && (
              <pre className="text-xs text-text-muted bg-bg-base/50 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-60">{displayedOutput}</pre>
            )}
          </div>
        ) : hasOutput ? (
          <div className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
            {displayedOutput}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-accent ml-0.5 animate-pulse" />
            )}
          </div>
        ) : isStreaming ? (
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>AI 思考中...</span>
          </div>
        ) : (
          <p className="text-text-muted text-sm">{placeholder}</p>
        )}
      </div>

      {acceptError && <p role="alert" className="p-3 text-sm text-error">{acceptError}</p>}
      {/* 操作栏 */}
      <div className="flex flex-wrap gap-2 items-center justify-between px-4 py-2 bg-bg-elevated border-t border-border">
        <span className="text-text-muted text-xs flex items-center gap-2">
          {hasOutput && <span>{displayedOutput.length} 字</span>}
          {tokenUsage ? (
            <span title={`输入 ${tokenUsage.inputTokens} + 输出 ${tokenUsage.outputTokens}`}>
              Token: ↑{tokenUsage.inputTokens.toLocaleString()} ↓{tokenUsage.outputTokens.toLocaleString()}
            </span>
          ) : estimatedOutputTokens ? (
            <span className="text-text-muted" title="基于字数估算，精确值在生成完成后显示">
              ≈ 输出 ~{estimatedOutputTokens.toLocaleString()} tokens
            </span>
          ) : null}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {isStreaming ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-error/10 text-error rounded-md hover:bg-error/20 transition-colors"
            >
              <Square className="w-3 h-3" />
              停止
            </button>
          ) : isFinalizing ? (
            <span className="flex items-center gap-1.5 text-xs text-text-muted" role="status">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              正在建立可恢复候选…
            </span>
          ) : (
            <>
              {canSaveDraft && output.length > 0 && !error && <button type="button"
                disabled={accepting || savingDraft || editableOutput === savedDraft}
                onClick={() => { void persistDraft().catch(() => undefined) }}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-50">
                <Save className="w-3 h-3" />{savingDraft ? '保存中…' : '保存候选修改'}
              </button>}
              {onRetry && (output.length > 0 || hasOutput || error) && (
                <button
                  disabled={accepting || savingDraft}
                  onClick={onRetry}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-hover text-text-secondary rounded-md hover:text-text-primary transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  重试
                </button>
              )}
              {/* P15: 标记好/坏示例（仅在已有输出 + moduleKey 提供时） */}
              {hasOutput && !error && moduleKey && (
                <>
                  <button
                    onClick={() => handleMark('good')}
                    disabled={marked === 'good'}
                    title="标为好示例 — 下次生成时 AI 会参考此风格"
                    className={`flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors ${
                      marked === 'good'
                        ? 'bg-success/20 text-success'
                        : 'bg-bg-hover text-text-secondary hover:text-success hover:bg-success/10'
                    }`}
                  >
                    <ThumbsUp className="w-3 h-3" />
                    {marked === 'good' ? '已标好' : '好示例'}
                  </button>
                  <button
                    onClick={() => handleMark('bad')}
                    disabled={marked === 'bad'}
                    title="标为坏示例 — 下次生成时 AI 会避开此风格"
                    className={`flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors ${
                      marked === 'bad'
                        ? 'bg-error/20 text-error'
                        : 'bg-bg-hover text-text-secondary hover:text-error hover:bg-error/10'
                    }`}
                  >
                    <ThumbsDown className="w-3 h-3" />
                    {marked === 'bad' ? '已标坏' : '反例'}
                  </button>
                </>
              )}
              {(hasOutput || output.length > 0) && !error && onAccept && (
                <button
                  disabled={accepting || savingDraft || !displayedOutput.trim()}
                  onClick={() => { void handleAccept() }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
                >
                  <Check className="w-3 h-3" />
                  {accepting ? '正在处理…' : acceptMode === 'preview' ? '预览候选' : '采纳'}
                </button>
              )}
              {/* G2：关闭/弃用——不满意可直接关掉，保留原文不写回 */}
              {onDismiss && (output.length > 0 || hasOutput || error) && (
                <button
                  disabled={accepting || savingDraft}
                  onClick={onDismiss}
                  title="关闭，保留原文不采纳"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-hover text-text-muted rounded-md hover:text-text-primary transition-colors"
                >
                  <X className="w-3 h-3" />
                  关闭
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
