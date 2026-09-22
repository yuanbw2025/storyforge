import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldDirectorCatalogV1 } from '../../src/lib/open-world/director'
import {
  applyTextOpenWorldEffectPlanForReplayV1,
  createTextOpenWorldEffectCatalogV1,
} from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const MAIN_INSTANCE_KEY = 'quest-instance.12.quest.main.1.release.13.session-start'

function ownerActionAchievementPackage() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const knowledge = runtimePackage.modules.knowledge.payload as any
  knowledge.achievements[0].conditionKeys = []
  knowledge.achievements[0].grantAuthority = 'owner-action'
  const quests = runtimePackage.modules.quests.payload as any
  const mainQuest = quests.quests.find((quest: { key: string }) => quest.key === 'quest.main.1')
  mainQuest.rewardEffectKeys.push('effect.earn-first-clue')
  const items = runtimePackage.modules.items.payload as any
  const reward = items.rewardContracts.find((item: { key: string }) => item.key === 'reward.quest-main')
  reward.effectKeys.push('effect.earn-first-clue')
  const actions = runtimePackage.modules.actions.payload as any
  const historicalRest = actions.actions.find((action: { key: string }) => action.key === 'action.rest')
  actions.actions.push({
    ...structuredClone(historicalRest),
    key: 'action.rest.standard',
    locationKeys: [],
  })
  const director = runtimePackage.modules.director.payload as any
  director.version = 3
  director.decks[0].triggerKinds.push('rest')
  director.randomEvents.forEach((event: any) => {
    event.locationKeys = event.key === 'event.channel-rumor' ? ['location.salt-port'] : []
  })
  runtimePackage.modules.director.schemaVersion = 3
  return runtimePackage
}

