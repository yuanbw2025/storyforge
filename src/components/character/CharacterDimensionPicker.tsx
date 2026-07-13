import { dimensionsByGroup, defaultDimensionsForWeight, CHARACTER_DIMENSIONS, type CharacterDimensionKey } from '../../lib/character/character-dimensions'
import type { CharacterRoleWeight } from '../../lib/types/character'

const WEIGHT_PRESETS: Array<{ weight: CharacterRoleWeight; label: string }> = [
  { weight: 'main', label: '主要(全)' },
  { weight: 'secondary', label: '次要' },
  { weight: 'npc', label: 'NPC' },
  { weight: 'extra', label: '路人' },
]

interface Props {
  selected: Set<CharacterDimensionKey>
  onChange: (next: Set<CharacterDimensionKey>) => void
}

/**
 * 角色维度勾选器(共享)——生成时选"要生成哪些维度"、补全时选"要补哪些"。
 * 维度全部来自 CHARACTER_DIMENSIONS,加一个维度这里自动出现。
 */
export default function CharacterDimensionPicker({ selected, onChange }: Props) {
  const toggle = (key: CharacterDimensionKey) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }
  const applyPreset = (weight: CharacterRoleWeight) => onChange(new Set(defaultDimensionsForWeight(weight)))
  const allKeys = CHARACTER_DIMENSIONS.map(d => d.key)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-text-muted">按戏份:</span>
        {WEIGHT_PRESETS.map(p => (
          <button key={p.weight} onClick={() => applyPreset(p.weight)}
            className="px-2 py-0.5 text-[11px] rounded bg-bg-elevated border border-border text-text-secondary hover:text-accent hover:border-accent/50">
            {p.label}
          </button>
        ))}
        <span className="mx-1 text-border">|</span>
        <button onClick={() => onChange(new Set(allKeys))} className="px-2 py-0.5 text-[11px] rounded text-text-secondary hover:text-accent">全选</button>
        <button onClick={() => onChange(new Set())} className="px-2 py-0.5 text-[11px] rounded text-text-secondary hover:text-accent">清空</button>
        <span className="ml-auto text-[11px] text-text-muted">已选 {selected.size}/{allKeys.length}</span>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
        {dimensionsByGroup().map(({ group, dims }) => (
          <div key={group}>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-text-muted/70">{group}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {dims.map(d => (
                <label key={d.key} className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={selected.has(d.key)} onChange={() => toggle(d.key)} className="accent-accent" />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
