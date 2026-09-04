import { describe, expect, it } from 'vitest'
import {
  distanceToKm,
  resolveMapScale,
  solveSpatialLayout,
} from '../../src/lib/world-map/spatial-layout'
import type { MapSpatialEntity, MapSpatialRelation } from '../../src/lib/world-map/engine'
import { generateMap } from '../../src/lib/world-map/engine'
import {
  buildVoronoiMapPrompt,
  parseVoronoiMapConfig,
} from '../../src/lib/ai/adapters/voronoi-map-adapter'

const entities: MapSpatialEntity[] = [
  { name: '西京', kind: 'settlement', scaleTier: 'metropolis', source: 'explicit', evidenceQuote: '西京' },
  { name: '东港', kind: 'settlement', scaleTier: 'city', source: 'explicit', evidenceQuote: '东港' },
  { name: '远山堡', kind: 'fortress', scaleTier: 'fortress', source: 'explicit', evidenceQuote: '远山堡' },
]

describe('WORLD-1 地图空间约束布局', () => {
  it('换算里程并公开旅行单位只是估算', () => {
    expect(distanceToKm(100, 'li')).toBe(50)
    expect(distanceToKm(2, 'day')).toBe(60)
    expect(distanceToKm(1, 'month')).toBe(900)

    const scale = resolveMapScale({
      width: 1000,
      height: 600,
      relations: [{
        from: '甲',
        to: '乙',
        distanceValue: 2,
        distanceUnit: 'day',
        source: 'explicit',
      }],
    })
    expect(scale.source).toBe('explicit-distance')
    expect(scale.travelEstimate).toBe(true)
    expect(scale.anchorCount).toBe(1)
  })

  it('比例尺遵守手动、地图宽度、显式距离、估算的优先级', () => {
    const base = {
      width: 1000,
      height: 600,
      relations: [{
        from: '甲',
        to: '乙',
        distanceValue: 300,
        distanceUnit: 'km' as const,
        source: 'explicit' as const,
      }],
    }
    expect(resolveMapScale({ ...base, kmPerPixel: 4, mapWidthKm: 2000 })).toMatchObject({
      kmPerPixel: 4,
      source: 'manual',
    })
    expect(resolveMapScale({ ...base, mapWidthKm: 2000 })).toMatchObject({
      kmPerPixel: 2,
      source: 'map-width',
    })
    expect(resolveMapScale(base).source).toBe('explicit-distance')
    expect(resolveMapScale({ width: 1000, height: 600 })).toMatchObject({
      kmPerPixel: 1,
      source: 'estimated',
    })
  })

  it('相同种子与关系可回放，东侧与远近会落实到坐标', () => {
    const relations: MapSpatialRelation[] = [
      {
        from: '东港',
        to: '西京',
        direction: 'east',
        distanceTier: 'near',
        source: 'explicit',
        evidenceQuote: '东港在西京以东',
      },
      {
        from: '远山堡',
        to: '西京',
        direction: 'north',
        distanceTier: 'far',
        source: 'explicit',
        evidenceQuote: '远山堡在西京以北很远',
      },
    ]
    const input = { width: 1000, height: 700, seed: 'layout-test', entities, relations }
    const first = solveSpatialLayout(input)
    const second = solveSpatialLayout(input)
    expect(second).toEqual(first)

    const byName = new Map(first.placements.map(placement => [placement.name, placement]))
    const west = byName.get('西京')!
    const east = byName.get('东港')!
    const farNorth = byName.get('远山堡')!
    expect(east.x).toBeGreaterThan(west.x)
    expect(farNorth.y).toBeLessThan(west.y)
    expect(Math.hypot(farNorth.x - west.x, farNorth.y - west.y))
      .toBeGreaterThan(Math.hypot(east.x - west.x, east.y - west.y))
  })

  it('互相矛盾的方位保留残差诊断', () => {
    const conflictingEntities: MapSpatialEntity[] = ['甲', '乙', '丙'].map(name => ({
      name,
      kind: 'landmark' as const,
      source: 'explicit' as const,
      evidenceQuote: name,
    }))
    const conflictingRelations: MapSpatialRelation[] = [
      { from: '甲', to: '乙', direction: 'east', distanceTier: 'far', source: 'explicit' },
      { from: '乙', to: '丙', direction: 'east', distanceTier: 'far', source: 'explicit' },
      { from: '丙', to: '甲', direction: 'east', distanceTier: 'far', source: 'explicit' },
    ]
    const result = solveSpatialLayout({
      width: 800,
      height: 500,
      seed: 'conflict-test',
      entities: conflictingEntities,
      relations: conflictingRelations,
    })
    expect(result.diagnostics.violations.length).toBeGreaterThan(0)
    expect(result.diagnostics.violations.some(item => item.severity === 'conflict')).toBe(true)
  })

  it('没有空间实体的当前配置返回空布局和估算比例尺', () => {
    const result = solveSpatialLayout({ width: 1200, height: 800, seed: 'empty-layout' })
    expect(result.placements).toEqual([])
    expect(result.diagnostics).toEqual({ iterations: 0, violations: [] })
    expect(result.scale.source).toBe('estimated')
  })

  it('AI explicit 事实必须有逐字证据，关系端点必须在实体闭集中', () => {
    const sourceText = '天南帝国以天南城为都。落雁镇在天南城西北百里。疆域东西横跨三千公里。'
    const payload = {
      seed: 'evidence-layout',
      mapName: '天南疆域',
      pointCount: 10_000,
      landRatio: 0.45,
      continentCount: 1,
      stateCount: 2,
      burgDensity: 0.5,
      temperatureShift: 0,
      precipitationFactor: 1,
      heightmapTemplate: 'continents',
      namingStyle: 'chinese',
      stateNames: ['天南帝国', '北境联盟'],
      burgNames: ['天南城', '落雁镇'],
      riverNames: [],
      spatialEntities: [
        {
          name: '天南帝国',
          kind: 'state',
          capitalName: '天南城',
          source: 'explicit',
          evidenceQuote: '天南帝国以天南城为都',
        },
        {
          name: '落雁镇',
          kind: 'settlement',
          scaleTier: 'town',
          source: 'explicit',
          evidenceQuote: '落雁镇在天南城西北百里',
        },
      ],
      spatialRelations: [
        {
          from: '落雁镇',
          to: '天南帝国',
          direction: 'north-west',
          distanceValue: 100,
          distanceUnit: 'li',
          source: 'explicit',
          evidenceQuote: '落雁镇在天南城西北百里',
        },
      ],
      mapWidthKm: 3000,
      mapWidthEvidenceQuote: '疆域东西横跨三千公里',
    }
    const config = parseVoronoiMapConfig(JSON.stringify(payload), sourceText)

    expect(config.spatialEntities).toHaveLength(2)
    expect(config.spatialEntities?.[0]).toMatchObject({
      name: '天南帝国',
      source: 'explicit',
      evidenceQuote: '天南帝国以天南城为都',
    })
    expect(config.spatialEntities?.[1]).toMatchObject({
      name: '落雁镇',
      source: 'explicit',
      evidenceQuote: '落雁镇在天南城西北百里',
    })
    expect(config.spatialRelations).toHaveLength(1)
    expect(config.spatialRelations?.[0]).toMatchObject({
      direction: 'north-west',
      distanceValue: 100,
      distanceUnit: 'li',
      source: 'explicit',
    })
    expect(config.mapWidthKm).toBe(3000)
    expect(() => parseVoronoiMapConfig(JSON.stringify({
      ...payload,
      spatialRelations: [...payload.spatialRelations, {
        from: '不存在的城',
        to: '天南帝国',
        direction: 'east',
        source: 'inferred',
      }],
    }), sourceText)).toThrow('空间关系端点必须是两个不同的登记实体')
    expect(() => parseVoronoiMapConfig(JSON.stringify({
      ...payload,
      spatialEntities: payload.spatialEntities.map(entity => entity.name === '落雁镇'
        ? { ...entity, evidenceQuote: '用户并没有写这一句' }
        : entity),
    }), sourceText)).toThrow('explicit 证据不是登记来源逐字引文')
  })

  it('地图 prompt 明确要求空间关系、闭集和证据边界', () => {
    const prompt = buildVoronoiMapPrompt(
      { regionDimensions: '落雁镇在天南城西北百里' },
      '',
      [],
    ).map(message => message.content).join('\n')
    expect(prompt).toContain('spatialEntities')
    expect(prompt).toContain('spatialRelations')
    expect(prompt).toContain('逐字搜索')
    expect(prompt).toContain('关系两端必须先出现在 spatialEntities')
    expect(prompt).toContain('不要输出 x/y')
  })

  it('约束坐标会落实到真实陆地首都，国家规模进入扩张模型', () => {
    const data = generateMap({
      width: 700,
      height: 450,
      pointCount: 1800,
      seed: 'spatial-engine-integration',
      stateCount: 2,
      burgDensity: 0.15,
      landRatio: 0.68,
      heightmapTemplate: 'pangea',
      generateProvinces: false,
      generateRoads: false,
      spatialEntities: [
        {
          name: '西陆帝国',
          kind: 'state',
          scaleTier: 'empire',
          capitalName: '西京',
          source: 'explicit',
          evidenceQuote: '西陆帝国',
        },
        {
          name: '东海王国',
          kind: 'state',
          scaleTier: 'kingdom',
          capitalName: '东港',
          source: 'explicit',
          evidenceQuote: '东海王国',
        },
        {
          name: '西京',
          kind: 'settlement',
          scaleTier: 'metropolis',
          source: 'explicit',
          evidenceQuote: '西京',
        },
        {
          name: '东港',
          kind: 'settlement',
          scaleTier: 'city',
          source: 'explicit',
          evidenceQuote: '东港',
        },
        {
          name: '北境堡',
          kind: 'fortress',
          scaleTier: 'fortress',
          source: 'explicit',
          evidenceQuote: '北境堡',
        },
      ],
      spatialRelations: [
        {
          from: '东海王国',
          to: '西陆帝国',
          direction: 'east',
          distanceTier: 'far',
          source: 'explicit',
        },
        {
          from: '北境堡',
          to: '西陆帝国',
          direction: 'north',
          distanceTier: 'near',
          source: 'explicit',
        },
      ],
    })

    const westState = data.states.find(state => state.name === '西陆帝国')!
    const eastState = data.states.find(state => state.name === '东海王国')!
    const westCapital = data.burgs[westState.capital]
    const eastCapital = data.burgs[eastState.capital]
    const fortress = data.burgs.find(burg => burg.name === '北境堡')!
    expect(westCapital.name).toBe('西京')
    expect(eastCapital.name).toBe('东港')
    expect(data.cells.h[westCapital.cell]).toBeGreaterThanOrEqual(20)
    expect(data.cells.h[eastCapital.cell]).toBeGreaterThanOrEqual(20)
    expect(data.cells.h[fortress.cell]).toBeGreaterThanOrEqual(20)
    expect(eastCapital.x).toBeGreaterThan(westCapital.x)
    expect(fortress.y).toBeLessThan(westCapital.y)
    expect(westState.scaleTier).toBe('empire')
    expect(eastState.scaleTier).toBe('kingdom')
    expect(westState.expansionism).toBeGreaterThan(eastState.expansionism * 0.65)
    expect(data.spatialPlacements?.find(item => item.name === '西陆帝国')).toMatchObject({
      x: westCapital.x,
      y: westCapital.y,
    })
    expect(data.spatialPlacements?.find(item => item.name === '西京')).toMatchObject({
      x: westCapital.x,
      y: westCapital.y,
    })
  })
})
