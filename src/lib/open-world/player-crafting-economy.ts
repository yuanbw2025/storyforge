import type {
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldActionUnavailableCodeV1,
  TextOpenWorldDerivedPlayerStatKeyV1,
  TextOpenWorldFeedbackReceiptV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import { projectTextOpenWorldActorsV1 } from './actors'
import {
  createTextOpenWorldCraftingCatalogV1,
  type TextOpenWorldCraftingProjectionV1,
} from './crafting'
import {
  createTextOpenWorldEconomyCatalogV1,
  type TextOpenWorldTransactionItemProjectionV1,
  type TextOpenWorldTransactionUnavailableReasonV1,
} from './economy'
import {
  deriveTextOpenWorldEquippedItemKeysV1,
  deriveTextOpenWorldInventoryQuantitiesV1,
} from './inventory'
import { parseTextOpenWorldModulesV1 } from './modules'
import {
  deriveTextOpenWorldEquipmentSkillPowerFromModulesV1,
  deriveTextOpenWorldPlayerStatsFromModulesV1,
} from './player-stats'
import {
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from './session-projection'

type Item = TextOpenWorldParsedModulesV1['items']['items'][number]
type Vendor = TextOpenWorldParsedModulesV1['economy']['vendors'][number]
type TransactionKind = 'buy' | 'sell'

function fail(message: string): never {
  throw new Error(`[text-open-world-player-crafting-economy] ${message}`)
}

export type TextOpenWorldPlayerCraftingEconomyUnavailableCodeV1 =
  | TextOpenWorldActionUnavailableCodeV1
  | TextOpenWorldCraftingProjectionV1['unavailableReasons'][number]
  | TextOpenWorldTransactionUnavailableReasonV1
  | 'legacy-read-only'
  | 'operation-pending'

export interface TextOpenWorldPlayerCraftingEconomyPublicReasonV1 {
  code: TextOpenWorldPlayerCraftingEconomyUnavailableCodeV1
  message: string
}

/** Opaque submission fields are intentionally separated from renderable copy. */
export interface TextOpenWorldPlayerCraftActionV1 {
  actionKey: string
  targetKey: string
  label: string
  description: string
  available: boolean
  confirmationRequired: boolean
}

export interface TextOpenWorldPlayerTransactionActionV1 {
  actionKey: string
  targetKey: string
  itemKey: string
  label: string
  description: string
  available: boolean
  confirmationRequired: boolean
}

export interface TextOpenWorldPlayerCraftingMaterialV1 {
  title: string
  requiredQuantity: number
  inventoryQuantity: number
  sufficient: boolean
}

export interface TextOpenWorldPlayerCraftingOutputV1 {
  title: string
  quantity: number
}

export interface TextOpenWorldPlayerCraftingRecipeV1 {
  /** Opaque stable identity used for UI selection and submission; never render it. */
  operationTargetKey: string
  title: string
  description: string
  categoryLabel: string
  ingredients: TextOpenWorldPlayerCraftingMaterialV1[]
  outputs: TextOpenWorldPlayerCraftingOutputV1[]
  timeCostMinutes: number
  maximumQuantity: number
  totalTimeCostAtMaximumQuantity: number
  available: boolean
  unavailableReasons: TextOpenWorldPlayerCraftingEconomyPublicReasonV1[]
  action: TextOpenWorldPlayerCraftActionV1 | null
}

export interface TextOpenWorldPlayerLockedRecipePlaceholderV1 {
  title: '未学习配方'
  message: string
}

export interface TextOpenWorldPlayerPriceModifierV1 {
  label: string
  multiplier: number
  display: string
}

export interface TextOpenWorldPlayerTransactionStockV1 {
  kind: 'unlimited' | 'limited'
  quantity: number | null
  label: string
}

export type TextOpenWorldPlayerTradeComparedStatV1 =
  | TextOpenWorldDerivedPlayerStatKeyV1
  | 'skillPower'

export interface TextOpenWorldPlayerTradeStatComparisonV1 {
  semantic: TextOpenWorldPlayerTradeComparedStatV1
  label: string
  before: number
  after: number
  delta: number
  displayBefore: string
  displayAfter: string
  displayDelta: string
  direction: 'increase' | 'decrease' | 'unchanged'
}

export interface TextOpenWorldPlayerTradeEquipmentComparisonV1 {
  slotLabel: string
  currentTitle: string | null
  candidateTitle: string
  note: string
  stats: TextOpenWorldPlayerTradeStatComparisonV1[]
  resourceAdjustmentMessages: string[]
}

export interface TextOpenWorldPlayerTransactionItemV1 {
  /** Opaque stable identity used for UI selection and submission; never render it. */
  operationItemKey: string
  title: string
  description: string
  categoryLabel: string
  playerQuantity: number
  stock: TextOpenWorldPlayerTransactionStockV1
  /** Zero means this merchant made no offer; the public reason explains why. */
  unitPrice: number
  maximumQuantity: number
  totalPriceAtMaximumQuantity: number
  available: boolean
  unavailableReasons: TextOpenWorldPlayerCraftingEconomyPublicReasonV1[]
  action: TextOpenWorldPlayerTransactionActionV1 | null
  equipmentComparison: TextOpenWorldPlayerTradeEquipmentComparisonV1 | null
}

export interface TextOpenWorldPlayerVendorV1 {
  /** Opaque stable identity used for UI selection and submission; never render it. */
  operationTargetKey: string
  title: string
  merchantName: string
  available: boolean
  unavailableReasons: TextOpenWorldPlayerCraftingEconomyPublicReasonV1[]
  attitude: { semantic: 'bad' | 'neutral' | 'good'; label: string }
  priceExplanation: {
    buy: TextOpenWorldPlayerPriceModifierV1[]
    sell: TextOpenWorldPlayerPriceModifierV1[]
    buyRounding: string
    sellRounding: string
  }
  buy: TextOpenWorldPlayerTransactionItemV1[]
  sell: TextOpenWorldPlayerTransactionItemV1[]
}

export interface TextOpenWorldPlayerCraftingEconomyProjectionV1 {
  schema: 'storyforge.text-open-world.player-crafting-economy-projection'
  version: 1
  operationIdentity: {
    sessionId: number
    expectedBaseSequence: number
  }
  compatibility: {
    craftingReadOnly: boolean
    economyReadOnly: boolean
    notice: string | null
  }
  location: { title: string }
  currency: { label: string; amount: number }
  crafting: {
    learnedRecipes: TextOpenWorldPlayerCraftingRecipeV1[]
    lockedRecipeCount: number
    lockedPlaceholder: TextOpenWorldPlayerLockedRecipePlaceholderV1
  }
  vendors: TextOpenWorldPlayerVendorV1[]
}

export type TextOpenWorldPlayerCraftingEconomyExecuteRequestV1 =
  | {
      kind: 'craft'
      sessionId: number
      expectedBaseSequence: number
      actionKey: string
      targetKey: string
      quantity: number
    }
  | {
      kind: TransactionKind
      sessionId: number
      expectedBaseSequence: number
      actionKey: string
      targetKey: string
      itemKey: string
      quantity: number
    }

/**
 * Render-safe receipt. `details` must only come from the sanitizer below; raw
 * Effect change summaries contain stable keys and are never copied through.
 */
export interface TextOpenWorldPlayerCraftingEconomyReceiptV1 {
  request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1
  phase: 'preflight' | 'pending' | 'terminal'
  status: TextOpenWorldFeedbackReceiptV1['status']
  outcomeCommitted: boolean
  resultingSequence: number | null
  title: string
  message: string
  details: string[]
}

const CATEGORY_LABELS = {
  equipment: '装备',
  consumable: '消耗品',
  tool: '工具',
  material: '材料',
  quest: '任务物品',
  misc: '其他',
} as const

const STAT_ORDER: TextOpenWorldPlayerTradeComparedStatV1[] = [
  'maximumHealth',
  'attack',
  'defense',
  'criticalChance',
  'initiative',
  'maximumSkillResource',
  'skillPower',
]

const STAT_LABELS: Record<TextOpenWorldPlayerTradeComparedStatV1, string> = {
  maximumHealth: '最大生命',
  attack: '攻击',
  defense: '防御',
  criticalChance: '暴击率',
  initiative: '先手',
  maximumSkillResource: '技能资源上限',
  skillPower: '技能威力',
}

const CRAFTING_REASON_MESSAGES: Record<
  TextOpenWorldCraftingProjectionV1['unavailableReasons'][number],
  string
> = {
  'recipe-unknown': '此配方尚未学习。',
  'wrong-station': '当前位置没有制作此配方所需的设施。',
  'materials-insufficient': '当前材料不足。',
  'output-capacity': '背包无法容纳更多产物。',
}

const TRANSACTION_REASON_MESSAGES: Record<TextOpenWorldTransactionUnavailableReasonV1, string> = {
  'vendor-unavailable': '商人当前没有提供交易服务。',
  'item-not-offered': '商人当前没有出售此物品。',
  'item-not-accepted': '商人不收购这类物品。',
  'stock-insufficient': '商人库存不足。',
  'currency-insufficient': '持有货币不足。',
  'inventory-insufficient': '当前没有可出售的此物品。',
  'item-protected': '此物品受到保护，不能出售。',
  'item-equipped': '已装备物品不能直接出售，请先卸下。',
  'inventory-capacity': '背包无法容纳更多此物品。',
  'currency-capacity': '持有货币已接近上限，无法完成出售。',
}

function bounded(value: string, maximum = 1_000): string {
  const normalized = value.trim().normalize('NFC')
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(1, maximum - 1))}…`
}

function uniqueReasons(
  reasons: readonly TextOpenWorldPlayerCraftingEconomyPublicReasonV1[],
): TextOpenWorldPlayerCraftingEconomyPublicReasonV1[] {
  return reasons
    .map(reason => ({ code: reason.code, message: bounded(reason.message) }))
    .filter((reason, index, values) => values.findIndex(candidate => (
      candidate.code === reason.code && candidate.message === reason.message
    )) === index)
}

function actionReasons(
  availability: TextOpenWorldActionAvailabilityV1 | undefined,
  targetKey: string,
  hasSpecificReason: boolean,
): TextOpenWorldPlayerCraftingEconomyPublicReasonV1[] {
  if (!availability) return []
  const reasons = availability.unavailableReasons.flatMap(reason => {
    if (reason.code === 'no-valid-target' && hasSpecificReason) return []
    return [{ code: reason.code, message: reason.message }]
  })
  if (!availability.validTargetKeys.includes(targetKey) && !hasSpecificReason
    && !reasons.some(reason => reason.code === 'no-valid-target')) {
    reasons.push({ code: 'no-valid-target', message: '此操作当前没有可用目标。' })
  }
  return uniqueReasons(reasons)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function safeMultiply(left: number, right: number, label: string): number {
  const result = BigInt(left) * BigInt(right)
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${label}超过安全整数范围`)
  return Number(result)
}

