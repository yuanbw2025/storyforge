/**
 * 地点标签选择器：双列展示自然地形 + 人文场所标签
 * 支持多选组合
 */
import { useState } from 'react'
import { X, ChevronDown, ChevronUp } from 'lucide-react'
import {
  TAG_CATEGORIES,
  TAG_EMOJI,
  type LocationTag,
} from '../../lib/types/location'

interface Props {
  selected: LocationTag[]
  onChange: (tags: LocationTag[]) => void
}

export default function LocationTagPicker({ selected, onChange }: Props) {
  const [expanded, setExpanded] = useState(false)

  const toggle = (tag: LocationTag) => {
    if (selected.includes(tag)) {
      onChange(selected.filter(t => t !== tag))
    } else {
      onChange([...selected, tag])
    }
  }

  return (
    <div>
      {/* 已选标签展示 */}
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
        {selected.length === 0 && (
          <span className="text-xs text-text-muted">点击下方添加标签…</span>
        )}
        {selected.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/15 text-accent text-xs rounded-full"
          >
            {TAG_EMOJI[tag] || '📍'} {tag}
            <button
              onClick={() => toggle(tag)}
              className="hover:text-red-400 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>

      {/* 展开/折叠按钮 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors mb-2"
      >
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {expanded ? '收起标签' : '展开标签选择'}
      </button>

      {/* 标签面板 */}
      {expanded && (
        <div className="space-y-3 p-3 bg-bg-base border border-border rounded-lg">
          {TAG_CATEGORIES.map(cat => (
            <div key={cat.label}>
              <div className="text-xs font-medium mb-1.5" style={{ color: cat.color }}>
                {cat.label}
              </div>
              <div className="flex flex-wrap gap-1">
                {cat.tags.map(tag => {
                  const isSelected = selected.includes(tag as LocationTag)
                  return (
                    <button
                      key={tag}
                      onClick={() => toggle(tag as LocationTag)}
                      className={`inline-flex items-center gap-0.5 px-2 py-1 text-xs rounded-md border transition-colors ${
                        isSelected
                          ? 'bg-accent/20 border-accent text-accent'
                          : 'bg-bg-surface border-border text-text-muted hover:text-text-primary hover:border-text-muted'
                      }`}
                    >
                      {TAG_EMOJI[tag as LocationTag] || '📍'} {tag}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
