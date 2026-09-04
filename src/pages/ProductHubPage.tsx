import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  ArrowRight,
  BookOpenText,
  Check,
  ChevronRight,
  FolderOpen,
  Gamepad2,
  Globe2,
  Hash,
  LayoutDashboard,
  Loader2,
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
  Trash2,
  Workflow,
  X,
} from 'lucide-react'
import {
  TEXT_GAME_PRODUCT_KINDS_V1,
  type Project,
  type TextGameProductKindV1,
  type WorkspaceScope,
  type ProductProductionHandoffV1,
} from '../lib/types'
import type { OnlineRoomJoinHandoffV1 } from '../lib/online/http-transport'
import { db } from '../lib/db/schema'
import { createProductRuntimeInstance } from '../lib/product/runtime-instances'
import { parseProductProductionHandoffV1 } from '../lib/product-production/handoff'
import {
  currentAiGmBetaGatePassedV1,
  currentProductPlatformEnvironmentV1,
  evaluateProductPlatformCapabilityV1,
  type ProductPlatformCapabilityDecisionV1,
} from '../lib/product-platform/capability-status'
import { useProjectStore } from '../stores/project'
import { useWorldGroupStore } from '../stores/world-group'
import type { WorldProjection } from '../lib/world-engine/domain'
import { loadWorldProjections } from '../lib/world-engine/domain'
import WorldEngineWorkspace from '../components/world-engine/WorldEngineWorkspace'
import type { SidebarModule } from '../components/layout/sidebar-tree'
import WorldSharingPanel from '../components/product/WorldSharingPanel'
import ProjectStorageFolderField from '../components/shared/ProjectStorageFolderField'
import { bindCreatedProjectStorageWorkspace } from '../lib/storage/project-storage-workspace'
import WelcomeGuide from '../components/guide/WelcomeGuide'
import {
  ensureFolderPermission,
  isFSASupported,
  pickFolder,
  readStoryforgeBackups,
} from '../lib/storage/folder-backup'
import { importProjectJSON } from '../lib/export/json-export'
import { useActiveWork } from '../hooks/useActiveWork'
import WorkKindBadge from '../components/work/WorkKindBadge'
import { effectiveNovelProfile, effectiveWorkKind, SHORT_NOVEL_DEFAULT_WORDS } from '../lib/workspace/work-kind'
import { switchNovelProfile } from '../lib/workspace/works'
import WorldDerivationActions from '../components/world-engine/WorldDerivationActions'
import {
  currentExperimentalProductOptInV1,
  currentProductCatalogChannelV1,
  evaluateProductEntryV1,
  evaluateProductSurfaceV1,
  type ProductSurfaceIdV1,
  type StoryForgeProductIdV1,
} from '../lib/product/product-catalog'
import './product-hub.css'

const NodeAuthoringWorkspace = lazy(() => import('../components/node-authoring/NodeAuthoringWorkspace'))
const TtrpgRuntimePanel = lazy(() => import('../components/ttrpg/TtrpgRuntimePanel'))
const CharacterInteractionPanel = lazy(() => import('../components/character-interaction/CharacterInteractionPanel'))
const AdventureGamePlayer = lazy(() => import('../components/text-game/AdventureGamePlayer'))
const AvgGamePlayer = lazy(() => import('../components/text-game/AvgGamePlayer'))
const TextOpenWorldPlayer = lazy(() => import('../components/text-game/TextOpenWorldPlayer'))
const ProductProductionStudio = lazy(() => import('../components/product/ProductProductionStudio'))
const MarketplacePanel = lazy(() => import('../components/community/MarketplacePanel'))
const OutlinePanel = lazy(() => import('../components/outline/OutlinePanel'))
const ChaptersListPanel = lazy(() => import('../components/editor/ChaptersListPanel'))
const ScreenplayStudio = lazy(() => import('../components/screenplay/ScreenplayStudio'))
const ComicStudio = lazy(() => import('../components/comic/ComicStudio'))

type TabId = 'home' | 'worlds' | 'novel' | 'nodes' | 'ttrpg' | 'chat' | 'text-games' | 'market'
type Accent = 'ochre' | 'teal' | 'blue' | 'violet' | 'rust'

const TTRPG_PRODUCTION_PRODUCTS = ['ttrpg'] as const
const CHARACTER_INTERACTION_PRODUCTION_PRODUCTS = ['character-interaction'] as const

function textGameCatalogId(kind: TextGameProductKindV1): StoryForgeProductIdV1 {
  if (kind === 'text-adventure') return 'upper.text-adventure'
  if (kind === 'avg') return 'upper.avg'
  return 'upper.text-open-world'
}

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
  { id: 'text-games', label: '文字游戏', icon: Gamepad2 },
  { id: 'market', label: '社区市场', icon: Store },
]

const TAB_SURFACE_IDS: Readonly<Partial<Record<TabId, ProductSurfaceIdV1>>> = Object.freeze({
  worlds: 'world-engine',
  novel: 'independent-works',
  nodes: 'node-authoring',
  ttrpg: 'ttrpg',
  chat: 'character-interaction',
  'text-games': 'text-games',
  market: 'marketplace',
})

function productDecision(productId: StoryForgeProductIdV1) {
  return evaluateProductEntryV1({
    productId,
    channel: currentProductCatalogChannelV1(),
    experimentalOptIn: currentExperimentalProductOptInV1(),
  })
}

function tabDecision(tab: TabId) {
  const surfaceId = TAB_SURFACE_IDS[tab]
  return surfaceId ? evaluateProductSurfaceV1({
    surfaceId,
    channel: currentProductCatalogChannelV1(),
    experimentalOptIn: currentExperimentalProductOptInV1(),
  }) : null
}

function visibleNavTabs() {
  return NAV_TABS.filter(tab => tab.id === 'home' || tabDecision(tab.id)?.visible)
}

function MaturityBadge({ productId }: { productId: StoryForgeProductIdV1 }) {
  const decision = productDecision(productId)
  return decision.badge
    ? <span className="rounded border border-current/20 px-1 py-0.5 text-[8px] opacity-70" data-product-status={decision.entry.status}>{decision.badge}</span>
    : null
}

function SurfaceMaturityBadge({ surfaceId }: { surfaceId: ProductSurfaceIdV1 }) {
  const decision = evaluateProductSurfaceV1({
    surfaceId,
    channel: currentProductCatalogChannelV1(),
    experimentalOptIn: currentExperimentalProductOptInV1(),
  })
  return decision.badge
    ? <span className="rounded border border-current/20 px-1 py-0.5 text-[8px] opacity-70" data-product-surface={surfaceId}>{decision.badge}</span>
    : null
}

