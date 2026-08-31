import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  Activity,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronRight,
  Gamepad2,
  GitBranch,
  Globe2,
  Hash,
  LayoutDashboard,
  Menu,
  Map,
  MonitorPlay,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Swords,
  Workflow,
  X,
} from 'lucide-react'
import type { Project, SimulationSessionKind, WorkspaceScope, WorldGameProductionHandoffV2 } from '../lib/types'
import type { OnlineRoomJoinHandoffV1 } from '../lib/online/http-transport'
import { db } from '../lib/db/schema'
import { createWorldInstance } from '../lib/world-engine/instances'
import { parseWorldGameProductionHandoffV2 } from '../lib/game-production/handoff'
import {
  currentAiGmBetaGatePassedV1,
  currentGamePlatformEnvironmentV1,
  evaluateGamePlatformCapabilityV1,
  type GamePlatformCapabilityDecisionV1,
} from '../lib/game-platform/capability-status'
import { useProjectStore } from '../stores/project'
import { useWorldGroupStore } from '../stores/world-group'
import type { WorldProjection } from '../lib/world-engine/domain'
import { loadWorldProjections } from '../lib/world-engine/domain'
import WorldEngineWorkspace from '../components/world-engine/WorldEngineWorkspace'
import type { SidebarModule } from '../components/layout/sidebar-tree'
import WorldSharingPanel from '../components/product/WorldSharingPanel'
import ProjectStorageFolderField from '../components/shared/ProjectStorageFolderField'
import { bindCreatedProjectStorageWorkspace } from '../lib/storage/project-storage-workspace'
import { useActiveWork } from '../hooks/useActiveWork'
import WorkKindBadge from '../components/work/WorkKindBadge'
import { effectiveNovelProfile, effectiveWorkKind, SHORT_NOVEL_DEFAULT_WORDS } from '../lib/world-engine/work-kind'
import { switchNovelProfile } from '../lib/world-engine/works'
import WorldDerivationActions from '../components/world-engine/WorldDerivationActions'
import './product-hub.css'

const NodeAuthoringWorkspace = lazy(() => import('../components/node-authoring/NodeAuthoringWorkspace'))
const SimulationRuntimePanel = lazy(() => import('../components/simulation/SimulationRuntimePanel'))
const ChatGamePanel = lazy(() => import('../components/simulation/ChatGamePanel'))
const CharacterInteractionProductionStudio = lazy(() => import('../components/character-interaction/CharacterInteractionProductionStudio'))
const StoryGamePlayer = lazy(() => import('../components/text-game/StoryGamePlayer'))
const StoryGameWorkbench = lazy(() => import('../components/text-game/StoryGameWorkbench'))
const AdventureGamePlayer = lazy(() => import('../components/text-game/AdventureGamePlayer'))
const AdventureGameWorkbench = lazy(() => import('../components/text-game/AdventureGameWorkbench'))
const AvgGamePlayer = lazy(() => import('../components/text-game/AvgGamePlayer'))
const AvgGameWorkbench = lazy(() => import('../components/text-game/AvgGameWorkbench'))
const NarrativeSimulationPlayer = lazy(() => import('../components/text-game/NarrativeSimulationPlayer'))
const NarrativeSimulationWorkbench = lazy(() => import('../components/text-game/NarrativeSimulationWorkbench'))
const TextOpenWorldPlayer = lazy(() => import('../components/text-game/TextOpenWorldPlayer'))
const TextOpenWorldWorkbench = lazy(() => import('../components/text-game/TextOpenWorldWorkbench'))
const GameProductionStudio = lazy(() => import('../components/text-game/GameProductionStudio'))
const TtrpgProductStudio = lazy(() => import('../components/ttrpg/TtrpgProductStudio'))
const TtrpgProductionWorkspace = lazy(() => import('../components/ttrpg/TtrpgProductionWorkspace'))
const MarketplacePanel = lazy(() => import('../components/community/MarketplacePanel'))
const OutlinePanel = lazy(() => import('../components/outline/OutlinePanel'))
const ChaptersListPanel = lazy(() => import('../components/editor/ChaptersListPanel'))
const ScreenplayStudio = lazy(() => import('../components/screenplay/ScreenplayStudio'))
const ComicStudio = lazy(() => import('../components/comic/ComicStudio'))

type TabId = 'home' | 'worlds' | 'novel' | 'nodes' | 'ttrpg' | 'chat' | 'game' | 'market'
type Accent = 'ochre' | 'teal' | 'blue' | 'violet' | 'rust'

type ProductWorld = {
  projectId: number
  code: string
  name: string
  description: string
  version: number
  source: string
  tags: string[]
  accent: Accent
  completeness: number
  project: Project
  projection?: WorldProjection
}

function scopeForProject(project: Project): WorkspaceScope | undefined {
  return project.id != null && project.activeWorldId != null && project.activeWorkId != null
    ? { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
    : undefined
}

const NAV_TABS: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'home', label: '总览', icon: LayoutDashboard },
  { id: 'worlds', label: '世界引擎', icon: Globe2 },
  { id: 'novel', label: '作品创作', icon: BookOpenText },
  { id: 'nodes', label: '节点创作', icon: Workflow },
  { id: 'ttrpg', label: '跑团', icon: Swords },
  { id: 'chat', label: '角色聊天', icon: MessageCircle },
  { id: 'game', label: '文字游戏', icon: Gamepad2 },
  { id: 'market', label: '社区市场', icon: Store },
]

const FEATURE_META: Record<Exclude<TabId, 'home'>, { eyebrow: string; description: string; icon: typeof Globe2; accent: Accent }> = {
  worlds: { eyebrow: 'FOUNDATION', description: '把设定、角色和规则整理成可持续复用的世界版本。', icon: Globe2, accent: 'ochre' },
  novel: { eyebrow: 'AUTHORING', description: '在同一套可靠工作流中创作短篇、长篇，并承接剧本与漫画改编。', icon: BookOpenText, accent: 'rust' as Accent },
  nodes: { eyebrow: 'FLOW', description: '自由组合世界资料、处理中间产物和生成节点。', icon: Workflow, accent: 'blue' },
  ttrpg: { eyebrow: 'PLAY', description: '选择一个世界版本，开始战役、行动和事件回放。', icon: Swords, accent: 'teal' },
  chat: { eyebrow: 'CHARACTERS', description: '冻结一个世界与角色快照，开始可分支的独立角色聊天。', icon: MessageCircle, accent: 'violet' },
  game: { eyebrow: 'STORY GAME', description: '从冻结的主线或支线开始独立游玩，并保留事件、检查点与分支。', icon: Gamepad2, accent: 'blue' },
  market: { eyebrow: 'COMMUNITY', description: '发现、领取和发布完整可验证的跑团与文字游戏发行物。', icon: Store, accent: 'ochre' },
}

function Button({
  children,
  onClick,
  variant = 'secondary',
  icon: Icon,
  disabled = false,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'quiet'
  icon?: typeof Plus
  disabled?: boolean
}) {
  return (
    <button className={`sf-button sf-button-${variant}`} onClick={onClick} disabled={disabled}>
      {Icon && <Icon className="h-4 w-4" />}
      <span>{children}</span>
    </button>
  )
}

