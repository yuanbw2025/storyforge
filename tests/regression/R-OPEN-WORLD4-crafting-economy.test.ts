import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  projectTextOpenWorldPlayerCraftingEconomyReceiptV1,
  projectTextOpenWorldPlayerCraftingEconomyV1,
  type TextOpenWorldPlayerCraftingEconomyExecuteRequestV1,
} from '../../src/lib/open-world/player-crafting-economy'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCraftingV1,
} from '../helpers/text-open-world-vnext-fixture'

function addLockedSecretRecipe(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  const items = runtimePackage.modules.items.payload as any
  items.items.push({
    key: 'item.future-moon-sand',
    title: '未来月砂',
    description: '只会在终幕地区出现的秘密材料。',
    kind: 'material',
    tags: ['秘密'],
    stackPolicy: 'stacked',
    maximumStack: 99,
    unique: false,
    consumable: false,
    critical: false,
    droppable: true,
    sellable: true,
    baseValue: 10,
    useActionKey: null,
    equipActionKey: null,
    unequipActionKey: null,
    equipConditionKeys: [],
    equipmentSlotKey: null,
    statModifiers: {},
    effectKeys: [],
    sourceRefs: ['future-secret-source'],
    presentationRefs: ['future-secret-media'],
  }, {
    key: 'item.future-moon-tonic',
    title: '未见月剂',
    description: '绝密配方的未来产物。',
    kind: 'material',
    tags: ['秘密'],
    stackPolicy: 'stacked',
    maximumStack: 99,
    unique: false,
    consumable: false,
    critical: false,
    droppable: true,
    sellable: true,
    baseValue: 20,
    useActionKey: null,
    equipActionKey: null,
    unequipActionKey: null,
    equipConditionKeys: [],
    equipmentSlotKey: null,
    statModifiers: {},
    effectKeys: [],
    sourceRefs: ['future-output-source'],
    presentationRefs: [],
  })
  const crafting = runtimePackage.modules.crafting.payload as any
  crafting.recipes.push({
    key: 'recipe.future-moon-tonic',
    title: '绝密夜航配方',
    description: '终幕之前不应向玩家披露。',
    category: 'consumable',
    learnedByDefault: false,
    stationLocationKeys: ['location.ridge-channel'],
    requirementConditionKeys: [],
    ingredients: [{ itemKey: 'item.future-moon-sand', quantity: 2 }],
    outputs: [{ itemKey: 'item.future-moon-tonic', quantity: 1 }],
    timeCostMinutes: 60,
    presentationRefs: ['future-recipe-media'],
  })
  const actions = runtimePackage.modules.actions.payload as any
  actions.effects.push({
    key: 'effect.craft-future-moon-tonic',
    operation: 'perform-crafting',
    payload: { recipeKey: 'recipe.future-moon-tonic' },
  }, {
    key: 'effect.learn-future-moon-tonic',
    operation: 'learn-recipe',
    payload: { recipeKey: 'recipe.future-moon-tonic' },
  })
  actions.actions.push({
    key: 'action.craft-future-moon-tonic',
    category: 'craft',
    label: '制作未来月剂',
    description: '秘密制作入口。',
    actorScope: 'player',
    targetScope: 'recipe',
    locationKeys: ['location.ridge-channel'],
    requirementConditionKeys: [],
    costEffectKeys: [],
    successEffectKeys: ['effect.craft-future-moon-tonic'],
    failureEffectKeys: [],
    timeCostMinutes: 0,
    confirmationPolicy: 'never',
    repeatPolicy: 'repeatable',
    cooldownMinutes: null,
  }, {
    key: 'action.learn-future-moon-tonic',
    category: 'read',
    label: '阅读陌生手札',
    description: '学习一项尚未公开的配方。',
    actorScope: 'player',
    targetScope: 'none',
    locationKeys: [],
    requirementConditionKeys: [],
    costEffectKeys: [],
    successEffectKeys: ['effect.learn-future-moon-tonic'],
    failureEffectKeys: [],
    timeCostMinutes: 0,
    confirmationPolicy: 'never',
    repeatPolicy: 'once',
    cooldownMinutes: null,
  })
  return runtimePackage
}

