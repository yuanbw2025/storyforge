import type { AtlasFeature, AtlasGeometry } from './geometry'
import type { AtlasLayers } from './layers'
import { along, line } from './paths'
import { seedRandom } from '../engine/random'

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n))

/** An illustrative surface, not measured elevation. Only registered ridges/biomes
 * contribute landforms; seed noise supplies material and small-scale relief. */
export function continuousTerrain(g: AtlasGeometry, seed: string, layers: AtlasLayers) {
  const ratio = Math.min(1.5, 1800 / g.width, 1200 / g.height)
  const w = Math.ceil(g.width * ratio), h = Math.ceil(g.height * ratio), n = w * h
  const ridge = new Float32Array(n), cold = new Float32Array(n), wood = new Float32Array(n)
  const desert = new Float32Array(n), wet = new Float32Array(n), valley = new Float32Array(n)
  const rng = seedRandom(seed + '-continuous-material')
  const lattice = Float32Array.from({ length: 256 * 256 }, () => rng())
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y)
    let u = x - ix, v = y - iy
    u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v)
    return (lattice[(ix & 255) + (iy & 255) * 256] * (1 - u) + lattice[((ix + 1) & 255) + (iy & 255) * 256] * u) * (1 - v)
      + (lattice[(ix & 255) + ((iy + 1) & 255) * 256] * (1 - u) + lattice[((ix + 1) & 255) + ((iy + 1) & 255) * 256] * u) * v
  }
  const splat = (field: Float32Array, x: number, y: number, radius: number, amplitude = 1) => {
    x *= ratio; y *= ratio; radius *= ratio
    for (let j = Math.max(0, Math.floor(y - radius)); j <= Math.min(h - 1, y + radius); j++) {
      for (let i = Math.max(0, Math.floor(x - radius)); i <= Math.min(w - 1, x + radius); i++) {
        const d = ((i - x) ** 2 + (j - y) ** 2) / (radius * radius)
        if (d < 1) field[j * w + i] = Math.max(field[j * w + i], (1 - d) ** 2 * amplitude)
      }
    }
  }
  const patch = (f: AtlasFeature, field: Float32Array, radius: number) => {
    const xs = f.points.map(p => p[0]), ys = f.points.map(p => p[1])
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
    if (f.points.length >= 5 && right - left > 22 && bottom - top > 20) {
      const mask = document.createElement('canvas'); mask.width = w; mask.height = h
      const c = mask.getContext('2d')!; c.scale(ratio, ratio); c.fillStyle = '#fff'; c.fill(line(f.points, true))
      const pixels = c.getImageData(0, 0, w, h).data
      for (let i = 0; i < n; i++) field[i] = Math.max(field[i], pixels[i * 4 + 3] / 255)
    } else along(f.points, radius * 0.36, (x, y) => splat(field, x, y, radius))
  }
  for (const f of g.features) {
    if (f.kind === 'ridge' && layers.mountains) {
      const r = seedRandom(seed + f.name + '-ridge')
      along(f.points, 5, (x, y) => {
        const radius = 22 + r() * 13, amplitude = 0.72 + r() * 0.28
        splat(ridge, x, y, radius, amplitude)
        if (/雪|霜|冰|寒/.test(f.name)) splat(cold, x, y, radius, amplitude)
      })
    } else if (f.kind === 'wood' && layers.forests) patch(f, wood, 22)
    else if (f.kind === 'desert' && layers.terrain) patch(f, desert, 30)
    else if (f.kind === 'marsh' && layers.terrain) patch(f, wet, 22)
    else if (f.kind === 'river') along(f.points, 7, (x, y) => splat(valley, x, y, 8))
  }
  const field = new Float32Array(n), canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const c = canvas.getContext('2d')!, pixels = c.createImageData(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, u = x / ratio, v = y / ratio
    const warp = noise(u * 0.025, v * 0.025) * 7
    const folds = 1 - Math.abs(noise((u + warp) * 0.13, (v - warp) * 0.1) * 2 - 1)
    field[k] = (layers.terrain ? noise(u * 0.027, v * 0.027) * 2.5 : 0)
      + ridge[k] * (7 + 12 * folds ** 2 + 4 * noise(u * 0.35, v * 0.35)) * (1 - valley[k] * 0.82)
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, u = x / ratio, v = y / ratio
    const fertility = clamp((noise(u * 0.008 + 11, v * 0.008) * 0.65 + noise(u * 0.032, v * 0.032) * 0.35 - 0.25) * 2)
    let red = layers.terrain ? 204 - fertility * 87 : 224
    let green = layers.terrain ? 177 - fertility * 32 : 215
    let blue = layers.terrain ? 108 - fertility * 25 : 179
    let t = desert[k] * 0.85
    red += (185 - red) * t; green += (132 - green) * t; blue += (67 - blue) * t
    t = wet[k] * 0.8
    red += (83 - red) * t; green += (120 - green) * t; blue += (94 - blue) * t
    t = wood[k] * 0.72
    red += (78 - red) * t; green += (105 - green) * t; blue += (67 - blue) * t
    t = clamp(ridge[k] * 1.8 - 0.35)
    red += (125 - red) * t; green += (127 - green) * t; blue += (115 - blue) * t
    t = clamp(cold[k] * 1.5 - 0.32)
    red += (227 - red) * t; green += (233 - green) * t; blue += (218 - blue) * t
    const dx = (field[y * w + Math.min(w - 1, x + 1)] - field[y * w + Math.max(0, x - 1)]) * ratio
    const dy = (field[Math.min(h - 1, y + 1) * w + x] - field[Math.max(0, y - 1) * w + x]) * ratio
    const normal = Math.sqrt(dx * dx + dy * dy + 3.5)
    const light = (-dx * 0.62 - dy * 0.54 + 1.4) / normal
    const shade = clamp(light * 0.46 + 0.62, 0.6, 1.26)
    const grain = (noise(u * 1.2, v * 1.2) - 0.5) * 7
    pixels.data[k * 4] = clamp(red * shade + grain, 0, 255)
    pixels.data[k * 4 + 1] = clamp(green * shade + grain, 0, 255)
    pixels.data[k * 4 + 2] = clamp(blue * shade + grain, 0, 255)
    pixels.data[k * 4 + 3] = 255
  }
  c.putImageData(pixels, 0, 0)
  c.scale(ratio, ratio)
  if (layers.mountains) {
    const peaks: {x: number; y: number; height: number; tilt: number; snow: boolean}[] = []
    for (const f of g.features) if (f.kind === 'ridge') {
      const r = seedRandom(seed + f.name + '-crest')
      along(f.points, 10, (x, y) => {
        for (let row = 0; row < 2; row++) peaks.push({x: x + (row ? 5 : -4) + r() * 4,
          y: y + (row ? 4 : -4) + r() * 4, height: (/丘陵|高地/.test(f.name) ? 5 : 8) + r() * 7,
          tilt: (r() - 0.5) * 3, snow: /雪|霜|冰|寒/.test(f.name)})
      })
    }
    peaks.sort((a, b) => a.y - b.y)
    for (const {x, y, height: ph, tilt, snow} of peaks) {
      const pw = ph * 0.8, tip = x + tilt
      const outline = line([[x - pw, y], [x - pw * 0.48, y - ph * 0.5], [tip, y - ph],
        [x + pw * 0.52, y - ph * 0.46], [x + pw, y], [x, y - 0.5]], true)
      const fill = c.createLinearGradient(x - pw, y - ph, x + pw * 0.5, y)
      fill.addColorStop(0, snow ? '#f1f3dd' : '#dfcda1'); fill.addColorStop(0.55, snow ? '#b9c5ba' : '#b0a27e')
      fill.addColorStop(1, '#849269')
      c.fillStyle = fill; c.fill(outline)
      c.fillStyle = snow ? '#82928d' : '#7a8069'
      c.fill(line([[tip, y - ph], [tip - pw * 0.1, y - ph * 0.6], [x + pw * 0.16, y - ph * 0.32],
        [x, y - 0.5], [x + pw, y], [x + pw * 0.52, y - ph * 0.46]], true))
      c.strokeStyle = '#5b604c8a'; c.lineWidth = 0.35; c.stroke(outline)
      for (let i = 1; i < 5; i++) {
        const t = i / 6
        c.strokeStyle = '#e0d4ad88'; c.lineWidth = 0.25
        c.stroke(line([[tip + pw * t * 0.6, y - ph + ph * t], [x + pw * (t + 0.15), y - ph * (1 - t) * 0.36]]))
      }
    }
  }
  if (layers.forests) {
    const trees = seedRandom(seed + '-canopy')
    for (let y = 2; y < g.height; y += 5) for (let x = 2; x < g.width; x += 5) {
      const u = x + trees() * 4, v = y + trees() * 4
      const k = Math.min(h - 1, Math.floor(v * ratio)) * w + Math.min(w - 1, Math.floor(u * ratio))
      if (trees() > wood[k] * 0.92 || ridge[k] > 0.74) continue
      const height = 3 + trees() * 4, width = height * 0.6
      c.fillStyle = '#293f3340'; c.beginPath(); c.ellipse(u + 1.5, v + 1, width, width * 0.4, -0.3, 0, Math.PI * 2); c.fill()
      const fill = c.createLinearGradient(u - width, v - height, u + width, v)
      fill.addColorStop(0, '#8b9f55'); fill.addColorStop(0.4, '#567a42'); fill.addColorStop(1, '#2e5139')
      c.fillStyle = fill
      if (trees() < 0.65) c.fill(line([[u, v - height], [u - width, v], [u, v - 0.6], [u + width, v]], true))
      else { c.beginPath(); c.ellipse(u, v - height * 0.45, width * 0.9, height * 0.6, 0, 0, Math.PI * 2); c.fill() }
    }
  }
  return canvas
}
