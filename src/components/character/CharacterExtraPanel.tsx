import { useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import type { Project, Character } from '../../lib/types'

interface Props {
  project: Project
}

/** v3 §2.1 — 路人（表格视图：姓名 / 出场时间 / 章节 / 作用 / 结局） */
export default function CharacterExtraPanel({ project }: Props) {
  const { characters, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const list = characters.filter(c => c.role === 'extra')

  const handleAdd = () => addCharacter({
    projectId: project.id!,
    name: '路人',
    role: 'extra',
    shortDescription: '',
    appearance: '', personality: '', background: '',
    motivation: '', abilities: '', relationships: '', arc: '',
  })

  const update = (id: number, patch: Partial<Character>) => updateCharacter(id, patch)

  return (
    <div className="max-w-6xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-1">🚶 路人</h2>
          <p className="text-sm text-text-muted">一笔带过的角色 — 表格视图，记录最少必要信息。</p>
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
          还没有路人，点上方「新增」开始。
        </div>
      ) : (
        <div className="overflow-x-auto bg-bg-surface border border-border rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-text-secondary">
                <th className="text-left px-3 py-2 font-medium">姓名</th>
                <th className="text-left px-3 py-2 font-medium">出场时间</th>
                <th className="text-left px-3 py-2 font-medium">章节</th>
                <th className="text-left px-3 py-2 font-medium">作用</th>
                <th className="text-left px-3 py-2 font-medium">结局</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id} className="border-b border-border/50 last:border-b-0 hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={c.name}
                      onChange={e => update(c.id!, { name: e.target.value })}
                      className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={c.firstAppearance || ''}
                      onChange={e => update(c.id!, { firstAppearance: e.target.value })}
                      placeholder="如：第 3 卷"
                      className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={c.location || ''}
                      onChange={e => update(c.id!, { location: e.target.value })}
                      placeholder="如：第 12 章"
                      className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={c.storyRole || ''}
                      onChange={e => update(c.id!, { storyRole: e.target.value })}
                      placeholder="如：路过的剑客 / 报信人"
                      className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={c.ending || ''}
                      onChange={e => update(c.id!, { ending: e.target.value })}
                      placeholder="如：失踪 / 已死"
                      className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                    />
                  </td>
                  <td className="px-2">
                    <button
                      onClick={() => deleteCharacter(c.id!)}
                      className="p-1 text-text-muted hover:text-error"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
