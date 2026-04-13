import { useState } from 'react'
import { Save } from 'lucide-react'
import { useProjectStore } from '../../stores/project'
import type { Project, NovelGenre } from '../../lib/types'

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

interface ProjectInfoPanelProps {
  project: Project
  onUpdate: (project: Project) => void
}

export default function ProjectInfoPanel({ project, onUpdate }: ProjectInfoPanelProps) {
  const { updateProject } = useProjectStore()
  const [form, setForm] = useState({
    name: project.name,
    genre: project.genre,
    description: project.description,
    targetWordCount: project.targetWordCount,
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!project.id) return
    setSaving(true)
    await updateProject(project.id, form)
    onUpdate({ ...project, ...form, updatedAt: Date.now() })
    setSaving(false)
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
            max={3000000}
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
