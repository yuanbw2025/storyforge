import { describe, expect, it } from 'vitest'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldEffectCatalogV1, validateTextOpenWorldEffectStateV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

type Slot = 'weapon' | 'armor' | 'accessory'

function addEquipment(fixture: ReturnType<typeof createTextOpenWorldVNextFixture>, input: {
  key: string
  title: string
  slot: Slot
  modifiers: Record<string, number>
}) {
  const suffix = input.key.replace('item.', '')
  const conditions = (fixture.modules.actions.payload as any).conditions
  const effects = (fixture.modules.actions.payload as any).effects
  const actions = (fixture.modules.actions.payload as any).actions
  conditions.push(
    { key: `condition.${suffix}-not-equipped`, expression: { op: 'inventory-equipped', itemKey: input.key, equipped: false }, failureMessage: `${input.title}已经装备。` },
    { key: `condition.${suffix}-equipped`, expression: { op: 'inventory-equipped', itemKey: input.key, equipped: true }, failureMessage: `${input.title}尚未装备。` },
  )
  effects.push(
    { key: `effect.equip-${suffix}`, operation: 'equip-item', payload: { itemKey: input.key } },
    { key: `effect.unequip-${suffix}`, operation: 'unequip-item', payload: { itemKey: input.key } },
    { key: `effect.drop-${suffix}`, operation: 'remove-item', payload: { itemKey: input.key, quantity: 1, reason: 'drop' } },
  )
  actions.push(
    {
      key: `action.equip-${suffix}`, category: 'equip', label: `装备${input.title}`, description: `装备${input.title}。`,
      actorScope: 'player', targetScope: 'item', locationKeys: [], requirementConditionKeys: [`condition.${suffix}-not-equipped`], costEffectKeys: [],
      successEffectKeys: [`effect.equip-${suffix}`], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    },
    {
      key: `action.unequip-${suffix}`, category: 'unequip', label: `卸下${input.title}`, description: `卸下${input.title}。`,
      actorScope: 'player', targetScope: 'item', locationKeys: [], requirementConditionKeys: [`condition.${suffix}-equipped`], costEffectKeys: [],
      successEffectKeys: [`effect.unequip-${suffix}`], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    },
  )
  ;(fixture.modules.items.payload as any).items.push({
    key: input.key, title: input.title, description: `${input.title}的固定属性装备。`, tags: ['装备'], kind: 'equipment',
    stackPolicy: 'instanced', maximumStack: null, unique: false, consumable: false, critical: false, droppable: true, sellable: true,
    baseValue: 20, useActionKey: null, equipActionKey: `action.equip-${suffix}`, unequipActionKey: `action.unequip-${suffix}`,
    equipConditionKeys: [], equipmentSlotKey: input.slot, statModifiers: input.modifiers, effectKeys: [], sourceRefs: [], presentationRefs: [],
  })
}

function equipmentFixture() {
  const fixture = createTextOpenWorldVNextFixture()
  addEquipment(fixture, { key: 'item.salt-coat', title: '盐织外衣', slot: 'armor', modifiers: { maximumHealth: 10 } })
  addEquipment(fixture, { key: 'item.tide-charm', title: '潮声护符', slot: 'accessory', modifiers: { skillResource: 2 } })
  addEquipment(fixture, { key: 'item.tide-spear', title: '引潮长枪', slot: 'weapon', modifiers: { attack: 5 } })
  ;(fixture.modules.actions.payload as any).effects.push({
    key: 'effect.drop-rust-sword', operation: 'remove-item', payload: { itemKey: 'item.rust-sword', quantity: 1, reason: 'drop' },
  })
  const build = (fixture.modules.actors.payload as any).player.build
  build.startingItemKeys.push('item.salt-coat', 'item.tide-charm', 'item.tide-spear')
  return fixture
}

async function apply(fixture: ReturnType<typeof equipmentFixture>, state: ReturnType<typeof createInitialTextOpenWorldSessionProjectionV1>['state'], effectKey: string, claimKey: string) {
  const catalog = createTextOpenWorldEffectCatalogV1(fixture)
  const plan = await catalog.plan({ effectKeys: [effectKey], claimKey, state })
  return (await catalog.apply({ plan, state })).state
}

