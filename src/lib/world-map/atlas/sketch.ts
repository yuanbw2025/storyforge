import { seedRandom } from '../engine/random'
import type { AtlasGeometry, Point } from './geometry'
import type { AtlasLayers } from './layers'
import { along, atlasSurfacePaths, line, watercourse } from './paths'

type Brush = CanvasRenderingContext2D
const paper = '#ebddb9', pen = '#584833', water = '#96a798'
function stroke(c: Brush, path: Path2D, color = pen, width = 0.7) {
  c.strokeStyle = color; c.lineWidth = width; c.stroke(path)
}

function mountain(c: Brush, x: number, y: number, height: number, tilt: number) {
  const width = height * 0.82, tip = x + tilt * height * 0.22
  const outline = line([[x - width, y], [x - width * 0.43, y - height * 0.54],
    [tip, y - height], [x + width * 0.45, y - height * 0.48], [x + width, y]])
  // Paper fill occludes the back row without introducing coloured sprites.
  c.fillStyle = paper; c.fill(outline)
  stroke(c, outline, pen, 0.85)
  stroke(c, line([[tip, y - height], [tip - width * 0.13, y - height * 0.59],
    [x + width * 0.16, y - height * 0.36], [x + width * 0.08, y - height * 0.09]]), '#7a684d', 0.55)
  for (let i = 1; i <= 4; i++) {
    const t = i / 6
    stroke(c, line([[tip + width * t * 0.67, y - height + height * t],
      [x + width * (t + 0.15), y - height * (1 - t) * 0.52]]), '#9d8a68', 0.35)
  }
}

function pine(c: Brush, x: number, y: number, height: number) {
  const width = height * 0.32
  const outline = line([[x, y - height], [x + width * 0.6, y - height * 0.62],
    [x + width * 0.26, y - height * 0.65], [x + width * 0.86, y - height * 0.32],
    [x + width * 0.36, y - height * 0.35], [x + width, y - height * 0.04],
    [x, y - height * 0.16], [x - width, y - height * 0.04],
    [x - width * 0.36, y - height * 0.35], [x - width * 0.86, y - height * 0.32],
    [x - width * 0.26, y - height * 0.65], [x - width * 0.6, y - height * 0.62]], true)
  c.fillStyle = paper; c.fill(outline)
  stroke(c, outline, '#62644a', 0.6)
  stroke(c, line([[x, y - height * 0.18], [x, y + height * 0.12]]), '#62644a', 0.6)
}

function paperGrain(c: Brush, seed: string, width: number, height: number) {
  const tile = document.createElement('canvas'); tile.width = tile.height = 128
  const tc = tile.getContext('2d')!, pixels = tc.createImageData(128, 128), rng = seedRandom(seed + '-paper')
  for (let i = 0; i < pixels.data.length; i += 4) {
    const light = rng() > 0.46
    pixels.data.set(light ? [255, 249, 222, Math.floor(rng() * 27)]
      : [111, 84, 45, Math.floor(rng() * 17)], i)
  }
  tc.putImageData(pixels, 0, 0)
  c.fillStyle = c.createPattern(tile, 'repeat')!
  c.fillRect(0, 0, width, height)
}

