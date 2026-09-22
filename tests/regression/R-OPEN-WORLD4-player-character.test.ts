import { describe, expect, it } from 'vitest'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { projectTextOpenWorldPlayerCharacterV1 } from '../../src/lib/open-world/player-character'
import { deriveTextOpenWorldPlayerStatsFromModulesV1 } from '../../src/lib/open-world/player-stats'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type {
  TextOpenWorldActionModuleV1,
  TextOpenWorldActorModuleV1,
  TextOpenWorldItemModuleV1,
  TextOpenWorldProgressionModuleV1,
  TextOpenWorldQuestModuleV1,
  TextOpenWorldRuntimePackageV1,
} from '../../src/lib/types'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatActionsV1,
} from '../helpers/text-open-world-vnext-fixture'

function characterCatalogFixture(): TextOpenWorldRuntimePackageV1 {
  const runtimePackage = downgradeTextOpenWorldFixtureCombatActionsV1(createTextOpenWorldVNextFixture())
  const progression = runtimePackage.modules.progression.payload as TextOpenWorldProgressionModuleV1
  const actors = runtimePackage.modules.actors.payload as TextOpenWorldActorModuleV1
  const actions = runtimePackage.modules.actions.payload as TextOpenWorldActionModuleV1
  const quests = runtimePackage.modules.quests.payload as TextOpenWorldQuestModuleV1
  const items = runtimePackage.modules.items.payload as TextOpenWorldItemModuleV1

  progression.rules.attributes.power.label = '腕力'
  progression.rules.attributes.vitality.label = '耐力'
  progression.rules.attributes.agility.label = '身法'
  progression.skills.push(
    {
      key: 'skill.canal-instinct', title: '守渠直觉', description: '长期观察水势形成的被动判断。', tags: ['被动'],
      activation: 'passive', kind: 'status', target: 'self', scalingAttribute: null,
      unlockSources: [{ kind: 'initial', level: null, questKey: null }], useConditionKeys: [], priority: 20,
      resourceCost: 0, cooldownTurns: 0, effectKeys: [],
    },
    {
      key: 'skill.level-gate', title: '踏浪', description: '经验增长后掌握的步法。', tags: ['移动'],
      activation: 'active', kind: 'resource', target: 'self', scalingAttribute: 'agility',
      unlockSources: [{ kind: 'level', level: 2, questKey: null }], useConditionKeys: ['condition.level-two'], priority: 30,
      resourceCost: 3, cooldownTurns: 1, effectKeys: [],
    },
    {
      key: 'skill.main-reward', title: '辨流', description: '从主线经历中可能习得的辨水能力。', tags: ['调查'],
      activation: 'active', kind: 'status', target: 'self', scalingAttribute: null,
      unlockSources: [{ kind: 'quest', level: null, questKey: 'quest.main.1' }], useConditionKeys: [], priority: 25,
      resourceCost: 1, cooldownTurns: 0, effectKeys: [],
    },
    {
      key: 'skill.hidden-reward', title: '藏盐术', description: '某项尚未发现的委托可能传授的技巧。', tags: ['秘密'],
      activation: 'active', kind: 'status', target: 'self', scalingAttribute: null,
      unlockSources: [{ kind: 'quest', level: null, questKey: 'quest.template.supplies' }], useConditionKeys: [], priority: 15,
      resourceCost: 1, cooldownTurns: 0, effectKeys: [],
    },
  )
  progression.levels[0].unlockedSkillKeys.push('skill.canal-instinct')
  progression.levels[1].unlockedSkillKeys.push('skill.level-gate')
  actors.player.build.learnedSkillKeys.push('skill.canal-instinct')

  actions.effects.push(
    { key: 'effect.learn-main-reward', operation: 'learn-skill', payload: { skillKey: 'skill.main-reward' } },
    { key: 'effect.learn-hidden-reward', operation: 'learn-skill', payload: { skillKey: 'skill.hidden-reward' } },
  )
  const mainQuest = quests.quests.find(quest => quest.key === 'quest.main.1')!
  const hiddenQuest = quests.quests.find(quest => quest.key === 'quest.template.supplies')!
  mainQuest.rewardEffectKeys.push('effect.learn-main-reward')
  hiddenQuest.rewardEffectKeys.push('effect.learn-hidden-reward')
  items.rewardContracts.find(reward => reward.key === 'reward.quest-main')!
    .effectKeys.push('effect.learn-main-reward')
  items.rewardContracts.find(reward => reward.key === 'reward.quest-supplies')!
    .effectKeys.push('effect.learn-hidden-reward')

  progression.statuses.push(
    { key: 'status.salt-burn', title: '盐灼', description: '盐尘令伤口持续刺痛。', polarity: 'harmful' },
    { key: 'status.watched', title: '受关注', description: '附近的人正在留意你的行动。', polarity: 'neutral' },
  )
  return runtimePackage
}

