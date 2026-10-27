import '../components/text-game/adventure-showcase.css'
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import AdventureProductFrame from '../components/text-game/AdventureProductFrame'
import { readAdventureWorkspace, rememberAdventureWorkspace } from '../components/text-game/adventure-navigation'
import ErrorBoundary from '../components/shared/ErrorBoundary'
import { BuiltinGameShelf } from '../components/text-game/BuiltinGameShelf'
import { liveQuery } from 'dexie'
import ProductFrame from '../components/navigation/ProductFrame'
import { db } from '../lib/db/schema'
import { useWorldGroupStore } from '../stores/world-group'
import type { Project, ProductProductionHandoffV1, WorkspaceScope } from '../lib/types'
import { parseProductProductionHandoffV1 } from '../lib/product-production/handoff'
import {
  currentExperimentalProductOptInV1,
  currentProductCatalogChannelV1,
  evaluateProductEntryV1,
} from '../lib/product/product-catalog'
import {
  currentAiGmBetaGatePassedV1,
  currentProductPlatformEnvironmentV1,
  evaluateProductPlatformCapabilityV1,
} from '../lib/product-platform/capability-status'
import { updateWorkspace } from '../lib/workspace/works'
import {
  parseTextOpenWorldSettingsReturnV1,
  type TextOpenWorldSettingsReturnV1,
} from '../lib/open-world/creator-settings-navigation'
import type { TextOpenWorldCreatorBriefResumeTargetV1 } from '../lib/open-world/creator-brief'

const AdventureGamePlayer = lazy(() => import('../components/text-game/AdventureGamePlayer'))
const TextOpenWorldPlayer = lazy(() => import('../components/text-game/TextOpenWorldPlayer'))
const ProductProductionStudio = lazy(() => import('../components/product/ProductProductionStudio'))
const TextOpenWorldCreatorWorkflow = lazy(() => import('../components/text-game/TextOpenWorldCreatorWorkflow')
  .then(module => ({ default: module.TextOpenWorldCreatorWorkflow })))

type StudioView = 'confirm' | 'production' | 'review' | 'release'
type PageMode = 'play' | 'production'

