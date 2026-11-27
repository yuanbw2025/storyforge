import AutoResizeTextarea from './AutoResizeTextarea'
import { CInput, CTextarea } from './CompositionInput'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import MarkdownReadView from './MarkdownReadView'

import { LocalSaveStatus } from './InlineEdit'
import { localSaveIdentityKeyV1, matchingLocalSaveAckV1, type LocalSaveContractV1, type LocalSaveIntentV1, type LocalSaveAckV1, type LocalSaveWitnessV1 } from '../../lib/authoring/local-save-evidence'

export interface AcknowledgedTextFieldProps {
  localSave?: LocalSaveContractV1
  label: string
  rows?: number
  value: unknown
  onCommit: (value: string, expected: unknown, intent?: LocalSaveIntentV1) => void | Promise<void | LocalSaveAckV1>
  input?: boolean
  inputType?: 'text' | 'number'
  autoGrow?: boolean
  choices?: ReadonlyArray<{ value: string; label: string }>
  placeholder?: string
  className?: string
  markdownRead?: boolean
}

export default function AcknowledgedTextField({ label, rows, value, onCommit, input, inputType, autoGrow, choices, placeholder, className, markdownRead = false, localSave }: AcknowledgedTextFieldProps) {
  const contractRef = useRef(localSave), editContract = useRef(localSave)
  contractRef.current = localSave
  const expectedWitness = useRef<LocalSaveWitnessV1 | null>(null)
  const generation = useRef(0), session = useRef('')
  const [confirmed, setConfirmed] = useState<LocalSaveWitnessV1 | null>(null)
  const markdownEnabled = markdownRead && !input && !choices
  const [reading, setReading] = useState(true)
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
  const flushDraft = useCallback((retry = false): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!dirty.current && !inFlight.current && !composingRef.current && !errorRef.current) return Promise.resolve()
    if (errorRef.current && !retry) return Promise.reject(new Error(errorRef.current))
    if (!readableRef.current) return Promise.reject(new Error('原文格式异常，已保留原数据，请先恢复。'))
    if (composingRef.current) return Promise.reject(new Error('输入法仍在组合文字，请完成后保存。'))
    if (inFlight.current) return inFlight.current
    if (!dirty.current || (draftRef.current === baseline.current && !errorRef.current)) return Promise.resolve()
    const confirmAfterFailure = Boolean(errorRef.current)
    errorRef.current = ''; setSaving(true); setError('')
    const operation = Promise.resolve().then(async () => {
      let first = confirmAfterFailure
      while (first || (dirty.current && draftRef.current !== baseline.current)) {
        if (composingRef.current) break
        first = false
        const text = draftRef.current
        const contract = editContract.current
        const expected = expectedWitness.current
        const intent: LocalSaveIntentV1 | undefined = contract ? (() => {
          if (!expected || !contractRef.current || localSaveIdentityKeyV1(contract.identity) !== localSaveIdentityKeyV1(contractRef.current.identity))
            throw new Error('原保存记录已变化，输入已保留。')
          session.current ||= crypto.randomUUID()
          return { kind: 'natural-field-local-save-v1', expected, session: session.current, generation: ++generation.current }
        })() : undefined
        const ack = intent ? await editCommit.current(text, sourceBaseline.current, intent) : await editCommit.current(text, sourceBaseline.current)
        if (intent) {
          if (!matchingLocalSaveAckV1(ack, intent, text)) throw new Error('未收到相同原文的本机提交凭据，输入已保留。')
          expectedWitness.current = ack.witness
          setConfirmed(ack.witness)
        }
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
    setConfirmed(current => {
      const matches = (witness: LocalSaveWitnessV1 | null | undefined) => witness?.present && witness.recordId != null && witness.value === value
        && localSave && localSaveIdentityKeyV1(witness.identity) === localSaveIdentityKeyV1(localSave.identity)
      return matches(current) && current?.source === 'committed-write' ? current : matches(localSave?.witness) ? localSave!.witness : null
    })
  }, [value, readable, localSave])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (dirty.current && !composingRef.current) void flushDraft().catch(() => undefined)
  }, [flushDraft])
  useBeforeUnload(dirty.current || saving || composing || Boolean(error))
  if (!readable) return <div role="alert" className="flex-1 text-xs text-amber-400">{label}格式异常，原数据已保留；恢复前暂停此项编辑。</div>
  const finishReading = (retry = false) => {
    void flushDraft(retry).then(() => {
      if (!dirty.current && !inFlight.current && !composingRef.current && !errorRef.current) setReading(true)
    }).catch(() => undefined)
  }
  const status = error ? 'failed' : saving ? 'saving' : dirty.current || composing || (confirmed && confirmed.value !== draft) ? 'dirty'
    : confirmed?.present && confirmed.value === draft && localSave && localSaveIdentityKeyV1(confirmed.identity) === localSaveIdentityKeyV1(localSave.identity) ? 'saved' : 'unconfirmed'
  const feedback = localSave ? <LocalSaveStatus status={status} error={error} retryLabel={`重试保存${label}`} retry={() => finishReading(true)} /> : null
  if (markdownEnabled && reading && draft.length > 0 && !dirty.current && !saving && !composing && !error) {
    return <div className="flex-1 min-w-0 text-xs text-text-primary"><MarkdownReadView value={draft} onRequestEdit={() => setReading(false)} />{feedback}</div>
  }
  const controlProps = {
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      if (markdownEnabled) setReading(false)
      if (!dirty.current && !inFlight.current) {
        editCommit.current = latestCommit.current
        editContract.current = contractRef.current
        expectedWitness.current = confirmed?.value === draftRef.current ? confirmed : contractRef.current?.witness ?? null
      }
      const text = event.target.value
      draftRef.current = text; dirty.current = text !== baseline.current || Boolean(errorRef.current); setDraft(text)
      if (timer.current) clearTimeout(timer.current)
      if (!error) timer.current = setTimeout(() => { void flushDraft().catch(() => undefined) }, 400)
    },
    onBlur: () => { if (!errorRef.current) finishReading() },
    autoFocus: markdownEnabled && !reading,
    placeholder: placeholder ?? `${label}…`,
    'aria-label': label,
    className: className ?? 'w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary resize-y focus:outline-none focus:border-accent',
  }
  return (
    <div className="flex-1 min-w-0" onCompositionStartCapture={() => { composingRef.current = true; setComposing(true) }} onCompositionEndCapture={() => { composingRef.current = false; setComposing(false); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { if (dirty.current && !errorRef.current) void flushDraft().catch(() => undefined) }, 0) }}>
      {choices ? <select {...controlProps} disabled={saving}>{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select> : input ? <CInput {...controlProps} type={inputType} /> : autoGrow ? <AutoResizeTextarea {...controlProps} minRows={rows ?? 1} maxRows={10} /> : <CTextarea {...controlProps} rows={rows} />}
      {feedback}
      {!localSave && <p role={saving ? 'status' : undefined} aria-hidden={!saving} className="min-h-4 text-xs text-text-muted">{saving ? '正在保存…' : '\u00a0'}</p>}
      {!localSave && error && <div role="alert" className="text-xs text-red-400">{error}；输入已保留。
        <button type="button" onClick={() => finishReading(true)} className="ml-2 underline">重试保存{label}</button>
      </div>}
    </div>
  )
}
