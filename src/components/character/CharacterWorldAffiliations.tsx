import { useEffect, useMemo, useState } from 'react'
import type { Character, WorldGroup } from '../../lib/types'
import { parseCultivationStages } from '../../lib/types/cultivation'
import { codexEntryInWorld } from '../../lib/types/codex'
import { useCodexStore } from '../../stores/codex'
import { useCultivationStore } from '../../stores/cultivation'

export default function CharacterWorldAffiliations({
  character,
  projectId,
  worldGroups,
  onChange,
}: {
  character: Character
  projectId: number
  worldGroups: WorldGroup[]
  onChange: (patch: Partial<Character>) => void
}) {
  const worldIdValue: unknown = Reflect.get(character, 'worldId')
  const worldId = typeof worldIdValue === 'number' ? worldIdValue : undefined
  const categories = useCodexStore(state => state.categories)
  const entries = useCodexStore(state => state.entries)
  const codexScope = useCodexStore(state => state.loadedScope)
  const systemsScope = useCultivationStore(state => state.loadedScope)
  const loadCodex = useCodexStore(state => state.loadExisting)
  const systems = useCultivationStore(state => state.systems)
  const loadSystems = useCultivationStore(state => state.loadAll)

  const [retry, setRetry] = useState(0)
  const [read, setRead] = useState<{ projectId: number; worldId?: number; ready: boolean; error: string | null } | null>(null)
  useEffect(() => {
    let active = true
    setRead({ projectId, worldId: worldId, ready: false, error: null })
    void Promise.all([loadCodex(projectId), loadSystems(projectId)]).then(() => {
      const codex = useCodexStore.getState(), cultivation = useCultivationStore.getState()
      if (codex.loadError || cultivation.loadError) throw new Error(codex.loadError || cultivation.loadError!)
      if (codex.loadedScope?.projectId !== projectId || cultivation.loadedScope?.projectId !== projectId
        || (worldId != null && (codex.loadedScope.worldId !== worldId || cultivation.loadedScope.worldId !== worldId))) {
        throw new Error('关联来源已切换，请重新读取。')
      }
      if (active) setRead({ projectId, worldId: worldId, ready: true, error: null })
    }).catch(error => {
      if (active) setRead({ projectId, worldId: worldId, ready: false, error: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [loadCodex, loadSystems, projectId, worldId, retry])
  const ready = read?.projectId === projectId && read.worldId === worldId && read.ready
    && codexScope?.projectId === projectId && systemsScope?.projectId === projectId
    && (worldId == null || (codexScope.worldId === worldId && systemsScope.worldId === worldId))
  const readError = read?.error || (read?.ready && !ready ? '关联来源已切换，请重新读取。' : null)
  const owned = <T extends { projectId: number; worldId?: number }>(rows: T[]) => rows.filter(row =>
    row.projectId === projectId && (worldId == null || row.worldId === worldId))

  const raceCategoryIds = useMemo(() => new Set(categories
    .filter(category => category.builtInKey === 'race')
    .map(category => category.id)), [categories])
  const targetWorld = character.homeWorldGroupId ?? null
  const races = (ready ? owned(entries) : [])
    .filter(entry => raceCategoryIds.has(entry.categoryId))
    .filter(entry => character.isCrossWorld || codexEntryInWorld(entry, targetWorld))
  const visibleSystems = (ready ? owned(systems) : []).filter(system =>
    character.isCrossWorld || (system.worldGroupId ?? null) === targetWorld)
  const selectedSystem = (ready ? owned(systems) : []).find(system => system.id === character.cultivationSystemId)
  const stages = parseCultivationStages(selectedSystem?.stages)
  const worldName = (worldGroupId?: number | null) =>
    worldGroups.find(group => group.id === worldGroupId)?.name

  return (
    <div className="grid sm:grid-cols-3 gap-2 rounded-lg border border-border bg-bg-base/40 p-3">
      {!ready && <div className="sm:col-span-3 text-xs text-text-muted">
        {readError ? <><p role="alert">角色关联读取失败：{readError}；原关联未更改。</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新读取</button></> : <p role="status">正在读取角色关联…</p>}
      </div>}
      <label className="min-w-0">
        <span className="block text-[11px] text-text-muted mb-1">结构化种族</span>
        <select
          aria-label="结构化种族"
          disabled={!ready}
          value={character.raceEntryId ?? ''}
          onChange={event => ready && onChange({ raceEntryId: event.target.value ? Number(event.target.value) : null })}
          className="w-full px-2 py-1.5 bg-bg-elevated border border-border rounded text-xs text-text-primary"
        >
          <option value="">未关联</option>
          {races.map(entry => (
            <option key={entry.id} value={entry.id}>
              {entry.name}{character.isCrossWorld && worldName(entry.worldGroupId) ? ` · ${worldName(entry.worldGroupId)}` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0">
        <span className="block text-[11px] text-text-muted mb-1">主修体系</span>
        <select
          aria-label="主修体系"
          disabled={!ready}
          value={character.cultivationSystemId ?? ''}
          onChange={event => ready && onChange({
            cultivationSystemId: event.target.value ? Number(event.target.value) : null,
            cultivationStageId: null,
          })}
          className="w-full px-2 py-1.5 bg-bg-elevated border border-border rounded text-xs text-text-primary"
        >
          <option value="">未关联</option>
          {visibleSystems.map(system => (
            <option key={system.id} value={system.id}>
              {system.name}{character.isCrossWorld && worldName(system.worldGroupId) ? ` · ${worldName(system.worldGroupId)}` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-0">
        <span className="block text-[11px] text-text-muted mb-1">当前设定境界</span>
        <select
          aria-label="当前设定境界"
          disabled={!selectedSystem}
          value={character.cultivationStageId ?? ''}
          onChange={event => ready && onChange({ cultivationStageId: event.target.value || null })}
          className="w-full px-2 py-1.5 bg-bg-elevated border border-border rounded text-xs text-text-primary disabled:opacity-40"
        >
          <option value="">未指定</option>
          {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </select>
      </label>
    </div>
  )
}
