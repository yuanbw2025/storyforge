import type { NarrativeCondition, NarrativeEffect } from '../types'
import { avgBoolean, avgEnum, avgKey, avgList, avgNumber, avgRecord, avgText, avgUnique } from './protocol-validation'
import type { AvgStateSlotV1 } from './system-contract'

export const AVG_UNHELD_V1 = '@none'
export const AVG_ITEM_VERBS_V1 = ['gain','inspect','use','present','transfer','change-state','remove'] as const
export interface AvgInventoryPlanV1 {
  schema: 'storyforge.avg.inventory-plan'; version: 1
  items: Array<{ key: string; category: 'item' | 'evidence'; name: string; description: string; unique: boolean; maxQuantity: number
    states: string[]; transitions: Array<{ from: string; to: string }>; visibleWhen: NarrativeCondition
    variants: Array<{ key: string; when: NarrativeCondition; name: string; description: string; iconAssetKey: string | null; detailAssetKey: string | null }>
    iconAssetKey: string | null; detailAssetKey: string | null }>
  instances: Array<{ key: string; itemKey: string; holderKey: string; quantity: number; state: string; inspected: boolean }>
  actions: Array<{ key: string; instanceKey: string; verb: typeof AVG_ITEM_VERBS_V1[number]; target: { kind: 'character' | 'instance' | 'scene'; key: string } | null
    sceneKeys: string[]; label: string; unavailableReason: string; visibleWhen: NarrativeCondition; enabledWhen: NarrativeCondition
    once: boolean; effects: NarrativeEffect[]; feedback: string }>
}
function key(value: unknown, label: string): string {
  const result = avgKey(value, label)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(result) || ['constructor','prototype'].includes(result)) throw new Error(`[avg-inventory] ${label} 必须为安全标识`)
  return result
}
export function avgItemPathV1(instanceKey: string, field: 'holder' | 'quantity' | 'state' | 'inspected'): string {
  return `avg.inventory.instances.${key(instanceKey, 'instanceKey')}.${field}`
}
export function avgItemActionPathV1(actionKey: string): string { return `avg.inventory.actions.${key(actionKey, 'itemActionKey')}.performed` }
function asset(value: unknown): string | null { return value === null ? null : avgKey(value, 'item assetKey') }
/** Structural inventory parsing is shared by author, compiler and runtime.
 * Predicates/effects use the system's existing bounded finite grammar. */