function displayNumber(value: number, percentage: boolean): string {
  if (!percentage) return String(value)
  return `${Math.round(value * 10_000) / 100}%`
}

function displayDelta(value: number, percentage: boolean): string {
  const rendered = displayNumber(Math.abs(value), percentage)
  return value > 0 ? `+${rendered}` : value < 0 ? `-${rendered}` : rendered
}

function multiplierDisplay(value: number): string {
  const fixed = value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return `×${fixed}`
}

function operationPendingReason(): TextOpenWorldPlayerCraftingEconomyPublicReasonV1 {
  return { code: 'operation-pending', message: '上一项操作正在结算，请稍候。' }
}

function readOnlyReason(kind: 'crafting' | 'economy'): TextOpenWorldPlayerCraftingEconomyPublicReasonV1 {
  return {
    code: 'legacy-read-only',
    message: kind === 'crafting'
      ? '此存档使用旧版制作目录，只能查看配方。'
      : '此存档使用旧版经济目录，只能查看商品与价格。',
  }
}

function craftingActionForRecipe(
  modules: TextOpenWorldParsedModulesV1,
  projectedActions: readonly TextOpenWorldActionAvailabilityV1[],
  recipeKey: string,
): TextOpenWorldActionAvailabilityV1 | undefined {
  return projectedActions.find(projected => projected.action.category === 'craft'
    && projected.action.successEffectKeys.some(effectKey => {
      const effect = modules.actions.effects.find(candidate => candidate.key === effectKey)
      return effect?.operation === 'perform-crafting' && effect.payload.recipeKey === recipeKey
    }))
}

