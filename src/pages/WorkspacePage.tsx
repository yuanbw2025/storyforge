import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProjectStore } from '../stores/project'
import { useWorldviewStore } from '../stores/worldview'
import { useCharacterStore } from '../stores/character'
import { useOutlineStore } from '../stores/outline'
import { useChapterStore } from '../stores/chapter'
import { useForeshadowStore } from '../stores/foreshadow'
import Sidebar, { type SidebarModule } from '../components/layout/Sidebar'
import ProjectInfoPanel from '../components/project/ProjectInfoPanel'
import AIConfigPanel from '../components/settings/AIConfigPanel'
import WorldviewPanel from '../components/worldview/WorldviewPanel'
import StoryCorePanel from '../components/worldview/StoryCorePanel'
import PowerSystemPanel from '../components/worldview/PowerSystemPanel'
import CharacterPanel from '../components/character/CharacterPanel'
import FactionPanel from '../components/faction/FactionPanel'
import OutlinePanel from '../components/outline/OutlinePanel'
import ChapterEditor from '../components/editor/ChapterEditor'
import ForeshadowPanel from '../components/foreshadow/ForeshadowPanel'
import type { Project } from '../lib/types'

export default function WorkspacePage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { loadProject } = useProjectStore()
  const [project, setProject] = useState<Project | null>(null)
  const [activeModule, setActiveModule] = useState<SidebarModule>('info')
  const [loading, setLoading] = useState(true)
  const [editorNodeId, setEditorNodeId] = useState<number | null>(null)

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
      case 'worldview':
        return <WorldviewPanel project={project} />
      case 'story-core':
        return <StoryCorePanel project={project} />
      case 'characters':
        return <CharacterPanel project={project} />
      case 'factions':
        return <FactionPanel project={project} />
      case 'power-system':
        return <PowerSystemPanel project={project} />
      case 'outline':
        return <OutlinePanel project={project} onOpenChapter={handleOpenChapter} />
      case 'editor':
        return <ChapterEditor project={project} outlineNodeId={editorNodeId} />
      case 'foreshadow':
        return <ForeshadowPanel project={project} />
      case 'settings':
        return <AIConfigPanel />
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
      />

      {/* 主面板 */}
      <main className="flex-1 overflow-y-auto p-6">
        {renderMainPanel()}
      </main>
    </div>
  )
}
