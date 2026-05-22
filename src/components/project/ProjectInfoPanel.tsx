import { useState } from 'react'
import { Save, X, ChevronDown } from 'lucide-react'
import { useProjectStore } from '../../stores/project'
import type { Project } from '../../lib/types'
import { GENRE_OPTIONS } from '../../lib/types'

// 按 group 分组
const GENRE_GROUPS = Array.from(
  GENRE_OPTIONS.reduce((map, opt) => {
    if (!map.has(opt.group)) map.set(opt.group, [])
    map.get(opt.group)!.push(opt)
    return map
  }, new Map<string, typeof GENRE_OPTIONS[number][]>())
)

interface ProjectInfoPanelProps {
  project: Project
  onUpdate: (project: Project) => void
}

export default function ProjectInfoPanel({ project, onUpdate }: ProjectInfoPanelProps) {
  const { updateProject } = useProjectStore()
  const [form, setForm] = useState({
    name: project.name,
    genre: project.genre,
    genres: project.genres?.length ? project.genres : (project.genre ? [project.genre] : []),
    description: project.description,
    targetWordCount: project.targetWordCount,
  })
  const [saving, setSaving] = useState(false)
  const [showGenreDropdown, setShowGenreDropdown] = useState(false)

  const handleSave = async () => {
    if (!project.id) return
    setSaving(true)
    const updates = {
      name: form.name,
      genre: form.genres[0] || form.genre,
      genres: form.genres,
      description: form.description,
      targetWordCount: form.targetWordCount,
    }
    await updateProject(project.id, updates)
    onUpdate({ ...project, ...updates, updatedAt: Date.now() })
    setSaving(false)
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
    if (!genres || genres.length === 0) return '选择流派…'
    return genres
      .slice(0, 3)
      .map(v => GENRE_OPTIONS.find(o => o.value === v)?.label ?? v)
      .join(' · ') + (genres.length > 3 ? ` +${genres.length - 3}` : '')
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-text-primary">基本信息</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors text-sm font-medium"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-sm text-text-secondary mb-1.5">项目名称</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm text-text-secondary mb-1.5">
            流派
            {form.genres.length > 0 && <span className="ml-1.5 text-accent text-xs">已选 {form.genres.length}</span>}
          </label>
          {/* 已选标签 */}
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
          {/* 下拉选择 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowGenreDropdown(!showGenreDropdown)}
              className="w-full flex items-center justify-between px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-secondary hover:border-accent/50 focus:outline-none transition-colors"
            >
              <span>{getGenreLabels(form.genres)}</span>
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

        <div>
          <label className="block text-sm text-text-secondary mb-1.5">简介</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-sm text-text-secondary mb-1.5">
            目标字数：{(form.targetWordCount / 10000).toFixed(0)} 万字
          </label>
          <input
            type="range"
            min={100000}
            max={5000000}
            step={100000}
            value={form.targetWordCount}
            onChange={(e) => setForm({ ...form, targetWordCount: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </div>

        <div className="pt-4 border-t border-border">
          <p className="text-text-muted text-xs">
            创建于 {new Date(project.createdAt).toLocaleString('zh-CN')} ·
            更新于 {new Date(project.updatedAt).toLocaleString('zh-CN')}
          </p>
        </div>
      </div>
    </div>
  )
}