function transactionAction(
  projectedActions: readonly TextOpenWorldActionAvailabilityV1[],
  actionKey: string | null,
): TextOpenWorldActionAvailabilityV1 | undefined {
  return actionKey == null
    ? undefined
    : projectedActions.find(projected => projected.action.key === actionKey)
}

function equipmentComparison(input: {
  item: Item
  modules: TextOpenWorldParsedModulesV1
  projection: TextOpenWorldSessionProjectionV1
}): TextOpenWorldPlayerTradeEquipmentComparisonV1 | null {
  if (input.item.kind !== 'equipment' || !input.item.equipmentSlotKey) return null
  const equipped = deriveTextOpenWorldEquippedItemKeysV1(input.modules, input.projection.state.inventory)
  const currentItemKey = equipped[input.item.equipmentSlotKey]
  const before = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules: input.modules,
    level: input.projection.state.player.level,
    attributes: input.projection.state.player.attributes,
    equippedItemKeyBySlot: equipped,
  })
  const afterEquipment = { ...equipped, [input.item.equipmentSlotKey]: input.item.key }
  const after = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules: input.modules,
    level: input.projection.state.player.level,
    attributes: input.projection.state.player.attributes,
    equippedItemKeyBySlot: afterEquipment,
  })
  const beforeSkillPower = deriveTextOpenWorldEquipmentSkillPowerFromModulesV1({
    modules: input.modules,
    equippedItemKeyBySlot: equipped,
  })
  const afterSkillPower = deriveTextOpenWorldEquipmentSkillPowerFromModulesV1({
    modules: input.modules,
    equippedItemKeyBySlot: afterEquipment,
  })
  const value = (semantic: TextOpenWorldPlayerTradeComparedStatV1, side: 'before' | 'after') => {
    if (semantic === 'skillPower') return side === 'before' ? beforeSkillPower : afterSkillPower
    return side === 'before' ? before[semantic] : after[semantic]
  }
  const stats = STAT_ORDER.map(semantic => {
    const beforeValue = value(semantic, 'before')
    const afterValue = value(semantic, 'after')
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
      direction: delta > 0 ? 'increase' as const : delta < 0 ? 'decrease' as const : 'unchanged' as const,
    }
  })
  const resourceAdjustmentMessages: string[] = []
  const projectedHealth = Math.min(input.projection.state.player.health, after.maximumHealth)
  const projectedSkillResource = Math.min(
    input.projection.state.player.skillResource,
    after.maximumSkillResource,
  )
  if (projectedHealth !== input.projection.state.player.health) {
    resourceAdjustmentMessages.push(`若装备此物品，当前生命将由${input.projection.state.player.health}调整为${projectedHealth}。`)
  }
  if (projectedSkillResource !== input.projection.state.player.skillResource) {
    resourceAdjustmentMessages.push(`若装备此物品，当前技能资源将由${input.projection.state.player.skillResource}调整为${projectedSkillResource}。`)
  }
  return {
    slotLabel: input.modules.items.equipmentSlots.find(slot => slot.key === input.item.equipmentSlotKey)?.label
      ?? fail('装备位公开名称缺失'),
    currentTitle: currentItemKey
      ? input.modules.items.items.find(item => item.key === currentItemKey)?.title ?? fail('当前装备定义缺失')
      : null,
    candidateTitle: input.item.title,
    note: '这是替换当前装备后的属性预览；购买不会自动装备物品。',
    stats,
    resourceAdjustmentMessages,
  }
}

