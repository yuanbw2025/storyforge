import { useCallback, useEffect, useRef, useState } from 'react'
import type { CharacterDrivenPlan, CharacterDrivenPlanArc, WorkspaceScope } from '../../lib/types'
import { useCharacterDrivenPlanStore } from '../../stores/character-driven-plan'
import { assertCharacterDrivenInputExpectedV1, characterDrivenInputKeyV1, characterDrivenPlanInputKeyV1, characterDrivenPlanUidV1, readCharacterDrivenInputSourceV1 } from '../../lib/authoring/character-driven-input-save'
import { parseCharacterDrivenPlanArcs } from '../../lib/types'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'

type Input = { arcs: CharacterDrivenPlanArc[]; userHint: string }
const empty = (): Input => ({ arcs: [], userHint: '' })

/** Local form drafts only. The original plan store owns every write. */
export function useCharacterDrivenInputDraft(plan: CharacterDrivenPlan | null, scope: WorkspaceScope | undefined, confirmed: boolean) {
  const saveInputs = useCharacterDrivenPlanStore().saveInputs
  const save = useRef(saveInputs); save.current = saveInputs
  const [input, setInput] = useState<Input>(empty)
  const [error, setError] = useState(''), [readError, setReadError] = useState('')
  const [saving, setSaving] = useState(false), [composing, setComposing] = useState(false), [sourceReady, setSourceReady] = useState(false)
  const [saved, setSaved] = useState<CharacterDrivenPlan | null>(null)
  const draft = useRef<Input>(empty()), baseline = useRef(''), dirty = useRef(false), failed = useRef(''), composition = useRef(false)
  const pending = useRef<Promise<void> | null>(null)
  const owner = useRef<{ key: string; scope?: WorkspaceScope; row: CharacterDrivenPlan; confirmed: boolean; save: typeof saveInputs;
    recovery?: { row: CharacterDrivenPlan; input: Input } } | null>(null)
  const scopeKey = scope ? `${scope.projectId}:${scope.worldId}:${scope.workId}` : ''
  const key = `${scopeKey}:${plan?.id}:${plan?.createdAt}:${plan ? characterDrivenPlanUidV1(plan) : ''}`
  const desired = useRef(key); desired.current = key

  useEffect(() => {
    if (dirty.current || pending.current || composition.current) return
    let active = true
    setSourceReady(false); setReadError(''); setSaved(null)
    if (!plan?.id) { owner.current = null; draft.current = empty(); baseline.current = characterDrivenInputKeyV1(draft.current); setInput(draft.current); return }
    const selected = structuredClone(plan), frozenScope = scope ? { ...scope } : undefined
    const load = confirmed && frozenScope ? readCharacterDrivenInputSourceV1(selected.id!, frozenScope) : Promise.resolve(selected)
    void load.then(row => {
      if (!active || desired.current !== key || dirty.current || pending.current || composition.current) return
      if (characterDrivenPlanUidV1(row) !== characterDrivenPlanUidV1(selected) || row.createdAt !== selected.createdAt) throw new Error('原方案身份已变化，不能将输入转移到新记录。')
      const next = { arcs: parseCharacterDrivenPlanArcs(row.arcs), userHint: row.userHint }
      if (typeof next.userHint !== 'string') throw new Error('方案作者要求格式异常，原数据已保留。')
      owner.current = { key, scope: frozenScope, row, confirmed, save: save.current }
      draft.current = next; baseline.current = characterDrivenInputKeyV1(next); setInput(next)
      failed.current = ''; setError(''); setSourceReady(true); if (confirmed) setSaved(row)
    }).catch(cause => { if (active && desired.current === key) setReadError(cause instanceof Error ? cause.message : '原方案读取失败。') })
    return () => { active = false }
  }, [key, plan?.id, plan?.createdAt, plan?.updatedAt, scopeKey, confirmed]) // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async (retry = false, force = false): Promise<void> => {
    if (composition.current) throw new Error('输入法仍在组合方案文字，请完成输入后保存。')
    if (failed.current && !retry) throw new Error(failed.current)
    if (pending.current) return pending.current
    if (!dirty.current && !force) return
    if (!owner.current || owner.current.key !== desired.current) throw new Error('原方案保存目标未确认，草稿已保留。')
    const target = owner.current
    if (force && target.confirmed && target.row.status === 'draft' && !dirty.current) return
    failed.current = ''; setError(''); setSaving(true)
    let submitted: Input | undefined
    const operation = (async () => {
      if (retry && target.recovery && target.scope) {
        const actual = await readCharacterDrivenInputSourceV1(target.row.id!, target.scope)
        assertCharacterDrivenInputExpectedV1(actual, target.recovery.row)
        target.row = actual; baseline.current = characterDrivenPlanInputKeyV1(actual); setSaved(actual)
        if (characterDrivenInputKeyV1(draft.current) === characterDrivenInputKeyV1(target.recovery.input)) {
          draft.current = { arcs: parseCharacterDrivenPlanArcs(actual.arcs), userHint: actual.userHint }; setInput(draft.current)
        }
        dirty.current = characterDrivenInputKeyV1(draft.current) !== baseline.current
        target.recovery = undefined
      }
      let first = force
      while (first || dirty.current) {
        first = false
        if (composition.current) break
        const snapshot = draft.current
        submitted = snapshot
        let actual: CharacterDrivenPlan | undefined
        if (target.confirmed && target.scope) actual = await target.save(target.row.id!, snapshot, { scope: target.scope, expected: target.row })
        else await target.save(target.row.id!, snapshot)
        const next = actual ? { arcs: parseCharacterDrivenPlanArcs(actual.arcs), userHint: actual.userHint } : snapshot
        if (actual && (actual.id !== target.row.id || characterDrivenPlanUidV1(actual) !== characterDrivenPlanUidV1(target.row)
          || next.userHint !== snapshot.userHint || next.arcs.length !== snapshot.arcs.length
          || next.arcs.some((arc, index) => ['name', 'role', 'initialState', 'targetState'].some(field => Reflect.get(arc, field) !== Reflect.get(snapshot.arcs[index], field))))) throw new Error('未收到相同方案与原文的提交确认，草稿已保留。')
        if (actual) { target.row = actual; setSaved(actual) }
        baseline.current = characterDrivenInputKeyV1(next)
        if (draft.current === snapshot) { draft.current = next; setInput(next) }
        dirty.current = characterDrivenInputKeyV1(draft.current) !== baseline.current
      }
    })().catch(cause => {
      const committed = cause && typeof cause === 'object' ? Reflect.get(cause, 'committedCharacterDrivenInputsV1') as CharacterDrivenPlan | undefined : undefined
      if (submitted && committed && committed.id === target.row.id && characterDrivenPlanUidV1(committed) === characterDrivenPlanUidV1(target.row)) target.recovery = { row: structuredClone(committed), input: submitted }
      dirty.current = true; failed.current = cause instanceof Error ? cause.message : '方案输入未保存，草稿已保留。'
      setError(failed.current); throw cause
    }).finally(() => { pending.current = null; setSaving(false) })
    pending.current = operation
    return operation
  }, [])
  useEffect(() => registerPendingDraftFlusherV1(async () => {
    await flush()
    if (dirty.current || composition.current || failed.current) throw new Error(failed.current || '方案输入尚未保存，请完成输入后重试。')
  }), [flush])
  useBeforeUnload(dirty.current || saving || composing || Boolean(error))
  const change = (next: Input) => {
    draft.current = structuredClone(next); dirty.current = characterDrivenInputKeyV1(next) !== baseline.current || Boolean(failed.current)
    setInput(draft.current)
  }
  const status = error ? 'failed' : saving ? 'saving' : dirty.current || composing ? 'dirty'
    : confirmed && saved && owner.current?.key === key && characterDrivenPlanInputKeyV1(saved) === characterDrivenInputKeyV1(input) ? 'saved' : 'unconfirmed'
  return { ...input, error, readError, sourceReady, status,
    setArcs: (arcs: CharacterDrivenPlanArc[]) => change({ ...draft.current, arcs }),
    setUserHint: (userHint: string) => change({ ...draft.current, userHint }), flush,
    compositionStart: () => { composition.current = true; setComposing(true) },
    compositionEnd: () => { composition.current = false; setComposing(false) },
  }
}
