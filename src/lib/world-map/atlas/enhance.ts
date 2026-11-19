import { drawTerrain } from './paint'
import { along, atlasSurfacePaths, line, watercourse } from './paths'
import type { AtlasGeometry } from './geometry'
import type { AtlasLayers } from './layers'
import type { AtlasViewStyle } from './view-style'

type Material = 'ridge' | 'wood' | 'desert' | 'marsh'
const masks = new WeakMap<AtlasGeometry, Map<string, HTMLCanvasElement>>()
/** The same authored footprints constrain every provider. A model cannot expand a
 * wood into neighbouring grassland by painting trees outside the wood mask. */
export function atlasMaterialMask(g: AtlasGeometry, seed: string, kind: Material) {
  let entries = masks.get(g)
  if (!entries) { entries = new Map(); masks.set(g, entries) }
  const key = seed + kind
  if (entries.has(key)) return entries.get(key)!
  const ratio = Math.min(1.5, 1600 / g.width, 1000 / g.height)
  const mask = document.createElement('canvas'); mask.width = Math.ceil(g.width * ratio); mask.height = Math.ceil(g.height * ratio)
  const c = mask.getContext('2d')!; c.scale(ratio, ratio)
  const { land, outsideWaters, fillRule } = atlasSurfacePaths(g, seed, true)
  c.clip(land, fillRule); for (const outside of outsideWaters) c.clip(outside, 'nonzero')
  c.fillStyle = '#fff'
  for (const f of g.features) if (f.kind === kind) {
    const xs = f.points.map(p => p[0]), ys = f.points.map(p => p[1])
    if (kind !== 'ridge' && f.points.length >= 5 && Math.max(...xs) - Math.min(...xs) > 22 && Math.max(...ys) - Math.min(...ys) > 20) {
      c.fill(line(f.points, true))
    } else {
      const radius = kind === 'ridge' ? 30 : kind === 'wood' ? 22 : 30
      along(f.points, 7, (x, y) => { c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill() })
    }
  }
  // Fade towards the inside of the footprint; never blur model pixels beyond it.
  const pixels = c.getImageData(0, 0, mask.width, mask.height), distance = new Float32Array(mask.width * mask.height)
  const w = mask.width, h = mask.height
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, alpha = pixels.data[i * 4 + 3]
    distance[i] = alpha < 255 ? alpha / 255 : Math.min(x + 1, y + 1, w - x, h - y, 1000)
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1)
    if (y) distance[i] = Math.min(distance[i], distance[i - w] + 1)
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x
    if (x < w - 1) distance[i] = Math.min(distance[i], distance[i + 1] + 1)
    if (y < h - 1) distance[i] = Math.min(distance[i], distance[i + w] + 1)
    pixels.data[i * 4 + 3] *= Math.min(1, distance[i] / 4)
  }
  c.putImageData(pixels, 0, 0)
  entries.set(key, mask)
  return mask
}

/** Raw image material is used only inside declared feature footprints. Lowland
 * colour comes from a heavily reduced, blurred wash, not unbounded model objects. */
