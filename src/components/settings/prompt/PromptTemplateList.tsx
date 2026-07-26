import { useState, useMemo } from 'react'
import { ChevronRight, Star, User, ArrowLeft, X, FileText } from 'lucide-react'
import type { PromptTemplate } from '../../../lib/types/prompt'
import PromptTemplateEditor from './PromptTemplateEditor'

/** moduleKey 的 UI 分组规则：第一个 . 之前的部分 */
const GROUP_LABELS: Record<string, { label: string; emoji: string; order: number; desc: string }> = {
  worldview:  { label: '世界观',  emoji: '🌍', order: 1, desc: '世界维度、世界规则' },
  research:   { label: '研究考证', emoji: '🔎', order: 2, desc: '研究方法学' },
  character:  { label: '角色',    emoji: '🧙', order: 3, desc: '角色生成与设计' },
  outline:    { label: '大纲',    emoji: '🗂', order: 4, desc: '卷纲、章纲、结构' },
  chapter:    { label: '章节',    emoji: '✏️', order: 5, desc: '正文创作与续写润色' },
  detail:     { label: '细纲',    emoji: '📝', order: 6, desc: '场景与章场规划' },
  review:     { label: '审校',    emoji: '🧭', order: 7, desc: '宏观与语言修订' },
  foreshadow: { label: '伏笔',    emoji: '🎯', order: 8, desc: '伏笔生成' },
  geography:  { label: '地理',    emoji: '🗺', order: 9, desc: '概念地图与图像 Prompt' },
  story:      { label: '故事',    emoji: '📖', order: 10, desc: '故事核心与立项' },
  rules:      { label: '创作规则', emoji: '📐', order: 11, desc: '创作风格规则' },
  prompt:     { label: 'Prompt 管理', emoji: '⚙️', order: 12, desc: 'Prompt 运维操作' },
  import:     { label: '导入解析', emoji: '📥', order: 13, desc: '解析导入文本' },
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
  /** 外层仍传 selectedId，仅用于外部 store 同步（组件内部用 detailId） */
  selectedId?: number | null
  onSelect: (id: number) => void
  /** 编辑器变更后刷新（与原版一致） */
  onChanged?: () => void
  onDeleted?: () => void
}

export default function PromptTemplateList({ templates, onSelect, onChanged, onDeleted }: Props) {
  // 当前所在的层级：null=包列表（一级），string=某分组内模板网格（二级）
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  // 弹窗中显示的模板 id
  const [detailId, setDetailId] = useState<number | null>(null)

  // 按分组聚合
  const groups = useMemo(() => {
    const m = new Map<string, PromptTemplate[]>()
    for (const t of templates) {
      const k = t.moduleKey.split('.')[0]
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(t)
    }
    return [...m.entries()].sort((a, b) => {
      const oa = GROUP_LABELS[a[0]]?.order ?? 99
      const ob = GROUP_LABELS[b[0]]?.order ?? 99
      return oa - ob
    })
  }, [templates])

  // 弹窗中显示的模板对象
  const detailTemplate = detailId != null
    ? templates.find(t => t.id === detailId) ?? null
    : null

  // ── 一级：提示词包网格 ──
  if (!activeGroup) {
    if (templates.length === 0) {
      return (
        <div className="p-6 text-center text-text-muted text-sm">
          当前筛选下没有模板
        </div>
      )
    }
    return (
      <div className="p-4">
        <div className="mb-3 text-xs text-text-muted">
          共 {groups.length} 个提示词包 · {templates.length} 条模板 · 点击包进入查看
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {groups.map(([groupKey, items]) => {
            const meta = GROUP_LABELS[groupKey] || { label: groupKey, emoji: '📁', order: 99, desc: '' }
            const sysCount = items.filter(t => t.scope === 'system').length
            return (
              <button
                key={groupKey}
                onClick={() => setActiveGroup(groupKey)}
                className="group relative p-3 rounded-lg border border-border bg-bg-surface text-left hover:border-accent/50 hover:bg-bg-hover hover:shadow-sm transition-all"
              >
                <div className="flex flex-col items-center text-center">
                  <span className="text-3xl mb-1">{meta.emoji}</span>
                  <p className="text-sm font-medium text-text-primary truncate w-full">{meta.label}</p>
                  <p className="text-[10px] text-text-muted line-clamp-2 w-full leading-tight min-h-[2.4em] mt-0.5">
                    {meta.desc}
                  </p>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-text-muted">
                    <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent">{items.length}</span>
                    {sysCount > 0 && <span className="text-warning/70">★{sysCount}</span>}
                  </div>
                </div>
                <ChevronRight className="absolute top-2 right-2 w-3.5 h-3.5 text-text-muted/40 group-hover:text-accent transition-colors" />
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── 二级：某分组内的模板网格 ──
  const groupItems = groups.find(([k]) => k === activeGroup)?.[1] ?? []
  const groupMeta = GROUP_LABELS[activeGroup] || { label: activeGroup, emoji: '📁', order: 99, desc: '' }

  return (
    <div className="p-4">
      {/* 返回按钮 + 当前分组标题 */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setActiveGroup(null)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-accent border border-border rounded transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> 返回包列表
        </button>
        <span className="text-lg">{groupMeta.emoji}</span>
        <h3 className="text-sm font-medium text-text-primary">{groupMeta.label}</h3>
        <span className="text-xs text-text-muted">· {groupItems.length} 条</span>
      </div>

      {groupItems.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm">
          这个包里没有模板
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {groupItems
            .sort((a, b) => (a.scope === 'system' ? -1 : 1) - (b.scope === 'system' ? -1 : 1) || (a.id! - b.id!))
            .map(t => {
              const subKey = t.moduleKey.split('.').slice(1).join('.')
              const subLabel = SUB_LABELS[subKey] || subKey
              return (
                <button
                  key={t.id}
                  onClick={() => { setDetailId(t.id!); onSelect(t.id!) }}
                  className={`group relative p-2.5 rounded-lg border text-left transition-all ${
                    detailId === t.id
                      ? 'border-accent ring-1 ring-accent/40 bg-accent/5'
                      : 'border-border bg-bg-surface hover:border-accent/40 hover:bg-bg-hover'
                  }`}
                >
                  <div className="flex flex-col items-start text-left">
                    <div className="flex items-center gap-1 self-stretch mb-1">
                      {t.scope === 'system'
                        ? <Star className="w-3 h-3 text-warning flex-shrink-0" />
                        : <User className="w-3 h-3 text-info flex-shrink-0" />}
                      <span className="text-[10px] text-text-muted truncate">[{subLabel}]</span>
                    </div>
                    <p className="text-xs font-medium text-text-primary line-clamp-2 w-full leading-tight min-h-[2.6em]">
                      {t.name}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.isDefault && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-warning/15 text-warning">默认</span>
                      )}
                      {t.isActive && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-success/15 text-success">激活</span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
        </div>
      )}

      {/* ── 详情弹窗：独立滚动 ── */}
      {detailTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setDetailId(null)}
        >
          <div
            className="relative bg-bg-base border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* 弹窗头：标题 + 关闭 */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                <FileText className="w-4 h-4 text-accent" />
                {detailTemplate.name}
                <span className="text-xs text-text-muted font-normal ml-1">[{detailTemplate.moduleKey}]</span>
              </span>
              <button
                onClick={() => setDetailId(null)}
                className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* 弹窗内容：独立滚动 */}
            <div className="overflow-y-auto p-4">
              <PromptTemplateEditor
                template={detailTemplate}
                onChanged={onChanged ?? (() => {})}
                onDeleted={() => { setDetailId(null); onDeleted?.() }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
