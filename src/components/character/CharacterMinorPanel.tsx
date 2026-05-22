import { useState, useEffect } from 'react'
import { Plus, Trash2, User } from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import type { Project, Character } from '../../lib/types'

interface Props {
  project: Project
}

/** v3 §2.1 — 次要角色（小卡片网格视图） */
export default function CharacterMinorPanel({ project }: Props) {
  const { characters, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const list = characters.filter(c => c.role === 'minor')

  const handleAdd = async () => {
    const id = await addCharacter({
      projectId: project.id!,
      name: '新次要角色',
      role: 'minor',
      shortDescription: '',
      appearance: '', personality: '', background: '',
      motivation: '', abilities: '', relationships: '', arc: '',
    })
    setEditing(id)
  }

  const update = (id: number, patch: Partial<Character>) => updateCharacter(id, patch)

  return (
    <div className="max-w-5xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-1">👥 次要角色</h2>
          <p className="text-sm text-text-muted">配角群像 — 简要卡片视图，记录关键信息即可。</p>
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
          还没有次要角色，点上方「新增」开始。
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map(c => (
            <div
              key={c.id}
              className="bg-bg-surface border border-border rounded-xl p-3 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-text-secondary" />
                </div>
                <input
                  type="text"
                  value={c.name}
                  onChange={e => update(c.id!, { name: e.target.value })}
                  className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-sm font-medium text-text-primary focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => deleteCharacter(c.id!)}
                  className="p-1 text-text-muted hover:text-error"
                  title="删除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                value={c.shortDescription}
                onChange={e => update(c.id!, { shortDescription: e.target.value })}
                placeholder="一句话简介..."
                rows={2}
                className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
              />
              {(editing === c.id) ? (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    value={c.personality}
                    onChange={e => update(c.id!, { personality: e.target.value })}
                    placeholder="性格..."
                    rows={2}
                    className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
                  />
                  <textarea
                    value={c.background}
                    onChange={e => update(c.id!, { background: e.target.value })}
                    placeholder="背景..."
                    rows={2}
                    className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => setEditing(null)}
                    className="text-xs text-accent hover:underline"
                  >
                    收起
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditing(c.id!)}
                  className="mt-2 text-xs text-text-secondary hover:text-accent"
                >
                  展开编辑 ▾
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
