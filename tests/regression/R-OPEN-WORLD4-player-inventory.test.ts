import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { projectTextOpenWorldPlayerInventoryV1 } from '../../src/lib/open-world/player-inventory'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type {
  TextOpenWorldActionModuleV1,
  TextOpenWorldItemModuleV1,
  TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

type Slot = 'weapon' | 'armor' | 'accessory'

function inventoryFixture(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const startingItems = (runtimePackage.modules.actors.payload as any).player.build.startingItemKeys as string[]
  startingItems.push('item.salt-crystal', 'item.brine-tonic', 'item.canal-seal')
  return runtimePackage
}

function addEquipment(runtimePackage: TextOpenWorldRuntimePackageV1, input: {
  key: string
  title: string
  slot: Slot
  modifiers: Record<string, number>
}) {
  const suffix = input.key.replace('item.', '')
  const actions = runtimePackage.modules.actions.payload as TextOpenWorldActionModuleV1
  const items = runtimePackage.modules.items.payload as TextOpenWorldItemModuleV1
  actions.conditions.push(
    {
      key: `condition.${suffix}-not-equipped`,
      expression: { op: 'inventory-equipped', itemKey: input.key, equipped: false },
      failureMessage: `${input.title}已经装备。`,
    },
    {
      key: `condition.${suffix}-equipped`,
      expression: { op: 'inventory-equipped', itemKey: input.key, equipped: true },
      failureMessage: `${input.title}尚未装备。`,
    },
  )
  actions.effects.push(
    { key: `effect.equip-${suffix}`, operation: 'equip-item', payload: { itemKey: input.key } },
    { key: `effect.unequip-${suffix}`, operation: 'unequip-item', payload: { itemKey: input.key } },
  )
  actions.actions.push(
    {
      key: `action.equip-${suffix}`, category: 'equip', label: `装备${input.title}`, description: `装备${input.title}。`,
      actorScope: 'player', targetScope: 'item', locationKeys: [],
      requirementConditionKeys: [`condition.${suffix}-not-equipped`], costEffectKeys: [],
      successEffectKeys: [`effect.equip-${suffix}`], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    },
    {
      key: `action.unequip-${suffix}`, category: 'unequip', label: `卸下${input.title}`, description: `卸下${input.title}。`,
      actorScope: 'player', targetScope: 'item', locationKeys: [],
      requirementConditionKeys: [`condition.${suffix}-equipped`], costEffectKeys: [],
      successEffectKeys: [`effect.unequip-${suffix}`], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    },
  )
  items.items.push({
    key: input.key,
    title: input.title,
    description: `${input.title}的固定属性装备。`,
    tags: ['装备'],
    kind: 'equipment',
    stackPolicy: 'instanced',
    maximumStack: null,
    unique: false,
    consumable: false,
    critical: false,
    droppable: true,
    sellable: true,
    baseValue: 20,
    useActionKey: null,
    equipActionKey: `action.equip-${suffix}`,
    unequipActionKey: `action.unequip-${suffix}`,
    equipConditionKeys: [],
    equipmentSlotKey: input.slot,
    statModifiers: input.modifiers,
    effectKeys: [],
    sourceRefs: ['world-release:hidden-equipment-source'],
    presentationRefs: ['media.hidden-equipment-art'],
  })
  ;(runtimePackage.modules.actors.payload as any).player.build.startingItemKeys.push(input.key)
}

function addDropAction(runtimePackage: TextOpenWorldRuntimePackageV1, itemKey: string) {
  const suffix = itemKey.replace('item.', '')
  const actions = runtimePackage.modules.actions.payload as TextOpenWorldActionModuleV1
  actions.effects.push({
    key: `effect.drop-${suffix}`,
    operation: 'remove-item',
    payload: { itemKey, quantity: 1, reason: 'drop' },
  })
  actions.actions.push({
    key: `action.drop-${suffix}`, category: 'drop', label: '丢弃', description: '丢弃一件物品。',
    actorScope: 'player', targetScope: 'item', locationKeys: [], requirementConditionKeys: [],
    costEffectKeys: [`effect.drop-${suffix}`], successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'always', repeatPolicy: 'repeatable', cooldownMinutes: null,
  })
}

describe('Text Open World G4-08 · disclosure-safe inventory/equipment projection', () => {
  it('只投影玩家持有物、摘要、分类、安全来源和正式物品Action，不泄露内容内部字段', () => {
    const runtimePackage = inventoryFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.appliedClaimKeys.push('claim.loot-second-sword')
    projection.state.inventory.itemInstances['instance.test.second-sword'] = {
      itemKey: 'item.rust-sword', acquiredByClaimKey: 'claim.loot-second-sword', stateTags: ['new'],
    }
    projection.state.inventory.stackQuantities['item.salt-crystal'] = 2
    const swordInstanceId = Object.entries(projection.state.inventory.itemInstances)
      .find(([, instance]) => instance.itemKey === 'item.rust-sword')![0]
    projection.state.inventory.equippedItemInstanceIdBySlot.weapon = swordInstanceId
    const before = structuredClone(projection)

    const result = projectTextOpenWorldPlayerInventoryV1(projection)

    expect(result.summary).toEqual({
      currency: { label: '盐票', amount: 20 },
      distinctItemCount: 4,
      totalQuantity: 6,
      equippedSlotCount: 1,
      totalSlotCount: 3,
    })
    expect(result.categories).toEqual([
      { kind: 'equipment', label: '装备', distinctItemCount: 1, totalQuantity: 2 },
      { kind: 'consumable', label: '消耗品', distinctItemCount: 1, totalQuantity: 1 },
      { kind: 'material', label: '材料', distinctItemCount: 1, totalQuantity: 2 },
      { kind: 'quest', label: '任务物品', distinctItemCount: 1, totalQuantity: 1 },
      { kind: 'misc', label: '其他', distinctItemCount: 0, totalQuantity: 0 },
    ])

    const sword = result.items.find(item => item.title === '旧盐刀')!
    expect(sword).toMatchObject({
      operationTargetKey: 'item.rust-sword', quantity: 2, equippedQuantity: 1, removableQuantity: 1,
      equippedSlot: { semantic: 'weapon', label: '武器' }, sourceSummary: '初始配置包含此物品。',
      salePolicy: { sellable: true, protected: false, requiresMerchant: true },
      actions: {
        equip: { actionKey: 'action.equip-rust-sword', targetKey: 'item.rust-sword', available: false },
        unequip: { actionKey: 'action.unequip-rust-sword', targetKey: 'item.rust-sword', available: true },
        drop: null,
      },
    })
    expect(sword.actions.equip?.unavailableReasons).toEqual([
      { code: 'condition-failed', message: '旧盐刀已经装备。' },
    ])

    const salt = result.items.find(item => item.title === '盐晶')!
    expect(salt).toMatchObject({
      category: { kind: 'material', label: '材料' }, quantity: 2, removableQuantity: 2,
      baseValue: { label: '基础价值', amount: 2 },
      actions: {
        drop: {
          actionKey: 'action.drop-salt-crystal', targetKey: 'item.salt-crystal',
          available: true, confirmationPolicy: 'always', confirmationRequired: true,
        },
      },
    })
    expect(result.items.find(item => item.title === '盐露药剂')?.actions.use).toMatchObject({
      available: false,
      unavailableReasons: [{ code: 'condition-failed', message: '生命已经满了。' }],
    })

    const critical = result.items.find(item => item.title === '守渠印')!
    expect(critical).toMatchObject({
      critical: true, unique: true, removableQuantity: 0, actions: { use: null, equip: null, unequip: null, drop: null },
      salePolicy: {
        sellable: false, protected: true, requiresMerchant: false,
        message: '关键物品受到保护，不能出售。',
      },
    })
    expect(critical.protectionMessages).toEqual(['关键物品受到保护，不能丢弃、出售或作为材料消耗。'])

    expect(projection).toEqual(before)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/sourceRefs|effectKeys|presentationRefs|itemInstanceId|acquiredByClaimKey|conditionKey/)
    expect(serialized).not.toContain('world-release:')
    expect(serialized).not.toContain('media.hidden')
  })

  it('空背包保留确定性分类和三个装备位，并且不会投影未持有的目录物品', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    projection.state.inventory.stackQuantities = {}
    projection.state.inventory.itemInstances = {}
    projection.state.inventory.equippedItemInstanceIdBySlot = { weapon: null, armor: null, accessory: null }

    const result = projectTextOpenWorldPlayerInventoryV1(projection)
    expect(result.summary).toMatchObject({ distinctItemCount: 0, totalQuantity: 0, equippedSlotCount: 0, totalSlotCount: 3 })
    expect(result.items).toEqual([])
    expect(result.categories).toHaveLength(5)
    expect(result.categories.every(category => category.distinctItemCount === 0 && category.totalQuantity === 0)).toBe(true)
    expect(result.equipmentSlots).toEqual([
      { semantic: 'weapon', label: '武器', current: null, candidates: [] },
      { semantic: 'armor', label: '防具', current: null, candidates: [] },
      { semantic: 'accessory', label: '饰品', current: null, candidates: [] },
    ])
    expect(JSON.stringify(result)).not.toContain('盐晶')
  })

  it('装备候选与卸下预览复用正式派生属性，保留0和负修正但不把skillPower冒充为已生效属性', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    addEquipment(runtimePackage, {
      key: 'item.salt-coat',
      title: '盐织外衣',
      slot: 'armor',
      modifiers: { maximumHealth: 10, defense: -2, initiative: 0, skillPower: 999 },
    })
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)

    const candidateResult = projectTextOpenWorldPlayerInventoryV1(projection)
    const armor = candidateResult.items.find(item => item.title === '盐织外衣')!
    expect(armor.statModifiers).toEqual([
      { semantic: 'maximumHealth', label: '最大生命', value: 10, displayValue: '+10' },
      { semantic: 'defense', label: '防御', value: -2, displayValue: '-2' },
      { semantic: 'initiative', label: '先手', value: 0, displayValue: '0' },
    ])
    expect(JSON.stringify(armor)).not.toContain('skillPower')

    const armorSlot = candidateResult.equipmentSlots.find(slot => slot.semantic === 'armor')!
    const candidate = armorSlot.candidates.find(item => item.title === '盐织外衣')!
    expect(candidate.equipAction).toMatchObject({ available: true, targetKey: 'item.salt-coat' })
    expect(candidate.preview.stats.find(stat => stat.semantic === 'maximumHealth')).toMatchObject({
      before: 37, after: 47, delta: 10, displayDelta: '+10', direction: 'increase',
    })
    expect(candidate.preview.stats.find(stat => stat.semantic === 'defense')).toMatchObject({
      before: 3, after: 1, delta: -2, displayDelta: '-2', direction: 'decrease',
    })
    expect(candidate.preview.stats.find(stat => stat.semantic === 'initiative')).toMatchObject({
      before: 3, after: 3, delta: 0, displayDelta: '0', direction: 'unchanged',
    })
    expect(candidate.preview.resourceAdjustmentMessages).toEqual([])

    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await catalog.plan({
      effectKeys: ['effect.equip-salt-coat'], claimKey: 'claim.equip-salt-coat', state: projection.state,
    })
    projection.state = (await catalog.apply({ plan, state: projection.state })).state
    projection.state.player.health = 47
    const equippedResult = projectTextOpenWorldPlayerInventoryV1(projection)
    const current = equippedResult.equipmentSlots.find(slot => slot.semantic === 'armor')!.current!
    expect(current.title).toBe('盐织外衣')
    expect(current.unequipAction).toMatchObject({ available: true, targetKey: 'item.salt-coat' })
    expect(current.preview.stats.find(stat => stat.semantic === 'maximumHealth')).toMatchObject({
      before: 47, after: 37, delta: -10, direction: 'decrease',
    })
    expect(current.preview.resourceAdjustmentMessages).toEqual(['当前生命将由47调整为37。'])
  })

  it('丢弃操作以未装备实例数收紧Action可用性，且兼容旧Release没有drop Action', () => {
    const legacy = createTextOpenWorldVNextFixture()
    const legacyProjection = createInitialTextOpenWorldSessionProjectionV1(legacy)
    const legacyItem = projectTextOpenWorldPlayerInventoryV1(legacyProjection).items
      .find(item => item.title === '旧盐刀')!
    expect(legacyItem.removableQuantity).toBe(1)
    expect(legacyItem.actions.drop).toBeNull()

    const runtimePackage = createTextOpenWorldVNextFixture()
    addDropAction(runtimePackage, 'item.rust-sword')
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const swordInstanceId = Object.entries(projection.state.inventory.itemInstances)
      .find(([, instance]) => instance.itemKey === 'item.rust-sword')![0]
    projection.state.inventory.equippedItemInstanceIdBySlot.weapon = swordInstanceId

    const item = projectTextOpenWorldPlayerInventoryV1(projection).items.find(candidate => candidate.title === '旧盐刀')!
    expect(item).toMatchObject({ quantity: 1, equippedQuantity: 1, removableQuantity: 0 })
    expect(item.actions.drop).toMatchObject({
      actionKey: 'action.drop-rust-sword', targetKey: 'item.rust-sword', available: false,
      confirmationPolicy: 'always', confirmationRequired: true,
      unavailableReasons: [{ code: 'item-unavailable', message: '当前没有可丢弃的未装备物品。' }],
    })
    expect(item.salePolicy).toEqual({
      sellable: false,
      protected: false,
      requiresMerchant: true,
      message: '当前没有可出售的未装备物品；请先卸下装备，再前往商店交易。',
    })
  })
})
