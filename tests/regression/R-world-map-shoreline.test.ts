import { describe, expect, it } from 'vitest'
import { atlasShorelinePoints } from '../../src/lib/world-map/atlas/shoreline'
import type { Point } from '../../src/lib/world-map/atlas/geometry'

describe('相邻陆块共享同一条海岸扰动边', () => {
  it('两块陆地反向共享的边没有不同随机偏移产生的细碎水缝', () => {
    const a: Point[] = [[20, 20], [300, 20], [300, 380], [20, 380]]
    const b: Point[] = [[300, 20], [580, 20], [580, 380], [300, 380]]
    const shared = (ring: Point[]) => ring.filter(([x, y]) => x > 295 && x < 305 && y > 25 && y < 375)
    expect(shared(atlasShorelinePoints(a, 'fixed'))).toEqual(shared(atlasShorelinePoints(b, 'fixed')).reverse())
  })
  it('保留输入顶点，固定种子可复现，轮廓方向和起点不改变同一条边', () => {
    const ring: Point[] = [[20, 20], [580, 20], [580, 380], [20, 380]]
    const result = atlasShorelinePoints(ring, 'fixed')
    expect(result).toEqual(atlasShorelinePoints(ring, 'fixed'))
    expect(result).not.toEqual(atlasShorelinePoints(ring, 'other'))
    for (const point of ring) expect(result).toContainEqual(point)
    const sorted = (points: Point[]) => points.map(p => JSON.stringify(p)).sort()
    expect(sorted(result)).toEqual(sorted(atlasShorelinePoints([...ring].reverse(), 'fixed')))
    expect(sorted(result)).toEqual(sorted(atlasShorelinePoints([...ring.slice(1), ring[0]], 'fixed')))
    expect(atlasShorelinePoints([[20, 20], [20, 20], [30, 40]], 'fixed').every(p => p.every(Number.isFinite))).toBe(true)
  })
})
