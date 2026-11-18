import { describe, expect, it } from 'vitest'
import { generateMap } from '../../src/lib/world-map/engine'
import { geometryFromMap, parseAtlasReference } from '../../src/lib/world-map/atlas/geometry'
import { atlasDraftPrompt, parseAtlasDraft } from '../../src/lib/world-map/atlas/draft'

const rows = [
  ['land', '大陆', 0, '10,10 110,10 90,180'],
  ['city', '北城', 1, '75,45'],
  ['river', '清江', 1, '15,60 30,90'],
]
describe('实验图集的候选与作者参考布局', () => {
  it('只将资料中逐字出现的名称标记为有据；全部制图坐标仍为候选', () => {
    const cfg = parseAtlasDraft(JSON.stringify({ mapName: '域', features: rows }), '北城位于山脚')
    expect(cfg.atlasDraft?.features[1].points).toEqual([[75, 45]])
    expect(cfg.spatialEntities?.find((f) => f.name === '北城')).toMatchObject({
      source: 'explicit',
      evidenceQuote: '北城',
    })
    expect(cfg.spatialEntities?.find((f) => f.name === '清江')).toMatchObject({ source: 'inferred' })
    expect(cfg.atlasReference).toBeUndefined()
    expect(atlasDraftPrompt('登记内容', '域')[1].content).toContain('登记内容')
  })
  it('区分关隘与城镇，并保留旧配置的海路、边界和未对应聚落的要塞', () => {
    const draft = parseAtlasDraft(
      JSON.stringify({ mapName: '山地', features: [...rows, ['fortress', '山门', 0, '70,50']] }),
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
    expect(() => parseAtlasReference({ version: 1, width: 40000, height: 40000, features: [] })).toThrow()
  })
})
