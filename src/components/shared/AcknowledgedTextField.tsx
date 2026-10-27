import AutoResizeTextarea from './AutoResizeTextarea'
import { CInput, CTextarea } from './CompositionInput'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'

export interface AcknowledgedTextFieldProps {
  label: string
  rows?: number
  value: unknown
  onCommit: (value: string, expected: unknown) => void | Promise<void>
  input?: boolean
  autoGrow?: boolean
  choices?: ReadonlyArray<{ value: string; label: string }>
  placeholder?: string
  className?: string
}

export default function AcknowledgedTextField({ label, rows, value, onCommit, input, autoGrow, choices, placeholder, className }: AcknowledgedTextFieldProps) {
  const readable = value === undefined || typeof value === 'string'
  const initial = typeof value === 'string' ? value : ''
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState('')
  const errorRef = useRef('')
  const [saving, setSaving] = useState(false)
  const [composing, setComposing] = useState(false)
  const draftRef = useRef(initial), baseline = useRef(initial)
  const sourceBaseline = useRef(value)
  const dirty = useRef(false), readableRef = useRef(readable), composingRef = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const latestCommit = useRef(onCommit), editCommit = useRef(onCommit)
  latestCommit.current = onCommit; readableRef.current = readable
  const flushDraft = useCallback((): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!dirty.current && !inFlight.current && !composingRef.current && !errorRef.current) return Promise.resolve()
    if (!readableRef.current) return Promise.reject(new Error('原文格式异常，已保留原数据，请先恢复。'))
    if (composingRef.current) return Promise.reject(new Error('输入法仍在组合文字，请完成后保存。'))
    if (inFlight.current) return inFlight.current
    if (!dirty.current || (draftRef.current === baseline.current && !errorRef.current)) return Promise.resolve()
    const confirmAfterFailure = Boolean(errorRef.current)
    errorRef.current = ''; setSaving(true); setError('')
    const operation = Promise.resolve().then(async () => {
      let first = confirmAfterFailure
      while (first || (dirty.current && draftRef.current !== baseline.current)) {
        first = false
        const text = draftRef.current
        await editCommit.current(text, sourceBaseline.current)
        sourceBaseline.current = text
        baseline.current = text
        dirty.current = draftRef.current !== text
      }
    }).catch(cause => {
      dirty.current = true
      errorRef.current = cause instanceof Error ? cause.message : '文字保存失败，输入已保留。'
      setError(errorRef.current)
      throw cause
    }).finally(() => { inFlight.current = null; setSaving(false) })
    inFlight.current = operation
    return operation
  }, [])
  useEffect(() => registerPendingDraftFlusherV1(flushDraft), [flushDraft])
  useEffect(() => {
    if (dirty.current || inFlight.current || composingRef.current || !readable) return
    const text = typeof value === 'string' ? value : ''
    baseline.current = text; sourceBaseline.current = value; draftRef.current = text; setDraft(text)
  }, [value, readable])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (dirty.current && !composingRef.current) void flushDraft().catch(() => undefined)
  }, [flushDraft])
  useBeforeUnload(dirty.current || saving || composing || Boolean(error))
  if (!readable) return <div role="alert" className="flex-1 text-xs text-amber-400">{label}格式异常，原数据已保留；恢复前暂停此项编辑。</div>
  const controlProps = {
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      if (!dirty.current && !inFlight.current) editCommit.current = latestCommit.current
      const text = event.target.value
      draftRef.current = text; dirty.current = text !== baseline.current || Boolean(errorRef.current); setDraft(text)
      if (timer.current) clearTimeout(timer.current)
      if (!error) timer.current = setTimeout(() => { void flushDraft().catch(() => undefined) }, 400)
    },
    onBlur: () => { if (!error) void flushDraft().catch(() => undefined) },
    placeholder: placeholder ?? `${label}…`,
    'aria-label': label,
    className: className ?? 'w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary resize-y focus:outline-none focus:border-accent',
  }
  return (
    <div className="flex-1 min-w-0" onCompositionStartCapture={() => { composingRef.current = true; setComposing(true) }} onCompositionEndCapture={() => { composingRef.current = false; setComposing(false) }}>
      {choices ? <select {...controlProps} disabled={saving}>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select> : input ? <CInput {...controlProps} /> : autoGrow ? <AutoResizeTextarea {...controlProps} minRows={rows ?? 1} maxRows={10} /> : <CTextarea {...controlProps} rows={rows} />}
      {saving && <p role="status" className="text-xs text-text-muted">正在保存…</p>}
      {error && <div role="alert" className="text-xs text-red-400">{error}；输入已保留。
        <button type="button" onClick={() => { void flushDraft().catch(() => undefined) }} className="ml-2 underline">重试保存{label}</button>
      </div>}
    </div>
  )
}