describe('Text Open World vNext · equipment slots and deterministic stat recalculation', () => {
  it('装备与卸下引用具体实例，Action可用性和派生攻击使用同一状态', async () => {
    const fixture = equipmentFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(fixture)
    const registry = createTextOpenWorldActionRegistryV1(fixture)
    let actions = registry.project(deriveTextOpenWorldContextsV1(projection).action)
    expect(actions.find(item => item.action.key === 'action.equip-rust-sword')).toMatchObject({ available: true, validTargetKeys: ['item.rust-sword'] })
    expect(actions.find(item => item.action.key === 'action.unequip-rust-sword')).toMatchObject({ available: false })

    projection.state = await apply(fixture, projection.state, 'effect.equip-rust-sword', 'claim.equip-sword')
    expect(projection.state.inventory.equippedItemInstanceIdBySlot.weapon).toBe('instance.initial.1.item.rust-sword')
    expect(deriveTextOpenWorldContextsV1(projection).playerStats.attack).toBe(8)
    actions = registry.project(deriveTextOpenWorldContextsV1(projection).action)
    expect(actions.find(item => item.action.key === 'action.equip-rust-sword')).toMatchObject({ available: false })
    expect(actions.find(item => item.action.key === 'action.unequip-rust-sword')).toMatchObject({ available: true, validTargetKeys: ['item.rust-sword'] })

    projection.state = await apply(fixture, projection.state, 'effect.unequip-rust-sword', 'claim.unequip-sword')
    expect(projection.state.inventory.equippedItemInstanceIdBySlot.weapon).toBeNull()
    expect(deriveTextOpenWorldContextsV1(projection).playerStats.attack).toBe(6)
  })

  it('三装备位独立占槽；提高上限不治疗，卸装时将当前资源裁剪到新上限', async () => {
    const fixture = equipmentFixture()
    let state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    state = await apply(fixture, state, 'effect.equip-salt-coat', 'claim.equip-armor')
    expect(state).toMatchObject({ player: { health: 37, maximumHealth: 47 }, inventory: { equippedItemInstanceIdBySlot: { armor: 'instance.initial.2.item.salt-coat' } } })
    state.player.health = 47
    state = await apply(fixture, state, 'effect.unequip-salt-coat', 'claim.unequip-armor')
    expect(state.player).toMatchObject({ health: 37, maximumHealth: 37 })

    state = await apply(fixture, state, 'effect.equip-tide-charm', 'claim.equip-accessory')
    expect(state.player).toMatchObject({ skillResource: 4, maximumSkillResource: 6 })
    expect(state.inventory.equippedItemInstanceIdBySlot.accessory).toBe('instance.initial.3.item.tide-charm')
    state.player.skillResource = 6
    state = await apply(fixture, state, 'effect.unequip-tide-charm', 'claim.unequip-accessory')
    expect(state.player).toMatchObject({ skillResource: 4, maximumSkillResource: 4 })
  })

  it('同槽装备会原子替换旧实例；只有未装备实例可以被移除', async () => {
    const fixture = equipmentFixture()
    let state = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    state = await apply(fixture, state, 'effect.equip-rust-sword', 'claim.equip-old-weapon')
    state = await apply(fixture, state, 'effect.equip-tide-spear', 'claim.replace-weapon')
    expect(state.inventory.equippedItemInstanceIdBySlot.weapon).toBe('instance.initial.4.item.tide-spear')
    expect(Object.keys(state.inventory.itemInstances)).toContain('instance.initial.1.item.rust-sword')

    state = await apply(fixture, state, 'effect.drop-rust-sword', 'claim.drop-old-weapon')
    expect(Object.keys(state.inventory.itemInstances)).not.toContain('instance.initial.1.item.rust-sword')
    await expect(apply(fixture, state, 'effect.drop-tide-spear', 'claim.drop-equipped-weapon'))
      .rejects.toThrow('未装备物品实例数量不足')
  })

  it('装备状态拒绝悬空实例、错误装备位和重复占位', () => {
    const fixture = equipmentFixture()
    const modules = parseTextOpenWorldModulesV1(fixture)
    const missing = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    missing.inventory.equippedItemInstanceIdBySlot.weapon = 'instance.missing'
    expect(() => validateTextOpenWorldEffectStateV1(missing, modules)).toThrow('装备位引用未知物品实例')

    const wrongSlot = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    wrongSlot.inventory.equippedItemInstanceIdBySlot.armor = 'instance.initial.1.item.rust-sword'
    expect(() => validateTextOpenWorldEffectStateV1(wrongSlot, modules)).toThrow('不能装备到armor')

    const duplicate = createInitialTextOpenWorldSessionProjectionV1(fixture).state
    duplicate.inventory.equippedItemInstanceIdBySlot.weapon = 'instance.initial.1.item.rust-sword'
    duplicate.inventory.equippedItemInstanceIdBySlot.armor = 'instance.initial.1.item.rust-sword'
    expect(() => validateTextOpenWorldEffectStateV1(duplicate, modules)).toThrow()
  })

  it('发布时拒绝装备Action缺失、操作类型错误和装备条件漏接', () => {
    const missing = equipmentFixture()
    ;(missing.modules.items.payload as any).items[0].equipActionKey = null
    expect(() => parseTextOpenWorldModulesV1(missing)).toThrow('装备Action定义不完整')

    const wrong = equipmentFixture()
    ;(wrong.modules.actions.payload as any).actions.find((item: any) => item.key === 'action.equip-rust-sword').category = 'use'
    expect(() => parseTextOpenWorldModulesV1(wrong)).toThrow('不符合装备事务')

    const requirement = equipmentFixture()
    const item = (requirement.modules.items.payload as any).items[0]
    item.equipConditionKeys = ['condition.always']
    expect(() => parseTextOpenWorldModulesV1(requirement)).toThrow('装备Action缺少条件')
  })
})
