import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1, validateTextOpenWorldEffectStateV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { deriveTextOpenWorldProgressionStatusV1 } from '../../src/lib/open-world/progression'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type { TextOpenWorldEffectDefinitionV1, TextOpenWorldProgressionModuleV1 } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function withExperienceEffects(effects: TextOpenWorldEffectDefinitionV1[]) {
  const runtimePackage = createTextOpenWorldVNextFixture()
  ;(runtimePackage.modules.actions.payload as { effects: TextOpenWorldEffectDefinitionV1[] }).effects.push(...effects)
  return runtimePackage
}

describe('Text Open World vNext · level curve and atomic experience progression', () => {
  it('一次奖励可从1级连升到5级，属性和资源上限按曲线同步增长', async () => {
    const runtimePackage = withExperienceEffects([
      { key: 'effect.reach-level-five', operation: 'grant-experience', payload: { amount: 1_600 } },
    ])
    const before = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await catalog.plan({ effectKeys: ['effect.reach-level-five'], claimKey: 'claim.level-five', state: before })
    const applied = await catalog.apply({ plan, state: before })
    expect(applied.state.player).toMatchObject({
      level: 5, experience: 1_600, attributes: { power: 7, vitality: 7, agility: 5 },
      health: 65, maximumHealth: 65, skillResource: 8, maximumSkillResource: 8,
    })
    expect(applied.receipt.changes[0]).toMatchObject({
      operation: 'grant-experience',
      before: { level: 1, experience: 0, maximumHealth: 37, maximumSkillResource: 4 },
      after: { level: 5, experience: 1_600, appliedExperience: 1_600, discardedExperience: 0, maximumHealth: 65, maximumSkillResource: 8 },
    })
    const status = deriveTextOpenWorldProgressionStatusV1(parseTextOpenWorldModulesV1(runtimePackage), applied.state.player.experience)
    expect(status).toMatchObject({ level: 5, currentLevelThreshold: 1_600, nextLevelThreshold: 2_500, experienceIntoLevel: 0, experienceForNextLevel: 900, progressRatio: 0, atMaximumLevel: false })
  })

  it('最高20级按阈值封顶，超额经验不溢出且每个claim只能结算一次', async () => {
    const runtimePackage = withExperienceEffects([
      { key: 'effect.massive-experience', operation: 'grant-experience', payload: { amount: 1_000_000_000 } },
      { key: 'effect.more-experience', operation: 'grant-experience', payload: { amount: 50 } },
    ])
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const before = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const firstPlan = await catalog.plan({ effectKeys: ['effect.massive-experience'], claimKey: 'claim.maximum-level', state: before })
    const first = await catalog.apply({ plan: firstPlan, state: before })
    expect(first.state.player).toMatchObject({ level: 20, experience: 36_100 })
    expect(first.receipt.changes[0]).toMatchObject({ after: { appliedExperience: 36_100, discardedExperience: 999_963_900 } })
    await expect(catalog.plan({ effectKeys: ['effect.massive-experience'], claimKey: 'claim.maximum-level', state: first.state }))
      .rejects.toThrow('claim已应用')

    const secondPlan = await catalog.plan({ effectKeys: ['effect.more-experience'], claimKey: 'claim.maximum-level-extra', state: first.state })
    const second = await catalog.apply({ plan: secondPlan, state: first.state })
    expect(second.state.player).toMatchObject({ level: 20, experience: 36_100 })
    expect(second.receipt.changes[0]).toMatchObject({ after: { appliedExperience: 0, discardedExperience: 50 } })
    const status = deriveTextOpenWorldProgressionStatusV1(parseTextOpenWorldModulesV1(runtimePackage), second.state.player.experience)
    expect(status).toMatchObject({ level: 20, maximumLevel: 20, nextLevelThreshold: null, progressRatio: 1, atMaximumLevel: true })
  })

  it('拒绝等级、经验、自动属性和派生资源上限彼此漂移的Session状态', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    const initial = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    expect(() => validateTextOpenWorldEffectStateV1({ ...structuredClone(initial), player: { ...initial.player, level: 2 } }, modules))
      .toThrow('level与经验阈值不一致')
    expect(() => validateTextOpenWorldEffectStateV1({ ...structuredClone(initial), player: { ...initial.player, attributes: { ...initial.player.attributes, power: 99 } } }, modules))
      .toThrow('attributes与自动成长曲线不一致')
    expect(() => validateTextOpenWorldEffectStateV1({ ...structuredClone(initial), player: { ...initial.player, maximumHealth: 999 } }, modules))
      .toThrow('资源上限与Release公式不一致')
    expect(() => validateTextOpenWorldEffectStateV1({ ...structuredClone(initial), player: { ...initial.player, experience: 36_101 } }, modules))
      .toThrow('超过最高等级阈值')
  })

  it('拒绝非20级、首级非零、阈值不递增和未冻结的升级策略', () => {
    const maximum = createTextOpenWorldVNextFixture()
    ;(maximum.modules.progression.payload as TextOpenWorldProgressionModuleV1).rules.maximumLevel = 19
    expect(() => parseTextOpenWorldModulesV1(maximum)).toThrow('maximumLevel必须为20')

    const first = createTextOpenWorldVNextFixture()
    ;(first.modules.progression.payload as TextOpenWorldProgressionModuleV1).levels[0].cumulativeExperience = 1
    expect(() => parseTextOpenWorldModulesV1(first)).toThrow('1级必须从0经验')

    const duplicate = createTextOpenWorldVNextFixture()
    ;(duplicate.modules.progression.payload as TextOpenWorldProgressionModuleV1).levels[2].cumulativeExperience = 100
    expect(() => parseTextOpenWorldModulesV1(duplicate)).toThrow('累计经验必须递增')

    const policy = createTextOpenWorldVNextFixture()
    ;(policy.modules.progression.payload as any).rules.levelUp.resourcePolicy = 'restore-all'
    expect(() => parseTextOpenWorldModulesV1(policy)).toThrow('不符合首版冻结策略')
  })
})