function CapabilityConsentGate(props: {
  decision: GamePlatformCapabilityDecisionV1
  onEnable: () => void | Promise<void>
}) {
  return <section className="m-5 rounded-lg border border-warning/40 bg-warning/5 p-6" data-testid={`capability-consent-${props.decision.capability.id}`}>
    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><ShieldCheck className="h-4 w-4 text-warning" />{props.decision.capability.userLabel}需要项目授权</div>
    <p className="mt-2 max-w-3xl text-xs leading-6 text-text-secondary">{props.decision.capability.reason}</p>
    <p className="mt-2 text-[10px] text-warning">当前阻塞：{props.decision.blockers.join('；')}</p>
    <button type="button" onClick={() => void props.onEnable()} className="mt-4 rounded bg-accent px-4 py-2 text-xs text-white">为当前项目显式启用</button>
    <p className="mt-2 text-[10px] leading-5 text-text-muted">授权会保存在项目根记录并随完整备份导出；不会开启在线服务、支付，也不会绕过正式发布或质量门。</p>
  </section>
}

function WorldGlyph({ accent, small = false }: { accent: Accent; small?: boolean }) {
  return (
    <div className={`sf-world-glyph sf-world-glyph-${accent} ${small ? 'sf-world-glyph-small' : ''}`} aria-hidden="true">
      <div className="sf-glyph-grid" />
      <div className="sf-glyph-land sf-glyph-land-one" />
      <div className="sf-glyph-land sf-glyph-land-two" />
      <div className="sf-glyph-line sf-glyph-line-one" />
      <div className="sf-glyph-line sf-glyph-line-two" />
      <span className="sf-glyph-mark" />
    </div>
  )
}

function StatusDot({ tone = 'success' }: { tone?: 'success' | 'warning' | 'neutral' }) {
  return <span className={`sf-status-dot sf-status-dot-${tone}`} aria-hidden="true" />
}

function projectToWorld(project: Project, index: number, projection: WorldProjection): ProductWorld {
  const tags = (project.genres?.length ? project.genres : [project.genre]).filter(Boolean).slice(0, 2)
  return {
    projectId: project.id!,
    code: projection.code,
    name: projection.name,
    description: projection.description,
    version: projection.version,
    source: project.communityOrigin ? `社区导入 · ${project.communityOrigin.sourceWorldCode}` : project.enableMultiWorld ? '世界草稿 · 多世界结构' : '世界草稿',
    tags,
    accent: (['ochre', 'teal', 'blue', 'violet'] as Accent[])[index % 4],
    completeness: projection?.completeness ?? 0,
    project,
    projection,
  }
}

function ProductHeader({
  activeTab,
  onSelect,
  onOpenCreate,
  onOpenMobileNav,
  onOpenWorldPicker,
}: {
  activeTab: TabId
  onSelect: (tab: TabId) => void
  onOpenCreate: () => void
  onOpenMobileNav: () => void
  onOpenWorldPicker: () => void
}) {
  return (
    <header className="sf-header">
      <div className="sf-header-inner">
        <button className="sf-brand" onClick={() => onSelect('home')} aria-label="回到总览">
          <span className="sf-brand-mark"><Sparkles className="h-4 w-4" /></span>
          <span><span className="sf-brand-name">storyforge</span><span className="sf-brand-subtitle">创作与游玩空间</span></span>
        </button>
        <nav className="sf-primary-nav" aria-label="产品页签">
          {NAV_TABS.map(tab => {
            const Icon = tab.icon
            return <button key={tab.id} onClick={() => onSelect(tab.id)} className={`sf-nav-tab ${activeTab === tab.id ? 'sf-nav-tab-active' : ''}`} data-testid={`product-tab-${tab.id}`}><Icon className="h-4 w-4" /><span>{tab.label}</span></button>
          })}
        </nav>
        <div className="sf-header-actions">
          <button className="sf-icon-button sf-mobile-menu" onClick={onOpenMobileNav} title="打开导航" aria-label="打开导航"><Menu className="h-4 w-4" /></button>
          <button className="sf-icon-button" onClick={onOpenWorldPicker} title="搜索世界" aria-label="搜索世界"><Search className="h-4 w-4" /></button>
          <Button variant="primary" icon={Plus} onClick={onOpenCreate}>新建</Button>
          <button className="sf-avatar" title="本地工作区" aria-label="本地工作区">林</button>
        </div>
      </div>
    </header>
  )
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="sf-page-heading"><div><div className="sf-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="sf-heading-action">{action}</div>}</div>
}

function BindingBanner({ world, onChange }: { world: ProductWorld; onChange: () => void }) {
  return <div className="sf-binding-banner"><span className="sf-binding-icon"><WorldGlyph accent={world.accent} small /></span><div><strong>运行基座：{world.name} <code>{world.code}@v{world.version}</code></strong><p>本功能读取选定的世界版本；运行记录不会自动改写世界引擎。</p></div><Button icon={Hash} onClick={onChange}>更换世界</Button></div>
}

function useSelectedWorldGroupId(project?: Project): number | null {
  const activeGroupId = useWorldGroupStore(state => state.activeGroupId)
  const loadAll = useWorldGroupStore(state => state.loadAll)
  useEffect(() => {
    if (project?.id && project.enableMultiWorld) void loadAll(project.id)
  }, [project?.id, project?.enableMultiWorld, loadAll])
  return project?.enableMultiWorld ? activeGroupId : null
}

function EmptyProjectState({ onCreate }: { onCreate: () => void }) {
  return <section className="sf-product-empty"><Globe2 className="h-8 w-8" /><h2>先建立一个世界或作品</h2><p>世界引擎与独立作品分别创建；长篇或短篇可在作者确认后显式派生世界。</p><Button variant="primary" icon={Plus} onClick={onCreate}>新建内容</Button></section>
}

function FeaturePanelFallback() {
  return <div className="flex min-h-[20rem] items-center justify-center text-sm text-text-muted">面板加载中…</div>
}