export function drawEnhancedAtlas(g: AtlasGeometry, seed: string, image: HTMLImageElement,
  style: AtlasViewStyle, layers: AtlasLayers, sheet?: HTMLImageElement) {
  const canvas = drawTerrain(g, seed, sheet, { ...layers,
    rivers: false, roads: false, borders: false, provinces: false, walls: false, passages: false, rifts: false }, undefined, style)
  const c = canvas.getContext('2d')!, sx = canvas.width / g.width, sy = canvas.height / g.height
  c.setTransform(sx, 0, 0, sy, 0, 0)
  const { land, outsideWaters, fillRule } = atlasSurfacePaths(g, seed, layers.waterBodies)
  const material = document.createElement('canvas'), background = document.createElement('canvas')
  const materialScale = Math.min(1.5, 1600 / g.width, 1000 / g.height)
  material.width = background.width = Math.ceil(g.width * materialScale)
  material.height = background.height = Math.ceil(g.height * materialScale)
  const mc = material.getContext('2d')!, bc = background.getContext('2d')!
  mc.drawImage(image, 0, 0, material.width, material.height)
  bc.filter = 'blur(18px)'; bc.drawImage(image, 0, 0, background.width, background.height)
  const detail = mc.getImageData(0, 0, material.width, material.height), blurred = bc.getImageData(0, 0, background.width, background.height)
  // Transfer local paint detail around a neutral midpoint. Removing the model's
  // broad background colour avoids circular green/brown patches at mask edges.
  for (let i = 0; i < detail.data.length; i += 4) for (let k = 0; k < 3; k++) {
    detail.data[i + k] = Math.max(0, Math.min(255, 128 + (detail.data[i + k] - blurred.data[i + k]) * 2.4))
  }
  mc.putImageData(detail, 0, 0)
  c.save(); c.clip(land, fillRule); for (const outside of outsideWaters) c.clip(outside, 'nonzero')
  if (layers.terrain) {
    // Repeated reduction removes object silhouettes before colour blending.
    const wash = document.createElement('canvas'); wash.width = 24; wash.height = Math.max(1, Math.round(24 * g.height / g.width))
    wash.getContext('2d')!.drawImage(image, 0, 0, wash.width, wash.height)
    c.save(); c.globalAlpha = style === 'sketch' ? 0.07 : 0.18
    c.filter = style === 'sketch' ? 'blur(24px) grayscale(1)' : 'blur(24px)'
    c.drawImage(wash, 0, 0, g.width, g.height); c.restore()
  }
  for (const [kind, visible] of [['ridge', layers.mountains], ['wood', layers.forests],
    ['desert', layers.terrain], ['marsh', layers.terrain]] as const) {
    if (!visible) continue
    const mask = atlasMaterialMask(g, seed, kind)
    const piece = document.createElement('canvas'); piece.width = mask.width; piece.height = mask.height
    const pc = piece.getContext('2d')!
    pc.drawImage(material, 0, 0, piece.width, piece.height)
    pc.globalCompositeOperation = 'destination-in'; pc.drawImage(mask, 0, 0)
    c.save(); c.globalCompositeOperation = 'soft-light'; c.globalAlpha = kind === 'wood' ? 0.9 : kind === 'ridge' ? 1 : 0.75
    c.drawImage(piece, 0, 0, g.width, g.height); c.restore()
  }
  const stroke = (path: Path2D, color: string, width: number) => { c.strokeStyle = color; c.lineWidth = width; c.stroke(path) }
  c.lineJoin = 'round'; c.lineCap = 'round'
  for (const f of g.features) {
    if (f.kind === 'river' && layers.rivers) {
      const p = watercourse(f.points, f.name)
      stroke(p, style === 'sketch' ? '#e9ddbf' : '#eae3c6', 2.7)
      stroke(p, /血/.test(f.name) ? '#9a5c61' : style === 'sketch' ? '#6c8782' : '#648f94', 1.3)
    }
    if (f.kind === 'wall' && layers.walls) {
      const p = line(f.points); stroke(p, '#647c81', 3.8); stroke(p, '#d5e5db', 2.55)
      c.setLineDash([0.8, 3]); stroke(p, '#758e94', 2.5); c.setLineDash([])
    }
  }
  c.restore()
  for (const f of g.features) {
    const p = line(f.points)
    if ((f.kind === 'road' || f.kind === 'seaRoute') && layers.roads) {
      stroke(p, '#e4d5b6', 2.2); c.setLineDash(f.kind === 'seaRoute' ? [4, 4] : [2.5, 1.2])
      stroke(p, style === 'sketch' ? '#795f46' : '#976e4d', 0.85); c.setLineDash([])
    }
    if ((f.kind === 'border' && layers.borders) || (f.kind === 'province' && layers.provinces)) {
      c.setLineDash(f.kind === 'border' ? [5, 3] : [2, 3]); stroke(p, '#965e47', f.kind === 'border' ? 1.15 : 0.65); c.setLineDash([])
    }
    if (f.kind === 'passage' && layers.passages) {
      stroke(p, '#dfd6b44d', 5); c.setLineDash([5, 4]); stroke(p, '#eee1bc', 1.5); c.setLineDash([])
    }
    if (f.kind === 'rift' && layers.rifts) { stroke(p, '#b7a7c34d', 8); stroke(p, '#363347', 3.5) }
  }
  return canvas
}
