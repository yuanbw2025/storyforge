import type {
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldRuntimePackageV1,
} from '../../lib/types'
import {
  createTextOpenWorldInventoryCatalogV1,
  deriveTextOpenWorldEquippedItemKeysV1,
} from '../../lib/open-world/inventory'
import { parseTextOpenWorldModulesV1 } from '../../lib/open-world/modules'
import { deriveTextOpenWorldPlayerStatsFromModulesV1 } from '../../lib/open-world/player-stats'

interface Props {
  runtimePackage: TextOpenWorldRuntimePackageV1
  state: TextOpenWorldEffectStateV1
  actions: TextOpenWorldActionAvailabilityV1[]
  busy: boolean
  onExecute: (actionKey: string, itemKey: string) => void
}

const STAT_LABELS = {
  maximumHealth: '生命上限', attack: '攻击', defense: '防御', criticalChance: '暴击', initiative: '先手', maximumSkillResource: '技能资源',
} as const

export default function TextOpenWorldEquipmentPanel({ runtimePackage, state, actions, busy, onExecute }: Props) {
  const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const inventory = createTextOpenWorldInventoryCatalogV1(runtimePackage).project(state.inventory)
  const equippedKeys = deriveTextOpenWorldEquippedItemKeysV1(modules, state.inventory)
  const currentStats = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules, level: state.player.level, attributes: state.player.attributes, equippedItemKeyBySlot: equippedKeys,
  })
  return <section className="rounded border border-border bg-bg-surface p-4" data-testid="text-open-world-equipment">
    <div className="mb-3 text-sm font-semibold">装备</div>
    <div className="grid gap-3 md:grid-cols-3">
      {modules.items.equipmentSlots.map(slot => {
        const currentItemKey = equippedKeys[slot.key]
        const currentItem = currentItemKey ? modules.items.items.find(item => item.key === currentItemKey) : null
        const unequipAction = currentItem?.unequipActionKey ? actions.find(item => item.action.key === currentItem.unequipActionKey && item.available) : null
        const candidates = inventory.filter(entry => entry.item.kind === 'equipment' && entry.item.equipmentSlotKey === slot.key && entry.item.key !== currentItemKey)
        return <article key={slot.key} className="rounded bg-bg-base p-3 text-xs">
          <small className="text-text-muted">{slot.label}</small>
          <strong className="mt-1 block">{currentItem?.title ?? '未装备'}</strong>
          {currentItem && <p className="mt-1 text-text-muted">{currentItem.description}</p>}
          {unequipAction && <button type="button" disabled={busy} onClick={() => onExecute(unequipAction.action.key, currentItem!.key)} className="mt-2 rounded border border-border px-2 py-1 disabled:opacity-40">卸下</button>}
          {candidates.length > 0 && <div className="mt-3 border-t border-border/60 pt-2">
            <small className="text-text-muted">可更换</small>
            {candidates.map(({ item, instances }) => {
              const action = item.equipActionKey ? actions.find(candidate => candidate.action.key === item.equipActionKey && candidate.available) : null
              const compared = deriveTextOpenWorldPlayerStatsFromModulesV1({
                modules, level: state.player.level, attributes: state.player.attributes,
                equippedItemKeyBySlot: { ...equippedKeys, [slot.key]: item.key },
              })
              const differences = (Object.keys(STAT_LABELS) as Array<keyof typeof STAT_LABELS>)
                .map(key => ({ key, difference: compared[key] - currentStats[key] })).filter(entry => entry.difference !== 0)
              return <div key={item.key} className="mt-2 rounded border border-border/60 p-2">
                <span className="flex justify-between gap-2"><strong>{item.title}</strong><small>×{instances.length}</small></span>
                <small className="mt-1 block text-text-muted">{differences.map(({ key, difference }) => `${STAT_LABELS[key]} ${difference > 0 ? '+' : ''}${key === 'criticalChance' ? Math.round(difference * 10_000) / 100 + '%' : difference}`).join(' · ') || '派生数值不变'}</small>
                {action
                  ? <button type="button" disabled={busy} onClick={() => onExecute(action.action.key, item.key)} className="mt-2 rounded border border-accent/40 px-2 py-1 text-accent disabled:opacity-40">装备</button>
                  : <small className="mt-2 block text-text-muted">当前条件不允许装备</small>}
              </div>
            })}
          </div>}
        </article>
      })}
    </div>
  </section>
}