function HomePage({ worlds, activeWorld, activeWorkProject, onSelect, onSelectWorld, onOpenCreate, onOpenWorldPicker }: { worlds: ProductWorld[]; activeWorld?: ProductWorld; activeWorkProject?: Project; onSelect: (id: TabId) => void; onSelectWorld: (world: ProductWorld) => void; onOpenCreate: () => void; onOpenWorldPicker: () => void }) {
  const activeWork = useActiveWork(activeWorkProject)
  return <>
    <div className="sf-home-intro"><div><div className="sf-eyebrow">STORYFORGE · LOCAL WORKSPACE</div><h1>你的创作与游玩空间</h1><p>从一个世界出发，继续写作、编排、游玩，或者开始一段新的故事。</p></div><div className="sf-intro-actions"><Button icon={Hash} onClick={onOpenWorldPicker}>使用世界编号</Button><Button variant="primary" icon={Plus} onClick={onOpenCreate}>新建内容</Button></div></div>
    {(activeWorld || activeWorkProject) ? <section className="sf-resume-grid">{activeWorld && <article className="sf-resume-card sf-resume-primary"><div className="sf-resume-visual"><span className="sf-visual-label"><StatusDot /> 当前世界</span><span className="sf-visual-rule" /><span className="sf-visual-coordinate">{activeWorld.code} · v{activeWorld.version}</span></div><div className="sf-resume-content"><span className="sf-card-kicker"><Globe2 className="h-4 w-4" /> 世界引擎</span><h2>{activeWorld.name}</h2><p>{activeWorld.description}</p><div className="sf-progress"><span style={{ width: `${activeWorld.completeness}%` }} /></div><div className="sf-resume-meta"><span>数据域覆盖 {activeWorld.completeness}%</span><span>{activeWorld.source}</span></div><Button icon={ArrowRight} onClick={() => onSelect('worlds')}>进入世界引擎</Button></div></article>}{activeWorkProject && <article className="sf-resume-card sf-resume-secondary"><div className="sf-resume-secondary-head"><span className="sf-card-kicker"><BookOpenText className="h-4 w-4" /> 最近作品</span><StatusDot tone="neutral" /></div><div className="sf-campaign-avatar"><BookOpenText className="h-5 w-5" /></div><h2>{activeWorkProject.name}</h2>{activeWork && <WorkKindBadge work={activeWork} />}<p>{activeWork && effectiveWorkKind(activeWork) !== 'novel' ? '进入作品工作台继续制作' : `分步骤创作 · ${activeWorkProject.currentWordCount ? `${(activeWorkProject.currentWordCount / 10000).toFixed(1)} 万字` : '尚未开始正文'}`}</p><div className="sf-event-list"><div><StatusDot /><span>作品保持独立，不会自动公开为世界</span></div><div><StatusDot tone="warning" /><span>继续完善当前作品</span></div></div><Button variant="quiet" icon={ArrowRight} onClick={() => onSelect('novel')}>继续创作</Button></article>}</section> : <EmptyProjectState onCreate={onOpenCreate} />}
    <section className="sf-section"><div className="sf-section-header"><div><div className="sf-eyebrow">YOUR WORKSPACE</div><h2>从这里开始</h2></div><button className="sf-text-button" onClick={onOpenCreate}>新建 <ArrowRight className="h-4 w-4" /></button></div><div className="sf-feature-grid">{(Object.keys(FEATURE_META) as Array<Exclude<TabId, 'home'>>).map(id => { const meta = FEATURE_META[id]; const Icon = meta.icon; return <button key={id} className="sf-feature-card" onClick={() => onSelect(id)}><span className={`sf-feature-icon sf-feature-${meta.accent}`}><Icon className="h-5 w-5" /></span><span className="sf-feature-copy"><span className="sf-eyebrow">{meta.eyebrow}</span><h3>{NAV_TABS.find(tab => tab.id === id)?.label}</h3><p>{meta.description}</p></span><span className="sf-feature-footer"><span>{id === 'worlds' ? `${worlds.length} 个世界` : id === 'novel' ? '保留现有工作流' : id === 'nodes' ? '独立 DAG 工作区' : id === 'ttrpg' ? '冻结来源制作与试玩' : id === 'chat' ? '多角色生产与运行闭环' : id === 'market' ? '可验证分发闭环' : '共享运行时已可用'}</span><ArrowRight className="h-4 w-4" /></span></button> })}</div></section>
    <section className="sf-section"><div className="sf-section-header"><div><div className="sf-eyebrow">WORLD LIBRARY</div><h2>我的世界引擎</h2></div><button className="sf-text-button" onClick={() => onSelect('worlds')}>管理世界 <ArrowRight className="h-4 w-4" /></button></div><div className="sf-world-grid">{worlds.slice(0, 3).map(world => <WorldCard key={world.code} world={world} onOpen={() => { onSelectWorld(world); onSelect('worlds') }} />)}<button className="sf-new-world-card" onClick={onOpenCreate}><span className="sf-new-world-plus"><Plus className="h-5 w-5" /></span><strong>从零创建世界</strong><span>建立一个可被作品与游戏引用的新世界</span></button></div></section>
  </>
}

function WorldCard({ world, onOpen }: { world: ProductWorld; onOpen: () => void }) {
  return <button className="sf-world-card" onClick={onOpen}><WorldGlyph accent={world.accent} /><div className="sf-world-card-body"><div className="sf-card-topline"><span className="sf-overline"><Hash className="h-3 w-3" /> {world.code}</span><span className="sf-version">v{world.version}</span></div><h3>{world.name}</h3><p>{world.description}</p><div className="sf-tag-row">{world.tags.map(tag => <span className="sf-tag" key={tag}>{tag}</span>)}</div><div className="sf-world-card-footer"><span className="sf-source"><StatusDot tone={world.project.communityOrigin ? 'neutral' : 'success'} />{world.source}</span><span className="sf-completeness">{world.completeness}%</span></div></div></button>
}

function WorldEnginePage({ worlds, activeWorld, onSelectWorld, onOpenCreate, onOpenWorldPicker, onImported, onOpenModule, onOpenGameProduction }: { worlds: ProductWorld[]; activeWorld?: ProductWorld; onSelectWorld: (world: ProductWorld) => void; onOpenCreate: () => void; onOpenWorldPicker: () => void; onImported: (projectId: number) => void; onOpenModule: (module: SidebarModule) => void; onOpenGameProduction: (handoff: WorldGameProductionHandoffV2) => void }) {
  if (!activeWorld) return <><PageHeading eyebrow="FOUNDATION / WORLD ENGINE" title="世界引擎" description="独立创建、版本化并复用世界设定。" action={<Button variant="primary" icon={Plus} onClick={onOpenCreate}>从零创建世界</Button>} /><EmptyProjectState onCreate={onOpenCreate} /><WorldSharingPanel onImported={onImported} /></>
  const projection = activeWorld.projection
  return <>
    <PageHeading eyebrow="FOUNDATION / WORLD ENGINE" title="世界引擎" description="世界是所有写作、节点和互动功能的共同基座。每个世界都有独立编号和版本。" action={<><Button icon={Hash} onClick={onOpenWorldPicker}>使用世界编号</Button><Button variant="primary" icon={Plus} onClick={onOpenCreate}>从零创建世界</Button></>} />
    <div className="sf-subnav">{worlds.map(world => <button key={world.code} className={world.code === activeWorld.code ? 'active' : ''} onClick={() => onSelectWorld(world)}><WorldGlyph accent={world.accent} small /><span>{world.name}</span><span>{world.code}</span></button>)}<span className="sf-subnav-spacer" /></div>
    <section className="sf-worlds-featured"><div className="sf-worlds-featured-visual"><WorldGlyph accent={activeWorld.accent} /></div><div className="sf-worlds-featured-copy"><span className="sf-overline">WORLD ENGINE · {activeWorld.source}</span><h2>{activeWorld.name}</h2><p>{activeWorld.description}</p><span className="sf-world-code-large"><Hash className="h-4 w-4" /> {activeWorld.code} · v{activeWorld.version}</span><div className="sf-worlds-featured-actions"><Button variant="primary" icon={ArrowRight} onClick={() => document.getElementById('world-engine-editor')?.scrollIntoView({ behavior: 'smooth' })}>管理世界设定</Button><Button icon={BookOpenText} onClick={() => onOpenModule('outline')}>继续分步骤创作</Button></div></div><div className="sf-worlds-featured-stats"><div><strong>{activeWorld.completeness}%</strong><span>数据域覆盖</span></div><div><strong>v{activeWorld.version}</strong><span>当前草稿版本</span></div><div><strong>{projection?.readiness === 'usable' ? '可创作' : projection?.readiness === 'building' ? '建设中' : '待建立'}</strong><span>世界状态</span></div></div></section>
    <section id="world-engine-editor" className="sf-product-panel"><WorldEngineWorkspace projection={projection} activeWorkId={activeWorld.project.activeWorkId} onWorkChanged={onImported ? async () => { await onImported(activeWorld.projectId) } : undefined} onOpenModule={onOpenModule} onOpenGameProduction={onOpenGameProduction} /></section>
    <WorldSharingPanel project={activeWorld.project} onImported={onImported} />
  </>
}

