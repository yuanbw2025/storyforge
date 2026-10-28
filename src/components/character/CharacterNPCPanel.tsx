import { useEffect, useState } from 'react'
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
import { filledDimensions } from '../../lib/character/character-dimensions'

interface Props {
  project: Project
}

/** v3 §2.1 — NPC（紧凑列表视图 + 可展开完整设定） */
export default function CharacterNPCPanel({ project }: Props) {
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

  const list = filterCharactersByRoleWeight(characters, 'npc')

  const handleAdd = () => addCharacter({
    projectId: project.id!,
    name: '新 NPC',
    roleWeight: 'npc',
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
    <div inert={loading || Boolean(loadError)} className="max-w-5xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-1">🧑‍🤝‍🧑 NPC</h2>
          <p className="text-sm text-text-muted">非剧情驱动的常驻角色 — 紧凑列表，一眼扫完。</p>
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
          还没有 NPC，点上方「新增」开始。
        </div>
      ) : (
        <div className="bg-bg-surface border border-border rounded-xl divide-y divide-border">
          {list.map(c => {
            const filled = filledDimensions(c).filter(k => k !== 'shortDescription' && k !== 'location').length
            const isOpen = expanded.has(c.id!)
            return (
            <div key={c.id} className="p-3 hover:bg-bg-hover transition-colors">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { void guarded(() => toggle(c.id!)) }}
                  className="p-0.5 text-text-muted hover:text-accent flex-shrink-0"
                  title={isOpen ? '收起完整设定' : '展开完整设定'}
                >
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <CharacterDraftField input
                  value={c.name}
                  onCommit={(value, expected) => update(c.id!, { name: value }, { name: expected } as Partial<Character>)}
                  dimension={{ label: '姓名', rows: 2 }}
                  placeholder="姓名"
                  className="w-32 flex-shrink-0 px-2 py-1 bg-bg-base border border-border rounded text-sm font-medium text-text-primary focus:outline-none focus:border-accent"
                />
                <CharacterDraftField input
                  value={c.location}
                  onCommit={(value, expected) => update(c.id!, { location: value }, { location: expected } as Partial<Character>)}
                  dimension={{ label: '常驻地点', rows: 2 }}
                  placeholder="地点"
                  className="w-28 flex-shrink-0 px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                />
                <CharacterDraftField input
                  value={c.shortDescription}
                  onCommit={(value, expected) => update(c.id!, { shortDescription: value }, { shortDescription: expected } as Partial<Character>)}
                  dimension={{ label: '一句话简介', rows: 2 }}
                  placeholder="一句话描述（性格/职业/作用）..."
                  className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                />
                {filled > 0 && !isOpen && (
                  <span className="flex-shrink-0 text-[11px] text-text-muted whitespace-nowrap" title="已有完整设定，点左侧箭头展开">已填 {filled} 项 ▸</span>
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
                  className="p-1 text-text-muted hover:text-error flex-shrink-0"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {isOpen && (
                <div className="mt-3 pl-7">
                  <CharacterDimensionFields character={c} onChange={(patch, expected) => update(c.id!, patch, expected)} exclude={['shortDescription', 'location']} />
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
    </>
  )
}
