import { useState, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import type { Project, Faction } from '../../lib/types'

interface Props { project: Project }

export default function FactionPanel({ project }: Props) {
  const { factions, loadAll, addFaction, updateFaction, deleteFaction } = useCharacterStore()
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const selectedFaction = factions.find(f => f.id === selected)

  const handleAdd = async () => {
    const id = await addFaction({
      projectId: project.id!, name: '新势力',
      description: '', leader: '', members: '', goals: '', resources: '', relationships: '',
    })
    setSelected(id)
  }

  const handleUpdate = (field: keyof Faction, value: string) => {
    if (selectedFaction?.id) updateFaction(selectedFaction.id, { [field]: value })
  }

  const fields: { key: keyof Faction; label: string; rows?: number }[] = [
    { key: 'description', label: '描述', rows: 3 },
    { key: 'leader', label: '领导者' },
    { key: 'members', label: '核心成员', rows: 2 },
    { key: 'goals', label: '目标', rows: 2 },
    { key: 'resources', label: '资源/实力', rows: 2 },
    { key: 'relationships', label: '与其他势力关系', rows: 2 },
  ]

  return (
    <div className="flex gap-4 max-w-5xl">
      <div className="w-48 shrink-0 space-y-2">
        <button onClick={handleAdd}
          className="w-full flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors">
          <Plus className="w-4 h-4" /> 添加势力
        </button>
        {factions.map(f => (
          <button key={f.id} onClick={() => setSelected(f.id!)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${selected === f.id ? 'bg-accent/10 text-accent border border-accent/30' : 'bg-bg-surface text-text-secondary hover:bg-bg-hover'}`}>
            {f.name}
          </button>
        ))}
      </div>
      <div className="flex-1">
        {selectedFaction ? (
          <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <input value={selectedFaction.name} onChange={e => handleUpdate('name', e.target.value)}
                className="text-lg font-bold bg-transparent text-text-primary border-none outline-none" />
              <button onClick={() => { deleteFaction(selectedFaction.id!); setSelected(null) }}
                className="text-text-muted hover:text-error"><Trash2 className="w-4 h-4" /></button>
            </div>
            {fields.map(f => (
              <div key={f.key}>
                <label className="block text-xs text-text-muted mb-1">{f.label}</label>
                <textarea value={(selectedFaction[f.key] as string) || ''}
                  onChange={e => handleUpdate(f.key, e.target.value)}
                  rows={f.rows || 1}
                  className="w-full p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-text-muted text-sm">
            ← 选择或添加一个势力
          </div>
        )}
      </div>
    </div>
  )
}
