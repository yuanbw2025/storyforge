import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodexEntry } from '../../lib/types/codex'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { hashCodexLocalSaveValueV1, matchingCodexLocalSaveIdentityV1, type CodexLocalSaveContractV1, type CodexLocalSaveWitnessV1 } from '../../lib/authoring/codex-local-save-evidence'

export type SaveCodexDraft = (patch: Partial<CodexEntry>, expected?: CodexEntry) => void | CodexEntry | Promise<void | CodexEntry>

/** Keep the author's copy until the original record acknowledges every patch. */
export function useCodexEntryDraft(record: CodexEntry, save: SaveCodexDraft, localSave?: CodexLocalSaveContractV1) {
  const witness = localSave?.witness, witnessScope = localSave?.scope
  const [draft, setDraft] = useState(record)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [composing, setComposing] = useState(false)
  const [confirmed, setConfirmed] = useState<{ value: CodexEntry; witness: CodexLocalSaveWitnessV1 } | null>(null)
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
  useEffect(() => {
    let active = true
    setConfirmed(null)
    const current = value.current
    if (witnessScope && !saving && !error && !composing && !Object.keys(pending.current).length
      && matchingCodexLocalSaveIdentityV1(current, { scope: witnessScope, witness: witness ?? null })) {
      void hashCodexLocalSaveValueV1(current).then(hash => {
        if (active && value.current === current && !inFlight.current && !Object.keys(pending.current).length
          && !errorRef.current && !composingRef.current && hash === witness!.valueHash) setConfirmed({ value: current, witness: witness! })
      }).catch(() => { /* A failed check never grants saved status. */ })
    }
    return () => { active = false }
  }, [draft, saving, error, composing, witness, witnessScope])
  useEffect(() => () => { void flush().catch(() => undefined) }, [flush])
  useBeforeUnload(composing || saving || Boolean(error) || Object.keys(pending.current).length > 0)
  return {
    draft, change, saving, error, flush,
    localSaveStatus: saving ? 'saving' : error ? 'failed' : composing || Object.keys(pending.current).length ? 'dirty'
      : confirmed?.value === draft && confirmed.witness === witness && witnessScope
        && matchingCodexLocalSaveIdentityV1(draft, { scope: witnessScope, witness: witness ?? null }) ? 'saved' : 'unconfirmed',
    composition: {
      onCompositionStartCapture: () => { if (!inFlight.current && !Object.keys(pending.current).length) activeSave.current = saveRef.current; composingRef.current = true; setComposing(true) },
      onCompositionEndCapture: () => { composingRef.current = false; setComposing(false) },
    },
  }
}
