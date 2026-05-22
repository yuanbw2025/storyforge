import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, Github, X, ChevronDown, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../stores/project'
import WelcomeGuide from '../components/guide/WelcomeGuide'
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

// 取书名首字作为大字标识
function getGlyph(name: string) {
  return name.replace(/[《》【】「」\s]/g, '').charAt(0) || '书'
}

// 获取字数友好展示
function formatWords(words: number) {
  if (words >= 10000) return `${(words / 10000).toFixed(1)} 万`
  return `${words.toLocaleString()}`
}

export default function HomePage() {
  const navigate = useNavigate()
  const { projects, loading, loadProjects, createProject, deleteProject } = useProjectStore()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [showGenreDropdown, setShowGenreDropdown] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

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
    if (deleteConfirm === id) {
      await deleteProject(id)
      setDeleteConfirm(null)
    } else {
      setDeleteConfirm(id)
      // 3 秒后取消
      setTimeout(() => setDeleteConfirm(c => c === id ? null : c), 3000)
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

  const totalWords = projects.reduce((sum, p) => sum + (p.currentWordCount ?? 0), 0)

  return (
    <div className="min-h-screen bg-bg-base" onClick={() => setDeleteConfirm(null)}>
      {/* 新手引导 */}
      <WelcomeGuide onGoSettings={() => navigate('/workspace/settings')} />

      {/* ── 顶栏 ──────────────────────────────────────── */}
      <header className="border-b border-border px-8 py-4 flex items-center sticky top-0 bg-bg-base/90 backdrop-blur-sm z-20">
        <div className="flex items-center gap-3">
          {/* 品牌 Flame 图标 */}
          <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center">
            <Flame className="w-4 h-4 text-accent" />
          </div>
          {/* 衬线斜体 wordmark */}
          <div>
            <span
              className="text-text-primary leading-none"
              style={{ fontFamily: 'var(--font-serif)', fontSize: 17, fontStyle: 'italic', letterSpacing: -0.3 }}
            >
              storyforge
            </span>
            <span
              className="text-text-muted ml-2"
              style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontStyle: 'normal', fontFamily: 'var(--font-sans)' }}
            >
              故事熔炉
            </span>
          </div>
        </div>

        <a
          href="https://github.com/yuanbw2025/storyforge"
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors ml-auto"
          title="GitHub"
        >
          <Github className="w-4 h-4" />
        </a>
      </header>

      {/* ── 主体 ──────────────────────────────────────── */}
      <main className="max-w-3xl mx-auto px-8 py-12">
        {/* Hero */}
        <div className="mb-8">
          <div className="sec-eye mb-2">
            {new Date().getFullYear()}年 · 我的书稿
          </div>
          <h1
            className="text-text-primary mb-3"
            style={{ fontFamily: 'var(--font-serif)', fontSize: 40, fontWeight: 400, letterSpacing: -0.6, lineHeight: 1.15 }}
          >
            {projects.length > 0
              ? <>共有 <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>{projects.length}</em> 部作品。</>
              : <>开始<em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>第一部</em>小说。</>
            }
          </h1>
          {/* 金色分隔线 */}
          <hr className="sf-rule my-4" />
          <div className="flex items-center justify-between">
            <p className="text-text-secondary text-sm">
              {projects.length > 0
                ? `${projects.length} 个项目 · 共 ${formatWords(totalWords)} 字`
                : 'AI 辅助写作工具，从世界观到最终稿'
              }
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors text-sm font-medium flex items-center gap-1.5"
            >
              + 新建项目
            </button>
          </div>
        </div>

        {/* ── 项目列表 ───────────────────────────────── */}
        <div>
          {loading ? (
            <div className="py-16 text-center text-text-muted text-sm">加载中…</div>
          ) : projects.length === 0 ? (
            <div
              className="py-16 text-center border border-dashed border-border rounded-xl cursor-pointer hover:border-accent/50 transition-colors group"
              onClick={() => setShowCreate(true)}
            >
              <div className="text-text-muted group-hover:text-accent transition-colors"
                   style={{ fontFamily: 'var(--font-serif)', fontSize: 40, fontWeight: 400, marginBottom: 8 }}>
                ＋
              </div>
              <p className="text-text-secondary text-sm">创建第一个项目</p>
            </div>
          ) : (
            <>
              {projects.map((project) => {
                const glyph = getGlyph(project.name)
                const genres = project.genres?.length ? project.genres : project.genre ? [project.genre] : ['other']
                const isDeleting = deleteConfirm === project.id
                return (
                  <div
                    key={project.id}
                    onClick={() => navigate(`/workspace/${project.id}`)}
                    className="flex items-center gap-5 py-5 border-b border-border cursor-pointer group transition-all hover:px-2 hover:rounded-lg hover:border-transparent hover:bg-bg-hover"
                    style={{ marginLeft: -8, marginRight: -8, paddingLeft: 8, paddingRight: 8 }}
                  >
                    {/* 首字大字 */}
                    <div
                      className="flex-shrink-0 text-text-muted group-hover:text-accent transition-colors"
                      style={{ fontFamily: 'var(--font-serif)', fontSize: 34, fontWeight: 400, width: 44, textAlign: 'center', lineHeight: 1 }}
                    >
                      {glyph}
                    </div>

                    {/* 主信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className="text-text-primary font-medium"
                          style={{ fontFamily: 'var(--font-serif)', fontSize: 17 }}
                        >
                          {project.name}
                        </span>
                        {project.status && project.status !== 'drafting' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted">
                            {PROJECT_STATUS_LABELS[project.status]}
                          </span>
                        )}
                      </div>
                      <div className="text-text-muted text-xs">
                        {genres.slice(0, 2).map(g => GENRE_OPTIONS.find(o => o.value === g)?.label ?? g).join(' · ')}
                        {project.description && <> · <span className="truncate">{project.description.slice(0, 30)}</span></>}
                      </div>
                    </div>

                    {/* 字数 */}
                    <div className="text-right flex-shrink-0">
                      <div
                        className="text-text-primary"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontFeatureSettings: '"tnum"' }}
                      >
                        {formatWords(project.currentWordCount ?? 0)} 字
                      </div>
                      <div className="text-text-muted text-xs mt-0.5">
                        {new Date(project.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                      </div>
                    </div>

                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => handleDelete(e, project.id!)}
                      className={`flex-shrink-0 px-2.5 py-1 rounded text-xs transition-all ${
                        isDeleting
                          ? 'bg-error/20 text-error opacity-100'
                          : 'opacity-0 group-hover:opacity-100 text-text-muted hover:text-error'
                      }`}
                      title={isDeleting ? '再次点击确认删除' : '删除'}
                    >
                      {isDeleting ? '确认' : '删除'}
                    </button>

                    <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity" />
                  </div>
                )
              })}

              {/* 新建行 */}
              <div
                className="flex items-center gap-5 py-4 text-text-muted cursor-pointer group hover:text-accent transition-colors"
                onClick={() => setShowCreate(true)}
              >
                <div className="w-11 h-8 flex items-center justify-center border border-dashed border-border rounded group-hover:border-accent transition-colors" style={{ fontSize: 18 }}>
                  +
                </div>
                <span className="text-sm">新建项目</span>
              </div>
            </>
          )}
        </div>
      </main>

      {/* ── 创建项目对话框 ──── */}
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
              <h3
                className="text-text-primary"
                style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 400, letterSpacing: -0.3 }}
              >
                新建项目
              </h3>
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
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="如：《剑出山门》"
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors text-sm"
                  autoFocus
                />
              </div>

              {/* 流派（多选） */}
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">
                  流派
                  {form.genres.length > 0 && <span className="ml-1.5 text-accent">已选 {form.genres.length}</span>}
                </label>
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
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowGenreDropdown(!showGenreDropdown)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-secondary hover:border-accent/50 focus:outline-none transition-colors"
                  >
                    <span>{form.genres.length > 0 ? getGenreLabels(form.genres) : '选择流派…'}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showGenreDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showGenreDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-bg-surface border border-border rounded-lg shadow-lg z-30 max-h-60 overflow-y-auto">
                      {GENRE_GROUPS.map(([group, opts]) => (
                        <div key={group}>
                          <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider bg-bg-elevated border-b border-border/50">{group}</div>
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
                  placeholder="一句话描述你的故事…"
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
                  type="range" min={100000} max={5000000} step={100000}
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
