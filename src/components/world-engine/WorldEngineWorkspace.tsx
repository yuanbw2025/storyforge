import {
  ArrowRight,
  BookOpen,
  Layers3,
  Map,
  Network,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { SidebarModule } from '../layout/sidebar-tree'
import type { WorldCapabilityArea } from '../../lib/registry/types'
import type { WorldDomainSummary, WorldProjection } from '../../lib/world-engine/domain'
import WorldWorkManager from './WorldWorkManager'
import WorldNarrativeReleasePanel from './WorldNarrativeReleasePanel'

interface Props {
  projection?: WorldProjection
  onOpenModule: (module: SidebarModule) => void
  activeWorkId?: number | null
  onWorkChanged?: () => Promise<void> | void
  onOpenGameProduction?: (handoff: import('../../lib/types').WorldGameProductionHandoffV2) => void
}

interface DomainModuleLink {
  module: SidebarModule
  label: string
}

const DOMAIN_META: Record<WorldCapabilityArea, { icon: LucideIcon; modules: readonly DomainModuleLink[] }> = {
  foundation: {
    icon: Sparkles,
    modules: [
      { module: 'world-rules', label: '世界规则' },
      { module: 'worldview-origin', label: '世界起源' },
      { module: 'worldview-natural', label: '自然环境' },
      { module: 'worldview-humanity', label: '人文环境' },
      { module: 'history', label: '历史年表' },
      { module: 'world-map', label: '世界地图' },
    ],
  },
  story: {
    icon: BookOpen,
    modules: [
      { module: 'story-design', label: '故事设计' },
      { module: 'foreshadow', label: '伏笔管理' },
    ],
  },
  characters: {
    icon: Users,
    modules: [
      { module: 'characters', label: '角色档案' },
    ],
  },
  relations: {
    icon: Network,
    modules: [{ module: 'relations', label: '角色关系' }],
  },
  entities: {
    icon: Map,
    modules: [{ module: 'locations', label: '地点与实体' }],
  },
  storylines: {
    icon: Layers3,
    modules: [{ module: 'story-arc', label: '主线与支线' }],
  },
  outline: {
    icon: BookOpen,
    modules: [
      { module: 'outline', label: '大纲' },
    ],
  },
  'detailed-outline': {
    icon: Layers3,
    modules: [{ module: 'outline', label: '细纲' }],
  },
  manuscript: {
    icon: BookOpen,
    modules: [{ module: 'outline', label: '章节与正文' }],
  },
  'multi-world': {
    icon: Network,
    modules: [{ module: 'world-overview', label: '位面与多世界' }],
  },
}

const STATUS_LABELS: Record<WorldDomainSummary['status'], string> = {
  empty: '尚未建立',
  partial: '建设中',
  ready: '已有基础',
}

const STATUS_TONES: Record<WorldDomainSummary['status'], string> = {
  empty: 'neutral',
  partial: 'warning',
  ready: 'success',
}

const TABLE_LABELS: Record<string, string> = {
  worldviews: '世界设定',
  worldRulesProfiles: '世界规则',
  geographies: '地理环境',
  histories: '历史',
  worldNodes: '空间节点',
  powerSystems: '力量体系',
  cultivationSystems: '修炼体系',
  historicalTimelineEvents: '历史年表',
  historicalKeywords: '历史词条',
  importantLocations: '重要地点',
  characters: '角色',
  characterRelations: '角色关系',
  codexEntries: '知识词条',
  storyCores: '故事核心',
  storyArcs: '故事线',
  outlineNodes: '大纲',
  detailedOutlines: '细纲',
  chapters: '正文',
  foreshadows: '伏笔',
  worldGroups: '位面与子世界',
  worldGroupLinks: '世界通道',
  storylineProgress: '故事线进度',
  storylineCrossings: '故事线交汇',
  storyTimelineEvents: '故事年表',
  temporalFacts: '时序事实',
  knowledgeLedger: '角色认知',
  itemLedger: '物品事件',
}

const TABLE_DISPLAY_PRIORITY: Record<WorldDomainSummary['key'], readonly string[]> = {
  foundation: ['worldviews', 'worldRulesProfiles', 'geographies', 'histories', 'powerSystems', 'cultivationSystems', 'historicalTimelineEvents'],
  story: ['storyCores', 'storyTimelineEvents', 'temporalFacts', 'foreshadows', 'cultivationProgress'],
  characters: ['characters'],
  relations: ['characterRelations', 'knowledgeLedger'],
  entities: ['importantLocations', 'worldNodes', 'codexEntries', 'itemLedger', 'stateCards'],
  storylines: ['storyArcs', 'storylineProgress', 'storylineCrossings'],
  outline: ['outlineNodes'],
  'detailed-outline': ['detailedOutlines'],
  manuscript: ['chapters'],
  'multi-world': ['worldGroups', 'worldGroupLinks'],
}

function DomainCard({ summary, onOpenModule }: { summary: WorldDomainSummary; onOpenModule: Props['onOpenModule'] }) {
  const meta = DOMAIN_META[summary.key]
  const Icon = meta.icon
  const priority = TABLE_DISPLAY_PRIORITY[summary.key]
  const activeTables = summary.tables
    .filter(table => table.rowCount > 0)
    .sort((left, right) => {
      const leftIndex = priority.indexOf(left.name)
      const rightIndex = priority.indexOf(right.name)
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    })
  return (
    <article className="sf-feature-card sf-world-domain-card">
      <span className={`sf-feature-icon sf-feature-${summary.key === 'foundation' ? 'ochre' : summary.key === 'characters' || summary.key === 'relations' ? 'teal' : summary.key === 'story' || summary.key === 'storylines' ? 'rust' : summary.key === 'multi-world' ? 'blue' : 'violet'}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="sf-feature-copy">
        <div className="sf-world-domain-heading">
          <h3>{summary.label}</h3>
          <span className={`sf-world-domain-status sf-world-domain-status-${STATUS_TONES[summary.status]}`}>
            {STATUS_LABELS[summary.status]}
          </span>
        </div>
        <p>{summary.description}</p>
      </div>
      <div className="sf-world-domain-progress" aria-label={`${summary.label}数据表覆盖度 ${summary.coverage}%`}>
        <span style={{ width: `${summary.coverage}%` }} />
      </div>
      <div className="sf-world-domain-meta">
        <span>{summary.activeTableCount}/{summary.tableCount} 类数据已有内容</span>
        <span>{summary.rowCount} 条记录</span>
      </div>
      <div className="sf-world-domain-tables">
        {activeTables.length > 0
          ? activeTables.slice(0, 4).map(table => <span key={table.name}>{TABLE_LABELS[table.name] ?? '结构化内容'} · {table.rowCount}</span>)
          : <span>从现有分步骤面板开始建立内容</span>}
      </div>
      <div className="sf-world-domain-modules" aria-label={`${summary.label}功能入口`}>
        {meta.modules.map(item => (
          <button key={item.module} onClick={() => onOpenModule(item.module)}>
            <span>{item.label}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </article>
  )
}

export default function WorldEngineWorkspace({ projection, onOpenModule, activeWorkId, onWorkChanged, onOpenGameProduction }: Props) {
  if (!projection) {
    return <div className="flex min-h-[20rem] items-center justify-center text-sm text-text-muted">正在读取世界内容…</div>
  }
  const domains = Object.values(projection.domains)
  return (
    <div className="sf-world-engine-workspace">
      <div className="sf-section-header">
        <div>
          <div className="sf-eyebrow">WORLD FOUNDATION / CANON</div>
          <h2>完整世界工作台</h2>
        </div>
        <span className="sf-project-status">
          <ShieldCheck className="h-3.5 w-3.5" />
          {projection.readiness === 'usable' ? '世界基础可供创作' : projection.readiness === 'building' ? '世界正在建设' : '从基础设定开始'}
        </span>
      </div>
      <div className="sf-world-domain-grid">
        {domains.map(summary => <DomainCard key={summary.key} summary={summary} onOpenModule={onOpenModule} />)}
      </div>
      <WorldWorkManager projectId={projection.projectId} activeWorkId={activeWorkId} onChanged={onWorkChanged ?? (() => {})} />
      <WorldNarrativeReleasePanel
        projectId={projection.projectId}
        activeWorkId={activeWorkId}
        onChanged={onWorkChanged ?? (() => {})}
        onOpenGameProduction={onOpenGameProduction ?? (() => {})}
      />
      <div className="sf-world-engine-lower-grid">
        <section className="sf-world-engine-bridge">
          <div className="sf-card-kicker"><Layers3 className="h-4 w-4" /> 内容关系</div>
          <h3>世界基础 → 作品与实例</h3>
          <div className="sf-world-engine-bridge-links">
            <button className="sf-action-tile" onClick={() => onOpenModule('outline')}><span className="sf-action-tile-icon"><BookOpen className="h-4 w-4" /></span><span><strong>分步骤叙事投影</strong><small>卷纲、章纲、细纲和正文继续使用原工作流</small></span><ArrowRight className="h-4 w-4" /></button>
            <button className="sf-action-tile" onClick={() => onOpenModule('world-map')}><span className="sf-action-tile-icon"><Map className="h-4 w-4" /></span><span><strong>空间与世界结构</strong><small>自然环境、地图和位面结构保持同一数据来源</small></span><ArrowRight className="h-4 w-4" /></button>
            <button className="sf-action-tile" onClick={() => onOpenModule('characters')}><span className="sf-action-tile-icon"><Users className="h-4 w-4" /></span><span><strong>角色与关系语义</strong><small>角色、地点和关系通过冻结世界版本供上层产品按需读取</small></span><ArrowRight className="h-4 w-4" /></button>
          </div>
        </section>
      </div>
    </div>
  )
}
