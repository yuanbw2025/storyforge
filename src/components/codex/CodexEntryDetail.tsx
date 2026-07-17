import { useMemo, useState } from 'react'
import { ChevronRight, Star } from 'lucide-react'
import { CInput, CTextarea } from '../shared/CompositionInput'
import {
  parseEntryFields,
  parseEntryRefs,
  parseFieldSchema,
  stringifyEntryFields,
  stringifyEntryRefs,
} from '../../lib/types/codex'
import type {
  CodexCategory,
  CodexEntry,
  CodexFieldDef,
} from '../../lib/types/codex'

interface Props {
  entry: CodexEntry
  category: CodexCategory
  allCategories: CodexCategory[]
  allEntries: CodexEntry[]
  nameDuplicate?: boolean
  onChange: (patch: Partial<CodexEntry>) => void
}

export default function CodexEntryDetail({
  entry,
  category,
  allCategories,
  allEntries,
  nameDuplicate,
  onChange,
}: Props) {
  const schema = useMemo(() => parseFieldSchema(category.fieldSchema), [category.fieldSchema])
  const fields = useMemo(() => parseEntryFields(entry.fields), [entry.fields])
  const refs = useMemo(() => parseEntryRefs(entry.refs), [entry.refs])
  const tags = useMemo(() => {
    try {
      const parsed = JSON.parse(entry.tags || '[]')
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }, [entry.tags])

  const setField = (key: string, value: string) => {
    onChange({ fields: stringifyEntryFields({ ...fields, [key]: value }) })
  }
  const setRef = (key: string, ids: number[]) => {
    onChange({ refs: stringifyEntryRefs({ ...refs, [key]: ids }) })
  }

  return (
    <div className="p-4 space-y-3 max-w-2xl">
      <div className="flex items-center gap-2">
        <CInput
          value={entry.icon || ''}
          onChange={event => onChange({ icon: event.target.value })}
          placeholder="图标"
          className="w-14 text-center px-2 py-2 rounded-lg bg-bg-elevated border border-border text-sm"
        />
        <div className="flex-1">
          <CInput
            value={entry.name}
            onChange={event => onChange({ name: event.target.value })}
            placeholder="名称"
            className={`w-full px-3 py-2 rounded-lg bg-bg-elevated border text-sm font-medium ${nameDuplicate ? 'border-amber-400/60' : 'border-border'}`}
          />
          {nameDuplicate && <p className="mt-1 text-[11px] text-amber-400">⚠ 本分类下已有同名词条，注意是否重复</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted w-12">重要度</span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(value => (
            <button
              key={value}
              type="button"
              title={`${value} 星`}
              onClick={() => onChange({ importance: entry.importance === value ? 0 : value })}
              className="p-0.5 hover:scale-110 transition-transform"
            >
              <Star className={`w-4 h-4 ${(entry.importance ?? 0) >= value ? 'fill-amber-400 text-amber-400' : 'text-text-muted'}`} />
            </button>
          ))}
        </div>
        {(entry.importance ?? 0) > 0 && <span className="text-[11px] text-amber-400/80">{entry.importance} 星</span>}
      </div>
      <CInput
        value={entry.summary}
        onChange={event => onChange({ summary: event.target.value })}
        placeholder="一句话简介"
        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm"
      />
      <CInput
        value={tags.join('、')}
        onChange={event => onChange({
          tags: JSON.stringify(event.target.value.split(/[、,，]/).map(tag => tag.trim()).filter(Boolean)),
        })}
        placeholder="标签（用顿号或逗号分隔）"
        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm"
      />
      <CTextarea
        value={entry.description}
        onChange={event => onChange({ description: event.target.value })}
        placeholder="详细描述"
        rows={3}
        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm resize-y"
      />

      {schema.length > 0 && <div className="border-t border-border pt-3 text-xs text-text-muted">专属属性</div>}
      {schema.map(definition => (
        <CodexFieldRow
          key={definition.key}
          definition={definition}
          value={fields[definition.key] || ''}
          refIds={refs[definition.key] || []}
          allCategories={allCategories}
          allEntries={allEntries}
          currentEntryId={entry.id!}
          onValue={value => setField(definition.key, value)}
          onRef={ids => setRef(definition.key, ids)}
        />
      ))}
    </div>
  )
}

