import { describe, expect, it } from 'vitest'
import { parseAtlasReference } from '../../src/lib/world-map/atlas/geometry'
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
