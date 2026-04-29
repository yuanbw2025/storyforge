import { useState } from 'react'
import {
  FileText, Globe, Sparkles, Users, Swords, Zap,
  MapPin, Clock, Gem, Ruler, Heart,
  BookOpen, PenTool, Eye, Settings, ArrowLeft,
  ChevronLeft, ChevronRight, ChevronDown, Library,
  Database, Wand2,
} from 'lucide-react'

// ── 模块 ID 类型 ─────────────────────────────────────────────
export type SidebarModule =
  | 'info'
  | 'references'
  | 'rules'
  | 'worldview'
  | 'geography'
  | 'history'
  | 'power-system'
  | 'items'
  | 'story-core'
  | 'foreshadow'
  | 'characters'
  | 'relations'
  | 'factions'
  | 'outline'
  | 'editor'
  | 'settings'
  | 'data-management'
  // legacy aliases kept for backward compat
  | 'backup'
  | 'export'

// ── 导航数据结构 ─────────────────────────────────────────────
interface NavItem {
  id: SidebarModule
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface SubGroup {
  id: string
  label: string
  items: NavItem[]
}

interface Section {
  id: string
  label: string
  /** 直接子项（著作信息/创作区/设置区） */
  items?: NavItem[]
  /** 嵌套分组（设定库） */
  groups?: SubGroup[]
}

const NAV_STRUCTURE: Section[] = [
  {
    id: 'writing-info',
    label: '著作信息',
    items: [
      { id: 'info',       label: '项目概况', icon: FileText },
      { id: 'references', label: '参考书目', icon: Library },
      { id: 'rules',      label: '创作规则', icon: Ruler },
    ],
  },
  {
    id: 'settings-lib',
    label: '设定库',
    groups: [
      {
        id: 'worldview-group',
        label: '世界观',
        items: [
          { id: 'worldview',    label: '宇宙设定', icon: Globe },
          { id: 'geography',    label: '地理环境', icon: MapPin },
          { id: 'history',      label: '历史年表', icon: Clock },
          { id: 'power-system', label: '力量体系', icon: Zap },
          { id: 'items',        label: '道具系统', icon: Gem },
        ],
      },
      {
        id: 'story-group',
        label: '故事设计',
        items: [
          { id: 'story-core',  label: '故事核心', icon: Sparkles },
          { id: 'foreshadow',  label: '伏笔管理', icon: Eye },
        ],
      },
      {
        id: 'character-group',
        label: '角色设计',
        items: [
          { id: 'characters', label: '角色库',   icon: Users },
          { id: 'relations',  label: '关系网络', icon: Heart },
          { id: 'factions',   label: '势力阵营', icon: Swords },
        ],
      },
    ],
  },
  {
    id: 'creation',
    label: '创作区',
    items: [
      { id: 'outline', label: '大纲',     icon: BookOpen },
      { id: 'editor',  label: '正文编辑', icon: PenTool },
    ],
  },
  {
    id: 'system',
    label: '设置区',
    items: [
      { id: 'settings',         label: 'AI 配置', icon: Settings },
      { id: 'data-management',  label: '数据管理', icon: Database },
    ],
  },
]

// ── 获取某个 module 所在的 subgroup id ────────────────────────
function getSubGroupId(moduleId: SidebarModule): string | null {
  for (const section of NAV_STRUCTURE) {
    if (section.groups) {
      for (const group of section.groups) {
        if (group.items.some(i => i.id === moduleId)) return group.id
      }
    }
  }
  return null
}

// ── Props ────────────────────────────────────────────────────
interface SidebarProps {
  active: SidebarModule
  onSelect: (module: SidebarModule) => void
  onBack: () => void
  projectName: string
  collapsed: boolean
  onToggleCollapse: () => void
}

// ── 主组件 ───────────────────────────────────────────────────
export default function Sidebar({
  active, onSelect, onBack, projectName, collapsed, onToggleCollapse,
}: SidebarProps) {
  // 默认展开 active 所在的子分组
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const init = new Set<string>()
    const gid = getSubGroupId(active)
    if (gid) init.add(gid)
    // 默认全部展开
    NAV_STRUCTURE.forEach(s => s.groups?.forEach(g => init.add(g.id)))
    return init
  })

  const toggleGroup = (gid: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(gid)) next.delete(gid)
      else next.add(gid)
      return next
    })
  }

  const isActive = (id: SidebarModule) => {
    // legacy aliases
    if (active === 'backup' || active === 'export') return id === 'data-management'
    return active === id
  }

  return (
    <aside
      className={`${collapsed ? 'w-14' : 'w-52'} bg-bg-surface border-r border-border flex flex-col h-full shrink-0 transition-[width] duration-200`}
    >
      {/* 顶部：返回 + 项目名 */}
      <div className={`border-b border-border ${collapsed ? 'p-2' : 'p-3'}`}>
        <button
          onClick={onBack}
          title="返回首页"
          className={`flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm transition-colors ${collapsed ? 'justify-center w-full' : 'mb-2'}`}
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          {!collapsed && <span>返回首页</span>}
        </button>
        {!collapsed && (
          <h2 className="text-text-primary font-semibold text-sm truncate px-1 mt-1" title={projectName}>
            {projectName}
          </h2>
        )}
      </div>

      {/* 导航 */}
      <nav className="flex-1 py-1.5 overflow-y-auto overflow-x-hidden">
        {NAV_STRUCTURE.map((section) => (
          <div key={section.id} className="mb-1">

            {/* 分区标题 */}
            {!collapsed && (
              <div className="px-3 pt-2 pb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/60 select-none">
                  {section.label}
                </span>
              </div>
            )}
            {collapsed && (
              <div className="mx-2 my-1 border-t border-border/50" />
            )}

            {/* 直接子项 */}
            {section.items?.map(item => (
              <NavButton
                key={item.id}
                item={item}
                active={isActive(item.id)}
                collapsed={collapsed}
                onSelect={onSelect}
              />
            ))}

            {/* 嵌套子分组（设定库） */}
            {section.groups?.map(group => (
              <div key={group.id}>
                {/* 子分组标题行 */}
                {!collapsed ? (
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-secondary transition-colors group"
                  >
                    <div className="flex items-center gap-1.5">
                      <Wand2 className="w-3 h-3 text-accent/50 group-hover:text-accent transition-colors" />
                      <span>{group.label}</span>
                    </div>
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${expandedGroups.has(group.id) ? '' : '-rotate-90'}`}
                    />
                  </button>
                ) : null}

                {/* 子分组内容 */}
                {(collapsed || expandedGroups.has(group.id)) && (
                  <div className={!collapsed ? 'ml-2 border-l border-border/40 pl-1' : ''}>
                    {group.items.map(item => (
                      <NavButton
                        key={item.id}
                        item={item}
                        active={isActive(item.id)}
                        collapsed={collapsed}
                        onSelect={onSelect}
                        indented={!collapsed}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </nav>

      {/* 底部：折叠切换 */}
      <div className="border-t border-border p-2 flex justify-center">
        <button
          onClick={onToggleCollapse}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  )
}

// ── 单个导航按钮 ─────────────────────────────────────────────
function NavButton({
  item, active, collapsed, onSelect, indented = false,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  onSelect: (id: SidebarModule) => void
  indented?: boolean
}) {
  const Icon = item.icon
  return (
    <button
      onClick={() => onSelect(item.id)}
      title={collapsed ? item.label : undefined}
      className={`
        w-full flex items-center gap-2 text-sm transition-all
        ${collapsed ? 'justify-center px-0 py-2.5' : `${indented ? 'px-3' : 'px-4'} py-2`}
        ${active
          ? 'text-accent bg-accent/10 border-r-2 border-accent'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
        }
      `}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {!collapsed && <span className={indented ? 'text-[13px]' : ''}>{item.label}</span>}
    </button>
  )
}
