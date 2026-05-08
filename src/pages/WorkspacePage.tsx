import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProjectStore } from '../stores/project'
import { useWorldviewStore } from '../stores/worldview'
import { useCharacterStore } from '../stores/character'
import { useOutlineStore } from '../stores/outline'
import { useChapterStore } from '../stores/chapter'
import { useForeshadowStore } from '../stores/foreshadow'
import { useGeographyStore } from '../stores/geography'
import { useHistoryStore } from '../stores/history'
import { useItemSystemStore } from '../stores/item-system'
import { useCreativeRulesStore } from '../stores/creative-rules'
import { useCharacterRelationStore } from '../stores/character-relation'
import { useReferenceStore } from '../stores/reference'
import { useAutoBackup } from '../hooks/useAutoBackup'
import { PanelRight } from 'lucide-react'
import Sidebar, { type SidebarModule } from '../components/layout/Sidebar'
import PropertiesPanel from '../components/layout/PropertiesPanel'
import ProjectInfoPanel from '../components/project/ProjectInfoPanel'
import ReferencePanel from '../components/project/ReferencePanel'
import SettingsPage from '../components/settings/SettingsPage'
import VersionHistoryPanel from '../components/system/VersionHistoryPanel'
import ImportDocPanel from '../components/system/ImportDocPanel'
import PromptManagerPanel from '../components/settings/prompt/PromptManagerPanel'
import DataManagementPanel from '../components/data/DataManagementPanel'
import WorldviewPanel from '../components/worldview/WorldviewPanel'
import StoryCorePanel from '../components/worldview/StoryCorePanel'
import PowerSystemPanel from '../components/worldview/PowerSystemPanel'
import WorldviewOriginPanel from '../components/worldview/WorldviewOriginPanel'
import WorldviewNaturalPanel from '../components/worldview/WorldviewNaturalPanel'
import WorldviewHumanityPanel from '../components/worldview/WorldviewHumanityPanel'
import CharacterPanel from '../components/character/CharacterPanel'
import CharacterMinorPanel from '../components/character/CharacterMinorPanel'
import CharacterNPCPanel from '../components/character/CharacterNPCPanel'
import CharacterExtraPanel from '../components/character/CharacterExtraPanel'
import FactionPanel from '../components/faction/FactionPanel'
import OutlinePanel from '../components/outline/OutlinePanel'
import DetailedOutlinePanel from '../components/outline/DetailedOutlinePanel'
import ChapterEditor from '../components/editor/ChapterEditor'
import ChaptersListPanel from '../components/editor/ChaptersListPanel'
import ForeshadowPanel from '../components/foreshadow/ForeshadowPanel'
import GeographyPanel from '../components/geography/GeographyPanel'
import HistoryPanel from '../components/history/HistoryPanel'
import ItemSystemPanel from '../components/items/ItemSystemPanel'
import CreativeRulesPanel from '../components/rules/CreativeRulesPanel'
import CharacterRelationPanel from '../components/relations/CharacterRelationPanel'
import type { Project } from '../lib/types'

export default function WorkspacePage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { loadProject } = useProjectStore()
  const [project, setProject] = useState<Project | null>(null)
  const [activeModule, setActiveModule] = useState<SidebarModule>('info')
  const [loading, setLoading] = useState(true)
  const [editorNodeId, setEditorNodeId] = useState<number | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showProperties, setShowProperties] = useState(false)

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
      setProject(p)

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
        useItemSystemStore.getState().loadAll(pid),
        useCreativeRulesStore.getState().loadAll(pid),
        useCharacterRelationStore.getState().loadAll(pid),
        useReferenceStore.getState().loadAll(pid),
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
    setActiveModule('editor')
  }

  /** 根据当前模块渲染主面板内容 */
  const renderMainPanel = () => {
    switch (activeModule) {
      case 'info':
        return <ProjectInfoPanel project={project} onUpdate={(p) => setProject(p)} />
      case 'references':
        return <ReferencePanel project={project} />

      // ── 设定库 - 世界观（v3 §2.1，三个新子模块）─────────────────────
      case 'worldview-origin':
        return <WorldviewOriginPanel project={project} />
      case 'worldview-natural':
        return <WorldviewNaturalPanel project={project} />
      case 'worldview-humanity':
        return <WorldviewHumanityPanel project={project} />
      // 旧入口暂时映射到旧面板（P5/P6 改造时迁移到上面 3 个）
      case 'worldview':
        return <WorldviewPanel project={project} />
      case 'geography':
        return <GeographyPanel project={project} />
      case 'history':
        return <HistoryPanel project={project} />
      case 'items':
        return <ItemSystemPanel project={project} />
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
      case 'factions':
        return <FactionPanel project={project} />

      // ── 创作区 ─────────────────────────────────────────────────────
      case 'rules':
        return <CreativeRulesPanel project={project} />
      case 'outline':
        return <OutlinePanel project={project} onOpenChapter={handleOpenChapter} />
      case 'detailed-outline':
        return <DetailedOutlinePanel project={project} />
      case 'chapters-list':
        return <ChaptersListPanel project={project} onOpenChapter={handleOpenChapter} />
      case 'editor':
        return <ChapterEditor project={project} outlineNodeId={editorNodeId} />
      case 'foreshadow':
        return <ForeshadowPanel project={project} />

      // ── 提示词库（一级） ───────────────────────────────────────────
      case 'prompts':
        return <PromptManagerPanel project={project} />

      // ── 设置区 ─────────────────────────────────────────────────────
      case 'version-history':
        return <VersionHistoryPanel project={project} />
      case 'import-doc':
        return <ImportDocPanel project={project} />
      case 'settings':
        return <SettingsPage />
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
        {renderMainPanel()}
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
