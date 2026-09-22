import { describe, expect, it } from 'vitest'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createTextOpenWorldVNextFixture, downgradeTextOpenWorldFixtureWithoutCrimeV1 } from '../helpers/text-open-world-vnext-fixture'

describe('Text Open World vNext · vNext module schemas and reference integrity', () => {
  it('解析完整的15模块验收包并保留可运行目录', () => {
    const parsed = parseTextOpenWorldModulesV1(JSON.stringify(createTextOpenWorldVNextFixture()))

    expect(parsed.narrative.storylines).toHaveLength(1)
    expect(parsed.world.regions).toHaveLength(2)
    expect(parsed.quests.quests.map(item => item.type)).toEqual(['mainline', 'template'])
    expect(parsed.progression.levels).toHaveLength(20)
    expect(parsed.items.equipmentSlots.map(item => item.key).sort()).toEqual(['accessory', 'armor', 'weapon'])
  })

  it('拒绝悬空场景地点和重复稳定key', () => {
    const dangling = createTextOpenWorldVNextFixture()
    ;(dangling.modules.narrative.payload as any).scenes[0].locationKey = 'location.missing'
    expect(() => parseTextOpenWorldModulesV1(dangling)).toThrow('scene location 引用不存在')

    const duplicate = createTextOpenWorldVNextFixture()
    const world = duplicate.modules.world.payload as any
    world.locations.push(structuredClone(world.locations[0]))
    expect(() => parseTextOpenWorldModulesV1(duplicate)).toThrow('world.locations.key 不能重复')
  })

  it('拒绝重要任务过期、首版装备位漂移和玩家未知技能', () => {
    const expiringMainline = createTextOpenWorldVNextFixture()
    ;(expiringMainline.modules.quests.payload as any).quests[0].expirationMinutes = 60
    expect(() => parseTextOpenWorldModulesV1(expiringMainline)).toThrow('protected-wait不能过期')

    const slots = createTextOpenWorldVNextFixture()
    ;(slots.modules.items.payload as any).equipmentSlots.pop()
    expect(() => parseTextOpenWorldModulesV1(slots)).toThrow('首版装备位必须为weapon/armor/accessory')

    const unknownSkill = createTextOpenWorldVNextFixture()
    ;(unknownSkill.modules.actors.payload as any).player.build.learnedSkillKeys = ['skill.unknown']
    expect(() => parseTextOpenWorldModulesV1(unknownSkill)).toThrow('player skill 引用不存在')
  })

  it('拒绝导演变体和根媒资清单不一致', () => {
    const variant = createTextOpenWorldVNextFixture()
    ;(variant.modules.director.payload as any).templates[0].variantTextKeys = ['task-text.missing']
    expect(() => parseTextOpenWorldModulesV1(variant)).toThrow('template text variant 引用不存在')

    const media = createTextOpenWorldVNextFixture()
    media.mediaManifest.slotKeys = ['map.world', 'portrait.caretaker']
    expect(() => parseTextOpenWorldModulesV1(media)).toThrow('presentation.mediaSlots与根mediaManifest.slotKeys不一致')
  })

  it('拒绝目录只做单向声明而没有反向归属', () => {
    const region = createTextOpenWorldVNextFixture()
    ;(region.modules.world.payload as any).regions[0].locationKeys = []
    expect(() => parseTextOpenWorldModulesV1(region)).toThrow('双向引用不一致')

    const questStage = createTextOpenWorldVNextFixture()
    ;(questStage.modules.quests.payload as any).stages[0].questKey = 'quest.template.supplies'
    expect(() => parseTextOpenWorldModulesV1(questStage)).toThrow('双向引用不一致')
  })

  it('拒绝时间段空洞及模块校准与根合同漂移', () => {
    const timeGap = createTextOpenWorldVNextFixture()
    ;(timeGap.modules['time-weather'].payload as any).timePeriods[0].startMinute = 1
    expect(() => parseTextOpenWorldModulesV1(timeGap)).toThrow('覆盖完整一天')

    const relationshipDrift = createTextOpenWorldVNextFixture()
    ;(relationshipDrift.modules.relationships.payload as any).attitude.goodMinimum = 30
    expect(() => parseTextOpenWorldModulesV1(relationshipDrift)).toThrow('relationships模块与根calibration不一致')
  })

  it('Quest v2拒绝没有完成Action的Objective、错误Stage推进和漂移的奖励绑定', () => {
    const missingObjectiveAction = createTextOpenWorldVNextFixture()
    ;(missingObjectiveAction.modules.quests.payload as any).objectives[0].actionKeys = ['action.investigate-channel']
    expect(() => parseTextOpenWorldModulesV1(missingObjectiveAction)).toThrow('Objective必须至少绑定一个完成Action')

    const wrongStageTransition = createTextOpenWorldVNextFixture()
    ;(wrongStageTransition.modules.actions.payload as any).effects
      .find((effect: any) => effect.key === 'effect.complete-main-quest').payload.status = 'failed'
    expect(() => parseTextOpenWorldModulesV1(wrongStageTransition)).toThrow('Stage完成Action没有推进相邻Stage或完成任务')

    const driftedReward = createTextOpenWorldVNextFixture()
    ;(driftedReward.modules.items.payload as any).rewardContracts
      .find((reward: any) => reward.key === 'reward.quest-main').effectKeys = ['effect.claim-main-reward']
    expect(() => parseTextOpenWorldModulesV1(driftedReward)).toThrow('reward effects 双向引用不一致')
  })

  it('旧Quest v1模块可读取并规范化为无新绑定的v2读模型', () => {
    const legacy = createTextOpenWorldVNextFixture()
    downgradeTextOpenWorldFixtureWithoutCrimeV1(legacy)
    const quests = legacy.modules.quests.payload as any
    quests.version = 1
    legacy.modules.quests.schemaVersion = 1
    quests.quests.forEach((quest: any) => { delete quest.rewardContractKey; delete quest.claimActionKey })
    quests.stages.forEach((stage: any) => { delete stage.completionActionKey })
    const parsed = parseTextOpenWorldModulesV1(legacy)
    expect(parsed.quests.version).toBe(2)
    expect(parsed.quests.quests.every(quest => quest.rewardContractKey == null && quest.claimActionKey == null)).toBe(true)
    expect(parsed.quests.stages.every(stage => stage.completionActionKey == null)).toBe(true)
  })

  it('Quest v2必须提供完整追踪能力和覆盖每种Stage状态的限时过期Action', () => {
    const missingTracking = createTextOpenWorldVNextFixture()
    const trackingActions = missingTracking.modules.actions.payload as any
    trackingActions.actions = trackingActions.actions.filter((action: any) => !['track', 'untrack'].includes(action.category))
    trackingActions.effects = trackingActions.effects.filter((effect: any) => !['track-quest', 'untrack-quest'].includes(effect.operation))
    expect(() => parseTextOpenWorldModulesV1(missingTracking)).toThrow('任务追踪Action能力')

    const incompleteExpiry = createTextOpenWorldVNextFixture()
    const expiryActions = incompleteExpiry.modules.actions.payload as any
    expiryActions.actions = expiryActions.actions.filter((action: any) => action.key !== 'action.expire-supplies-active')
    expiryActions.effects = expiryActions.effects.filter((effect: any) => effect.key !== 'effect.expire-supplies-active')
    expect(() => parseTextOpenWorldModulesV1(incompleteExpiry)).toThrow('过期Stage覆盖')
  })

  it('旧Action v1发布没有任务追踪和自动过期能力时仍可按冻结合同读取', () => {
    const legacy = createTextOpenWorldVNextFixture()
    downgradeTextOpenWorldFixtureWithoutCrimeV1(legacy)
    const actions = legacy.modules.actions.payload as any
    actions.version = 1
    legacy.modules.actions.schemaVersion = 1
    actions.actions = actions.actions.filter((action: any) => !['track', 'untrack'].includes(action.category) && !action.key.startsWith('action.expire-'))
    actions.effects = actions.effects.filter((effect: any) => !['track-quest', 'untrack-quest'].includes(effect.operation) && !effect.key.startsWith('effect.expire-'))
    expect(parseTextOpenWorldModulesV1(legacy).actions.actions.some(action => action.category === 'track')).toBe(false)
  })
})