function projectedStock(
  vendor: Vendor,
  itemKey: string,
  quantity: number | null,
  kind: TransactionKind,
  merchantAcceptsItem: boolean,
): TextOpenWorldPlayerTransactionStockV1 {
  const definition = vendor.inventoryEntries.find(entry => entry.itemKey === itemKey)
  if (definition?.stockPolicy === 'unlimited') {
    return { kind: 'unlimited', quantity: null, label: '不限量' }
  }
  const finiteQuantity = quantity ?? 0
  return {
    kind: 'limited',
    quantity: finiteQuantity,
    label: kind === 'sell'
      ? definition || merchantAcceptsItem ? `商店已有 ${finiteQuantity}` : '商店不收购'
      : `剩余 ${finiteQuantity}`,
  }
}

function transactionReasons(input: {
  candidate: TextOpenWorldTransactionItemProjectionV1 | null
  action: TextOpenWorldActionAvailabilityV1 | undefined
  targetKey: string
  item: Item
  kind: TransactionKind
  readOnly: boolean
  pending: boolean
  vendorAvailable: boolean
  vendorAcceptsCategory: boolean
}): TextOpenWorldPlayerCraftingEconomyPublicReasonV1[] {
  const catalogReasons: TextOpenWorldPlayerCraftingEconomyPublicReasonV1[] = input.candidate
    ? input.candidate.unavailableReasons.map(code => ({ code, message: TRANSACTION_REASON_MESSAGES[code] }))
    : input.kind === 'sell'
      ? [{
          code: input.item.critical || !input.item.sellable ? 'item-protected' : 'item-not-accepted',
          message: input.item.critical
            ? '关键物品受到保护，不能出售。'
            : !input.item.sellable
              ? '此物品不能出售。'
              : '商人不收购这类物品。',
        }]
      : [{ code: 'item-not-offered', message: TRANSACTION_REASON_MESSAGES['item-not-offered'] }]
  if (!input.vendorAvailable && !catalogReasons.some(reason => reason.code === 'vendor-unavailable')) {
    catalogReasons.push({ code: 'vendor-unavailable', message: TRANSACTION_REASON_MESSAGES['vendor-unavailable'] })
  }
  if (input.kind === 'sell' && !input.vendorAcceptsCategory
    && !catalogReasons.some(reason => reason.code === 'item-protected' || reason.code === 'item-not-accepted')) {
    catalogReasons.push({ code: 'item-not-accepted', message: TRANSACTION_REASON_MESSAGES['item-not-accepted'] })
  }
  const reasons = [
    ...catalogReasons,
    ...actionReasons(input.action, input.targetKey, catalogReasons.length > 0),
    ...(input.readOnly ? [readOnlyReason('economy')] : []),
    ...(input.pending ? [operationPendingReason()] : []),
  ]
  return uniqueReasons(reasons)
}

function transactionItem(input: {
  kind: TransactionKind
  item: Item
  candidate: TextOpenWorldTransactionItemProjectionV1 | null
  action: TextOpenWorldActionAvailabilityV1 | undefined
  vendor: Vendor
  vendorAvailable: boolean
  modules: TextOpenWorldParsedModulesV1
  projection: TextOpenWorldSessionProjectionV1
  playerQuantity: number
  readOnly: boolean
  pending: boolean
}): TextOpenWorldPlayerTransactionItemV1 {
  const reasons = transactionReasons({
    candidate: input.candidate,
    action: input.action,
    targetKey: input.vendor.key,
    item: input.item,
    kind: input.kind,
    readOnly: input.readOnly,
    pending: input.pending,
    vendorAvailable: input.vendorAvailable,
    vendorAcceptsCategory: input.vendor.sellCategories.includes(input.item.kind as never),
  })
  const targetAvailable = input.action?.validTargetKeys.includes(input.vendor.key) === true
  const available = !input.readOnly && !input.pending && input.candidate?.available === true
    && input.action?.available === true && targetAvailable && reasons.length === 0
  const maximumQuantity = input.candidate?.maximumQuantity ?? 0
  const unitPrice = input.candidate?.unitPrice ?? 0
  const stockQuantity = input.candidate?.vendorStockQuantity
    ?? input.projection.state.economy.limitedStockQuantitiesByVendorKey[input.vendor.key]?.[input.item.key]
    ?? null
  return {
    operationItemKey: input.item.key,
    title: input.item.title,
    description: input.item.description,
    categoryLabel: CATEGORY_LABELS[input.item.kind],
    playerQuantity: input.playerQuantity,
    stock: projectedStock(
      input.vendor,
      input.item.key,
      stockQuantity,
      input.kind,
      input.candidate != null,
    ),
    unitPrice,
    maximumQuantity,
    totalPriceAtMaximumQuantity: safeMultiply(unitPrice, maximumQuantity, '最大交易总价'),
    available,
    unavailableReasons: reasons,
    action: input.action ? {
      actionKey: input.action.action.key,
      targetKey: input.vendor.key,
      itemKey: input.item.key,
      label: input.action.action.label,
      description: input.action.action.description,
      available,
      confirmationRequired: input.action.confirmationRequired,
    } : null,
    equipmentComparison: input.kind === 'buy'
      ? equipmentComparison({ item: input.item, modules: input.modules, projection: input.projection })
      : null,
  }
}

