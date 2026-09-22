import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldTransactionAuthorizationV1,
} from '../types'
import { projectTextOpenWorldActorsV1 } from './actors'
import {
  createTextOpenWorldItemInstanceIdV1,
  deriveTextOpenWorldInventoryQuantitiesV1,
} from './inventory'
import { parseTextOpenWorldModulesV1 } from './modules'
import { projectTextOpenWorldRelationshipsV1 } from './relationships'

type Vendor = TextOpenWorldParsedModulesV1['economy']['vendors'][number]
type Item = TextOpenWorldParsedModulesV1['items']['items'][number]
type TransactionKind = TextOpenWorldTransactionAuthorizationV1['transactionKind']

function fail(message: string): never { throw new Error(`[text-open-world-economy] ${message}`) }
function requestedQuantity(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) fail(`交易数量必须是1到${maximum}的安全整数`)
  return Number(value)
}

function inventoryQuantity(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1, itemKey: string): number {
  return deriveTextOpenWorldInventoryQuantitiesV1(modules, state.inventory)[itemKey] ?? 0
}

function removableQuantity(state: TextOpenWorldEffectStateV1, item: Item): number {
  if (item.stackPolicy === 'stacked') return state.inventory.stackQuantities[item.key] ?? 0
  const equipped = new Set(Object.values(state.inventory.equippedItemInstanceIdBySlot).filter((value): value is string => value != null))
  return Object.entries(state.inventory.itemInstances)
    .filter(([instanceId, instance]) => instance.itemKey === item.key && !equipped.has(instanceId)).length
}

function unitPrice(input: {
  baseValue: number
  vendorMultiplierBasisPoints: number
  relationshipMultiplierBasisPoints: number
  rounding: 'ceil' | 'floor'
}): number {
  const numerator = BigInt(input.baseValue) * BigInt(input.vendorMultiplierBasisPoints) * BigInt(input.relationshipMultiplierBasisPoints)
  const denominator = 100_000_000n
  const rounded = input.rounding === 'ceil'
    ? (numerator + denominator - 1n) / denominator
    : numerator / denominator
  const positive = input.baseValue > 0 && rounded < 1n ? 1n : rounded
  if (positive > BigInt(Number.MAX_SAFE_INTEGER)) fail('交易单价超过安全整数范围')
  return Number(positive)
}

function totalPrice(unit: number, quantity: number): number {
  const total = BigInt(unit) * BigInt(quantity)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail('交易总价超过安全整数范围')
  return Number(total)
}

function finiteStock(
  state: TextOpenWorldEffectStateV1,
  vendor: Vendor,
  itemKey: string,
): number | null | undefined {
  const entry = vendor.inventoryEntries.find(candidate => candidate.itemKey === itemKey)
  if (entry?.stockPolicy === 'unlimited') return null
  const runtime = state.economy.limitedStockQuantitiesByVendorKey[vendor.key]
  if (entry?.stockPolicy === 'limited') return runtime?.[itemKey] ?? fail(`有限库存运行状态缺失:${vendor.key}:${itemKey}`)
  return runtime && Object.prototype.hasOwnProperty.call(runtime, itemKey) ? runtime[itemKey] : undefined
}

function vendorAvailable(modules: TextOpenWorldParsedModulesV1, state: TextOpenWorldEffectStateV1, vendor: Vendor): boolean {
  return projectTextOpenWorldActorsV1({ runtimePackage: modules, parsedModules: modules, state })
    .some(actor => actor.key === vendor.actorKey && actor.availableServices.some(service => service.key === vendor.key))
}

function relationshipPrice(
  modules: TextOpenWorldParsedModulesV1,
  state: TextOpenWorldEffectStateV1,
  vendor: Vendor,
  kind: TransactionKind,
) {
  const actor = projectTextOpenWorldRelationshipsV1({ runtimePackage: modules, state, actorKeys: [vendor.actorKey], parsedModules: modules }).actors[0]
    ?? fail(`商店角色关系投影不存在:${vendor.actorKey}`)
  return {
    attitude: actor.attitude,
    vendorMultiplierBasisPoints: kind === 'buy' ? vendor.buyPriceMultiplierBasisPoints : vendor.sellPriceMultiplierBasisPoints,
    relationshipMultiplierBasisPoints: Math.round((kind === 'buy' ? actor.buyPriceMultiplier : actor.sellPriceMultiplier) * 10_000),
  }
}