function addSaleEquipment(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  const items = (runtimePackage.modules.items.payload as any).items
  const saltCrystal = items.find((item: any) => item.key === 'item.salt-crystal')
  items.push({
    ...structuredClone(saltCrystal),
    key: 'item.old-copper-button',
    title: '旧铜扣',
    description: '商店按材料品类收购、但没有预置库存的旧铜扣。',
    baseValue: 4,
  })
  ;(runtimePackage.modules.actors.payload as any).player.build.startingItemKeys
    .push('item.old-copper-button')
  const vendor = (runtimePackage.modules.economy.payload as any).vendors[0]
  vendor.inventoryEntries.push({
    itemKey: 'item.rust-sword',
    stockPolicy: 'limited',
    initialQuantity: 2,
  })
  return runtimePackage
}

function addMaterialGrantAction(
  runtimePackage: TextOpenWorldRuntimePackageV1,
): TextOpenWorldRuntimePackageV1 {
  const actions = runtimePackage.modules.actions.payload as any
  actions.effects.push({
    key: 'effect.test-grant-crafting-materials',
    operation: 'grant-item',
    payload: { itemKey: 'item.salt-crystal', quantity: 4 },
  })
  actions.actions.push({
    key: 'action.test-grant-crafting-materials',
    category: 'observe',
    label: '领取测试材料',
    description: '领取用于制作回归的材料。',
    actorScope: 'player',
    targetScope: 'none',
    locationKeys: [],
    requirementConditionKeys: [],
    costEffectKeys: [],
    successEffectKeys: ['effect.test-grant-crafting-materials'],
    failureEffectKeys: [],
    timeCostMinutes: 0,
    confirmationPolicy: 'never',
    repeatPolicy: 'once',
    cooldownMinutes: null,
  })
  return runtimePackage
}

