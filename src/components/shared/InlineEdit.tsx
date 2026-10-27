/** 行内作者编辑：失焦保存，失败保留输入，切页等待同一次写入。 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { containTextareaWheel, parseCssPixels } from './textarea-scroll'

type InlineSave = (value: string) => void | Promise<void>

/** UI draft state only; persistence remains with the registered domain caller. */
function useInlineDraft(value: string, onChange: InlineSave) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [baseline, setBaseline] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const composingRef = useRef(false)
  const editingRef = useRef(false)
  const draftRef = useRef(value)
  const baselineRef = useRef(value)
  const latestValueRef = useRef(value)
  const latestSaveRef = useRef(onChange)
  const editSaveRef = useRef(onChange)
  const savingRef = useRef<Promise<void> | null>(null)
  const errorRef = useRef('')
  latestValueRef.current = value
  latestSaveRef.current = onChange

  useEffect(() => {
    if (editingRef.current || savingRef.current) return
    draftRef.current = value
    baselineRef.current = value
    setDraft(value)
    setBaseline(value)
  }, [value])
  useBeforeUnload(saving || (editing && (draft !== baseline || Boolean(error))))

  const begin = () => {
    draftRef.current = latestValueRef.current
    baselineRef.current = latestValueRef.current
    editSaveRef.current = latestSaveRef.current
    editingRef.current = true
    setDraft(draftRef.current)
    setBaseline(baselineRef.current)
    errorRef.current = ''
    setError('')
    setEditing(true)
  }
  const change = (next: string) => { draftRef.current = next; setDraft(next) }
  const commit = useCallback((): Promise<void> => {
    if (savingRef.current) return savingRef.current
    if (!editingRef.current) return Promise.resolve()
    if (composingRef.current) return Promise.reject(new Error('输入法仍在组合文字，请完成输入后再保存。'))
    const text = draftRef.current
    if (text === baselineRef.current && !errorRef.current) {
      editingRef.current = false
      setEditing(false)
      return Promise.resolve()
    }
    const save = editSaveRef.current
    setSaving(true)
    errorRef.current = ''
    setError('')
    const operation = Promise.resolve().then(() => save(text)).then(() => {
      baselineRef.current = text
      setBaseline(text)
      if (draftRef.current === text) { editingRef.current = false; setEditing(false) }
    }).catch(cause => {
      const message = cause instanceof Error ? cause.message : '保存失败，请重试。'
      errorRef.current = message
      setError(message)
      editingRef.current = true
      setEditing(true)
      throw cause
    }).finally(() => { savingRef.current = null; setSaving(false) })
    savingRef.current = operation
    return operation
  }, [])
  useEffect(() => registerPendingDraftFlusherV1(commit), [commit])
  useEffect(() => () => {
    // Navigation normally flushes first. Keep the original target for a caller
    // that unmounts directly, and observe rejection rather than leaking it.
    if (editingRef.current && !composingRef.current) void commit().catch(() => undefined)
  }, [commit])
  const cancel = () => {
    // A failed write must remain visible and retryable; Escape cannot silently
    // discard the only surviving copy of the author's input.
    if (savingRef.current || errorRef.current || composingRef.current) return
    draftRef.current = latestValueRef.current
    editingRef.current = false
    setDraft(draftRef.current)
    setEditing(false)
  }
  const saveFromEvent = () => { void commit().catch(() => undefined) }
  return { editing, draft, saving, error, begin, change, cancel, commit, saveFromEvent, composingRef }
}

function InlineSaveStatus({ error, saving, retry }: { error: string; saving: boolean; retry: () => void }) {
  return <>
    {saving && <span role="status" className="mt-1 block text-xs text-text-muted">正在保存…</span>}
    {error && <div className="mt-1 text-xs text-error">
      <p role="alert">未保存：{error} 输入已保留。</p>
      <button type="button" onClick={retry} className="mt-1 underline" disabled={saving}>重试保存</button>
    </div>}
  </>
}

export function InlineInput({ value, onChange, placeholder, className, prefix, suffix }: {
  value: string; onChange: InlineSave; placeholder?: string; className?: string; prefix?: string; suffix?: string
}) {
  const editor = useInlineDraft(value, onChange)
  if (editor.editing) return <div className="min-w-0">
    <input value={editor.draft} disabled={editor.saving}
      onCompositionStart={() => { editor.composingRef.current = true }}
      onCompositionEnd={event => { editor.composingRef.current = false; editor.change(event.currentTarget.value) }}
      onChange={event => editor.change(event.target.value)} onBlur={editor.saveFromEvent}
      onKeyDown={event => {
        if (editor.composingRef.current || event.nativeEvent.isComposing) return
        if (event.key === 'Escape') editor.cancel()
        if (event.key === 'Enter') { event.preventDefault(); editor.saveFromEvent() }
      }} placeholder={placeholder} autoFocus
      className={`bg-transparent border-b border-accent/50 outline-none w-full ${className || ''}`} />
    <InlineSaveStatus error={editor.error} saving={editor.saving} retry={editor.saveFromEvent} />
  </div>
  return <div onClick={editor.begin} className={`cursor-text min-h-[1.2em] ${className || ''} ${value ? '' : 'opacity-40'}`}>
    {value ? <>{prefix}{value}{suffix}</> : placeholder || '点击编辑…'}
  </div>
}

export function InlineTextarea({ value, onChange, placeholder, className, minRows = 2, maxRows = 16 }: {
  value: string; onChange: InlineSave; placeholder?: string; className?: string; minRows?: number; maxRows?: number
}) {
  const editor = useInlineDraft(value, onChange)
  const ref = useRef<HTMLTextAreaElement>(null)
  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const computed = getComputedStyle(el)
    const lineHeight = parseCssPixels(computed.lineHeight) || 20
    const paddingY = parseCssPixels(computed.paddingTop) + parseCssPixels(computed.paddingBottom)
    const minHeight = lineHeight * minRows + paddingY
    const maxHeight = lineHeight * maxRows + paddingY
    const height = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight))
    el.style.height = `${height}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [maxRows, minRows])
  useEffect(() => { if (editor.editing) resize() }, [editor.draft, editor.editing, resize])
  if (editor.editing) return <div className="min-w-0">
    <textarea ref={ref} value={editor.draft} disabled={editor.saving}
      onCompositionStart={() => { editor.composingRef.current = true }}
      onCompositionEnd={event => { editor.composingRef.current = false; editor.change(event.currentTarget.value) }}
      onChange={event => editor.change(event.target.value)} onWheel={containTextareaWheel} onBlur={editor.saveFromEvent}
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) editor.cancel() }}
      placeholder={placeholder} autoFocus
      className={className || 'w-full bg-transparent border border-accent/30 rounded px-2 py-1 text-sm text-text-primary outline-none resize-none'} />
    <InlineSaveStatus error={editor.error} saving={editor.saving} retry={editor.saveFromEvent} />
  </div>
  return <div onClick={editor.begin} className={`text-sm cursor-text py-0.5 ${value ? 'text-text-primary leading-relaxed whitespace-pre-wrap' : 'text-text-muted/40'}`}>
    {value || placeholder || '点击编辑…'}
  </div>
}
