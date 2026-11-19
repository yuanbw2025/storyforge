import { describe, expect, it } from 'vitest'
import { resolveAtlasStyle } from '../../src/lib/world-map/atlas/view-style'

describe('地图画风与插画素材分开，旧链接和偏好仍可用', () => {
  it('首次查看或失效的偏好进入简笔，原有中式素材偏好不会丢失', () => {
    expect(resolveAtlasStyle(null)).toEqual({ style: 'sketch', symbols: 'watercolor' })
    expect(resolveAtlasStyle('unknown', 'ink')).toEqual({ style: 'sketch', symbols: 'ink' })
  })
  it('兼容原水彩和水墨选项，均进入绘本并保留对应素材', () => {
    expect(resolveAtlasStyle('watercolor')).toEqual({ style: 'illustrated', symbols: 'watercolor' })
    expect(resolveAtlasStyle('watercolor', 'ink')).toEqual({ style: 'illustrated', symbols: 'watercolor' })
    expect(resolveAtlasStyle('ink')).toEqual({ style: 'illustrated', symbols: 'ink' })
    expect(resolveAtlasStyle('illustrated', 'ink')).toEqual({ style: 'illustrated', symbols: 'ink' })
  })
  it('新画风往返保留独立素材选择', () => {
    for (const style of ['sketch', 'illustrated', 'painted']) {
      expect(resolveAtlasStyle(style, 'ink')).toEqual({ style, symbols: 'ink' })
      expect(resolveAtlasStyle(style, 'invalid').symbols).toBe('watercolor')
    }
  })
})