function NovelPage({ project, onCreate, onDerived }: { project?: Project; onCreate: () => void; onDerived: (projectId: number) => void | Promise<void> }) {
  const [view, setView] = useState<'outline' | 'chapters'>('outline')
  const [nodeId, setNodeId] = useState<number | null>(null)
  const activeWork = useActiveWork(project)
  const loadProjects = useProjectStore(state => state.loadProjects)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  if (!project) return <><PageHeading eyebrow="AUTHORING / WORKS" title="作品创作" description="在独立创作产品中完成短篇、长篇与改编作品。" /><EmptyProjectState onCreate={onCreate} /></>
  const isNovel = !activeWork || effectiveWorkKind(activeWork) === 'novel'
  const profile = activeWork ? effectiveNovelProfile(activeWork) : 'long'
  const changeProfile = async (next: 'short' | 'long') => {
    if (!activeWork?.id || !project.id || profileBusy) return
    setProfileBusy(true)
    setProfileError('')
    try {
      await switchNovelProfile({
        projectId: project.id,
        workId: activeWork.id,
        profile: next,
        targetWordCount: next === 'short'
          ? (activeWork.targetWordCount >= 5_000 && activeWork.targetWordCount <= 25_000 ? activeWork.targetWordCount : SHORT_NOVEL_DEFAULT_WORDS)
          : Math.max(activeWork.targetWordCount, 100_000),
      })
      await loadProjects()
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : 'Profile 切换失败')
    } finally {
      setProfileBusy(false)
    }
  }
  if (!isNovel && activeWork) {
    const scope = scopeForProject(project)
    return <><PageHeading eyebrow="AUTHORING / WORKS" title={effectiveWorkKind(activeWork) === 'screenplay' ? '正规剧本工作台' : '漫画工作台'} description="派生作品拥有独立结构、来源证据和导出链；不会修改源小说。" action={<WorkKindBadge work={activeWork} />} />{scope ? <Suspense fallback={<FeaturePanelFallback />}>{effectiveWorkKind(activeWork) === 'screenplay' ? <ScreenplayStudio scope={scope} /> : <ComicStudio scope={scope} />}</Suspense> : <section className="sf-product-empty"><BookOpenText className="h-8 w-8" /><h2>漫画工作区归属尚未就绪</h2><p>请先完成目标 Work 初始化。</p></section>}</>
  }
  return <><PageHeading eyebrow="AUTHORING / STEP BY STEP" title={profile === 'short' ? '短篇小说创作' : '长篇小说创作'} description={profile === 'short' ? '独立短篇产品复用同一份可靠 Canon 与生成底座。' : '独立运行完整的分步骤长篇创作流程；世界引擎不是前置条件。'} action={<div className="flex flex-wrap items-center justify-end gap-2">{activeWork && <WorkKindBadge work={activeWork} />}<WorldDerivationActions project={project} onDerived={onDerived} /><Button onClick={() => void changeProfile(profile === 'short' ? 'long' : 'short')} disabled={profileBusy}>{profileBusy ? '切换中…' : profile === 'short' ? '扩写为长篇' : '切换为短篇'}</Button><Button variant="primary" icon={ArrowRight} onClick={() => setView('chapters')}>打开正文</Button></div>} />{profileError && <p className="mb-3 text-sm text-red-600" role="alert">{profileError}</p>}<div className="sf-subnav"><button className={view === 'outline' ? 'active' : ''} onClick={() => setView('outline')}><BookOpenText className="h-4 w-4" />卷纲与章纲</button><button className={view === 'chapters' ? 'active' : ''} onClick={() => setView('chapters')}><BookOpenText className="h-4 w-4" />章节与正文</button><span className="sf-subnav-spacer" /><span className="sf-subnav-note">{project.name}</span></div><section className="sf-product-panel sf-novel-panel"><Suspense fallback={<FeaturePanelFallback />}>{view === 'outline' ? <OutlinePanel project={project} onOpenChapter={id => { setNodeId(id); setView('chapters') }} /> : <ChaptersListPanel project={project} initialNodeId={nodeId} />}</Suspense></section></>
}

function NodesPage({ project, onCreate }: { project?: Project; onCreate: () => void }) {
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project) return <><PageHeading eyebrow="FLOW / NODE AUTHORING" title="节点创作" description="自由编排资料、处理和生成节点。" /><EmptyProjectState onCreate={onCreate} /></>
  return <><PageHeading eyebrow="FLOW / NODE AUTHORING" title="节点创作" description="把分步骤长篇的同源能力拆成更自由、更细粒度、可视且可组合的创作图。" /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}><NodeAuthoringWorkspace project={project} worldGroupId={worldGroupId} /></Suspense></section></>
}

