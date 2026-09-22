import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { projectTextOpenWorldPlayerMapScreenV1 } from '../../src/lib/open-world/player-map'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

describe('Text Open World G4-06 · disclosure-safe player map projection', () => {
  it('展示全部已知道路，但只把当前地点相邻的正式Action投影为普通旅行', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    const map = projectTextOpenWorldPlayerMapScreenV1(projection)

    expect(map).toMatchObject({
      viewBox: { width: 1000, height: 700 },
      layoutSource: 'authored',
      currentLocationKey: 'location.salt-port',
      knownLocationCount: 2,
      visitedLocationCount: 1,
      unlockedFastTravelPointCount: 1,
    })
    expect(map.routes).toEqual([expect.objectContaining({
      edgeKey: 'edge.port-ridge',
      fromLocationKey: 'location.salt-port',
      toLocationKey: 'location.ridge-channel',
      fromCurrentLocation: true,
      open: true,
      ordinaryTravelOptions: [expect.objectContaining({
        actionKey: 'action.travel-port-ridge',
        originLocationKey: 'location.salt-port',
        destinationLocationKey: 'location.ridge-channel',
        travelMinutes: 60,
        available: true,
      })],
    })])
    expect(map.locations.find(location => location.locationKey === 'location.ridge-channel')).toMatchObject({
      regionTitle: '断脊',
      knowledge: 'heard',
      title: '断脊渠口',
      description: null,
      earlyArrivalDescription: null,
      functions: null,
      kind: null,
      unlockedFastTravelPointKey: null,
      fastTravelOption: null,
      ordinaryTravelOptions: [expect.objectContaining({ actionKey: 'action.travel-port-ridge' })],
    })
    expect(map.locations.find(location => location.locationKey === 'location.salt-port')?.ordinaryTravelOptions).toEqual([])
    expect(map.regions.find(region => region.regionKey === 'region.ridge')).toMatchObject({
      knowledge: 'heard', description: null, theme: null, levelBand: null,
    })
  })

  it('未知地点、隐藏路线及其内容不会出现在任何地图序列化结果中', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    projection.state.map.regionKnowledgeByKey['region.ridge'] = 'unknown'
    projection.state.map.locationKnowledgeByKey['location.ridge-channel'] = 'unknown'
    projection.state.map.revealedLocationKeys = ['location.salt-port']

    const map = projectTextOpenWorldPlayerMapScreenV1(projection)
    expect(map.regions.map(region => region.regionKey)).toEqual(['region.salt-port'])
    expect(map.locations.map(location => location.locationKey)).toEqual(['location.salt-port'])
    expect(map.routes).toEqual([])
    expect(map.listFallback.map(location => location.locationKey)).toEqual(['location.salt-port'])

    const serialized = JSON.stringify(map)
    expect(serialized).not.toContain('region.ridge')
    expect(serialized).not.toContain('location.ridge-channel')
    expect(serialized).not.toContain('edge.port-ridge')
    expect(serialized).not.toContain('断脊渠口')
    expect(serialized).not.toContain('荒野危险与断流真相')
    expect(serialized).not.toContain('沿盐渠维护道连接港口与断脊渠口')
  })

  it('普通旅行抵达后自动解锁当地快旅点，并按Release冻结比例投影返程耗时', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const effects = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await effects.plan({
      effectKeys: [
        'effect.travel-port-ridge-start',
        'effect.travel-port-ridge-time',
        'effect.travel-port-ridge-enter',
      ],
      claimKey: 'claim.player-map.visit-ridge',
      state: projection.state,
    })
    projection.state = (await effects.apply({ plan, state: projection.state })).state

    const map = projectTextOpenWorldPlayerMapScreenV1(projection)
    expect(projection.state.time.worldMinute).toBe(540)
    expect(map).toMatchObject({
      currentLocationKey: 'location.ridge-channel',
      knownLocationCount: 2,
      visitedLocationCount: 2,
      unlockedFastTravelPointCount: 2,
    })
    expect(map.locations.find(location => location.locationKey === 'location.ridge-channel')).toMatchObject({
      current: true,
      knowledge: 'visited',
      unlockedFastTravelPointKey: 'fast-travel.ridge',
      ordinaryTravelOptions: [],
    })
    expect(map.locations.find(location => location.locationKey === 'location.salt-port')).toMatchObject({
      unlockedFastTravelPointKey: 'fast-travel.salt-port',
      ordinaryTravelOptions: [expect.objectContaining({
        actionKey: 'action.travel-ridge-port', destinationLocationKey: 'location.salt-port', travelMinutes: 60, available: true,
      })],
      fastTravelOption: expect.objectContaining({
        actionKey: 'action.fast-travel',
        fastTravelPointKey: 'fast-travel.salt-port',
        routeEdgeKeys: ['edge.port-ridge'],
        travelMinutes: 30,
        available: true,
      }),
    })
  })

  it('道路关闭时保留已知路线，但普通旅行与快速旅行都给出明确禁用原因', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture())
    projection.state.map.currentLocationKey = 'location.ridge-channel'
    projection.state.map.regionKnowledgeByKey['region.ridge'] = 'visited'
    projection.state.map.locationKnowledgeByKey['location.ridge-channel'] = 'visited'
    projection.state.map.unlockedFastTravelPointKeys.push('fast-travel.ridge')
    projection.state.map.openEdgeKeys = []

    const map = projectTextOpenWorldPlayerMapScreenV1(projection)
    expect(map.routes).toEqual([expect.objectContaining({
      edgeKey: 'edge.port-ridge',
      open: false,
      fromCurrentLocation: true,
      ordinaryTravelOptions: [expect.objectContaining({
        actionKey: 'action.travel-ridge-port',
        available: false,
        unavailableReasons: expect.arrayContaining([
          expect.objectContaining({ code: 'route-closed', message: '这条道路当前不能通行。' }),
        ]),
      })],
    })])
    expect(map.locations.find(location => location.locationKey === 'location.salt-port')).toMatchObject({
      fastTravelOption: expect.objectContaining({
        available: false,
        travelMinutes: null,
        routeEdgeKeys: [],
        unavailableReasons: expect.arrayContaining([expect.objectContaining({
          code: 'route-closed', message: '当前没有通往已解锁地点的开放路线。',
        })]),
      }),
    })
  })
})
