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
  Swords,
  Workflow,
  X,
} from 'lucide-react'
import type { Project, SimulationSessionKind, WorkspaceScope } from '../lib/types'
import { useProjectStore } from '../stores/project'
import { useWorldGroupStore } from '../stores/world-group'
import type { WorldProjection } from '../lib/world-engine/domain'
import { loadWorldProjections } from '../lib/world-engine/domain'
import WorldEngineWorkspace from '../components/world-engine/WorldEngineWorkspace'
import type { SidebarModule } from '../components/layout/sidebar-tree'
import WorldSharingPanel from '../components/product/WorldSharingPanel'
import ProjectStorageFolderField from '../components/shared/ProjectStorageFolderField'
import { bindCreatedProjectStorageWorkspace } from '../lib/storage/project-storage-workspace'
import './product-hub.css'

const NodeAuthoringWorkspace = lazy(() => import('../components/node-authoring/NodeAuthoringWorkspace'))
const SimulationRuntimePanel = lazy(() => import('../components/simulation/SimulationRuntimePanel'))
const ChatGamePanel = lazy(() => import('../components/simulation/ChatGamePanel'))
const InteractionGameWorkbench = lazy(() => import('../components/character-interaction/InteractionGameWorkbench'))
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
const OutlinePanel = lazy(() => import('../components/outline/OutlinePanel'))
const ChaptersListPanel = lazy(() => import('../components/editor/ChaptersListPanel'))

type TabId = 'home' | 'worlds' | 'novel' | 'nodes' | 'ttrpg' | 'chat' | 'game'
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
  { id: 'novel', label: '分步骤写作', icon: BookOpenText },
  { id: 'nodes', label: '节点创作', icon: Workflow },
  { id: 'ttrpg', label: '跑团', icon: Swords },
  { id: 'chat', label: '角色聊天', icon: MessageCircle },
  { id: 'game', label: '文字游戏', icon: Gamepad2 },
]

