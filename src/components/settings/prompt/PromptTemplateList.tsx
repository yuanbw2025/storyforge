import { useState } from 'react'
import { ChevronRight, ChevronDown, Star, User } from 'lucide-react'
import type { PromptTemplate } from '../../../lib/types/prompt'

/** moduleKey 的 UI 分组规则：第一个 . 之前的部分 */
const GROUP_LABELS: Record<string, { label: string; emoji: string; order: number }> = {
  worldview:  { label: '世界观',  emoji: '🌍', order: 1 },
  research:   { label: '研究考证', emoji: '🔎', order: 2 },
  character:  { label: '角色',    emoji: '🧙', order: 3 },
  outline:    { label: '大纲',    emoji: '🗂', order: 4 },
  chapter:    { label: '章节',    emoji: '✏️', order: 5 },
  detail:     { label: '细纲',    emoji: '📝', order: 6 },
  review:     { label: '审校',    emoji: '🧭', order: 7 },
  foreshadow: { label: '伏笔',    emoji: '🎯', order: 8 },
  geography:  { label: '地理',    emoji: '🗺', order: 9 },
  story:      { label: '故事',    emoji: '📖', order: 10 },
  rules:      { label: '创作规则', emoji: '📐', order: 11 },
  prompt:     { label: 'Prompt 管理', emoji: '⚙️', order: 12 },
  import:     { label: '导入解析', emoji: '📥', order: 13 },
}

/** moduleKey 的二级标签（点号后部分） */
const SUB_LABELS: Record<string, string> = {
  dimension:    '维度生成',
  generate:     '完整生成',
  volume:       '卷级',
  chapter:      '章节级',
  content:      '正文生成',
  continue:     '续写',
  polish:       '润色',
  expand:       '扩写',
  'de-ai':      '去 AI 味',
  'concept-map':       '概念地图 SVG',
  'image-map-prompt':  '图像 Prompt',
  'parse-character':   '角色解析',
  'parse-worldview':   '世界观解析',
  'parse-outline':     '大纲解析',
  scene:        '场景',
  brief:        '立项简报',
  ideation:     '灵感',
  positioning:  '定位',
  core:         '故事核心',
  packaging:    '作品包装',
  method:       '研究考证',
  operations:   'Prompt 管理',
  worldbuilding: '世界观阶段',
  design:       '人物设计',
  plot:         '剧情',
  structure:    '结构',
  'long-form':  '长篇架构',
  'short-story': '短篇架构',
  serialization: '连载架构',
  drafting:     '正文创作',
  continuity:   '连续性',
  'chapter-planning': '章场规划',
  'line-editing': '语言修订',
  developmental: '宏观修订',
  'reader-validation': '读者验证',
}

interface Props {
  templates: PromptTemplate[]
  selectedId: number | null
  onSelect: (id: number) => void
}

export default function PromptTemplateList({ templates, selectedId, onSelect }: Props) {
  // 按 moduleKey 第一段分组
  const groups = new Map<string, PromptTemplate[]>()
  for (const t of templates) {
    const groupKey = t.moduleKey.split('.')[0]
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey)!.push(t)
  }

  // 排序后转数组
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const oa = GROUP_LABELS[a[0]]?.order ?? 99
    const ob = GROUP_LABELS[b[0]]?.order ?? 99
    return oa - ob
  })

  // 折叠状态：默认全部展开
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (k: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  if (templates.length === 0) {
    return (
      <div className="p-6 text-center text-text-muted text-sm">
        当前筛选下没有模板
      </div>
    )
  }

  return (
    <div className="py-2">
      {sortedGroups.map(([groupKey, items]) => {
        const meta = GROUP_LABELS[groupKey] || { label: groupKey, emoji: '📁', order: 99 }
        const isCollapsed = collapsed.has(groupKey)
        return (
          <div key={groupKey} className="mb-1">
            {/* 分组头 */}
            <button
              onClick={() => toggle(groupKey)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover"
            >
              {isCollapsed
                ? <ChevronRight className="w-3 h-3" />
                : <ChevronDown className="w-3 h-3" />}
              <span className="text-base">{meta.emoji}</span>
              <span className="font-medium">{meta.label}</span>
              <span className="ml-auto text-text-muted">{items.length}</span>
            </button>

            {/* 模板项 */}
            {!isCollapsed && (
              <div>
                {items
                  .sort((a, b) => (a.scope === 'system' ? -1 : 1) - (b.scope === 'system' ? -1 : 1) || a.id! - b.id!)
                  .map(t => (
                    <TemplateRow
                      key={t.id}
                      template={t}
                      selected={t.id === selectedId}
                      onClick={() => onSelect(t.id!)}
                    />
                  ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TemplateRow({
  template, selected, onClick,
}: { template: PromptTemplate; selected: boolean; onClick: () => void }) {
  const subKey = template.moduleKey.split('.').slice(1).join('.')
  const subLabel = SUB_LABELS[subKey] || subKey

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2 pl-8 pr-3 py-1.5 text-left text-sm border-l-2 transition-colors ${
        selected
          ? 'border-accent bg-accent/10 text-text-primary'
          : 'border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      {/* scope 图标 */}
      {template.scope === 'system'
        ? <Star className="w-3.5 h-3.5 mt-0.5 text-warning flex-shrink-0" />
        : <User className="w-3.5 h-3.5 mt-0.5 text-info flex-shrink-0" />}

      <div className="flex-1 min-w-0">
        <div className="truncate flex items-center gap-1.5">
          <span className="text-xs text-text-muted">[{subLabel}]</span>
          <span className="truncate">{template.name}</span>
        </div>
      </div>

      {template.isDefault && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning flex-shrink-0">
          默认
        </span>
      )}
      {template.isActive && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success flex-shrink-0">
          激活
        </span>
      )}
    </button>
  )
}
