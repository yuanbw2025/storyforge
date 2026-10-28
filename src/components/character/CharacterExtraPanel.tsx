import { Fragment, useEffect, useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import type { Project, Character } from '../../lib/types'
import { filterCharactersByRoleWeight } from '../../lib/character/character-axes'
import CharacterDimensionFields, { CharacterDraftField } from './CharacterDimensionFields'
import CharacterReadStatus from './CharacterReadStatus'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import CharacterSupplementAction from './CharacterSupplementAction'
import CharacterLifecycleAction from './CharacterLifecycleAction'
import { useWorldGroupStore } from '../../stores/world-group'
import { filledDimensions, type CharacterDimensionKey } from '../../lib/character/character-dimensions'

interface Props {
  project: Project
}

// 表格列已显示的维度，展开区不重复
const TABLE_DIMS: CharacterDimensionKey[] = ['location', 'storyRole', 'ending']

/** 路人紧凑表格；表格未显示的维度均可展开查看和编辑。 */
export default function CharacterExtraPanel({ project }: Props) {
  const { characters, loading, loadError, loadedScope, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()
  const [actionError, setActionError] = useState('')
  const guarded = async (action: () => void | Promise<unknown>) => {
    try { await flushPendingEditsV1(); await action(); setActionError('') }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : '角色操作失败，输入已保留。') }
  }
  const activeGroupId = useWorldGroupStore(state => state.activeGroupId)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => { void loadAll(project.id!) }, [project.id, project.activeWorldId, project.activeWorkId, loadAll])

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

  const update = (id: number, patch: Partial<Character>, expected?: Partial<Character>) => updateCharacter(id, patch, { scope: loadedScope ?? undefined, expected })

  return (
    <>
    <CharacterReadStatus projectId={project.id!} />
    {actionError && <p role="alert" className="px-6 text-sm text-error">{actionError}</p>}
    <div inert={loading || Boolean(loadError)} className="max-w-6xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-1">🚶 路人</h2>
          <p className="text-sm text-text-muted">一笔带过的角色 — 表格视图，记录最少必要信息；需要时可展开补全完整设定。</p>
        </div>
        <button
          onClick={() => { void guarded(handleAdd) }}
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
                <th className="text-left px-3 py-2 font-medium">常驻地点</th>
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
                          onClick={() => { void guarded(() => toggle(c.id!)) }}
                          className="p-0.5 text-text-muted hover:text-accent"
                          title={isOpen ? '收起完整设定' : '展开完整设定'}
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-1.5">
                        <CharacterDraftField input
                          value={c.name}
                          onCommit={(value, expected) => update(c.id!, { name: value }, { name: expected } as Partial<Character>)}
                  dimension={{ label: '姓名', rows: 2 }}
                          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <CharacterDraftField input
                          value={c.firstAppearance}
                          onCommit={(value, expected) => update(c.id!, { firstAppearance: value }, { firstAppearance: expected } as Partial<Character>)}
                  dimension={{ label: '首次出场', rows: 2 }}
                          placeholder="如：第 3 卷"
                          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <CharacterDraftField input
                          value={c.location}
                          onCommit={(value, expected) => update(c.id!, { location: value }, { location: expected } as Partial<Character>)}
                  dimension={{ label: '常驻地点', rows: 2 }}
                          placeholder="如：第 12 章"
                          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <CharacterDraftField input
                          value={c.storyRole}
                          onCommit={(value, expected) => update(c.id!, { storyRole: value }, { storyRole: expected } as Partial<Character>)}
                  dimension={{ label: '在故事中的作用', rows: 2 }}
                          placeholder="如：路过的剑客 / 报信人"
                          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <CharacterDraftField input
                          value={c.ending}
                          onCommit={(value, expected) => update(c.id!, { ending: value }, { ending: expected } as Partial<Character>)}
                  dimension={{ label: '结局走向', rows: 2 }}
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
                            project={project}
                            worldGroupId={c.isCrossWorld ? activeGroupId : (c.homeWorldGroupId ?? null)}
                            onDone={() => loadAll(project.id!)}
                            compact
                          />
                          <CharacterLifecycleAction
                            character={c}
                            project={project}
                            worldGroupId={c.isCrossWorld ? activeGroupId : (c.homeWorldGroupId ?? null)}
                            onDone={() => loadAll(project.id!)}
                            compact
                          />
                          <button
                            onClick={() => { void guarded(() => deleteCharacter(c.id!)) }}
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
                            onChange={(patch, expected) => update(c.id!, patch, expected)}
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
    </>
  )
}
