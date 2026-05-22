/**
 * Perlin Noise 生成器
 * 用于海岸线锯齿化和地形纹理
 */

/** 简单的 2D Perlin Noise 实现 */
export class PerlinNoise {
  private perm: number[]

  constructor(seed = 42) {
    // 生成排列表
    const p: number[] = []
    for (let i = 0; i < 256; i++) p[i] = i
    // Fisher-Yates shuffle with seed
    let s = seed
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647
      const j = s % (i + 1)
      ;[p[i], p[j]] = [p[j], p[i]]
    }
    this.perm = [...p, ...p] // 双倍避免溢出
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10)
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a)
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3
    const u = h < 2 ? x : y
    const v = h < 2 ? y : x
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }

  /** 获取 2D 噪声值 [-1, 1] */
  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = this.fade(xf)
    const v = this.fade(yf)

    const aa = this.perm[this.perm[X] + Y]
    const ab = this.perm[this.perm[X] + Y + 1]
    const ba = this.perm[this.perm[X + 1] + Y]
    const bb = this.perm[this.perm[X + 1] + Y + 1]

    return this.lerp(
      this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u),
      this.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u),
      v,
    )
  }

  /** 分形噪声（多倍频叠加），amplitude 控制总偏移量 */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let value = 0
    let amplitude = 1
    let frequency = 1
    let maxValue = 0
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency)
      maxValue += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }
    return value / maxValue
  }
}

import type { Point2D } from '../types/world-map'

/**
 * 对多边形边缘施加 Perlin Noise 扰动
 * @param polygon 原始多边形顶点
 * @param amplitude 扰动幅度（像素）
 * @param subdivisions 每两个顶点之间插入多少个点
 * @param seed 随机种子
 * @returns 扰动后的多边形（更多点，更自然的边缘）
 */
export function perturbPolygon(
  polygon: Point2D[],
  amplitude = 10,
  subdivisions = 6,
  seed = 42,
): Point2D[] {
  if (polygon.length < 3) return polygon

  const perlin = new PerlinNoise(seed)
  const result: Point2D[] = []
  const n = polygon.length

  for (let i = 0; i < n; i++) {
    const [x0, y0] = polygon[i]
    const [x1, y1] = polygon[(i + 1) % n]

    for (let j = 0; j < subdivisions; j++) {
      const t = j / subdivisions
      const x = x0 + (x1 - x0) * t
      const y = y0 + (y1 - y0) * t

      // 法线方向（垂直于线段）
      const dx = x1 - x0
      const dy = y1 - y0
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const nx = -dy / len
      const ny = dx / len

      // Perlin Noise 扰动
      const noiseVal = perlin.fbm(x * 0.02, y * 0.02, 3)
      const offset = noiseVal * amplitude

      result.push([x + nx * offset, y + ny * offset])
    }
  }

  return result
}

/**
 * 种子随机数生成器
 */
export function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}
