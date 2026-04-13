import { useState, useEffect } from 'react'
import { Plus, Trash2, ArrowRight } from 'lucide-react'
import { useForeshadowStore } from '../../stores/foreshadow'
import type { Project, Foreshadow, ForeshadowStatus, ForeshadowType } from '../../lib/types'

const STATUS_LABELS: Record<ForeshadowStatus, { label: string; color: string }> = {
  planned: { label: '📋 计划中', color: 'text-text-muted' },
  planted: { label: '🌱 已埋设', color: 'text-warning' },
  echoed: { label: '🔔 已呼应', color: 'text-info' },
  resolved: { label: '✅ 已回收', color: 'text-success' },
}

const TYPE_LABELS: Record<ForeshadowType, string> = {
  chekhov: '🔫 契诃夫之枪', prophecy: '🔮 预言暗示', symbol: '🎭 象征伏笔',
  character: '👤 角色伏笔', dialogue: '💬 对话伏笔', environment: '🌿 环境伏笔',
  timeline: '⏰ 时间线', 'red-herring': '🐟 红鲱鱼', parallel: '🔄 平行伏笔', callback: '↩️ 回调伏笔',
}

const STATUS_FLOW: ForeshadowStatus[] = ['planned', 'planted', 'echoed', 'resolved']

interface Props { project: Project }

export default function ForeshadowPanel({ project }: Props) {
  const { foreshadows, loadAll, addForeshadow, updateForeshadow, deleteForeshadow, updateStatus } = useForeshadowStore()
  const [filterStatus, setFilterStatus] = useState<ForeshadowStatus | 'all'>('all')
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const filtered = filterStatus === 'all' ? foreshadows : foreshadows.filter(f => f.status === filterStatus)
  const selectedF = foreshadows.find(f => f.id === selected)

  const handleAdd = async () => {
    const id = await addForeshadow({
      projectId: project.id!, name: '新伏笔', type: 'chekhov', status: 'planned',
      description: '', plantChapterId: null, echoChapterIds: '[]', resolveChapterId: null, notes: '',
    })
    setSelected(id)
  }

  const handleUpdate = (field: keyof Foreshadow, value: string) => {
    if (selectedF?.id) updateForeshadow(selectedF.id, { [field]: value })
  }

  const handleNextStatus = (f: Foreshadow) => {
    const idx = STATUS_FLOW.indexOf(f.status)
    if (idx < STATUS_FLOW.length - 1 && f.id) {
      updateStatus(f.id, STATUS_FLOW[idx + 1])
    }
  }

  return (
    <div className="flex gap-4 max-w-5xl">
      {/* 左侧列表 */}
      <div className="w-60 shrink-0 space-y-2">
        <button onClick={handleAdd}
          className="w-full flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors">
          <Plus className="w-4 h-4" /> 添加伏笔
        </button>

        {/* 状态筛选 */}
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setFilterStatus('all')}
            className={`px-2 py-1 text-xs rounded ${filterStatus === 'all' ? 'bg-accent text-white' : 'bg-bg-elevated text-text-muted'}`}>
            全部
          </button>
          {STATUS_FLOW.map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-2 py-1 text-xs rounded ${filterStatus === s ? 'bg-accent text-white' : 'bg-bg-elevated text-text-muted'}`}>
              {STATUS_LABELS[s].label}
            </button>
          ))}
        </div>

        {filtered.map(f => (
          <button key={f.id} onClick={() => setSelected(f.id!)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              selected === f.id ? 'bg-accent/10 text-accent border border-accent/30' : 'bg-bg-surface text-text-secondary hover:bg-bg-hover'
            }`}>
            <div className="font-medium truncate">{f.name}</div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>{TYPE_LABELS[f.type]?.split(' ')[0]}</span>
              <span className={STATUS_LABELS[f.status].color}>{STATUS_LABELS[f.status].label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* 右侧编辑 */}
      <div className="flex-1">
        {selectedF ? (
          <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <input value={selectedF.name} onChange={e => handleUpdate('name', e.target.value)}
                className="text-lg font-bold bg-transparent text-text-primary border-none outline-none" />
              <div className="flex items-center gap-2">
                <button onClick={() => handleNextStatus(selectedF)}
                  disabled={selectedF.status === 'resolved'}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-bg-elevated text-text-secondary rounded hover:text-accent disabled:opacity-30">
                  <ArrowRight className="w-3 h-3" /> 推进状态
                </button>
                <button onClick={() => { deleteForeshadow(selectedF.id!); setSelected(null) }}
                  className="text-text-muted hover:text-error"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="flex gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">类型</label>
                <select value={selectedF.type} onChange={e => handleUpdate('type', e.target.value)}
                  className="px-2 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded border border-border">
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">状态</label>
                <span className={`text-sm ${STATUS_LABELS[selectedF.status].color}`}>
                  {STATUS_LABELS[selectedF.status].label}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">伏笔描述</label>
              <textarea value={selectedF.description} onChange={e => handleUpdate('description', e.target.value)}
                rows={4} className="w-full p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent" />
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">备注</label>
              <textarea value={selectedF.notes} onChange={e => handleUpdate('notes', e.target.value)}
                rows={2} className="w-full p-2 bg-bg-base border border-border rounded text-xs text-text-muted resize-y focus:outline-none focus:border-accent" />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-text-muted text-sm">
            ← 选择或添加一个伏笔
          </div>
        )}
      </div>
    </div>
  )
}
