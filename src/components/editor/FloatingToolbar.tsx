/**
 * 选中文本 durable 浮动工具栏 — HARNESS-65
 *
 * 模型只读取冻结选区；编辑结果先落 durable 候选，作者确认后由 runner
 * 经 adopt(chapters) 精确写回。查漏是只读 terminal report。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Expand, Loader2, Minimize2, RefreshCw, Search, Wand2, X } from 'lucide-react'
import type { AIConfig, WorkspaceScope } from '../../lib/types'
import type { SelectionEditActionV1 } from '../../lib/ai/adapters/selection-edit-adapter'
import { sha256Text } from '../../lib/ai/chapter-memory/text-normalization'
import {
  abandonSelectionEditRunV1,
  acknowledgeSelectionCheckReportV1,
  adoptSelectionEditCandidateV1,
  generateSelectionEditCandidateV1,
  readPendingSelectionEditCandidateV1,
  readRecoverableSelectionEditRunV1,
  rejectSelectionEditCandidateV1,
  type SelectionEditCandidateV1,
  type SelectionSnapshotV1,
} from '../../lib/agent/run/selection-edit-durable'

interface Props {
  scope: WorkspaceScope
  projectId: number
  chapterId: number
  worldGroupId: number | null
  aiConfig: AIConfig
  getSelectionSnapshot: () => SelectionSnapshotV1 | null
  getSelectionRect: () => DOMRect | null
  getCurrentHtml: () => string
  previewRangeReplacement: (from: number, to: number, text: string) => string | null
  persistBeforeGenerate: () => Promise<{ html: string } | null>
  onContentAdopted: (html: string, demotedFacts: number) => void
  disabled?: boolean
}

type ActionType = SelectionEditActionV1

const ACTIONS: { type: ActionType; icon: typeof Wand2; label: string }[] = [
  { type: 'polish', icon: Wand2, label: '润色' },
  { type: 'expand', icon: Expand, label: '扩写' },
  { type: 'condense', icon: Minimize2, label: '缩写' },
  { type: 'rewrite', icon: RefreshCw, label: '改写' },
  { type: 'check', icon: Search, label: '查漏' },
]

export default function FloatingToolbar({
  scope,
  projectId,
  chapterId,
  worldGroupId,
  aiConfig,
  getSelectionSnapshot,
  getSelectionRect,
  getCurrentHtml,
  previewRangeReplacement,
  persistBeforeGenerate,
  onContentAdopted,
  disabled,
}: Props) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [selection, setSelection] = useState<SelectionSnapshotV1 | null>(null)
  const [candidate, setCandidate] = useState<SelectionEditCandidateV1 | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [unsafeRunId, setUnsafeRunId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<number | null>(null)

  const cancelPendingHide = useCallback(() => {
    if (hideTimerRef.current == null) return
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const pending = await readPendingSelectionEditCandidateV1({ scope, chapterId, worldGroupId })
        if (cancelled) return
        if (pending) {
          setCandidate(pending.candidate)
          setRunId(pending.snapshot.run.id)
          setVisible(true)
          setPosition({ top: 72, left: window.innerWidth / 2 })
          return
        }
        const recoverable = await readRecoverableSelectionEditRunV1({ scope, chapterId, worldGroupId })
        if (!cancelled && recoverable && !recoverable.safeToResume) {
          setUnsafeRunId(recoverable.snapshot.run.id)
          setVisible(true)
          setPosition({ top: 72, left: window.innerWidth / 2 })
          setError('上次运行停在模型结果不可判定窗口，系统不会自动重试。请放弃后重新选择。')
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
    return () => { cancelled = true }
  }, [chapterId, scope, worldGroupId])

  const handleSelectionChange = useCallback(() => {
    if (disabled || busy || candidate || unsafeRunId) return
    const current = getSelectionSnapshot()
    if (current && current.text.length > 5 && current.text.length < 5_000) {
      cancelPendingHide()
      const rect = getSelectionRect()
      if (rect) {
        setPosition({ top: rect.top - 45, left: rect.left + rect.width / 2 })
        setSelection(current)
        setVisible(true)
        setError('')
      }
    } else {
      cancelPendingHide()
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null
        if (!busy && !candidate && !unsafeRunId) setVisible(false)
      }, 200)
    }
  }, [busy, cancelPendingHide, candidate, disabled, getSelectionRect, getSelectionSnapshot, unsafeRunId])

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange)
    // Workspace scope resolution can mount this toolbar after the author has
    // already created a selection. Capture that frozen range immediately
    // instead of waiting for a second selectionchange event.
    handleSelectionChange()
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      cancelPendingHide()
    }
  }, [cancelPendingHide, handleSelectionChange])

  const handleAction = async (action: ActionType) => {
    if (!selection || busy) return
    cancelPendingHide()
    setBusy(true)
    setError('')
    try {
      const saved = await persistBeforeGenerate()
      if (!saved) throw new Error('保存当前章节失败。')
      const frozen = { ...selection, sourceHtml: saved.html }
      const generated = await generateSelectionEditCandidateV1({
        scope,
        worldGroupId,
        chapterId,
        action,
        selection: frozen,
        previewReplacement: ({ selection: target, outputText }) => {
          const html = previewRangeReplacement(target.from, target.to, outputText)
          if (!html) throw new Error('无法预演冻结选区，请重新选择。')
          return html
        },
        aiConfig,
      })
      setCandidate(generated.candidate)
      setRunId(generated.snapshot.run.id)
      setSelection(frozen)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      const recoverable = await readRecoverableSelectionEditRunV1({ scope, chapterId, worldGroupId }).catch(() => null)
      if (recoverable && !recoverable.safeToResume) setUnsafeRunId(recoverable.snapshot.run.id)
    } finally {
      setBusy(false)
    }
  }

  const handleAccept = async () => {
    if (!candidate || candidate.mode !== 'edit' || runId == null || busy) return
    setBusy(true)
    setError('')
    try {
      if (await sha256Text(getCurrentHtml()) !== candidate.sourceContentHash) {
        throw new Error('当前编辑器正文已变化，旧候选不会覆盖你的新修改。请保存后重新选择。')
      }
      const adopted = await adoptSelectionEditCandidateV1({ scope, runId })
      onContentAdopted(adopted.candidate.expectedContentHtml!, adopted.demotedFacts)
      setCandidate(null)
      setRunId(null)
      setSelection(null)
      setVisible(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const handleDismiss = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (candidate && runId != null) {
        if (candidate.mode === 'edit') await rejectSelectionEditCandidateV1({ scope, runId })
        else {
          if (await sha256Text(getCurrentHtml()) !== candidate.sourceContentHash) {
            throw new Error('当前编辑器正文已变化，旧查漏报告不能签发当前回执。')
          }
          await acknowledgeSelectionCheckReportV1({ scope, runId })
        }
      }
      setCandidate(null)
      setRunId(null)
      setSelection(null)
      setVisible(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const handleAbandon = async () => {
    if (unsafeRunId == null || busy) return
    setBusy(true)
    try {
      await abandonSelectionEditRunV1({ scope, runId: unsafeRunId })
      setUnsafeRunId(null)
      setError('')
      setVisible(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  if (!visible && !busy) return null

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 -translate-x-1/2 transform"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      data-project-id={projectId}
    >
      {!candidate && !busy && !unsafeRunId && (
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-bg-elevated px-1 py-0.5 shadow-lg">
          {ACTIONS.map(({ type, icon: Icon, label }) => (
            <button key={type} type="button" onClick={() => { void handleAction(type) }}
              className="flex items-center gap-1 rounded px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-accent/10 hover:text-accent" title={label}>
              <Icon className="h-3 w-3" />{label}
            </button>
          ))}
          <button type="button" onClick={() => { setVisible(false); setError('') }}
            className="rounded p-1.5 text-text-muted hover:text-text-primary" aria-label="关闭局部编辑工具栏">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {busy && (
        <div className="min-w-[220px] rounded-lg border border-accent/30 bg-bg-elevated px-3 py-2 shadow-lg">
          <div className="flex items-center gap-2 text-xs text-accent"><Loader2 className="h-3 w-3 animate-spin" />正在记录可恢复运行...</div>
        </div>
      )}

      {(candidate || unsafeRunId || error) && !busy && (
        <div className="max-w-md rounded-lg border border-border bg-bg-elevated p-3 shadow-lg">
          {candidate && (
            <>
              <p className="mb-1 text-[10px] text-amber-400">
                {candidate.mode === 'edit' ? '候选尚未写入正文' : '只读查漏报告，不会修改正文'}
              </p>
              <p className="mb-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-text-primary">{candidate.outputText}</p>
            </>
          )}
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-2">
            {candidate?.mode === 'edit' && (
              <button type="button" onClick={() => { void handleAccept() }}
                className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover">
                <Check className="h-3 w-3" />确认替换
              </button>
            )}
            {unsafeRunId != null ? (
              <button type="button" onClick={() => { void handleAbandon() }}
                className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-400/10">放弃未知运行</button>
            ) : (
              <button type="button" onClick={() => { void handleDismiss() }}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary">
                <X className="h-3 w-3" />{candidate?.mode === 'check' ? '关闭' : '放弃'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
