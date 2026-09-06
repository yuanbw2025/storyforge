import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { createTextOpenWorldQuestTransitionCatalogV1 } from '../../src/lib/open-world/quest-state-machine'
import { createInitialTextOpenWorldQuestInstancesV1 } from '../../src/lib/open-world/quests'
import type { TextOpenWorldEffectDefinitionV1, TextOpenWorldEffectStateV1 } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function state(overrides: Partial<TextOpenWorldEffectStateV1> = {}): TextOpenWorldEffectStateV1 {
  const initial: TextOpenWorldEffectStateV1 = {
    version: 1,
    player: {
      level: 1, experience: 0, health: 37, maximumHealth: 37, skillResource: 4, maximumSkillResource: 4,
      attributes: { power: 3, vitality: 3, agility: 3 }, statusKeys: [], learnedSkillKeys: ['skill.basic-attack'],
    },
    inventory: {
      stackQuantities: { 'item.salt-crystal': 2 },
      itemInstances: { 'instance.initial.1.item.rust-sword': { itemKey: 'item.rust-sword', acquiredByClaimKey: 'initial-build', stateTags: ['new'] } },
      equippedItemInstanceIdBySlot: { weapon: null, armor: null, accessory: null },
      knownRecipeKeys: ['recipe.brine-tonic'], currency: 20,
    },
    quests: {
      instancesByKey: createInitialTextOpenWorldQuestInstancesV1(createTextOpenWorldVNextFixture()),
      resultTags: [],
      tracking: { primaryInstanceKey: 'quest-instance.12.quest.main.1.release.13.session-start', pinnedInstanceKeys: [] },
    },
    map: {
      currentLocationKey: 'location.salt-port', revealedLocationKeys: ['location.salt-port', 'location.ridge-channel'],
      regionKnowledgeByKey: { 'region.salt-port': 'visited', 'region.ridge': 'heard' },
      locationKnowledgeByKey: { 'location.salt-port': 'visited', 'location.ridge-channel': 'heard' },
      unlockedFastTravelPointKeys: ['fast-travel.salt-port'], openEdgeKeys: ['edge.port-ridge'], travel: null,
    },
    time: {
      worldMinute: 480,
      currentWeatherByRegionKey: { 'region.salt-port': 'weather.clear', 'region.ridge': 'weather.clear' },
      deadlineWorldMinuteByKey: {},
      lastWeatherSettlementEpoch: 1,
      lastActorScheduleSettlementWorldMinute: 360,
    },
    relationships: { morality: 0, factionAffinityByKey: { 'faction.canal-keepers': 0 }, storyModifierByActorKey: {} },
    combat: null,
    actors: { 'actor.caretaker': { alive: true, present: true, locationKey: 'location.salt-port', scheduleState: '检查内渠' } },
    world: { regionStateByKey: {}, regionPressureByKey: {}, factionStateByKey: {}, endingEligibleByKey: {}, flags: {} },
    knowledge: { visibilityByKey: { 'knowledge.caretaker': 'known' }, readRumorKeys: [], earnedAchievementKeys: [] },
    endings: { unlockedKeys: [], reachedKey: null },
    appliedClaimKeys: [],
  }
  return { ...initial, ...structuredClone(overrides) }
}

function addEffects(effects: TextOpenWorldEffectDefinitionV1[]) {
  const fixture = createTextOpenWorldVNextFixture()
  ;(fixture.modules.actions.payload as { effects: TextOpenWorldEffectDefinitionV1[] }).effects.push(...effects)
  return fixture
}

