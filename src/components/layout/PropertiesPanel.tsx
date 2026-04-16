import { X, BookOpen, PenTool, Globe, Users, Heart, MapPin, Eye, FileText, Info } from 'lucide-react'
import { useOutlineStore } from '../../stores/outline'
import { useChapterStore } from '../../stores/chapter'
import { useCharacterStore } from '../../stores/character'
import { useCharacterRelationStore } from '../../stores/character-relation'
import { useGeographyStore } from '../../stores/geography'
import { useForeshadowStore } from '../../stores/foreshadow'
import type { SidebarModule } from './Sidebar'

interface Props {
  activeModule: SidebarModule
  onClose: () => void
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5 border-b border-border last:border-0">
      <span className="text-xs text-text-muted shrink-0">{label}</span>
      <span className="text-xs text-text-primary text-right">{value}</span>
    </div>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{title}</span>
      </div>
      <div className="bg-bg-elevated rounded-lg px-3 py-1">
        {children}
      </div>
    </div>
  )
}

/** 大纲 & 写作 属性 */
function OutlineProps() {
  const { nodes } = useOutlineStore()
  const { chapters, currentChapter } = useChapterStore()

  const volumes = nodes.filter(n => n.type === 'volume').length
  const arcs = nodes.filter(n => n.type === 'arc').length
  const chapterNodes = nodes.filter(n => n.type === 'chapter').length
  const totalWords = chapters.reduce((s, c) => s + (c.wordCount || 0), 0)
  const writtenChapters = chapters.filter(c => c.wordCount > 0).length

  return (
    <>
      <Section title="大纲统计" icon={BookOpen}>
        <Stat label="卷数" value={volumes} />
        <Stat label="篇章数" value={arcs} />
        <Stat label="章节数" value={chapterNodes} />
        <Stat label="已写章节" value={`${writtenChapters} / ${chapterNodes}`} />
        <Stat label="累计字数" value={`${totalWords.toLocaleString()} 字`} />
      </Section>
      {currentChapter && (
        <Section title="当前章节" icon={PenTool}>
          <Stat label="标题" value={currentChapter.title} />
          <Stat label="状态" value={currentChapter.status} />
          <Stat label="字数" value={`${currentChapter.wordCount.toLocaleString()} 字`} />
          <Stat label="更新时间" value={formatDate(currentChapter.updatedAt)} />
        </Section>
      )}
    </>
  )
}

/** 角色属性 */
function CharacterProps() {
  const { characters } = useCharacterStore()
  const { relations } = useCharacterRelationStore()

  const roleCount = {
    protagonist: characters.filter(c => c.role === 'protagonist').length,
    antagonist: characters.filter(c => c.role === 'antagonist').length,
    supporting: characters.filter(c => c.role === 'supporting').length,
    minor: characters.filter(c => c.role === 'minor').length,
  }

  return (
    <Section title="角色统计" icon={Users}>
      <Stat label="总角色数" value={characters.length} />
      <Stat label="主角" value={roleCount.protagonist} />
      <Stat label="反派" value={roleCount.antagonist} />
      <Stat label="重要配角" value={roleCount.supporting} />
      <Stat label="次要角色" value={roleCount.minor} />
      <Stat label="关系连线" value={relations.length} />
    </Section>
  )
}

/** 角色关系属性 */
function RelationProps() {
  const { relations } = useCharacterRelationStore()
  const { characters } = useCharacterStore()

  const typeCount: Record<string, number> = {}
  relations.forEach(r => { typeCount[r.relationType] = (typeCount[r.relationType] || 0) + 1 })
  const topType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]

  return (
    <Section title="关系统计" icon={Heart}>
      <Stat label="角色数" value={characters.length} />
      <Stat label="关系总数" value={relations.length} />
      <Stat label="双向关系" value={relations.filter(r => r.isBidirectional).length} />
      <Stat label="单向关系" value={relations.filter(r => !r.isBidirectional).length} />
      {topType && <Stat label="最多类型" value={`${topType[0]}（${topType[1]}条）`} />}
    </Section>
  )
}

