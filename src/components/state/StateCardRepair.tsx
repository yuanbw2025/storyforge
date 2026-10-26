import { useState } from 'react'
import type { StateCard } from '../../lib/types'
import { parseFields } from '../../lib/types/state-card'
import { CInput, CTextarea } from '../shared/CompositionInput'

/** A damaged record is editable only through explicit, validated author repair. */
export default function StateCardRepair({ card, error, onSave }: {
  card: StateCard
  error: string
  onSave: (fields: string, expectedFields: unknown) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [expectedFields, setExpectedFields] = useState<unknown>()
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [rawMode, setRawMode] = useState(false)
  const originalText = typeof card.fields === 'string' ? card.fields : JSON.stringify(card.fields, null, 2) ?? ''

  let rows: unknown[] | null = null
  try { const parsed: unknown = JSON.parse(draft); if (Array.isArray(parsed)) rows = parsed } catch { /* raw editor retains the invalid input */ }
  const changeField = (index: number, patch: { key?: string; value?: string }) => {
    if (!rows) return
    setDraft(JSON.stringify(rows.map((row, i) => {
      if (i !== index) return row
      const original = row && typeof row === 'object' && !Array.isArray(row) ? row : { key: '', value: '' }
      return { ...original, ...patch }
    })))
  }

  const save = async () => {
    setSaveError('')
    try {
      parseFields(draft)
      setSaving(true)
      await onSave(draft, expectedFields)
      setEditing(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '修复未保存，输入已保留。')
    } finally { setSaving(false) }
  }

  const downloadOriginal = () => {
    const url = URL.createObjectURL(new Blob([originalText], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `state-card-original-${card.id ?? 'unknown'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return <article data-testid={`state-card-repair-${card.id}`} className="rounded-xl border border-warning/50 bg-bg-surface p-4 space-y-3">
    <h3 className="font-semibold text-text-primary">{card.entityName} · 状态字段需要修复</h3>
    <p className="text-sm text-text-secondary">{error} 原始记录已保留，修复前不会作为完整状态用于生成。</p>
    <div className="flex flex-wrap gap-3 text-sm">
      {!editing && <button type="button" className="text-accent" onClick={() => {
        setExpectedFields(card.fields)
        setDraft(originalText)
        setSaveError('')
        try { setRawMode(!Array.isArray(JSON.parse(originalText))) } catch { setRawMode(true) }
        setEditing(true)
      }}>修复状态字段</button>}
      <button type="button" className="text-accent" onClick={downloadOriginal}>导出原始字段</button>
    </div>
    {editing && <div className="space-y-2">
      {rows && !rawMode ? <div className="space-y-3">
        <p className="text-xs text-text-muted">逐项补充字段名和文本值；不需要的异常项可明确移除。保存前原始记录不会变化。</p>
        {rows.map((row, index) => {
          const field = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : null
          const invalid = !field || typeof field.key !== 'string' || typeof field.value !== 'string'
          return <div key={index} className="rounded border border-border p-2 space-y-2">
            <p className="text-xs text-text-muted">第{index + 1}项{invalid ? ' · 原字段格式异常，请补充或移除' : ''}</p>
            <div className="flex flex-wrap gap-2">
              <CInput aria-label={`${card.entityName}的字段${index + 1}名称`} disabled={saving}
                value={typeof field?.key === 'string' ? field.key : ''} onChange={event => changeField(index, { key: event.target.value })}
                className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1 text-sm" placeholder="字段名，如位置" />
              <CInput aria-label={`${card.entityName}的字段${index + 1}值`} disabled={saving}
                value={typeof field?.value === 'string' ? field.value : ''} onChange={event => changeField(index, { value: event.target.value })}
                className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1 text-sm" placeholder="字段值，如山门" />
              <button type="button" disabled={saving} aria-label={`删除第${index + 1}项`}
                onClick={() => setDraft(JSON.stringify(rows!.filter((_, i) => i !== index)))} className="text-sm text-error">移除此项</button>
            </div>
            {invalid && <details className="text-xs text-text-muted"><summary>查看该项原始内容</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(row)}</pre></details>}
          </div>
        })}
        <button type="button" disabled={saving} className="text-sm text-accent"
          onClick={() => setDraft(JSON.stringify([...rows!, { key: '', value: '' }]))}>添加字段</button>
      </div> : <>
        <p className="text-xs text-text-muted">每项的 key（字段名）和 value（字段值）都使用文本。例如：</p>
        <pre className="text-xs whitespace-pre-wrap break-all">{'[{"key":"位置","value":"山门"}]'}</pre>
        <CTextarea aria-label={`${card.entityName}的状态字段原文`} value={draft} disabled={saving}
          onChange={event => setDraft(event.target.value)} rows={7}
          className="w-full min-w-0 rounded border border-border bg-bg-base p-2 text-sm font-mono" />
      </>}
      <button type="button" disabled={saving} className="text-xs text-text-muted" onClick={() => setRawMode(value => !value)}>
        {rawMode ? '返回逐字段修复' : '编辑原始内容'}
      </button>
      {saveError && <p role="alert" className="text-sm text-error">{saveError}</p>}
      <div className="flex gap-3 text-sm">
        <button type="button" disabled={saving} onClick={() => { void save() }} className="rounded bg-accent px-3 py-1.5 text-white disabled:opacity-50">{saving ? '保存中…' : '保存修复'}</button>
        <button type="button" disabled={saving} onClick={() => setEditing(false)} className="text-text-secondary">取消</button>
      </div>
    </div>}
  </article>
}
