/**
 * Phase 35-a — 通用词条面板
 *
 * 三栏：领域分类树（左） → 词条列表（中） → 词条详情表单（右，由 fieldSchema 驱动）。
 * 支持内置分类播种、自定义分类增删、词条 CRUD、词条间 ref 关联。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Trash2, EyeOff, Eye, FolderPlus, Boxes, ChevronRight, Settings2, X, ChevronUp, ChevronDown, Star,
} from 'lucide-react'
import { CInput, CTextarea } from '../shared/CompositionInput'
import { useCodexStore } from '../../stores/codex'
import {
  CODEX_DOMAIN_LABELS, parseFieldSchema, stringifyFieldSchema, parseEntryFields, stringifyEntryFields,
  parseEntryRefs, stringifyEntryRefs,
  type CodexDomain, type CodexCategory, type CodexEntry, type CodexFieldDef,
} from '../../lib/types/codex'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
  /** B3:嵌入自然/人文面板时锁定领域并隐藏顶部切换标签(独立面板不传=完整两栏切换) */
  fixedDomain?: CodexDomain
  /**
   * 锁定到指定内置分类(builtInKey 列表)——用于"世界观每个方面下面只显示对应那一类词条"。
   * 传 1 个 key:单分类模式(隐藏左侧分类树,只剩该类的词条)。
   * 传多个 key(如自然资源 mineral/herb/beast):只显示这几类,可在它们间切换。
   */
  fixedCategoryKeys?: string[]
  /** 嵌入模式:去掉外层标题/高度占满,适配面板内嵌 */
  embedded?: boolean
}

const DOMAINS: CodexDomain[] = ['natural', 'humanity']

