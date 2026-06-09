/**
 * Phase 35-a — 通用词条面板
 *
 * 三栏：领域分类树（左） → 词条列表（中） → 词条详情表单（右，由 fieldSchema 驱动）。
 * 支持内置分类播种、自定义分类增删、词条 CRUD、词条间 ref 关联。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Trash2, EyeOff, Eye, FolderPlus, Boxes, ChevronRight,
} from 'lucide-react'
import { CInput, CTextarea } from '../shared/CompositionInput'
import { useCodexStore } from '../../stores/codex'
import {
  CODEX_DOMAIN_LABELS, parseFieldSchema, parseEntryFields, stringifyEntryFields,
  parseEntryRefs, stringifyEntryRefs,
  type CodexDomain, type CodexCategory, type CodexEntry, type CodexFieldDef,
} from '../../lib/types/codex'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
}

const DOMAINS: CodexDomain[] = ['natural', 'humanity']

export default function CodexPanel({ project }: Props) {
  const projectId = project.id!
  const {
    categories, entries, loadAll,
    addCategory, deleteCategory, setCategoryHidden,
    addEntry, updateEntry, deleteEntry,
  } = useCodexStore()

  const [domain, setDomain] = useState<CodexDomain>('natural')
  const [activeCatId, setActiveCatId] = useState<number | null>(null)
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  useEffect(() => { loadAll(projectId) }, [projectId, loadAll])

  // 当前领域的分类（按 order）
  const domainCats = useMemo(
    () => categories.filter(c => c.domain === domain).sort((a, b) => a.order - b.order),
    [categories, domain],
  )
  const visibleCats = useMemo(
    () => domainCats.filter(c => showHidden || !c.hidden),
    [domainCats, showHidden],
  )

  // 默认选中第一个可见分类
  useEffect(() => {
    if (activeCatId && visibleCats.some(c => c.id === activeCatId)) return
    setActiveCatId(visibleCats[0]?.id ?? null)
    setActiveEntryId(null)
  }, [visibleCats, activeCatId])

  const activeCat = categories.find(c => c.id === activeCatId) || null
  const catEntries = useMemo(
    () => entries.filter(e => e.categoryId === activeCatId).sort((a, b) => a.order - b.order),
    [entries, activeCatId],
  )
  const activeEntry = entries.find(e => e.id === activeEntryId) || null

  // ── 分类操作 ──
  const handleAddCategory = async () => {
    const name = window.prompt(`在「${CODEX_DOMAIN_LABELS[domain]}」下新增自定义分类，输入名称：`)?.trim()
    if (!name) return
    const id = await addCategory({
      projectId, domain, parentId: null, name, icon: '📁',
      fieldSchema: '[]', hidden: false,
      order: domainCats.length, worldGroupId: null,
    })
    setActiveCatId(id)
    setActiveEntryId(null)
  }

  const handleDeleteCategory = async (cat: CodexCategory) => {
    if (cat.builtInKey) return
    if (!window.confirm(`删除自定义分类「${cat.name}」及其下所有词条？此操作不可撤销。`)) return
    await deleteCategory(cat.id!)
  }

  // ── 词条操作 ──
  const handleAddEntry = async () => {
    if (!activeCatId) return
    const id = await addEntry({
      projectId, categoryId: activeCatId,
      name: '新词条', summary: '', description: '',
      fields: '{}', refs: '{}',
      order: catEntries.length, worldGroupId: activeCat?.worldGroupId ?? null,
    })
    setActiveEntryId(id)
  }

  const handleDeleteEntry = async (entry: CodexEntry) => {
    if (!window.confirm(`删除词条「${entry.name}」？`)) return
    await deleteEntry(entry.id!)
    if (activeEntryId === entry.id) setActiveEntryId(null)
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶部：领域切换 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Boxes className="w-5 h-5 text-accent" />
        <h2 className="text-base font-semibold text-text-primary mr-2">设定词条</h2>
        <div className="flex rounded-lg bg-bg-elevated p-0.5">
          {DOMAINS.map(d => (
            <button
              key={d}
              onClick={() => { setDomain(d); setActiveEntryId(null) }}
              className={`px-3 py-1 text-sm rounded-md transition ${
                domain === d ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {CODEX_DOMAIN_LABELS[d]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowHidden(v => !v)}
          className="ml-auto text-xs text-text-muted hover:text-text-primary inline-flex items-center gap-1"
          title="显示/隐藏被隐藏的分类"
        >
          {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {showHidden ? '隐藏项已显示' : '显示隐藏项'}
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* 左：分类列表 */}
        <div className="w-44 shrink-0 border-r border-border flex flex-col">
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {visibleCats.map(cat => (
              <div
                key={cat.id}
                onClick={() => { setActiveCatId(cat.id!); setActiveEntryId(null) }}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition ${
                  activeCatId === cat.id ? 'bg-accent/10 text-accent' : 'hover:bg-bg-hover text-text-primary'
                } ${cat.hidden ? 'opacity-50' : ''}`}
              >
                <span>{cat.icon || '📁'}</span>
                <span className="truncate flex-1">{cat.name}</span>
                <span className="text-[10px] text-text-muted">
                  {entries.filter(e => e.categoryId === cat.id).length || ''}
                </span>
                {cat.builtInKey ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCategoryHidden(cat.id!, !cat.hidden) }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary"
                    title={cat.hidden ? '取消隐藏' : '隐藏此内置分类'}
                  >
                    {cat.hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat) }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400"
                    title="删除自定义分类"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={handleAddCategory}
            className="m-2 px-2 py-1.5 text-xs rounded-lg border border-dashed border-border text-text-muted hover:text-accent hover:border-accent/50 inline-flex items-center justify-center gap-1"
          >
            <FolderPlus className="w-3.5 h-3.5" /> 新增分类
          </button>
        </div>

        {/* 中：词条列表 */}
        <div className="w-52 shrink-0 border-r border-border flex flex-col">
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {catEntries.length === 0 && (
              <p className="text-xs text-text-muted px-2 py-3 text-center">暂无词条</p>
            )}
            {catEntries.map(entry => (
              <div
                key={entry.id}
                onClick={() => setActiveEntryId(entry.id!)}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition ${
                  activeEntryId === entry.id ? 'bg-accent/10 text-accent' : 'hover:bg-bg-hover text-text-primary'
                }`}
              >
                <span>{entry.icon || activeCat?.icon || '•'}</span>
                <span className="truncate flex-1">{entry.name || '未命名'}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry) }}
                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={handleAddEntry}
            disabled={!activeCatId}
            className="m-2 px-2 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 inline-flex items-center justify-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> 新建词条
          </button>
        </div>

        {/* 右：词条详情 */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {activeEntry && activeCat ? (
            <EntryDetail
              key={activeEntry.id}
              entry={activeEntry}
              category={activeCat}
              allEntries={entries}
              onChange={(patch) => updateEntry(activeEntry.id!, patch)}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              {activeCat ? '从左侧选择或新建一个词条' : '请选择一个分类'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 词条详情表单（fieldSchema 驱动） ──────────────────────────────

function EntryDetail({
  entry, category, allEntries, onChange,
}: {
  entry: CodexEntry
  category: CodexCategory
  allEntries: CodexEntry[]
  onChange: (patch: Partial<CodexEntry>) => void
}) {
  const schema = useMemo(() => parseFieldSchema(category.fieldSchema), [category.fieldSchema])
  const fields = useMemo(() => parseEntryFields(entry.fields), [entry.fields])
  const refs = useMemo(() => parseEntryRefs(entry.refs), [entry.refs])

  const setField = (key: string, value: string) => {
    onChange({ fields: stringifyEntryFields({ ...fields, [key]: value }) })
  }
  const setRef = (key: string, ids: number[]) => {
    onChange({ refs: stringifyEntryRefs({ ...refs, [key]: ids }) })
  }

  return (
    <div className="p-4 space-y-3 max-w-2xl">
      {/* 通用字段 */}
      <div className="flex items-center gap-2">
        <CInput
          value={entry.icon || ''}
          onChange={(e) => onChange({ icon: e.target.value })}
          placeholder="图标"
          className="w-14 text-center px-2 py-2 rounded-lg bg-bg-elevated border border-border text-sm"
        />
        <CInput
          value={entry.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="名称"
          className="flex-1 px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm font-medium"
        />
      </div>
      <CInput
        value={entry.summary}
        onChange={(e) => onChange({ summary: e.target.value })}
        placeholder="一句话简介"
        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm"
      />
      <CTextarea
        value={entry.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="详细描述"
        rows={3}
        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm resize-y"
      />

      {schema.length > 0 && <div className="border-t border-border pt-3 text-xs text-text-muted">专属属性</div>}

      {/* 专属字段 */}
      {schema.map(def => (
        <FieldRow
          key={def.key}
          def={def}
          value={fields[def.key] || ''}
          refIds={refs[def.key] || []}
          allEntries={allEntries}
          currentEntryId={entry.id!}
          onValue={(v) => setField(def.key, v)}
          onRef={(ids) => setRef(def.key, ids)}
        />
      ))}
    </div>
  )
}

function FieldRow({
  def, value, refIds, allEntries, currentEntryId, onValue, onRef,
}: {
  def: CodexFieldDef
  value: string
  refIds: number[]
  allEntries: CodexEntry[]
  currentEntryId: number
  onValue: (v: string) => void
  onRef: (ids: number[]) => void
}) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2 items-start">
      <label className="text-xs text-text-muted pt-2 text-right">{def.label}</label>
      <div className="min-w-0">
        {def.type === 'longtext' && (
          <CTextarea
            value={value} onChange={(e) => onValue(e.target.value)}
            placeholder={def.placeholder} rows={2}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm resize-y"
          />
        )}
        {def.type === 'select' && (
          <select
            value={value} onChange={(e) => onValue(e.target.value)}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm"
          >
            <option value="">（未选择）</option>
            {(def.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        )}
        {def.type === 'number' && (
          <CInput
            value={value} onChange={(e) => onValue(e.target.value)}
            placeholder={def.placeholder}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm"
          />
        )}
        {def.type === 'ref' && (
          <RefSelector
            refCategory={def.refCategory}
            multi={def.refMulti !== false}
            value={refIds}
            allEntries={allEntries}
            currentEntryId={currentEntryId}
            onChange={onRef}
          />
        )}
        {def.type === 'text' && (
          <CInput
            value={value} onChange={(e) => onValue(e.target.value)}
            placeholder={def.placeholder}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm"
          />
        )}
      </div>
    </div>
  )
}

function RefSelector({
  refCategory, multi, value, allEntries, currentEntryId, onChange,
}: {
  refCategory?: string
  multi: boolean
  value: number[]
  allEntries: CodexEntry[]
  currentEntryId: number
  onChange: (ids: number[]) => void
}) {
  const { categories } = useCodexStore()
  const [open, setOpen] = useState(false)

  // 候选词条：优先建议 refCategory 对应的内置类，否则全项目（排除自己）
  const candidates = useMemo(() => {
    const hintCatIds = refCategory
      ? categories.filter(c => c.builtInKey === refCategory).map(c => c.id)
      : []
    return allEntries
      .filter(e => e.id !== currentEntryId)
      .filter(e => hintCatIds.length === 0 ? true : hintCatIds.includes(e.categoryId))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allEntries, categories, refCategory, currentEntryId])

  const selected = allEntries.filter(e => value.includes(e.id!))

  const toggle = (id: number) => {
    if (multi) {
      onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])
    } else {
      onChange(value.includes(id) ? [] : [id])
      setOpen(false)
    }
  }

  return (
    <div className="rounded-lg bg-bg-elevated border border-border">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-left"
      >
        <ChevronRight className={`w-3.5 h-3.5 text-text-muted transition ${open ? 'rotate-90' : ''}`} />
        {selected.length > 0
          ? <span className="flex flex-wrap gap-1">
              {selected.map(e => (
                <span key={e.id} className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-xs">
                  {e.icon} {e.name}
                </span>
              ))}
            </span>
          : <span className="text-text-muted">点击关联词条…</span>}
      </button>
      {open && (
        <div className="border-t border-border max-h-48 overflow-y-auto p-1">
          {candidates.length === 0 && (
            <p className="text-xs text-text-muted px-2 py-2">暂无可关联的词条</p>
          )}
          {candidates.map(e => (
            <label
              key={e.id}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-hover cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={value.includes(e.id!)}
                onChange={() => toggle(e.id!)}
              />
              <span>{e.icon}</span>
              <span className="truncate">{e.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