const FEATURE_META: Record<Exclude<TabId, 'home'>, { eyebrow: string; description: string; icon: typeof Globe2; accent: Accent }> = {
  worlds: { eyebrow: 'FOUNDATION', description: '把设定、角色和规则整理成可持续复用的世界版本。', icon: Globe2, accent: 'ochre' },
  novel: { eyebrow: 'AUTHORING', description: '保留熟悉的卷纲、章纲和正文工作流，继续完成你的长篇。', icon: BookOpenText, accent: 'rust' as Accent },
  nodes: { eyebrow: 'FLOW', description: '自由组合世界资料、处理中间产物和生成节点。', icon: Workflow, accent: 'blue' },
  ttrpg: { eyebrow: 'PLAY', description: '选择一个世界版本，开始战役、行动和事件回放。', icon: Swords, accent: 'teal' },
  chat: { eyebrow: 'CHARACTERS', description: '冻结一个世界与角色快照，开始可分支的独立角色聊天。', icon: MessageCircle, accent: 'violet' },
  game: { eyebrow: 'STORY GAME', description: '从冻结的主线或支线开始独立游玩，并保留事件、检查点与分支。', icon: Gamepad2, accent: 'blue' },
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

function projectToWorld(project: Project, index: number, projection?: WorldProjection): ProductWorld {
  const tags = (project.genres?.length ? project.genres : [project.genre]).filter(Boolean).slice(0, 2)
  return {
    projectId: project.id!,
    code: project.worldCode ?? '待分配编号',
    name: project.name,
    description: project.description || '这个世界还没有写下简介。',
    version: project.worldVersion ?? 1,
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
  return <section className="sf-product-empty"><Globe2 className="h-8 w-8" /><h2>先建立一个世界或作品</h2><p>世界引擎可以独立创建；分步骤作品中的完整设定也会直接进入同一个世界工作台。</p><Button variant="primary" icon={Plus} onClick={onCreate}>新建内容</Button></section>
}

function FeaturePanelFallback() {
  return <div className="flex min-h-[20rem] items-center justify-center text-sm text-text-muted">面板加载中…</div>
}

function HomePage({ worlds, activeProject, onSelect, onSelectWorld, onOpenCreate, onOpenWorldPicker }: { worlds: ProductWorld[]; activeProject?: ProductWorld; onSelect: (id: TabId) => void; onSelectWorld: (world: ProductWorld) => void; onOpenCreate: () => void; onOpenWorldPicker: () => void }) {
  return <>
    <div className="sf-home-intro"><div><div className="sf-eyebrow">STORYFORGE · LOCAL WORKSPACE</div><h1>你的创作与游玩空间</h1><p>从一个世界出发，继续写作、编排、游玩，或者开始一段新的故事。</p></div><div className="sf-intro-actions"><Button icon={Hash} onClick={onOpenWorldPicker}>使用世界编号</Button><Button variant="primary" icon={Plus} onClick={onOpenCreate}>新建内容</Button></div></div>
    {activeProject ? <section className="sf-resume-grid"><article className="sf-resume-card sf-resume-primary"><div className="sf-resume-visual"><span className="sf-visual-label"><StatusDot /> 当前世界</span><span className="sf-visual-rule" /><span className="sf-visual-coordinate">{activeProject.code} · v{activeProject.version}</span></div><div className="sf-resume-content"><span className="sf-card-kicker"><Globe2 className="h-4 w-4" /> 世界引擎</span><h2>{activeProject.name}</h2><p>{activeProject.description}</p><div className="sf-progress"><span style={{ width: `${activeProject.completeness}%` }} /></div><div className="sf-resume-meta"><span>数据域覆盖 {activeProject.completeness}%</span><span>{activeProject.source}</span></div><Button icon={ArrowRight} onClick={() => onSelect('worlds')}>进入世界引擎</Button></div></article><article className="sf-resume-card sf-resume-secondary"><div className="sf-resume-secondary-head"><span className="sf-card-kicker"><BookOpenText className="h-4 w-4" /> 最近作品</span><StatusDot tone="neutral" /></div><div className="sf-campaign-avatar"><BookOpenText className="h-5 w-5" /></div><h2>{activeProject.name}</h2><p>分步骤写作 · {activeProject.project.currentWordCount ? `${(activeProject.project.currentWordCount / 10000).toFixed(1)} 万字` : '尚未开始正文'}</p><div className="sf-event-list"><div><StatusDot /><span>世界设定可被其他功能引用</span></div><div><StatusDot tone="warning" /><span>继续完善卷纲和正文</span></div></div><Button variant="quiet" icon={ArrowRight} onClick={() => onSelect('novel')}>继续写作</Button></article></section> : <EmptyProjectState onCreate={onOpenCreate} />}
    <section className="sf-section"><div className="sf-section-header"><div><div className="sf-eyebrow">YOUR WORKSPACE</div><h2>从这里开始</h2></div><button className="sf-text-button" onClick={onOpenCreate}>新建 <ArrowRight className="h-4 w-4" /></button></div><div className="sf-feature-grid">{(Object.keys(FEATURE_META) as Array<Exclude<TabId, 'home'>>).map(id => { const meta = FEATURE_META[id]; const Icon = meta.icon; return <button key={id} className="sf-feature-card" onClick={() => onSelect(id)}><span className={`sf-feature-icon sf-feature-${meta.accent}`}><Icon className="h-5 w-5" /></span><span className="sf-feature-copy"><span className="sf-eyebrow">{meta.eyebrow}</span><h3>{NAV_TABS.find(tab => tab.id === id)?.label}</h3><p>{meta.description}</p></span><span className="sf-feature-footer"><span>{id === 'worlds' ? `${worlds.length} 个世界` : id === 'novel' ? '保留现有工作流' : id === 'nodes' ? '独立 DAG 工作区' : id === 'ttrpg' ? '单机战役已可用' : id === 'chat' ? '单角色聊天已可用' : '共享运行时已可用'}</span><ArrowRight className="h-4 w-4" /></span></button> })}</div></section>
    <section className="sf-section"><div className="sf-section-header"><div><div className="sf-eyebrow">WORLD LIBRARY</div><h2>我的世界引擎</h2></div><button className="sf-text-button" onClick={() => onSelect('worlds')}>管理世界 <ArrowRight className="h-4 w-4" /></button></div><div className="sf-world-grid">{worlds.slice(0, 3).map(world => <WorldCard key={world.code} world={world} onOpen={() => { onSelectWorld(world); onSelect('worlds') }} />)}<button className="sf-new-world-card" onClick={onOpenCreate}><span className="sf-new-world-plus"><Plus className="h-5 w-5" /></span><strong>从零创建世界</strong><span>建立一个可被作品与游戏引用的新世界</span></button></div></section>
  </>
}

function WorldCard({ world, onOpen }: { world: ProductWorld; onOpen: () => void }) {
  return <button className="sf-world-card" onClick={onOpen}><WorldGlyph accent={world.accent} /><div className="sf-world-card-body"><div className="sf-card-topline"><span className="sf-overline"><Hash className="h-3 w-3" /> {world.code}</span><span className="sf-version">v{world.version}</span></div><h3>{world.name}</h3><p>{world.description}</p><div className="sf-tag-row">{world.tags.map(tag => <span className="sf-tag" key={tag}>{tag}</span>)}</div><div className="sf-world-card-footer"><span className="sf-source"><StatusDot tone={world.project.communityOrigin ? 'neutral' : 'success'} />{world.source}</span><span className="sf-completeness">{world.completeness}%</span></div></div></button>
}

function WorldEnginePage({ worlds, activeWorld, onSelectWorld, onOpenCreate, onOpenWorldPicker, onImported, onOpenModule, onOpenGame }: { worlds: ProductWorld[]; activeWorld?: ProductWorld; onSelectWorld: (world: ProductWorld) => void; onOpenCreate: () => void; onOpenWorldPicker: () => void; onImported: (projectId: number) => void; onOpenModule: (module: SidebarModule) => void; onOpenGame: (product: 'storygame' | 'text-adventure' | 'avg') => void }) {
  if (!activeWorld) return <><PageHeading eyebrow="FOUNDATION / WORLD ENGINE" title="世界引擎" description="独立创建、版本化并复用世界设定。" action={<Button variant="primary" icon={Plus} onClick={onOpenCreate}>从零创建世界</Button>} /><EmptyProjectState onCreate={onOpenCreate} /><WorldSharingPanel onImported={onImported} /></>
  const projection = activeWorld.projection
  return <>
    <PageHeading eyebrow="FOUNDATION / WORLD ENGINE" title="世界引擎" description="世界是所有写作、节点和互动功能的共同基座。每个世界都有独立编号和版本。" action={<><Button icon={Hash} onClick={onOpenWorldPicker}>使用世界编号</Button><Button variant="primary" icon={Plus} onClick={onOpenCreate}>从零创建世界</Button></>} />
    <div className="sf-subnav">{worlds.map(world => <button key={world.code} className={world.code === activeWorld.code ? 'active' : ''} onClick={() => onSelectWorld(world)}><WorldGlyph accent={world.accent} small /><span>{world.name}</span><span>{world.code}</span></button>)}<span className="sf-subnav-spacer" /></div>
    <section className="sf-worlds-featured"><div className="sf-worlds-featured-visual"><WorldGlyph accent={activeWorld.accent} /></div><div className="sf-worlds-featured-copy"><span className="sf-overline">WORLD ENGINE · {activeWorld.source}</span><h2>{activeWorld.name}</h2><p>{activeWorld.description}</p><span className="sf-world-code-large"><Hash className="h-4 w-4" /> {activeWorld.code} · v{activeWorld.version}</span><div className="sf-worlds-featured-actions"><Button variant="primary" icon={ArrowRight} onClick={() => document.getElementById('world-engine-editor')?.scrollIntoView({ behavior: 'smooth' })}>管理世界设定</Button><Button icon={BookOpenText} onClick={() => onOpenModule('outline')}>继续分步骤创作</Button></div></div><div className="sf-worlds-featured-stats"><div><strong>{activeWorld.completeness}%</strong><span>数据域覆盖</span></div><div><strong>v{activeWorld.version}</strong><span>当前草稿版本</span></div><div><strong>{projection?.readiness === 'usable' ? '可创作' : projection?.readiness === 'building' ? '建设中' : '待建立'}</strong><span>世界状态</span></div></div></section>
    <section id="world-engine-editor" className="sf-product-panel"><WorldEngineWorkspace project={activeWorld.project} projection={projection} activeWorkId={activeWorld.project.activeWorkId} onWorkChanged={onImported ? async () => { await onImported(activeWorld.projectId) } : undefined} onOpenModule={onOpenModule} onOpenGame={onOpenGame} /></section>
    <WorldSharingPanel project={activeWorld.project} onImported={onImported} />
  </>
}

function NovelPage({ project, world, onOpenWorldPicker, onCreate }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void }) {
  const [view, setView] = useState<'outline' | 'chapters'>('outline')
  const [nodeId, setNodeId] = useState<number | null>(null)
  if (!project || !world) return <><PageHeading eyebrow="AUTHORING / STEP BY STEP" title="分步骤写作" description="保留现有项目和熟悉的卷纲、章纲、正文工作流。" /><EmptyProjectState onCreate={onCreate} /></>
  return <><PageHeading eyebrow="AUTHORING / STEP BY STEP" title="分步骤写作" description="以世界引擎为基础，继续使用原有的分步骤小说创作流程。" action={<Button variant="primary" icon={ArrowRight} onClick={() => setView('chapters')}>打开正文</Button>} /><BindingBanner world={world} onChange={onOpenWorldPicker} /><div className="sf-subnav"><button className={view === 'outline' ? 'active' : ''} onClick={() => setView('outline')}><BookOpenText className="h-4 w-4" />卷纲与章纲</button><button className={view === 'chapters' ? 'active' : ''} onClick={() => setView('chapters')}><BookOpenText className="h-4 w-4" />章节与正文</button><span className="sf-subnav-spacer" /><span className="sf-subnav-note">{project.name}</span></div><section className="sf-product-panel sf-novel-panel"><Suspense fallback={<FeaturePanelFallback />}>{view === 'outline' ? <OutlinePanel project={project} onOpenChapter={id => { setNodeId(id); setView('chapters') }} /> : <ChaptersListPanel project={project} initialNodeId={nodeId} />}</Suspense></section></>
}

function NodesPage({ project, world, onOpenWorldPicker, onCreate }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void }) {
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project || !world) return <><PageHeading eyebrow="FLOW / NODE AUTHORING" title="节点创作" description="自由编排资料、处理和生成节点。" /><EmptyProjectState onCreate={onCreate} /></>
  return <><PageHeading eyebrow="FLOW / NODE AUTHORING" title="节点创作" description="把世界观、故事、角色、执行控制和输出候选自由编排成可观察、可回放的创作图。" /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}><NodeAuthoringWorkspace project={project} worldGroupId={worldGroupId} /></Suspense></section></>
}