describe('Text Open World vNext · typed Effect DSL and atomic EffectPlan', () => {
  it('预演不改原状态，提交后返回可校验回执并完成跨域奖励', async () => {
    const catalog = createTextOpenWorldEffectCatalogV1(createTextOpenWorldVNextFixture())
    const before = state()
    const plan = await catalog.plan({
      effectKeys: ['effect.reward-experience', 'effect.reward-currency'], claimKey: 'claim.reward.1', state: before,
    })

    expect(before).toMatchObject({ player: { level: 1, experience: 0 }, inventory: { currency: 20 }, appliedClaimKeys: [] })
    expect(plan).toMatchObject({ impactDomains: ['player', 'inventory'], effectKeys: ['effect.reward-experience', 'effect.reward-currency'] })

    const applied = await catalog.apply({ plan, state: before })
    expect(applied.state).toMatchObject({
      player: { level: 2, experience: 100, health: 44, maximumHealth: 44, skillResource: 5, maximumSkillResource: 5, attributes: { power: 4, vitality: 4, agility: 4 } },
      inventory: { currency: 30 }, appliedClaimKeys: ['claim.reward.1'],
    })
    expect(applied.receipt).toMatchObject({
      claimKey: 'claim.reward.1', planHash: plan.planHash,
      baseStateHash: plan.baseStateHash, resultingStateHash: plan.resultingStateHash,
      impactDomains: plan.impactDomains,
    })
    expect(applied.receipt.changes).toHaveLength(2)
  })

  it('拒绝重复claim、被篡改计划和基线已变化的提交', async () => {
    const catalog = createTextOpenWorldEffectCatalogV1(createTextOpenWorldVNextFixture())
    const before = state()
    const plan = await catalog.plan({ effectKeys: ['effect.reward-currency'], claimKey: 'claim.once', state: before })
    const applied = await catalog.apply({ plan, state: before })

    await expect(catalog.plan({ effectKeys: ['effect.reward-currency'], claimKey: 'claim.once', state: applied.state }))
      .rejects.toThrow('claim已应用')
    await expect(catalog.apply({ plan: { ...plan, resultingStateHash: 'f'.repeat(64) }, state: before }))
      .rejects.toThrow('planHash无效')
    await expect(catalog.apply({ plan, state: { ...before, time: { worldMinute: 481 } } }))
      .rejects.toThrow('基线状态已变化')
  })

  it('任一效果预检失败时不产生半提交', async () => {
    const fixture = addEffects([
      { key: 'effect.grant-salt', operation: 'grant-item', payload: { itemKey: 'item.salt-crystal', quantity: 1 } },
      { key: 'effect.overspend', operation: 'change-currency', payload: { amount: -100 } },
    ])
    const catalog = createTextOpenWorldEffectCatalogV1(fixture)
    const before = state()
    const snapshot = structuredClone(before)

    await expect(catalog.plan({ effectKeys: ['effect.grant-salt', 'effect.overspend'], claimKey: 'claim.atomic', state: before }))
      .rejects.toThrow('货币越界')
    expect(before).toEqual(snapshot)
  })

  it('一个EffectPlan可以原子推进任务、地图、关系、战斗、世界与结局', async () => {
    const effects: TextOpenWorldEffectDefinitionV1[] = [
      { key: 'effect.morality', operation: 'change-morality', payload: { amount: 5 } },
      { key: 'effect.affinity', operation: 'change-faction-affinity', payload: { factionKey: 'faction.canal-keepers', amount: 10 } },
      { key: 'effect.story-modifier', operation: 'set-story-modifier', payload: { actorKey: 'actor.caretaker', value: 10 } },
      { key: 'effect.reveal-ridge', operation: 'reveal-location', payload: { locationKey: 'location.ridge-channel' } },
      { key: 'effect.fast-ridge', operation: 'unlock-fast-travel', payload: { fastTravelPointKey: 'fast-travel.ridge' } },
      { key: 'effect.start-fight', operation: 'initialize-combat', payload: { encounterKey: 'encounter.ridge-jackal' } },
      { key: 'effect.move-caretaker', operation: 'change-actor-state', payload: { actorKey: 'actor.caretaker', alive: null, present: true, locationKey: 'location.ridge-channel', cause: 'story' } },
      { key: 'effect.region-state', operation: 'change-region-state', payload: { regionKey: 'region.ridge', state: 'channel-open' } },
      { key: 'effect.world-flag', operation: 'set-world-flag', payload: { flagKey: 'flag.channel-open', value: true } },
      { key: 'effect.reveal-knowledge', operation: 'reveal-knowledge', payload: { knowledgeKey: 'knowledge.caretaker', visibility: 'known' } },
      { key: 'effect.unlock-ending', operation: 'unlock-ending', payload: { endingKey: 'ending.cooperate' } },
      { key: 'effect.reach-ending', operation: 'reach-ending', payload: { endingKey: 'ending.cooperate' } },
    ]
    const catalog = createTextOpenWorldEffectCatalogV1(addEffects(effects))
    const quests = state().quests
    const mainInstanceKey = Object.keys(quests.instancesByKey)[0]
    const before = state({ quests })
    before.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    before.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    const authorization = createTextOpenWorldQuestTransitionCatalogV1(createTextOpenWorldVNextFixture()).prepare({
      instanceKey: mainInstanceKey,
      state: before,
      transitions: [
        { toStatus: 'accepted', stageKey: null },
        { toStatus: 'active', stageKey: 'quest-stage.main.1' },
      ],
    })
    const plan = await catalog.plan({
      effectKeys: [
        'effect.accept-main', 'effect.activate-main',
        ...effects.slice(0, 5).map(effect => effect.key),
        'effect.travel-port-ridge-start', 'effect.travel-port-ridge-time', 'effect.travel-port-ridge-enter',
        ...effects.slice(5).map(effect => effect.key),
      ],
      claimKey: 'claim.story-beat',
      state: before,
      authorization,
    })
    const { state: after } = await catalog.apply({ plan, state: before })

    expect(plan.impactDomains).toEqual(expect.arrayContaining(['quests', 'map', 'time', 'relationships', 'combat', 'actors', 'world', 'knowledge', 'endings']))
    expect(after).toMatchObject({
      quests: { instancesByKey: { [mainInstanceKey]: { definitionKey: 'quest.main.1', status: 'active', objectiveStatusByKey: { 'objective.main.1': 'active' } } } },
      map: { currentLocationKey: 'location.ridge-channel', travel: null }, time: { worldMinute: 540 },
      relationships: { morality: 5, factionAffinityByKey: { 'faction.canal-keepers': 10 }, storyModifierByActorKey: { 'actor.caretaker': 10 } },
      combat: { encounterKey: 'encounter.ridge-jackal', status: 'active', phase: 'started', round: 0 },
      actors: { 'actor.caretaker': { locationKey: 'location.ridge-channel' } },
      world: { regionStateByKey: { 'region.ridge': 'channel-open' }, flags: { 'flag.channel-open': true } },
      endings: { unlockedKeys: ['ending.cooperate'], reachedKey: 'ending.cooperate' },
    })
  })

  it('复活同时声明战斗、玩家和地图影响域，且只能从战败状态执行', async () => {
    const runtimePackage = addEffects([
      { key: 'effect.respawn-port', operation: 'respawn', payload: { fastTravelPointKey: 'fast-travel.salt-port', healthRatio: 0.5 } },
    ])
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const defeated = state({
      player: { ...state().player, health: 0 },
      map: {
        ...state().map, currentLocationKey: 'location.ridge-channel', revealedLocationKeys: ['location.salt-port', 'location.ridge-channel'],
        regionKnowledgeByKey: { 'region.salt-port': 'visited', 'region.ridge': 'visited' },
        locationKnowledgeByKey: { 'location.salt-port': 'visited', 'location.ridge-channel': 'visited' },
      },
    })
    const combatState = createTextOpenWorldCombatStateMachineV1(runtimePackage)
    defeated.player.health = 37
    defeated.combat = combatState.initialize({
      state: defeated, encounterKey: 'encounter.ridge-jackal', instanceKey: 'combat.respawn-test',
    })
    for (const intent of ['begin-round', 'begin-turn', 'complete-turn', 'finish-defeat'] as const) {
      defeated.combat = combatState.applyAuthorization({
        state: defeated, authorization: combatState.prepare({ state: defeated, intent }),
      })
    }
    defeated.player.health = 0
    const plan = await catalog.plan({ effectKeys: ['effect.respawn-port'], claimKey: 'claim.respawn', state: defeated })
    expect(plan.impactDomains).toEqual(['combat', 'player', 'map'])
    await expect(catalog.plan({ effectKeys: ['effect.respawn-port'], claimKey: 'claim.invalid-respawn', state: state() }))
      .rejects.toThrow('只能在战败后复活')
    const applied = await catalog.apply({ plan, state: defeated })
    expect(applied.state).toMatchObject({ player: { health: 19 }, map: { currentLocationKey: 'location.salt-port' }, combat: null })
  })

  it('发布时拒绝未知操作与悬空引用，运行时保护关键Actor和已装备物品', async () => {
    const unknownOperation = createTextOpenWorldVNextFixture()
    ;(unknownOperation.modules.actions.payload as any).effects.push({ key: 'effect.eval', operation: 'eval', payload: {} })
    expect(() => createTextOpenWorldEffectCatalogV1(unknownOperation)).toThrow('operation不在白名单')

    const unknownReference = createTextOpenWorldVNextFixture()
    ;(unknownReference.modules.actions.payload as any).effects.push({ key: 'effect.missing-item', operation: 'grant-item', payload: { itemKey: 'item.missing', quantity: 1 } })
    expect(() => createTextOpenWorldEffectCatalogV1(unknownReference)).toThrow('itemKey引用不存在')

    expect(() => createTextOpenWorldEffectCatalogV1(addEffects([
      { key: 'effect.kill-caretaker', operation: 'change-actor-state', payload: { actorKey: 'actor.caretaker', alive: false, present: false, locationKey: null, cause: 'story' } },
    ]))).toThrow('受保护Actor不能配置死亡Effect')

    const catalog = createTextOpenWorldEffectCatalogV1(addEffects([
      { key: 'effect.remove-sword', operation: 'remove-item', payload: { itemKey: 'item.rust-sword', quantity: 1, reason: 'drop' } },
    ]))
    const equipped = state({ inventory: { ...state().inventory, equippedItemInstanceIdBySlot: { weapon: 'instance.initial.1.item.rust-sword', armor: null, accessory: null } } })
    await expect(catalog.plan({ effectKeys: ['effect.remove-sword'], claimKey: 'claim.remove-equipped', state: equipped }))
      .rejects.toThrow('未装备物品实例数量不足')
  })

  it('技能学习与状态变化只能执行一次，并拒绝未在Release声明的状态', async () => {
    const fixture = createTextOpenWorldVNextFixture()
    const progression = fixture.modules.progression.payload as any
    const actions = fixture.modules.actions.payload as any
    const quests = fixture.modules.quests.payload as any
    progression.skills.push({
      key: 'skill.channel-listening', title: '听渠', description: '从水流中辨认线索。', tags: ['调查'],
      activation: 'active', kind: 'status', target: 'self', scalingAttribute: null,
      unlockSources: [{ kind: 'quest', level: null, questKey: 'quest.template.supplies' }], useConditionKeys: [], priority: 40,
      resourceCost: 1, cooldownTurns: 0, effectKeys: [],
    })
    actions.effects.push(
      { key: 'effect.learn-channel-listening', operation: 'learn-skill', payload: { skillKey: 'skill.channel-listening' } },
      { key: 'effect.apply-rested', operation: 'apply-status', payload: { statusKey: 'status.rested' } },
      { key: 'effect.remove-rested', operation: 'remove-status', payload: { statusKey: 'status.rested' } },
    )
    quests.quests.find((quest: any) => quest.key === 'quest.template.supplies').rewardEffectKeys.push('effect.learn-channel-listening')
    ;(fixture.modules.items.payload as any).rewardContracts.find((reward: any) => reward.key === 'reward.quest-supplies').effectKeys.push('effect.learn-channel-listening')
    const catalog = createTextOpenWorldEffectCatalogV1(fixture)

    const learnedPlan = await catalog.plan({ effectKeys: ['effect.learn-channel-listening'], claimKey: 'claim.learn', state: state() })
    const learned = await catalog.apply({ plan: learnedPlan, state: state() })
    expect(learned.state.player.learnedSkillKeys).toContain('skill.channel-listening')
    await expect(catalog.plan({ effectKeys: ['effect.learn-channel-listening'], claimKey: 'claim.learn-again', state: learned.state }))
      .rejects.toThrow('不能重复学习已有技能')

    const applyPlan = await catalog.plan({ effectKeys: ['effect.apply-rested'], claimKey: 'claim.status.apply', state: learned.state })
    const rested = await catalog.apply({ plan: applyPlan, state: learned.state })
    expect(rested.state.player.statusKeys).toEqual(['status.rested'])
    await expect(catalog.plan({ effectKeys: ['effect.apply-rested'], claimKey: 'claim.status.apply-again', state: rested.state }))
      .rejects.toThrow('不能重复施加已有状态')
    const removePlan = await catalog.plan({ effectKeys: ['effect.remove-rested'], claimKey: 'claim.status.remove', state: rested.state })
    const clear = await catalog.apply({ plan: removePlan, state: rested.state })
    expect(clear.state.player.statusKeys).toEqual([])
    await expect(catalog.plan({ effectKeys: ['effect.remove-rested'], claimKey: 'claim.status.remove-again', state: clear.state }))
      .rejects.toThrow('不能移除不存在的状态')

    const unknown = createTextOpenWorldVNextFixture()
    ;(unknown.modules.actions.payload as any).effects.push({
      key: 'effect.apply-missing', operation: 'apply-status', payload: { statusKey: 'status.missing' },
    })
    expect(() => createTextOpenWorldEffectCatalogV1(unknown)).toThrow('statusKey引用不存在')
  })
})