/**
 * Builds the sole crafting/shop player DTO from a validated Release-bound
 * Session projection. Unknown recipes collapse into one generic placeholder;
 * hidden recipe definitions, future stations and acquisition sources never
 * leave this function.
 */
export function projectTextOpenWorldPlayerCraftingEconomyV1(input: {
  sessionId: number
  /** Outer ProductRuntimeState event head used by executeTextOpenWorldActionV1. */
  runtimeEventSequence: number
  projection: TextOpenWorldSessionProjectionV1 | unknown
}): TextOpenWorldPlayerCraftingEconomyProjectionV1 {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  const projection = parseTextOpenWorldSessionProjectionV1(input.projection)
  if (!Number.isSafeInteger(input.runtimeEventSequence) || input.runtimeEventSequence < 0
    || input.runtimeEventSequence < projection.lastEventSequence) {
    fail('runtimeEventSequence与Session投影不一致')
  }
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const contexts = deriveTextOpenWorldContextsV1(projection)
  const projectedActions = createTextOpenWorldActionRegistryV1(projection.runtimePackage)
    .project(contexts.action)
  const quantities = deriveTextOpenWorldInventoryQuantitiesV1(modules, projection.state.inventory)
  const itemByKey = new Map(modules.items.items.map(item => [item.key, item]))
  const craftingReadOnly = modules.crafting.sourceVersion !== 2 || modules.actions.version < 12
  const economyReadOnly = modules.economy.sourceVersion !== 2 || modules.actions.version < 13
  const pending = projection.protocol.pendingCommandId != null
  const craftingProjection = createTextOpenWorldCraftingCatalogV1(
    projection.runtimePackage,
    modules,
  ).project({ state: projection.state })
  const knownRecipeKeys = new Set(projection.state.inventory.knownRecipeKeys)
  const learnedRecipes = craftingProjection.flatMap(catalog => {
    const recipe = catalog.recipe
    if (!knownRecipeKeys.has(recipe.key)) return []
    const action = craftingReadOnly
      ? undefined
      : craftingActionForRecipe(modules, projectedActions, recipe.key)
    const catalogReasons = catalog.unavailableReasons
      .filter(code => code !== 'recipe-unknown')
      .map(code => ({ code, message: CRAFTING_REASON_MESSAGES[code] }))
    const reasons = uniqueReasons([
      ...catalogReasons,
      ...actionReasons(action, recipe.key, catalogReasons.length > 0),
      ...(craftingReadOnly ? [readOnlyReason('crafting')] : []),
      ...(pending ? [operationPendingReason()] : []),
    ])
    const targetAvailable = action?.validTargetKeys.includes(recipe.key) === true
    const available = !craftingReadOnly && !pending && catalog.available
      && action?.available === true && targetAvailable && reasons.length === 0
    return [{
      operationTargetKey: recipe.key,
      title: recipe.title,
      description: recipe.description,
      categoryLabel: CATEGORY_LABELS[recipe.category],
      ingredients: recipe.ingredients.map(ingredient => {
        const item = itemByKey.get(ingredient.itemKey) ?? fail('配方材料定义缺失')
        const inventoryQuantity = quantities[item.key] ?? 0
        return {
          title: item.title,
          requiredQuantity: ingredient.quantity,
          inventoryQuantity,
          sufficient: inventoryQuantity >= ingredient.quantity,
        }
      }),
      outputs: recipe.outputs.map(output => ({
        title: itemByKey.get(output.itemKey)?.title ?? fail('配方产物定义缺失'),
        quantity: output.quantity,
      })),
      timeCostMinutes: recipe.timeCostMinutes,
      maximumQuantity: catalog.maximumCraftableQuantity,
      totalTimeCostAtMaximumQuantity: safeMultiply(
        recipe.timeCostMinutes,
        catalog.maximumCraftableQuantity,
        '最大制作耗时',
      ),
      available,
      unavailableReasons: reasons,
      action: action ? {
        actionKey: action.action.key,
        targetKey: recipe.key,
        label: action.action.label,
        description: action.action.description,
        available,
        confirmationRequired: action.confirmationRequired,
      } : null,
    }]
  }).sort((left, right) => compareText(left.title, right.title)
    || compareText(left.operationTargetKey, right.operationTargetKey))
  const lockedRecipeCount = modules.crafting.recipes.length - learnedRecipes.length

  const visibleActors = projectTextOpenWorldActorsV1({
    runtimePackage: projection.runtimePackage,
    parsedModules: modules,
    state: projection.state,
    locationKey: projection.state.map.currentLocationKey,
  })
  const visibleActorByKey = new Map(visibleActors.map(actor => [actor.key, actor]))
  const economy = createTextOpenWorldEconomyCatalogV1(projection.runtimePackage, modules)
  const vendors = modules.economy.vendors.flatMap(vendor => {
    const actor = visibleActorByKey.get(vendor.actorKey)
    if (!actor || vendor.locationKey !== projection.state.map.currentLocationKey
      || !actor.availableServices.some(service => service.key === vendor.key)) return []
    const catalog = economy.project({ state: projection.state, vendorKey: vendor.key })[0]
      ?? fail('商店投影缺失')
    const buyAction = economyReadOnly
      ? undefined
      : transactionAction(projectedActions, vendor.buyActionKey)
    const sellAction = economyReadOnly
      ? undefined
      : transactionAction(projectedActions, vendor.sellActionKey)
    const vendorReasons = uniqueReasons([
      ...(!catalog.available
        ? [{ code: 'vendor-unavailable' as const, message: TRANSACTION_REASON_MESSAGES['vendor-unavailable'] }]
        : []),
      ...(economyReadOnly ? [readOnlyReason('economy')] : []),
      ...(pending ? [operationPendingReason()] : []),
    ])
    const buy = catalog.buy.map(candidate => {
      const item = itemByKey.get(candidate.item.key) ?? fail('商店商品定义缺失')
      return transactionItem({
        kind: 'buy',
        item,
        candidate,
        action: buyAction,
        vendor,
        vendorAvailable: catalog.available,
        modules,
        projection,
        playerQuantity: quantities[item.key] ?? 0,
        readOnly: economyReadOnly,
        pending,
      })
    }).sort((left, right) => compareText(left.categoryLabel, right.categoryLabel)
      || compareText(left.title, right.title) || compareText(left.operationItemKey, right.operationItemKey))
    const sellCandidateByItemKey = new Map(catalog.sell.map(candidate => [candidate.item.key, candidate]))
    const sell = modules.items.items.filter(item => (quantities[item.key] ?? 0) > 0).map(item => transactionItem({
      kind: 'sell',
      item,
      candidate: sellCandidateByItemKey.get(item.key) ?? null,
      action: sellAction,
      vendor,
      vendorAvailable: catalog.available,
      modules,
      projection,
      playerQuantity: quantities[item.key] ?? 0,
      readOnly: economyReadOnly,
      pending,
    })).sort((left, right) => compareText(left.categoryLabel, right.categoryLabel)
      || compareText(left.title, right.title) || compareText(left.operationItemKey, right.operationItemKey))
    const attitudeLabel = modules.relationships.attitudeBands
      .find(band => band.attitude === catalog.attitude)?.label ?? fail('关系态度公开名称缺失')
    const buyVendorMultiplier = catalog.priceExplanation.buyVendorMultiplierBasisPoints / 10_000
    const sellVendorMultiplier = catalog.priceExplanation.sellVendorMultiplierBasisPoints / 10_000
    const buyRelationshipMultiplier = catalog.priceExplanation.buyRelationshipMultiplierBasisPoints / 10_000
    const sellRelationshipMultiplier = catalog.priceExplanation.sellRelationshipMultiplierBasisPoints / 10_000
    return [{
      operationTargetKey: vendor.key,
      title: vendor.title,
      merchantName: actor.name,
      available: !economyReadOnly && !pending && catalog.available,
      unavailableReasons: vendorReasons,
      attitude: { semantic: catalog.attitude, label: attitudeLabel },
      priceExplanation: {
        buy: [
          { label: '商店售价倍率', multiplier: buyVendorMultiplier, display: multiplierDisplay(buyVendorMultiplier) },
          { label: `关系修正（${attitudeLabel}）`, multiplier: buyRelationshipMultiplier, display: multiplierDisplay(buyRelationshipMultiplier) },
        ],
        sell: [
          { label: '商店收购倍率', multiplier: sellVendorMultiplier, display: multiplierDisplay(sellVendorMultiplier) },
          { label: `关系修正（${attitudeLabel}）`, multiplier: sellRelationshipMultiplier, display: multiplierDisplay(sellRelationshipMultiplier) },
        ],
        buyRounding: '买入单价按完整倍率计算后向上取整，总价为单价乘以数量。',
        sellRounding: '卖出单价按完整倍率计算后向下取整，总价为单价乘以数量。',
      },
      buy,
      sell,
    }]
  }).sort((left, right) => compareText(left.title, right.title)
    || compareText(left.operationTargetKey, right.operationTargetKey))

  const notices = [
    ...(craftingReadOnly ? ['旧版制作目录不具备正式制作Action。'] : []),
    ...(economyReadOnly ? ['旧版经济目录不具备正式交易Action。'] : []),
  ]
  const currentLocation = modules.world.locations.find(
    location => location.key === projection.state.map.currentLocationKey,
  ) ?? fail('当前位置定义缺失')
  return {
    schema: 'storyforge.text-open-world.player-crafting-economy-projection',
    version: 1,
    operationIdentity: {
      sessionId: input.sessionId,
      expectedBaseSequence: input.runtimeEventSequence,
    },
    compatibility: {
      craftingReadOnly,
      economyReadOnly,
      notice: notices.length ? notices.join(' ') : null,
    },
    location: { title: currentLocation.title },
    currency: { label: modules.economy.currency.label, amount: projection.state.inventory.currency },
    crafting: {
      learnedRecipes,
      lockedRecipeCount,
      lockedPlaceholder: {
        title: '未学习配方',
        message: '继续探索、完成公开目标或与当前角色互动，可能学会新的配方。',
      },
    },
    vendors,
  }
}

