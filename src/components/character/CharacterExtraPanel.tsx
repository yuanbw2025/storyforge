import { Fragment, useEffect, useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import type { Project, Character } from '../../lib/types'
import { filterCharactersByRoleWeight } from '../../lib/character/character-axes'
import CharacterDimensionFields from './CharacterDimensionFields'
import CharacterSupplementAction from './CharacterSupplementAction'
import { filledDimensions, type CharacterDimensionKey } from '../../lib/character/character-dimensions'
import { CInput } from '../shared/CompositionInput'

interface Props {
  project: Project
}

// 表格列已显示的维度，展开区不重复
const TABLE_DIMS: CharacterDimensionKey[] = ['shortDescription', 'location', 'storyRole', 'ending']

/** v3 §2.1 — 路人（表格视图：姓名 / 出场时间 / 章节 / 作用 / 结局；可展开看完整维度） */
export default function CharacterExtraPanel({ project }: Props) {
  const { characters, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  const toggle = (id: number) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const list = filterCharactersByRoleWeight(characters, 'extra')

  const handleAdd = () => addCharacter({
    projectId: project.id!,
    name: '路人',
    roleWeight: 'extra',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
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
          <p className="text-sm text-text-muted">一笔带过的角色 — 表格视图，记录最少必要信息；需要时可展开补全完整设定。</p>
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
                <th className="w-8"></th>
                <th className="text-left px-3 py-2 font-medium">姓名</th>
                <th className="text-left px-3 py-2 font-medium">出场时间</th>
                <th className="text-left px-3 py-2 font-medium">章节</th>
                <th className="text-left px-3 py-2 font-medium">作用</th>
                <th className="text-left px-3 py-2 font-medium">结局</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {list.map(c => {
                const isOpen = expanded.has(c.id!)
                const filled = filledDimensions(c).filter(k => !TABLE_DIMS.includes(k)).length
                return (
                  <Fragment key={c.id}>
                    <tr className="border-b border-border/50 last:border-b-0 hover:bg-bg-hover transition-colors">
                      <td className="pl-2">
                        <button
                          onClick={() => toggle(c.id!)}
                          className="p-0.5 text-text-muted hover:text-accent"
                          title={isOpen ? '收起完整设定' : '展开完整设定'}
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-1.5">
                        <CInput
                          value={c.name}
                          onChange={e => update(c.id!, { name: e.target.value })}
                          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <CInput
                          value={c.firstAppearance || ''}
                          onChange={e => update(c.id!, { firstAppearance: e.target.value })}
                          placeholder="如：第 3 卷"
                          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <CInput
                          value={c.location || ''}
                          onChange={e => update(c.id!, { location: e.target.value })}
                          placeholder="如：第 12 章"
                          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <CInput
                          value={c.storyRole || ''}
                          onChange={e => update(c.id!, { storyRole: e.target.value })}
                          placeholder="如：路过的剑客 / 报信人"
                          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <CInput
                          value={c.ending || ''}
                          onChange={e => update(c.id!, { ending: e.target.value })}
                          placeholder="如：失踪 / 已死"
                          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-2">
                        <div className="flex items-center gap-0.5">
                          {filled > 0 && !isOpen && (
                            <span className="text-[10px] text-text-muted whitespace-nowrap" title="已有完整设定，点左侧箭头展开">{filled}项</span>
                          )}
                          <CharacterSupplementAction
                            character={c}
                            projectId={project.id!}
                            worldGroupId={c.homeWorldGroupId ?? null}
                            onDone={() => loadAll(project.id!)}
                            compact
                          />
                          <button
                            onClick={() => deleteCharacter(c.id!)}
                            className="p-1 text-text-muted hover:text-error"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border/50 bg-bg-base/40">
                        <td></td>
                        <td colSpan={6} className="px-3 py-3">
                          <CharacterDimensionFields
                            character={c}
                            onChange={patch => update(c.id!, patch)}
                            exclude={TABLE_DIMS}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
