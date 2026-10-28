import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodexEntry } from '../../lib/types/codex'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'

export type SaveCodexDraft = (patch: Partial<CodexEntry>, expected?: CodexEntry) => void | CodexEntry | Promise<void | CodexEntry>

/** Keep the author's copy until the original record acknowledges every patch. */
export function useCodexEntryDraft(record: CodexEntry, save: SaveCodexDraft) {
  const [draft, setDraft] = useState(record)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [composing, setComposing] = useState(false)
  const value = useRef(record), baseline = useRef(record)
  const pending = useRef<Partial<CodexEntry>>({})
  const saveRef = useRef(save), activeSave = useRef(save)
  const inFlight = useRef<Promise<void> | null>(null)
  const errorRef = useRef(''), composingRef = useRef(false)
  saveRef.current = save
  const flush = useCallback((): Promise<void> => {
    if (composingRef.current) return Promise.reject(new Error('输入法仍在组合文字，请完成输入后再保存词条。'))
    if (inFlight.current) return inFlight.current
    if (!Object.keys(pending.current).length) return Promise.resolve()
    errorRef.current = ''; setError(''); setSaving(true)
    const operation = Promise.resolve().then(async () => {
      while (Object.keys(pending.current).length) {
        const patch = pending.current
        pending.current = {}
        try {
          const written = await activeSave.current(patch, baseline.current)
          baseline.current = written || { ...baseline.current, ...patch }
          if (!Object.keys(pending.current).length) { value.current = baseline.current; setDraft(value.current) }
        } catch (cause) {
          pending.current = { ...patch, ...pending.current }
          errorRef.current = cause instanceof Error ? cause.message : '词条保存失败，请重试。'
          setError(errorRef.current)
          throw cause
        }
      }
    }).finally(() => { inFlight.current = null; setSaving(false) })
    inFlight.current = operation
    return operation
  }, [])
  const change = (patch: Partial<CodexEntry> | ((latest: CodexEntry) => Partial<CodexEntry>)) => {
    if (!inFlight.current && !Object.keys(pending.current).length) activeSave.current = saveRef.current
    const next = typeof patch === 'function' ? patch(value.current) : patch
    value.current = { ...value.current, ...next }; setDraft(value.current)
    pending.current = { ...pending.current, ...next }
    // After a failure only an explicit retry or the visible navigation barrier
    // may retry; ordinary typing cannot silently keep resending writes.
    if (!errorRef.current) void flush().catch(() => undefined)
  }
  useEffect(() => {
    if (!composingRef.current && !inFlight.current && !Object.keys(pending.current).length && !errorRef.current) {
      baseline.current = record; value.current = record; setDraft(record)
    }
  }, [record])
  useEffect(() => registerPendingDraftFlusherV1(flush), [flush])
  useEffect(() => () => { void flush().catch(() => undefined) }, [flush])
  useBeforeUnload(composing || saving || Boolean(error) || Object.keys(pending.current).length > 0)
  return {
    draft, change, saving, error, flush,
    composition: {
      onCompositionStartCapture: () => { if (!inFlight.current && !Object.keys(pending.current).length) activeSave.current = saveRef.current; composingRef.current = true; setComposing(true) },
      onCompositionEndCapture: () => { composingRef.current = false; setComposing(false) },
    },
  }
}