describe('Text Open World G4-10 · disclosure-safe crafting and economy projection', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterAll(() => db.close())

  it('只展示已学配方的材料、库存、批量与耗时，未学习配方折叠为无来源的通用占位', () => {
    const runtimePackage = addLockedSecretRecipe(createTextOpenWorldVNextFixture())
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.inventory.stackQuantities['item.salt-crystal'] = 4

    const player = projectTextOpenWorldPlayerCraftingEconomyV1({ sessionId: 41, runtimeEventSequence: 0, projection })
    expect(player).toMatchObject({
      schema: 'storyforge.text-open-world.player-crafting-economy-projection',
      operationIdentity: { sessionId: 41, expectedBaseSequence: 0 },
      location: { title: '盐港广场' },
      crafting: {
        lockedRecipeCount: 1,
        lockedPlaceholder: { title: '未学习配方' },
        learnedRecipes: [{
          title: '盐露药剂',
          categoryLabel: '消耗品',
          ingredients: [{ title: '盐晶', requiredQuantity: 2, inventoryQuantity: 4, sufficient: true }],
          outputs: [{ title: '盐露药剂', quantity: 1 }],
          timeCostMinutes: 15,
          maximumQuantity: 2,
          totalTimeCostAtMaximumQuantity: 30,
          available: true,
        }],
      },
    })
    const learned = player.crafting.learnedRecipes[0]
    expect(learned.action).toMatchObject({
      actionKey: 'action.craft-brine-tonic',
      targetKey: 'recipe.brine-tonic',
      available: true,
    })
    expect(Object.keys(learned)).not.toEqual(expect.arrayContaining([
      'key', 'stationLocationKeys', 'requirementConditionKeys', 'presentationRefs', 'sourceRefs',
    ]))
    expect(Object.keys(learned.ingredients[0])).toEqual([
      'title', 'requiredQuantity', 'inventoryQuantity', 'sufficient',
    ])
    const serialized = JSON.stringify(player)
    expect(serialized).not.toContain('绝密夜航配方')
    expect(serialized).not.toContain('未来月砂')
    expect(serialized).not.toContain('未见月剂')
    expect(serialized).not.toContain('future-secret-source')
    expect(serialized).not.toContain('future-recipe-media')

    projection.state.map.currentLocationKey = 'location.ridge-channel'
    projection.state.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    projection.state.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    expect(projectTextOpenWorldPlayerCraftingEconomyV1({ sessionId: 41, runtimeEventSequence: 0, projection })
      .crafting.learnedRecipes[0]).toMatchObject({
      available: false,
      unavailableReasons: expect.arrayContaining([
        { code: 'wrong-station', message: '当前位置没有制作此配方所需的设施。' },
      ]),
    })
  })

  it('当前营业商店给出确定性买卖价、库存、倍率、保护原因和装备比较', () => {
    const runtimePackage = addSaleEquipment(createTextOpenWorldVNextFixture())
    const actors = runtimePackage.modules.actors.payload as any
    actors.player.build.startingCurrency = 100
    actors.player.build.startingItemKeys.push('item.canal-seal')
    const tonic = (runtimePackage.modules.items.payload as any).items
      .find((item: any) => item.key === 'item.brine-tonic')
    tonic.baseValue = 20
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.relationships.morality = 100
    projection.state.relationships.factionAffinityByKey['faction.canal-keepers'] = 100
    const swordInstance = Object.keys(projection.state.inventory.itemInstances)
      .find(instanceId => projection.state.inventory.itemInstances[instanceId].itemKey === 'item.rust-sword')!
    projection.state.inventory.equippedItemInstanceIdBySlot.weapon = swordInstance
    const player = projectTextOpenWorldPlayerCraftingEconomyV1({ sessionId: 42, runtimeEventSequence: 0, projection })
    expect(player.currency).toEqual({ label: '盐票', amount: 100 })
    expect(player.vendors).toHaveLength(1)
    const vendor = player.vendors[0]
    expect(vendor).toMatchObject({
      title: '守渠补给',
      merchantName: '岑阿婆',
      available: true,
      attitude: { semantic: 'good', label: '好' },
      priceExplanation: {
        buy: [{ multiplier: 1, display: '×1' }, { multiplier: 0.9, display: '×0.9' }],
        sell: [{ multiplier: 0.5, display: '×0.5' }, { multiplier: 1.1, display: '×1.1' }],
      },
    })
    expect(vendor.buy.find(item => item.title === '盐露药剂')).toMatchObject({
      stock: { kind: 'unlimited', quantity: null, label: '不限量' },
      unitPrice: 18,
      maximumQuantity: 5,
      totalPriceAtMaximumQuantity: 90,
      available: true,
    })
    expect(vendor.buy.find(item => item.title === '盐晶')).toMatchObject({
      stock: { kind: 'limited', quantity: 3, label: '剩余 3' },
      unitPrice: 2,
      maximumQuantity: 3,
      totalPriceAtMaximumQuantity: 6,
    })
    const swordForSale = vendor.sell.find(item => item.title === '旧盐刀')!
    expect(swordForSale).toMatchObject({
      playerQuantity: 1,
      unitPrice: 5,
      maximumQuantity: 0,
      available: false,
      unavailableReasons: [{ code: 'item-equipped', message: '已装备物品不能直接出售，请先卸下。' }],
    })
    const protectedItem = vendor.sell.find(item => item.title === '守渠印')!
    expect(protectedItem).toMatchObject({
      stock: { kind: 'limited', quantity: 0, label: '商店不收购' },
      unitPrice: 0,
      maximumQuantity: 0,
      available: false,
      unavailableReasons: [{ code: 'item-protected', message: '关键物品受到保护，不能出售。' }],
    })
    expect(vendor.sell.find(item => item.title === '旧铜扣')).toMatchObject({
      playerQuantity: 1,
      stock: { kind: 'limited', quantity: 0, label: '商店已有 0' },
      unitPrice: 2,
      maximumQuantity: 1,
      totalPriceAtMaximumQuantity: 2,
      available: true,
      unavailableReasons: [],
    })
    const swordForPurchase = vendor.buy.find(item => item.title === '旧盐刀')!
    expect(swordForPurchase.equipmentComparison).toMatchObject({
      slotLabel: '武器',
      currentTitle: '旧盐刀',
      candidateTitle: '旧盐刀',
      note: expect.stringContaining('购买不会自动装备'),
    })
    expect(swordForPurchase.equipmentComparison?.stats.find(stat => stat.semantic === 'attack'))
      .toMatchObject({ before: 8, after: 8, delta: 0, direction: 'unchanged' })
    expect(Object.keys(vendor)).not.toEqual(expect.arrayContaining([
      'vendor', 'actorKey', 'locationKey', 'factionKey', 'availabilityConditionKeys',
      'buyPriceMultiplierBasisPoints', 'sellPriceMultiplierBasisPoints',
    ]))
  })

  it('闭店、远端或死亡商人完全省略，不披露库存与价格壳', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    expect(projectTextOpenWorldPlayerCraftingEconomyV1({ sessionId: 43, runtimeEventSequence: 0, projection }).vendors).toHaveLength(1)

    projection.state.time.worldMinute = 1_080
    projection.state.time.lastActorScheduleSettlementWorldMinute = 1_080
    projection.state.actors['actor.caretaker'].scheduleState = '整理渠图'
    const closed = projectTextOpenWorldPlayerCraftingEconomyV1({ sessionId: 43, runtimeEventSequence: 0, projection })
    expect(closed.vendors).toEqual([])
    expect(JSON.stringify(closed.vendors)).not.toContain('item.brine-tonic')

    projection.state.time.worldMinute = 480
    projection.state.time.lastActorScheduleSettlementWorldMinute = 360
    projection.state.actors['actor.caretaker'].scheduleState = '检查内渠'
    projection.state.actors['actor.caretaker'].locationKey = 'location.ridge-channel'
    expect(projectTextOpenWorldPlayerCraftingEconomyV1({ sessionId: 43, runtimeEventSequence: 0, projection }).vendors).toEqual([])

    projection.state.actors['actor.caretaker'].locationKey = 'location.salt-port'
    projection.state.actors['actor.caretaker'].alive = false
    projection.state.actors['actor.caretaker'].present = false
    expect(projectTextOpenWorldPlayerCraftingEconomyV1({ sessionId: 43, runtimeEventSequence: 0, projection }).vendors).toEqual([])
  })

  it('Crafting/Economy v1只读展示且不伪造可执行Action', () => {
    const runtimePackage = downgradeTextOpenWorldFixtureCraftingV1(createTextOpenWorldVNextFixture())
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.inventory.stackQuantities['item.salt-crystal'] = 4
    const player = projectTextOpenWorldPlayerCraftingEconomyV1({ sessionId: 44, runtimeEventSequence: 0, projection })

    expect(player.compatibility).toMatchObject({ craftingReadOnly: true, economyReadOnly: true })
    expect(player.compatibility.notice).toContain('旧版制作目录')
    expect(player.compatibility.notice).toContain('旧版经济目录')
    expect(player.crafting.learnedRecipes[0]).toMatchObject({
      title: '盐露药剂',
      available: false,
      action: null,
      unavailableReasons: [{ code: 'legacy-read-only' }],
    })
    expect(player.vendors[0]).toMatchObject({ available: false })
    expect(player.vendors[0].buy.every(item => !item.available && item.action == null)).toBe(true)
    expect(player.vendors[0].sell.every(item => !item.available && item.action == null)).toBe(true)
  })

  it('安全回执从提交时授权重建公开详情，并拒绝同Action下替换数量、商品或执行后状态', async () => {
    const craftingPackage = addMaterialGrantAction(createTextOpenWorldVNextFixture())
    const craftedSession = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TOW G4-10 crafting receipt ${crypto.randomUUID()}`,
      textOpenWorldVNext: craftingPackage,
      title: '制作回执',
      seed: 'g4-10-crafting-receipt',
    })
    const craftingSessionId = craftedSession.session.id!
    await executeTextOpenWorldActionV1({
      sessionId: craftingSessionId,
      actionKey: 'action.test-grant-crafting-materials',
      commandId: 'command.g4-10.materials',
      requestedAt: 1,
    })
    const beforeCraftRuntime = await readProductRuntimeState(craftingSessionId)
    const beforeCraft = beforeCraftRuntime.textOpenWorld!
    const recipe = projectTextOpenWorldPlayerCraftingEconomyV1({
      sessionId: craftingSessionId,
      runtimeEventSequence: beforeCraftRuntime.lastSequence,
      projection: beforeCraft,
    }).crafting.learnedRecipes[0]
    const craftRequest: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1 = {
      kind: 'craft',
      sessionId: craftingSessionId,
      expectedBaseSequence: beforeCraftRuntime.lastSequence,
      actionKey: recipe.action!.actionKey,
      targetKey: recipe.action!.targetKey,
      quantity: 2,
    }
    const rawCraftReceipt = await executeTextOpenWorldActionV1({
      ...craftRequest,
      commandId: 'command.g4-10.craft',
      requestedAt: 2,
    })
    const craftReceipt = projectTextOpenWorldPlayerCraftingEconomyReceiptV1({
      projection: beforeCraft,
      runtimeEventSequence: beforeCraftRuntime.lastSequence,
      request: craftRequest,
      receipt: rawCraftReceipt,
    })
    expect(craftReceipt).toMatchObject({
      status: 'succeeded',
      message: '已制作盐露药剂 × 2。',
      details: ['消耗 盐晶 × 4', '获得 盐露药剂 × 2', '耗时 30 分钟'],
    })
    expect(JSON.stringify(craftReceipt)).not.toContain('effect.craft-brine-tonic')
    expect(JSON.stringify(craftReceipt)).not.toContain('resultingStateHash')
    expect(() => projectTextOpenWorldPlayerCraftingEconomyReceiptV1({
      projection: beforeCraft,
      runtimeEventSequence: beforeCraftRuntime.lastSequence,
      request: { ...craftRequest, quantity: 1 },
      receipt: rawCraftReceipt,
    })).toThrow('制作回执变化与提交时授权不一致')
    const afterCraftRuntime = await readProductRuntimeState(craftingSessionId)
    const afterCraft = afterCraftRuntime.textOpenWorld!
    expect(() => projectTextOpenWorldPlayerCraftingEconomyReceiptV1({
      projection: afterCraft,
      runtimeEventSequence: afterCraftRuntime.lastSequence,
      request: craftRequest,
      receipt: rawCraftReceipt,
    })).toThrow('提交时的Session投影')

    const tradePackage = createTextOpenWorldVNextFixture()
    const tradeSession = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `TOW G4-10 trade receipt ${crypto.randomUUID()}`,
      textOpenWorldVNext: tradePackage,
      title: '交易回执',
      seed: 'g4-10-trade-receipt',
    })
    const tradeSessionId = tradeSession.session.id!
    const beforeTradeRuntime = await readProductRuntimeState(tradeSessionId)
    const beforeTrade = beforeTradeRuntime.textOpenWorld!
    const vendor = projectTextOpenWorldPlayerCraftingEconomyV1({
      sessionId: tradeSessionId,
      runtimeEventSequence: beforeTradeRuntime.lastSequence,
      projection: beforeTrade,
    }).vendors[0]
    const salt = vendor.buy.find(item => item.title === '盐晶')!
    const tradeRequest: TextOpenWorldPlayerCraftingEconomyExecuteRequestV1 = {
      kind: 'buy',
      sessionId: tradeSessionId,
      expectedBaseSequence: beforeTradeRuntime.lastSequence,
      actionKey: salt.action!.actionKey,
      targetKey: salt.action!.targetKey,
      itemKey: salt.action!.itemKey,
      quantity: 2,
    }
    const rawTradeReceipt = await executeTextOpenWorldActionV1({
      ...tradeRequest,
      commandId: 'command.g4-10.buy',
      requestedAt: 3,
    })
    const tradeReceipt = projectTextOpenWorldPlayerCraftingEconomyReceiptV1({
      projection: beforeTrade,
      runtimeEventSequence: beforeTradeRuntime.lastSequence,
      request: tradeRequest,
      receipt: rawTradeReceipt,
    })
    expect(tradeReceipt).toMatchObject({
      status: 'succeeded',
      message: '已购买盐晶 × 2。',
      details: ['支付 盐票 4', '成交单价 盐票 2'],
    })
    expect(JSON.stringify({
      title: tradeReceipt.title,
      message: tradeReceipt.message,
      details: tradeReceipt.details,
    })).not.toContain('item.salt-crystal')
    expect(() => projectTextOpenWorldPlayerCraftingEconomyReceiptV1({
      projection: beforeTrade,
      runtimeEventSequence: beforeTradeRuntime.lastSequence,
      request: { ...tradeRequest, quantity: 1 },
      receipt: rawTradeReceipt,
    })).toThrow('交易回执变化与提交时授权不一致')
    expect(() => projectTextOpenWorldPlayerCraftingEconomyReceiptV1({
      projection: beforeTrade,
      runtimeEventSequence: beforeTradeRuntime.lastSequence,
      request: { ...tradeRequest, itemKey: 'item.brine-tonic' },
      receipt: rawTradeReceipt,
    })).toThrow('交易回执变化与提交时授权不一致')

    const changedRelationship = structuredClone(beforeTrade)
    changedRelationship.state.relationships.morality = -100
    changedRelationship.state.relationships.factionAffinityByKey['faction.canal-keepers'] = -100
    expect(() => projectTextOpenWorldPlayerCraftingEconomyReceiptV1({
      projection: changedRelationship,
      runtimeEventSequence: beforeTradeRuntime.lastSequence,
      request: tradeRequest,
      receipt: rawTradeReceipt,
    })).toThrow('交易回执变化与提交时授权不一致')
    const afterTradeRuntime = await readProductRuntimeState(tradeSessionId)
    const afterTrade = afterTradeRuntime.textOpenWorld!
    expect(afterTrade.state.economy.limitedStockQuantitiesByVendorKey['vendor.caretaker']['item.salt-crystal']).toBe(1)
    expect(() => projectTextOpenWorldPlayerCraftingEconomyReceiptV1({
      projection: afterTrade,
      runtimeEventSequence: afterTradeRuntime.lastSequence,
      request: tradeRequest,
      receipt: rawTradeReceipt,
    })).toThrow('提交时的Session投影')
  }, 30_000)
})
