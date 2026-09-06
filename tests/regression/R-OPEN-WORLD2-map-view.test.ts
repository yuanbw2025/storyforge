import { describe, expect, it } from 'vitest'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { projectTextOpenWorldPlayerMapV1 } from '../../src/lib/open-world/map-view'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type { TextOpenWorldEffectDefinitionV1 } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

describe('Text Open World vNext · SVG layout and disclosure-safe map view', () => {
  it('同一冻结布局同时生成SVG节点数据和等价列表降级数据', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const view = projectTextOpenWorldPlayerMapV1({ runtimePackage, state })
    expect(view).toMatchObject({
      viewBox: { width: 1000, height: 700 },
      layoutSource: 'authored',
      locations: [
        expect.objectContaining({ locationKey: 'location.ridge-channel', knowledge: 'heard', title: '断脊渠口', description: null, x: 760, y: 220 }),
        expect.objectContaining({ locationKey: 'location.salt-port', knowledge: 'visited', title: '盐港广场', description: '盐商和守渠人汇集之处。', current: true, x: 220, y: 420 }),
      ],
      edges: [expect.objectContaining({ edgeKey: 'edge.port-ridge', open: true })],
    })
    expect(view.listFallback).toEqual(view.locations)
  })

  it('未知地区和地点从玩家投影中完全省略，听说只显示名称而不泄露详情', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    state.map.regionKnowledgeByKey['region.ridge'] = 'unknown'
    state.map.locationKnowledgeByKey['location.ridge-channel'] = 'unknown'
    state.map.revealedLocationKeys = ['location.salt-port']
    const serialized = JSON.stringify(projectTextOpenWorldPlayerMapV1({ runtimePackage, state }))
    expect(serialized).not.toContain('location.ridge-channel')
    expect(serialized).not.toContain('断脊渠口')
    expect(serialized).not.toContain('荒野危险与断流真相')

    state.map.regionKnowledgeByKey['region.ridge'] = 'heard'
    state.map.locationKnowledgeByKey['location.ridge-channel'] = 'heard'
    state.map.revealedLocationKeys.push('location.ridge-channel')
    const heard = projectTextOpenWorldPlayerMapV1({ runtimePackage, state })
    expect(heard.locations.find(location => location.locationKey === 'location.ridge-channel')).toMatchObject({
      title: '断脊渠口', description: null, functions: null, kind: null,
    })
    expect(heard.regions.find(region => region.regionKey === 'region.ridge')).toMatchObject({ description: null, theme: null, levelBand: null })
  })

  it('地点揭示只提升为听说，到达才提升为已到访且不会顺带推进任务', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const effects = (runtimePackage.modules.actions.payload as { effects: TextOpenWorldEffectDefinitionV1[] }).effects
    effects.push(
      { key: 'effect.test-hear-ridge', operation: 'reveal-location', payload: { locationKey: 'location.ridge-channel' } },
      { key: 'effect.test-enter-ridge', operation: 'enter-location', payload: { locationKey: 'location.ridge-channel' } },
    )
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    state.map.regionKnowledgeByKey['region.ridge'] = 'unknown'
    state.map.locationKnowledgeByKey['location.ridge-channel'] = 'unknown'
    state.map.revealedLocationKeys = ['location.salt-port']
    const questBefore = structuredClone(state.quests)
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const heardPlan = await catalog.plan({ effectKeys: ['effect.test-hear-ridge'], claimKey: 'claim.map.heard', state })
    const heard = (await catalog.apply({ plan: heardPlan, state })).state
    expect(heard.map).toMatchObject({
      currentLocationKey: 'location.salt-port',
      regionKnowledgeByKey: { 'region.ridge': 'heard' },
      locationKnowledgeByKey: { 'location.ridge-channel': 'heard' },
    })
    expect(heard.quests).toEqual(questBefore)
    const visitPlan = await catalog.plan({ effectKeys: ['effect.test-enter-ridge'], claimKey: 'claim.map.visited', state: heard })
    const visited = (await catalog.apply({ plan: visitPlan, state: heard })).state
    expect(visited.map).toMatchObject({
      currentLocationKey: 'location.ridge-channel',
      regionKnowledgeByKey: { 'region.ridge': 'visited' },
      locationKnowledgeByKey: { 'location.ridge-channel': 'visited' },
    })
    expect(visited.quests).toEqual(questBefore)
  })

  it('发布校验拒绝布局缺失、坐标重叠和伪造的确定性回退布局，并兼容v1自动布局', () => {
    const missing = createTextOpenWorldVNextFixture()
    ;(missing.modules.presentation.payload as any).mapLayout.locationNodes.pop()
    expect(() => parseTextOpenWorldModulesV1(missing)).toThrow('map layout location nodes 双向引用不一致')

    const overlap = createTextOpenWorldVNextFixture()
    ;(overlap.modules.presentation.payload as any).mapLayout.locationNodes[1].x = 220
    ;(overlap.modules.presentation.payload as any).mapLayout.locationNodes[1].y = 420
    expect(() => parseTextOpenWorldModulesV1(overlap)).toThrow('地点坐标不能重叠')

    const forgedFallback = createTextOpenWorldVNextFixture()
    ;(forgedFallback.modules.presentation.payload as any).mapLayout.source = 'deterministic-fallback'
    expect(() => parseTextOpenWorldModulesV1(forgedFallback)).toThrow('与规范算法不一致')

    const legacy = createTextOpenWorldVNextFixture()
    const presentation = legacy.modules.presentation.payload as any
    presentation.version = 1
    legacy.modules.presentation.schemaVersion = 1
    delete presentation.mapLayout
    const left = parseTextOpenWorldModulesV1(legacy).presentation.mapLayout
    const right = parseTextOpenWorldModulesV1(structuredClone(legacy)).presentation.mapLayout
    expect(left).toEqual(right)
    expect(left).toMatchObject({ source: 'deterministic-fallback', locationNodes: expect.arrayContaining([
      expect.objectContaining({ locationKey: 'location.salt-port' }),
      expect.objectContaining({ locationKey: 'location.ridge-channel' }),
    ]) })
  })
})