function actionLabelForRequest(
  modules: TextOpenWorldParsedModulesV1,
  request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1,
): string {
  const action = modules.actions.actions.find(candidate => candidate.key === request.actionKey)
    ?? fail('回执请求引用未知Action')
  if (request.kind === 'craft') {
    const marker = action.successEffectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey))
      .find(effect => effect?.operation === 'perform-crafting')
    if (action.category !== 'craft' || marker?.operation !== 'perform-crafting'
      || marker.payload.recipeKey !== request.targetKey) fail('回执请求与制作Action不一致')
  } else {
    const marker = action.successEffectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey))
      .find(effect => effect?.operation === 'perform-transaction')
    if (action.category !== request.kind || marker?.operation !== 'perform-transaction'
      || marker.payload.kind !== request.kind || marker.payload.vendorKey !== request.targetKey) {
      fail('回执请求与交易Action不一致')
    }
  }
  return action.label
}

function successfulReceiptCopy(input: {
  modules: TextOpenWorldParsedModulesV1
  projection: TextOpenWorldSessionProjectionV1
  request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1
  receipt: TextOpenWorldFeedbackReceiptV1
}): { message: string; details: string[] } {
  const request = input.request
  if (request.kind === 'craft') {
    const recipe = input.modules.crafting.recipes.find(candidate => candidate.key === request.targetKey)
      ?? fail('回执请求引用未知配方')
    const authorization = createTextOpenWorldCraftingCatalogV1(
      input.projection.runtimePackage,
      input.modules,
    ).prepare({
      state: input.projection.state,
      recipeKey: request.targetKey,
      quantity: request.quantity,
      locationKey: input.projection.state.map.currentLocationKey,
    })
    const marker = input.modules.actions.actions.find(action => action.key === request.actionKey)?.successEffectKeys
      .map(effectKey => input.modules.actions.effects.find(effect => effect.key === effectKey))
      .find(effect => effect?.operation === 'perform-crafting')
    const change = input.receipt.changes.length === 1 ? input.receipt.changes[0] : null
    const expectedBefore = {
      worldMinute: authorization.baseWorldMinute,
      ingredients: Object.fromEntries(authorization.ingredients.map(item => [item.itemKey, item.beforeQuantity])),
      outputs: Object.fromEntries(authorization.outputs.map(item => [item.itemKey, item.beforeQuantity])),
    }
    const expectedAfter = {
      worldMinute: authorization.baseWorldMinute + authorization.timeCostMinutes,
      ingredients: Object.fromEntries(authorization.ingredients.map(item => [item.itemKey, item.afterQuantity])),
      outputs: Object.fromEntries(authorization.outputs.map(item => [item.itemKey, item.afterQuantity])),
    }
    if (marker?.operation !== 'perform-crafting' || !change
      || change.effectKey !== marker.key || change.operation !== 'perform-crafting'
      || change.summary !== `制作:${request.targetKey}×${request.quantity}`
      || canonicalProductProductionJsonV2(change.before) !== canonicalProductProductionJsonV2(expectedBefore)
      || canonicalProductProductionJsonV2(change.after) !== canonicalProductProductionJsonV2(expectedAfter)) {
      fail('制作回执变化与提交时授权不一致')
    }
    return {
      message: `已制作${recipe.title} × ${request.quantity}。`,
      details: [
        ...authorization.ingredients.map(ingredient => {
          const item = input.modules.items.items.find(candidate => candidate.key === ingredient.itemKey)
            ?? fail('回执配方材料定义缺失')
          return `消耗 ${item.title} × ${ingredient.quantity}`
        }),
        ...authorization.outputs.map(output => {
          const item = input.modules.items.items.find(candidate => candidate.key === output.itemKey)
            ?? fail('回执配方产物定义缺失')
          return `获得 ${item.title} × ${output.quantity}`
        }),
        `耗时 ${authorization.timeCostMinutes} 分钟`,
      ],
    }
  }
  const vendor = input.modules.economy.vendors.find(candidate => candidate.key === request.targetKey)
    ?? fail('回执请求引用未知商店')
  const item = input.modules.items.items.find(candidate => candidate.key === request.itemKey)
    ?? fail('回执请求引用未知物品')
  const authorization = createTextOpenWorldEconomyCatalogV1(
    input.projection.runtimePackage,
    input.modules,
  ).prepare({
    state: input.projection.state,
    transactionKind: request.kind,
    vendorKey: vendor.key,
    itemKey: item.key,
    quantity: request.quantity,
  })
  const marker = input.modules.actions.actions.find(action => action.key === request.actionKey)?.successEffectKeys
    .map(effectKey => input.modules.actions.effects.find(effect => effect.key === effectKey))
    .find(effect => effect?.operation === 'perform-transaction')
  const change = input.receipt.changes.length === 1 ? input.receipt.changes[0] : null
  if (marker?.operation !== 'perform-transaction' || !change
    || change.effectKey !== marker.key || change.operation !== 'perform-transaction'
    || change.summary !== `${request.kind === 'buy' ? '购买' : '出售'}:${request.itemKey}×${request.quantity}`
    || canonicalProductProductionJsonV2(change.before) !== canonicalProductProductionJsonV2(authorization.before)
    || canonicalProductProductionJsonV2(change.after) !== canonicalProductProductionJsonV2(authorization.after)) {
    fail('交易回执变化与提交时授权不一致')
  }
  return {
    message: request.kind === 'buy'
      ? `已购买${item.title} × ${request.quantity}。`
      : `已出售${item.title} × ${request.quantity}。`,
    details: [
      request.kind === 'buy'
        ? `支付 ${input.modules.economy.currency.label} ${authorization.price.totalPrice}`
        : `获得 ${input.modules.economy.currency.label} ${authorization.price.totalPrice}`,
      `成交单价 ${input.modules.economy.currency.label} ${authorization.price.unitPrice}`,
    ],
  }
}

