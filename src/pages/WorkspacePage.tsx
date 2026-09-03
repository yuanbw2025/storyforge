import { useCallback, useEffect, useRef, useState, useMemo, lazy, Suspense } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useProjectStore } from '../stores/project'
import { useWorldviewStore } from '../stores/worldview'
import { useCharacterStore } from '../stores/character'
import { useOutlineStore } from '../stores/outline'
import { useChapterStore } from '../stores/chapter'
import { useForeshadowStore } from '../stores/foreshadow'
import { useGeographyStore } from '../stores/project-singletons'
import { useHistoryStore } from '../stores/project-singletons'
import { useCreativeRulesStore } from '../stores/project-singletons'
import { useCharacterRelationStore } from '../stores/character-relation'
import { useReferenceStore } from '../stores/reference'
import { useEmotionBeatStore } from '../stores/emotion-beat'
import { useWorldRulesStore } from '../stores/world-rules'
import { useAutoBackup } from '../hooks/useAutoBackup'
import { useGistAutoBackup } from '../hooks/useGistAutoBackup'
import { MessageSquare, PanelRight } from 'lucide-react'
import Sidebar, { type SidebarModule } from '../components/layout/Sidebar'
import ContentTypeBadge from '../components/layout/ContentTypeBadge'
import { getModuleContentType, MODULE_CONTENT_TYPES } from '../components/layout/sidebar-tree'
import PropertiesPanel from '../components/layout/PropertiesPanel'
import ProjectInfoPanel from '../components/project/ProjectInfoPanel'
// 旧「作品学习」面板已整合进 ReferencePanel（Phase 20，子系统于 v32 下线）
const ReferencePanel = lazy(() => import('../components/project/ReferencePanel'))
const SettingsPage = lazy(() => import('../components/settings/SettingsPage'))
const UsageStatsPage = lazy(() => import('../components/settings/UsageStatsPage'))
const VersionHistoryPanel = lazy(() => import('../components/system/VersionHistoryPanel'))
const ImportDocPanel = lazy(() => import('../components/system/ImportDocPanel'))
const PromptManagerPanel = lazy(() => import('../components/settings/prompt/PromptManagerPanel'))
const NodeAuthoringWorkspace = lazy(() => import('../components/node-authoring/NodeAuthoringWorkspace'))
const RagLibraryPanel = lazy(() => import('../components/retrieval/RagLibraryPanel'))
const DataManagementPanel = lazy(() => import('../components/data/DataManagementPanel'))
const WorldRulesPanel = lazy(() => import('../components/worldview/WorldRulesPanel'))
const StoryCorePanel = lazy(() => import('../components/worldview/StoryCorePanel'))
const PowerSystemPanel = lazy(() => import('../components/worldview/PowerSystemPanel'))
const WorldviewOriginPanel = lazy(() => import('../components/worldview/WorldviewOriginPanel'))
const WorldviewNaturalPanel = lazy(() => import('../components/worldview/WorldviewNaturalPanel'))
const WorldviewHumanityPanel = lazy(() => import('../components/worldview/WorldviewHumanityPanel'))
const CharacterPanel = lazy(() => import('../components/character/CharacterPanel'))
const CharacterMainPanel = lazy(() => import('../components/character/CharacterMainPanel'))
const CharacterMinorPanel = lazy(() => import('../components/character/CharacterMinorPanel'))
const CharacterNPCPanel = lazy(() => import('../components/character/CharacterNPCPanel'))
const CharacterExtraPanel = lazy(() => import('../components/character/CharacterExtraPanel'))
const OutlinePanel = lazy(() => import('../components/outline/OutlinePanel'))
const DetailedOutlinePanel = lazy(() => import('../components/outline/DetailedOutlinePanel'))
const ChaptersListPanel = lazy(() => import('../components/editor/ChaptersListPanel'))
const ForeshadowPanel = lazy(() => import('../components/foreshadow/ForeshadowPanel'))
const StyleLearningPanel = lazy(() => import('../components/style/StyleLearningPanel'))
const GeographyPanel = lazy(() => import('../components/geography/GeographyPanel'))
const HistoryPanel = lazy(() => import('../components/history/HistoryPanel'))
const CreativeRulesPanel = lazy(() => import('../components/rules/CreativeRulesPanel'))
const CharacterRelationPanel = lazy(() => import('../components/relations/CharacterRelationPanel'))
const WorldMapPanel = lazy(() => import('../components/geography/WorldMapPanel'))
const StatePanel = lazy(() => import('../components/state/StatePanel'))
const StoryArcPanel = lazy(() => import('../components/outline/StoryArcPanel'))
const CharacterDrivenPlotPanel = lazy(() => import('../components/outline/CharacterDrivenPlotPanel'))
const InspirationPanel = lazy(() => import('../components/project/InspirationPanel'))
const LocationPanel = lazy(() => import('../components/location/LocationPanel'))
const InventoryPanel = lazy(() => import('../components/items/InventoryPanel'))
const FactLibraryPanel = lazy(() => import('../components/facts/FactLibraryPanel'))
const StoryTimelinePanel = lazy(() => import('../components/timeline/StoryTimelinePanel'))
const CultivationProgressPanel = lazy(() => import('../components/cultivation/CultivationProgressPanel'))
const SceneVerifyPanel = lazy(() => import('../components/scene/SceneVerifyPanel'))
const WorldGroupOverview = lazy(() => import('../components/world-group/WorldGroupOverview'))
const GlobalReplacePanel = lazy(() => import('../components/tools/GlobalReplacePanel'))
const ChatCopilotPanel = lazy(() => import('../components/agent/ChatCopilotPanel'))
import { useLocationStore } from '../stores/location'
import { useWorldGroupStore } from '../stores/world-group'
import { resolveScopeLike } from '../lib/workspace/scope'
import {
  isImpactHandoffRouteModuleV2,
  parseImpactHandoffV2,
  type ImpactHandoffV2,
} from '../lib/consistency/impact-handoff'
import {
  type CurrentImpactHandoffTargetV2,
} from '../lib/agent/run/impact-handoff-durable'
import {
  beginImpactManualCorrectionV1,
  completeImpactManualCorrectionV1,
} from '../lib/agent/run/impact-manual-correction-durable'
import { executeImpactPostCorrectionReplanV1 } from '../lib/agent/run/impact-post-correction-replan-durable'
import { flushPendingEditsV1 } from '../lib/authoring/pending-edit-coordinator'
import { useToast } from '../components/shared/Toast'
import { useActiveWork } from '../hooks/useActiveWork'
import WorkKindBadge from '../components/work/WorkKindBadge'
import { effectiveNovelProfile, effectiveWorkKind, SHORT_NOVEL_DEFAULT_WORDS } from '../lib/workspace/work-kind'
import { switchNovelProfile } from '../lib/workspace/works'
import { secondaryNovelWorkflowModules } from '../lib/novel/workflow'
import WorldDerivationActions from '../components/world-engine/WorldDerivationActions'

