import { describe, expect, it } from 'vitest'
import { generateMap } from '../../src/lib/world-map/engine'
import { geometryFromMap, parseAtlasReference } from '../../src/lib/world-map/atlas/geometry'
import { atlasDraftPrompt, parseAtlasDraft } from '../../src/lib/world-map/atlas/draft'
import { inspectCityPlacement } from '../../src/lib/world-map/atlas/inspect'

const rows = [
  ['land', '大陆', 0, '10,10 110,10 90,180'],
  ['city', '北城', 1, '75,45'],
  ['river', '清江', 1, '15,60 30,90'],
]
describe('实验图集的候选与作者参考布局', () => {
  it('从已有设定制图时不新增专名聚落，推定山水保留几何但不冒充已登记地名', () => {
    const config = parseAtlasDraft(JSON.stringify({ mapName: '原作', features: [
      ...rows, ['city', '模型杜撰城', 0, '90,90'], ['ridge', '模型杜撰山', 0, '30,30 50,50'],
    ] }), '北城在大陆之上', { existingNamesOnly: true })
    expect(config.burgNames).toEqual(['北城'])
    expect(config.atlasDraft?.features.some(f => f.name === '模型杜撰城')).toBe(false)
    expect(config.atlasDraft?.features.find(f => f.kind === 'ridge')?.name).toBe('')
    expect(config.atlasDraft?.features.find(f => f.kind === 'river')?.name).toBe('')
    expect(config.spatialEntities?.some(e => e.name === '模型杜撰山')).toBe(false)
  })
  it('允许真实水面多边形，并核对陆地内落入湖面的城市', () => {
    const config = parseAtlasDraft(JSON.stringify({ mapName: '湖区', features: [
      ['land', '大陆', 0, '0,0 600,0 600,600 0,600'],
      ['water', '湖泊', 0, '100,100 300,100 300,300 100,300'],
      ['city', '岸边城', 0, '90,200'],
      ['city', '误落水中', 0, '200,200'],
      ['land', '湖心岛', 0, '220,220 260,220 260,260 220,260'],
      ['city', '岛上城', 0, '240,240'],
    ] }), '湖泊旁有岸边城')
    expect(config.atlasDraft?.features.find(f => f.kind === 'water')?.points).toHaveLength(4)
    expect(inspectCityPlacement(config.atlasDraft!)).toEqual(['误落水中'])
    expect(() => parseAtlasDraft(JSON.stringify({ mapName: '坏水面', features: [
      ['land', '', 0, '0,0 600,0 600,600'], ['water', '', 0, '100,100 200,200'],
    ] }), '')).toThrow()
  })
  it('分隔诸天空间，并区分空间通路、天然天壑和非城镇地点', () => {
    const cfg = parseAtlasDraft(
      JSON.stringify({
        mapName: '九天',
        features: [
          ['realm', '红尘天', 0, '20,20 490,20 490,320 20,320'],
          ['realm', '清虚天', 0, '650,20 1100,20 1100,320 650,320'],
          ['city', '如意城', 0, '200,100'],
          ['landmark', '碧落赋', 0, '800,100'],
          ['passage', '月圆通行', 1, '490,150 650,150'],
          ['rift', '天壑', 0, '565,20 565,320'],
        ],
      }),
      '红尘天有如意城，清虚天有碧落赋。天壑月圆通行。',
    )
    expect(cfg.atlasDraft?.features.filter((f) => f.kind === 'realm')).toHaveLength(2)
    expect(cfg.atlasDraft?.features.some((f) => f.kind === 'land')).toBe(false)
    expect(cfg.burgNames).toEqual(['如意城'])
    expect(cfg.spatialEntities?.find((f) => f.name === '碧落赋')?.kind).toBe('landmark')
    expect(inspectCityPlacement(cfg.atlasDraft!)).toEqual([])
    const shifted = structuredClone(cfg.atlasDraft!)
    shifted.features.find((f) => f.name === '如意城')!.points = [[560, 150]]
    expect(inspectCityPlacement(shifted)).toEqual(['如意城'])
    expect(atlasDraftPrompt('', '九天')[0].content).toContain('不能把诸天假画成同一海洋里的岛屿')
    expect(() =>
      parseAtlasDraft(
        JSON.stringify({
          mapName: '九天',
          features: [['realm', '红尘天', 0, '20,20 490,20']],
        }),
        '',
      ),
    ).toThrow()
  })
  it('只将资料中逐字出现的名称标记为有据；全部制图坐标仍为候选', () => {
    const cfg = parseAtlasDraft(JSON.stringify({ mapName: '域', features: rows }), '北城位于山脚')
    expect(cfg.atlasDraft?.features[1].points).toEqual([[75, 45]])
    expect(cfg.spatialEntities?.find((f) => f.name === '北城')).toMatchObject({
      source: 'explicit',
      evidenceQuote: '北城',
    })
    expect(cfg.spatialEntities?.find((f) => f.name === '清江')).toMatchObject({
      source: 'inferred',
    })
    expect(cfg.atlasReference).toBeUndefined()
    expect(atlasDraftPrompt('登记内容', '域')[1].content).toContain('登记内容')
  })
  it('区分关隘与城镇，并保留旧配置的海路、边界和未对应聚落的要塞', () => {
    const draft = parseAtlasDraft(
      JSON.stringify({
        mapName: '山地',
        features: [...rows, ['fortress', '山门', 0, '70,50']],
      }),
      '山门是要塞',
    )
    expect(draft.spatialEntities?.find((entity) => entity.name === '山门')?.kind).toBe('fortress')
    expect(draft.burgNames).toContain('山门')
    const map = generateMap({
      seed: 'filter-boundary-proof',
      width: 500,
      height: 320,
      pointCount: 500,
      stateCount: 4,
    })
    map.roads.push({
      i: 999,
      name: '渡海航线',
      type: 'sea',
      cells: [],
      points: [
        [2, 3],
        [8, 10],
      ],
    })
    map.spatialPlacements = [
      ...(map.spatialPlacements ?? []),
      { name: '孤关', kind: 'fortress', x: 75, y: 80 },
    ]
    const before = Array.from(map.cells.state)
    const geometry = geometryFromMap(map)
    expect(geometry.features).toContainEqual({
      kind: 'seaRoute',
      name: '渡海航线',
      points: [
        [2, 3],
        [8, 10],
      ],
      rank: 2,
    })
    expect(geometry.features.find((feature) => feature.name === '孤关')?.kind).toBe('fortress')
    expect(geometry.features.some((feature) => feature.kind === 'border')).toBe(true)
    expect(geometry.features.some((feature) => feature.kind === 'province')).toBe(true)
    expect(Array.from(map.cells.state)).toEqual(before)
  })
  it('拒绝坏坐标、缺失陆地、多点城市以及模型伪装的作者布局', () => {
    const pack = (features: unknown) => JSON.stringify({ mapName: '域', features })
    expect(() => parseAtlasDraft(pack([['land', '大陆', 0, '0,0 9e9,3 1,2']]), '')).toThrow()
    expect(() => parseAtlasDraft(pack(rows.slice(1)), '')).toThrow()
    expect(() => parseAtlasDraft(pack([...rows, ['city', '北城', 0, '1,1 2,2']]), '')).toThrow()
    expect(() =>
      parseAtlasDraft(JSON.stringify({ mapName: '域', features: rows, atlasReference: {} }), ''),
    ).toThrow()
    expect(() =>
      parseAtlasReference({
        version: 1,
        width: 40000,
        height: 40000,
        features: [],
      }),
    ).toThrow()
  })
})