function TtrpgPage({ project, world, onOpenWorldPicker, onCreate, initialSessionId = null, initialProductionHandoff = null, initialOnlineHandoff = null, onOnlineHandoffConsumed }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void; initialSessionId?: number | null; initialProductionHandoff?: WorldGameProductionHandoffV2 | null; initialOnlineHandoff?: OnlineRoomJoinHandoffV1 | null; onOnlineHandoffConsumed?: () => void }) {
  const [mode, setMode] = useState<'play' | 'author' | 'production'>('play')
  const [runtimeKey, setRuntimeKey] = useState(0)
  const [previewSessionId, setPreviewSessionId] = useState<number | null>(initialSessionId)
  useEffect(() => {
    if (initialSessionId != null) {
      setPreviewSessionId(initialSessionId)
      setRuntimeKey(value => value + 1)
      setMode('play')
    }
  }, [initialSessionId])
  useEffect(() => {
    if (initialProductionHandoff?.productType === 'ttrpg') setMode('production')
  }, [initialProductionHandoff])
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project || !world) return <><PageHeading eyebrow="PLAY / TTRPG" title="跑团" description="选择世界版本，开始可回放的单机战役。" /><EmptyProjectState onCreate={onCreate} /></>
  const scope = scopeForProject(project)
  if (!scope) return <><PageHeading eyebrow="PLAY / TTRPG" title="跑团" description="从正式发布建立可回放战役。" /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属尚未就绪</h2><p>请先在世界引擎完成 World/Work 初始化。</p></section></>
  return <><PageHeading eyebrow={mode === 'play' ? 'PLAY / TTRPG' : mode === 'production' ? 'PRODUCE / TTRPG' : 'AUTHOR / TTRPG-2A'} title="跑团" description={mode === 'play' ? '从冻结战役发布进入确定性规则、场景、战斗与长期记录。' : mode === 'production' ? '冻结跑团专属来源，完成 Brief、规则、车卡、战役、媒资计划、验证与真实开桌试玩。' : '维护跑团规则、角色卡和战役草稿；既有正式版本仍可开团。'} action={<div className="storygame-mode-actions"><Button variant={mode === 'play' ? 'primary' : 'secondary'} icon={Gamepad2} onClick={() => setMode('play')}>主持与游玩</Button><Button variant={mode === 'production' ? 'primary' : 'secondary'} icon={Sparkles} onClick={() => setMode('production')}>跑团制作</Button><Button variant={mode === 'author' ? 'primary' : 'secondary'} icon={BookOpenText} onClick={() => setMode('author')}>规则与角色</Button><Button icon={Hash} onClick={onOpenWorldPicker}>选择世界</Button></div>} /><BindingBanner world={world} onChange={onOpenWorldPicker} />{mode === 'production' && <p className="mx-5 rounded border border-warning/30 bg-warning/5 px-4 py-3 text-xs leading-5 text-warning" data-testid="ttrpg-formal-publication-lock">当前可用冻结开发来源完成生产与真实开桌验收；最终世界适配完成前不开放正式发布。</p>}<section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}>{mode === 'production' ? <TtrpgProductionWorkspace scope={scope} worldGroupId={worldGroupId} initialWorldHandoff={initialProductionHandoff} onSessionCreated={sessionId => { setPreviewSessionId(sessionId); setRuntimeKey(value => value + 1); setMode('play') }} /> : mode === 'author' ? <TtrpgProductStudio scope={scope} worldGroupId={worldGroupId} formalPublicationLocked onSessionCreated={() => { setPreviewSessionId(null); setRuntimeKey(value => value + 1); setMode('play') }} /> : <SimulationRuntimePanel key={runtimeKey} project={project} worldGroupId={worldGroupId} workspaceScope={scope} sessionKind={'ttrpg' satisfies SimulationSessionKind} initialSessionId={previewSessionId ?? initialSessionId} initialOnlineHandoff={initialOnlineHandoff} onOnlineHandoffConsumed={onOnlineHandoffConsumed} />}</Suspense></section></>
}

function MarketplacePage({ project, world, onOpenWorldPicker, onImported, onRoomHandoff }: {
  project?: Project
  world?: ProductWorld
  onOpenWorldPicker: () => void
  onImported: () => void | Promise<void>
  onRoomHandoff?: (handoff: OnlineRoomJoinHandoffV1) => void | Promise<void>
}) {
  const scope = project ? scopeForProject(project) : undefined
  return <><PageHeading eyebrow="COMMUNITY / MARKETPLACE" title="社区市场" description="领取、购买、导入或提交完整可验证的跑团战役与文字游戏发行物。" action={world ? <Button icon={Hash} onClick={onOpenWorldPicker}>选择导入 Work</Button> : undefined} />{world && <BindingBanner world={world} onChange={onOpenWorldPicker} />}<section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}><MarketplacePanel scope={scope} onImported={onImported} onRoomHandoff={onRoomHandoff} /></Suspense></section></>
}

function ChatGamePage({ project, world, onOpenWorldPicker, onCreate, initialSessionId = null }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void; initialSessionId?: number | null }) {
  const [mode, setMode] = useState<'play' | 'author'>('play')
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project || !world) return <><PageHeading eyebrow="PLAY / CHATGAME" title="角色聊天" description="选择世界和角色，开始独立的可分支互动会话。" /><EmptyProjectState onCreate={onCreate} /></>
  const scope = scopeForProject(project)
  if (!scope) return <><PageHeading eyebrow="PLAY / CHATGAME" title="角色互动" description="从正式发布开始可回放的长期关系叙事。" /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属尚未就绪</h2><p>请先在世界引擎完成 World/Work 初始化。</p></section></>
  return <><PageHeading eyebrow={mode === 'play' ? 'PLAY / CHATGAME-2' : 'PRODUCE / CHATGAME-CI'} title="角色互动" description={mode === 'play' ? '从不可变 Product Release 启动单人或多角色会话，持续演化消息、知识、记忆、关系与场景。' : '从冻结 WorldRelease 选择角色和世界子集，经产品 Brief、AI 候选、人工确认、媒资校验后发布独立成品。'} action={<div className="storygame-mode-actions"><Button variant={mode === 'play' ? 'primary' : 'secondary'} icon={Gamepad2} onClick={() => setMode('play')}>玩家模式</Button><Button variant={mode === 'author' ? 'primary' : 'secondary'} icon={BookOpenText} onClick={() => setMode('author')}>正式制作</Button><Button icon={Hash} onClick={onOpenWorldPicker}>选择世界</Button></div>} /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}>{mode === 'play' ? <ChatGamePanel project={project} worldGroupId={worldGroupId} workspaceScope={scope} initialSessionId={initialSessionId} /> : <CharacterInteractionProductionStudio scope={scope} />}</Suspense></section></>
}