/** Flat cartographic line work. Relief symbols only follow authored ridge/biome features. */
export function drawSketchTerrain(g: AtlasGeometry, seed: string, layers: AtlasLayers, decorations = true) {
  const canvas = document.createElement('canvas')
  const scale = Math.min(3, 4096 / Math.max(g.width, g.height))
  canvas.width = Math.round(g.width * scale); canvas.height = Math.round(g.height * scale)
  const c = canvas.getContext('2d', { willReadFrequently: true })!, { width: w, height: h, features } = g
  c.scale(scale, scale); c.lineJoin = 'round'; c.lineCap = 'round'
  c.fillStyle = water; c.fillRect(0, 0, w, h)
  const { land, coast, realmEdges, waterEdges, outsideWaters, fillRule } = atlasSurfacePaths(g, seed, layers.waterBodies)

  if (layers.coastlines) {
    const shore = document.createElement('canvas'); shore.width = canvas.width; shore.height = canvas.height
    const sc = shore.getContext('2d')!; sc.scale(scale, scale); sc.lineJoin = 'round'
    stroke(sc, coast, '#d9d5b39c', 8)
    stroke(sc, coast, '#6a7566', 3.4)
    stroke(sc, coast, '#e1d7b6', 2.3)
    stroke(sc, coast, pen, 1.05)
    sc.globalCompositeOperation = 'destination-out'; sc.fill(land, fillRule)
    c.drawImage(shore, 0, 0, w, h)
  }
  c.save(); c.clip(land, fillRule)
  for (const outside of outsideWaters) c.clip(outside, 'nonzero')
  c.fillStyle = paper; c.fillRect(0, 0, w, h)
  const glyphs: { kind: 'ridge' | 'wood'; x: number; y: number; height: number; tilt: number }[] = []
  for (const feature of features) {
    const { kind, points } = feature
    if ((kind !== 'ridge' || !layers.mountains) && (kind !== 'wood' || !layers.forests) &&
      (!['marsh', 'desert'].includes(kind) || !layers.terrain)) continue
    const rng = seedRandom(seed + JSON.stringify(feature))
    const place = (x: number, y: number) => {
      if (kind === 'ridge') {
        // Two staggered rows read as a chain, rather than isolated icon piles.
        for (let row = 0; row < 2; row++) glyphs.push({ kind, x: x + (row ? 6 : -3) + rng() * 5,
          y: y + (row ? 6 : -4) + rng() * 3, height: 8 + rng() * 9, tilt: rng() - 0.5 })
      } else if (kind === 'wood') {
        glyphs.push({ kind, x: x + (rng() - 0.5) * 5, y: y + rng() * 5, height: 7 + rng() * 5, tilt: 0 })
      } else if (kind === 'desert') {
        const dune = new Path2D(); dune.moveTo(x - 4, y + 1)
        dune.quadraticCurveTo(x, y - 4, x + 6, y)
        stroke(c, dune, '#ad9060', 0.55)
        stroke(c, line([[x - 1, y + 3], [x + 3, y + 3]]), '#baa77e', 0.4)
      } else {
        stroke(c, line([[x - 4, y + 2], [x + 4, y + 2]]), '#819587', 0.6)
        stroke(c, line([[x - 1, y], [x - 2, y - 3], [x, y - 1], [x + 1, y - 4]]), '#798773', 0.5)
      }
    }
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
    if (kind !== 'ridge' && points.length >= 5 && right - left > 22 && bottom - top > 20) {
      const patch = line(points, true), step = kind === 'wood' ? 12 : 14
      for (let y = top; y < bottom; y += step) for (let x = left; x < right; x += step) {
        const u = x + rng() * step, v = y + rng() * step
        if (c.isPointInPath(patch, u * scale, v * scale)) place(u, v)
      }
    } else along(points, kind === 'ridge' ? 16 : 12, place)
  }
  glyphs.sort((a, b) => a.y - b.y)
  for (const glyph of glyphs) {
    if (glyph.kind === 'ridge') mountain(c, glyph.x, glyph.y, glyph.height, glyph.tilt)
    else pine(c, glyph.x, glyph.y, glyph.height)
  }
  // Rivers are printed over the terrain so they remain traceable through forests.
  if (layers.rivers) for (const f of features) if (f.kind === 'river') {
    const path = watercourse(f.points, f.name)
    stroke(c, path, paper, 3.4)
    stroke(c, path, '#668c91', 2.1)
    stroke(c, path, '#c1cfc3', 0.8)
  }
  if (layers.walls) for (const f of features) if (f.kind === 'wall') {
    const path = line(f.points)
    stroke(c, path, '#6e6350', 2.5)
    c.setLineDash([0.6, 3]); stroke(c, path, paper, 1.5); c.setLineDash([])
  }
  c.restore()
  if (layers.roads) for (const f of features) if (f.kind === 'road' || f.kind === 'seaRoute') {
    const path = line(f.points)
    stroke(c, path, '#e8dcbcc7', 2.7)
    c.setLineDash(f.kind === 'seaRoute' ? [4, 4] : f.rank === 0 ? [] : [3, 2])
    stroke(c, path, '#795f46', f.rank === 0 ? 1.25 : 0.85); c.setLineDash([])
  }
  if (layers.waterBodies && layers.coastlines) {
    stroke(c, waterEdges, '#d5d4b6', 3.5); stroke(c, waterEdges, '#6e7969', 0.8)
  }
  stroke(c, realmEdges, '#dbcba9', 5); stroke(c, realmEdges, pen, 0.85)
  for (const f of features) {
    if ((f.kind === 'border' && layers.borders) || (f.kind === 'province' && layers.provinces)) {
      c.setLineDash(f.kind === 'border' ? [6, 2, 1, 2] : [2, 3])
      stroke(c, line(f.points), '#8d7455', f.kind === 'border' ? 1.1 : 0.65); c.setLineDash([])
    }
    if (f.kind === 'passage' && layers.passages) {
      c.setLineDash([4, 3]); stroke(c, line(f.points), '#e3d6b2', 3)
      stroke(c, line(f.points), '#686f62', 0.9); c.setLineDash([])
    }
    if (f.kind === 'rift' && layers.rifts) {
      stroke(c, line(f.points), '#807363', 4); stroke(c, line(f.points), '#433e36', 1.2)
    }
  }
  paperGrain(c, seed, w, h)
  if (layers.vignette) {
    const shade = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.5)
    shade.addColorStop(0, '#61432100'); shade.addColorStop(1, '#61432135')
    c.fillStyle = shade; c.fillRect(0, 0, w, h)
  }
  // The compass is a separate map ornament, never a geographic feature.
  for (const [x, y] of decorations ? [[w * 0.07, h * 0.89], [w * 0.92, h * 0.1]] : []) {
    if (features.some(f => f.kind === 'realm') || c.isPointInPath(land, x * scale, y * scale, fillRule)) continue
    const radius = 15
    stroke(c, line([[x, y - radius], [x, y + radius], [x, y], [x - radius, y], [x + radius, y]]), pen, 0.7)
    const north: Point[] = [[x, y - radius], [x - 3, y + 3], [x, y], [x + 3, y + 3]]
    c.fillStyle = pen; c.fill(line(north, true))
    c.font = '9px "Songti SC",serif'; c.textAlign = 'center'; c.fillText('北', x, y - radius - 4); c.textAlign = 'start'
    break
  }
  if (decorations) {
    c.strokeStyle = '#8b7958'; c.lineWidth = 0.7; c.strokeRect(5, 5, w - 10, h - 10)
    c.strokeStyle = '#e8d9b6'; c.lineWidth = 1.4; c.strokeRect(7, 7, w - 14, h - 14)
  }
  return canvas
}