const FEATURE_META: Record<Exclude<TabId, 'home'>, { eyebrow: string; description: string; icon: typeof Globe2; accent: Accent }> = {
  worlds: { eyebrow: 'FOUNDATION', description: '把设定、角色和规则整理成可持续复用的世界版本。', icon: Globe2, accent: 'ochre' },
  novel: { eyebrow: 'AUTHORING', description: '在同一套可靠工作流中创作短篇、长篇，并承接剧本与漫画改编。', icon: BookOpenText, accent: 'rust' as Accent },
  nodes: { eyebrow: 'FLOW', description: '自由组合世界资料、处理中间产物和生成节点。', icon: Workflow, accent: 'blue' },
  ttrpg: { eyebrow: 'PLAY', description: '选择一个世界版本，开始战役、行动和事件回放。', icon: Swords, accent: 'teal' },
  chat: { eyebrow: 'CHARACTERS', description: '冻结一个世界与角色快照，开始可分支的独立角色聊天。', icon: MessageCircle, accent: 'violet' },
  'text-games': { eyebrow: 'TEXT GAMES', description: '选择文字冒险、AVG 或文字开放世界，从冻结来源生产并运行独立产品。', icon: Gamepad2, accent: 'blue' },
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
  decision: ProductPlatformCapabilityDecisionV1
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
  const tags = projection.work.genres.filter(Boolean).slice(0, 2)
  return {
    projectId: project.id!,
    code: projection.code,
    name: projection.name,
    description: projection.description,
    version: projection.version,
    source: projection.communityOrigin
      ? `社区导入 · ${projection.communityOrigin.sourceWorldCode}`
      : project.enableMultiWorld ? '世界草稿 · 多世界结构' : '世界草稿',
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
  onOpenSettings,
}: {
  activeTab: TabId
  onSelect: (tab: TabId) => void
  onOpenCreate: () => void
  onOpenMobileNav: () => void
  onOpenWorldPicker: () => void
  onOpenSettings: () => void
}) {
  return (
    <header className="sf-header">
      <div className="sf-header-inner">
        <button className="sf-brand" onClick={() => onSelect('home')} aria-label="回到总览">
          <span className="sf-brand-mark"><Sparkles className="h-4 w-4" /></span>
          <span><span className="sf-brand-name">storyforge</span><span className="sf-brand-subtitle">创作与游玩空间</span></span>
        </button>
        <nav className="sf-primary-nav" aria-label="产品页签">
          {visibleNavTabs().map(tab => {
            const Icon = tab.icon
            const surfaceId = TAB_SURFACE_IDS[tab.id]
            return <button key={tab.id} onClick={() => onSelect(tab.id)} className={`sf-nav-tab ${activeTab === tab.id ? 'sf-nav-tab-active' : ''}`} data-testid={`product-tab-${tab.id}`}><Icon className="h-4 w-4" /><span>{tab.label}</span>{surfaceId && <SurfaceMaturityBadge surfaceId={surfaceId} />}</button>
          })}
        </nav>
        <div className="sf-header-actions">
          <button className="sf-icon-button sf-mobile-menu" onClick={onOpenMobileNav} title="打开导航" aria-label="打开导航"><Menu className="h-4 w-4" /></button>
          <button className="sf-icon-button" onClick={onOpenWorldPicker} title="搜索世界" aria-label="搜索世界"><Search className="h-4 w-4" /></button>
          <Button variant="primary" icon={Plus} onClick={onOpenCreate}>新建</Button>
          <button className="sf-avatar" title="模型与本地设置" aria-label="模型与本地设置" onClick={onOpenSettings}>林</button>
        </div>
      </div>
    </header>
  )
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="sf-page-heading"><div><div className="sf-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="sf-heading-action">{action}</div>}</div>
}

