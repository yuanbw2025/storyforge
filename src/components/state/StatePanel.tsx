/**
 * 状态表面板 — 查看/编辑/管理所有实体状态卡
 * 支持：手动增删改、按分类筛选、AI 提取变更、导出状态表
 */
import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, Download, Filter, Save, X } from 'lucide-react'
import { useStateCardStore } from '../../stores/state-card'
import type { Project, StateCard, StateCategory, StateField } from '../../lib/types'
import { STATE_CATEGORY_LABELS, parseFields, stringifyFields } from '../../lib/types/state-card'

interface Props {
  project: Project
}

const CATEGORIES: StateCategory[] = ['character', 'location', 'item', 'faction', 'event']

const CATEGORY_COLORS: Record<StateCategory, string> = {
  character: 'bg-blue-500/10 text-blue-400',
  location:  'bg-green-500/10 text-green-400',
  item:      'bg-yellow-500/10 text-yellow-400',
  faction:   'bg-purple-500/10 text-purple-400',
  event:     'bg-red-500/10 text-red-400',
}

export default function StatePanel({ project }: Props) {
  const { cards, loading, loadAll, addCard, updateCard, deleteCard, buildStateContext } = useStateCardStore()
  const [filter, setFilter] = useState<StateCategory | 'all'>('all')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    loadAll(project.id!).catch(err => {
      console.error('[StatePanel] 加载状态卡失败:', err)
    })
  }, [project.id, loadAll])

  const filtered = filter === 'all' ? cards : cards.filter(c => c.category === filter)

  const handleExportText = () => {
    try {
      const text = buildStateContext()
      if (!text) {
        console.warn('[StatePanel] 状态表为空，无法导出')
        return
      }
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.name}_状态表.txt`
      a.click()
      URL.revokeObjectURL(url)
      console.log('[StatePanel] 状态表文本已导出')
    } catch (err) {
      console.error('[StatePanel] 导出失败:', err)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary">📋 状态表</h2>
          <p className="text-sm text-text-muted mt-1">
            追踪角色、地点、物品、势力的当前状态。章节完成后可 AI 自动提取变更。
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportText} disabled={!cards.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-bg-elevated text-text-secondary rounded-lg hover:bg-bg-hover disabled:opacity-40 transition-colors">
            <Download className="w-4 h-4" /> 导出
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors">
            <Plus className="w-4 h-4" /> 新增状态卡
          </button>
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setFilter('all')}
          className={`px-3 py-1 text-xs rounded-full transition-colors ${
            filter === 'all' ? 'bg-accent text-white' : 'bg-bg-elevated text-text-muted hover:text-text-primary'
          }`}>
          <Filter className="w-3 h-3 inline mr-1" />全部（{cards.length}）
        </button>
        {CATEGORIES.map(cat => {
          const count = cards.filter(c => c.category === cat).length
          return (
            <button key={cat} onClick={() => setFilter(cat)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filter === cat ? 'bg-accent text-white' : `${CATEGORY_COLORS[cat]} hover:opacity-80`
              }`}>
              {STATE_CATEGORY_LABELS[cat]}（{count}）
            </button>
          )
        })}
      </div>

      {/* 新增表单 */}
      {showAdd && (
        <AddCardForm
          projectId={project.id!}
          onAdd={async (card) => {
            try {
              await addCard(card)
              setShowAdd(false)
            } catch (err) {
              console.error('[StatePanel] 新增失败:', err)
            }
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* 状态卡列表 */}
      {loading ? (
        <div className="text-center py-12 text-text-muted text-sm">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">
          {cards.length === 0 ? '还没有状态卡。点「新增」或在章节编辑器中用 AI 提取。' : '当前分类没有状态卡。'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(card => (
            <StateCardItem
              key={card.id}
              card={card}
              isEditing={editingId === card.id}
              onEdit={() => setEditingId(editingId === card.id ? null : card.id!)}
              onUpdate={async (data) => {
                try {
                  await updateCard(card.id!, data)
                  setEditingId(null)
                } catch (err) {
                  console.error('[StatePanel] 更新失败:', err)
                }
              }}
              onDelete={async () => {
                if (confirm(`确定删除「${card.entityName}」的状态卡？`)) {
                  try {
                    await deleteCard(card.id!)
                  } catch (err) {
                    console.error('[StatePanel] 删除失败:', err)
                  }
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 单张状态卡组件 ──

function StateCardItem({ card, isEditing, onEdit, onUpdate, onDelete }: {
  card: StateCard
  isEditing: boolean
  onEdit: () => void
  onUpdate: (data: Partial<StateCard>) => void
  onDelete: () => void
}) {
  const fields = parseFields(card.fields)
  const [editFields, setEditFields] = useState<StateField[]>(fields)

  // 同步
  useEffect(() => {
    if (isEditing) setEditFields(parseFields(card.fields))
  }, [isEditing, card.fields])

  const handleSave = () => {
    onUpdate({ fields: stringifyFields(editFields) })
  }

  const addField = () => {
    setEditFields([...editFields, { key: '', value: '' }])
  }

  const removeField = (idx: number) => {
    setEditFields(editFields.filter((_, i) => i !== idx))
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-xs ${CATEGORY_COLORS[card.category]}`}>
          {STATE_CATEGORY_LABELS[card.category]}
        </span>
        <span className="font-semibold text-text-primary">{card.entityName}</span>
        <div className="flex-1" />
        <button onClick={onEdit} className="p-1 text-text-muted hover:text-accent transition-colors" title="编辑">
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} className="p-1 text-text-muted hover:text-error transition-colors" title="删除">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          {editFields.map((f, idx) => (
            <div key={idx} className="flex gap-2">
              <input value={f.key} onChange={e => {
                const next = [...editFields]; next[idx] = { ...f, key: e.target.value }; setEditFields(next)
              }} placeholder="字段名" className="w-24 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary" />
              <input value={f.value} onChange={e => {
                const next = [...editFields]; next[idx] = { ...f, value: e.target.value }; setEditFields(next)
              }} placeholder="值" className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary" />
              <button onClick={() => removeField(idx)} className="p-1 text-text-muted hover:text-error">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={addField}
              className="text-xs text-accent hover:text-accent-hover">+ 添加字段</button>
            <div className="flex-1" />
            <button onClick={onEdit}
              className="px-2 py-1 text-xs text-text-muted hover:text-text-primary">取消</button>
            <button onClick={handleSave}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover">
              <Save className="w-3 h-3" /> 保存
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {fields.length === 0 ? (
            <span className="text-text-muted">（无字段，点击编辑添加）</span>
          ) : (
            fields.map((f, idx) => (
              <span key={idx} className="text-text-secondary">
                <span className="text-text-muted">{f.key}：</span>{f.value}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── 新增状态卡表单 ──

function AddCardForm({ projectId, onAdd, onCancel }: {
  projectId: number
  onAdd: (card: Omit<StateCard, 'id' | 'createdAt' | 'updatedAt'>) => void
  onCancel: () => void
}) {
  const [entityName, setEntityName] = useState('')
  const [category, setCategory] = useState<StateCategory>('character')
  const [fields, setFields] = useState<StateField[]>([{ key: '', value: '' }])

  const handleSubmit = () => {
    if (!entityName.trim()) return
    const validFields = fields.filter(f => f.key.trim() && f.value.trim())
    onAdd({
      projectId,
      category,
      entityName: entityName.trim(),
      fields: stringifyFields(validFields),
    })
  }

  return (
    <div className="bg-bg-surface border border-accent/30 rounded-xl p-4 mb-4 space-y-3">
      <div className="flex gap-3">
        <select value={category} onChange={e => setCategory(e.target.value as StateCategory)}
          className="px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary">
          {CATEGORIES.map(cat => (
            <option key={cat} value={cat}>{STATE_CATEGORY_LABELS[cat]}</option>
          ))}
        </select>
        <input value={entityName} onChange={e => setEntityName(e.target.value)}
          placeholder="实体名称（如：李明远、长安城）"
          className="flex-1 px-3 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary" />
      </div>
      {fields.map((f, idx) => (
        <div key={idx} className="flex gap-2">
          <input value={f.key} onChange={e => {
            const next = [...fields]; next[idx] = { ...f, key: e.target.value }; setFields(next)
          }} placeholder="字段名（如：位置）" className="w-32 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary" />
          <input value={f.value} onChange={e => {
            const next = [...fields]; next[idx] = { ...f, value: e.target.value }; setFields(next)
          }} placeholder="值（如：长安）" className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary" />
          <button onClick={() => setFields(fields.filter((_, i) => i !== idx))}
            className="p-1 text-text-muted hover:text-error"><X className="w-3 h-3" /></button>
        </div>
      ))}
      <button onClick={() => setFields([...fields, { key: '', value: '' }])}
        className="text-xs text-accent hover:text-accent-hover">+ 添加字段</button>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary">取消</button>
        <button onClick={handleSubmit} disabled={!entityName.trim()}
          className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40">
          创建
        </button>
      </div>
    </div>
  )
}
