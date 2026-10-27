import type { Character } from '../../lib/types'
import { dimensionsByGroup, type CharacterDimensionKey, type CharacterDimensionSpec } from '../../lib/character/character-dimensions'
import { CInput, CTextarea } from '../shared/CompositionInput'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'

interface Props {
  character: Character
  onChange: (patch: Partial<Character>, expected?: Partial<Character>) => void | Promise<void>
  /** 行内已显示、此处不重复的维度（如 NPC 行已有 简介/地点） */
  exclude?: CharacterDimensionKey[]
}

interface DimensionFieldProps {
  dimension: Pick<CharacterDimensionSpec, 'label' | 'rows'>
  value: unknown
  onCommit: (value: string, expected: unknown) => void | Promise<void>
  input?: boolean
  placeholder?: string
  className?: string
}

export function CharacterDraftField({ dimension, value, onCommit, input, placeholder, className }: DimensionFieldProps) {
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
    if (!readableRef.current) return Promise.reject(new Error('角色维度原文格式异常，已保留原数据，请先恢复。'))
    if (composingRef.current) return Promise.reject(new Error('输入法仍在组合角色文字，请完成后保存。'))
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
      errorRef.current = cause instanceof Error ? cause.message : '角色维度保存失败，输入已保留。'
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
  if (!readable) return <div role="alert" className="flex-1 text-xs text-amber-400">{dimension.label}格式异常，原数据已保留；恢复前暂停此项编辑。</div>
  const controlProps = {
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!dirty.current && !inFlight.current) editCommit.current = latestCommit.current
      const text = event.target.value
      draftRef.current = text; dirty.current = text !== baseline.current || Boolean(errorRef.current); setDraft(text)
      if (timer.current) clearTimeout(timer.current)
      if (!error) timer.current = setTimeout(() => { void flushDraft().catch(() => undefined) }, 400)
    },
    onBlur: () => { if (!error) void flushDraft().catch(() => undefined) },
    placeholder: placeholder ?? `${dimension.label}…`,
    'aria-label': dimension.label,
    className: className ?? 'w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary resize-y focus:outline-none focus:border-accent',
  }
  return (
    <div className="flex-1 min-w-0" onCompositionStartCapture={() => { composingRef.current = true; setComposing(true) }} onCompositionEndCapture={() => { composingRef.current = false; setComposing(false) }}>
      {input ? <CInput {...controlProps} /> : <CTextarea {...controlProps} rows={dimension.rows} />}
      {saving && <p role="status" className="text-xs text-text-muted">正在保存…</p>}
      {error && <div role="alert" className="text-xs text-red-400">{error}；输入已保留。
        <button type="button" onClick={() => { void flushDraft().catch(() => undefined) }} className="ml-2 underline">重试保存{dimension.label}</button>
      </div>}
    </div>
  )
}

/**
 * 角色完整维度的展示/编辑区(共享)——按 CHARACTER_DIMENSIONS 分组渲染。
 * NPC / 次要 / 路人 / 主要面板复用,让 AI 生成的完整内容在各自页面都能看到、能改。
 * 加一个维度只改 CHARACTER_DIMENSIONS + FIELD_REGISTRY,这里自动出现。
 */
export default function CharacterDimensionFields({ character, onChange, exclude = [] }: Props) {
  const skip = new Set<CharacterDimensionKey>(exclude)

  return (
    <div className="space-y-3">
      {dimensionsByGroup().map(({ group, dims }) => {
        const shown = dims.filter(d => !skip.has(d.key))
        if (!shown.length) return null
        return (
          <div key={group}>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-text-muted/70">{group}</div>
            <div className="space-y-1.5">
              {shown.map(d => (
                <div key={d.key} className="flex gap-2">
                  <span className="w-20 flex-shrink-0 pt-1.5 text-xs text-text-muted">{d.label}</span>
                  <CharacterDraftField
                    key={`${character.id ?? 'draft'}:${d.key}`}
                    dimension={d}
                    value={character[d.key]}
                    onCommit={(value, expected) => onChange({ [d.key]: value } as Partial<Character>, { [d.key]: expected } as Partial<Character>)}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