function BindingBanner({ world, onChange }: { world: ProductWorld; onChange: () => void }) {
  return <div className="sf-binding-banner"><span className="sf-binding-icon"><WorldGlyph accent={world.accent} small /></span><div><strong>当前世界入口：{world.name} <code>{world.code}</code></strong><p>这里显示的是可编辑世界草稿；开始生产时必须另选并冻结 WorldRelease，运行时只绑定 ProductRelease，绝不会把草稿版本冒充运行来源。</p></div><Button icon={Hash} onClick={onChange}>更换世界</Button></div>
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

function WorkspaceLibraryCard(props: {
  project: Project
  deleteConfirm: number | null
  onOpen: () => void
  onRemove: () => void
}) {
  const activeWork = useActiveWork(props.project)
  const isWorld = props.project.workspacePurpose === 'world-engine'
  const title = activeWork?.title ?? props.project.name
  const description = activeWork?.description || '尚未填写简介'
  return <article className="rounded-lg border border-border bg-bg-surface p-4">
    <div className="flex items-start justify-between gap-3">
      <button className="min-w-0 flex-1 text-left" onClick={props.onOpen}>
        <span className="text-[10px] uppercase tracking-wider text-text-muted">{isWorld ? '世界引擎' : '独立作品'}</span>
        <strong className="mt-1 block truncate text-sm text-text-primary">{title}</strong>
        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-text-secondary">{description}</span>
      </button>
      {props.project.id && <button
        type="button"
        className={props.deleteConfirm === props.project.id ? 'rounded bg-danger/10 px-2 py-1 text-xs text-danger' : 'rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger'}
        onClick={props.onRemove}
        title={props.deleteConfirm === props.project.id ? '再次点击确认删除' : '删除工作区'}
        aria-label={props.deleteConfirm === props.project.id ? `确认删除 ${title}` : `删除 ${title}`}
      >{props.deleteConfirm === props.project.id ? '确认删除' : <Trash2 className="h-4 w-4" />}</button>}
    </div>
  </article>
}

function WorkspaceLibrary(props: {
  projects: Project[]
  onReload: () => void | Promise<void>
  onOpenWorld: (projectId: number) => void
  onOpenWork: (projectId: number) => void
}) {
  const deleteProject = useProjectStore(state => state.deleteProject)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState('')
  const restore = async () => {
    if (!isFSASupported()) {
      setRestoreMessage('当前浏览器不支持文件夹恢复，请使用 Chrome 或 Edge。')
      return
    }
    const folder = await pickFolder()
    if (!folder) return
    setRestoring(true)
    setRestoreMessage('正在读取本地备份…')
    try {
      if (!await ensureFolderPermission(folder, false)) throw new Error('未获得文件夹读取权限。')
      const backups = await readStoryforgeBackups(folder)
      if (backups.length === 0) throw new Error('该文件夹里没有 StoryForge 备份。')
      let imported = 0
      for (const backup of backups) {
        try {
          await importProjectJSON(backup.data)
          imported += 1
        } catch (cause) {
          console.error('[workspace-library] 导入备份失败', backup.name, cause)
        }
      }
      await props.onReload()
      setRestoreMessage(`已恢复 ${imported}/${backups.length} 个工作区。`)
    } catch (cause) {
      setRestoreMessage(cause instanceof Error ? cause.message : '恢复失败。')
    } finally {
      setRestoring(false)
    }
  }
  const remove = async (projectId: number) => {
    if (deleteConfirm !== projectId) {
      setDeleteConfirm(projectId)
      window.setTimeout(() => setDeleteConfirm(current => current === projectId ? null : current), 3_000)
      return
    }
    await deleteProject(projectId)
    setDeleteConfirm(null)
    await props.onReload()
  }
  return <section className="sf-section" data-testid="workspace-library">
    <div className="sf-section-header">
      <div><div className="sf-eyebrow">LOCAL WORKSPACES</div><h2>本地工作区</h2></div>
      <button className="sf-text-button" onClick={() => void restore()} disabled={restoring}>
        {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}从备份文件夹恢复
      </button>
    </div>
    {restoreMessage && <p className="mb-3 text-xs text-text-muted" role="status">{restoreMessage}</p>}
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {props.projects.map(project => <WorkspaceLibraryCard
        key={project.id}
        project={project}
        deleteConfirm={deleteConfirm}
        onOpen={() => project.id && (project.workspacePurpose === 'world-engine' ? props.onOpenWorld(project.id) : props.onOpenWork(project.id))}
        onRemove={() => void remove(project.id!)}
      />)}
      {props.projects.length === 0 && <p className="py-8 text-sm text-text-muted">还没有本地工作区。</p>}
    </div>
  </section>
}

function HomePage({ projects, worlds, activeWorld, activeWorkProject, onSelect, onSelectWorld, onSelectWork, onOpenCreate, onOpenWorldPicker, onReload }: { projects: Project[]; worlds: ProductWorld[]; activeWorld?: ProductWorld; activeWorkProject?: Project; onSelect: (id: TabId) => void; onSelectWorld: (world: ProductWorld) => void; onSelectWork: (projectId: number) => void; onOpenCreate: () => void; onOpenWorldPicker: () => void; onReload: () => void | Promise<void> }) {
  const activeWork = useActiveWork(activeWorkProject)
  return <>
    <div className="sf-home-intro"><div><div className="sf-eyebrow">STORYFORGE · LOCAL WORKSPACE</div><h1>你的创作与游玩空间</h1><p>从一个世界出发，继续写作、编排、游玩，或者开始一段新的故事。</p></div><div className="sf-intro-actions"><Button icon={Hash} onClick={onOpenWorldPicker}>使用世界编号</Button><Button variant="primary" icon={Plus} onClick={onOpenCreate}>新建内容</Button></div></div>
    {(activeWorld || activeWorkProject) ? <section className="sf-resume-grid">{activeWorld && <article className="sf-resume-card sf-resume-primary"><div className="sf-resume-visual"><span className="sf-visual-label"><StatusDot /> 当前世界</span><span className="sf-visual-rule" /><span className="sf-visual-coordinate">{activeWorld.code} · v{activeWorld.version}</span></div><div className="sf-resume-content"><span className="sf-card-kicker"><Globe2 className="h-4 w-4" /> 世界引擎</span><h2>{activeWorld.name}</h2><p>{activeWorld.description}</p><div className="sf-progress"><span style={{ width: `${activeWorld.completeness}%` }} /></div><div className="sf-resume-meta"><span>数据域覆盖 {activeWorld.completeness}%</span><span>{activeWorld.source}</span></div><Button icon={ArrowRight} onClick={() => onSelect('worlds')}>进入世界引擎</Button></div></article>}{activeWorkProject && <article className="sf-resume-card sf-resume-secondary"><div className="sf-resume-secondary-head"><span className="sf-card-kicker"><BookOpenText className="h-4 w-4" /> 最近作品</span><StatusDot tone="neutral" /></div><div className="sf-campaign-avatar"><BookOpenText className="h-5 w-5" /></div><h2>{activeWork?.title ?? activeWorkProject.name}</h2>{activeWork && <WorkKindBadge work={activeWork} />}<p>{activeWork && effectiveWorkKind(activeWork) !== 'novel' ? '进入作品工作台继续制作' : `分步骤创作 · ${activeWork?.currentWordCount ? `${(activeWork.currentWordCount / 10000).toFixed(1)} 万字` : '尚未开始正文'}`}</p><div className="sf-event-list"><div><StatusDot /><span>作品保持独立，不会自动公开为世界</span></div><div><StatusDot tone="warning" /><span>继续完善当前作品</span></div></div><Button variant="quiet" icon={ArrowRight} onClick={() => onSelect('novel')}>继续创作</Button></article>}</section> : <EmptyProjectState onCreate={onOpenCreate} />}
    <section className="sf-section"><div className="sf-section-header"><div><div className="sf-eyebrow">YOUR WORKSPACE</div><h2>从这里开始</h2></div><button className="sf-text-button" onClick={onOpenCreate}>新建 <ArrowRight className="h-4 w-4" /></button></div><div className="sf-feature-grid">{(Object.keys(FEATURE_META) as Array<Exclude<TabId, 'home'>>).filter(id => tabDecision(id)?.visible).map(id => { const meta = FEATURE_META[id]; const Icon = meta.icon; const surfaceId = TAB_SURFACE_IDS[id]!; return <button key={id} className="sf-feature-card" onClick={() => onSelect(id)}><span className={`sf-feature-icon sf-feature-${meta.accent}`}><Icon className="h-5 w-5" /></span><span className="sf-feature-copy"><span className="sf-eyebrow">{meta.eyebrow} <SurfaceMaturityBadge surfaceId={surfaceId} /></span><h3>{NAV_TABS.find(tab => tab.id === id)?.label}</h3><p>{meta.description}</p></span><span className="sf-feature-footer"><span>{id === 'worlds' ? `${worlds.length} 个世界` : id === 'novel' ? '独立作品工作流' : id === 'nodes' ? '同源 DAG 工作区' : id === 'ttrpg' ? '冻结来源制作与试玩' : id === 'chat' ? '多角色生产与运行预览' : id === 'market' ? '显式研究入口' : '三类独立文字游戏'}</span><ArrowRight className="h-4 w-4" /></span></button> })}</div></section>
    <WorkspaceLibrary projects={projects} onReload={onReload} onOpenWorld={projectId => { const world = worlds.find(item => item.projectId === projectId); if (world) onSelectWorld(world); onSelect('worlds') }} onOpenWork={projectId => { onSelectWork(projectId); onSelect('novel') }} />
    <section className="sf-section"><div className="sf-section-header"><div><div className="sf-eyebrow">WORLD LIBRARY</div><h2>我的世界引擎</h2></div><button className="sf-text-button" onClick={() => onSelect('worlds')}>管理世界 <ArrowRight className="h-4 w-4" /></button></div><div className="sf-world-grid">{worlds.slice(0, 3).map(world => <WorldCard key={world.code} world={world} onOpen={() => { onSelectWorld(world); onSelect('worlds') }} />)}<button className="sf-new-world-card" onClick={onOpenCreate}><span className="sf-new-world-plus"><Plus className="h-5 w-5" /></span><strong>从零创建世界</strong><span>建立一个可被上层产品引用的新世界</span></button></div></section>
  </>
}

function WorldCard({ world, onOpen }: { world: ProductWorld; onOpen: () => void }) {
  return <button className="sf-world-card" onClick={onOpen}><WorldGlyph accent={world.accent} /><div className="sf-world-card-body"><div className="sf-card-topline"><span className="sf-overline"><Hash className="h-3 w-3" /> {world.code}</span><span className="sf-version">v{world.version}</span></div><h3>{world.name}</h3><p>{world.description}</p><div className="sf-tag-row">{world.tags.map(tag => <span className="sf-tag" key={tag}>{tag}</span>)}</div><div className="sf-world-card-footer"><span className="sf-source"><StatusDot tone={world.projection?.communityOrigin ? 'neutral' : 'success'} />{world.source}</span><span className="sf-completeness">{world.completeness}%</span></div></div></button>
}

function WorldEnginePage({ worlds, activeWorld, onSelectWorld, onOpenCreate, onOpenWorldPicker, onImported, onOpenModule, onOpenProductProduction }: { worlds: ProductWorld[]; activeWorld?: ProductWorld; onSelectWorld: (world: ProductWorld) => void; onOpenCreate: () => void; onOpenWorldPicker: () => void; onImported: (projectId: number) => void | Promise<void>; onOpenModule: (module: SidebarModule) => void; onOpenProductProduction: (handoff: ProductProductionHandoffV1) => void }) {
  const [worldReleaseRevision, setWorldReleaseRevision] = useState(0)
  if (!activeWorld) return <><PageHeading eyebrow="FOUNDATION / WORLD ENGINE" title="世界引擎" description="独立创建、版本化并复用世界设定。" action={<Button variant="primary" icon={Plus} onClick={onOpenCreate}>从零创建世界</Button>} /><EmptyProjectState onCreate={onOpenCreate} /><WorldSharingPanel onImported={onImported} /></>
  const projection = activeWorld.projection
  const refreshWorld = async () => {
    await onImported(activeWorld.projectId)
    setWorldReleaseRevision(previous => previous + 1)
  }
  return <>
    <PageHeading eyebrow="FOUNDATION / WORLD ENGINE" title="世界引擎" description="世界引擎封存可被跑团、角色聊天与文字游戏引用的叙事语义；独立长篇、短篇和节点创作不以它为前置。" action={<><Button icon={Hash} onClick={onOpenWorldPicker}>使用世界编号</Button><Button variant="primary" icon={Plus} onClick={onOpenCreate}>从零创建世界</Button></>} />
    <div className="sf-subnav">{worlds.map(world => <button key={world.code} className={world.code === activeWorld.code ? 'active' : ''} onClick={() => onSelectWorld(world)}><WorldGlyph accent={world.accent} small /><span>{world.name}</span><span>{world.code}</span></button>)}<span className="sf-subnav-spacer" /></div>
    <section className="sf-worlds-featured"><div className="sf-worlds-featured-visual"><WorldGlyph accent={activeWorld.accent} /></div><div className="sf-worlds-featured-copy"><span className="sf-overline">WORLD ENGINE · {activeWorld.source}</span><h2>{activeWorld.name}</h2><p>{activeWorld.description}</p><span className="sf-world-code-large"><Hash className="h-4 w-4" /> {activeWorld.code} · v{activeWorld.version}</span><div className="sf-worlds-featured-actions"><Button variant="primary" icon={ArrowRight} onClick={() => document.getElementById('world-engine-editor')?.scrollIntoView({ behavior: 'smooth' })}>管理世界设定</Button><Button icon={BookOpenText} onClick={() => onOpenModule('outline')}>继续分步骤创作</Button></div></div><div className="sf-worlds-featured-stats"><div><strong>{activeWorld.completeness}%</strong><span>数据域覆盖</span></div><div><strong>v{activeWorld.version}</strong><span>当前草稿版本</span></div><div><strong>{projection?.readiness === 'usable' ? '可创作' : projection?.readiness === 'building' ? '建设中' : '待建立'}</strong><span>世界状态</span></div></div></section>
    <section id="world-engine-editor" className="sf-product-panel"><WorldEngineWorkspace projection={projection} activeWorkId={activeWorld.project.activeWorkId} onWorkChanged={refreshWorld} onOpenModule={onOpenModule} onOpenProductProduction={onOpenProductProduction} /></section>
    <WorldSharingPanel project={activeWorld.project} worldReleaseRevision={worldReleaseRevision} onImported={onImported} />
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
  const activeProductId: StoryForgeProductIdV1 = !activeWork || effectiveWorkKind(activeWork) === 'novel'
    ? profile === 'short' ? 'independent.shortform' : 'independent.longform'
    : effectiveWorkKind(activeWork) === 'screenplay'
      ? 'independent.screenplay'
      : 'independent.comic'
  const activeProductDecision = productDecision(activeProductId)
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
  if (!activeProductDecision.enterable) {
    return <><PageHeading eyebrow="AUTHORING / WORKS" title={activeProductDecision.entry.label} description={activeProductDecision.entry.maturityNote} action={<MaturityBadge productId={activeProductId} />} /><section className="sf-product-empty"><ShieldCheck className="h-8 w-8" /><h2>该独立产品尚未开放</h2><p>{activeProductDecision.blockers.join('；')}</p></section></>
  }
  if (!isNovel && activeWork) {
    const scope = scopeForProject(project)
    return <><PageHeading eyebrow="AUTHORING / WORKS" title={effectiveWorkKind(activeWork) === 'screenplay' ? '正规剧本工作台' : '漫画工作台'} description="派生作品拥有独立结构、来源证据和导出链；不会修改源小说。" action={<WorkKindBadge work={activeWork} />} />{scope ? <Suspense fallback={<FeaturePanelFallback />}>{effectiveWorkKind(activeWork) === 'screenplay' ? <ScreenplayStudio scope={scope} /> : <ComicStudio scope={scope} />}</Suspense> : <section className="sf-product-empty"><BookOpenText className="h-8 w-8" /><h2>漫画工作区归属尚未就绪</h2><p>请先完成目标 Work 初始化。</p></section>}</>
  }
  const alternateProductId: StoryForgeProductIdV1 = profile === 'short' ? 'independent.longform' : 'independent.shortform'
  const canSwitchProfile = productDecision(alternateProductId).enterable
  return <><PageHeading eyebrow="AUTHORING / STEP BY STEP" title={profile === 'short' ? '短篇小说创作' : '长篇小说创作'} description={profile === 'short' ? '独立短篇产品复用同一份可靠 Canon 与生成底座。' : '独立运行完整的分步骤长篇创作流程；世界引擎不是前置条件。'} action={<div className="flex flex-wrap items-center justify-end gap-2">{activeWork && <WorkKindBadge work={activeWork} />}<MaturityBadge productId={activeProductId} /><WorldDerivationActions project={project} onDerived={onDerived} />{canSwitchProfile && <Button onClick={() => void changeProfile(profile === 'short' ? 'long' : 'short')} disabled={profileBusy}>{profileBusy ? '切换中…' : profile === 'short' ? '扩写为长篇' : '切换为短篇'}</Button>}<Button variant="primary" icon={ArrowRight} onClick={() => setView('chapters')}>打开正文</Button></div>} />{profileError && <p className="mb-3 text-sm text-red-600" role="alert">{profileError}</p>}<div className="sf-subnav"><button className={view === 'outline' ? 'active' : ''} onClick={() => setView('outline')}><BookOpenText className="h-4 w-4" />卷纲与章纲</button><button className={view === 'chapters' ? 'active' : ''} onClick={() => setView('chapters')}><BookOpenText className="h-4 w-4" />章节与正文</button><span className="sf-subnav-spacer" /><span className="sf-subnav-note">{activeWork?.title ?? '当前作品'}</span></div><section className="sf-product-panel sf-novel-panel"><Suspense fallback={<FeaturePanelFallback />}>{view === 'outline' ? <OutlinePanel project={project} onOpenChapter={id => { setNodeId(id); setView('chapters') }} /> : <ChaptersListPanel project={project} initialNodeId={nodeId} />}</Suspense></section></>
}

function NodesPage({ project, onCreate }: { project?: Project; onCreate: () => void }) {
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project) return <><PageHeading eyebrow="FLOW / NODE AUTHORING" title="节点创作" description="自由编排资料、处理和生成节点。" /><EmptyProjectState onCreate={onCreate} /></>
  return <><PageHeading eyebrow="FLOW / NODE AUTHORING" title="节点创作" description="把分步骤长篇的同源能力拆成更自由、更细粒度、可视且可组合的创作图。" /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}><NodeAuthoringWorkspace project={project} worldGroupId={worldGroupId} /></Suspense></section></>
}