/**
 * Removes hashes, change snapshots, raw summaries and stable Effect keys from a
 * canonical gameplay receipt. Success details are rebuilt from the frozen
 * recipe/vendor definitions and the exact submitted quantity.
 */
export function projectTextOpenWorldPlayerCraftingEconomyReceiptV1(input: {
  projection: TextOpenWorldSessionProjectionV1 | unknown
  /** Outer ProductRuntimeState event head captured with `projection`. */
  runtimeEventSequence: number
  request: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1
  receipt: TextOpenWorldFeedbackReceiptV1
}): TextOpenWorldPlayerCraftingEconomyReceiptV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(input.projection)
  const request = structuredClone(input.request)
  if (!Number.isSafeInteger(request.sessionId) || request.sessionId < 1
    || !Number.isSafeInteger(request.expectedBaseSequence) || request.expectedBaseSequence < 0
    || !Number.isSafeInteger(request.quantity) || request.quantity < 1) fail('回执请求身份或数量无效')
  if (!Number.isSafeInteger(input.runtimeEventSequence) || input.runtimeEventSequence < 0
    || input.runtimeEventSequence < projection.lastEventSequence
    || input.runtimeEventSequence !== request.expectedBaseSequence) {
    fail('回执清洗必须使用提交时的Session投影')
  }
  const receipt = input.receipt
  if (receipt.sessionId !== request.sessionId || receipt.baseSequence !== request.expectedBaseSequence
    || receipt.actionKey !== request.actionKey || receipt.targetKey !== request.targetKey) {
    fail('回执与提交请求不一致')
  }
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const actionLabel = actionLabelForRequest(modules, request)
  const successful = receipt.status === 'succeeded' || receipt.status === 'degraded'
  if (successful && (receipt.phase !== 'terminal' || !receipt.outcomeCommitted)) {
    fail('成功回执缺少正式终态')
  }
  const copy = successful
    ? successfulReceiptCopy({ modules, projection, request, receipt })
    : { message: '', details: [] as string[] }
  const title = receipt.status === 'succeeded' ? `${actionLabel}已完成`
    : receipt.status === 'degraded' ? `${actionLabel}已结算`
      : receipt.status === 'pending' ? `${actionLabel}正在结算`
        : receipt.status === 'confirmation-required' ? `${actionLabel}需要确认`
          : receipt.status === 'rejected' ? `${actionLabel}当前不可执行` : `${actionLabel}失败`
  const message = successful ? copy.message
    : receipt.status === 'pending' ? '操作已经提交，正在等待正式结算。'
      : receipt.status === 'confirmation-required' ? '此操作需要再次确认。'
        : receipt.status === 'rejected'
          ? '当前状态不允许执行此操作，请查看页面上的公开原因。'
          : '操作未能完成，世界状态不会被页面文案擅自改写。'
  return {
    request,
    phase: receipt.phase,
    status: receipt.status,
    outcomeCommitted: receipt.outcomeCommitted,
    resultingSequence: receipt.resultingSequence,
    title,
    message,
    details: copy.details.map(detail => bounded(detail)),
  }
}
