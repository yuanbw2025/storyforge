import {
  FileText, Globe, Sparkles, Users, Swords, Zap,
  MapPin, Clock, Gem, Ruler, Heart,
  BookOpen, PenTool, Eye, Package, Settings, ArrowLeft, History,
  ChevronLeft, ChevronRight,
} from 'lucide-react'

export type SidebarModule =
  | 'info'
  | 'worldview'
  | 'story-core'
  | 'characters'
  | 'relations'
  | 'factions'
  | 'power-system'
  | 'geography'
  | 'history'
  | 'items'
  | 'rules'
  | 'outline'
  | 'editor'
  | 'foreshadow'
  | 'backup'
  | 'export'
  | 'settings'

interface SidebarItem {
  id: SidebarModule
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: 'info', label: '基本信息', icon: FileText },
  { id: 'worldview', label: '世界观', icon: Globe },
  { id: 'story-core', label: '故事核心', icon: Sparkles },
  { id: 'characters', label: '角色', icon: Users },
  { id: 'relations', label: '角色关系', icon: Heart },
  { id: 'factions', label: '势力', icon: Swords },
  { id: 'power-system', label: '力量体系', icon: Zap },
  { id: 'geography', label: '地理环境', icon: MapPin },
  { id: 'history', label: '历史年表', icon: Clock },
  { id: 'items', label: '道具系统', icon: Gem },
  { id: 'rules', label: '创作规则', icon: Ruler },
  { id: 'outline', label: '大纲', icon: BookOpen },
  { id: 'editor', label: '写作', icon: PenTool },
  { id: 'foreshadow', label: '伏笔', icon: Eye },
  { id: 'backup', label: '版本历史', icon: History },
  { id: 'export', label: '导出', icon: Package },
  { id: 'settings', label: '设置', icon: Settings },
]

interface SidebarProps {
  active: SidebarModule
  onSelect: (module: SidebarModule) => void
  onBack: () => void
  projectName: string
  collapsed: boolean
  onToggleCollapse: () => void
}

export default function Sidebar({ active, onSelect, onBack, projectName, collapsed, onToggleCollapse }: SidebarProps) {
  return (
    <aside
      className={`${collapsed ? 'w-14' : 'w-52'} bg-bg-surface border-r border-border flex flex-col h-full shrink-0 transition-[width] duration-200`}
    >
      {/* 顶部：返回 + 项目名（折叠时只显示返回图标） */}
      <div className={`border-b border-border ${collapsed ? 'p-2' : 'p-3'}`}>
        <button
          onClick={onBack}
          title="返回首页"
          className={`flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm transition-colors ${collapsed ? 'justify-center w-full mb-0' : 'mb-2'}`}
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          {!collapsed && <span>返回首页</span>}
        </button>
        {!collapsed && (
          <h2 className="text-text-primary font-semibold text-sm truncate px-1" title={projectName}>
            {projectName}
          </h2>
        )}
      </div>

      {/* 导航列表 */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        {SIDEBAR_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              title={collapsed ? item.label : undefined}
              className={`
                w-full flex items-center gap-2.5 text-sm transition-all
                ${collapsed ? 'justify-center px-0 py-2.5' : 'px-4 py-2.5'}
                ${isActive
                  ? 'text-accent bg-accent/10 border-r-2 border-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }
              `}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* 底部：折叠切换按钮 */}
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