export type TextOpenWorldTransactionUnavailableReasonV1 =
  | 'vendor-unavailable' | 'item-not-offered' | 'item-not-accepted' | 'stock-insufficient'
  | 'currency-insufficient' | 'inventory-insufficient' | 'item-protected' | 'item-equipped'
  | 'inventory-capacity' | 'currency-capacity'

export interface TextOpenWorldTransactionItemProjectionV1 {
  item: Item
  transactionKind: TransactionKind
  unitPrice: number
  maximumQuantity: number
  vendorStockQuantity: number | null
  playerItemQuantity: number
  available: boolean
  unavailableReasons: TextOpenWorldTransactionUnavailableReasonV1[]
}

export interface TextOpenWorldVendorProjectionV1 {
  vendor: Vendor
  currency: TextOpenWorldParsedModulesV1['economy']['currency']
  playerCurrency: number
  available: boolean
  attitude: 'bad' | 'neutral' | 'good'
  priceExplanation: {
    buyVendorMultiplierBasisPoints: number
    sellVendorMultiplierBasisPoints: number
    buyRelationshipMultiplierBasisPoints: number
    sellRelationshipMultiplierBasisPoints: number
  }
  buy: TextOpenWorldTransactionItemProjectionV1[]
  sell: TextOpenWorldTransactionItemProjectionV1[]
}

export function createInitialTextOpenWorldEconomyStateV1(modules: TextOpenWorldParsedModulesV1): TextOpenWorldEffectStateV1['economy'] {
  return {
    limitedStockQuantitiesByVendorKey: Object.fromEntries(modules.economy.vendors.map(vendor => [
      vendor.key,
      Object.fromEntries(vendor.inventoryEntries.flatMap(entry => entry.stockPolicy === 'limited'
        ? [[entry.itemKey, entry.initialQuantity ?? 0]]
        : [])),
    ])),
  }
}

export function createTextOpenWorldEconomyCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | TextOpenWorldParsedModulesV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
) {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(value)
  const vendors = new Map(modules.economy.vendors.map(vendor => [vendor.key, vendor]))
  const items = new Map(modules.items.items.map(item => [item.key, item]))

  const itemProjection = (
    state: TextOpenWorldEffectStateV1,
    vendor: Vendor,
    item: Item,
    kind: TransactionKind,
    availableVendor: boolean,
  ): TextOpenWorldTransactionItemProjectionV1 => {
    const relationship = relationshipPrice(modules, state, vendor, kind)
    const price = unitPrice({
      baseValue: item.baseValue,
      vendorMultiplierBasisPoints: relationship.vendorMultiplierBasisPoints,
      relationshipMultiplierBasisPoints: relationship.relationshipMultiplierBasisPoints,
      rounding: kind === 'buy' ? 'ceil' : 'floor',
    })
    const stock = finiteStock(state, vendor, item.key)
    const playerItemQuantity = inventoryQuantity(modules, state, item.key)
    const reasons: TextOpenWorldTransactionUnavailableReasonV1[] = []
    let maximumQuantity = modules.economy.rules.maximumTransactionQuantity
    if (!availableVendor) reasons.push('vendor-unavailable')
    if (kind === 'buy') {
      if (stock === undefined || !vendor.buyCategories.includes(item.kind as never)) reasons.push('item-not-offered')
      if (stock != null) {
        maximumQuantity = Math.min(maximumQuantity, stock ?? 0)
        if (stock < 1) reasons.push('stock-insufficient')
      }
      maximumQuantity = price > 0 ? Math.min(maximumQuantity, Math.floor(state.inventory.currency / price)) : maximumQuantity
      if (price > state.inventory.currency) reasons.push('currency-insufficient')
      if (item.stackPolicy === 'stacked') {
        maximumQuantity = Math.min(maximumQuantity, item.maximumStack! - playerItemQuantity)
        if (playerItemQuantity >= item.maximumStack!) reasons.push('inventory-capacity')
      } else if (item.unique) {
        maximumQuantity = Math.min(maximumQuantity, playerItemQuantity > 0 ? 0 : 1)
        if (playerItemQuantity > 0) reasons.push('inventory-capacity')
      }
    } else {
      if (item.critical || !item.sellable || !vendor.sellCategories.includes(item.kind as never)) reasons.push(item.critical || !item.sellable ? 'item-protected' : 'item-not-accepted')
      const removable = removableQuantity(state, item)
      maximumQuantity = Math.min(maximumQuantity, removable)
      if (removable < 1) reasons.push(playerItemQuantity > 0 ? 'item-equipped' : 'inventory-insufficient')
      maximumQuantity = price > 0 ? Math.min(maximumQuantity, Math.floor((1_000_000_000 - state.inventory.currency) / price)) : maximumQuantity
      if (price > 0 && state.inventory.currency + price > 1_000_000_000) reasons.push('currency-capacity')
    }
    maximumQuantity = Math.max(0, Math.min(maximumQuantity, Math.floor(modules.economy.rules.maximumTransactionTotal / Math.max(1, price))))
    return {
      item: structuredClone(item), transactionKind: kind, unitPrice: price,
      maximumQuantity, vendorStockQuantity: stock === undefined && kind === 'sell' ? 0 : stock ?? null, playerItemQuantity,
      available: reasons.length === 0 && maximumQuantity >= 1,
      unavailableReasons: [...new Set(reasons)],
    }
  }

  const projectVendor = (state: TextOpenWorldEffectStateV1, vendor: Vendor): TextOpenWorldVendorProjectionV1 => {
    const available = vendorAvailable(modules, state, vendor)
    const buyItemKeys = new Set([
      ...vendor.inventoryEntries.map(entry => entry.itemKey),
      ...Object.keys(state.economy.limitedStockQuantitiesByVendorKey[vendor.key] ?? {}),
    ])
    const buy = [...buyItemKeys].sort().map(itemKey => itemProjection(state, vendor, items.get(itemKey) ?? fail(`商店库存物品不存在:${itemKey}`), 'buy', available))
    const sell = modules.items.items
      .filter(item => item.kind !== 'quest' && vendor.sellCategories.includes(item.kind as never))
      .map(item => itemProjection(state, vendor, item, 'sell', available))
    const buyRelationship = relationshipPrice(modules, state, vendor, 'buy')
    const sellRelationship = relationshipPrice(modules, state, vendor, 'sell')
    return {
      vendor: structuredClone(vendor), currency: structuredClone(modules.economy.currency),
      playerCurrency: state.inventory.currency, available, attitude: buyRelationship.attitude,
      priceExplanation: {
        buyVendorMultiplierBasisPoints: vendor.buyPriceMultiplierBasisPoints,
        sellVendorMultiplierBasisPoints: vendor.sellPriceMultiplierBasisPoints,
        buyRelationshipMultiplierBasisPoints: buyRelationship.relationshipMultiplierBasisPoints,
        sellRelationshipMultiplierBasisPoints: sellRelationship.relationshipMultiplierBasisPoints,
      },
      buy, sell,
    }
  }

  const project = (input: { state: TextOpenWorldEffectStateV1; vendorKey?: string }) => {
    const selected = input.vendorKey == null
      ? modules.economy.vendors
      : [vendors.get(input.vendorKey) ?? fail(`商店不存在:${input.vendorKey}`)]
    return selected.map(vendor => projectVendor(input.state, vendor))
  }

  const prepare = (input: {
    state: TextOpenWorldEffectStateV1
    transactionKind: TransactionKind
    vendorKey: string
    itemKey: string
    quantity: number
  }): TextOpenWorldTransactionAuthorizationV1 => {
    if (modules.economy.sourceVersion !== 2 || modules.actions.version < 13) fail('旧Economy Release没有正式交易运行合同')
    const vendor = vendors.get(input.vendorKey) ?? fail(`商店不存在:${input.vendorKey}`)
    const item = items.get(input.itemKey) ?? fail(`交易物品不存在:${input.itemKey}`)
    const quantity = requestedQuantity(input.quantity, modules.economy.rules.maximumTransactionQuantity)
    const vendorProjection = projectVendor(input.state, vendor)
    const candidate = (input.transactionKind === 'buy' ? vendorProjection.buy : vendorProjection.sell)
      .find(entry => entry.item.key === item.key) ?? fail(`商店不支持该交易:${vendor.key}:${item.key}`)
    if (!candidate.available || quantity > candidate.maximumQuantity) fail(`交易当前不可执行:${candidate.unavailableReasons.join(',') || `最大数量${candidate.maximumQuantity}`}`)
    const relationship = relationshipPrice(modules, input.state, vendor, input.transactionKind)
    const total = totalPrice(candidate.unitPrice, quantity)
    if (total > modules.economy.rules.maximumTransactionTotal) fail('交易总价超过单次上限')
    const beforeStock = finiteStock(input.state, vendor, item.key)
    const beforeCurrency = input.state.inventory.currency
    const beforeItem = inventoryQuantity(modules, input.state, item.key)
    const normalizedBeforeStock = beforeStock === undefined ? 0 : beforeStock
    const afterStock = normalizedBeforeStock === null ? null : input.transactionKind === 'buy'
      ? normalizedBeforeStock - quantity
      : normalizedBeforeStock + quantity
    return {
      kind: 'transaction', transactionKind: input.transactionKind, vendorKey: vendor.key,
      vendorActorKey: vendor.actorKey, itemKey: item.key, quantity, currencyKey: 'currency',
      locationKey: input.state.map.currentLocationKey, worldMinute: input.state.time.worldMinute,
      attitude: relationship.attitude,
      price: {
        baseValue: item.baseValue,
        vendorMultiplierBasisPoints: relationship.vendorMultiplierBasisPoints,
        relationshipMultiplierBasisPoints: relationship.relationshipMultiplierBasisPoints,
        rounding: input.transactionKind === 'buy' ? 'ceil' : 'floor',
        unitPrice: candidate.unitPrice,
        totalPrice: total,
      },
      before: { currency: beforeCurrency, playerItemQuantity: beforeItem, vendorStockQuantity: normalizedBeforeStock },
      after: {
        currency: beforeCurrency + (input.transactionKind === 'buy' ? -total : total),
        playerItemQuantity: beforeItem + (input.transactionKind === 'buy' ? quantity : -quantity),
        vendorStockQuantity: afterStock,
      },
    }
  }

  const assertAuthorization = (input: { state: TextOpenWorldEffectStateV1; authorization: TextOpenWorldTransactionAuthorizationV1 }) => {
    const expected = prepare({
      state: input.state,
      transactionKind: input.authorization.transactionKind,
      vendorKey: input.authorization.vendorKey,
      itemKey: input.authorization.itemKey,
      quantity: input.authorization.quantity,
    })
    if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) fail('交易授权与当前状态、价格或冻结商店不一致')
  }

  const applyAuthorization = (input: {
    beforeState: TextOpenWorldEffectStateV1
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldTransactionAuthorizationV1
    claimKey: string
    effectKey: string
  }) => {
    assertAuthorization({ state: input.beforeState, authorization: input.authorization })
    const item = items.get(input.authorization.itemKey)!
    const { quantity, transactionKind } = input.authorization
    input.state.inventory.currency = input.authorization.after.currency
    if (transactionKind === 'buy') {
      if (item.stackPolicy === 'stacked') input.state.inventory.stackQuantities[item.key] = input.authorization.after.playerItemQuantity
      else for (let ordinal = 1; ordinal <= quantity; ordinal += 1) {
        const instanceId = createTextOpenWorldItemInstanceIdV1({
          appliedClaimCount: input.state.appliedClaimKeys.length,
          effectKey: input.effectKey,
          ordinal,
        })
        if (input.state.inventory.itemInstances[instanceId]) fail(`交易物品实例ID冲突:${instanceId}`)
        input.state.inventory.itemInstances[instanceId] = { itemKey: item.key, acquiredByClaimKey: input.claimKey, stateTags: ['new'] }
      }
    } else if (item.stackPolicy === 'stacked') {
      if (input.authorization.after.playerItemQuantity === 0) delete input.state.inventory.stackQuantities[item.key]
      else input.state.inventory.stackQuantities[item.key] = input.authorization.after.playerItemQuantity
    } else {
      const equipped = new Set(Object.values(input.state.inventory.equippedItemInstanceIdBySlot).filter((value): value is string => value != null))
      Object.entries(input.state.inventory.itemInstances)
        .filter(([instanceId, instance]) => instance.itemKey === item.key && !equipped.has(instanceId))
        .map(([instanceId]) => instanceId).sort().slice(0, quantity)
        .forEach(instanceId => { delete input.state.inventory.itemInstances[instanceId] })
    }
    if (input.authorization.before.vendorStockQuantity != null || input.authorization.after.vendorStockQuantity != null) {
      input.state.economy.limitedStockQuantitiesByVendorKey[input.authorization.vendorKey][item.key] = input.authorization.after.vendorStockQuantity ?? 0
    }
  }

  return { project, prepare, assertAuthorization, applyAuthorization }
}

export type TextOpenWorldEconomyCatalogV1 = ReturnType<typeof createTextOpenWorldEconomyCatalogV1>
