import {
  FileText, Globe, Sparkles, Users, Swords, Zap,
  MapPin, Clock, Gem, Ruler,
  BookOpen, PenTool, Eye, Settings, ArrowLeft,
} from 'lucide-react'

export type SidebarModule =
  | 'info'          // 基本信息
  | 'worldview'     // 世界观
  | 'story-core'    // 故事核心
  | 'characters'    // 角色
  | 'factions'      // 势力
  | 'power-system'  // 力量体系
  | 'geography'     // 地理环境
  | 'history'       // 历史年表
  | 'items'         // 道具系统
  | 'rules'         // 创作规则
  | 'outline'       // 大纲
  | 'editor'        // 写作
  | 'foreshadow'    // 伏笔
  | 'settings'      // 设置

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
  { id: 'factions', label: '势力', icon: Swords },
  { id: 'power-system', label: '力量体系', icon: Zap },
  { id: 'geography', label: '地理环境', icon: MapPin },
  { id: 'history', label: '历史年表', icon: Clock },
  { id: 'items', label: '道具系统', icon: Gem },
  { id: 'rules', label: '创作规则', icon: Ruler },
  { id: 'outline', label: '大纲', icon: BookOpen },
  { id: 'editor', label: '写作', icon: PenTool },
  { id: 'foreshadow', label: '伏笔', icon: Eye },
  { id: 'settings', label: '设置', icon: Settings },
]

interface SidebarProps {
  active: SidebarModule
  onSelect: (module: SidebarModule) => void
  onBack: () => void
  projectName: string
}

export default function Sidebar({ active, onSelect, onBack, projectName }: SidebarProps) {
  return (
    <aside className="w-52 bg-bg-surface border-r border-border flex flex-col h-full shrink-0">
      {/* 顶部：返回 + 项目名 */}
      <div className="p-3 border-b border-border">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm transition-colors mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回首页</span>
        </button>
        <h2 className="text-text-primary font-semibold text-sm truncate px-1" title={projectName}>
          {projectName}
        </h2>
      </div>

      {/* 导航列表 */}
      <nav className="flex-1 py-2 overflow-y-auto">
        {SIDEBAR_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`
                w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-all
                ${isActive
                  ? 'text-accent bg-accent/10 border-r-2 border-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }
              `}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