function CodexFieldRow({
  definition,
  value,
  refIds,
  allCategories,
  allEntries,
  currentEntryId,
  onValue,
  onRef,
}: {
  definition: CodexFieldDef
  value: string
  refIds: number[]
  allCategories: CodexCategory[]
  allEntries: CodexEntry[]
  currentEntryId: number
  onValue: (value: string) => void
  onRef: (ids: number[]) => void
}) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2 items-start">
      <label className="text-xs text-text-muted pt-2 text-right">{definition.label}</label>
      <div className="min-w-0">
        {definition.type === 'longtext' && (
          <CTextarea value={value} onChange={event => onValue(event.target.value)} placeholder={definition.placeholder} rows={2}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm resize-y" />
        )}
        {definition.type === 'select' && (
          <select value={value} onChange={event => onValue(event.target.value)} aria-label={definition.label}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm">
            <option value="">（未选择）</option>
            {(definition.options || []).map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        )}
        {definition.type === 'number' && (
          <CInput value={value} onChange={event => onValue(event.target.value)} placeholder={definition.placeholder}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm" />
        )}
        {definition.type === 'ref' && (
          <CodexRefSelector
            refCategory={definition.refCategory}
            multi={definition.refMulti !== false}
            value={refIds}
            allCategories={allCategories}
            allEntries={allEntries}
            currentEntryId={currentEntryId}
            onChange={onRef}
          />
        )}
        {definition.type === 'text' && (
          <CInput value={value} onChange={event => onValue(event.target.value)} placeholder={definition.placeholder}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm" />
        )}
      </div>
    </div>
  )
}

function CodexRefSelector({
  refCategory,
  multi,
  value,
  allCategories,
  allEntries,
  currentEntryId,
  onChange,
}: {
  refCategory?: string
  multi: boolean
  value: number[]
  allCategories: CodexCategory[]
  allEntries: CodexEntry[]
  currentEntryId: number
  onChange: (ids: number[]) => void
}) {
  const [open, setOpen] = useState(false)
  const candidates = useMemo(() => {
    const hintCategoryIds = refCategory
      ? allCategories.filter(category => category.builtInKey === refCategory).map(category => category.id)
      : []
    return allEntries
      .filter(entry => entry.id !== currentEntryId)
      .filter(entry => hintCategoryIds.length === 0 || hintCategoryIds.includes(entry.categoryId))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [allCategories, allEntries, currentEntryId, refCategory])
  const selected = allEntries.filter(entry => value.includes(entry.id!))

  const toggle = (id: number) => {
    if (multi) onChange(value.includes(id) ? value.filter(item => item !== id) : [...value, id])
    else {
      onChange(value.includes(id) ? [] : [id])
      setOpen(false)
    }
  }

  return (
    <div className="rounded-lg bg-bg-elevated border border-border">
      <button onClick={() => setOpen(current => !current)} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-left">
        <ChevronRight className={`w-3.5 h-3.5 text-text-muted transition ${open ? 'rotate-90' : ''}`} />
        {selected.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {selected.map(entry => (
              <span key={entry.id} className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-xs">{entry.icon} {entry.name}</span>
            ))}
          </span>
        ) : <span className="text-text-muted">点击关联词条…</span>}
      </button>
      {open && (
        <div className="border-t border-border max-h-48 overflow-y-auto p-1">
          {candidates.length === 0 && <p className="text-xs text-text-muted px-2 py-2">暂无可关联的词条</p>}
          {candidates.map(entry => (
            <label key={entry.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-hover cursor-pointer text-sm">
              <input type="checkbox" checked={value.includes(entry.id!)} onChange={() => toggle(entry.id!)} />
              <span>{entry.icon}</span>
              <span className="truncate">{entry.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
