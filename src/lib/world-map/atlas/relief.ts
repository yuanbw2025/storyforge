import type { AtlasGeometry } from './geometry'
import { seedRandom } from '../engine/random'

// A small continuous height field avoids cell outlines. Draughting marks are
// applied above this wash so rivers and settlements remain independently readable.
export function terrainWash(g: AtlasGeometry, seed: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const ratio = Math.min(1.4, 1700 / g.width, 1200 / g.height)
  canvas.width = Math.ceil(g.width * ratio)
  canvas.height = Math.ceil(g.height * ratio)
  const w = canvas.width,
    h = canvas.height,
    c = canvas.getContext('2d')!
  const rng = seedRandom(seed + '-relief')
  const lattice = Float32Array.from({ length: 128 * 128 }, () => rng())
  const noise = (x: number, y: number) => {
    const a = Math.floor(x),
      b = Math.floor(y)
    let u = x - a,
      v = y - b
    u = u * u * (3 - 2 * u)
    v = v * v * (3 - 2 * v)
    const i = (b & 127) * 128 + (a & 127),
      j = ((b + 1) & 127) * 128 + (a & 127),
      next = (a + 1) & 127
    const p = lattice[i] * (1 - u) + lattice[(b & 127) * 128 + next] * u
    return p * (1 - v) + (lattice[j] * (1 - u) + lattice[((b + 1) & 127) * 128 + next] * u) * v
  }
  const ridges = new Float32Array(w * h)
  for (const f of g.features)
    if (f.kind === 'ridge') {
      const radius = Math.ceil(27 * ratio)
      for (let n = 0; n < f.points.length; n++) {
        const [x, y] = f.points[n],
          [u, v] = f.points[n + 1] ?? f.points[n]
        const count = Math.max(1, Math.ceil(Math.hypot(u - x, v - y) / 9))
        for (let s = 0; s < count; s++) {
          const cx = Math.round((x + ((u - x) * s) / count) * ratio),
            cy = Math.round((y + ((v - y) * s) / count) * ratio)
          for (let j = Math.max(0, cy - radius); j <= Math.min(h - 1, cy + radius); j++)
            for (let i = Math.max(0, cx - radius); i <= Math.min(w - 1, cx + radius); i++) {
              const fall = Math.max(0, 1 - ((i - cx) ** 2 + (j - cy) ** 2) / (radius * radius))
              ridges[j * w + i] = Math.max(ridges[j * w + i], fall * fall)
            }
        }
      }
    }
  const field = new Float32Array(w * h),
    paper = c.createImageData(w, h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = i / ratio,
        y = j / ratio,
        k = j * w + i
      const warp = noise(x * 0.018, y * 0.018) * 9
      const broad = noise(x * 0.023 + warp * 0.16, y * 0.028)
      const veins = 1 - Math.abs(2 * noise((x + warp) * 0.085, (y - warp) * 0.064) - 1)
      field[k] =
        (broad * 9 + veins * 2.4 + noise(x * 0.24, y * 0.21) * 1.3) * (1 + ridges[k] * 3.9) + ridges[k] * 13
    }
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = j * w + i,
        y = j / h,
        x = i / ratio,
        yy = j / ratio
      const shade =
        (field[k] - field[j * w + Math.max(i - 1, 0)] + field[k] - field[Math.max(j - 1, 0) * w + i]) *
        ratio *
        4.8
      const biome = noise(x * 0.012 + 17, yy * 0.014) * 0.65 + noise(x * 0.047, yy * 0.043) * 0.35
      const grain = (rng() - 0.5) * 7,
        slope = Math.min(24, Math.max(-39, shade))
      const north = Math.max(0, (0.36 - y) / 0.36),
        arid = Math.max(0, (y - 0.48) * 2.3)
      const z = ridges[k],
        fertile = biome - 0.5
      paper.data.set(
        [
          202 + arid * 21 + north * 18 - fertile * 49 + z * 9 + slope + grain,
          202 - arid * 13 + north * 22 - fertile * 9 - z * 1 + slope + grain,
          157 - arid * 27 + north * 66 - fertile * 30 + z * 10 + slope + grain,
          255,
        ],
        k * 4,
      )
    }
  c.putImageData(paper, 0, 0)
  return canvas
}