function TextGamePage({ project, world, onOpenWorldPicker, onCreate, onOpenChat, onOpenTtrpg, initialProduct = 'storygame', initialMode = 'play', initialProductionHandoff = null }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void; onOpenChat: (sessionId?: number | null) => void; onOpenTtrpg: (sessionId?: number | null) => void; initialProduct?: 'storygame' | 'text-adventure' | 'avg'; initialMode?: 'play' | 'production'; initialProductionHandoff?: WorldGameProductionHandoffV2 | null }) {
  const updateProject = useProjectStore(state => state.updateProject)
  const [mode, setMode] = useState<'play' | 'author' | 'production'>(initialMode)
  const [product, setProduct] = useState<'storygame' | 'text-adventure' | 'avg' | 'narrative-simulation' | 'text-open-world'>(initialProduct)
  const [previewSessionId, setPreviewSessionId] = useState<number | null>(null)
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project || !world) return <><PageHeading eyebrow="PLAY / STORYGAME" title="文字游戏" description="选择世界与叙事蓝图，开始独立的可回放故事。" /><EmptyProjectState onCreate={onCreate} /></>
  const scope = scopeForProject(project)
  if (!scope) return <><PageHeading eyebrow="PLAY / STORYGAME" title="文字游戏" description="从正式发布开始独立、可回放的分支叙事。" /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属尚未就绪</h2><p>请先进入世界引擎完成 World/Work 初始化，再读取正式游戏发布。</p></section></>
  const isAdventure = product === 'text-adventure'
  const isAvg = product === 'avg'
  const isSimulation = product === 'narrative-simulation'
  const isOpenWorld = product === 'text-open-world'
  const productionDecision = evaluateGamePlatformCapabilityV1('game-production-v3', {
    environment: currentGamePlatformEnvironmentV1(), experimentalProject: false,
    authorOptIn: project.gamePlatformOptIns?.gameProductionV3 === true,
    onlineServiceConfigured: false, aiGmBetaGatePassed: currentAiGmBetaGatePassedV1(),
  })
  const productCode = isAdventure ? 'TEXTADV-1' : isAvg ? 'AVG-1' : isSimulation ? 'TEXTSIM-1' : isOpenWorld ? 'TEXTWORLD-1' : 'STORYGAME'
  const productTitle = isAdventure ? '文字冒险' : isAvg ? 'AVG / Galgame' : isSimulation ? '叙事模拟' : isOpenWorld ? '文字开放世界' : '分支叙事'
  const description = isAdventure
    ? (mode === 'play' ? '在有限地点中通过物品、资源、能力与任务行动推进，并从正式状态解锁 Narrative 结局。' : '编辑地点、交互物、物品、能力、任务和判定，校验后冻结为可离线游玩的发布。')
    : isAvg
      ? (mode === 'play' ? '用背景、立绘、CG、音频和可恢复舞台演出同一份分支故事，也可纯文字通关。' : '导入版本化媒资，为 Narrative Beat 配置声明式 Cue 并发布不可变演出。')
      : isSimulation
        ? (mode === 'play' ? '在封闭系统中安排有限决策，让资源、主体、问题与延迟后果按确定性规则演化。' : '编辑资源、主体、政策、危机和结局规则，批量验证后冻结为可离线运行的发布。')
        : isOpenWorld
          ? (mode === 'play' ? '在多个区域之间旅行，让人物、组织、问题和动态任务在同一可回放世界时间线上持续演进。' : '组合区域目录、交通、发现渠道、固定任务、模板、日程和传播规则，并冻结全部共享能力。')
        : (mode === 'play' ? '选择正式发布，新建或继续存档；所有选择自动保存，并可从检查点建立独立时间线。' : '编辑游戏、节点、Beat 与 Choice，试玩草稿并发布不可变版本。')
  const content = mode === 'production'
    ? productionDecision.enabled ? <GameProductionStudio
      scope={scope}
      worldGroupId={worldGroupId}
      initialProduct={product}
      initialSource={initialProductionHandoff}
      onPublished={next => {
        setPreviewSessionId(null)
        if (next === 'character-interaction') onOpenChat(null)
        else if (next === 'ttrpg') onOpenTtrpg(null)
        else { setProduct(next); setMode('play') }
      }}
      onPreviewStarted={(next, sessionId) => {
        if (next === 'character-interaction') onOpenChat(sessionId)
        else if (next === 'ttrpg') onOpenTtrpg(sessionId)
        else { setPreviewSessionId(sessionId); setProduct(next); setMode('play') }
      }}
    /> : <CapabilityConsentGate decision={productionDecision} onEnable={() => updateProject(project.id!, {
      gamePlatformOptIns: { ...project.gamePlatformOptIns, gameProductionV3: true },
    })} />
    : isAdventure
    ? (mode === 'play' ? <AdventureGamePlayer project={project} scope={scope} worldGroupId={worldGroupId} initialSessionId={previewSessionId} /> : <AdventureGameWorkbench scope={scope} onOpenProduction={() => setMode('production')} />)
    : isAvg
      ? (mode === 'play' ? <AvgGamePlayer project={project} scope={scope} worldGroupId={worldGroupId} initialSessionId={previewSessionId} /> : <AvgGameWorkbench scope={scope} onOpenProduction={() => setMode('production')} />)
      : isSimulation
        ? (mode === 'play' ? <NarrativeSimulationPlayer project={project} scope={scope} worldGroupId={worldGroupId} initialSessionId={previewSessionId} /> : <NarrativeSimulationWorkbench scope={scope} onOpenProduction={() => setMode('production')} />)
        : isOpenWorld
          ? (mode === 'play' ? <TextOpenWorldPlayer project={project} scope={scope} worldGroupId={worldGroupId} initialSessionId={previewSessionId} /> : <TextOpenWorldWorkbench scope={scope} onOpenProduction={() => setMode('production')} />)
        : (mode === 'play' ? <StoryGamePlayer project={project} scope={scope} worldGroupId={worldGroupId} initialSessionId={previewSessionId} /> : <StoryGameWorkbench scope={scope} onOpenProduction={() => setMode('production')} />)
  return <><PageHeading eyebrow={`${mode === 'play' ? 'PLAY' : mode === 'production' ? 'PRODUCE' : 'AUTHOR'} / ${productCode}`} title={mode === 'production' ? '游戏制作中心' : productTitle} description={mode === 'production' ? '从冻结 WorldRelease 会谈、审查 Brief、显式授权、构建可玩预览，并经证据复验原子发布。' : mode === 'author' ? '维护既有手工草稿；检查完成后统一进入制作中心生成 Build、预览并发布。' : description} action={<div className="storygame-mode-actions"><Button variant={product === 'storygame' ? 'primary' : 'secondary'} icon={GitBranch} onClick={() => setProduct('storygame')}>分支叙事</Button><Button variant={isAdventure ? 'primary' : 'secondary'} icon={Map} onClick={() => setProduct('text-adventure')}>文字冒险</Button><Button variant={isAvg ? 'primary' : 'secondary'} icon={MonitorPlay} onClick={() => setProduct('avg')}>AVG</Button><Button variant={isSimulation ? 'primary' : 'secondary'} icon={Activity} onClick={() => setProduct('narrative-simulation')}>叙事模拟</Button><Button variant={isOpenWorld ? 'primary' : 'secondary'} icon={Globe2} onClick={() => setProduct('text-open-world')}>开放世界</Button><Button variant={mode === 'play' ? 'primary' : 'secondary'} icon={Gamepad2} onClick={() => setMode('play')}>玩家</Button><Button variant={mode === 'production' ? 'primary' : 'secondary'} icon={Sparkles} onClick={() => setMode('production')}>制作</Button><Button variant={mode === 'author' ? 'primary' : 'secondary'} icon={BookOpenText} onClick={() => setMode('author')}>手工维护</Button><Button icon={Hash} onClick={onOpenWorldPicker}>选择世界</Button></div>} /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}>{content}</Suspense></section></>
}

function CreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: (kind: 'worlds' | 'novel', id: number) => void }) {
  const { createProject } = useProjectStore()
  const [kind, setKind] = useState<'choose' | 'worlds' | 'long-novel' | 'short-novel'>('choose')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetWordCount, setTargetWordCount] = useState(10_000)
  const [preferredChapterCount, setPreferredChapterCount] = useState<number | ''>('')
  const [projectFolder, setProjectFolder] = useState<FileSystemDirectoryHandle | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const isShort = kind === 'short-novel'
      const isNovel = isShort || kind === 'long-novel'
      const id = await createProject({
        name: name.trim(), genre: 'other', genres: ['other'], status: 'drafting',
        description: description.trim(), targetWordCount: isShort ? targetWordCount : 500_000, enableMultiWorld: false,
      }, isNovel ? {
        purpose: 'independent-work',
        kind: 'novel',
        novelProfile: isShort ? 'short' : 'long',
        preferredChapterCount: isShort && preferredChapterCount !== '' ? preferredChapterCount : undefined,
      } : { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
      if (projectFolder) {
        try {
          await bindCreatedProjectStorageWorkspace(id, projectFolder)
        } catch (error) {
          console.error('[project-storage] 新项目存储位置保存失败', error)
        }
      }
      onCreated(kind === 'worlds' ? 'worlds' : 'novel', id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败')
    } finally { setBusy(false) }
  }
  const label = kind === 'worlds' ? '创建世界引擎' : kind === 'short-novel' ? '创建短篇小说' : '创建长篇小说'
  return <div className="sf-modal-backdrop" onMouseDown={onClose}>
    <aside className="sf-create-panel" onMouseDown={event => event.stopPropagation()}>
      <div className="sf-modal-header">
        <div>
          <div className="sf-eyebrow">CREATE SOMETHING</div>
          <h2>{kind === 'choose' ? '你想从哪里开始？' : label}</h2>
          <p>{kind === 'choose' ? '世界、短篇和长篇共享同一个可靠创作基座。' : '选择的项目文件夹会成为内容与记忆的本地工作区。'}</p>
        </div>
        <button className="sf-icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X className="h-4 w-4" /></button>
      </div>
      {kind === 'choose' ? <div className="sf-create-options">
        <button onClick={() => setKind('worlds')}><span className="sf-create-option-icon"><Globe2 className="h-5 w-5" /></span><span><strong>世界引擎</strong><small>从零创建可被其他功能引用的世界</small></span><ArrowRight className="h-4 w-4" /></button>
        <button onClick={() => setKind('short-novel')}><span className="sf-create-option-icon"><BookOpenText className="h-5 w-5" /></span><span><strong>短篇小说</strong><small>5,000～25,000 字，动态单卷结构</small></span><ArrowRight className="h-4 w-4" /></button>
        <button onClick={() => setKind('long-novel')}><span className="sf-create-option-icon"><BookOpenText className="h-5 w-5" /></span><span><strong>长篇小说</strong><small>保留熟悉的完整分步骤工作流</small></span><ArrowRight className="h-4 w-4" /></button>
      </div> : <div className="sf-create-form">
        <label>名称<input value={name} onChange={event => setName(event.target.value)} placeholder={kind === 'worlds' ? '例如：潮汐之后' : '例如：《幽都遗闻》'} autoFocus /></label>
        <label>简介<textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} placeholder="一句话描述这个世界或作品" /></label>
        {kind === 'short-novel' && <>
          <label>目标字数（5,000～25,000）<input type="number" min={5000} max={25000} step={500} value={targetWordCount} onChange={event => setTargetWordCount(Number(event.target.value))} /></label>
          <label>建议章节数（可空）<input type="number" min={1} step={1} value={preferredChapterCount} placeholder="自动推导" onChange={event => setPreferredChapterCount(event.target.value === '' ? '' : Number(event.target.value))} /></label>
        </>}
        <ProjectStorageFolderField value={projectFolder} onChange={setProjectFolder} disabled={busy} />
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <div className="sf-create-form-actions"><Button onClick={() => setKind('choose')}>返回</Button><Button variant="primary" icon={Check} onClick={() => void create()} disabled={busy || !name.trim()}>{busy ? '创建中…' : label}</Button></div>
      </div>}
    </aside>
  </div>
}