function synchronizeLevel(
  runtimePackage: TextOpenWorldRuntimePackageV1,
  level: number,
) {
  const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const modules = parseTextOpenWorldModulesV1(runtimePackage)
  const initialLevel = modules.actors.player.build.initialLevel
  const attributes = structuredClone(modules.actors.player.build.attributes)
  for (let currentLevel = initialLevel + 1; currentLevel <= level; currentLevel += 1) {
    const growth = modules.progression.levels[currentLevel - 1].attributeGrowth
    attributes.power += growth.power
    attributes.vitality += growth.vitality
    attributes.agility += growth.agility
  }
  const derived = deriveTextOpenWorldPlayerStatsFromModulesV1({
    modules,
    level,
    attributes,
    equippedItemKeyBySlot: { weapon: null, armor: null, accessory: null },
  })
  projection.state.player = {
    ...projection.state.player,
    level,
    experience: modules.progression.levels[level - 1].cumulativeExperience,
    attributes,
    health: derived.maximumHealth,
    maximumHealth: derived.maximumHealth,
    skillResource: derived.maximumSkillResource,
    maximumSkillResource: derived.maximumSkillResource,
  }
  return projection
}

describe('Text Open World G4-07 · disclosure-safe player character projection', () => {
  it('投影本地化身份、三属性、派生来源、全部技能和当前状态而不透传内部定义', () => {
    const runtimePackage = characterCatalogFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const rustSwordInstanceId = Object.entries(projection.state.inventory.itemInstances)
      .find(([, instance]) => instance.itemKey === 'item.rust-sword')![0]
    projection.state.inventory.equippedItemInstanceIdBySlot.weapon = rustSwordInstanceId
    projection.state.player.skillResource = 1
    projection.state.player.statusKeys = ['status.rested', 'status.salt-burn', 'status.watched']

    const result = projectTextOpenWorldPlayerCharacterV1(projection)
    expect(result.identity).toMatchObject({
      name: '来客', background: '', shortGoal: '查明盐渠断流原因', longGoal: '决定两地供水未来',
    })
    expect(result.identity).not.toHaveProperty('privateKnowledge')
    expect(result.identity).not.toHaveProperty('portrayal')
    expect(result.attributes).toEqual([
      { semantic: 'power', label: '腕力', value: 3, initialValue: 3, levelGrowth: 0, growthByLevel: [] },
      { semantic: 'vitality', label: '耐力', value: 3, initialValue: 3, levelGrowth: 0, growthByLevel: [] },
      { semantic: 'agility', label: '身法', value: 3, initialValue: 3, levelGrowth: 0, growthByLevel: [] },
    ])
    expect(result.derivedStats.find(stat => stat.semantic === 'attack')).toMatchObject({
      label: '攻击', value: 8,
      sources: [
        { kind: 'attribute', label: '腕力', value: 6 },
        { kind: 'equipment', label: '旧盐刀', value: 2 },
      ],
    })
    expect(result.derivedStats.find(stat => stat.semantic === 'criticalChance')).toMatchObject({
      displayValue: '6.5%',
      sources: [{ label: '基础暴击率', displayValue: '5%' }, { label: '身法', displayValue: '1.5%' }],
    })

    const passive = result.skills.find(skill => skill.title === '守渠直觉')!
    expect(passive).toMatchObject({
      learned: true, stateLabel: '已学会', activationLabel: '被动技能', availabilityLabel: '已掌握的被动技能',
      skillConditionsReady: false, cooldownRemainingTurns: 0, unavailableReasons: [],
      acquisition: [{ kind: 'initial', label: '初始可掌握', discovered: true }],
    })
    const levelLocked = result.skills.find(skill => skill.title === '踏浪')!
    expect(levelLocked).toMatchObject({
      learned: false, stateLabel: '未解锁', availabilityLabel: '尚未学会',
      cooldownRemainingTurns: 0, unavailableReasons: ['尚未学会'],
      acquisition: [{ kind: 'level', label: '达到 2 级可解锁', level: 2, discovered: true }],
    })
    expect(levelLocked.unavailableReasons).not.toContain('经验不足，无法让谎言自洽。')
    expect(result.skills.find(skill => skill.title === '辨流')!.acquisition).toEqual([{
      kind: 'quest', label: '可能通过任务奖励获得：断流的盐渠', level: null,
      questTitle: '断流的盐渠', discovered: true,
    }])
    expect(result.skills.find(skill => skill.title === '藏盐术')!.acquisition).toEqual([{
      kind: 'quest', label: '尚未发现的任务奖励', level: null, questTitle: null, discovered: false,
    }])
    expect(result.statuses).toEqual([
      { title: '休整完毕', description: '角色已经充分休息。', polarityLabel: '有益' },
      { title: '盐灼', description: '盐尘令伤口持续刺痛。', polarityLabel: '有害' },
      { title: '受关注', description: '附近的人正在留意你的行动。', polarityLabel: '中性' },
    ])

    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/sourceRefs|formulaKey|effect\.|condition\.|skill\.|status\.|quest\.|world-release:/)
    expect(serialized).not.toContain('短缺物资')
    expect(serialized).not.toContain('privateKnowledge')
    expect(serialized).not.toContain('portrayal')
  })

  it('只有已经发放的任务才公开技能的可能任务来源，撤回且未发放的实例仍保持隐藏', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(characterCatalogFixture())
    const mainInstance = Object.values(projection.state.quests.instancesByKey)
      .find(instance => instance.definitionKey === 'quest.main.1')!
    mainInstance.status = 'withdrawn'
    mainInstance.offeredAtWorldMinute = null
    mainInstance.terminalAtWorldMinute = projection.state.time.worldMinute
    projection.state.quests.tracking.primaryInstanceKey = null

    const result = projectTextOpenWorldPlayerCharacterV1(projection)
    expect(result.skills.find(skill => skill.title === '辨流')!.acquisition).toEqual([{
      kind: 'quest', label: '尚未发现的任务奖励', level: null, questTitle: null, discovered: false,
    }])
    expect(JSON.stringify(result)).not.toContain('断流的盐渠')
  })

  it('从权威战斗轮次投影已学主动技能的冷却、资源与公开条件原因', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const progression = runtimePackage.modules.progression.payload as TextOpenWorldProgressionModuleV1
    const actions = runtimePackage.modules.actions.payload as TextOpenWorldActionModuleV1
    progression.skills.find(skill => skill.key === 'skill.power-strike')!
      .useConditionKeys = ['condition.level-two']
    actions.actions.find(action => action.key === 'action.combat-power-strike')!
      .requirementConditionKeys = ['condition.level-two']
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.player.skillResource = 1
    const combat = createTextOpenWorldCombatStateMachineV1(runtimePackage).initialize({
      state: projection.state,
      encounterKey: 'encounter.ridge-jackal',
      instanceKey: 'combat.character-projection',
    })
    combat.round = 2
    combat.phase = 'actor-turn'
    combat.turnIndex = 0
    combat.activeCombatantKey = 'player'
    combat.cooldownUntilRoundBySkillKey = { 'skill.power-strike': 4 }
    projection.state.combat = combat

    const result = projectTextOpenWorldPlayerCharacterV1(projection)
    expect(result.skills.find(skill => skill.title === '重击')).toMatchObject({
      learned: true,
      cooldownRemainingTurns: 2,
      skillConditionsReady: false,
      availabilityLabel: '技能条件受限',
      unavailableReasons: [
        '技能资源不足（需要 2）',
        '冷却中（剩余 2 回合）',
        '经验不足，无法让谎言自洽。',
      ],
    })
    expect(JSON.stringify(result)).not.toContain('condition.level-two')
  })

  it('以Release初始等级为成长基线，并正确投影非1级开局和满级', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const actors = runtimePackage.modules.actors.payload as TextOpenWorldActorModuleV1
    actors.player.build.initialLevel = 3
    actors.player.build.attributes = { power: 8, vitality: 7, agility: 6 }

    const levelFive = projectTextOpenWorldPlayerCharacterV1(synchronizeLevel(runtimePackage, 5))
    expect(levelFive.progression).toMatchObject({ initialLevel: 3, level: 5, atMaximumLevel: false })
    expect(levelFive.attributes).toEqual([
      {
        semantic: 'power', label: '力量', value: 10, initialValue: 8, levelGrowth: 2,
        growthByLevel: [{ level: 4, value: 1 }, { level: 5, value: 1 }],
      },
      {
        semantic: 'vitality', label: '体质', value: 9, initialValue: 7, levelGrowth: 2,
        growthByLevel: [{ level: 4, value: 1 }, { level: 5, value: 1 }],
      },
      {
        semantic: 'agility', label: '敏捷', value: 7, initialValue: 6, levelGrowth: 1,
        growthByLevel: [{ level: 4, value: 1 }, { level: 5, value: 0 }],
      },
    ])

    const maximum = projectTextOpenWorldPlayerCharacterV1(synchronizeLevel(runtimePackage, 20))
    expect(maximum.progression).toMatchObject({
      initialLevel: 3,
      level: 20,
      maximumLevel: 20,
      experience: 36_100,
      experienceForNextLevel: null,
      progressRatio: 1,
      atMaximumLevel: true,
    })
  })

  it('零技能资源上限不产生NaN，且旧战斗投影缺少冷却字段时按零回合兼容', () => {
    const zeroResourcePackage = createTextOpenWorldVNextFixture()
    const zeroProgression = zeroResourcePackage.modules.progression.payload as TextOpenWorldProgressionModuleV1
    zeroProgression.rules.formulas.baseSkillResource = 0
    zeroProgression.rules.formulas.skillResourcePerLevel = 0
    const zeroResource = projectTextOpenWorldPlayerCharacterV1(
      createInitialTextOpenWorldSessionProjectionV1(zeroResourcePackage),
    )
    expect(zeroResource.resources.skillResource).toEqual({
      label: '技能资源', current: 0, maximum: 0, progressRatio: 0,
    })
    expect(Number.isNaN(zeroResource.resources.skillResource.progressRatio)).toBe(false)
    expect(zeroResource.skills.find(skill => skill.title === '挥击')).toMatchObject({
      skillConditionsReady: true, availabilityLabel: '技能条件就绪', unavailableReasons: [],
    })
    expect(zeroResource.skills.find(skill => skill.title === '重击')).toMatchObject({
      skillConditionsReady: false, availabilityLabel: '技能条件受限', unavailableReasons: ['技能资源不足（需要 2）'],
    })

    const legacyPackage = downgradeTextOpenWorldFixtureCombatActionsV1(createTextOpenWorldVNextFixture())
    const legacyProjection = createInitialTextOpenWorldSessionProjectionV1(legacyPackage)
    legacyProjection.state.combat = createTextOpenWorldCombatStateMachineV1(legacyPackage).initialize({
      state: legacyProjection.state,
      encounterKey: 'encounter.ridge-jackal',
      instanceKey: 'combat.legacy-character-projection',
    })
    expect(legacyProjection.state.combat).not.toHaveProperty('cooldownUntilRoundBySkillKey')
    expect(projectTextOpenWorldPlayerCharacterV1(legacyProjection).skills
      .filter(skill => skill.learned).map(skill => skill.cooldownRemainingTurns)).toEqual([0, 0])
  })
})
