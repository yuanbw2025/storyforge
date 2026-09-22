import type {
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldActionUnavailableCodeV1,
  TextOpenWorldDerivedPlayerStatKeyV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import {
  deriveTextOpenWorldEquippedItemKeysV1,
  deriveTextOpenWorldInventoryQuantitiesV1,
  deriveTextOpenWorldRemovableInventoryQuantitiesV1,
} from './inventory'
import { parseTextOpenWorldModulesV1 } from './modules'
import { deriveTextOpenWorldPlayerStatsFromModulesV1 } from './player-stats'
import {
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from './session-projection'

export type TextOpenWorldPlayerInventoryCategoryV1 =
  | 'equipment' | 'consumable' | 'material' | 'quest' | 'misc'

export type TextOpenWorldPlayerEquipmentSlotV1 = 'weapon' | 'armor' | 'accessory'

export interface TextOpenWorldPlayerInventoryPublicReasonV1 {
  code: TextOpenWorldActionUnavailableCodeV1
  message: string
}

/** Stable keys are confined to this submission-only object and must not be rendered. */
export interface TextOpenWorldPlayerInventoryActionV1 {
  actionKey: string
  targetKey: string
  label: string
  description: string
  available: boolean
  confirmationPolicy: 'never' | 'high-risk' | 'always'
  confirmationRequired: boolean
  unavailableReasons: TextOpenWorldPlayerInventoryPublicReasonV1[]
}

export interface TextOpenWorldPlayerInventoryModifierV1 {
  semantic: TextOpenWorldDerivedPlayerStatKeyV1
  label: string
  value: number
  displayValue: string
}

export interface TextOpenWorldPlayerInventoryItemV1 {
  /** Submission target and stable UI identity; never display this internal key to the player. */
  operationTargetKey: string
  title: string
  description: string
  tags: string[]
  category: {
    kind: TextOpenWorldPlayerInventoryCategoryV1
    label: string
  }
  quantity: number
  equippedQuantity: number
  /** Units that a governed remove-item operation may consume without touching equipped instances. */
  removableQuantity: number
  equippedSlot: { semantic: TextOpenWorldPlayerEquipmentSlotV1; label: string } | null
  critical: boolean
  unique: boolean
  baseValue: { label: '基础价值'; amount: number }
  sourceSummary: string
  statModifiers: TextOpenWorldPlayerInventoryModifierV1[]
  protectionMessages: string[]
  actions: {
    use: TextOpenWorldPlayerInventoryActionV1 | null
    equip: TextOpenWorldPlayerInventoryActionV1 | null
    unequip: TextOpenWorldPlayerInventoryActionV1 | null
    drop: TextOpenWorldPlayerInventoryActionV1 | null
  }
  salePolicy: {
    sellable: boolean
    protected: boolean
    requiresMerchant: boolean
    message: string
  }
}

export interface TextOpenWorldPlayerEquipmentStatComparisonV1 {
  semantic: TextOpenWorldDerivedPlayerStatKeyV1
  label: string
  before: number
  after: number
  delta: number
  displayBefore: string
  displayAfter: string
  displayDelta: string
  direction: 'increase' | 'decrease' | 'unchanged'
}

export interface TextOpenWorldPlayerEquipmentChangePreviewV1 {
  stats: TextOpenWorldPlayerEquipmentStatComparisonV1[]
  resourceAdjustmentMessages: string[]
}

export interface TextOpenWorldPlayerEquipmentCandidateV1 {
  /** Submission target and stable UI identity; never display this internal key to the player. */
  operationTargetKey: string
  title: string
  quantity: number
  removableQuantity: number
  equipAction: TextOpenWorldPlayerInventoryActionV1 | null
  preview: TextOpenWorldPlayerEquipmentChangePreviewV1
}

export interface TextOpenWorldPlayerEquipmentSlotProjectionV1 {
  semantic: TextOpenWorldPlayerEquipmentSlotV1
  label: string
  current: {
    /** Submission target and stable UI identity; never display this internal key to the player. */
    operationTargetKey: string
    title: string
    unequipAction: TextOpenWorldPlayerInventoryActionV1 | null
    preview: TextOpenWorldPlayerEquipmentChangePreviewV1
  } | null
  candidates: TextOpenWorldPlayerEquipmentCandidateV1[]
}

export interface TextOpenWorldPlayerInventoryProjectionV1 {
  summary: {
    currency: { label: string; amount: number }
    distinctItemCount: number
    totalQuantity: number
    equippedSlotCount: number
    totalSlotCount: number
  }
  categories: Array<{
    kind: TextOpenWorldPlayerInventoryCategoryV1
    label: string
    distinctItemCount: number
    totalQuantity: number
  }>
  items: TextOpenWorldPlayerInventoryItemV1[]
  equipmentSlots: TextOpenWorldPlayerEquipmentSlotProjectionV1[]
}

type Item = TextOpenWorldParsedModulesV1['items']['items'][number]
type Stats = ReturnType<typeof deriveTextOpenWorldPlayerStatsFromModulesV1>
type Slots = Record<TextOpenWorldPlayerEquipmentSlotV1, string | null>

const CATEGORY_ORDER: TextOpenWorldPlayerInventoryCategoryV1[] = [
  'equipment',
  'consumable',
  'material',
  'quest',
  'misc',
]

const CATEGORY_LABELS: Record<TextOpenWorldPlayerInventoryCategoryV1, string> = {
  equipment: '装备',
  consumable: '消耗品',
  material: '材料',
  quest: '任务物品',
  misc: '其他',
}

const STAT_ORDER: TextOpenWorldDerivedPlayerStatKeyV1[] = [
  'maximumHealth',
  'attack',
  'defense',
  'criticalChance',
  'initiative',
  'maximumSkillResource',
]

const STAT_LABELS: Record<TextOpenWorldDerivedPlayerStatKeyV1, string> = {
  maximumHealth: '最大生命',
  attack: '攻击',
  defense: '防御',
  criticalChance: '暴击率',
  initiative: '先手',
  maximumSkillResource: '技能资源上限',
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function displayNumber(value: number, percentage: boolean): string {
  if (!percentage) return String(value)
  return `${Math.round(value * 10_000) / 100}%`
}

function displayDelta(value: number, percentage: boolean): string {
  const rendered = displayNumber(Math.abs(value), percentage)
  return value > 0 ? `+${rendered}` : value < 0 ? `-${rendered}` : rendered
}

function actionForItem(
  availability: TextOpenWorldActionAvailabilityV1 | undefined,
  itemKey: string,
  extraReasons: TextOpenWorldPlayerInventoryPublicReasonV1[] = [],
): TextOpenWorldPlayerInventoryActionV1 | null {
  if (!availability) return null
  const rawReasons = [
    ...availability.unavailableReasons.map(reason => ({ code: reason.code, message: reason.message })),
    ...extraReasons,
  ]
  const preferredCodes = new Set(extraReasons.map(reason => reason.code))
  const unavailableReasons = rawReasons.filter((reason, index) => {
    if (preferredCodes.has(reason.code) && !extraReasons.includes(reason)) return false
    if (reason.code === 'no-valid-target' && rawReasons.some(candidate => candidate.code === 'item-unavailable')) return false
    return rawReasons.findIndex(candidate => candidate.code === reason.code && candidate.message === reason.message) === index
  })
  const targetAvailable = availability.validTargetKeys.includes(itemKey)
  if (!targetAvailable
    && !unavailableReasons.some(reason => reason.code === 'no-valid-target' || reason.code === 'item-unavailable')) {
    unavailableReasons.push({ code: 'no-valid-target', message: '当前没有可作用的该物品。' })
  }
  return {
    actionKey: availability.action.key,
    targetKey: itemKey,
    label: availability.action.label,
    description: availability.action.description,
    available: availability.available && targetAvailable && unavailableReasons.length === 0,
    confirmationPolicy: availability.action.confirmationPolicy,
    confirmationRequired: availability.confirmationRequired,
    unavailableReasons,
  }
}

function equipmentCountByItemKey(
  inventory: TextOpenWorldSessionProjectionV1['state']['inventory'],
): Record<string, number> {
  const result: Record<string, number> = {}
  Object.values(inventory.equippedItemInstanceIdBySlot).forEach(instanceId => {
    if (instanceId == null) return
    const itemKey = inventory.itemInstances[instanceId]!.itemKey
    result[itemKey] = (result[itemKey] ?? 0) + 1
  })
  return result
}

function statModifiers(item: Item): TextOpenWorldPlayerInventoryModifierV1[] {
  const modifierByStat: Partial<Record<TextOpenWorldDerivedPlayerStatKeyV1, number>> = {
    maximumHealth: item.statModifiers.maximumHealth,
    attack: item.statModifiers.attack,
    defense: item.statModifiers.defense,
    criticalChance: item.statModifiers.criticalChance,
    initiative: item.statModifiers.initiative,
    maximumSkillResource: item.statModifiers.skillResource,
  }
  return STAT_ORDER.flatMap(semantic => {
    const value = modifierByStat[semantic]
    if (value == null) return []
    return [{
      semantic,
      label: STAT_LABELS[semantic],
      value,
      displayValue: displayDelta(value, semantic === 'criticalChance'),
    }]
  })
}

function comparison(before: Stats, after: Stats): TextOpenWorldPlayerEquipmentStatComparisonV1[] {
  return STAT_ORDER.map(semantic => {
    const beforeValue = before[semantic]
    const afterValue = after[semantic]
    const delta = afterValue - beforeValue
    const percentage = semantic === 'criticalChance'
    return {
      semantic,
      label: STAT_LABELS[semantic],
      before: beforeValue,
      after: afterValue,
      delta,
      displayBefore: displayNumber(beforeValue, percentage),
      displayAfter: displayNumber(afterValue, percentage),
      displayDelta: displayDelta(delta, percentage),
      direction: delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'unchanged',
    }
  })
}

function projectedResourceValue(current: number, afterMaximum: number): number {
  return Math.min(current, afterMaximum)
}

function changePreview(input: {
  projection: TextOpenWorldSessionProjectionV1
  modules: TextOpenWorldParsedModulesV1
  before: Stats
  slots: Slots
}): TextOpenWorldPlayerEquipmentChangePreviewV1 {
  const after = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules: input.modules,
    level: input.projection.state.player.level,
    attributes: input.projection.state.player.attributes,
    equippedItemKeyBySlot: input.slots,
  })
  const health = projectedResourceValue(
    input.projection.state.player.health,
    after.maximumHealth,
  )
  const skillResource = projectedResourceValue(
    input.projection.state.player.skillResource,
    after.maximumSkillResource,
  )
  const resourceAdjustmentMessages: string[] = []
  if (health !== input.projection.state.player.health) {
    resourceAdjustmentMessages.push(`当前生命将由${input.projection.state.player.health}调整为${health}。`)
  }
  if (skillResource !== input.projection.state.player.skillResource) {
    resourceAdjustmentMessages.push(`当前技能资源将由${input.projection.state.player.skillResource}调整为${skillResource}。`)
  }
  return { stats: comparison(input.before, after), resourceAdjustmentMessages }
}

/**
 * Disclosure-safe inventory/equipment screen projection.
 *
 * Definitions and action/effect bindings are inspected only inside this pure
 * projector. The returned DTO exposes player-facing copy and the minimum
 * stable submission keys required to execute governed Actions.
 */
export function projectTextOpenWorldPlayerInventoryV1(
  value: TextOpenWorldSessionProjectionV1 | unknown,
): TextOpenWorldPlayerInventoryProjectionV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(value)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const contexts = deriveTextOpenWorldContextsV1(projection)
  const quantities = deriveTextOpenWorldInventoryQuantitiesV1(modules, projection.state.inventory)
  const removableQuantities = deriveTextOpenWorldRemovableInventoryQuantitiesV1(modules, projection.state.inventory)
  const equippedBySlot = deriveTextOpenWorldEquippedItemKeysV1(modules, projection.state.inventory)
  const equippedCounts = equipmentCountByItemKey(projection.state.inventory)
  const projectedActions = createTextOpenWorldActionRegistryV1(projection.runtimePackage)
    .project(contexts.action)
  const actionByKey = new Map(projectedActions.map(action => [action.action.key, action]))
  const effectByKey = new Map(modules.actions.effects.map(effect => [effect.key, effect]))
  const dropActionByItemKey = new Map<string, TextOpenWorldActionAvailabilityV1>()
  projectedActions.filter(projected => projected.action.category === 'drop').forEach(projected => {
    const removals = projected.action.costEffectKeys
      .map(effectKey => effectByKey.get(effectKey))
      .filter(effect => effect?.operation === 'remove-item' && effect.payload.reason === 'drop')
    if (removals.length === 1 && removals[0]?.operation === 'remove-item') {
      dropActionByItemKey.set(removals[0].payload.itemKey, projected)
    }
  })
  const slotLabelByKey = new Map(modules.items.equipmentSlots.map(slot => [slot.key, slot.label]))
  const initialItemKeys = new Set(modules.actors.player.build.startingItemKeys)

  const items = modules.items.items.flatMap(item => {
    const quantity = quantities[item.key] ?? 0
    if (quantity <= 0) return []
    const equippedQuantity = equippedCounts[item.key] ?? 0
    const physicallyUnequipped = removableQuantities[item.key] ?? 0
    const removableQuantity = item.critical ? 0 : physicallyUnequipped
    const dropExtraReasons: TextOpenWorldPlayerInventoryPublicReasonV1[] = []
    if (item.critical) dropExtraReasons.push({ code: 'item-unavailable', message: '关键物品受到保护，不能丢弃。' })
    else if (!item.droppable) dropExtraReasons.push({ code: 'item-unavailable', message: '此物品不能丢弃。' })
    else if (removableQuantity === 0) dropExtraReasons.push({ code: 'item-unavailable', message: '当前没有可丢弃的未装备物品。' })

    const protectionMessages = [
      ...(item.critical ? ['关键物品受到保护，不能丢弃、出售或作为材料消耗。'] : []),
      ...(!item.critical && !item.droppable ? ['此物品不能丢弃。'] : []),
      ...(!item.critical && !item.sellable ? ['此物品不能出售。'] : []),
    ]
    const catalogSellable = item.sellable && !item.critical
    const sellable = catalogSellable && removableQuantity > 0
    const itemProjection: TextOpenWorldPlayerInventoryItemV1 = {
      operationTargetKey: item.key,
      title: item.title,
      description: item.description,
      tags: [...item.tags],
      category: { kind: item.kind, label: CATEGORY_LABELS[item.kind] },
      quantity,
      equippedQuantity,
      removableQuantity,
      equippedSlot: item.equipmentSlotKey && equippedBySlot[item.equipmentSlotKey] === item.key
        ? { semantic: item.equipmentSlotKey, label: slotLabelByKey.get(item.equipmentSlotKey)! }
        : null,
      critical: item.critical,
      unique: item.unique,
      baseValue: { label: '基础价值', amount: item.baseValue },
      sourceSummary: initialItemKeys.has(item.key) ? '初始配置包含此物品。' : '冒险途中获得。',
      statModifiers: statModifiers(item),
      protectionMessages,
      actions: {
        use: item.useActionKey ? actionForItem(actionByKey.get(item.useActionKey), item.key) : null,
        equip: item.equipActionKey ? actionForItem(actionByKey.get(item.equipActionKey), item.key) : null,
        unequip: item.unequipActionKey ? actionForItem(actionByKey.get(item.unequipActionKey), item.key) : null,
        drop: actionForItem(dropActionByItemKey.get(item.key), item.key, dropExtraReasons),
      },
      salePolicy: sellable
        ? {
            sellable: true,
            protected: false,
            requiresMerchant: true,
            message: '需前往商店交易，实际售价以商店结算为准。',
          }
        : catalogSellable
          ? {
              sellable: false,
              protected: false,
              requiresMerchant: true,
              message: '当前没有可出售的未装备物品；请先卸下装备，再前往商店交易。',
            }
        : {
            sellable: false,
            protected: item.critical || !item.sellable,
            requiresMerchant: false,
            message: item.critical ? '关键物品受到保护，不能出售。' : '此物品不能出售。',
          },
    }
    return [itemProjection]
  }).sort((left, right) => (
    CATEGORY_ORDER.indexOf(left.category.kind) - CATEGORY_ORDER.indexOf(right.category.kind)
      || compareText(left.title, right.title)
      || compareText(left.operationTargetKey, right.operationTargetKey)
  ))

  const itemByOperationTargetKey = new Map(items.map(item => [item.operationTargetKey, item]))
  const currentStats = contexts.playerStats
  const equipmentSlots = modules.items.equipmentSlots.map(slot => {
    const currentItemKey = equippedBySlot[slot.key]
    const currentItem = currentItemKey ? itemByOperationTargetKey.get(currentItemKey) ?? null : null
    const candidates = items
      .filter(item => item.category.kind === 'equipment'
        && modules.items.items.find(definition => definition.key === item.operationTargetKey)?.equipmentSlotKey === slot.key
        && item.operationTargetKey !== currentItemKey)
      .map(item => ({
        operationTargetKey: item.operationTargetKey,
        title: item.title,
        quantity: item.quantity,
        removableQuantity: item.removableQuantity,
        equipAction: item.actions.equip,
        preview: changePreview({
          projection,
          modules,
          before: currentStats,
          slots: { ...equippedBySlot, [slot.key]: item.operationTargetKey },
        }),
      }))
    return {
      semantic: slot.key,
      label: slot.label,
      current: currentItem ? {
        operationTargetKey: currentItem.operationTargetKey,
        title: currentItem.title,
        unequipAction: currentItem.actions.unequip,
        preview: changePreview({
          projection,
          modules,
          before: currentStats,
          slots: { ...equippedBySlot, [slot.key]: null },
        }),
      } : null,
      candidates,
    }
  })

  const categories = CATEGORY_ORDER.map(kind => {
    const matching = items.filter(item => item.category.kind === kind)
    return {
      kind,
      label: CATEGORY_LABELS[kind],
      distinctItemCount: matching.length,
      totalQuantity: matching.reduce((sum, item) => sum + item.quantity, 0),
    }
  })

  return {
    summary: {
      currency: { label: modules.economy.currency.label, amount: projection.state.inventory.currency },
      distinctItemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      equippedSlotCount: Object.values(equippedBySlot).filter(itemKey => itemKey != null).length,
      totalSlotCount: modules.items.equipmentSlots.length,
    },
    categories,
    items,
    equipmentSlots,
  }
}
