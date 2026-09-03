import { describe, expect, it } from 'vitest'
import { matteEdgeConnectedCharacterBackdropV1 } from '../../src/lib/product-production/character-alpha-matting'

function checkerboard(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 204 : 255
    const offset = (y * width + x) * 4
    data.set([value, value, value, 255], offset)
  }
  return data
}

describe('R-PRODUCTPROD-1F · character alpha matting', () => {
  it('只移除与画布边缘连通的棋盘格，保留主体内部的白色区域', () => {
    const width = 12; const height = 12; const data = checkerboard(width, height)
    for (let y = 3; y <= 10; y += 1) for (let x = 3; x <= 8; x += 1) {
      const offset = (y * width + x) * 4
      data.set(x >= 5 && x <= 6 && y >= 5 && y <= 7
        ? [255, 255, 255, 255]
        : [30, 60, 120, 255], offset)
    }
    const result = matteEdgeConnectedCharacterBackdropV1({ width, height, data })
    expect(result.alreadyTransparent).toBe(false)
    expect(result.removedPixelRatio).toBeGreaterThan(0.4)
    expect(result.data[3]).toBe(0)
    expect(result.data[((6 * width + 5) * 4) + 3]).toBe(255)
    expect(result.data[((10 * width + 5) * 4) + 3]).toBe(255)
  })

  it('移除不与边缘连通的细网格残片，同时保留大块角色主体', () => {
    const width = 20; const height = 20; const data = checkerboard(width, height)
    for (let y = 4; y <= 18; y += 1) for (let x = 6; x <= 13; x += 1) {
      data.set([30, 60, 120, 255], (y * width + x) * 4)
    }
    for (let x = 1; x <= 4; x += 1) data.set([235, 210, 230, 255], (10 * width + x) * 4)
    const result = matteEdgeConnectedCharacterBackdropV1({ width, height, data })
    expect(result.data[((10 * width + 2) * 4) + 3]).toBe(0)
    expect(result.data[((10 * width + 9) * 4) + 3]).toBe(255)
  })

  it('已有真实 alpha 时保持原像素，不重复抠图', () => {
    const data = checkerboard(8, 8)
    data[3] = 0
    const result = matteEdgeConnectedCharacterBackdropV1({ width: 8, height: 8, data })
    expect(result.alreadyTransparent).toBe(true)
    expect(result.data).toEqual(data)
  })
})