function TtrpgPage({ project, world, onOpenWorldPicker, onCreate }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void }) {
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project || !world) return <><PageHeading eyebrow="PLAY / TTRPG" title="跑团" description="选择世界版本，开始可回放的单机战役。" /><EmptyProjectState onCreate={onCreate} /></>
  return <><PageHeading eyebrow="PLAY / TTRPG" title="跑团" description="选择一个世界版本，建立独立战役和可回放的互动存档。" /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}><SimulationRuntimePanel project={project} worldGroupId={worldGroupId} workspaceScope={scopeForProject(project)} sessionKind={'ttrpg' satisfies SimulationSessionKind} /></Suspense></section></>
}

function ChatGamePage({ project, world, onOpenWorldPicker, onCreate }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void }) {
  const [mode, setMode] = useState<'play' | 'author'>('play')
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project || !world) return <><PageHeading eyebrow="PLAY / CHATGAME" title="角色聊天" description="选择世界和角色，开始独立的可分支互动会话。" /><EmptyProjectState onCreate={onCreate} /></>
  const scope = scopeForProject(project)
  if (!scope) return <><PageHeading eyebrow="PLAY / CHATGAME" title="角色互动" description="从正式发布开始可回放的长期关系叙事。" /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属尚未就绪</h2><p>请先在世界引擎完成 World/Work 初始化。</p></section></>
  return <><PageHeading eyebrow={mode === 'play' ? 'PLAY / CHATGAME-2' : 'AUTHOR / CHATGAME-2'} title="角色互动" description={mode === 'play' ? '从不可变发布启动单人或多人场景；关系、知识与记忆都有事件证据。' : '配置互动角色、秘密边界、关系规则、场景与 Narrative 连接，然后发布 GameRelease。'} action={<div className="storygame-mode-actions"><Button variant={mode === 'play' ? 'primary' : 'secondary'} icon={Gamepad2} onClick={() => setMode('play')}>玩家模式</Button><Button variant={mode === 'author' ? 'primary' : 'secondary'} icon={BookOpenText} onClick={() => setMode('author')}>作者工作台</Button><Button icon={Hash} onClick={onOpenWorldPicker}>选择世界</Button></div>} /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}>{mode === 'play' ? <ChatGamePanel project={project} worldGroupId={worldGroupId} workspaceScope={scope} /> : <InteractionGameWorkbench scope={scope} />}</Suspense></section></>
}

