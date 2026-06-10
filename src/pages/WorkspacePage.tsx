import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { PanelRight } from 'lucide-react'
import Sidebar, { type SidebarModule } from '../components/layout/Sidebar'
import PropertiesPanel from '../components/layout/PropertiesPanel'
import ProjectInfoPanel from '../components/project/ProjectInfoPanel'
import ReferencePanel from '../components/project/ReferencePanel'
import SettingsPage from '../components/settings/SettingsPage'
import UsageStatsPage from '../components/settings/UsageStatsPage'
import VersionHistoryPanel from '../components/system/VersionHistoryPanel'
import ImportDocPanel from '../components/system/ImportDocPanel'
import PromptManagerPanel from '../components/settings/prompt/PromptManagerPanel'
// MasterStudiesPanel 已整合进 ReferencePanel（Phase 20）
import DataManagementPanel from '../components/data/DataManagementPanel'
import WorldRulesPanel from '../components/worldview/WorldRulesPanel'
import StoryCorePanel from '../components/worldview/StoryCorePanel'
import PowerSystemPanel from '../components/worldview/PowerSystemPanel'
import WorldviewOriginPanel from '../components/worldview/WorldviewOriginPanel'
import WorldviewNaturalPanel from '../components/worldview/WorldviewNaturalPanel'
import WorldviewHumanityPanel from '../components/worldview/WorldviewHumanityPanel'
import CharacterPanel from '../components/character/CharacterPanel'
import CharacterMinorPanel from '../components/character/CharacterMinorPanel'
import CharacterNPCPanel from '../components/character/CharacterNPCPanel'
import CharacterExtraPanel from '../components/character/CharacterExtraPanel'
import OutlinePanel from '../components/outline/OutlinePanel'
import DetailedOutlinePanel from '../components/outline/DetailedOutlinePanel'
import ChaptersListPanel from '../components/editor/ChaptersListPanel'
import ForeshadowPanel from '../components/foreshadow/ForeshadowPanel'
// Phase 3.5 性能:地图类面板拉 three.js / d3 / azgaar(重),懒加载踢出首屏主包
const GeographyPanel = lazy(() => import('../components/geography/GeographyPanel'))
import HistoryPanel from '../components/history/HistoryPanel'
import CreativeRulesPanel from '../components/rules/CreativeRulesPanel'
import CharacterRelationPanel from '../components/relations/CharacterRelationPanel'
const WorldMapPanel = lazy(() => import('../components/geography/WorldMapPanel'))
import StatePanel from '../components/state/StatePanel'
import StoryArcPanel from '../components/outline/StoryArcPanel'
import CharacterDrivenPlotPanel from '../components/outline/CharacterDrivenPlotPanel'
import InspirationPanel from '../components/project/InspirationPanel'
import LocationPanel from '../components/location/LocationPanel'
import InventoryPanel from '../components/items/InventoryPanel'
import StoryTimelinePanel from '../components/timeline/StoryTimelinePanel'
import SceneVerifyPanel from '../components/scene/SceneVerifyPanel'
import WorldGroupOverview from '../components/world-group/WorldGroupOverview'
import { useLocationStore } from '../stores/location'
import { useWorldGroupStore } from '../stores/world-group'