function WorldPicker({ worlds, onClose, onChoose }: { worlds: ProductWorld[]; onClose: () => void; onChoose: (world: ProductWorld) => void }) {
  const [query, setQuery] = useState('')
  const results = worlds.filter(world => `${world.name} ${world.code}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="sf-modal-backdrop" onMouseDown={onClose}><aside className="sf-picker-panel" onMouseDown={event => event.stopPropagation()}><div className="sf-modal-header"><div><div className="sf-eyebrow">WORLD SOURCE</div><h2>选择一个世界</h2><p>功能会读取你选择的世界版本。</p></div><button className="sf-icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X className="h-4 w-4" /></button></div><div className="sf-picker-input"><Search className="h-4 w-4" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="输入世界名称或编号" autoFocus /></div><div className="sf-picker-list">{results.map(world => <button key={world.code} onClick={() => { onChoose(world); onClose() }}><WorldGlyph accent={world.accent} small /><span><strong>{world.name}</strong><small><Hash className="h-3 w-3" />{world.code} · v{world.version}</small></span><ChevronRight className="h-4 w-4" /></button>)}{results.length === 0 && <div className="sf-picker-empty"><Search className="h-5 w-5" /><span>没有找到这个世界</span><small>检查编号是否完整。</small></div>}</div><div className="sf-picker-footer"><button disabled><ShieldCheck className="h-4 w-4" />社区世界接入准备中</button></div></aside></div>
}

function MobileNavPanel({ activeTab, onClose, onSelect }: { activeTab: TabId; onClose: () => void; onSelect: (tab: TabId) => void }) {
  return <div className="sf-modal-backdrop sf-mobile-nav-backdrop" onMouseDown={onClose}><aside className="sf-mobile-nav-panel" onMouseDown={event => event.stopPropagation()}><div className="sf-modal-header"><div><div className="sf-eyebrow">STORYFORGE</div><h2>产品页签</h2></div><button className="sf-icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X className="h-4 w-4" /></button></div><nav>{NAV_TABS.map(tab => { const Icon = tab.icon; return <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => { onSelect(tab.id); onClose() }}><span><Icon className="h-4 w-4" /></span><strong>{tab.label}</strong>{activeTab === tab.id ? <Check className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> })}</nav></aside></div>
}

export default function ProductHubPage() {
  const navigate = useNavigate()
  const { projects, loadProjects } = useProjectStore()
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showWorldPicker, setShowWorldPicker] = useState(false)
  const [showMobileNav, setShowMobileNav] = useState(false)
  const [gameProduct, setGameProduct] = useState<'storygame' | 'text-adventure' | 'avg'>('storygame')
  const [gameInitialMode, setGameInitialMode] = useState<'play' | 'production'>('play')
  const [textGameProductionHandoff, setTextGameProductionHandoff] = useState<WorldGameProductionHandoffV2 | null>(null)
  const [chatPreviewSessionId, setChatPreviewSessionId] = useState<number | null>(null)
  const [ttrpgInitialSessionId, setTtrpgInitialSessionId] = useState<number | null>(null)
  const [ttrpgProductionHandoff, setTtrpgProductionHandoff] = useState<WorldGameProductionHandoffV2 | null>(null)
  const [onlineRoomHandoff, setOnlineRoomHandoff] = useState<OnlineRoomJoinHandoffV1 | null>(null)
  const [projections, setProjections] = useState<Record<number, WorldProjection>>({})
  const activeWorldGroupId = useWorldGroupStore(state => state.activeGroupId)

  useEffect(() => { void loadProjects() }, [loadProjects])
  useEffect(() => {
    if (activeProjectId != null && projects.some(project => project.id === activeProjectId)) return
    setActiveProjectId(projects[0]?.id ?? null)
  }, [activeProjectId, projects])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const loaded = await loadWorldProjections(projects.filter(project => project.id != null))
        if (!cancelled) setProjections(Object.fromEntries(loaded.map(projection => [projection.projectId, projection])))
      } catch (error) {
        console.error('[WORLD-2] 读取世界投影失败', error)
        if (!cancelled) setProjections({})
      }
    }
    void load()
    return () => { cancelled = true }
  }, [projects])

  const worlds = useMemo(() => Object.values(projections).map((projection, index) => {
    const project = projects.find(candidate => candidate.id === projection.projectId)
    return project ? projectToWorld(project, index, projection) : null
  }).filter((world): world is ProductWorld => world != null), [projects, projections])
  const activeProject = projects.find(project => project.id === activeProjectId) ?? projects[0]
  const activeWorld = worlds.find(world => world.projectId === activeProjectId) ?? worlds[0]
  const selectWorld = (world: ProductWorld) => setActiveProjectId(world.projectId)
  const selectTab = (tab: TabId) => {
    if (tab === 'game') setGameInitialMode('play')
    setActiveTab(tab)
  }
  const openAcceptedOnlineRoom = async (handoff: OnlineRoomJoinHandoffV1) => {
    const scope = activeProject ? scopeForProject(activeProject) : undefined
    if (!scope) throw new Error('请先选择已完成 World/Work 初始化的本地工作区。')
    const releases = await db.gameReleases.where('workId').equals(scope.workId).toArray()
    const release = releases.find(row => row.contentHash === handoff.releaseHash
      && row.projectId === scope.projectId && row.worldId === scope.worldId)
    if (!release?.id) throw new Error('本地尚无该跑团发行版本，请先在玩家市场领取或下载，再进入在线房间。')
    let productType = ''
    try { productType = String((JSON.parse(release.manifestJson) as { productType?: unknown }).productType ?? '') }
    catch { throw new Error('本地发行版本清单损坏，请重新下载。') }
    if (productType !== 'ttrpg') throw new Error('该招募绑定的不是跑团 GameRelease。')
    const sessions = await db.simulationSessions.where('projectId').equals(scope.projectId).toArray()
    const expectedWorldGroupId = activeProject?.enableMultiWorld ? activeWorldGroupId : null
    let session = sessions.find(row => row.kind === 'ttrpg' && row.gameReleaseId === release.id
      && row.worldId === scope.worldId && row.workId === scope.workId
      && (row.worldGroupId ?? null) === expectedWorldGroupId)
    if (!session) {
      session = await createWorldInstance({
        scope, kind: 'ttrpg', title: `${release.label} · 在线战役`,
        gameSource: { kind: 'release', gameReleaseId: release.id },
        worldGroupId: expectedWorldGroupId,
      })
    }
    setTtrpgInitialSessionId(session.id!)
    setOnlineRoomHandoff(handoff)
    setActiveTab('ttrpg')
  }

  const renderPage = () => {
    switch (activeTab) {
      case 'worlds': return <WorldEnginePage worlds={worlds} activeWorld={activeWorld} onSelectWorld={selectWorld} onOpenCreate={() => setShowCreate(true)} onOpenWorldPicker={() => setShowWorldPicker(true)} onImported={async projectId => { await loadProjects(); setActiveProjectId(projectId); setActiveTab('worlds') }} onOpenModule={module => { if (activeProject?.id) navigate(`/workspace/${activeProject.id}?module=${module}`) }} onOpenGameProduction={handoff => {
        const parsed = parseWorldGameProductionHandoffV2(handoff)
        if (parsed.productType === 'ttrpg') {
          setTtrpgProductionHandoff(parsed)
          setActiveTab('ttrpg')
          return
        }
        if (!['storygame', 'text-adventure', 'avg'].includes(parsed.productType)) {
          throw new Error(`该通用入口暂不支持产品类型：${parsed.productType}`)
        }
        setGameProduct(parsed.productType as 'storygame' | 'text-adventure' | 'avg')
        setGameInitialMode('production')
        setTextGameProductionHandoff(parsed)
        setActiveTab('game')
      }} />
      case 'novel': return <NovelPage project={activeProject} onCreate={() => setShowCreate(true)} onDerived={async projectId => { await loadProjects(); setActiveProjectId(projectId); setActiveTab('worlds') }} />
      case 'nodes': return <NodesPage project={activeProject} onCreate={() => setShowCreate(true)} />
      case 'ttrpg': return <TtrpgPage project={activeProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} initialSessionId={ttrpgInitialSessionId} initialProductionHandoff={ttrpgProductionHandoff} initialOnlineHandoff={onlineRoomHandoff} onOnlineHandoffConsumed={() => setOnlineRoomHandoff(null)} />
      case 'chat': return <ChatGamePage project={activeProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} initialSessionId={chatPreviewSessionId} />
      case 'game': return <TextGamePage project={activeProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} onOpenChat={sessionId => { setChatPreviewSessionId(sessionId ?? null); setActiveTab('chat') }} onOpenTtrpg={sessionId => { setTtrpgInitialSessionId(sessionId ?? null); setActiveTab('ttrpg') }} initialProduct={gameProduct} initialMode={gameInitialMode} initialProductionHandoff={textGameProductionHandoff} />
      case 'market': return <MarketplacePage project={activeProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onImported={loadProjects} onRoomHandoff={openAcceptedOnlineRoom} />
      default: return <HomePage worlds={worlds} activeWorld={activeWorld} activeWorkProject={activeProject} onSelect={selectTab} onSelectWorld={selectWorld} onOpenCreate={() => setShowCreate(true)} onOpenWorldPicker={() => setShowWorldPicker(true)} />
    }
  }

  return <div className="sf-product-shell"><ProductHeader activeTab={activeTab} onSelect={selectTab} onOpenCreate={() => setShowCreate(true)} onOpenMobileNav={() => setShowMobileNav(true)} onOpenWorldPicker={() => setShowWorldPicker(true)} /><main className="sf-product-main">{renderPage()}</main><footer className="sf-product-footer"><span>StoryForge 产品综合页 · 本地数据</span><span><ShieldCheck className="h-3.5 w-3.5" />世界版本与功能实例分开管理</span></footer>{showCreate && <CreatePanel onClose={() => setShowCreate(false)} onCreated={(kind, id) => { setActiveProjectId(id); setActiveTab(kind); setShowCreate(false); if (kind === 'novel') navigate(`/workspace/${id}?module=outline`) }} />}{showWorldPicker && <WorldPicker worlds={worlds} onClose={() => setShowWorldPicker(false)} onChoose={selectWorld} />}{showMobileNav && <MobileNavPanel activeTab={activeTab} onClose={() => setShowMobileNav(false)} onSelect={selectTab} />}</div>
}