function TtrpgPage({ project, world, onOpenWorldPicker, onCreate, initialSessionId = null, initialProductionHandoff = null, initialOnlineHandoff = null, onOnlineHandoffConsumed }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void; initialSessionId?: number | null; initialProductionHandoff?: ProductProductionHandoffV1 | null; initialOnlineHandoff?: OnlineRoomJoinHandoffV1 | null; onOnlineHandoffConsumed?: () => void }) {
  const [mode, setMode] = useState<'play' | 'production'>('play')
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
  return <><PageHeading eyebrow={mode === 'play' ? 'PLAY / TTRPG' : 'PRODUCE / TTRPG'} title="跑团" description={mode === 'play' ? '从冻结产品发布进入确定性规则、场景、战斗与长期记录。' : '从不可变世界来源确认 Brief，经统一 Production、Build、媒资和质量闸门形成可运行产品。'} action={<div className="product-mode-actions"><Button variant={mode === 'play' ? 'primary' : 'secondary'} icon={Gamepad2} onClick={() => setMode('play')}>主持与游玩</Button><Button variant={mode === 'production' ? 'primary' : 'secondary'} icon={Sparkles} onClick={() => setMode('production')}>跑团制作</Button><Button icon={Hash} onClick={onOpenWorldPicker}>选择世界</Button></div>} /><BindingBanner world={world} onChange={onOpenWorldPicker} />{mode === 'production' && <p className="mx-5 rounded border border-accent/30 bg-accent/5 px-4 py-3 text-xs leading-5 text-text-muted" data-testid="ttrpg-production-contract-boundary">跑团只通过统一产品生产链读取冻结世界资源；内容、媒资、Build、Release 与运行私域均归跑团产品，不回写世界引擎。</p>}<section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}>{mode === 'production' ? <ProductProductionStudio scope={scope} worldGroupId={worldGroupId} allowedProducts={TTRPG_PRODUCTION_PRODUCTS} initialProduct="ttrpg" initialSource={initialProductionHandoff} onPublished={() => { setPreviewSessionId(null); setRuntimeKey(value => value + 1); setMode('play') }} onPreviewStarted={(_, sessionId) => { setPreviewSessionId(sessionId); setRuntimeKey(value => value + 1); setMode('play') }} /> : <TtrpgRuntimePanel key={runtimeKey} project={project} worldGroupId={worldGroupId} workspaceScope={scope} initialSessionId={previewSessionId ?? initialSessionId} initialOnlineHandoff={initialOnlineHandoff} onOnlineHandoffConsumed={onOnlineHandoffConsumed} />}</Suspense></section></>
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