export default function WorkspacePage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { loadProject, projects, currentProjectId } = useProjectStore()
  const [activeModule, setActiveModule] = useState<SidebarModule>('info')
  const [loading, setLoading] = useState(true)
  const [editorNodeId, setEditorNodeId] = useState<number | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showProperties, setShowProperties] = useState(false)

  // 从 Zustand Store 中动态获取当前项目，实现全局响应式更新
  const project = useMemo(() => {
    if (!currentProjectId) return null
    return projects.find(p => p.id === currentProjectId) || null
  }, [projects, currentProjectId])

  // 侧栏隐藏模块（多世界关闭时隐藏世界总览）。必须在所有提前 return 之前调用，
  // 否则 hook 数量在不同渲染间不一致，会报 "Rendered more hooks than..."
  const hiddenModules = useMemo(() => {
    const hidden = new Set<SidebarModule>()
    if (!project?.enableMultiWorld) hidden.add('world-overview')
    return hidden
  }, [project?.enableMultiWorld])

  // 自动定时备份（每 5 分钟）
  useAutoBackup(project?.id ?? null)

  // 加载项目 + 所有关联数据
  useEffect(() => {
    const load = async () => {
      if (!projectId || isNaN(Number(projectId))) {
        navigate('/')
        return
      }
      setLoading(true)
      const p = await loadProject(Number(projectId))
      if (!p) {
        navigate('/')
        return
      }

      // 并行加载所有数据
      const pid = p.id!
      await Promise.all([
        useWorldviewStore.getState().loadAll(pid),
        useCharacterStore.getState().loadAll(pid),
        useOutlineStore.getState().loadAll(pid),
        useChapterStore.getState().loadAll(pid),
        useForeshadowStore.getState().loadAll(pid),
        useGeographyStore.getState().loadAll(pid),
        useHistoryStore.getState().loadAll(pid),
        // 注:道具系统(C1)/ 势力(C2)的旧表数据已由 DB v29 升级迁移并入词条,旧表已删除,此处无需再迁移。
        useCreativeRulesStore.getState().loadAll(pid),
        useCharacterRelationStore.getState().loadAll(pid),
        useReferenceStore.getState().loadAll(pid),
        useEmotionBeatStore.getState().loadAll(pid),
        useLocationStore.getState().loadAll(pid),
        // Phase 32: 加载世界规则（首次访问自动创建空 profile，兼容旧项目）
        useWorldRulesStore.getState().loadProfile(pid),
        // Phase 25.4: 多世界系统（始终加载，开关由 UI 层控制显隐）
        useWorldGroupStore.getState().loadAll(pid),
      ])

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

  /** 根据当前模块渲染主面板内容 */
  const renderMainPanel = () => {
    switch (activeModule) {
      case 'info':
        return <ProjectInfoPanel project={project} onUpdate={() => useProjectStore.getState().loadProjects()} />
      case 'references':
        return <ReferencePanel project={project} />
      case 'inspiration':
        return <InspirationPanel project={project} />

      // ── 设定库 - 多世界 ─────────────────────────────────────────────
      case 'world-overview':
        return <WorldGroupOverview project={project} />

      // ── 设定库 - 世界观 ─────────────────────────────────────────────
      case 'world-rules':
        return <WorldRulesPanel project={project} />
      case 'worldview-origin':
        return <WorldviewOriginPanel project={project} />
      case 'worldview-natural':
        return <WorldviewNaturalPanel project={project} />
      case 'worldview-humanity':
        return <WorldviewHumanityPanel project={project} />
      case 'geography':
        return <GeographyPanel project={project} />
      case 'world-map':
        return <WorldMapPanel project={project} />
      case 'history':
        return <HistoryPanel project={project} />
      case 'power-system':
        return <PowerSystemPanel project={project} />

      // ── 设定库 - 故事设计 ─────────────────────────────────────────
      case 'story-design':
      case 'story-core':
        return <StoryCorePanel project={project} />

      // ── 设定库 - 角色设计 ──────────────────────────────────────────
      case 'characters':
        return <CharacterPanel project={project} />
      case 'characters-minor':
        return <CharacterMinorPanel project={project} />
      case 'characters-npc':
        return <CharacterNPCPanel project={project} />
      case 'characters-extra':
        return <CharacterExtraPanel project={project} />
      case 'relations':
        return <CharacterRelationPanel project={project} />

      // ── 创作区 ─────────────────────────────────────────────────────
      case 'rules':
        return <CreativeRulesPanel project={project} />
      case 'outline':
        return <OutlinePanel project={project} onOpenChapter={handleOpenChapter} />
      case 'character-driven-plot':
        return <CharacterDrivenPlotPanel project={project} />
      case 'detailed-outline':
        return <DetailedOutlinePanel project={project} />
      case 'chapters-list':
        return <ChaptersListPanel project={project} initialNodeId={editorNodeId} />
      case 'editor':
        return <ChaptersListPanel project={project} initialNodeId={editorNodeId} />
      case 'foreshadow':
        return <ForeshadowPanel project={project} />
      case 'locations':
        return <LocationPanel project={project} />
      case 'story-arc':
        return <StoryArcPanel project={project} />
      case 'state-table':
        return <StatePanel project={project} />
      case 'inventory':
        return <InventoryPanel project={project} />
      case 'story-timeline':
        return <StoryTimelinePanel project={project} />
      case 'scene-verify':
        return <SceneVerifyPanel project={project} />

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
        return <SettingsPage />
      case 'usage-stats':
        return <UsageStatsPage project={project} />
      case 'data-management':
      case 'backup':
      case 'export':
        return <DataManagementPanel project={project} onImported={(newId) => navigate(`/workspace/${newId}`)} />
      default:
        return null
    }
  }

  return (
    <div className="h-screen bg-bg-base flex overflow-hidden">
      {/* 左侧导航 */}
      <Sidebar
        active={activeModule}
        onSelect={(m) => { setActiveModule(m); if (m !== 'editor') setEditorNodeId(null) }}
        onBack={() => navigate('/')}
        projectName={project.name}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        hiddenModules={hiddenModules}
      />

      {/* 主面板 */}
      <main className="flex-1 overflow-y-auto p-6 relative">
        {/* 属性面板切换按钮 */}
        <button
          onClick={() => setShowProperties(v => !v)}
          title={showProperties ? '关闭属性面板' : '打开属性面板'}
          className={`absolute top-4 right-4 p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors z-10 ${showProperties ? 'text-accent' : ''}`}
        >
          <PanelRight className="w-4 h-4" />
        </button>
        {/* Phase 3.5: 懒加载面板(地图类)加载时显示 fallback */}
        <Suspense fallback={<div className="flex items-center justify-center h-64 text-text-muted text-sm">面板加载中…</div>}>
          {renderMainPanel()}
        </Suspense>
      </main>

      {/* 右侧属性面板 */}
      {showProperties && (
        <PropertiesPanel
          activeModule={activeModule}
          onClose={() => setShowProperties(false)}
        />
      )}
    </div>
  )
}