export default function WorkspacePage() {
  const { projectId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const { loadProject, projects, currentProjectId } = useProjectStore()
  const initialModule = new URLSearchParams(location.search).get('module')
  const initialSidebarModule = initialModule && Object.prototype.hasOwnProperty.call(MODULE_CONTENT_TYPES, initialModule)
    ? initialModule as SidebarModule
    : null
  const backPath = '/'
  const [activeModule, setActiveModule] = useState<SidebarModule>(initialSidebarModule ?? 'info')
  const [loading, setLoading] = useState(true)
  const [editorNodeId, setEditorNodeId] = useState<number | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showProperties, setShowProperties] = useState(false)
  const [showCopilot, setShowCopilot] = useState(false)
  const [impactHandoff, setImpactHandoff] = useState<ImpactHandoffV2 | null>(null)
  const [impactHandoffTarget, setImpactHandoffTarget] = useState<CurrentImpactHandoffTargetV2 | null>(null)
  const [impactCorrectionStatus, setImpactCorrectionStatus] = useState<'idle' | 'pending' | 'verifying' | 'completed'>('idle')
  const [impactCorrectionError, setImpactCorrectionError] = useState<string | null>(null)
  const navigationTail = useRef<Promise<void>>(Promise.resolve())
  const [profileSwitching, setProfileSwitching] = useState(false)
  const [profileSwitchError, setProfileSwitchError] = useState('')
  const activeWorldGroupId = useWorldGroupStore(state => state.activeGroupId)
  const worldGroups = useWorldGroupStore(state => state.groups)

  const afterPendingEdits = useCallback((action: () => void, failureMessage: string) => {
    const transition = navigationTail.current
      .catch(() => undefined)
      .then(async () => {
        await flushPendingEditsV1()
        action()
      })
    navigationTail.current = transition
    void transition.catch(error => {
      const detail = error instanceof Error ? error.message : String(error)
      toast.error(`${failureMessage}：${detail}`)
    })
  }, [toast])

  const selectModule = useCallback((module: SidebarModule) => {
    afterPendingEdits(() => {
      setImpactHandoff(null)
      setImpactHandoffTarget(null)
      setActiveModule(module)
      if (module !== 'editor') setEditorNodeId(null)
    }, '当前编辑未能保存，已阻止切换页面')
  }, [afterPendingEdits])

  // 从 Zustand Store 中动态获取当前项目，实现全局响应式更新
  const project = useMemo(() => {
    if (!currentProjectId) return null
    return projects.find(p => p.id === currentProjectId) || null
  }, [projects, currentProjectId])
  const activeWork = useActiveWork(project)

  // 侧栏隐藏模块（多世界关闭时隐藏世界总览）。必须在所有提前 return 之前调用，
  // 否则 hook 数量在不同渲染间不一致，会报 "Rendered more hooks than..."
  const hiddenModules = useMemo(() => {
    const hidden = new Set<SidebarModule>()
    if (!project?.enableMultiWorld) hidden.add('world-overview')
    return hidden
  }, [project?.enableMultiWorld])
  const secondaryModules = useMemo(() => (
    activeWork && effectiveWorkKind(activeWork) === 'novel' && effectiveNovelProfile(activeWork) === 'short'
      ? secondaryNovelWorkflowModules('short')
      : undefined
  ), [activeWork])

  // 自动定时备份（每 5 分钟本地快照）
  useAutoBackup(project?.id ?? null)
  // 云自动备份（开关开启时每 10 分钟推 GitHub Gist）
  useGistAutoBackup(project?.id ?? null)
  // 加载项目 + 所有关联数据
  useEffect(() => {
    if (initialSidebarModule) setActiveModule(initialSidebarModule)
  }, [initialSidebarModule])

  useEffect(() => {
    let active = true
    setImpactHandoff(null)
    setImpactHandoffTarget(null)
    setImpactCorrectionStatus('idle')
    setImpactCorrectionError(null)
    const params = new URLSearchParams(location.search)
    const parsed = parseImpactHandoffV2(params.get('impactHandoff'))
    if (
      !parsed
      || project?.id == null
      || !isImpactHandoffRouteModuleV2(params.get('module'), parsed)
      || activeModule !== parsed.targetModule
    ) return () => { active = false }
    void resolveScopeLike(project.id)
      .then(async scope => {
        const state = await beginImpactManualCorrectionV1({ scope, handoff: parsed })
        if (state.snapshot.projection.state === 'completed') {
          await executeImpactPostCorrectionReplanV1({ scope, handoff: parsed })
        }
        return state
      })
      .then(state => {
        if (active && state) {
          setImpactHandoff(parsed)
          setImpactHandoffTarget(state.baseline.target)
          setImpactCorrectionStatus(state.snapshot.projection.state === 'completed' ? 'completed' : 'pending')
        }
      })
      .catch(error => {
        if (active) console.warn('[ImpactHandoff] 交接证据无效:', error)
      })
    return () => { active = false }
  }, [activeModule, location.search, project?.id])

  const handoffChapterNodeId = useMemo(() => {
    if (!impactHandoff || impactHandoff.targetModule !== 'chapters-list') return null
    return impactHandoffTarget?.moduleRecordId ?? null
  }, [impactHandoff, impactHandoffTarget])

  useEffect(() => {
    const load = async () => {
      if (!projectId || isNaN(Number(projectId))) {
        navigate('/')
        return
      }
      setLoading(true)
      let p
      try {
        p = await loadProject(Number(projectId))
      } catch (err) {
        console.error('[Workspace] loadProject 抛错:', err)
        setLoading(false)
        return
      }
      if (!p) {
        navigate('/')
        return
      }

      // 修复:直链/刷新进入工作区时 projects 列表可能为空(没经首页加载过),
      // 导致 `project = projects.find(...)` 恒为 null、永久卡"加载中"。这里补加载项目列表。
      if (useProjectStore.getState().projects.length === 0) {
        await useProjectStore.getState().loadProjects().catch(() => {})
      }

      // 并行加载所有数据。用 allSettled:任一 store 加载失败也不连累整体、
      // 不会让 setLoading(false) 漏执行而永久卡"加载中"(健壮性,防单点 store 抛错锁死工作区)。
      const pid = p.id!
      const scope = await resolveScopeLike(pid)
      const loaders: { name: string; run: () => Promise<unknown> }[] = [
        { name: 'worldview', run: () => useWorldviewStore.getState().loadAll(scope) },
        { name: 'character', run: () => useCharacterStore.getState().loadAll(scope) },
        { name: 'outline', run: () => useOutlineStore.getState().loadAll(scope) },
        { name: 'chapter', run: () => useChapterStore.getState().loadAll(scope) },
        { name: 'foreshadow', run: () => useForeshadowStore.getState().loadAll(scope) },
        { name: 'geography', run: () => useGeographyStore.getState().loadAll(scope) },
        { name: 'history', run: () => useHistoryStore.getState().loadAll(scope) },
        { name: 'creativeRules', run: () => useCreativeRulesStore.getState().loadAll(scope) },
        { name: 'characterRelation', run: () => useCharacterRelationStore.getState().loadAll(scope) },
        { name: 'reference', run: () => useReferenceStore.getState().loadAll(scope) },
        { name: 'emotionBeat', run: () => useEmotionBeatStore.getState().loadAll(pid) },
        { name: 'location', run: () => useLocationStore.getState().loadAll(scope) },
        { name: 'worldRules', run: () => useWorldRulesStore.getState().loadProfile(scope) },
        { name: 'worldGroup', run: () => useWorldGroupStore.getState().loadAll(scope) },
      ]
      const results = await Promise.allSettled(loaders.map(l => l.run()))
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`[Workspace] ${loaders[i].name} 加载失败:`, r.reason)
      })

      setLoading(false)
    }
    load()
  }, [projectId, loadProject, navigate])

  if (loading || !project) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <span className="text-text-muted">加载中...</span>
      </div>
    )
  }

  const handleOpenChapter = (nodeId: number) => {
    setEditorNodeId(nodeId)
    setActiveModule('chapters-list')
  }

  const handleProfileSwitch = async () => {
    if (!project.id || !activeWork?.id || effectiveWorkKind(activeWork) !== 'novel' || profileSwitching) return
    const next = effectiveNovelProfile(activeWork) === 'short' ? 'long' : 'short'
    setProfileSwitching(true)
    setProfileSwitchError('')
    try {
      await switchNovelProfile({
        projectId: project.id,
        workId: activeWork.id,
        profile: next,
        targetWordCount: next === 'short'
          ? (activeWork.targetWordCount >= 5_000 && activeWork.targetWordCount <= 25_000 ? activeWork.targetWordCount : SHORT_NOVEL_DEFAULT_WORDS)
          : Math.max(activeWork.targetWordCount, 100_000),
      })
      await loadProject(project.id)
      await useProjectStore.getState().loadProjects()
    } catch (cause) {
      setProfileSwitchError(cause instanceof Error ? cause.message : 'Profile 切换失败')
    } finally {
      setProfileSwitching(false)
    }
  }

  const immersiveModules = new Set<SidebarModule>([
    'chapters-list',
    'editor',
    'foreshadow',
    'visual-workflows',
  ])
  const isImmersiveModule = immersiveModules.has(activeModule)
  const copilotWorldGroupId = project.enableMultiWorld ? activeWorldGroupId : null
  const copilotWorldName = project.enableMultiWorld
    ? (worldGroups.find(group => group.id === activeWorldGroupId)?.name ?? '未选择世界')
    : '单世界'

  const handoffTargetLabel = impactHandoff
    ? ({
      'chapters-list': '章节与正文',
      'fact-library': '事实库',
      'state-table': '状态表',
      inventory: '物品栏',
      'story-arc': '故事线',
      'story-timeline': '故事年表',
      relations: '关系网',
      characters: '角色设计',
      'world-rules': '真实与幻想',
      'worldview-origin': '世界起源',
      'worldview-natural': '自然环境',
      'worldview-humanity': '人文环境',
      'power-system': '力量体系',
      'story-design': '故事设计',
      outline: '大纲',
      'detailed-outline': '细纲',
      rules: '创作规则',
      references: '项目参考',
    } as Record<string, string>)[impactHandoff.targetModule]
    : null

  const dismissImpactHandoff = () => {
    setImpactHandoff(null)
    setImpactHandoffTarget(null)
    setImpactCorrectionStatus('idle')
    setImpactCorrectionError(null)
    navigate(`/workspace/${project.id}?module=${activeModule}`, { replace: true })
  }

  const returnFromImpactHandoff = () => {
    if (!impactHandoff) return
    setImpactHandoff(null)
    setImpactHandoffTarget(null)
    setImpactCorrectionStatus('idle')
    setImpactCorrectionError(null)
    setEditorNodeId(impactHandoff.returnNodeId)
    setActiveModule('chapters-list')
    navigate(`/workspace/${project.id}?module=chapters-list`, { replace: true })
  }

  const verifyImpactManualCorrection = async () => {
    if (!impactHandoff || impactCorrectionStatus === 'verifying') return
    setImpactCorrectionStatus('verifying')
    setImpactCorrectionError(null)
    try {
      const scope = await resolveScopeLike(project.id!)
      await completeImpactManualCorrectionV1({ scope, handoff: impactHandoff })
      await executeImpactPostCorrectionReplanV1({ scope, handoff: impactHandoff })
      setImpactCorrectionStatus('completed')
    } catch (error) {
      setImpactCorrectionStatus('pending')
      setImpactCorrectionError(error instanceof Error ? error.message : '人工修正完成验证失败。')
    }
  }

  /** 根据当前模块渲染主面板内容 */
  const renderMainPanel = () => {
    switch (activeModule) {
      case 'info':
        return <ProjectInfoPanel project={project} onUpdate={() => useProjectStore.getState().loadProjects()} />
      case 'references':
        return <ReferencePanel
          project={project}
          initialReferenceId={impactHandoff?.targetModule === 'references' && impactHandoffTarget?.table === 'references'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />
      case 'inspiration':
        return <InspirationPanel project={project} />

      // ── 设定库 - 多世界 ─────────────────────────────────────────────
      case 'world-overview':
        return <WorldGroupOverview project={project} />

      // ── 设定库 - 世界观 ─────────────────────────────────────────────
      case 'world-rules':
        return <WorldRulesPanel
          project={project}
          initialProfileId={impactHandoff?.targetModule === 'world-rules' && impactHandoffTarget?.table === 'worldRules'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />
      case 'worldview-origin':
        return <WorldviewOriginPanel
          project={project}
          initialWorldviewId={impactHandoff?.targetModule === 'worldview-origin' && impactHandoffTarget?.table === 'worldviews'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />
      case 'worldview-natural':
        return <WorldviewNaturalPanel project={project} />
      case 'worldview-humanity':
        return <WorldviewHumanityPanel project={project} onOpenHistory={() => setActiveModule('history')} />
      case 'geography':
        return <GeographyPanel project={project} />
      case 'world-map':
        return <WorldMapPanel project={project} />
      case 'history':
        return <HistoryPanel project={project} />
      case 'power-system':
        return <PowerSystemPanel
          project={project}
          initialRecordTarget={impactHandoff?.targetModule === 'power-system'
            && (impactHandoffTarget?.table === 'powerSystems' || impactHandoffTarget?.table === 'cultivationSystems')
            ? { table: impactHandoffTarget.table, recordId: impactHandoffTarget.moduleRecordId }
            : null}
        />

      // ── 设定库 - 故事设计 ─────────────────────────────────────────
      case 'story-design':
        return <StoryCorePanel
          project={project}
          initialStoryCoreId={impactHandoff?.targetModule === 'story-design' && impactHandoffTarget?.table === 'storyCores'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />

      // ── 设定库 - 角色设计 ──────────────────────────────────────────
      case 'characters':
        return <CharacterPanel
          project={project}
          initialCharacterId={impactHandoff?.targetModule === 'characters' && impactHandoffTarget?.table === 'characters'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />
      case 'characters-main':
        return <CharacterMainPanel project={project} />
      case 'characters-minor':
        return <CharacterMinorPanel project={project} />
      case 'characters-npc':
        return <CharacterNPCPanel project={project} />
      case 'characters-extra':
        return <CharacterExtraPanel project={project} />
      case 'relations':
        return <CharacterRelationPanel
          project={project}
          worldGroupId={copilotWorldGroupId}
          initialRelationId={impactHandoff?.targetModule === 'relations' && impactHandoffTarget?.table === 'characterRelations'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />

      // ── 创作区 ─────────────────────────────────────────────────────
      case 'rules':
        return <CreativeRulesPanel
          project={project}
          initialRulesId={impactHandoff?.targetModule === 'rules' && impactHandoffTarget?.table === 'creativeRules'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />
      case 'outline':
        return <OutlinePanel
          project={project}
          onOpenChapter={handleOpenChapter}
          initialNodeId={impactHandoff?.targetModule === 'outline' && impactHandoffTarget?.table === 'outlineNodes'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />
      case 'character-driven-plot':
        return <CharacterDrivenPlotPanel project={project} worldGroupId={copilotWorldGroupId} />
      case 'visual-workflows':
        return <NodeAuthoringWorkspace project={project} worldGroupId={copilotWorldGroupId} />
      case 'rag-library':
        return <RagLibraryPanel project={project} />
      case 'detailed-outline':
        return <DetailedOutlinePanel
          project={project}
          initialNodeId={impactHandoff?.targetModule === 'detailed-outline'
            ? impactHandoffTarget?.moduleRecordId ?? null
            : null}
        />
      case 'chapters-list':
        return <ChaptersListPanel project={project} initialNodeId={handoffChapterNodeId ?? editorNodeId} />
      case 'editor':
        return <ChaptersListPanel project={project} initialNodeId={handoffChapterNodeId ?? editorNodeId} />
      case 'foreshadow':
        return <ForeshadowPanel project={project} />
      case 'style-learning':
        return <StyleLearningPanel project={project} />
      case 'locations':
        return <LocationPanel project={project} />
      case 'story-arc':
        return <StoryArcPanel
          project={project}
          worldGroupId={copilotWorldGroupId}
          initialRecordTarget={impactHandoff?.targetModule === 'story-arc'
            && (impactHandoffTarget?.table === 'storyArcs'
              || impactHandoffTarget?.table === 'storylineProgress'
              || impactHandoffTarget?.table === 'storylineCrossings')
            ? { table: impactHandoffTarget.table, recordId: impactHandoffTarget.moduleRecordId }
            : null}
        />
      case 'state-table':
        return <StatePanel
          project={project}
          onOpenInventory={() => setActiveModule('inventory')}
          initialStateCardId={impactHandoff?.targetModule === 'state-table' && impactHandoffTarget?.table === 'stateCards'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />
      case 'inventory':
        return <InventoryPanel
          project={project}
          initialEntryId={impactHandoff?.targetModule === 'inventory' && impactHandoffTarget?.table === 'itemLedger'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />
      case 'fact-library':
        return <FactLibraryPanel
          project={project}
          initialFactId={impactHandoff?.targetModule === 'fact-library' && impactHandoffTarget?.table === 'temporalFacts'
            ? impactHandoffTarget.moduleRecordId
            : null}
        />
      case 'story-timeline':
        return <StoryTimelinePanel
          project={project}
          initialEventId={impactHandoff?.targetModule === 'story-timeline' && impactHandoffTarget?.table === 'storyTimelineEvents'
            ? impactHandoffTarget.moduleRecordId
            : null}
          onOpenChapter={(chapterId) => {
            const chapter = useChapterStore.getState().chapters.find(item => item.id === chapterId)
            if (chapter) handleOpenChapter(chapter.outlineNodeId)
          }}
        />
      case 'cultivation-progress':
        return <CultivationProgressPanel project={project} />
      case 'scene-verify':
        return <SceneVerifyPanel project={project} />
      case 'global-replace':
        return <GlobalReplacePanel project={project} />

      // 作品学习已整合进项目参考 → 深度分析 tab（Phase 20）
      case 'master-studies':
        return <ReferencePanel project={project} />

      // ── 提示词库（一级） ───────────────────────────────────────────
      case 'prompts':
        return <PromptManagerPanel project={project} />

      // ── 设置区 ─────────────────────────────────────────────────────
      case 'version-history':
        return <VersionHistoryPanel project={project} />
      case 'import-doc':
        return <ImportDocPanel project={project} onNavigate={(m) => { setActiveModule(m); setEditorNodeId(null) }} />
      case 'settings':
        return <SettingsPage
          project={project}
          onOpenDataManagement={() => { setActiveModule('data-management'); setEditorNodeId(null) }}
        />
      case 'usage-stats':
        return <UsageStatsPage project={project} />
      case 'data-management':
      case 'export':
        return <DataManagementPanel
          project={project}
          onImported={(newId) => navigate(`/workspace/${newId}`)}
          onOpenStorageSettings={() => { setActiveModule('settings'); setEditorNodeId(null) }}
        />
      default:
        return null
    }
  }

  return (
    <div className="h-screen bg-bg-base flex overflow-hidden">
      {/* 左侧导航 */}
      <Sidebar
        active={activeModule}
        onSelect={selectModule}
        onBack={() => afterPendingEdits(() => navigate(backPath), '当前编辑未能保存，已阻止离开工作区')}
        projectName={project.name}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        hiddenModules={hiddenModules}
        secondaryModules={secondaryModules}
      />

      {/* 主面板 */}
      <main
        className={`relative flex min-w-0 flex-1 flex-col overflow-hidden ${
          isImmersiveModule
            ? 'bg-[radial-gradient(circle_at_top_left,var(--border-subtle)_1px,transparent_1px)] [background-size:32px_32px]'
            : ''
        }`}
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-bg-surface/70 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <ContentTypeBadge contentType={getModuleContentType(activeModule)} showDescription />
            {activeWork && <WorkKindBadge work={activeWork} />}
            {activeWork && effectiveWorkKind(activeWork) === 'novel' && (
              <button
                type="button"
                onClick={() => void handleProfileSwitch()}
                disabled={profileSwitching}
                className="rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover disabled:opacity-50"
              >
                {profileSwitching ? '切换中…' : effectiveNovelProfile(activeWork) === 'short' ? '扩写为长篇' : '切换为短篇'}
              </button>
            )}
            {profileSwitchError && <span className="max-w-72 truncate text-[11px] text-red-600" title={profileSwitchError}>{profileSwitchError}</span>}
          </div>
          <div className="flex items-center gap-1">
            <WorldDerivationActions
              project={project}
              compact
              onDerived={targetProjectId => navigate(`/workspace/${targetProjectId}?module=info`)}
            />
            <button
              onClick={() => {
                setShowCopilot(value => {
                  if (!value) setShowProperties(false)
                  return !value
                })
              }}
              title={showCopilot ? '关闭 AI 对话副驾' : '打开 AI 对话副驾'}
              aria-label={showCopilot ? '关闭 AI 对话副驾' : '打开 AI 对话副驾'}
              className={`shrink-0 rounded p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary ${showCopilot ? 'text-accent' : ''}`}
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setShowProperties(value => {
                  if (!value) setShowCopilot(false)
                  return !value
                })
              }}
              title={showProperties ? '关闭属性面板' : '打开属性面板'}
              aria-label={showProperties ? '关闭属性面板' : '打开属性面板'}
              className={`shrink-0 rounded p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary ${showProperties ? 'text-accent' : ''}`}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        {impactHandoff && (
          <div className="shrink-0 border-b border-amber-400/25 bg-amber-400/5 px-4 py-2 text-xs text-text-secondary">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-amber-200">影响项需要人工处理</span>
              <span>已打开：{handoffTargetLabel ?? impactHandoff.targetModule}</span>
              <span className="text-text-muted">{impactHandoff.table}#{impactHandoff.recordId ?? '待定'} · 计划 {impactHandoff.planHash.slice(0, 12)}</span>
              <span className={impactCorrectionStatus === 'completed' ? 'text-emerald-300' : 'text-amber-200'}>
                {impactCorrectionStatus === 'completed' ? '修正已验证并重新规划' : '等待保存后验证'}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {impactCorrectionStatus !== 'completed' && (
                  <button
                    type="button"
                    onClick={() => { void verifyImpactManualCorrection() }}
                    disabled={impactCorrectionStatus === 'verifying'}
                    className="rounded border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-300/15 disabled:cursor-wait disabled:opacity-60"
                  >
                    {impactCorrectionStatus === 'verifying' ? '正在验证…' : '验证已保存修正'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={returnFromImpactHandoff}
                  className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary"
                >
                  返回来源章节
                </button>
                <button
                  type="button"
                  onClick={dismissImpactHandoff}
                  className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary"
                >
                  关闭交接提示
                </button>
              </span>
            </div>
            <p className="mt-1 text-[10px] text-text-muted">
              这是受当前正文、影响计划和正式目标 pre-state 约束的人工交接。请先在现有模块按原流程保存，再验证修正；导航或仅打开记录不会被视为完成。
            </p>
            {impactCorrectionError && (
              <p role="alert" className="mt-1 text-[10px] text-rose-300">{impactCorrectionError}</p>
            )}
          </div>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto ${isImmersiveModule ? '' : 'p-6'}`}>
          {/* Phase 3.5: 懒加载面板(地图类)加载时显示 fallback */}
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-text-muted text-sm">面板加载中…</div>}>
            {renderMainPanel()}
          </Suspense>
        </div>
      </main>

      {/* 右侧属性面板 */}
      {showProperties && (
        <PropertiesPanel
          activeModule={activeModule}
          onClose={() => setShowProperties(false)}
        />
      )}
      {showCopilot && (
        <Suspense fallback={(
          <aside className="fixed inset-y-0 right-0 z-30 flex h-full w-[min(24rem,calc(100vw-3rem))] shrink-0 items-center justify-center border-l border-border bg-bg-surface text-xs text-text-muted shadow-xl lg:static lg:z-auto lg:w-[24rem] lg:shadow-none">
            AI 对话副驾加载中…
          </aside>
        )}>
          <ChatCopilotPanel
            project={project}
            worldGroupId={copilotWorldGroupId}
            worldName={copilotWorldName}
            onClose={() => setShowCopilot(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