function CharacterInteractionPage({ project, world, onOpenWorldPicker, onCreate, initialSessionId = null }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void; initialSessionId?: number | null }) {
  const [mode, setMode] = useState<'play' | 'author'>('play')
  const [previewSessionId, setPreviewSessionId] = useState<number | null>(null)
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project || !world) return <><PageHeading eyebrow="PLAY / CHARACTER-INTERACTION" title="角色聊天" description="选择世界和角色，开始独立的可分支互动会话。" /><EmptyProjectState onCreate={onCreate} /></>
  const scope = scopeForProject(project)
  if (!scope) return <><PageHeading eyebrow="PLAY / CHARACTER-INTERACTION" title="角色互动" description="从正式发布开始可回放的长期关系叙事。" /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属尚未就绪</h2><p>请先在世界引擎完成 World/Work 初始化。</p></section></>
  return <><PageHeading eyebrow={mode === 'play' ? 'PLAY / CHARACTER-INTERACTION' : 'PRODUCE / CHARACTER-INTERACTION'} title="角色互动" description={mode === 'play' ? '从不可变 Product Release 启动单人或多角色会话，持续演化消息、知识、记忆、关系与场景。' : '通过统一产品生产 Harness 按角色互动需求读取冻结世界资源，形成自包含 Build 与 Product Release。'} action={<div className="product-mode-actions"><Button variant={mode === 'play' ? 'primary' : 'secondary'} icon={Gamepad2} onClick={() => setMode('play')}>玩家模式</Button><Button variant={mode === 'author' ? 'primary' : 'secondary'} icon={BookOpenText} onClick={() => setMode('author')}>正式制作</Button><Button icon={Hash} onClick={onOpenWorldPicker}>选择世界</Button></div>} /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}>{mode === 'play' ? <CharacterInteractionPanel project={project} worldGroupId={worldGroupId} workspaceScope={scope} initialSessionId={previewSessionId ?? initialSessionId} /> : <ProductProductionStudio scope={scope} worldGroupId={worldGroupId} allowedProducts={CHARACTER_INTERACTION_PRODUCTION_PRODUCTS} initialProduct="character-interaction" onPublished={() => setMode('play')} onPreviewStarted={(_, sessionId) => { setPreviewSessionId(sessionId); setMode('play') }} />}</Suspense></section></>
}

