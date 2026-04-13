import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProjectStore } from '../stores/project'
import Sidebar, { type SidebarModule } from '../components/layout/Sidebar'
import ProjectInfoPanel from '../components/project/ProjectInfoPanel'
import AIConfigPanel from '../components/settings/AIConfigPanel'
import type { Project } from '../lib/types'

export default function WorkspacePage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { loadProject } = useProjectStore()
  const [project, setProject] = useState<Project | null>(null)
  const [activeModule, setActiveModule] = useState<SidebarModule>('info')
  const [loading, setLoading] = useState(true)

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

  /** 根据当前模块渲染主面板内容 */
  const renderMainPanel = () => {
    switch (activeModule) {
      case 'info':
        return <ProjectInfoPanel project={project} onUpdate={(p) => setProject(p)} />
      case 'settings':
        return <AIConfigPanel />
      case 'worldview':
      case 'story-core':
      case 'characters':
      case 'factions':
      case 'power-system':
      case 'outline':
      case 'editor':
      case 'foreshadow':
        return (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-text-muted text-lg mb-2">🚧 {getModuleLabel(activeModule)}</p>
              <p className="text-text-muted text-sm">该模块将在后续 Phase 中开发</p>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="h-screen bg-bg-base flex overflow-hidden">
      {/* 左侧导航 */}
      <Sidebar
        active={activeModule}
        onSelect={setActiveModule}
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

function getModuleLabel(module: SidebarModule): string {
  const labels: Record<SidebarModule, string> = {
    info: '基本信息',
    worldview: '世界观',
    'story-core': '故事核心',
    characters: '角色',
    factions: '势力',
    'power-system': '力量体系',
    outline: '大纲',
    editor: '写作',
    foreshadow: '伏笔',
    settings: '设置',
  }
  return labels[module]
}
