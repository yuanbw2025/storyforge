import { useEffect, useMemo, useRef, useState, type CompositionEvent, type FormEvent, type UIEvent } from 'react'
import { CTextarea } from '../shared/CompositionInput'
import type { PendingMasterCandidate, VisibleMasterCandidateDraftV1 } from '../agent/useMasterCopilot'
import {
  parseWorldviewFieldCandidateDraft,
  type WorldviewFieldCopilotCandidate,
  type WorldviewFieldOperationV1,
} from '../../lib/agent/worldview-field-copilot'
import {
  compareWorldviewTextBlocksV1,
  WORLDVIEW_TEXT_COMPARISON_VERSION_V1,
  type WorldviewTextBlockStatusV1,
} from '../../lib/agent/worldview-text-comparison'

const STATUS_LABELS: Record<WorldviewTextBlockStatusV1, string> = {
  unchanged: '原块保留',
  'possibly-rewritten': '可能改写',
  removed: '原块未出现',
  added: '新增块',
}

function baselineValue(candidate: PendingMasterCandidate, field: string): unknown {
  const snapshot = candidate.payload.baseSnapshot as { values?: Record<string, unknown> } | null
  return snapshot?.values?.[field] ?? ''
}

function serializeWithValue(candidate: WorldviewFieldCopilotCandidate, value: unknown): string {
  return JSON.stringify({ ...candidate, value }, null, 2)
}