export default function CodexPanel({ project, fixedDomain, fixedCategoryKeys, embedded }: Props) {
  const projectId = project.id!
  const {
    categories, entries, loadAll,
    addCategory, deleteCategory, setCategoryHidden, updateCategory,
    addEntry, updateEntry, deleteEntry,
  } = useCodexStore()

  // 锁定单一分类:隐藏分类树,只展示该类词条
  const lockedKeys = fixedCategoryKeys
  const lockedSingle = (lockedKeys?.length ?? 0) === 1

  const [domainState, setDomain] = useState<CodexDomain>(fixedDomain ?? 'natural')
  const domain = fixedDomain ?? domainState
  const [activeCatId, setActiveCatId] = useState<number | null>(null)
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  // B1:自定义字段管理弹窗
  const [showFieldsEditor, setShowFieldsEditor] = useState(false)
  // 词条排序方式:order=手动顺序 / importance=重要度降序 / pinyin=拼音首字母
  const [sortMode, setSortMode] = useState<'order' | 'importance' | 'pinyin'>('order')

  useEffect(() => { loadAll(projectId) }, [projectId, loadAll])

  // 当前领域的分类（按 order）。若锁定了 builtInKey 列表,则只取那几类(跨域亦可)。
  const domainCats = useMemo(
    () => {
      if (lockedKeys && lockedKeys.length) {
        return categories
          .filter(c => c.builtInKey && lockedKeys.includes(c.builtInKey))
          .sort((a, b) => lockedKeys.indexOf(a.builtInKey!) - lockedKeys.indexOf(b.builtInKey!))
      }
      return categories.filter(c => c.domain === domain).sort((a, b) => a.order - b.order)
    },
    [categories, domain, lockedKeys],
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
  const catEntries = useMemo(() => {
    const list = entries.filter(e => e.categoryId === activeCatId)
    if (sortMode === 'importance') {
      return [...list].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.order - b.order)
    }
    if (sortMode === 'pinyin') {
      // localeCompare('zh') 按拼音排序,无需拼音库
      return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN'))
    }
    return [...list].sort((a, b) => a.order - b.order)
  }, [entries, activeCatId, sortMode])
  // 同分类内重名的词条名集合(用于"已有同名"提示)
  const dupNames = useMemo(() => {
    const count = new Map<string, number>()
    for (const e of entries) {
      if (e.categoryId !== activeCatId) continue
      const n = (e.name || '').trim()
      if (n) count.set(n, (count.get(n) ?? 0) + 1)
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([k]) => k))
  }, [entries, activeCatId])
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
    <div className={embedded
      ? `flex flex-col ${lockedSingle ? 'h-80' : 'h-[30rem]'} border border-border rounded-xl overflow-hidden`
      : 'h-full flex flex-col'}>
      {/* 顶部：领域切换(嵌入且锁定领域时隐藏;单分类锁定时整条隐藏) */}
      {!lockedSingle && (
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        {!fixedDomain && (
          <>
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
          </>
        )}
        {fixedDomain && <span className="text-sm font-medium text-text-secondary">📚 词条({CODEX_DOMAIN_LABELS[fixedDomain]})</span>}
        <button
          onClick={() => setShowHidden(v => !v)}
          className="ml-auto text-xs text-text-muted hover:text-text-primary inline-flex items-center gap-1"
          title="显示/隐藏被隐藏的分类"
        >
          {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {showHidden ? '隐藏项已显示' : '显示隐藏项'}
        </button>
      </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* 左：分类列表(单分类锁定时隐藏) */}
        {!lockedSingle && (
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
          {!lockedKeys && (
            <button
              onClick={handleAddCategory}
              className="m-2 px-2 py-1.5 text-xs rounded-lg border border-dashed border-border text-text-muted hover:text-accent hover:border-accent/50 inline-flex items-center justify-center gap-1"
            >
              <FolderPlus className="w-3.5 h-3.5" /> 新增分类
            </button>
          )}
        </div>
        )}

        {/* 中：词条列表 */}
        <div className="w-52 shrink-0 border-r border-border flex flex-col">
          {/* 排序下拉 */}
          <div className="px-2 pt-2 pb-1 flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted shrink-0">排序</span>
            <select
              value={sortMode}
              onChange={e => setSortMode(e.target.value as typeof sortMode)}
              className="flex-1 text-[11px] bg-bg-elevated border border-border rounded px-1.5 py-1 text-text-secondary"
            >
              <option value="order">默认顺序</option>
              <option value="importance">按重要度</option>
              <option value="pinyin">按拼音首字母</option>
            </select>
          </div>
          <div className="flex-1 overflow-y-auto p-2 pt-1 space-y-0.5">
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
                {entry.name && dupNames.has(entry.name.trim()) && (
                  <span className="text-amber-400 shrink-0" title="本分类下有同名词条">⚠</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry) }}
                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="m-2 space-y-1.5">
            <button
              onClick={handleAddEntry}
              disabled={!activeCatId}
              className="w-full px-2 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> 新建词条
            </button>
            {/* B1:管理本分类的专属字段(增删改字段 schema) */}
            <button
              onClick={() => setShowFieldsEditor(true)}
              disabled={!activeCat}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-accent hover:border-accent/50 disabled:opacity-40 inline-flex items-center justify-center gap-1"
              title="自定义本分类下词条的专属字段"
            >
              <Settings2 className="w-3.5 h-3.5" /> 管理字段
            </button>
          </div>
        </div>

        {/* 右：词条详情 */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {activeEntry && activeCat ? (
            <EntryDetail
              key={activeEntry.id}
              entry={activeEntry}
              category={activeCat}
              allEntries={entries}
              nameDuplicate={!!activeEntry.name && dupNames.has(activeEntry.name.trim())}
              onChange={(patch) => updateEntry(activeEntry.id!, patch)}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              {activeCat ? '从左侧选择或「新建词条」添加一个具体条目' : '请选择一个分类'}
            </div>
          )}
        </div>
      </div>

      {/* B1:自定义字段管理弹窗 — 编辑本分类的 fieldSchema(内置类也可改) */}
      {showFieldsEditor && activeCat && (
        <CategoryFieldsEditor
          category={activeCat}
          onClose={() => setShowFieldsEditor(false)}
          onSave={(fieldSchema) => { updateCategory(activeCat.id!, { fieldSchema }); setShowFieldsEditor(false) }}
        />
      )}
    </div>
  )
}

// ── 自定义字段管理弹窗（编辑分类 fieldSchema · B1） ───────────────────
const FIELD_TYPES: { value: CodexFieldDef['type']; label: string }[] = [
  { value: 'text', label: '单行文本' },
  { value: 'longtext', label: '多行文本' },
  { value: 'select', label: '下拉选项' },
  { value: 'number', label: '数字' },
  { value: 'ref', label: '关联词条' },
]

