import { useEffect, useState } from 'react'
import { Plus, Trash2, ExternalLink, Library, BookMarked, Palette } from 'lucide-react'
import { useReferenceStore } from '../../stores/reference'
import type { Project, Reference, ReferenceType, CreateReferenceInput } from '../../lib/types'

const TYPE_CONFIG: Record<ReferenceType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  story: { label: '故事参考', icon: BookMarked, color: 'text-accent bg-accent/10 border-accent/30' },
  style: { label: '风格参考', icon: Palette,   color: 'text-purple-400 bg-purple-500/10 border-purple-400/30' },
}

const EMPTY_FORM: CreateReferenceInput = {
  projectId: 0,
  title: '',
  author: '',
  type: 'story',
  note: '',
  url: '',
}

interface Props { project: Project }

export default function ReferencePanel({ project }: Props) {
  const { references, loadAll, addReference, updateReference, deleteReference } = useReferenceStore()
  const [filter, setFilter] = useState<ReferenceType | 'all'>('all')
  const [selected, setSelected] = useState<Reference | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<CreateReferenceInput>({ ...EMPTY_FORM, projectId: project.id! })

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const displayed = filter === 'all'
    ? references
    : references.filter(r => r.type === filter)

  const storyCount = references.filter(r => r.type === 'story').length
  const styleCount = references.filter(r => r.type === 'style').length

  const handleNew = () => {
    setForm({ ...EMPTY_FORM, projectId: project.id! })
    setSelected(null)
    setIsNew(true)
  }

  const handleSelect = (ref: Reference) => {
    setSelected(ref)
    setIsNew(false)
    setForm({
      projectId: ref.projectId,
      title: ref.title,
      author: ref.author,
      type: ref.type,
      note: ref.note,
      url: ref.url,
    })
  }

  const handleSave = async () => {
    if (!form.title.trim()) return
    if (isNew) {
      await addReference(form)
      setIsNew(false)
    } else if (selected?.id) {
      await updateReference(selected.id, form)
      setSelected({ ...selected, ...form, updatedAt: Date.now() })
    }
  }

  const handleDelete = async (ref: Reference) => {
    if (!confirm(`确定删除《${ref.title}》？`)) return
    await deleteReference(ref.id!)
    if (selected?.id === ref.id) { setSelected(null); setIsNew(false) }
  }

  return (
    <div className="flex gap-4 max-w-5xl">
      {/* 左侧列表 */}
      <div className="w-60 shrink-0 space-y-2">
        {/* 统计 + 新建 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleNew}
            className="flex-1 flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" /> 添加参考
          </button>
        </div>

        {/* 筛选 tabs */}
        <div className="flex gap-1 bg-bg-elevated rounded-lg p-1">
          {([['all', '全部', references.length], ['story', '故事', storyCount], ['style', '风格', styleCount]] as const).map(
            ([v, l, c]) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={`flex-1 text-xs py-1 rounded px-1 transition-colors ${filter === v ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {l} {c > 0 && <span className="opacity-70">({c})</span>}
              </button>
            )
          )}
        </div>

        {/* 列表 */}
        <div className="space-y-1">
          {displayed.length === 0 && (
            <div className="text-center text-text-muted text-sm py-8">
              <Library className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>暂无参考书目</p>
            </div>
          )}
          {displayed.map(ref => {
            const cfg = TYPE_CONFIG[ref.type]
            const Icon = cfg.icon
            const isSelected = selected?.id === ref.id
            return (
              <div key={ref.id} className={`group relative rounded-md border transition-all cursor-pointer ${isSelected ? 'border-accent/50 bg-accent/5' : 'border-border bg-bg-surface hover:border-border-hover'}`}
                onClick={() => handleSelect(ref)}>
                <div className="p-3">
                  <div className="flex items-start gap-2">
                    <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color.split(' ')[0]}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">《{ref.title}》</p>
                      {ref.author && <p className="text-xs text-text-muted truncate">{ref.author}</p>}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(ref) }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-error transition-all rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <span className={`inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded border ${cfg.color}`}>
                    {cfg.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 右侧编辑 */}
      <div className="flex-1">
        {(isNew || selected) ? (
          <div className="bg-bg-surface border border-border rounded-lg p-5 space-y-4">
            <h3 className="text-base font-semibold text-text-primary">
              {isNew ? '添加参考书目' : '编辑参考书目'}
            </h3>

            {/* 类型选择 */}
            <div>
              <label className="block text-xs text-text-muted mb-1.5">类型</label>
              <div className="flex gap-2">
                {(['story', 'style'] as const).map(t => {
                  const cfg = TYPE_CONFIG[t]
                  const Icon = cfg.icon
                  return (
                    <button
                      key={t}
                      onClick={() => setForm(f => ({ ...f, type: t }))}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-all ${form.type === t ? cfg.color : 'border-border text-text-muted hover:border-border-hover'}`}
                    >
                      <Icon className="w-3.5 h-3.5" /> {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">书名 *</label>
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="如：《斗破苍穹》"
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">作者</label>
              <input
                value={form.author}
                onChange={e => setForm(f => ({ ...f, author: e.target.value }))}
                placeholder="作者名"
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">参考要点</label>
              <textarea
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                rows={3}
                placeholder="记录你希望借鉴这部作品的哪些具体方面..."
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent resize-none"
              />
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">链接（可选）</label>
              <div className="relative">
                <input
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent pr-9"
                />
                {form.url && (
                  <a
                    href={form.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-accent"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={() => { setSelected(null); setIsNew(false) }}
                className="px-4 py-2 text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-hover text-sm transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!form.title.trim()}
                className="px-5 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isNew ? '添加' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted text-sm gap-3">
            <Library className="w-12 h-12 opacity-20" />
            <p>从左侧选择一条参考书目，或点击「添加参考」</p>
            <div className="text-xs text-text-muted/60 text-center max-w-xs">
              <p>· <span className="text-accent">故事参考</span>：借鉴情节结构、世界观框架</p>
              <p>· <span className="text-purple-400">风格参考</span>：借鉴文风、叙事节奏</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
