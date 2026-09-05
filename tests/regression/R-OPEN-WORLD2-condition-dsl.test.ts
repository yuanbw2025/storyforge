import { describe, expect, it } from 'vitest'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldConditionCatalogV1 } from '../../src/lib/open-world/condition-dsl'
import type { TextOpenWorldConditionEvaluationContextV1, TextOpenWorldConditionExpressionV1 } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function evaluationContext(): TextOpenWorldConditionEvaluationContextV1 {
  return {
    player: {
      level: 1, experience: 0, health: 35, maximumHealth: 35, morality: 0,
      attributes: { power: 3, vitality: 3, agility: 3 }, statusKeys: ['status.rested'],
    },
    inventory: {
      itemQuantities: { 'item.rust-sword': 1, 'item.salt-crystal': 2 }, currency: 20,
      equippedItemKeys: ['item.rust-sword'], knownRecipeKeys: ['recipe.brine-tonic'],
    },
    quests: {
      statusByQuestKey: { 'quest.main.1': 'active' }, stageByQuestKey: { 'quest.main.1': 'quest-stage.main.1' },
      objectiveStatusByKey: { 'objective.main.1': 'active' }, resultTags: ['tag.channel-seen'],
    },
    map: {
      currentLocationKey: 'location.salt-port', regionKnowledgeByKey: { 'region.salt-port': 'visited' },
      unlockedFastTravelPointKeys: ['fast-travel.salt-port'], openEdgeKeys: ['edge.port-ridge'],
    },
    time: {
      worldMinute: 480, minutesPerDay: 1440, timePeriodKey: 'time.day', weatherKey: 'weather.clear',
      deadlineWorldMinuteByKey: { 'deadline.supplies': 1000 },
    },
    relations: {
      factionAffinityByKey: { 'faction.canal-keepers': 30 }, attitudeByActorKey: { 'actor.caretaker': 'good' },
      storyModifierByActorKey: { 'actor.caretaker': 10 },
    },
    actors: { 'actor.caretaker': { present: true, alive: true, protected: true, scheduleState: 'checking-channel' } },
    world: {
      flags: { 'flag.canal-open': true }, regionPressureByKey: { 'region.salt-port': 2 },
      factionStateByKey: { 'faction.canal-keepers': 'stable' }, endingEligibleByKey: { 'ending.cooperate': true },
    },
    knowledge: {
      visibilityByKey: { 'knowledge.caretaker': 'known' }, readRumorKeys: ['rumor.channel'],
      earnedAchievementKeys: ['achievement.first-clue'],
    },
  }
}

function allDomainExpression(): TextOpenWorldConditionExpressionV1 {
  return {
    op: 'all',
    conditions: [
      { op: 'player-number', field: 'level', comparator: 'gte', value: 1 },
      { op: 'player-status', statusKey: 'status.rested', present: true },
      { op: 'inventory-quantity', itemKey: 'item.salt-crystal', comparator: 'gte', value: 2 },
      { op: 'inventory-currency', comparator: 'gte', value: 10 },
      { op: 'inventory-equipped', itemKey: 'item.rust-sword', equipped: true },
      { op: 'inventory-recipe-known', recipeKey: 'recipe.brine-tonic', known: true },
      { op: 'quest-status', questKey: 'quest.main.1', statuses: ['active'] },
      { op: 'quest-stage', questKey: 'quest.main.1', stageKey: 'quest-stage.main.1' },
      { op: 'quest-objective', objectiveKey: 'objective.main.1', status: 'active' },
      { op: 'quest-result-tag', tag: 'tag.channel-seen', present: true },
      { op: 'map-location', locationKey: 'location.salt-port' },
      { op: 'map-region-knowledge', regionKey: 'region.salt-port', minimum: 'heard' },
      { op: 'map-fast-travel', fastTravelPointKey: 'fast-travel.salt-port', unlocked: true },
      { op: 'map-edge', edgeKey: 'edge.port-ridge', open: true },
      { op: 'time-number', field: 'day', comparator: 'eq', value: 1 },
      { op: 'time-period', timePeriodKey: 'time.day' },
      { op: 'time-weather', weatherKey: 'weather.clear' },
      { op: 'time-deadline', deadlineKey: 'deadline.supplies', relation: 'before' },
      { op: 'relation-faction-affinity', factionKey: 'faction.canal-keepers', comparator: 'gte', value: 25 },
      { op: 'relation-attitude', actorKey: 'actor.caretaker', attitude: 'good' },
      { op: 'relation-story-modifier', actorKey: 'actor.caretaker', comparator: 'eq', value: 10 },
      { op: 'actor-boolean', actorKey: 'actor.caretaker', field: 'alive', value: true },
      { op: 'actor-schedule', actorKey: 'actor.caretaker', state: 'checking-channel' },
      { op: 'world-flag', flagKey: 'flag.canal-open', value: true },
      { op: 'world-region-pressure', regionKey: 'region.salt-port', comparator: 'lte', value: 2 },
      { op: 'world-faction-state', factionKey: 'faction.canal-keepers', state: 'stable' },
      { op: 'world-ending-eligible', endingKey: 'ending.cooperate', eligible: true },
      { op: 'knowledge-visibility', knowledgeKey: 'knowledge.caretaker', minimum: 'rumor' },
      { op: 'knowledge-rumor-read', rumorKey: 'rumor.channel', read: true },
      { op: 'knowledge-achievement', achievementKey: 'achievement.first-clue', earned: true },
    ],
  }
}