function CategoryFieldsEditor({
  category, onClose, onSave,
}: {
  category: CodexCategory
  onClose: () => void
  onSave: (fieldSchema: string) => void
}) {
  const [defs, setDefs] = useState<CodexFieldDef[]>(() => parseFieldSchema(category.fieldSchema))

  const update = (i: number, patch: Partial<CodexFieldDef>) =>
    setDefs(defs.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const remove = (i: number) => setDefs(defs.filter((_, j) => j !== i))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= defs.length) return
    const next = [...defs]
    ;[next[i], next[j]] = [next[j], next[i]]
    setDefs(next)
  }
  const add = () => setDefs([...defs, {
    key: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    label: '新字段', type: 'text',
  }])

  const handleSave = () => {
    // 去掉 label 为空的字段
    onSave(stringifyFieldSchema(defs.filter(d => d.label.trim())))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-bg-surface border border-border rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-accent" /> 管理「{category.name}」的专属字段
          </h3>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {defs.length === 0 && <p className="text-xs text-text-muted text-center py-4">还没有专属字段,点下方「添加字段」。</p>}
          {defs.map((def, i) => (
            <div key={def.key} className="border border-border rounded-lg p-2 space-y-1.5 bg-bg-base">
              <div className="flex items-center gap-1.5">
                <input
                  value={def.label}
                  onChange={e => update(i, { label: e.target.value })}
                  placeholder="字段名(如:品级)"
                  className="flex-1 px-2 py-1 text-sm rounded bg-bg-elevated border border-border focus:outline-none focus:border-accent"
                />
                <select
                  value={def.type}
                  onChange={e => update(i, { type: e.target.value as CodexFieldDef['type'] })}
                  className="px-2 py-1 text-xs rounded bg-bg-elevated border border-border"
                >
                  {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                <button onClick={() => move(i, 1)} disabled={i === defs.length - 1} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                <button onClick={() => remove(i)} className="p-1 text-text-muted hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              {def.type === 'select' && (
                <input
                  value={(def.options || []).join(' / ')}
                  onChange={e => update(i, { options: e.target.value.split('/').map(s => s.trim()).filter(Boolean) })}
                  placeholder="选项,用 / 分隔(如:常见 / 稀有 / 罕见)"
                  className="w-full px-2 py-1 text-xs rounded bg-bg-elevated border border-border focus:outline-none focus:border-accent"
                />
              )}
              {def.type === 'ref' && (
                <input
                  value={def.refCategory || ''}
                  onChange={e => update(i, { refCategory: e.target.value.trim() || undefined })}
                  placeholder="建议关联的内置类 key(可空,如:artifact / mineral)"
                  className="w-full px-2 py-1 text-xs rounded bg-bg-elevated border border-border focus:outline-none focus:border-accent"
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-3 py-2.5 border-t border-border">
          <button onClick={add} className="px-2.5 py-1.5 text-xs rounded-lg border border-dashed border-border text-text-muted hover:text-accent hover:border-accent/50 inline-flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> 添加字段
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">取消</button>
            <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90">保存</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 词条详情表单（fieldSchema 驱动） ──────────────────────────────

function EntryDetail({
  entry, category, allEntries, nameDuplicate, onChange,
}: {
  entry: CodexEntry
  category: CodexCategory
  allEntries: CodexEntry[]
  nameDuplicate?: boolean
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
        <div className="flex-1">
          <CInput
            value={entry.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="名称"
            className={`w-full px-3 py-2 rounded-lg bg-bg-elevated border text-sm font-medium ${nameDuplicate ? 'border-amber-400/60' : 'border-border'}`}
          />
          {nameDuplicate && (
            <p className="mt-1 text-[11px] text-amber-400">⚠ 本分类下已有同名词条，注意是否重复</p>
          )}
        </div>
      </div>
      {/* 重要度星级（1-5）—— 主要用于地点类词条;点亮的星越多越重要,再点当前星可清空 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted w-12">重要度</span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(n => {
            const active = (entry.importance ?? 0) >= n
            return (
              <button
                key={n}
                type="button"
                title={`${n} 星`}
                onClick={() => onChange({ importance: entry.importance === n ? 0 : n })}
                className="p-0.5 hover:scale-110 transition-transform"
              >
                <Star className={`w-4 h-4 ${active ? 'fill-amber-400 text-amber-400' : 'text-text-muted'}`} />
              </button>
            )
          })}
        </div>
        {(entry.importance ?? 0) > 0 && (
          <span className="text-[11px] text-amber-400/80">{entry.importance} 星</span>
        )}
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
