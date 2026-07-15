import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Settings2, Trash2, X } from 'lucide-react'
import {
  parseFieldSchema,
  stringifyFieldSchema,
} from '../../lib/types/codex'
import type { CodexCategory, CodexFieldDef } from '../../lib/types/codex'

const FIELD_TYPES: { value: CodexFieldDef['type']; label: string }[] = [
  { value: 'text', label: '单行文本' },
  { value: 'longtext', label: '多行文本' },
  { value: 'select', label: '下拉选项' },
  { value: 'number', label: '数字' },
  { value: 'ref', label: '关联词条' },
]

interface Props {
  category: CodexCategory
  onClose: () => void
  onSave: (fieldSchema: string) => void
}

export default function CodexCategoryFieldsEditor({ category, onClose, onSave }: Props) {
  const [defs, setDefs] = useState<CodexFieldDef[]>(() => parseFieldSchema(category.fieldSchema))

  const update = (index: number, patch: Partial<CodexFieldDef>) => {
    setDefs(current => current.map((definition, itemIndex) => (
      itemIndex === index ? { ...definition, ...patch } : definition
    )))
  }
  const remove = (index: number) => setDefs(current => current.filter((_, itemIndex) => itemIndex !== index))
  const move = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= defs.length) return
    const next = [...defs]
    ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    setDefs(next)
  }
  const add = () => setDefs(current => [...current, {
    key: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    label: '新字段',
    type: 'text',
  }])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-bg-surface border border-border rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-accent" /> 管理「{category.name}」的专属字段
          </h3>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary" aria-label="关闭字段管理">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {defs.length === 0 && <p className="text-xs text-text-muted text-center py-4">还没有专属字段,点下方「添加字段」。</p>}
          {defs.map((definition, index) => (
            <div key={definition.key} className="border border-border rounded-lg p-2 space-y-1.5 bg-bg-base">
              <div className="flex items-center gap-1.5">
                <input
                  value={definition.label}
                  onChange={event => update(index, { label: event.target.value })}
                  placeholder="字段名(如:品级)"
                  className="flex-1 px-2 py-1 text-sm rounded bg-bg-elevated border border-border focus:outline-none focus:border-accent"
                />
                <select
                  aria-label={`字段类型-${definition.label}`}
                  value={definition.type}
                  onChange={event => update(index, { type: event.target.value as CodexFieldDef['type'] })}
                  className="px-2 py-1 text-xs rounded bg-bg-elevated border border-border"
                >
                  {FIELD_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                <button onClick={() => move(index, -1)} disabled={index === 0} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30" aria-label={`上移字段${definition.label}`}>
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => move(index, 1)} disabled={index === defs.length - 1} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30" aria-label={`下移字段${definition.label}`}>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => remove(index)} className="p-1 text-text-muted hover:text-red-400" aria-label={`删除字段${definition.label}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {definition.type === 'select' && (
                <input
                  value={(definition.options || []).join(' / ')}
                  onChange={event => update(index, { options: event.target.value.split('/').map(item => item.trim()).filter(Boolean) })}
                  placeholder="选项,用 / 分隔(如:常见 / 稀有 / 罕见)"
                  className="w-full px-2 py-1 text-xs rounded bg-bg-elevated border border-border focus:outline-none focus:border-accent"
                />
              )}
              {definition.type === 'ref' && (
                <input
                  value={definition.refCategory || ''}
                  onChange={event => update(index, { refCategory: event.target.value.trim() || undefined })}
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
            <button
              onClick={() => onSave(stringifyFieldSchema(defs.filter(definition => definition.label.trim())))}
              className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