function withCondition(expression: unknown, failureMessage = '当前尚不满足公开条件。') {
  const fixture = createTextOpenWorldVNextFixture()
  ;(fixture.modules.actions.payload as any).conditions.push({ key: 'condition.all-domains', expression, failureMessage })
  return fixture
}

describe('Text Open World vNext · typed Condition DSL', () => {
  it('覆盖九个状态域并只返回定义中的公共失败原因', () => {
    const catalog = createTextOpenWorldConditionCatalogV1(withCondition(allDomainExpression()))
    expect(catalog.evaluate('condition.all-domains', evaluationContext())).toEqual({
      conditionKey: 'condition.all-domains', satisfied: true, publicReason: null,
    })
    const blocked = evaluationContext()
    blocked.world.flags['flag.canal-open'] = false
    expect(catalog.evaluate('condition.all-domains', blocked)).toEqual({
      conditionKey: 'condition.all-domains', satisfied: false, publicReason: '当前尚不满足公开条件。',
    })
  })

  it('支持all/any/not组合并把评估结果接入统一Action投影', () => {
    const fixture = createTextOpenWorldVNextFixture()
    ;(fixture.modules.progression.payload as any).statuses.push({
      key: 'status.wounded', title: '负伤', description: '角色正受到伤势影响。', polarity: 'harmful',
    })
    ;(fixture.modules.actions.payload as any).conditions[0].expression = {
      op: 'any', conditions: [
        { op: 'not', condition: { op: 'player-status', statusKey: 'status.wounded', present: true } },
        { op: 'inventory-currency', comparator: 'gte', value: 999 },
      ],
    }
    ;(fixture.modules.actions.payload as any).actions[0].requirementConditionKeys = ['condition.always']
    const catalog = createTextOpenWorldConditionCatalogV1(fixture)
    const results = catalog.evaluateMany(['condition.always'], evaluationContext())
    const projection = createTextOpenWorldActionRegistryV1(fixture).project({
      actorKey: 'player', currentLocationKey: 'location.salt-port', worldMinute: 480,
      conditionResults: results, completedOnceActionKeys: [], cooldownUntilWorldMinuteByActionKey: {},
      validTargetKeysByScope: { location: ['location.salt-port'] },
    })
    expect(projection[0]).toMatchObject({ available: true, unavailableReasons: [] })
  })

  it('静态拒绝悬空引用、跨任务阶段和非白名单操作', () => {
    expect(() => createTextOpenWorldConditionCatalogV1(withCondition({
      op: 'inventory-quantity', itemKey: 'item.missing', comparator: 'gte', value: 1,
    }))).toThrow('itemKey引用不存在')
    expect(() => createTextOpenWorldConditionCatalogV1(withCondition({
      op: 'quest-stage', questKey: 'quest.template.supplies', stageKey: 'quest-stage.main.1',
    }))).toThrow('stageKey不属于questKey')
    expect(() => createTextOpenWorldConditionCatalogV1(withCondition({ op: 'javascript', source: 'return true' })))
      .toThrow('op不在白名单')
  })

  it('拒绝未知字段、过深表达式和超过节点预算的表达式', () => {
    expect(() => createTextOpenWorldConditionCatalogV1(withCondition({
      op: 'player-number', field: 'level', comparator: 'gte', value: 1, hidden: true,
    }))).toThrow('字段不符合合同')

    let deep: any = { op: 'player-number', field: 'level', comparator: 'gte', value: 1 }
    for (let index = 0; index < 13; index += 1) deep = { op: 'not', condition: deep }
    expect(() => createTextOpenWorldConditionCatalogV1(withCondition(deep))).toThrow('超过最大深度12')

    const leaf = { op: 'player-number', field: 'level', comparator: 'gte', value: 1 }
    const tooMany = { op: 'all', conditions: Array.from({ length: 5 }, () => ({ op: 'all', conditions: Array.from({ length: 64 }, () => leaf) })) }
    expect(() => createTextOpenWorldConditionCatalogV1(withCondition(tooMany))).toThrow('超过最大节点数256')
  })

  it('缺失关键Actor、世界Flag或结局状态时fail-closed', () => {
    const expression: TextOpenWorldConditionExpressionV1 = {
      op: 'all', conditions: [
        { op: 'actor-boolean', actorKey: 'actor.caretaker', field: 'protected', value: false },
        { op: 'world-flag', flagKey: 'flag.missing', value: null },
        { op: 'world-ending-eligible', endingKey: 'ending.control', eligible: false },
      ],
    }
    expect(createTextOpenWorldConditionCatalogV1(withCondition(expression)).evaluate('condition.all-domains', evaluationContext()).satisfied).toBe(false)
  })
})