function TextGamePage({ project, world, onOpenWorldPicker, onCreate, initialProduct = 'storygame' }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void; initialProduct?: 'storygame' | 'text-adventure' | 'avg' }) {
  const [mode, setMode] = useState<'play' | 'author'>('play')
  const [product, setProduct] = useState<'storygame' | 'text-adventure' | 'avg' | 'narrative-simulation' | 'text-open-world'>(initialProduct)
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project || !world) return <><PageHeading eyebrow="PLAY / STORYGAME" title="文字游戏" description="选择世界与叙事蓝图，开始独立的可回放故事。" /><EmptyProjectState onCreate={onCreate} /></>
  const scope = scopeForProject(project)
  if (!scope) return <><PageHeading eyebrow="PLAY / STORYGAME" title="文字游戏" description="从正式发布开始独立、可回放的分支叙事。" /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属尚未就绪</h2><p>请先进入世界引擎完成 World/Work 初始化，再读取正式游戏发布。</p></section></>
  const isAdventure = product === 'text-adventure'
  const isAvg = product === 'avg'
  const isSimulation = product === 'narrative-simulation'
  const isOpenWorld = product === 'text-open-world'
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
  const content = isAdventure
    ? (mode === 'play' ? <AdventureGamePlayer project={project} scope={scope} worldGroupId={worldGroupId} /> : <AdventureGameWorkbench scope={scope} />)
    : isAvg
      ? (mode === 'play' ? <AvgGamePlayer project={project} scope={scope} worldGroupId={worldGroupId} /> : <AvgGameWorkbench scope={scope} />)
      : isSimulation
        ? (mode === 'play' ? <NarrativeSimulationPlayer project={project} scope={scope} worldGroupId={worldGroupId} /> : <NarrativeSimulationWorkbench scope={scope} />)
        : isOpenWorld
          ? (mode === 'play' ? <TextOpenWorldPlayer project={project} scope={scope} worldGroupId={worldGroupId} /> : <TextOpenWorldWorkbench scope={scope} />)
        : (mode === 'play' ? <StoryGamePlayer project={project} scope={scope} worldGroupId={worldGroupId} /> : <StoryGameWorkbench scope={scope} />)
  return <><PageHeading eyebrow={`${mode === 'play' ? 'PLAY' : 'AUTHOR'} / ${productCode}`} title={productTitle} description={description} action={<div className="storygame-mode-actions"><Button variant={product === 'storygame' ? 'primary' : 'secondary'} icon={GitBranch} onClick={() => setProduct('storygame')}>分支叙事</Button><Button variant={isAdventure ? 'primary' : 'secondary'} icon={Map} onClick={() => setProduct('text-adventure')}>文字冒险</Button><Button variant={isAvg ? 'primary' : 'secondary'} icon={MonitorPlay} onClick={() => setProduct('avg')}>AVG</Button><Button variant={isSimulation ? 'primary' : 'secondary'} icon={Activity} onClick={() => setProduct('narrative-simulation')}>叙事模拟</Button><Button variant={isOpenWorld ? 'primary' : 'secondary'} icon={Globe2} onClick={() => setProduct('text-open-world')}>开放世界</Button><Button variant={mode === 'play' ? 'primary' : 'secondary'} icon={Gamepad2} onClick={() => setMode('play')}>玩家</Button><Button variant={mode === 'author' ? 'primary' : 'secondary'} icon={BookOpenText} onClick={() => setMode('author')}>作者</Button><Button icon={Hash} onClick={onOpenWorldPicker}>选择世界</Button></div>} /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}>{content}</Suspense></section></>
}

function CreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: (kind: 'worlds' | 'novel', id: number) => void }) {
  const { createProject } = useProjectStore()
  const [kind, setKind] = useState<'choose' | 'worlds' | 'novel'>('choose')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [projectFolder, setProjectFolder] = useState<FileSystemDirectoryHandle | null>(null)
  const [busy, setBusy] = useState(false)
  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const id = await createProject({ name: name.trim(), genre: 'other', genres: ['other'], status: 'drafting', description: description.trim(), targetWordCount: 500000, enableMultiWorld: false })
      if (projectFolder) {
        try {
          await bindCreatedProjectStorageWorkspace(id, projectFolder)
        } catch (error) {
          console.error('[project-storage] 新项目存储位置保存失败', error)
        }
      }
      onCreated(kind === 'worlds' ? 'worlds' : 'novel', id)
    } finally { setBusy(false) }
  }
  const label = kind === 'worlds' ? '创建世界引擎' : '创建分步骤作品'
  return <div className="sf-modal-backdrop" onMouseDown={onClose}>
    <aside className="sf-create-panel" onMouseDown={event => event.stopPropagation()}>
      <div className="sf-modal-header">
        <div>
          <div className="sf-eyebrow">CREATE SOMETHING</div>
          <h2>{kind === 'choose' ? '你想从哪里开始？' : label}</h2>
          <p>{kind === 'choose' ? '两种入口最终都可以共享同一个世界基座。' : '选择的项目文件夹会成为内容与记忆的本地工作区。'}</p>
        </div>
        <button className="sf-icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X className="h-4 w-4" /></button>
      </div>
      {kind === 'choose' ? <div className="sf-create-options">
        <button onClick={() => setKind('worlds')}><span className="sf-create-option-icon"><Globe2 className="h-5 w-5" /></span><span><strong>世界引擎</strong><small>从零创建可被其他功能引用的世界</small></span><ArrowRight className="h-4 w-4" /></button>
        <button onClick={() => setKind('novel')}><span className="sf-create-option-icon"><BookOpenText className="h-5 w-5" /></span><span><strong>分步骤作品</strong><small>继续熟悉的卷纲、章纲和正文工作流</small></span><ArrowRight className="h-4 w-4" /></button>
      </div> : <div className="sf-create-form">
        <label>名称<input value={name} onChange={event => setName(event.target.value)} placeholder={kind === 'worlds' ? '例如：潮汐之后' : '例如：《幽都遗闻》'} autoFocus /></label>
        <label>简介<textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} placeholder="一句话描述这个世界或作品" /></label>
        <ProjectStorageFolderField value={projectFolder} onChange={setProjectFolder} disabled={busy} />
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
  const [projections, setProjections] = useState<Record<number, WorldProjection>>({})

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

  const worlds = useMemo(() => projects.filter(project => project.id != null).map((project, index) => projectToWorld(project, index, projections[project.id!])), [projects, projections])
  const activeWorld = worlds.find(world => world.projectId === activeProjectId) ?? worlds[0]
  const activeProject = activeWorld?.project
  const selectWorld = (world: ProductWorld) => setActiveProjectId(world.projectId)
  const selectTab = (tab: TabId) => setActiveTab(tab)

  const renderPage = () => {
    switch (activeTab) {
      case 'worlds': return <WorldEnginePage worlds={worlds} activeWorld={activeWorld} onSelectWorld={selectWorld} onOpenCreate={() => setShowCreate(true)} onOpenWorldPicker={() => setShowWorldPicker(true)} onImported={async projectId => { await loadProjects(); setActiveProjectId(projectId); setActiveTab('worlds') }} onOpenModule={module => { if (activeProject?.id) navigate(`/workspace/${activeProject.id}?module=${module}`) }} onOpenGame={product => { setGameProduct(product); setActiveTab('game') }} />
      case 'novel': return <NovelPage project={activeProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} />
      case 'nodes': return <NodesPage project={activeProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} />
      case 'ttrpg': return <TtrpgPage project={activeProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} />
      case 'chat': return <ChatGamePage project={activeProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} />
      case 'game': return <TextGamePage project={activeProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} initialProduct={gameProduct} />
      default: return <HomePage worlds={worlds} activeProject={activeWorld} onSelect={selectTab} onSelectWorld={selectWorld} onOpenCreate={() => setShowCreate(true)} onOpenWorldPicker={() => setShowWorldPicker(true)} />
    }
  }

  return <div className="sf-product-shell"><ProductHeader activeTab={activeTab} onSelect={selectTab} onOpenCreate={() => setShowCreate(true)} onOpenMobileNav={() => setShowMobileNav(true)} onOpenWorldPicker={() => setShowWorldPicker(true)} /><main className="sf-product-main">{renderPage()}</main><footer className="sf-product-footer"><span>StoryForge 产品综合页 · 本地数据</span><span><ShieldCheck className="h-3.5 w-3.5" />世界版本与功能实例分开管理</span></footer>{showCreate && <CreatePanel onClose={() => setShowCreate(false)} onCreated={(kind, id) => { setActiveProjectId(id); setActiveTab(kind); setShowCreate(false); if (kind === 'novel') navigate(`/workspace/${id}?module=outline`) }} />}{showWorldPicker && <WorldPicker worlds={worlds} onClose={() => setShowWorldPicker(false)} onChoose={selectWorld} />}{showMobileNav && <MobileNavPanel activeTab={activeTab} onClose={() => setShowMobileNav(false)} onSelect={selectTab} />}</div>
}