function scopeForProject(project: Project | undefined): WorkspaceScope | undefined {
  return project?.id != null && project.activeWorldId != null && project.activeWorkId != null
    ? { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
    : undefined
}

const ADVENTURE_PAGE: Record<string, { label: string; mode: PageMode; studioView?: StudioView }> = {
  library: { label: '作品与试玩', mode: 'play' },
  vision: { label: '产品定向', mode: 'production', studioView: 'confirm' },
  systems: { label: '玩法与资源', mode: 'production', studioView: 'confirm' },
  production: { label: '自动制作', mode: 'production', studioView: 'production' },
  map: { label: '地点与地图', mode: 'production', studioView: 'production' },
  actions: { label: '物品、能力与行动', mode: 'production', studioView: 'production' },
  quests: { label: '任务与结局', mode: 'production', studioView: 'production' },
  review: { label: '质量验收', mode: 'production', studioView: 'review' },
  'media-all': { label: '素材总览', mode: 'production', studioView: 'review' },
  release: { label: '发布与导出', mode: 'production', studioView: 'release' },
  play: { label: '开始冒险', mode: 'play' },
  playmap: { label: '探索地图', mode: 'play' },
  history: { label: '冒险与存档', mode: 'play' },
  runtime: { label: '制作与试玩', mode: 'play' },
}

/** Product-owned S2/S3 production and runtime entry for the two text-game products. */
export default function TextGameDevelopmentPage({ openWorld = false }: { openWorld?: boolean }) {
  const routeProduct = openWorld ? 'text-open-world' as const : 'text-adventure' as const
  const base = openWorld ? 'openworld' : 'adventure'
  const title = openWorld ? '文字开放世界' : '文字冒险'
  const { pageId: routePageId } = useParams<{ pageId?: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const pageId = routePageId ?? (openWorld ? 'runtime' : 'library')
  const page = ADVENTURE_PAGE[pageId] ?? ADVENTURE_PAGE.library
  const queryMode = params.get('mode') === 'production' ? 'production' : null
  const encodedHandoff = params.get('worldHandoff')
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState('')
  const mode: PageMode = encodedHandoff || queryMode ? 'production' : page.mode
  const [lastAdventureWorkspace, setLastAdventureWorkspace] = useState(readAdventureWorkspace)
  const [workOwners, setWorkOwners] = useState<Array<{ id?: number; projectId: number; worldId: number }>>([])
  const session = Number(params.get('session')) || null
  const [handoff, setHandoff] = useState<ProductProductionHandoffV1 | null>(null)
  const activeWorldGroupId = useWorldGroupStore(state => state.activeGroupId)
  const settingsReturn = useMemo(
    () => parseTextOpenWorldSettingsReturnV1(location.state),
    [location.state],
  )

  useEffect(() => {
    const subscription = liveQuery(() => db.projects.toArray()).subscribe({
      next: setProjects,
      error: cause => setError(String(cause)),
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (openWorld) return
    const subscription = liveQuery(() => db.works.toArray()).subscribe({
      next: rows => setWorkOwners(rows.map(({ id, projectId, worldId }) => ({ id, projectId, worldId }))),
      error: cause => setError(String(cause)),
    })
    return () => subscription.unsubscribe()
  }, [openWorld])

  const returnProjectId = settingsReturn?.sourceKind === 'novel'
    ? settingsReturn.activeWorkProjectId
    : settingsReturn?.activeWorldProjectId
  const remembered = !openWorld && !params.has('project') && !encodedHandoff ? lastAdventureWorkspace : null
  const requestedProjectId = Number(params.get('project')) || returnProjectId || remembered?.projectId || 0
  const project = projects.find(candidate => candidate.id === requestedProjectId)
  const projectId = project?.id
  const workId = Number(params.get('work')) || remembered?.workId || project?.activeWorkId
  const worldId = project?.activeWorldId
  const scope = useMemo<WorkspaceScope | undefined>(() => (
    projectId != null && workId != null && worldId != null
      && (openWorld || workOwners.some(work => work.id === workId && work.projectId === projectId && work.worldId === worldId))
      ? { projectId, worldId, workId }
      : undefined
  ), [projectId, worldId, workId, openWorld, workOwners])

  useEffect(() => {
    if (!openWorld && scope) {
      rememberAdventureWorkspace(scope)
      setLastAdventureWorkspace(current => current?.projectId === scope.projectId && current.worldId === scope.worldId && current.workId === scope.workId ? current : scope)
    }
  }, [openWorld, scope])
  const worldProject = projects.find(candidate => candidate.id === settingsReturn?.activeWorldProjectId)
    ?? (settingsReturn?.sourceKind === 'novel' || project?.workspacePurpose !== 'world-engine' ? undefined : project)
  const novelProject = projects.find(candidate => candidate.id === settingsReturn?.activeWorkProjectId)
    ?? (settingsReturn?.sourceKind === 'world-release' || project?.workspacePurpose !== 'independent-work' ? undefined : project)
  const worldScope = scopeForProject(worldProject)
  const novelScope = scopeForProject(novelProject)
  const creatorSourceReady = openWorld && mode === 'production' && Boolean(worldScope || novelScope)
  const initialCreatorSource = settingsReturn?.sourceKind
    ?? (project?.workspacePurpose === 'independent-work' ? 'novel' : 'world-release')

  const decision = evaluateProductEntryV1({
    productId: openWorld ? 'upper.text-open-world' : 'upper.text-adventure',
    channel: currentProductCatalogChannelV1(),
    experimentalOptIn: currentExperimentalProductOptInV1(),
  })

  useEffect(() => {
    let active = true
    setHandoff(null)
    if (!encodedHandoff) return () => { active = false }
    void (async () => {
      const parsed = parseProductProductionHandoffV1(JSON.parse(encodedHandoff))
      if (parsed.productType !== routeProduct) throw new Error('交接产品不匹配')
      const release = await db.worldReleases.get(parsed.worldReleaseId)
      if (!release || release.contentHash !== parsed.worldContentHash) {
        throw new Error('交接世界版本不存在或已变化')
      }
      if (!active) return
      setHandoff(parsed)
      if (!params.has('project')) {
        const next = new URLSearchParams(params)
        next.set('project', String(release.projectId))
        navigate({ search: next.toString() }, { replace: true })
      }
    })().catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [encodedHandoff, navigate, params, routeProduct])

  const productionDecision = evaluateProductPlatformCapabilityV1('product-production-v3', {
    environment: currentProductPlatformEnvironmentV1(),
    experimentalProject: false,
    authorOptIn: project?.productPlatformOptIns?.productProductionV3 === true,
    onlineServiceConfigured: false,
    aiGmBetaGatePassed: currentAiGmBetaGatePassedV1(),
  })

  const workspacePath = (nextPage: string, extra?: {
    session?: number | null; mode?: PageMode; scope?: WorkspaceScope
  }) => {
    const next = new URLSearchParams()
    const nextProjectId = extra?.scope?.projectId ?? projectId
    const nextWorkId = extra?.scope?.workId ?? workId
    if (nextProjectId != null) next.set('project', String(nextProjectId))
    if (nextWorkId != null) next.set('work', String(nextWorkId))
    const nextSession = extra?.session === undefined ? session : extra.session
    if (nextSession != null) next.set('session', String(nextSession))
    if (openWorld && extra?.mode) next.set('mode', extra.mode)
    const search = next.toString()
    return `/${base}/${nextPage}${search ? `?${search}` : ''}`
  }

  const navigation = openWorld
    ? [
        { label: '玩家', path: workspacePath('runtime', { mode: 'play' }), active: mode === 'play' },
        { label: '制作', path: workspacePath('runtime', { mode: 'production' }), active: mode === 'production' },
        { label: '通用设置', path: '/settings' },
      ]
    : [
        { label: '作品与试玩', path: workspacePath('library', { session: null }), active: pageId === 'library' },
        { label: '产品定向', path: workspacePath('vision', { session: null }), active: ['vision', 'systems'].includes(pageId) },
        { label: '自动制作', path: workspacePath('production', { session: null }), active: ['production', 'map', 'actions', 'quests'].includes(pageId) },
        { label: '质量与素材', path: workspacePath('review', { session: null }), active: ['review', 'media-all'].includes(pageId) },
        { label: '发布与导出', path: workspacePath('release', { session: null }), active: pageId === 'release' },
        { label: '开始冒险', path: workspacePath('play'), active: ['play', 'playmap', 'history'].includes(pageId) },
        { label: '通用设置', path: '/settings' },
      ]

  const chooseProject = (nextProjectId: string) => {
    const next = new URLSearchParams()
    next.set('project', nextProjectId)
    if (!openWorld && !nextProjectId) { rememberAdventureWorkspace(null); setLastAdventureWorkspace(null) }
    navigate({ pathname: `/${base}/${pageId}`, search: next.toString() })
    setHandoff(null)
  }

  const openPlayer = (nextSession: number | null, playerScope?: WorkspaceScope) => {
    navigate(workspacePath(openWorld ? 'runtime' : 'play', {
      session: nextSession,
      mode: 'play',
      scope: playerScope,
    }))
  }

  const openCreatorSettings = (target: TextOpenWorldCreatorBriefResumeTargetV1) => {
    const creatorReturn: TextOpenWorldSettingsReturnV1 = {
      schema: 'storyforge.text-open-world-settings-return',
      version: 1,
      activeWorkProjectId: novelProject?.id ?? null,
      activeWorldProjectId: worldProject?.id ?? null,
      sourceKind: target.sourceBinding.kind,
      ...target,
    }
    navigate('/settings', { state: { storyforgeProductHubReturn: creatorReturn } })
  }

  const adventureFrame = (children: ReactNode) => <AdventureProductFrame
    projects={projects} projectId={projectId} producing={mode === 'production'} page={page.label}
    libraryPath={workspacePath('library', { session: null })}
    productionPath={workspacePath('production', { session: null })}
    navigation={navigation} onChooseProject={chooseProject}
  >{children}</AdventureProductFrame>

  if (!openWorld && mode === 'play') return adventureFrame(<>
    {error && <p role="alert">{error}</p>}
    {decision.enterable && scope && project ? <ErrorBoundary key={`${scope.projectId}:${scope.worldId}:${scope.workId}`}><Suspense fallback={<p className="adventure-page-loading">正在打开故事书…</p>}>
      <AdventureGamePlayer key={scope.workId} project={project} scope={scope}
        worldGroupId={project.enableMultiWorld ? activeWorldGroupId : null} initialSessionId={session}
        onOpenSession={openPlayer}
        onOpenLibrary={() => navigate(workspacePath('library', { session: null }))} />
    </Suspense></ErrorBoundary> : <div className="adventure-page-empty"><span className="adventure-eyebrow">STORYFORGE / INTERACTIVE FICTION</span><p>每一个选择，都是故事的起点。选择一个工作区，打开其中的文字冒险作品。</p></div>}
  </>)

  const studio = <>
    <section className="lf-paper">
      <h3>{title} · {openWorld ? '展示作品与创作' : '可验证预览'}</h3>
      <p>{decision.entry.maturityNote}</p>
      {openWorld && <div className="home-actions">
        <button className="lf-action lf-action-primary" onClick={() => navigate('/play/salt-ridge')}>
          先试玩《盐脊：断流之夜》
        </button>
        <small>无需选择工作区或配置模型；首次开始会建立独立的正式发布与存档。</small>
      </div>}
      {!decision.enterable
        ? <p>当前产品通道尚未开放此入口。</p>
        : openWorld && <label>
            选择创作工作区
            <select aria-label="创作工作区" value={projectId ?? ''} onChange={event => chooseProject(event.target.value)}>
              <option value="">请选择</option>
              {projects.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>}
    </section>
    {openWorld && mode === 'play' && <section className="lf-paper">
      <h2>内置叙事游戏</h2>
      <p>三段可以亲自走进的故事。无需配置 API，选择作品后即可开始；进度保存在当前浏览器。</p>
      <BuiltinGameShelf />
    </section>}
    {error && <p role="alert">{error}</p>}
    {decision.enterable && !error && (creatorSourceReady || (scope && project)) && <section className="lf-paper">
      <Suspense fallback={<p>正在读取…</p>}>
        {mode === 'production'
          ? openWorld
            ? <TextOpenWorldCreatorWorkflow
                key={`${initialCreatorSource}:${handoff?.worldReleaseId ?? 'none'}:${handoff?.worldContentHash ?? 'none'}`}
                worldScope={worldScope ?? null}
                novelScope={novelScope ?? null}
                worldGroupId={worldProject?.enableMultiWorld ? activeWorldGroupId : null}
                initialSource={handoff}
                initialSourceKind={initialCreatorSource}
                initialView={settingsReturn ? 'readiness' : 'brief'}
                initialResumeTarget={settingsReturn}
                onOpenSettings={openCreatorSettings}
                onPreviewStarted={(creatorScope, id) => openPlayer(id, creatorScope)}
                onPublished={creatorScope => openPlayer(null, creatorScope)}
              />
            : productionDecision.enabled
            ? <ProductProductionStudio
                scope={scope!}
                worldGroupId={project!.enableMultiWorld ? activeWorldGroupId : null}
                allowedProducts={[routeProduct]}
                initialProduct={routeProduct}
                initialSource={handoff}
                authorOptIn={project!.productPlatformOptIns?.productProductionV3 === true}
                view={page.studioView ?? 'production'}
                onPublished={() => openPlayer(null)}
                onPreviewStarted={(_, id) => openPlayer(id)}
              />
            : <div>
                <h3>自动游戏制作需要项目授权</h3>
                <p>{productionDecision.blockers.join('；')}</p>
                <button
                  className="lf-action"
                  onClick={() => void updateWorkspace(project!.id!, {
                    productPlatformOptIns: {
                      ...project!.productPlatformOptIns,
                      productProductionV3: true,
                    },
                  }).catch(cause => setError(String(cause)))}
                >
                  为当前项目显式启用
                </button>
              </div>
          : <TextOpenWorldPlayer
              key={`${scope!.projectId}:${scope!.worldId}:${scope!.workId}`}
              project={project!} scope={scope!}
              worldGroupId={project!.enableMultiWorld ? activeWorldGroupId : null}
              initialSessionId={session}
              onSessionSelected={selectedSessionId => {
                const next = new URLSearchParams(params)
                if (selectedSessionId == null) next.delete('session')
                else next.set('session', String(selectedSessionId))
                navigate({ search: next.toString() }, { replace: true, state: location.state })
              }}
            />}
      </Suspense>
    </section>}
    {decision.enterable && !error && openWorld && mode === 'production' && !creatorSourceReady && <section className="lf-paper" data-testid="text-open-world-source-empty">
      <h3>小说或世界来源工作区归属尚未就绪</h3>
      <p>请选择已初始化的独立小说作品，或从世界引擎交接一个冻结 WorldRelease。</p>
    </section>}
  </>
  return openWorld
    ? <ProductFrame product={base} title={title} page={page.label} navigation={navigation}>{studio}</ProductFrame>
    : adventureFrame(<ErrorBoundary key={`${pageId}:${projectId}:${workId}`}>{studio}</ErrorBoundary>)
}