export default function WorldviewFieldCandidateReview({
  candidate,
  busy,
  visibleDraft,
  onUpdate,
  onInvalidEdit,
}: {
  candidate: PendingMasterCandidate
  busy: boolean
  visibleDraft?: VisibleMasterCandidateDraftV1
  onUpdate: (content: string, rawValue: string) => void
  onInvalidEdit?: (rawValue: string, error: string) => void
}) {
  const parsed = useMemo(() => {
    try { return parseWorldviewFieldCandidateDraft(candidate.event.content) }
    catch { return null }
  }, [candidate.event.content])
  const savedValue = typeof parsed?.value === 'string' ? parsed.value : JSON.stringify(parsed?.value ?? {}, null, 2)
  const [localValue, setLocalValue] = useState(savedValue)
  const draftValue = visibleDraft?.rawValue ?? (onInvalidEdit ? savedValue : localValue)
  const [showChangesOnly, setShowChangesOnly] = useState(false)
  const [syncScroll, setSyncScroll] = useState(true)
  const leftRef = useRef<HTMLTextAreaElement | null>(null)
  const rightRef = useRef<HTMLTextAreaElement | null>(null)
  const syncing = useRef(false)
  const composing = useRef(false)

  useEffect(() => {
    setLocalValue(savedValue)
  }, [candidate.event.id, savedValue])

  const edit = (raw: string) => {
    setLocalValue(raw)
    let content: string
    try {
      const value = parsed && typeof parsed.value !== 'string' ? JSON.parse(raw) : raw
      content = parsed ? serializeWithValue(parsed, value) : raw
      const validated = parseWorldviewFieldCandidateDraft(content)
      const field = parsed?.field ?? candidate.payload.worldviewField
      if (field && validated.field !== field) throw new Error('不能修改候选对应的世界字段。')
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      onInvalidEdit?.(raw, cause instanceof SyntaxError ? `对象 JSON 无效：${detail}` : detail)
      return
    }
    onUpdate(content, raw)
  }

  const compositionError = '正在组合输入，请先完成输入或放弃本次修改。'
  const editEvents = {
    onCompositionStartCapture: (event: CompositionEvent<HTMLTextAreaElement>) => {
      composing.current = true
      onInvalidEdit?.(event.currentTarget.value, compositionError)
    },
    onCompositionEndCapture: () => { composing.current = false },
    onInputCapture: (event: FormEvent<HTMLTextAreaElement>) => {
      if (composing.current) onInvalidEdit?.(event.currentTarget.value, compositionError)
    },
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => edit(event.target.value),
  }

  if (!parsed) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-error">历史候选无法解析为字段 artifact；请修复结构后再采纳。</p>
        <CTextarea
          aria-label={`${candidate.payload.label}候选原始内容`}
          value={visibleDraft?.rawValue ?? candidate.event.content}
          disabled={busy}
          aria-invalid={visibleDraft?.status === 'blocked'}
          {...editEvents}
          className="min-h-48 w-full resize-y font-mono text-xs leading-5"
        />
      </div>
    )
  }

  if (typeof parsed.value !== 'string') {
    return (
      <div className="space-y-1">
        <p className="text-[10px] text-text-muted">只编辑当前字段的 value 对象；外层 field 合同由 Harness 保管。</p>
        <CTextarea
          aria-label={`${candidate.payload.label}候选内容`}
          value={draftValue}
          disabled={busy}
          aria-invalid={visibleDraft?.status === 'blocked'}
          {...editEvents}
          className="min-h-48 w-full resize-y font-mono text-xs leading-5"
        />
      </div>
    )
  }

  const original = String(baselineValue(candidate, parsed.field) ?? '')
  const operation: WorldviewFieldOperationV1 = candidate.payload.worldviewFieldOperation
    ?? (original.trim() ? 'expand' : 'create')
  const comparison = compareWorldviewTextBlocksV1(original, draftValue)
  const rows = showChangesOnly
    ? comparison.rows.filter(row => row.status !== 'unchanged')
    : comparison.rows

  const sync = (source: 'left' | 'right', event: UIEvent<HTMLTextAreaElement>) => {
    if (!syncScroll || syncing.current) return
    const target = source === 'left' ? rightRef.current : leftRef.current
    if (!target) return
    syncing.current = true
    const current = event.currentTarget
    const denominator = Math.max(1, current.scrollHeight - current.clientHeight)
    target.scrollTop = (current.scrollTop / denominator) * Math.max(0, target.scrollHeight - target.clientHeight)
    requestAnimationFrame(() => { syncing.current = false })
  }
  const editor = (
    <CTextarea
      ref={rightRef}
      aria-label={`${candidate.payload.label}候选内容`}
      value={draftValue}
      disabled={busy}
      onScroll={event => sync('right', event)}
      aria-invalid={visibleDraft?.status === 'blocked'}
      {...editEvents}
      className="min-h-56 w-full resize-y text-xs leading-5"
    />
  )

  return (
    <div className="space-y-3">
      {parsed.temporaryAssumptions?.length ? (
        <div className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
          <p className="font-medium text-warning">本轮临时假设（不会随正文自动写入 Canon）</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-secondary">
            {parsed.temporaryAssumptions.map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}

      {operation === 'create' ? (
        <div>
          <p className="mb-1 text-[10px] text-text-muted">新建候选正文</p>
          {editor}
        </div>
      ) : operation === 'rewrite' ? (
        <div className="space-y-2">
          <p className="text-[10px] text-text-muted">重写以新版为主；旧版保留供随时回看。</p>
          {editor}
          <details className="rounded border border-border bg-bg-base px-3 py-2">
            <summary className="cursor-pointer text-xs text-text-secondary">查看重写前原文</summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted">{original || '（原字段为空）'}</pre>
          </details>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[10px] text-text-muted">原文（只读）</span>
            <CTextarea
              ref={leftRef}
              aria-label={`${candidate.payload.label}原文`}
              value={original}
              readOnly
              onScroll={event => sync('left', event)}
              className="min-h-56 w-full resize-y bg-bg-base text-xs leading-5"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-text-muted">{operation === 'polish' ? '润色后' : '扩写后'}（可编辑）</span>
            {editor}
          </label>
        </div>
      )}

      {(operation === 'expand' || operation === 'polish') && (
        <div className="rounded border border-border bg-bg-base p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-text-primary">文本块对照</p>
              <p className="text-[10px] text-text-muted">
                这是保守的结构/相似度提示，不是事实校验。算法 {WORLDVIEW_TEXT_COMPARISON_VERSION_V1}
              </p>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-text-secondary">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={syncScroll} onChange={event => setSyncScroll(event.target.checked)} />
                同步滚动
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showChangesOnly} onChange={event => setShowChangesOnly(event.target.checked)} />
                只看变化
              </label>
            </div>
          </div>
          <div className="mt-2 space-y-2">
            {rows.length ? rows.map(row => (
              <div key={row.id} className="grid grid-cols-1 gap-2 rounded border border-border/70 p-2 lg:grid-cols-2">
                <div>
                  <span className="text-[10px] text-text-muted">{STATUS_LABELS[row.status]}</span>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{row.original || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-text-muted">
                    候选{row.similarity == null ? '' : ` · 相似度 ${Math.round(row.similarity * 100)}%`}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-text-primary">{row.candidate || '—'}</p>
                </div>
              </div>
            )) : <p className="text-xs text-text-muted">没有可显示的变化。</p>}
          </div>
        </div>
      )}
    </div>
  )
}