function TextGamePage({ project, world, onOpenWorldPicker, onCreate, initialProduct = 'text-adventure', initialMode = 'play', initialProductionHandoff = null }: { project?: Project; world?: ProductWorld; onOpenWorldPicker: () => void; onCreate: () => void; initialProduct?: TextGameProductKindV1; initialMode?: 'play' | 'production'; initialProductionHandoff?: ProductProductionHandoffV1 | null }) {
  const updateWorkspace = useProjectStore(state => state.updateWorkspace)
  const [mode, setMode] = useState<'play' | 'production'>(initialMode)
  const [product, setProduct] = useState<TextGameProductKindV1>(initialProduct)
  const [previewSessionId, setPreviewSessionId] = useState<number | null>(null)
  const availableProducts = useMemo(
    () => TEXT_GAME_PRODUCT_KINDS_V1.filter(kind => productDecision(textGameCatalogId(kind)).enterable),
    [],
  )
  useEffect(() => {
    const requested = initialProductionHandoff?.productType as TextGameProductKindV1 | undefined
    if (requested && TEXT_GAME_PRODUCT_KINDS_V1.includes(requested) && productDecision(textGameCatalogId(requested)).enterable) {
      setProduct(requested)
      setMode('production')
    }
  }, [initialProductionHandoff])
  useEffect(() => {
    if (availableProducts.includes(product)) return
    if (availableProducts[0]) setProduct(availableProducts[0])
  }, [availableProducts, product])
  const worldGroupId = useSelectedWorldGroupId(project)
  if (!project || !world) return <><PageHeading eyebrow="PLAY / TEXT GAME" title="文字游戏" description="选择世界与叙事蓝图，开始独立的可回放故事。" /><EmptyProjectState onCreate={onCreate} /></>
  const scope = scopeForProject(project)
  if (!scope) return <><PageHeading eyebrow="PLAY / TEXT GAME" title="文字游戏" description="从正式发布开始独立、可回放的文字游戏。" /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属尚未就绪</h2><p>请先进入世界引擎完成 World/Work 初始化，再读取正式游戏发布。</p></section></>
  const isAdventure = product === 'text-adventure'
  const isAvg = product === 'avg'
  const isOpenWorld = product === 'text-open-world'
  const currentProductDecision = productDecision(textGameCatalogId(product))
  if (!currentProductDecision.enterable) return <><PageHeading eyebrow="PLAY / TEXT GAME" title={currentProductDecision.entry.label} description={currentProductDecision.entry.maturityNote} action={<MaturityBadge productId={currentProductDecision.entry.id} />} /><section className="sf-product-empty"><ShieldCheck className="h-8 w-8" /><h2>该文字游戏产品尚未开放</h2><p>{currentProductDecision.blockers.join('；')}</p></section></>
  const productionDecision = evaluateProductPlatformCapabilityV1('product-production-v3', {
    environment: currentProductPlatformEnvironmentV1(), experimentalProject: false,
    authorOptIn: project.productPlatformOptIns?.productProductionV3 === true,
    onlineServiceConfigured: false, aiGmBetaGatePassed: currentAiGmBetaGatePassedV1(),
  })
  const productCode = isAdventure ? 'TEXT-ADVENTURE' : isAvg ? 'AVG' : 'TEXT-OPEN-WORLD'
  const productTitle = isAdventure ? '文字冒险' : isAvg ? 'AVG / Galgame' : '文字开放世界'
  const description = isAdventure
    ? (mode === 'play' ? '在有限地点中通过物品、资源、能力与任务行动推进，并从正式状态解锁 Narrative 结局。' : '编辑地点、交互物、物品、能力、任务和判定，校验后冻结为可离线游玩的发布。')
    : isAvg
      ? (mode === 'play' ? '用背景、立绘、CG、音频和可恢复舞台演出同一份分支故事，也可纯文字通关。' : '导入版本化媒资，为 Narrative Beat 配置声明式 Cue 并发布不可变演出。')
      : (mode === 'play' ? '在多个区域之间旅行，让人物、组织、问题和动态任务在同一可回放世界时间线上持续演进。' : '组合区域目录、交通、发现渠道、固定任务、模板、日程和传播规则，并冻结全部共享能力。')
  const content = mode === 'production'
    ? productionDecision.enabled ? <ProductProductionStudio
      scope={scope}
      worldGroupId={worldGroupId}
      allowedProducts={availableProducts}
      initialProduct={product}
      initialSource={initialProductionHandoff}
      onProductSelected={next => {
        if (TEXT_GAME_PRODUCT_KINDS_V1.includes(next as TextGameProductKindV1) && productDecision(textGameCatalogId(next as TextGameProductKindV1)).enterable) {
          setProduct(next as TextGameProductKindV1)
        }
      }}
      onPublished={next => {
        setPreviewSessionId(null)
        if (TEXT_GAME_PRODUCT_KINDS_V1.includes(next as TextGameProductKindV1) && productDecision(textGameCatalogId(next as TextGameProductKindV1)).enterable) {
          setProduct(next as TextGameProductKindV1)
          setMode('play')
        }
      }}
      onPreviewStarted={(next, sessionId) => {
        if (TEXT_GAME_PRODUCT_KINDS_V1.includes(next as TextGameProductKindV1) && productDecision(textGameCatalogId(next as TextGameProductKindV1)).enterable) {
          setPreviewSessionId(sessionId)
          setProduct(next as TextGameProductKindV1)
          setMode('play')
        }
      }}
    /> : <CapabilityConsentGate decision={productionDecision} onEnable={() => updateWorkspace(project.id!, {
      productPlatformOptIns: { ...project.productPlatformOptIns, productProductionV3: true },
    })} />
    : isAdventure
      ? <AdventureGamePlayer project={project} scope={scope} worldGroupId={worldGroupId} initialSessionId={previewSessionId} />
      : isAvg
        ? <AvgGamePlayer project={project} scope={scope} worldGroupId={worldGroupId} initialSessionId={previewSessionId} />
        : <TextOpenWorldPlayer project={project} scope={scope} worldGroupId={worldGroupId} initialSessionId={previewSessionId} />
  return <><PageHeading eyebrow={`${mode === 'play' ? 'PLAY' : 'PRODUCE'} / ${productCode}`} title={mode === 'production' ? '文字游戏制作中心' : productTitle} description={mode === 'production' ? '从冻结 WorldRelease 会谈、审查 Brief、显式授权、构建可玩预览，并经证据复验原子发布。' : description} action={<div className="product-mode-actions">{availableProducts.includes('text-adventure') && <Button variant={isAdventure ? 'primary' : 'secondary'} icon={Map} onClick={() => setProduct('text-adventure')}>文字冒险</Button>}{availableProducts.includes('avg') && <Button variant={isAvg ? 'primary' : 'secondary'} icon={MonitorPlay} onClick={() => setProduct('avg')}>AVG</Button>}{availableProducts.includes('text-open-world') && <Button variant={isOpenWorld ? 'primary' : 'secondary'} icon={Globe2} onClick={() => setProduct('text-open-world')}>文字开放世界</Button>}<Button variant={mode === 'play' ? 'primary' : 'secondary'} icon={Gamepad2} onClick={() => setMode('play')}>玩家</Button><Button variant={mode === 'production' ? 'primary' : 'secondary'} icon={Sparkles} onClick={() => setMode('production')}>制作</Button><Button icon={Hash} onClick={onOpenWorldPicker}>选择世界</Button></div>} /><BindingBanner world={world} onChange={onOpenWorldPicker} /><section className="sf-product-runtime-surface"><Suspense fallback={<FeaturePanelFallback />}>{content}</Suspense></section></>
}

function CreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: (kind: 'worlds' | 'novel', id: number) => void }) {
  const { createWorkspace } = useProjectStore()
  const [kind, setKind] = useState<'choose' | 'worlds' | 'long-novel' | 'short-novel'>('choose')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetWordCount, setTargetWordCount] = useState(10_000)
  const [preferredChapterCount, setPreferredChapterCount] = useState<number | ''>('')
  const [projectFolder, setProjectFolder] = useState<FileSystemDirectoryHandle | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canCreateShort = productDecision('independent.shortform').enterable
  const canCreateLong = productDecision('independent.longform').enterable
  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const isShort = kind === 'short-novel'
      const isNovel = isShort || kind === 'long-novel'
      const id = await createWorkspace({
        name: name.trim(), genres: ['other'], status: 'drafting',
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
        {canCreateShort && <button onClick={() => setKind('short-novel')}><span className="sf-create-option-icon"><BookOpenText className="h-5 w-5" /></span><span><strong>短篇小说 <MaturityBadge productId="independent.shortform" /></strong><small>5,000～25,000 字，动态单卷结构</small></span><ArrowRight className="h-4 w-4" /></button>}
        {canCreateLong && <button onClick={() => setKind('long-novel')}><span className="sf-create-option-icon"><BookOpenText className="h-5 w-5" /></span><span><strong>长篇小说</strong><small>保留熟悉的完整分步骤工作流</small></span><ArrowRight className="h-4 w-4" /></button>}
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
  return <div className="sf-modal-backdrop" onMouseDown={onClose}><aside className="sf-picker-panel" onMouseDown={event => event.stopPropagation()}><div className="sf-modal-header"><div><div className="sf-eyebrow">WORLD SOURCE</div><h2>选择世界入口</h2><p>这里选择可编辑世界草稿；开始产品制作时还必须选择并冻结一个 WorldRelease。</p></div><button className="sf-icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X className="h-4 w-4" /></button></div><div className="sf-picker-input"><Search className="h-4 w-4" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="输入世界名称或编号" autoFocus /></div><div className="sf-picker-list">{results.map(world => <button key={world.code} onClick={() => { onChoose(world); onClose() }}><WorldGlyph accent={world.accent} small /><span><strong>{world.name}</strong><small><Hash className="h-3 w-3" />{world.code} · 草稿索引 v{world.version}</small></span><ChevronRight className="h-4 w-4" /></button>)}{results.length === 0 && <div className="sf-picker-empty"><Search className="h-5 w-5" /><span>没有找到这个世界</span><small>检查编号是否完整。</small></div>}</div><div className="sf-picker-footer"><button disabled><ShieldCheck className="h-4 w-4" />社区世界接入准备中</button></div></aside></div>
}

function MobileNavPanel({ activeTab, onClose, onSelect }: { activeTab: TabId; onClose: () => void; onSelect: (tab: TabId) => void }) {
  return <div className="sf-modal-backdrop sf-mobile-nav-backdrop" onMouseDown={onClose}><aside className="sf-mobile-nav-panel" onMouseDown={event => event.stopPropagation()}><div className="sf-modal-header"><div><div className="sf-eyebrow">STORYFORGE</div><h2>产品页签</h2></div><button className="sf-icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X className="h-4 w-4" /></button></div><nav>{visibleNavTabs().map(tab => { const Icon = tab.icon; const surfaceId = TAB_SURFACE_IDS[tab.id]; return <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => { onSelect(tab.id); onClose() }}><span><Icon className="h-4 w-4" /></span><strong>{tab.label}</strong>{surfaceId && <SurfaceMaturityBadge surfaceId={surfaceId} />}{activeTab === tab.id ? <Check className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> })}</nav></aside></div>
}

export default function ProductHubPage() {
  const navigate = useNavigate()
  const { projects, loadProjects } = useProjectStore()
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [activeWorkProjectId, setActiveWorkProjectId] = useState<number | null>(null)
  const [activeWorldProjectId, setActiveWorldProjectId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showWorldPicker, setShowWorldPicker] = useState(false)
  const [showMobileNav, setShowMobileNav] = useState(false)
  const [textGameProduct, setTextGameProduct] = useState<TextGameProductKindV1>('text-adventure')
  const [textGameInitialMode, setTextGameInitialMode] = useState<'play' | 'production'>('play')
  const [textProductProductionHandoff, setTextProductProductionHandoff] = useState<ProductProductionHandoffV1 | null>(null)
  const [ttrpgInitialSessionId, setTtrpgInitialSessionId] = useState<number | null>(null)
  const [ttrpgProductionHandoff, setTtrpgProductionHandoff] = useState<ProductProductionHandoffV1 | null>(null)
  const [onlineRoomHandoff, setOnlineRoomHandoff] = useState<OnlineRoomJoinHandoffV1 | null>(null)
  const [projections, setProjections] = useState<Record<number, WorldProjection>>({})
  const activeWorldGroupId = useWorldGroupStore(state => state.activeGroupId)

  useEffect(() => { void loadProjects() }, [loadProjects])

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
  const workProjects = useMemo(() => projects.filter(project => (
    project.workspacePurpose !== 'world-engine'
  )), [projects])
  useEffect(() => {
    if (activeWorkProjectId != null && workProjects.some(project => project.id === activeWorkProjectId)) return
    setActiveWorkProjectId(workProjects[0]?.id ?? null)
  }, [activeWorkProjectId, workProjects])
  useEffect(() => {
    // Project identity is authoritative while the derived world projection is
    // still loading. Otherwise a newly-created/imported world is immediately
    // reset to the first stale projection before its own projection arrives.
    if (activeWorldProjectId != null && projects.some(project => (
      project.id === activeWorldProjectId && project.workspacePurpose === 'world-engine'
    ))) return
    setActiveWorldProjectId(worlds[0]?.projectId ?? null)
  }, [activeWorldProjectId, projects, worlds])
  const activeWorkProject = workProjects.find(project => project.id === activeWorkProjectId) ?? workProjects[0]
  const activeWorld = worlds.find(world => world.projectId === activeWorldProjectId) ?? worlds[0]
  const activeWorldProject = activeWorld?.project
  const selectWorld = (world: ProductWorld) => setActiveWorldProjectId(world.projectId)
  const selectWork = (projectId: number) => setActiveWorkProjectId(projectId)
  const selectTab = (tab: TabId) => {
    const decision = tabDecision(tab)
    if (decision && !decision.enterable) return
    if (tab === 'text-games') setTextGameInitialMode('play')
    setActiveTab(tab)
  }
  const openAcceptedOnlineRoom = async (handoff: OnlineRoomJoinHandoffV1) => {
    const scope = activeWorldProject ? scopeForProject(activeWorldProject) : undefined
    if (!scope) throw new Error('请先选择已完成 World/Work 初始化的本地工作区。')
    const releases = await db.productReleases.where('workId').equals(scope.workId).toArray()
    const release = releases.find(row => row.contentHash === handoff.releaseHash
      && row.projectId === scope.projectId && row.worldId === scope.worldId)
    if (!release?.id) throw new Error('本地尚无该跑团发行版本，请先在玩家市场领取或下载，再进入在线房间。')
    let productType = ''
    try { productType = String((JSON.parse(release.manifestJson) as { productType?: unknown }).productType ?? '') }
    catch { throw new Error('本地发行版本清单损坏，请重新下载。') }
    if (productType !== 'ttrpg') throw new Error('该招募绑定的不是跑团 ProductRelease。')
    const sessions = await db.productRuntimeSessions.where('projectId').equals(scope.projectId).toArray()
    const expectedWorldGroupId = activeWorldProject?.enableMultiWorld ? activeWorldGroupId : null
    let session = sessions.find(row => row.kind === 'ttrpg' && row.productReleaseId === release.id
      && row.worldId === scope.worldId && row.workId === scope.workId
      && (row.worldGroupId ?? null) === expectedWorldGroupId)
    if (!session) {
      session = await createProductRuntimeInstance({
        scope, kind: 'ttrpg', title: `${release.label} · 在线战役`,
        productSource: { kind: 'release', productReleaseId: release.id },
        worldGroupId: expectedWorldGroupId,
      })
    }
    setTtrpgInitialSessionId(session.id!)
    setOnlineRoomHandoff(handoff)
    setActiveTab('ttrpg')
  }

  const renderPage = () => {
    const home = () => <HomePage
      projects={projects}
      worlds={worlds}
      activeWorld={activeWorld}
      activeWorkProject={activeWorkProject}
      onSelect={selectTab}
      onSelectWorld={selectWorld}
      onSelectWork={selectWork}
      onOpenCreate={() => setShowCreate(true)}
      onOpenWorldPicker={() => setShowWorldPicker(true)}
      onReload={loadProjects}
    />
    const decision = tabDecision(activeTab)
    if (decision && !decision.enterable) {
      return home()
    }
    switch (activeTab) {
      case 'worlds': return <WorldEnginePage worlds={worlds} activeWorld={activeWorld} onSelectWorld={selectWorld} onOpenCreate={() => setShowCreate(true)} onOpenWorldPicker={() => setShowWorldPicker(true)} onImported={async projectId => { await loadProjects(); setActiveWorldProjectId(projectId); setActiveTab('worlds') }} onOpenModule={module => { if (activeWorldProject?.id) navigate(`/workspace/${activeWorldProject.id}?module=${module}`) }} onOpenProductProduction={handoff => {
        const parsed = parseProductProductionHandoffV1(handoff)
        if (parsed.productType === 'ttrpg') {
          if (!productDecision('upper.ttrpg').enterable) throw new Error('跑团产品当前未开放。')
          setTtrpgProductionHandoff(parsed)
          setActiveTab('ttrpg')
          return
        }
        if (!TEXT_GAME_PRODUCT_KINDS_V1.includes(parsed.productType as TextGameProductKindV1)) {
          throw new Error(`该通用入口暂不支持产品类型：${parsed.productType}`)
        }
        if (!productDecision(textGameCatalogId(parsed.productType as TextGameProductKindV1)).enterable) {
          throw new Error('所选文字游戏产品当前未开放。')
        }
        setTextGameProduct(parsed.productType as TextGameProductKindV1)
        setTextGameInitialMode('production')
        setTextProductProductionHandoff(parsed)
        setActiveTab('text-games')
      }} />
      case 'novel': return <NovelPage project={activeWorkProject} onCreate={() => setShowCreate(true)} onDerived={async projectId => { await loadProjects(); setActiveWorldProjectId(projectId); setActiveTab('worlds') }} />
      case 'nodes': return <NodesPage project={activeWorkProject} onCreate={() => setShowCreate(true)} />
      case 'ttrpg': return <TtrpgPage project={activeWorldProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} initialSessionId={ttrpgInitialSessionId} initialProductionHandoff={ttrpgProductionHandoff} initialOnlineHandoff={onlineRoomHandoff} onOnlineHandoffConsumed={() => setOnlineRoomHandoff(null)} />
      case 'chat': return <CharacterInteractionPage project={activeWorldProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} />
      case 'text-games': return <TextGamePage project={activeWorldProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onCreate={() => setShowCreate(true)} initialProduct={textGameProduct} initialMode={textGameInitialMode} initialProductionHandoff={textProductProductionHandoff} />
      case 'market': return <MarketplacePage project={activeWorldProject} world={activeWorld} onOpenWorldPicker={() => setShowWorldPicker(true)} onImported={loadProjects} onRoomHandoff={openAcceptedOnlineRoom} />
      default: return home()
    }
  }

  return <div className="sf-product-shell"><WelcomeGuide onGoSettings={() => navigate('/settings')} /><ProductHeader activeTab={activeTab} onSelect={selectTab} onOpenCreate={() => setShowCreate(true)} onOpenMobileNav={() => setShowMobileNav(true)} onOpenWorldPicker={() => setShowWorldPicker(true)} onOpenSettings={() => navigate('/settings')} /><main className="sf-product-main">{renderPage()}</main><footer className="sf-product-footer"><span>StoryForge 产品综合页 · 本地数据</span><span><ShieldCheck className="h-3.5 w-3.5" />世界版本与产品实例分开管理</span></footer>{showCreate && <CreatePanel onClose={() => setShowCreate(false)} onCreated={(kind, id) => { if (kind === 'worlds') setActiveWorldProjectId(id); else setActiveWorkProjectId(id); setActiveTab(kind); setShowCreate(false); if (kind === 'novel') navigate(`/workspace/${id}?module=outline`) }} />}{showWorldPicker && <WorldPicker worlds={worlds} onClose={() => setShowWorldPicker(false)} onChoose={selectWorld} />}{showMobileNav && <MobileNavPanel activeTab={activeTab} onClose={() => setShowMobileNav(false)} onSelect={selectTab} />}</div>
}
