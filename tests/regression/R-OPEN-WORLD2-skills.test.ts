import { describe, expect, it } from 'vitest'
import { createTextOpenWorldSkillCatalogV1 } from '../../src/lib/open-world/skills'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function addLevelSkill() {
  const fixture = createTextOpenWorldVNextFixture()
  const progression = fixture.modules.progression.payload as any
  progression.skills.push({
    key: 'skill.brine-cut', title: '盐痕斩', description: '消耗技巧资源发动的强力斩击。', tags: ['近战', '技巧'],
    activation: 'active', kind: 'attack', target: 'single-enemy', scalingAttribute: 'power',
    unlockSources: [{ kind: 'level', level: 2, questKey: null }], useConditionKeys: ['condition.always'], priority: 80,
    resourceCost: 2, cooldownTurns: 2, effectKeys: [],
  })
  progression.levels[1].unlockedSkillKeys.push('skill.brine-cut')
  return fixture
}

function addQuestSkill() {
  const fixture = createTextOpenWorldVNextFixture()
  const progression = fixture.modules.progression.payload as any
  const actions = fixture.modules.actions.payload as any
  const quests = fixture.modules.quests.payload as any
  progression.skills.push({
    key: 'skill.channel-listening', title: '听渠', description: '从水流中辨认隐藏线索。', tags: ['调查'],
    activation: 'active', kind: 'status', target: 'self', scalingAttribute: null,
    unlockSources: [{ kind: 'quest', level: null, questKey: 'quest.template.supplies' }], useConditionKeys: [], priority: 40,
    resourceCost: 1, cooldownTurns: 0, effectKeys: [],
  })
  actions.effects.push({ key: 'effect.learn-channel-listening', operation: 'learn-skill', payload: { skillKey: 'skill.channel-listening' } })
  quests.quests.find((quest: any) => quest.key === 'quest.template.supplies').rewardEffectKeys.push('effect.learn-channel-listening')
  return fixture
}

describe('Text Open World vNext · governed skills and statuses', () => {
  it('把已学、资源、冷却和Condition统一投影为技能可用性', () => {
    const catalog = createTextOpenWorldSkillCatalogV1(addLevelSkill())
    const unlearned = catalog.project({
      learnedSkillKeys: ['skill.basic-attack'], skillResource: 4,
      conditionResults: { 'condition.always': true },
    }).find(item => item.skill.key === 'skill.brine-cut')!
    expect(unlearned).toMatchObject({ learned: false, available: false, unavailableReasons: ['not-learned'] })

    const blocked = catalog.project({
      learnedSkillKeys: ['skill.basic-attack', 'skill.brine-cut'], skillResource: 1,
      cooldownRemainingTurnsBySkillKey: { 'skill.brine-cut': 2 }, conditionResults: { 'condition.always': false },
    }).find(item => item.skill.key === 'skill.brine-cut')!
    expect(blocked).toMatchObject({
      learned: true, available: false, cooldownRemainingTurns: 2,
      unavailableReasons: ['resource-insufficient', 'cooldown-active', 'condition-unsatisfied'],
      unsatisfiedConditionKeys: ['condition.always'],
    })

    expect(catalog.prepare({
      skillKey: 'skill.brine-cut', learnedSkillKeys: ['skill.basic-attack', 'skill.brine-cut'], skillResource: 4,
      cooldownRemainingTurnsBySkillKey: { 'skill.brine-cut': 0 }, conditionResults: { 'condition.always': true },
    })).toEqual({
      skillKey: 'skill.brine-cut', target: 'single-enemy', scalingAttribute: 'power',
      resourceCost: 2, cooldownTurns: 2, effectKeys: [],
    })
  })

  it('等级来源进入同级曲线，任务来源必须由同一任务的学习Effect兑现', () => {
    expect(parseTextOpenWorldModulesV1(addLevelSkill()).progression.skills).toHaveLength(2)
    expect(parseTextOpenWorldModulesV1(addQuestSkill()).progression.skills).toHaveLength(2)

    const missingLevelCurve = addLevelSkill()
    ;(missingLevelCurve.modules.progression.payload as any).levels[1].unlockedSkillKeys = []
    expect(() => parseTextOpenWorldModulesV1(missingLevelCurve)).toThrow('level来源没有进入等级曲线')

    const missingQuestReward = addQuestSkill()
    ;(missingQuestReward.modules.quests.payload as any).quests
      .find((quest: any) => quest.key === 'quest.template.supplies').rewardEffectKeys = []
    expect(() => parseTextOpenWorldModulesV1(missingQuestReward)).toThrow('没有对应学习Effect奖励')
  })

  it('只允许首版冻结的主动/被动规则和获得来源组合', () => {
    const passiveCost = addLevelSkill()
    const skill = (passiveCost.modules.progression.payload as any).skills[1]
    Object.assign(skill, { activation: 'passive', target: 'self', resourceCost: 1, cooldownTurns: 0 })
    expect(() => parseTextOpenWorldModulesV1(passiveCost)).toThrow('被动技能不能主动选择或消耗资源')

    const duplicateSource = addLevelSkill()
    ;(duplicateSource.modules.progression.payload as any).skills[1].unlockSources.push({ kind: 'level', level: 2, questKey: null })
    expect(() => parseTextOpenWorldModulesV1(duplicateSource)).toThrow('unlockSources不能重复')

    const unknownCondition = addLevelSkill()
    ;(unknownCondition.modules.progression.payload as any).skills[1].useConditionKeys = ['condition.missing']
    expect(() => parseTextOpenWorldModulesV1(unknownCondition)).toThrow('skill use condition 引用不存在')
  })

  it('状态目录只接受Release已声明的无重复当前状态', () => {
    const catalog = createTextOpenWorldSkillCatalogV1(createTextOpenWorldVNextFixture())
    expect(catalog.projectStatuses(['status.rested'])).toEqual([{
      status: { key: 'status.rested', title: '休整完毕', description: '角色已经充分休息。', polarity: 'beneficial' },
      active: true,
    }])
    expect(() => catalog.projectStatuses(['status.missing'])).toThrow('状态不存在')
    expect(() => catalog.projectStatuses(['status.rested', 'status.rested'])).toThrow('无重复数组')
    expect(() => catalog.project({ learnedSkillKeys: ['skill.missing'], skillResource: 1 })).toThrow('已学技能不存在')
    expect(() => catalog.project({
      learnedSkillKeys: ['skill.basic-attack'], skillResource: 1,
      cooldownRemainingTurnsBySkillKey: { 'skill.missing': 1 },
    })).toThrow('冷却引用未知技能')
  })
})
