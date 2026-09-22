import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
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
  const [mode, setMode] = useState<PageMode>(() => encodedHandoff || queryMode ? 'production' : page.mode)
  const [session, setSession] = useState<number | null>(Number(params.get('session')) || null)
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
    if (!encodedHandoff) setMode(queryMode ?? page.mode)
  }, [encodedHandoff, page.mode, queryMode])

  useEffect(() => {
    setSession(Number(params.get('session')) || null)
  }, [params])

  const returnProjectId = settingsReturn?.sourceKind === 'novel'
    ? settingsReturn.activeWorkProjectId
    : settingsReturn?.activeWorldProjectId
  const requestedProjectId = Number(params.get('project')) || returnProjectId || 0
  const project = projects.find(candidate => candidate.id === requestedProjectId)
  const projectId = project?.id
  const workId = Number(params.get('work')) || project?.activeWorkId
  const worldId = project?.activeWorldId
  const scope = useMemo<WorkspaceScope | undefined>(() => (
    projectId != null && workId != null && worldId != null
      ? { projectId, worldId, workId }
      : undefined
  ), [projectId, worldId, workId])
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
      setMode('production')
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

  const workspacePath = (nextPage: string, extra?: { session?: number | null; mode?: PageMode }) => {
    const next = new URLSearchParams()
    if (projectId != null) next.set('project', String(projectId))
    if (workId != null) next.set('work', String(workId))
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
    if (nextProjectId) next.set('project', nextProjectId)
    navigate({ pathname: `/${base}/${pageId}`, search: next.toString() })
    setSession(null)
    setHandoff(null)
  }

  const openPlayer = (nextSession: number | null) => {
    setSession(nextSession)
    setMode('play')
    navigate(workspacePath(openWorld ? 'runtime' : 'play', {
      session: nextSession,
      mode: 'play',
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

  return <ProductFrame product={base} title={title} page={page.label} navigation={navigation}>
    <section className="lf-paper">
      <h3>{title} · 可验证预览</h3>
      <p>{decision.entry.maturityNote}</p>
      {!decision.enterable
        ? <p>当前产品通道尚未开放此入口。</p>
        : <label>
            选择创作工作区
            <select aria-label="创作工作区" value={projectId ?? ''} onChange={event => chooseProject(event.target.value)}>
              <option value="">请选择</option>
              {projects.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>}
    </section>
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
          : openWorld
            ? <TextOpenWorldPlayer
                key={`${scope!.workId}:${session}`}
                project={project!}
                scope={scope!}
                worldGroupId={project!.enableMultiWorld ? activeWorldGroupId : null}
                initialSessionId={session}
              />
            : <AdventureGamePlayer
                key={`${scope!.workId}:${session}`}
                project={project!}
                scope={scope!}
                worldGroupId={project!.enableMultiWorld ? activeWorldGroupId : null}
                initialSessionId={session}
              />}
      </Suspense>
    </section>}
    {decision.enterable && !error && openWorld && mode === 'production' && !creatorSourceReady && <section className="lf-paper" data-testid="text-open-world-source-empty">
      <h3>小说或世界来源工作区归属尚未就绪</h3>
      <p>请选择已初始化的独立小说作品，或从世界引擎交接一个冻结 WorldRelease。</p>
    </section>}
  </ProductFrame>
}
