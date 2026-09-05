import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
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
      itemQuantities: { 'item.rust-sword': 1, 'item.salt-crystal': 2 },
      equippedItemKeyBySlot: { weapon: null, armor: null, accessory: null },
      knownRecipeKeys: ['recipe.brine-tonic'], currency: 20,
    },
    quests: {
      statusByQuestKey: { 'quest.main.1': 'available', 'quest.template.supplies': 'available' },
      stageByQuestKey: { 'quest.main.1': null, 'quest.template.supplies': null },
      objectiveStatusByKey: { 'objective.main.1': 'inactive', 'objective.template.supplies': 'inactive' },
      resultTags: [],
    },
    map: {
      currentLocationKey: 'location.salt-port', revealedLocationKeys: ['location.salt-port'],
      regionKnowledgeByKey: { 'region.salt-port': 'visited', 'region.ridge': 'heard' },
      unlockedFastTravelPointKeys: ['fast-travel.salt-port'], openEdgeKeys: ['edge.port-ridge'], travel: null,
    },
    time: { worldMinute: 480, currentWeatherByRegionKey: { 'region.salt-port': 'weather.clear', 'region.ridge': 'weather.clear' }, deadlineWorldMinuteByKey: {} },
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
      { key: 'effect.activate-main', operation: 'transition-quest', payload: { questKey: 'quest.main.1', status: 'active', stageKey: 'quest-stage.main.1' } },
      { key: 'effect.complete-main-objective', operation: 'complete-objective', payload: { objectiveKey: 'objective.main.1' } },
      { key: 'effect.morality', operation: 'change-morality', payload: { amount: 5 } },
      { key: 'effect.affinity', operation: 'change-faction-affinity', payload: { factionKey: 'faction.canal-keepers', amount: 10 } },
      { key: 'effect.story-modifier', operation: 'set-story-modifier', payload: { actorKey: 'actor.caretaker', value: 5 } },
      { key: 'effect.reveal-ridge', operation: 'reveal-location', payload: { locationKey: 'location.ridge-channel' } },
      { key: 'effect.fast-ridge', operation: 'unlock-fast-travel', payload: { fastTravelPointKey: 'fast-travel.ridge' } },
      { key: 'effect.travel-ridge', operation: 'start-travel', payload: { edgeKey: 'edge.port-ridge', destinationLocationKey: 'location.ridge-channel' } },
      { key: 'effect.enter-ridge', operation: 'enter-location', payload: { locationKey: 'location.ridge-channel' } },
      { key: 'effect.advance', operation: 'advance-time', payload: { minutes: 60 } },
      { key: 'effect.start-fight', operation: 'start-combat', payload: { encounterKey: 'encounter.ridge-jackal' } },
      { key: 'effect.win-fight', operation: 'resolve-combat', payload: { encounterKey: 'encounter.ridge-jackal', outcome: 'victory' } },
      { key: 'effect.move-caretaker', operation: 'change-actor-state', payload: { actorKey: 'actor.caretaker', alive: null, present: true, locationKey: 'location.ridge-channel' } },
      { key: 'effect.region-state', operation: 'change-region-state', payload: { regionKey: 'region.ridge', state: 'channel-open' } },
      { key: 'effect.world-flag', operation: 'set-world-flag', payload: { flagKey: 'flag.channel-open', value: true } },
      { key: 'effect.reveal-knowledge', operation: 'reveal-knowledge', payload: { knowledgeKey: 'knowledge.caretaker', visibility: 'known' } },
      { key: 'effect.unlock-ending', operation: 'unlock-ending', payload: { endingKey: 'ending.cooperate' } },
      { key: 'effect.reach-ending', operation: 'reach-ending', payload: { endingKey: 'ending.cooperate' } },
    ]
    const catalog = createTextOpenWorldEffectCatalogV1(addEffects(effects))
    const before = state({ quests: { ...state().quests, objectiveStatusByKey: { 'objective.main.1': 'active', 'objective.template.supplies': 'inactive' } } })
    const plan = await catalog.plan({ effectKeys: effects.map(effect => effect.key), claimKey: 'claim.story-beat', state: before })
    const { state: after } = await catalog.apply({ plan, state: before })

    expect(plan.impactDomains).toEqual(expect.arrayContaining(['quests', 'map', 'time', 'relationships', 'combat', 'actors', 'world', 'knowledge', 'endings']))
    expect(after).toMatchObject({
      quests: { statusByQuestKey: { 'quest.main.1': 'active' }, objectiveStatusByKey: { 'objective.main.1': 'completed' } },
      map: { currentLocationKey: 'location.ridge-channel', travel: null }, time: { worldMinute: 540 },
      relationships: { morality: 5, factionAffinityByKey: { 'faction.canal-keepers': 10 }, storyModifierByActorKey: { 'actor.caretaker': 5 } },
      combat: { encounterKey: 'encounter.ridge-jackal', status: 'victory' },
      actors: { 'actor.caretaker': { locationKey: 'location.ridge-channel' } },
      world: { regionStateByKey: { 'region.ridge': 'channel-open' }, flags: { 'flag.channel-open': true } },
      endings: { unlockedKeys: ['ending.cooperate'], reachedKey: 'ending.cooperate' },
    })
  })

  it('复活同时声明战斗、玩家和地图影响域，且只能从战败状态执行', async () => {
    const catalog = createTextOpenWorldEffectCatalogV1(addEffects([
      { key: 'effect.respawn-port', operation: 'respawn', payload: { locationKey: 'location.salt-port', healthRatio: 0.5 } },
    ]))
    const defeated = state({
      player: { ...state().player, health: 0 },
      map: { ...state().map, currentLocationKey: 'location.ridge-channel', revealedLocationKeys: ['location.salt-port', 'location.ridge-channel'] },
      combat: { encounterKey: 'encounter.ridge-jackal', status: 'defeat' },
    })
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

    const catalog = createTextOpenWorldEffectCatalogV1(addEffects([
      { key: 'effect.kill-caretaker', operation: 'change-actor-state', payload: { actorKey: 'actor.caretaker', alive: false, present: false, locationKey: null } },
      { key: 'effect.remove-sword', operation: 'remove-item', payload: { itemKey: 'item.rust-sword', quantity: 1 } },
    ]))
    await expect(catalog.plan({ effectKeys: ['effect.kill-caretaker'], claimKey: 'claim.kill', state: state() }))
      .rejects.toThrow('不能杀死受保护Actor')
    const equipped = state({ inventory: { ...state().inventory, equippedItemKeyBySlot: { weapon: 'item.rust-sword', armor: null, accessory: null } } })
    await expect(catalog.plan({ effectKeys: ['effect.remove-sword'], claimKey: 'claim.remove-equipped', state: equipped }))
      .rejects.toThrow('不能移除已装备物品')
  })
})
