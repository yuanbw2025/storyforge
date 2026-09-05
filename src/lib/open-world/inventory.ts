import type {
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

type Inventory = TextOpenWorldEffectStateV1['inventory']
type Item = TextOpenWorldParsedModulesV1['items']['items'][number]
type EquipmentSlots = { weapon: string | null; armor: string | null; accessory: string | null }

function fail(message: string): never { throw new Error(`[text-open-world-inventory] ${message}`) }

export function createInitialTextOpenWorldInventoryV1(modules: TextOpenWorldParsedModulesV1): Pick<Inventory, 'stackQuantities' | 'itemInstances'> {
  const stackQuantities: Record<string, number> = {}
  const itemInstances: Inventory['itemInstances'] = {}
  modules.actors.player.build.startingItemKeys.forEach((itemKey, index) => {
    const item = modules.items.items.find(candidate => candidate.key === itemKey) ?? fail(`初始物品不存在:${itemKey}`)
    if (item.stackPolicy === 'stacked') stackQuantities[itemKey] = (stackQuantities[itemKey] ?? 0) + 1
    else itemInstances[`instance.initial.${index + 1}.${itemKey}`] = { itemKey, acquiredByClaimKey: 'initial-build', stateTags: ['new'] }
  })
  return { stackQuantities, itemInstances }
}

export function deriveTextOpenWorldInventoryQuantitiesV1(modules: TextOpenWorldParsedModulesV1, inventory: Inventory): Record<string, number> {
  const quantities = structuredClone(inventory.stackQuantities)
  Object.values(inventory.itemInstances).forEach(instance => { quantities[instance.itemKey] = (quantities[instance.itemKey] ?? 0) + 1 })
  for (const item of modules.items.items) if ((quantities[item.key] ?? 0) <= 0) delete quantities[item.key]
  return quantities
}

export function deriveTextOpenWorldEquippedItemKeysV1(modules: TextOpenWorldParsedModulesV1, inventory: Inventory): EquipmentSlots {
  const slots = inventory.equippedItemInstanceIdBySlot
  const actual = Object.keys(slots).sort().join(',')
  if (actual !== ['accessory', 'armor', 'weapon'].sort().join(',')) fail(`装备位字段无效:${actual}`)
  return Object.fromEntries(Object.entries(slots).map(([slot, instanceId]) => {
    if (instanceId == null) return [slot, null]
    const instance = inventory.itemInstances[instanceId] ?? fail(`装备位引用未知物品实例:${slot}:${instanceId}`)
    const definition = modules.items.items.find(item => item.key === instance.itemKey) ?? fail(`装备位引用未知物品:${instance.itemKey}`)
    if (definition.kind !== 'equipment' || definition.equipmentSlotKey !== slot) fail(`物品实例不能装备到${slot}:${instanceId}`)
    return [slot, definition.key]
  })) as EquipmentSlots
}

export function createTextOpenWorldInventoryCatalogV1(runtimePackage: TextOpenWorldRuntimePackageV1) {
  const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const itemByKey = new Map(modules.items.items.map(item => [item.key, item]))
  const project = (inventory: Inventory) => {
    const quantities = deriveTextOpenWorldInventoryQuantitiesV1(modules, inventory)
    return Object.entries(quantities).map(([itemKey, quantity]) => {
      const item = itemByKey.get(itemKey) ?? fail(`库存引用未知物品:${itemKey}`)
      const instances = Object.entries(inventory.itemInstances).filter(([, instance]) => instance.itemKey === itemKey)
        .map(([itemInstanceId, instance]) => ({
          itemInstanceId, ...structuredClone(instance),
          equippedSlotKey: Object.entries(inventory.equippedItemInstanceIdBySlot).find(([, equippedId]) => equippedId === itemInstanceId)?.[0] ?? null,
        }))
      return {
        key: itemKey, item: structuredClone(item), quantity, instances,
        actions: { usable: item.consumable, droppable: item.droppable, sellable: item.sellable, equipable: item.kind === 'equipment' },
      }
    })
  }
  return {
    get: (itemKey: string): Item | null => itemByKey.has(itemKey) ? structuredClone(itemByKey.get(itemKey)!) : null,
    quantity: (inventory: Inventory, itemKey: string): number => deriveTextOpenWorldInventoryQuantitiesV1(modules, inventory)[itemKey] ?? 0,
    project,
  }
}

export function createTextOpenWorldItemInstanceIdV1(input: {
  appliedClaimCount: number
  effectKey: string
  ordinal: number
}): string {
  if (!Number.isSafeInteger(input.appliedClaimCount) || input.appliedClaimCount < 0 || !Number.isSafeInteger(input.ordinal) || input.ordinal < 1) fail('物品实例序号无效')
  return `instance.${input.appliedClaimCount + 1}.${input.effectKey}.${input.ordinal}`
}
