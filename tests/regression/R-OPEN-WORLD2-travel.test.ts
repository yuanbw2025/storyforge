import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { projectTextOpenWorldTravelOptionsV1 } from '../../src/lib/open-world/travel'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function publishedSession() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const session = (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 普通旅行验收-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    title: '盐脊旅行',
    seed: 'travel-seed',
  })).session
  return { runtimePackage, session }
}

describe('Text Open World vNext · governed ordinary travel and early arrival', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('只投影当前位置可见的相邻路线，道路关闭时保留说明但禁止出发', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    expect(projectTextOpenWorldTravelOptionsV1(projection)).toEqual([expect.objectContaining({
      actionKey: 'action.travel-port-ridge', edgeKey: 'edge.port-ridge',
      originLocationKey: 'location.salt-port', destinationLocationKey: 'location.ridge-channel',
      destinationTitle: '断脊渠口', travelMinutes: 60, riskProfile: 'ordinary', available: true,
    })])

    projection.state.map.openEdgeKeys = []
    expect(projectTextOpenWorldTravelOptionsV1(projection)).toEqual([expect.objectContaining({
      actionKey: 'action.travel-port-ridge', available: false,
      unavailableReasons: expect.arrayContaining([expect.objectContaining({ code: 'route-closed' })]),
    })])
  })

  it('旅行用一条正式命令原子推进地点和冻结耗时，提前到达不会触发主线或场景', async () => {
    const { session } = await publishedSession()
    const before = (await readProductRuntimeState(session.id!)).textOpenWorld!
    const questBefore = structuredClone(before.state.quests)
    const feedback = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.travel-port-ridge', targetKey: 'location.ridge-channel',
      commandId: 'command.travel.port-ridge', requestedAt: 1_100,
    })
    expect(feedback).toMatchObject({ status: 'succeeded', evidenceEventSequences: [3, 4] })
    expect(feedback.changes.map(change => change.operation)).toEqual(['start-travel', 'advance-time', 'enter-location'])
    const arrived = (await readProductRuntimeState(session.id!)).textOpenWorld!
    expect(arrived.state).toMatchObject({
      map: {
        currentLocationKey: 'location.ridge-channel', travel: null,
        regionKnowledgeByKey: { 'region.ridge': 'visited' },
        locationKnowledgeByKey: { 'location.ridge-channel': 'visited' },
      },
      time: { worldMinute: 540 },
    })
    expect(arrived.state.quests).toEqual(questBefore)
    expect(projectTextOpenWorldTravelOptionsV1(arrived)).toEqual([expect.objectContaining({
      actionKey: 'action.travel-ridge-port', destinationLocationKey: 'location.salt-port', available: true,
    })])
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(4)

    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.travel-ridge-port', targetKey: 'location.salt-port',
      commandId: 'command.travel.ridge-port', requestedAt: 1_200,
    })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld?.state).toMatchObject({
      map: { currentLocationKey: 'location.salt-port', travel: null }, time: { worldMinute: 600 },
    })
  })

  it('构建期拒绝缺少方向覆盖、错误耗时和非旅行Action夹带行程Effect', () => {
    const missing = createTextOpenWorldVNextFixture()
    const missingActions = (missing.modules.actions.payload as any).actions
    const missingEffects = (missing.modules.actions.payload as any).effects
    missingActions.splice(missingActions.findIndex((action: any) => action.key === 'action.travel-ridge-port'), 1)
    missingEffects.splice(missingEffects.findIndex((effect: any) => effect.key === 'effect.travel-ridge-port-start'), 1)
    expect(() => parseTextOpenWorldModulesV1(missing)).toThrow('普通旅行Action路线覆盖')

    const wrongMinutes = createTextOpenWorldVNextFixture()
    ;(wrongMinutes.modules.actions.payload as any).effects
      .find((effect: any) => effect.key === 'effect.travel-port-ridge-time').payload.minutes = 59
    expect(() => parseTextOpenWorldModulesV1(wrongMinutes)).toThrow('道路方向、目标或耗时不一致')

    const smuggled = createTextOpenWorldVNextFixture()
    ;(smuggled.modules.actions.payload as any).actions
      .find((action: any) => action.key === 'action.investigate-channel').successEffectKeys = ['effect.travel-port-ridge-start', 'effect.investigate-time']
    expect(() => parseTextOpenWorldModulesV1(smuggled)).toThrow('start-travel只能由普通旅行Action引用')

    const legacy = createTextOpenWorldVNextFixture()
    const legacyActions = legacy.modules.actions.payload as any
    legacyActions.version = 2
    legacy.modules.actions.schemaVersion = 2
    legacyActions.actions = legacyActions.actions.filter((action: any) => action.category !== 'travel')
    legacyActions.effects = legacyActions.effects.filter((effect: any) => effect.operation !== 'start-travel')
    expect(parseTextOpenWorldModulesV1(legacy).actions.actions.some(action => action.category === 'travel')).toBe(false)
  })

  it('运行时再次拒绝关闭道路和单向道路的反向行程', async () => {
    const closed = createTextOpenWorldVNextFixture()
    const closedProjection = createInitialTextOpenWorldSessionProjectionV1(closed)
    closedProjection.state.map.openEdgeKeys = []
    await expect(createTextOpenWorldEffectCatalogV1(closed).plan({
      effectKeys: ['effect.travel-port-ridge-start'], claimKey: 'claim.travel.closed', state: closedProjection.state,
    })).rejects.toThrow('道路当前未开放')

    const oneWay = createTextOpenWorldVNextFixture()
    ;(oneWay.modules.actions.payload as any).version = 2
    oneWay.modules.actions.schemaVersion = 2
    ;(oneWay.modules.world.payload as any).edges[0].bidirectional = false
    const reverse = createInitialTextOpenWorldSessionProjectionV1(oneWay).state
    reverse.map.currentLocationKey = 'location.ridge-channel'
    reverse.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    reverse.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    await expect(createTextOpenWorldEffectCatalogV1(oneWay).plan({
      effectKeys: ['effect.travel-ridge-port-start'], claimKey: 'claim.travel.reverse', state: reverse,
    })).rejects.toThrow('旅行端点或方向无效')
  })
})
