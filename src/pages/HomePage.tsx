import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, BookOpen, Flame, Settings, Github, X, ChevronDown } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import {
  GENRE_OPTIONS, PROJECT_STATUS_LABELS,
  type ProjectStatus, type CreateProjectInput,
} from '../lib/types'

// 按 group 分组
const GENRE_GROUPS = Array.from(
  GENRE_OPTIONS.reduce((map, opt) => {
    if (!map.has(opt.group)) map.set(opt.group, [])
    map.get(opt.group)!.push(opt)
    return map
  }, new Map<string, typeof GENRE_OPTIONS[number][]>())
)

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'drafting',  label: '构思中' },
  { value: 'ongoing',   label: '连载中' },
  { value: 'paused',    label: '暂停' },
  { value: 'completed', label: '已完结' },
]

const EMPTY_FORM = {
  name: '',
  genre: '',
  genres: [] as string[],
  status: 'drafting' as ProjectStatus,
  description: '',
  targetWordCount: 500000,
}

export default function HomePage() {
  const navigate = useNavigate()
  const { projects, loading, loadProjects, createProject, deleteProject } = useProjectStore()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [showGenreDropdown, setShowGenreDropdown] = useState(false)

  useEffect(() => { loadProjects() }, [loadProjects])

  const handleCreate = async () => {
    if (!form.name.trim()) return
    const selectedGenres = form.genres.length > 0 ? form.genres : ['other']
    const id = await createProject({
      name: form.name,
      genre: selectedGenres[0],
      genres: selectedGenres,
      status: form.status,
      description: form.description,
      targetWordCount: form.targetWordCount,
    } as CreateProjectInput)
    setShowCreate(false)
    setForm({ ...EMPTY_FORM })
    navigate(`/workspace/${id}`)
  }

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    if (confirm('确定要删除这个项目吗？所有数据将不可恢复。')) {
      await deleteProject(id)
    }
  }

  const toggleGenre = (value: string) => {
    setForm(f => ({
      ...f,
      genres: f.genres.includes(value)
        ? f.genres.filter(g => g !== value)
        : [...f.genres, value],
    }))
  }

  const getGenreLabels = (genres: string[]) => {
    if (!genres || genres.length === 0) return '未分类'
    return genres
      .slice(0, 3)
      .map(v => GENRE_OPTIONS.find(o => o.value === v)?.label ?? v)
      .join(' · ') + (genres.length > 3 ? ` +${genres.length - 3}` : '')
  }

  return (
    <div data-theme="forge" className="min-h-screen bg-bg-base">
      {/* 顶栏 */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 bg-bg-base/90 backdrop-blur-sm z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
            <Flame className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-base font-bold text-text-primary leading-none">StoryForge</h1>
            <span className="text-text-muted text-[10px] tracking-wider">故事熔炉</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/workspace/settings')}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
          <a
            href="https://github.com/yuanbw2025/storyforge"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="GitHub"
          >
            <Github className="w-4 h-4" />
          </a>
        </div>
      </header>

      {/* 主体 */}
      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Hero 区域 */}
        <div className="mb-10">
          <h2 className="text-3xl font-bold text-text-primary mb-2">
            我的项目
          </h2>
          <p className="text-text-muted text-sm">
            {projects.length > 0
              ? `共 ${projects.length} 个项目`
              : 'AI 辅助写作工具，从世界观到最终稿'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* 新建项目卡片 */}
          <button
            onClick={() => setShowCreate(true)}
            className="border-2 border-dashed border-border hover:border-accent rounded-xl p-6 flex flex-col items-center justify-center gap-3 min-h-[180px] transition-all group hover:bg-accent/5"
          >
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-border group-hover:border-accent flex items-center justify-center transition-colors">
              <Plus className="w-6 h-6 text-text-muted group-hover:text-accent transition-colors" />
            </div>
            <span className="text-text-secondary group-hover:text-accent font-medium transition-colors text-sm">
              新建项目
            </span>
          </button>

          {/* 项目卡片列表 */}
          {loading ? (
            <div className="col-span-2 flex items-center justify-center py-20">
              <span className="text-text-muted text-sm">加载中...</span>
            </div>
          ) : (
            projects.map((project) => (
              <div
                key={project.id}
                onClick={() => navigate(`/workspace/${project.id}`)}
                className="bg-bg-surface border border-border rounded-xl p-5 cursor-pointer hover:border-accent/50 hover:shadow-sm transition-all group relative"
              >
                {/* 顶部：书名 + 删除 */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <BookOpen className="w-4 h-4 text-accent shrink-0" />
                    <h3 className="font-semibold text-text-primary truncate">{project.name}</h3>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, project.id!)}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-error/20 text-text-muted hover:text-error transition-all shrink-0"
                    title="删除项目"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 流派标签 */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {(project.genres?.length ? project.genres : project.genre ? [project.genre] : ['other'])
                    .slice(0, 3)
                    .map(g => {
                      const opt = GENRE_OPTIONS.find(o => o.value === g)
                      return (
                        <span key={g} className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                          {opt?.label ?? g}
                        </span>
                      )
                    })
                  }
                  {((project.genres?.length ?? 0) > 3) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-muted">
                      +{project.genres.length - 3}
                    </span>
                  )}
                </div>

                {/* 状态 */}
                {project.status && project.status !== 'drafting' && (
                  <span className="inline-block text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted mb-2">
                    {PROJECT_STATUS_LABELS[project.status]}
                  </span>
                )}

                {/* 简介 */}
                <p className="text-text-secondary text-xs line-clamp-2 mb-3">
                  {project.description || '暂无简介'}
                </p>

                {/* 底部信息 */}
                <div className="text-text-muted text-[11px] border-t border-border/50 pt-2 mt-auto">
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
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="bg-bg-surface border border-border rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-text-primary">创建新项目</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 text-text-muted hover:text-text-primary rounded">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* 书名 */}
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">项目名称 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="如：《斗破苍穹》"
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors text-sm"
                  autoFocus
                />
              </div>

              {/* 流派（多选） */}
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">
                  流派（多选）
                  {form.genres.length > 0 && (
                    <span className="ml-1.5 text-accent">已选 {form.genres.length} 个</span>
                  )}
                </label>
                {/* 已选标签展示 */}
                {form.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {form.genres.map(g => {
                      const opt = GENRE_OPTIONS.find(o => o.value === g)
                      return (
                        <span key={g} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                          {opt?.label ?? g}
                          <button onClick={() => toggleGenre(g)} className="hover:text-error"><X className="w-2.5 h-2.5" /></button>
                        </span>
                      )
                    })}
                  </div>
                )}
                {/* 展开下拉选择 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowGenreDropdown(!showGenreDropdown)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-secondary hover:border-accent focus:outline-none transition-colors"
                  >
                    <span>{form.genres.length > 0 ? getGenreLabels(form.genres) : '选择流派...'}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showGenreDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showGenreDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-bg-surface border border-border rounded-lg shadow-lg z-30 max-h-64 overflow-y-auto">
                      {GENRE_GROUPS.map(([group, opts]) => (
                        <div key={group}>
                          <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider bg-bg-elevated border-b border-border/50">
                            {group}
                          </div>
                          <div className="flex flex-wrap gap-1 p-2">
                            {opts.map(opt => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => toggleGenre(opt.value)}
                                className={`text-xs px-2 py-1 rounded transition-colors ${
                                  form.genres.includes(opt.value)
                                    ? 'bg-accent text-white'
                                    : 'bg-bg-base text-text-secondary hover:bg-bg-hover'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 写作状态 */}
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">写作状态</label>
                <div className="flex gap-2 flex-wrap">
                  {STATUS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, status: opt.value }))}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-colors border ${
                        form.status === opt.value
                          ? 'bg-accent/10 text-accent border-accent/40'
                          : 'border-border text-text-muted hover:border-border-hover'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 简介 */}
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">简介</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="一句话描述你的故事..."
                  rows={2}
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors resize-none text-sm"
                />
              </div>

              {/* 目标字数 */}
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">
                  目标字数：{(form.targetWordCount / 10000).toFixed(0)} 万字
                </label>
                <input
                  type="range"
                  min={100000}
                  max={3000000}
                  step={100000}
                  value={form.targetWordCount}
                  onChange={e => setForm({ ...form, targetWordCount: Number(e.target.value) })}
                  className="w-full accent-accent"
                />
                <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
                  <span>10万</span><span>100万</span><span>300万</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-hover transition-colors text-sm"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim()}
                className="px-5 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium text-sm"
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
