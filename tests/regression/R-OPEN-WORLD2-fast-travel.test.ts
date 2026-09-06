import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldEffectCatalogV1, validateTextOpenWorldEffectStateV1 } from '../../src/lib/open-world/effect-dsl'
import { createTextOpenWorldFastTravelCatalogV1 } from '../../src/lib/open-world/fast-travel'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { projectTextOpenWorldFastTravelOptionsV1 } from '../../src/lib/open-world/travel'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture, downgradeTextOpenWorldFixtureWithoutCrimeV1 } from '../helpers/text-open-world-vnext-fixture'

async function publishedSession() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const session = (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 快速旅行验收-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    title: '盐脊快旅',
    seed: 'fast-travel-seed',
  })).session
  return { runtimePackage, session }
}

describe('Text Open World vNext · governed atomic fast travel', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('开局没有其他快旅目标，普通到访后才自动解锁并按冻结规则计算耗时', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const initial = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    expect(projectTextOpenWorldFastTravelOptionsV1(initial)).toEqual([])

    const effects = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const travelPlan = await effects.plan({
      effectKeys: ['effect.travel-port-ridge-start', 'effect.travel-port-ridge-time', 'effect.travel-port-ridge-enter'],
      claimKey: 'claim.visit-ridge', state: initial.state,
    })
    const visited = (await effects.apply({ plan: travelPlan, state: initial.state })).state
    initial.state = visited
    expect(visited.map.unlockedFastTravelPointKeys).toEqual(['fast-travel.salt-port', 'fast-travel.ridge'])
    expect(projectTextOpenWorldFastTravelOptionsV1(initial)).toEqual([expect.objectContaining({
      actionKey: 'action.fast-travel', fastTravelPointKey: 'fast-travel.salt-port',
      destinationLocationKey: 'location.salt-port', travelMinutes: 30, routeEdgeKeys: ['edge.port-ridge'], available: true,
    })])
  })

  it('快旅用一个命令和一个Effect原子结算地点与时间，没有途中事件或中间行程态', async () => {
    const { runtimePackage, session } = await publishedSession()
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.travel-port-ridge', targetKey: 'location.ridge-channel',
      commandId: 'command.fast-travel.unlock', requestedAt: 1_100,
    })
    const before = (await readProductRuntimeState(session.id!)).textOpenWorld!
    const questsBefore = structuredClone(before.state.quests)
    const feedback = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.fast-travel', targetKey: 'location.salt-port',
      commandId: 'command.fast-travel.return', requestedAt: 1_200,
    })
    expect(feedback).toMatchObject({ status: 'succeeded', evidenceEventSequences: [5, 6] })
    expect(feedback.changes.map(change => change.operation)).toEqual(['fast-travel'])
    const after = (await readProductRuntimeState(session.id!)).textOpenWorld!
    expect(after.state).toMatchObject({
      map: { currentLocationKey: 'location.salt-port', travel: null },
      time: { worldMinute: 570 },
    })
    expect(after.state.quests).toEqual(questsBefore)
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.map(event => event.type)).toEqual([
      'narrative.started', 'narrative.node.entered',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
    ])
    const persistedPlan = JSON.parse(events[5].payloadJson).plan
    expect(persistedPlan).toMatchObject({
      impactDomains: ['map', 'time'],
      authorization: {
        kind: 'fast-travel', originLocationKey: 'location.ridge-channel', destinationLocationKey: 'location.salt-port',
        routeEdgeKeys: ['edge.port-ridge'], baseWorldMinute: 540, travelMinutes: 30,
      },
    })
    const fastTravelEffect = parseTextOpenWorldModulesV1(runtimePackage).actions.effects.find(effect => effect.operation === 'fast-travel')!
    if (fastTravelEffect.operation !== 'fast-travel') throw new Error('fixture缺少fast-travel Effect')
    const forgedAuthorization = structuredClone(persistedPlan.authorization)
    forgedAuthorization.travelMinutes += 1
    expect(() => createTextOpenWorldFastTravelCatalogV1(runtimePackage).assertAuthorization({
      state: before.state, effect: fastTravelEffect, authorization: forgedAuthorization,
    })).toThrow('授权与权威状态不一致')

    const retried = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.fast-travel', targetKey: 'location.salt-port',
      commandId: 'command.fast-travel.return', requestedAt: 1_200,
    })
    expect(retried.receiptHash).toBe(feedback.receiptHash)
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(6)
  }, 10_000)

  it('听说地点不能解锁快旅点，伪造已解锁状态也不能进入Session', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    ;(runtimePackage.modules.actions.payload as any).effects.push({
      key: 'effect.unlock-heard-ridge', operation: 'unlock-fast-travel', payload: { fastTravelPointKey: 'fast-travel.ridge' },
    })
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    await expect(createTextOpenWorldEffectCatalogV1(runtimePackage).plan({
      effectKeys: ['effect.unlock-heard-ridge'], claimKey: 'claim.unlock-heard', state,
    })).rejects.toThrow('尚未到访')

    state.map.unlockedFastTravelPointKeys.push('fast-travel.ridge')
    expect(() => validateTextOpenWorldEffectStateV1(state, parseTextOpenWorldModulesV1(runtimePackage)))
      .toThrow('快速旅行点所属地点尚未到访')
  })

  it('执行前重新检查开放路线，阻断后既不投影可执行目标也不能伪造授权', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.map.currentLocationKey = 'location.ridge-channel'
    projection.state.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    projection.state.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    projection.state.map.unlockedFastTravelPointKeys.push('fast-travel.ridge')
    projection.state.map.openEdgeKeys = []
    expect(projectTextOpenWorldFastTravelOptionsV1(projection)).toEqual([expect.objectContaining({
      destinationLocationKey: 'location.salt-port', available: false, travelMinutes: null,
      unavailableReasons: expect.arrayContaining([expect.objectContaining({ code: 'route-closed' })]),
    })])
    const effect = parseTextOpenWorldModulesV1(runtimePackage).actions.effects
      .find(candidate => candidate.operation === 'fast-travel')!
    if (effect.operation !== 'fast-travel') throw new Error('fixture缺少fast-travel Effect')
    expect(() => createTextOpenWorldFastTravelCatalogV1(runtimePackage).prepare({
      state: projection.state, effect, destinationLocationKey: 'location.salt-port',
    })).toThrow('没有通往目标地点的开放路线')
  })

  it('构建期拒绝重复快旅Action、非法耗时规则和Effect被其他Action夹带', () => {
    const prematureDefault = createTextOpenWorldVNextFixture()
    ;(prematureDefault.modules.world.payload as any).fastTravelPoints.find((point: any) => point.key === 'fast-travel.ridge').unlockedByDefault = true
    expect(() => parseTextOpenWorldModulesV1(prematureDefault)).toThrow('默认解锁快速旅行点所属地点必须已到访')

    const duplicate = createTextOpenWorldVNextFixture()
    const duplicateActions = (duplicate.modules.actions.payload as any).actions
    duplicateActions.push({ ...structuredClone(duplicateActions.find((action: any) => action.key === 'action.fast-travel')), key: 'action.fast-travel-copy' })
    expect(() => parseTextOpenWorldModulesV1(duplicate)).toThrow('必须且只能定义一个快速旅行Action')

    const slow = createTextOpenWorldVNextFixture()
    ;(slow.modules.actions.payload as any).effects.find((effect: any) => effect.key === 'effect.fast-travel').payload.timeRatioNumerator = 3
    expect(() => parseTextOpenWorldModulesV1(slow)).toThrow('耗时比例不能高于普通路线')

    const smuggled = createTextOpenWorldVNextFixture()
    ;(smuggled.modules.actions.payload as any).actions.find((action: any) => action.key === 'action.investigate-channel').successEffectKeys = ['effect.fast-travel', 'effect.investigate-time']
    expect(() => parseTextOpenWorldModulesV1(smuggled)).toThrow('fast-travel只能由快速旅行Action引用')
  })

  it('Action v3旧Release无需快旅Action即可继续读取', () => {
    const legacy = createTextOpenWorldVNextFixture()
    downgradeTextOpenWorldFixtureWithoutCrimeV1(legacy)
    const actions = legacy.modules.actions.payload as any
    actions.version = 3
    legacy.modules.actions.schemaVersion = 3
    actions.actions = actions.actions.filter((action: any) => action.category !== 'fast-travel')
    actions.effects = actions.effects.filter((effect: any) => effect.operation !== 'fast-travel')
    expect(parseTextOpenWorldModulesV1(legacy).actions.actions.some(action => action.category === 'fast-travel')).toBe(false)
  })
})
