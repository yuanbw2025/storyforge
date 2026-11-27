import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import MarkdownReadView from '../shared/MarkdownReadView'

/** Presentation around the original candidate editor. Its original handlers
 * still queue every change; only that queue's committed flush can end editing. */
export default function CandidateMarkdownField({ value, disabled, onCommit, children }: {
  value: string
  disabled: boolean
  onCommit: () => Promise<void>
  children: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(false), composing = useRef(false), revision = useRef(0)
  const editorRoot = useRef<HTMLDivElement>(null)
  const save = useRef(onCommit), editingSave = useRef(onCommit)
  const inFlight = useRef<Promise<void> | null>(null)
  save.current = onCommit
  useBeforeUnload(editing)
  const commit = useCallback((): Promise<void> => {
    if (!active.current) return Promise.resolve()
    if (composing.current) return Promise.reject(new Error('输入法仍在组合文字，请完成输入后再保存候选。'))
    if (inFlight.current) return inFlight.current.then(() => commit())
    const generation = revision.current
    setSaving(true); setError('')
    const operation = Promise.resolve().then(() => editingSave.current()).then(() => {
      if (!composing.current && revision.current === generation) {
        active.current = false; setEditing(false)
      }
    }).catch(cause => {
      setError(cause instanceof Error ? cause.message : '候选草稿同步失败，请重试。')
      throw cause
    }).finally(() => { inFlight.current = null; setSaving(false) })
    inFlight.current = operation
    return operation.then(() => commit())
  }, [])
  useEffect(() => registerPendingDraftFlusherV1(commit), [commit])
  useEffect(() => { if (editing) editorRoot.current?.querySelector('textarea')?.focus({ preventScroll: true }) }, [editing])
  const finish = () => { void commit().catch(() => undefined) }
  if (!editing) return <MarkdownReadView value={value} readOnly={disabled} onRequestEdit={() => {
    editingSave.current = save.current; active.current = true; setError(''); setEditing(true)
  }} />
  return <div ref={editorRoot} className="min-w-0" onInputCapture={() => { revision.current++ }}
    onCompositionStartCapture={() => { composing.current = true }}
    onCompositionEndCapture={() => { composing.current = false; revision.current++ }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish()
    }}>
    {children}
    {saving && <p role="status" className="text-xs text-text-muted">正在同步候选草稿…</p>}
    {error && <p role="alert" className="text-xs text-error">未保存：{error} 输入已保留。</p>}
    <button type="button" disabled={disabled || saving} onClick={finish} className="mt-1 text-xs text-accent">
      {error ? '重试同步候选' : '保存后阅读'}
    </button>
  </div>
}