/** 地理属性 */
function GeographyProps() {
  const { geography } = useGeographyStore()

  let locations: { type: string }[] = []
  try { locations = JSON.parse(geography?.locations || '[]') } catch { /* ignore */ }

  const typeCount: Record<string, number> = {}
  locations.forEach((l) => { typeCount[l.type] = (typeCount[l.type] || 0) + 1 })

  return (
    <Section title="地理统计" icon={MapPin}>
      <Stat label="地点总数" value={locations.length} />
      {Object.entries(typeCount).map(([type, count]) => (
        <Stat key={type} label={type} value={count} />
      ))}
    </Section>
  )
}

/** 伏笔属性 */
function ForeshadowProps() {
  const { foreshadows } = useForeshadowStore()

  const planned = foreshadows.filter(f => f.status === 'planned').length
  const planted = foreshadows.filter(f => f.status === 'planted').length
  const echoed = foreshadows.filter(f => f.status === 'echoed').length
  const resolved = foreshadows.filter(f => f.status === 'resolved').length

  return (
    <Section title="伏笔统计" icon={Eye}>
      <Stat label="总伏笔" value={foreshadows.length} />
      <Stat label="计划中" value={planned} />
      <Stat label="已埋设" value={planted} />
      <Stat label="已呼应" value={echoed} />
      <Stat label="已回收" value={resolved} />
      <Stat label="未回收" value={planned + planted + echoed} />
    </Section>
  )
}

/** 通用提示 */
function GenericProps({ module }: { module: SidebarModule }) {
  const tips: Record<string, { icon: React.ComponentType<{ className?: string }>; title: string; tips: string[] }> = {
    worldview: {
      icon: Globe,
      title: '世界观',
      tips: ['世界观是AI写作的核心上下文', '建议先填写基础设定再开始写作', '功法体系会影响战斗场景的生成质量'],
    },
    'story-core': {
      icon: FileText,
      title: '故事核心',
      tips: ['故事核心定义主线冲突与主题', '清晰的主角动机有助于AI保持人物一致性'],
    },
    factions: {
      icon: Users,
      title: '势力',
      tips: ['势力关系图谱影响政治剧情生成', '建议标注各势力的核心矛盾'],
    },
    'power-system': {
      icon: Info,
      title: '力量体系',
      tips: ['力量体系的层次越清晰，战斗场景越合理', '建议列出主角所在等级与突破条件'],
    },
    history: {
      icon: Info,
      title: '历史年表',
      tips: ['历史事件会为伏笔提供时间参考', '标注影响当前剧情的关键节点'],
    },
    items: {
      icon: Info,
      title: '道具系统',
      tips: ['重要道具应标注首次出现章节', '神兵利器建议写明来历和能力上限'],
    },
    rules: {
      icon: Info,
      title: '创作规则',
      tips: ['创作规则会作为system prompt附加到所有AI请求', '规则越简洁越有效'],
    },
    backup: {
      icon: Info,
      title: '版本历史',
      tips: ['每5分钟自动备份一次', '可手动创建快照保存重要版本'],
    },
    export: {
      icon: Info,
      title: '导出',
      tips: ['支持 Markdown、TXT、JSON 三种格式', 'JSON格式可完整还原项目数据'],
    },
    settings: {
      icon: Info,
      title: '设置',
      tips: ['推荐使用 DeepSeek 以降低成本', 'API Key 仅存储在本地 localStorage'],
    },
    info: {
      icon: FileText,
      title: '基本信息',
      tips: ['项目信息会附加在AI上下文中', '目标字数用于追踪写作进度'],
    },
  }

  const data = tips[module]
  if (!data) return null
  const Icon = data.icon

  return (
    <Section title={data.title} icon={Icon}>
      <div className="py-1 space-y-2">
        {data.tips.map((tip, i) => (
          <p key={i} className="text-xs text-text-muted leading-relaxed">
            · {tip}
          </p>
        ))}
      </div>
    </Section>
  )
}

/** 属性面板主体 */
export default function PropertiesPanel({ activeModule, onClose }: Props) {
  const renderContent = () => {
    switch (activeModule) {
      case 'outline':
      case 'editor':
        return <OutlineProps />
      case 'characters':
        return <CharacterProps />
      case 'relations':
        return <RelationProps />
      case 'geography':
        return <GeographyProps />
      case 'foreshadow':
        return <ForeshadowProps />
      default:
        return <GenericProps module={activeModule} />
    }
  }

  return (
    <aside className="w-60 bg-bg-surface border-l border-border flex flex-col h-full shrink-0">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">属性</span>
        <button
          onClick={onClose}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-3">
        {renderContent()}
      </div>
    </aside>
  )
}