describe('R-OPEN-WORLD3 · owner Action achievement runtime', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('marker缺失的历史Knowledge字节形态与Director条件授予语义保持不变', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const serializedKnowledge = JSON.stringify(runtimePackage.modules.knowledge.payload)
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    expect(JSON.stringify(modules.knowledge)).toBe(serializedKnowledge)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.time.worldMinute = 3_360
    expect(createTextOpenWorldDirectorCatalogV1(runtimePackage, modules).resolve({
      state: projection.state,
      trigger: 'activity',
      conditionResults: { 'condition.always': true, 'condition.level-two': false },
      evidence: [],
    }).earnedAchievementKeys).toEqual(['achievement.first-clue'])
  })

  it('owner-action成就不能同时声明Director条件', () => {
    const runtimePackage = ownerActionAchievementPackage()
    ;((runtimePackage.modules.knowledge.payload as any).achievements[0].conditionKeys as string[])
      .push('condition.always')
    expect(() => parseTextOpenWorldModulesV1(runtimePackage)).toThrow(/owner-action不能声明Director条件/)
  })

  it('owner-action包的Knowledge或成就Effect不能被Director和犯罪目击作为第二条执行路径引用', () => {
    const runtimePackage = ownerActionAchievementPackage()
    const director = runtimePackage.modules.director.payload as any
    director.randomEvents[0].effectKeys.push('effect.earn-first-clue')
    expect(() => parseTextOpenWorldModulesV1(runtimePackage))
      .toThrow(/owner-action Knowledge或成就Effect不能由Director事件执行/)

    const crimePackage = ownerActionAchievementPackage()
    const actions = crimePackage.modules.actions.payload as any
    actions.effects.push({
      key: 'effect.reveal-caretaker',
      operation: 'reveal-knowledge',
      payload: { knowledgeKey: 'knowledge.caretaker', visibility: 'known' },
    })
    const relationships = crimePackage.modules.relationships.payload as any
    relationships.crimeActions[0].witnessedEffectKeys.push('effect.reveal-caretaker')
    expect(() => parseTextOpenWorldModulesV1(crimePackage))
      .toThrow(/owner-action Knowledge或成就Effect不能作为犯罪目击后果/)
  })

  it('owner-action包的传闻事件必须唯一进入可由玩家行动触发的对应地区牌组', () => {
    const missingDeckBinding = ownerActionAchievementPackage()
    const missingDirector = missingDeckBinding.modules.director.payload as any
    missingDirector.decks[0].randomEventKeys = []
    expect(() => parseTextOpenWorldModulesV1(missingDeckBinding))
      .toThrow(/必须冻结唯一地点并唯一进入对应地区牌组/)

    const unreachableTrigger = ownerActionAchievementPackage()
    const unreachableDirector = unreachableTrigger.modules.director.payload as any
    unreachableDirector.decks[0].triggerKinds = ['time-batch']
    expect(() => parseTextOpenWorldModulesV1(unreachableTrigger))
      .toThrow(/缺少编译器保证可达的rest触发/)
  })

  it('Director v3只在冻结地点产生传闻候选，并拒绝把正确地点授权拿到同地区别处重放', () => {
    const runtimePackage = ownerActionAchievementPackage()
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    const saltDeck = modules.director.decks.find(deck => deck.regionKey === 'region.salt-port')!
    saltDeck.questKeys = []
    saltDeck.templateKeys = []
    saltDeck.blankWeight = 1
    const ridgeLocation = modules.world.locations.find(location => location.key === 'location.ridge-channel')!
    ridgeLocation.regionKey = 'region.salt-port'
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    state.time.worldMinute = 3_360
    const director = createTextOpenWorldDirectorCatalogV1(runtimePackage, modules)

    state.map.currentLocationKey = 'location.ridge-channel'
    expect(director.randomRequestsFor({ state, trigger: 'rest', conditionResults: {} })[0])
      .toMatchObject({ maximumInclusive: 1 })

    state.map.currentLocationKey = 'location.salt-port'
    const requests = director.randomRequestsFor({ state, trigger: 'rest', conditionResults: {} })
    expect(requests[0]).toMatchObject({ maximumInclusive: 11 })
    const evidence = requests.map((request, drawIndex) => ({
      ...request,
      drawIndex,
      value: drawIndex === 0 ? 2 : 1,
    }))
    const authorization = director.resolve({ state, trigger: 'rest', conditionResults: {}, evidence })
    expect(authorization.selection).toMatchObject({
      outcomeKind: 'random-event', sourceKey: 'event.channel-rumor', rumorKey: 'rumor.channel',
    })

    state.map.currentLocationKey = 'location.ridge-channel'
    expect(() => director.assertAuthorization({ state, authorization }))
      .toThrow(/Director随机事件授权无效/)
  })

  it('Director的弱校验、Effect预演与重放都拒绝伪造owner-action成就授权', async () => {
    const runtimePackage = ownerActionAchievementPackage()
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    state.time.worldMinute = 3_360
    const director = createTextOpenWorldDirectorCatalogV1(runtimePackage, modules)
    const authorization = director.resolve({
      state,
      trigger: 'activity',
      conditionResults: { 'condition.always': true, 'condition.level-two': false },
      evidence: [],
    })
    expect(authorization.earnedAchievementKeys).toEqual([])
    const forged = structuredClone(authorization)
    forged.earnedAchievementKeys.push('achievement.first-clue')
    expect(() => director.assertAuthorization({ state, authorization: forged }))
      .toThrow(/Director成就授权无效/)

    const effects = createTextOpenWorldEffectCatalogV1(runtimePackage)
    await expect(effects.plan({
      effectKeys: ['effect.settle-director'],
      claimKey: 'claim.director.owner-forged',
      state,
      authorization: forged,
    })).rejects.toThrow(/Director成就授权无效/)

    const validPlan = await effects.plan({
      effectKeys: ['effect.settle-director'],
      claimKey: 'claim.director.owner-valid',
      state,
      authorization,
    })
    const forgedReplay = structuredClone(validPlan)
    forgedReplay.authorization = forged
    expect(() => applyTextOpenWorldEffectPlanForReplayV1(runtimePackage, state, forgedReplay))
      .toThrow(/Director成就授权无效/)
  })

  it('Director不提前授予，任务奖励Action只结算一次成就且幂等重放不重复', async () => {
    const runtimePackage = ownerActionAchievementPackage()
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    expect(modules.knowledge.achievements[0]).toMatchObject({
      key: 'achievement.first-clue', conditionKeys: [], grantAuthority: 'owner-action',
    })

    const isolatedProjection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    isolatedProjection.state.time.worldMinute = 3_360
    const authorization = createTextOpenWorldDirectorCatalogV1(runtimePackage, modules).resolve({
      state: isolatedProjection.state,
      trigger: 'activity',
      conditionResults: { 'condition.always': true, 'condition.level-two': false },
      evidence: [],
    })
    expect(authorization.earnedAchievementKeys).toEqual([])

    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `owner-achievement-${crypto.randomUUID()}`,
      textOpenWorldVNext: runtimePackage,
      title: 'Owner Action Achievement',
      seed: 'owner-action-achievement.seed',
    })
    const sessionId = created.session.id!
    await executeTextOpenWorldActionV1({
      sessionId, actionKey: 'action.accept-main', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.owner-achievement.accept', requestedAt: 1_000,
    })
    await executeTextOpenWorldActionV1({
      sessionId, actionKey: 'action.complete-main-objective', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.owner-achievement.objective', requestedAt: 1_100,
    })
    expect((await readProductRuntimeState(sessionId)).textOpenWorld!.state.knowledge.earnedAchievementKeys).toEqual([])

    const rewardInput = {
      sessionId, actionKey: 'action.claim-main-reward', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.owner-achievement.reward', requestedAt: 1_200,
    }
    const reward = await executeTextOpenWorldActionV1(rewardInput)
    expect(reward).toMatchObject({ phase: 'terminal', status: 'succeeded', outcomeCommitted: true })
    expect(reward.changes.map(change => change.operation)).toContain('earn-achievement')
    const afterReward = (await readProductRuntimeState(sessionId)).textOpenWorld!.state
    expect(afterReward.knowledge.earnedAchievementKeys).toEqual(['achievement.first-clue'])
    expect(afterReward.knowledge.history.filter(item => (
      item.kind === 'achievement-earned' && item.targetKey === 'achievement.first-clue'
    ))).toHaveLength(1)

    const eventCount = await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()
    const retry = await executeTextOpenWorldActionV1({ ...rewardInput, requestedAt: 9_999 })
    expect(retry.receiptHash).toBe(reward.receiptHash)
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(eventCount)

    const rejected = await executeTextOpenWorldActionV1({
      ...rewardInput, commandId: 'command.owner-achievement.reward-again', requestedAt: 10_000,
    })
    expect(rejected).toMatchObject({ phase: 'preflight', status: 'rejected', outcomeCommitted: false })
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).count()).toBe(eventCount)
    const final = (await readProductRuntimeState(sessionId)).textOpenWorld!.state
    expect(final.knowledge.earnedAchievementKeys).toEqual(['achievement.first-clue'])
    expect(final.knowledge.history.filter(item => (
      item.kind === 'achievement-earned' && item.targetKey === 'achievement.first-clue'
    ))).toHaveLength(1)
  }, 15_000)
})
