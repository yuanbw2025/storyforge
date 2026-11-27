import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import MarkdownReadView from './MarkdownReadView'

/** Presentation around an existing editor. Original handlers own every change;
 * only their committed flush can end editing. */
export default function MarkdownDraftField({ value, disabled, onCommit, children, label = '候选', editRequest, onEditorReady }: {
  value: string
  disabled: boolean
  onCommit: () => Promise<void>
  children: ReactNode
  label?: string
  editRequest?: number
  onEditorReady?: (editor: HTMLTextAreaElement) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unsynced, setUnsynced] = useState(false)
  const active = useRef(false), composing = useRef(false), revision = useRef(0)
  const editorRoot = useRef<HTMLDivElement>(null)
  const save = useRef(onCommit), editingSave = useRef(onCommit)
  const editorReady = useRef(onEditorReady)
  editorReady.current = onEditorReady
  const inFlight = useRef<Promise<void> | null>(null)
  save.current = onCommit
  useBeforeUnload(unsynced || active.current && revision.current > 0 || saving || Boolean(error))
  const commit = useCallback((): Promise<void> => {
    if (!active.current) return Promise.resolve()
    if (composing.current) return Promise.reject(new Error(`输入法仍在组合文字，请完成输入后再保存${label}。`))
    if (inFlight.current) return inFlight.current.then(() => commit())
    const generation = revision.current
    setSaving(true); setError('')
    const operation = Promise.resolve().then(() => editingSave.current()).then(() => {
      if (!composing.current && revision.current === generation) {
        active.current = false; setEditing(false); setUnsynced(false)
      }
    }).catch(cause => {
      setError(cause instanceof Error ? cause.message : `${label}草稿同步失败，请重试。`)
      throw cause
    }).finally(() => { inFlight.current = null; setSaving(false) })
    inFlight.current = operation
    return operation.then(() => commit())
  }, [label])
  const begin = useCallback(() => {
    if (active.current) return
    editingSave.current = save.current; active.current = true; revision.current = 0; setError(''); setEditing(true)
  }, [])
  const previousRequest = useRef(editRequest)
  useEffect(() => {
    if (previousRequest.current === editRequest) return
    previousRequest.current = editRequest
    if (!disabled) begin()
  }, [editRequest, disabled, begin])
  useEffect(() => registerPendingDraftFlusherV1(commit), [commit])
  useEffect(() => {
    const editor = editing ? editorRoot.current?.querySelector('textarea') : null
    if (editor) { editor.focus({ preventScroll: true }); editorReady.current?.(editor) }
  }, [editing])
  const finish = () => { void commit().catch(() => undefined) }
  if (!editing) return <MarkdownReadView value={value} readOnly={disabled} onRequestEdit={begin} />
  return <div ref={editorRoot} className="min-w-0" onInputCapture={() => { revision.current++ }}
    onCompositionStartCapture={() => { composing.current = true; setUnsynced(true) }}
    onCompositionEndCapture={() => { composing.current = false; revision.current++ }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish()
    }}>
    {children}
    {saving && <p role="status" className="text-xs text-text-muted">正在同步{label}草稿…</p>}
    {error && <p role="alert" className="text-xs text-error">未保存：{error} 输入已保留。</p>}
    <button type="button" disabled={disabled || saving} onClick={finish} className="mt-1 text-xs text-accent">
      {error ? `重试同步${label}` : '保存后阅读'}
    </button>
  </div>
}
