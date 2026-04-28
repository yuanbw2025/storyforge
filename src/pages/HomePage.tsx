import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, BookOpen, Flame, Settings, Github } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import type { NovelGenre, CreateProjectInput } from '../lib/types'

const GENRE_LABELS: Record<NovelGenre, string> = {
  xuanhuan: '玄幻',
  xianxia: '仙侠',
  dushi: '都市',
  lishi: '历史',
  kehuan: '科幻',
  qihuan: '奇幻',
  wuxia: '武侠',
  other: '其他',
}

export default function HomePage() {
  const navigate = useNavigate()
  const { projects, loading, loadProjects, createProject, deleteProject } = useProjectStore()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateProjectInput>({
    name: '',
    genre: 'xuanhuan',
    description: '',
    targetWordCount: 500000,
  })

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const handleCreate = async () => {
    if (!form.name.trim()) return
    const id = await createProject(form)
    setShowCreate(false)
    setForm({ name: '', genre: 'xuanhuan', description: '', targetWordCount: 500000 })
    navigate(`/workspace/${id}`)
  }

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    if (confirm('确定要删除这个项目吗？所有数据将不可恢复。')) {
      await deleteProject(id)
    }
  }

  return (
    <div data-theme="forge" className="min-h-screen bg-bg-base">
      {/* 顶栏 */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-6 h-6 text-accent" />
          <h1 className="text-xl font-bold text-text-primary">StoryForge</h1>
          <span className="text-text-muted text-sm ml-1">故事熔炉</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/workspace/settings')}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="设置"
          >
            <Settings className="w-5 h-5" />
          </button>
          <a
            href="https://github.com/yuanbw2025/my-website"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="GitHub"
          >
            <Github className="w-5 h-5" />
          </a>
        </div>
      </header>

      {/* 主体 */}
      <main className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-bold text-text-primary mb-6">我的项目</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* 新建项目卡片 */}
          <button
            onClick={() => setShowCreate(true)}
            className="border-2 border-dashed border-border hover:border-accent rounded-xl p-6 flex flex-col items-center justify-center gap-3 min-h-[180px] transition-colors group"
          >
            <Plus className="w-10 h-10 text-text-muted group-hover:text-accent transition-colors" />
            <span className="text-text-secondary group-hover:text-accent font-medium transition-colors">
              新建项目
            </span>
          </button>

          {/* 项目卡片列表 */}
          {loading ? (
            <div className="col-span-2 flex items-center justify-center py-20">
              <span className="text-text-muted">加载中...</span>
            </div>
          ) : (
            projects.map((project) => (
              <div
                key={project.id}
                onClick={() => navigate(`/workspace/${project.id}`)}
                className="bg-bg-surface border border-border rounded-xl p-5 cursor-pointer hover:border-accent/50 hover:bg-bg-elevated transition-all group relative"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-accent" />
                    <h3 className="font-semibold text-text-primary truncate">{project.name}</h3>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, project.id!)}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-error/20 text-text-muted hover:text-error transition-all"
                    title="删除项目"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-accent/10 text-accent mb-2">
                  {GENRE_LABELS[project.genre]}
                </span>
                <p className="text-text-secondary text-sm line-clamp-2 mb-3">
                  {project.description || '暂无简介'}
                </p>
                <div className="text-text-muted text-xs">
                  目标 {(project.targetWordCount / 10000).toFixed(0)} 万字 · 
                  更新于 {new Date(project.updatedAt).toLocaleDateString('zh-CN')}
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* 创建项目对话框 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-bg-surface border border-border rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-text-primary mb-5">创建新项目</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">项目名称 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：《斗破苍穹》"
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">类型</label>
                <select
                  value={form.genre}
                  onChange={(e) => setForm({ ...form, genre: e.target.value as NovelGenre })}
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
                >
                  {Object.entries(GENRE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">简介</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="一句话描述你的故事..."
                  rows={3}
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors resize-none"
                />
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">
                  目标字数：{(form.targetWordCount / 10000).toFixed(0)} 万字
                </label>
                <input
                  type="range"
                  min={100000}
                  max={3000000}
                  step={100000}
                  value={form.targetWordCount}
                  onChange={(e) => setForm({ ...form, targetWordCount: Number(e.target.value) })}
                  className="w-full accent-accent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim()}
                className="px-5 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
