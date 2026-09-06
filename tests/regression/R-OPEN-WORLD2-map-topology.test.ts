import { describe, expect, it } from 'vitest'
import {
  createTextOpenWorldMapDefinitionV1,
  deriveTextOpenWorldLocationContentBindingsV1,
  planTextOpenWorldRouteV1,
  projectTextOpenWorldMapConnectionsV1,
} from '../../src/lib/open-world/map-topology'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function worldPayload() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  return { runtimePackage, world: runtimePackage.modules.world.payload as any }
}

describe('Text Open World vNext · release map definition and deterministic topology', () => {
  it('地图定义保留来源、存在目的和提前到达内容，地点绑定只是候选而不会触发剧情', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const map = createTextOpenWorldMapDefinitionV1(runtimePackage)
    expect(map.initialLocationKey).toBe('location.salt-port')
    expect(map.regionByKey['region.ridge']).toMatchObject({
      theme: '荒野危险与断流真相',
      levelBand: { minimum: 2, maximum: 5 },
      fastTravelPointKey: 'fast-travel.ridge',
      sourceRefs: ['world-release:region:ridge'],
    })
    expect(map.locationByKey['location.ridge-channel']).toMatchObject({
      functions: ['narrative', 'exploration', 'combat', 'travel'],
      earlyArrivalDescription: expect.stringContaining('主线真相场景仍等待'),
      sourceRefs: ['world-release:location:ridge-channel'],
    })
    const bindings = deriveTextOpenWorldLocationContentBindingsV1({ runtimePackage, locationKey: 'location.ridge-channel' })
    expect(bindings).toMatchObject({
      sceneKeys: [],
      regionalQuestDefinitionKeys: ['quest.main.1'],
      encounterKeys: ['encounter.ridge-jackal'],
    })
    expect(bindings).not.toHaveProperty('triggeredSceneKeys')
  })

  it('按道路方向和世界分钟选择确定性最短路线，当前关闭路线不可规划', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const openEdgeKeys = ['edge.port-ridge']
    expect(projectTextOpenWorldMapConnectionsV1({
      runtimePackage, currentLocationKey: 'location.salt-port', openEdgeKeys,
    })).toEqual([expect.objectContaining({
      edgeKey: 'edge.port-ridge', destinationLocationKey: 'location.ridge-channel', travelMinutes: 60, currentlyOpen: true,
    })])
    const route = planTextOpenWorldRouteV1({
      runtimePackage, fromLocationKey: 'location.salt-port', destinationLocationKey: 'location.ridge-channel', openEdgeKeys,
    })
    expect(route).toEqual(expect.objectContaining({
      locationKeys: ['location.salt-port', 'location.ridge-channel'],
      regionKeys: ['region.salt-port', 'region.ridge'],
      edgeKeys: ['edge.port-ridge'],
      totalTravelMinutes: 60,
    }))
    expect(route).not.toHaveProperty('sceneKeys')
    const alternate = worldPayload()
    alternate.world.regions[0].locationKeys.push('location.salt-market')
    alternate.world.locations.push({
      key: 'location.salt-market', regionKey: 'region.salt-port', title: '盐市', description: '连接港口和山道的集市。',
      kind: 'settlement', tags: ['集市'], purpose: '提供另一条可玩的上山路线。', functions: ['service', 'travel'],
      earlyArrivalDescription: '盐市正常交易，不触发任何关键剧情。', initialKnowledge: 'heard',
      sourceRefs: ['world-release:location:salt-market'], presentationRefs: ['map.world'],
    })
    ;(alternate.runtimePackage.modules.presentation.payload as any).mapLayout.locationNodes.push({ locationKey: 'location.salt-market', x: 420, y: 360 })
    alternate.world.edges.push({
      key: 'edge.port-market', fromLocationKey: 'location.salt-port', toLocationKey: 'location.salt-market', bidirectional: true,
      travelMinutes: 15, conditionKeys: [], description: '港口到盐市的短路。', riskProfile: 'safe', sourceRefs: ['world-release:route:port-market'],
    }, {
      key: 'edge.market-ridge', fromLocationKey: 'location.salt-market', toLocationKey: 'location.ridge-channel', bidirectional: true,
      travelMinutes: 20, conditionKeys: [], description: '盐市通往断脊的山道。', riskProfile: 'ordinary', sourceRefs: ['world-release:route:market-ridge'],
    })
    ;(alternate.runtimePackage.modules.actions.payload as any).version = 2
    alternate.runtimePackage.modules.actions.schemaVersion = 2
    expect(planTextOpenWorldRouteV1({
      runtimePackage: alternate.runtimePackage, fromLocationKey: 'location.salt-port', destinationLocationKey: 'location.ridge-channel',
    })).toEqual(expect.objectContaining({ edgeKeys: ['edge.port-market', 'edge.market-ridge'], totalTravelMinutes: 35 }))
    expect(planTextOpenWorldRouteV1({
      runtimePackage, fromLocationKey: 'location.salt-port', destinationLocationKey: 'location.ridge-channel', openEdgeKeys: [],
    })).toBeNull()
    expect(() => planTextOpenWorldRouteV1({
      runtimePackage, fromLocationKey: 'location.salt-port', destinationLocationKey: 'location.ridge-channel', openEdgeKeys: ['edge.unknown'],
    })).toThrow('未知道路')
  })

  it('构建期拒绝结构不可达、道路悬空条件、错误地区快旅归属和无内容理由地点', () => {
    const directed = worldPayload()
    directed.world.edges[0].fromLocationKey = 'location.ridge-channel'
    directed.world.edges[0].toLocationKey = 'location.salt-port'
    directed.world.edges[0].bidirectional = false
    expect(() => parseTextOpenWorldModulesV1(directed.runtimePackage)).toThrow('结构不可达')

    const condition = worldPayload()
    condition.world.edges[0].conditionKeys = ['condition.missing']
    expect(() => parseTextOpenWorldModulesV1(condition.runtimePackage)).toThrow('world.edges[0].conditionKeys 引用不存在')

    const fastTravel = worldPayload()
    fastTravel.world.regions[0].fastTravelPointKey = 'fast-travel.ridge'
    fastTravel.world.regions[1].fastTravelPointKey = 'fast-travel.salt-port'
    expect(() => parseTextOpenWorldModulesV1(fastTravel.runtimePackage)).toThrow('fastTravelPointKey不在本地区')

    const purposeless = worldPayload()
    purposeless.world.locations[0].purpose = ''
    expect(() => parseTextOpenWorldModulesV1(purposeless.runtimePackage)).toThrow('world.locations[0].purpose 无效')

    const sourceless = worldPayload()
    sourceless.world.locations[0].sourceRefs = []
    expect(() => parseTextOpenWorldModulesV1(sourceless.runtimePackage)).toThrow('必须说明来源')
  })

  it('旧World v1只读规范化为当前地图定义而不要求伪造新来源', () => {
    const { runtimePackage, world } = worldPayload()
    world.version = 1
    runtimePackage.modules.world.schemaVersion = 1
    world.regions = world.regions.map(({ key, title, description, locationKeys, initialKnowledge }: any) => ({
      key, title, description, locationKeys, initialKnowledge,
    }))
    world.locations = world.locations.map(({ key, regionKey, title, description, kind, tags }: any) => ({
      key, regionKey, title, description, kind, tags,
    }))
    world.edges = world.edges.map(({ key, fromLocationKey, toLocationKey, bidirectional, travelMinutes, conditionKeys }: any) => ({
      key, fromLocationKey, toLocationKey, bidirectional, travelMinutes, conditionKeys,
    }))
    const parsed = parseTextOpenWorldModulesV1(runtimePackage)
    expect(parsed.world.version).toBe(3)
    expect(parsed.world.locations[0]).toMatchObject({
      purpose: '盐商和守渠人汇集之处。', functions: ['exploration'], sourceRefs: [],
    })
    expect(planTextOpenWorldRouteV1({
      runtimePackage, fromLocationKey: 'location.salt-port', destinationLocationKey: 'location.ridge-channel',
    })?.totalTravelMinutes).toBe(60)
  })
})
