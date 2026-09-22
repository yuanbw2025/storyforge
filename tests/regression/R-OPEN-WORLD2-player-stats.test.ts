import { describe, expect, it } from 'vitest'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { deriveTextOpenWorldPlayerStatsV1 } from '../../src/lib/open-world/player-stats'
import { createInitialTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from '../../src/lib/open-world/session-projection'
import type { TextOpenWorldProgressionModuleV1 } from '../../src/lib/types'
import { createTextOpenWorldProductRuntimePackageFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function stats(input?: {
  level?: number
  attributes?: { power: number; vitality: number; agility: number }
  equipped?: { weapon: string | null; armor: string | null; accessory: string | null }
}) {
  return deriveTextOpenWorldPlayerStatsV1({
    runtimePackage: createTextOpenWorldVNextFixture(),
    level: input?.level ?? 1,
    attributes: input?.attributes ?? { power: 3, vitality: 3, agility: 3 },
    equippedItemKeyBySlot: input?.equipped ?? { weapon: null, armor: null, accessory: null },
  })
}

describe('Text Open World vNext · three semantic attributes and deterministic derived stats', () => {
  it('从Release公式和Session输入派生六项战斗值，并保留可解释来源', () => {
    const result = stats()
    expect(result).toMatchObject({
      maximumHealth: 37,
      attack: 6,
      defense: 3,
      criticalChance: 0.065,
      initiative: 3,
      maximumSkillResource: 4,
    })
    expect(result.breakdown.maximumHealth).toMatchObject({
      semanticKey: 'maximumHealth', formulaKey: 'health.v1', rawValue: 37, value: 37,
    })
    expect(result.breakdown.maximumHealth.components.map(item => item.sourceKey))
      .toEqual(['baseHealth', 'vitality', 'level'])
  })

  it('装备加成进入同一服务，显示名变化不改变power/vitality/agility语义', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const progression = runtimePackage.modules.progression.payload as TextOpenWorldProgressionModuleV1
    progression.rules.attributes.power.label = '灵压'
    progression.rules.attributes.vitality.label = '根骨'
    progression.rules.attributes.agility.label = '身法'
    const result = deriveTextOpenWorldPlayerStatsV1({
      runtimePackage, level: 1, attributes: { power: 3, vitality: 3, agility: 3 },
      equippedItemKeyBySlot: { weapon: 'item.rust-sword', armor: null, accessory: null },
    })
    expect(result.attack).toBe(8)
    expect(result.breakdown.attack.components).toEqual([
      { sourceKind: 'attribute', sourceKey: 'power', value: 6 },
      { sourceKind: 'equipment', sourceKey: 'item.rust-sword', value: 2 },
    ])
  })

  it('对暴击和负向装备结果执行规则内封顶，不产生负值或负零', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const itemModule = runtimePackage.modules.items.payload as ReturnType<typeof parseTextOpenWorldModulesV1>['items']
    itemModule.items[0].statModifiers = { attack: -100, defense: -100, criticalChance: 5, initiative: -100, maximumHealth: -100, skillResource: -100 }
    const result = deriveTextOpenWorldPlayerStatsV1({
      runtimePackage, level: 1, attributes: { power: 3, vitality: 3, agility: 3 },
      equippedItemKeyBySlot: { weapon: 'item.rust-sword', armor: null, accessory: null },
    })
    expect(result).toMatchObject({ maximumHealth: 1, attack: 0, defense: 0, criticalChance: 0.5, initiative: 0, maximumSkillResource: 0 })
    expect(Object.values(result).filter(value => typeof value === 'number').some(value => Object.is(value, -0))).toBe(false)
  })

  it('初始Session和全部运行时消费者使用相同派生结果', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    const contexts = deriveTextOpenWorldContextsV1(projection)
    expect(projection.state.player).toMatchObject({ health: 37, maximumHealth: 37, skillResource: 4, maximumSkillResource: 4 })
    expect(contexts.playerStats).toMatchObject({ maximumHealth: 37, attack: 6, defense: 3, criticalChance: 0.065, initiative: 3, maximumSkillResource: 4 })
    expect(contexts.condition.player.maximumHealth).toBe(contexts.playerStats.maximumHealth)
  })

  it('拒绝NaN、越界暴击、第四属性、非法装备引用和派生溢出', async () => {
    const nan = createTextOpenWorldVNextFixture()
    ;(nan.modules.progression.payload as TextOpenWorldProgressionModuleV1).rules.formulas.attackPerPower = Number.NaN
    expect(() => parseTextOpenWorldModulesV1(nan)).toThrow(/NaN|有限/)

    const invalidCritical = createTextOpenWorldVNextFixture()
    ;(invalidCritical.modules.progression.payload as TextOpenWorldProgressionModuleV1).rules.formulas.criticalChanceCap = 2
    expect(() => parseTextOpenWorldModulesV1(invalidCritical)).toThrow('criticalChanceCap')

    expect(() => deriveTextOpenWorldPlayerStatsV1({
      runtimePackage: createTextOpenWorldVNextFixture(), level: 1,
      attributes: { power: 3, vitality: 3, agility: 3, focus: 99 } as never,
      equippedItemKeyBySlot: { weapon: null, armor: null, accessory: null },
    })).toThrow('attributes字段不符合合同')
    const extraAttribute = createTextOpenWorldVNextFixture()
    ;(extraAttribute.modules.actors.payload as any).player.build.attributes.focus = 99
    expect(() => parseTextOpenWorldModulesV1(extraAttribute)).toThrow('字段不符合合同')

    expect(() => deriveTextOpenWorldPlayerStatsV1({
      runtimePackage: createTextOpenWorldVNextFixture(), level: 1,
      attributes: { power: 3, vitality: 3, agility: 3 },
      equippedItemKeyBySlot: { weapon: 'item.salt-crystal', armor: null, accessory: null },
    })).toThrow('装备引用无效')

    const overflow = createTextOpenWorldVNextFixture()
    ;(overflow.modules.actors.payload as any).player.build.attributes.power = 10_000
    ;(overflow.modules.progression.payload as TextOpenWorldProgressionModuleV1).rules.formulas.attackPerPower = 1_000_000
    expect(() => deriveTextOpenWorldPlayerStatsV1({
      runtimePackage: overflow, level: 1, attributes: { power: 10_000, vitality: 3, agility: 3 },
      equippedItemKeyBySlot: { weapon: null, armor: null, accessory: null },
    })).toThrow('计算溢出')
    expect(() => createTextOpenWorldProductRuntimePackageFixtureV1(overflow)).toThrow('计算溢出')
  })
})
