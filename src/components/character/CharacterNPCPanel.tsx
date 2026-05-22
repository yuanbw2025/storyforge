import { useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import type { Project, Character } from '../../lib/types'

interface Props {
  project: Project
}

/** v3 §2.1 — NPC（紧凑列表视图） */
export default function CharacterNPCPanel({ project }: Props) {
  const { characters, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const list = characters.filter(c => c.role === 'npc')

  const handleAdd = () => addCharacter({
    projectId: project.id!,
    name: '新 NPC',
    role: 'npc',
    shortDescription: '',
    appearance: '', personality: '', background: '',
    motivation: '', abilities: '', relationships: '', arc: '',
  })

  const update = (id: number, patch: Partial<Character>) => updateCharacter(id, patch)

  return (
    <div className="max-w-5xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-1">🧑‍🤝‍🧑 NPC</h2>
          <p className="text-sm text-text-muted">非剧情驱动的常驻角色 — 紧凑列表，一眼扫完。</p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-hover"
        >
          <Plus className="w-4 h-4" /> 新增
        </button>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">
          还没有 NPC，点上方「新增」开始。
        </div>
      ) : (
        <div className="bg-bg-surface border border-border rounded-xl divide-y divide-border">
          {list.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-3 hover:bg-bg-hover transition-colors">
              <input
                type="text"
                value={c.name}
                onChange={e => update(c.id!, { name: e.target.value })}
                placeholder="姓名"
                className="w-32 flex-shrink-0 px-2 py-1 bg-bg-base border border-border rounded text-sm font-medium text-text-primary focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                value={c.location || ''}
                onChange={e => update(c.id!, { location: e.target.value })}
                placeholder="地点"
                className="w-28 flex-shrink-0 px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                value={c.shortDescription}
                onChange={e => update(c.id!, { shortDescription: e.target.value })}
                placeholder="一句话描述（性格/职业/作用）..."
                className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => deleteCharacter(c.id!)}
                className="p-1 text-text-muted hover:text-error flex-shrink-0"
                title="删除"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