export function parseAvgInventoryPlanV1(value: unknown, parsers: { condition(value: unknown): NarrativeCondition; effects(value: unknown): NarrativeEffect[] }): AvgInventoryPlanV1 {
  const row = avgRecord(value, ['schema','version','items','instances','actions'], 'inventory plan')
  if (row.schema !== 'storyforge.avg.inventory-plan' || row.version !== 1) throw new Error('[avg-inventory] schema/version 无效')
  const items = avgUnique(avgList(row.items, 'items', value => {
    const r = avgRecord(value, ['key','category','name','description','unique','maxQuantity','states','transitions','visibleWhen','variants','iconAssetKey','detailAssetKey'], 'item')
    const states = avgUnique(avgList(r.states, 'item states', key, 100), v => v, 'item states')
    if (!states.length) throw new Error('[avg-inventory] 物件状态不能为空')
    const transitions = avgUnique(avgList(r.transitions, 'transitions', value => {
      const t = avgRecord(value, ['from','to'], 'transition'), from = key(t.from, 'from'), to = key(t.to, 'to')
      if (!states.includes(from) || !states.includes(to) || from === to) throw new Error('[avg-inventory] 状态转换无效')
      return { from, to }
    }, 1000), t => `${t.from}:${t.to}`, 'transitions')
    const unique = avgBoolean(r.unique, 'unique'), maxQuantity = avgNumber(r.maxQuantity, 'maxQuantity', 1, 1_000_000)
    if (unique && maxQuantity !== 1) throw new Error('[avg-inventory] 唯一物件数量上限必须为 1')
    const variants = avgUnique(avgList(r.variants, 'variants', value => {
      const v = avgRecord(value, ['key','when','name','description','iconAssetKey','detailAssetKey'], 'item variant')
      return { key: key(v.key, 'variantKey'), when: parsers.condition(v.when), name: avgText(v.name, 'variant.name', 200), description: avgText(v.description, 'variant.description', 10_000), iconAssetKey: asset(v.iconAssetKey), detailAssetKey: asset(v.detailAssetKey) }
    }, 100), v => v.key, 'variants')
    return { key: key(r.key, 'itemKey'), category: avgEnum(r.category, ['item','evidence'] as const, 'category'), name: avgText(r.name, 'item.name', 200), description: avgText(r.description, 'item.description', 10_000), unique, maxQuantity,
      states, transitions, visibleWhen: parsers.condition(r.visibleWhen), variants, iconAssetKey: asset(r.iconAssetKey), detailAssetKey: asset(r.detailAssetKey) }
  }, 1000), v => v.key, 'items')
  const instances = avgUnique(avgList(row.instances, 'instances', value => {
    const r = avgRecord(value, ['key','itemKey','holderKey','quantity','state','inspected'], 'item instance')
    return { key: key(r.key, 'instanceKey'), itemKey: key(r.itemKey, 'itemKey'), holderKey: r.holderKey === AVG_UNHELD_V1 ? AVG_UNHELD_V1 : key(r.holderKey, 'holderKey'), quantity: avgNumber(r.quantity, 'quantity', 0, 1_000_000), state: key(r.state, 'state'), inspected: avgBoolean(r.inspected, 'inspected') }
  }, 2000), v => v.key, 'instances')
  for (const item of items) if (item.unique && instances.filter(i => i.itemKey === item.key).length > 1) throw new Error('[avg-inventory] 唯一物件不得创建多个实例')
  const actions = avgUnique(avgList(row.actions, 'item actions', value => {
    const r = avgRecord(value, ['key','instanceKey','verb','target','sceneKeys','label','unavailableReason','visibleWhen','enabledWhen','once','effects','feedback'], 'item action')
    const target = r.target === null ? null : (() => { const t = avgRecord(r.target, ['kind','key'], 'item target'); return { kind: avgEnum(t.kind, ['character','instance','scene'] as const, 'target.kind'), key: avgKey(t.key, 'target.key') } })()
    const verb = avgEnum(r.verb, AVG_ITEM_VERBS_V1, 'item verb'), once = avgBoolean(r.once, 'once')
    if (verb === 'inspect' && !once) throw new Error('[avg-inventory] 查看奖励必须仅执行一次')
    if ((verb === 'present' || verb === 'transfer') && target?.kind !== 'character') throw new Error('[avg-inventory] 出示/转移必须指定人物目标')
    const sceneKeys = avgUnique(avgList(r.sceneKeys, 'sceneKeys', avgKey, 1000), v => v, 'sceneKeys')
    if (!sceneKeys.length) throw new Error('[avg-inventory] 操作必须声明适用场景')
    return { key: key(r.key, 'itemActionKey'), instanceKey: key(r.instanceKey, 'instanceKey'), verb, target, sceneKeys, label: avgText(r.label, 'label', 200), unavailableReason: avgText(r.unavailableReason, 'unavailableReason', 1000),
      visibleWhen: parsers.condition(r.visibleWhen), enabledWhen: parsers.condition(r.enabledWhen), once, effects: parsers.effects(r.effects), feedback: avgText(r.feedback, 'feedback', 2000) }
  }, 5000), v => v.key, 'item actions')
  for (const i of instances) if (!items.some(item => item.key === i.itemKey)) throw new Error('[avg-inventory] 实例引用未知物件')
  for (const a of actions) if (!instances.some(i => i.key === a.instanceKey)) throw new Error('[avg-inventory] 操作引用未知实例')
  for (const i of instances) if (actions.filter(a => a.instanceKey === i.key && a.verb === 'inspect').length > 1) throw new Error('[avg-inventory] 同一实例只能声明一个首次查看操作')
  return { schema: 'storyforge.avg.inventory-plan', version: 1, items, instances, actions }
}
export function avgInventoryStateSlotsV1(inventory: AvgInventoryPlanV1, holders: string[]): AvgStateSlotV1[] {
  return [...inventory.instances.flatMap(i => {
    const item = inventory.items.find(item => item.key === i.itemKey)!
    return [
      { path: avgItemPathV1(i.key, 'holder'), definition: { key: `${i.key}.holder`, kind: 'enum' as const, initial: i.holderKey, values: [AVG_UNHELD_V1,'player',...holders], optional: false } },
      { path: avgItemPathV1(i.key, 'quantity'), definition: { key: `${i.key}.quantity`, kind: 'number' as const, initial: i.quantity, minimum: 0, maximum: item.maxQuantity, integer: true, optional: false } },
      { path: avgItemPathV1(i.key, 'state'), definition: { key: `${i.key}.state`, kind: 'enum' as const, initial: i.state, values: item.states, optional: false } },
      { path: avgItemPathV1(i.key, 'inspected'), definition: { key: `${i.key}.inspected`, kind: 'boolean' as const, initial: i.inspected, optional: false } },
    ]
  }), ...inventory.actions.map(a => ({ path: avgItemActionPathV1(a.key), definition: { key: a.key, kind: 'boolean' as const, initial: false, optional: false } }))]
}
