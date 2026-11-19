import { DEFAULT_ATLAS_LAYERS, type AtlasLayers } from './layers'
import { stamp } from './symbols'
import { terrainWash } from './relief'
import { line, along, watercourse, atlasSurfacePaths } from './paths'
import { drawSketchTerrain } from './sketch'
import { continuousTerrain } from './continuous'
import { paintedSurface } from './painted-surface'
import { seedRandom } from '../engine/random'
import type { AtlasGeometry, Point } from './geometry'

type Brush = CanvasRenderingContext2D
type Random = () => number
const serif = '"Songti SC","STSong","Noto Serif CJK SC",serif'
function ink(c: Brush, path: Path2D, color: string, width: number) {
  c.strokeStyle = color
  c.lineWidth = width
  c.stroke(path)
}
function wash(c: Brush, x: number, y: number, r: number, color: string) {
  const g = c.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color)
  g.addColorStop(1, color.slice(0, 7) + '00')
  c.fillStyle = g
  c.fillRect(x - r, y - r, r * 2, r * 2)
}
function peak(c: Brush, rng: Random, x: number, y: number, h: number, snow: boolean) {
  const w = h * (0.62 + rng() * 0.3),
    tip = x + (rng() - 0.52) * w * 0.6
  const a: Point = [tip, y - h],
    left: Point = [x - w, y + 1],
    right: Point = [x + w, y + 2]
  const fold: Point = [tip + w * 0.11, y - h * 0.54],
    foot: Point = [x - w * 0.12, y + 2]
  const outline = line(
    [
      left,
      [x - w * 0.64, y - h * 0.27],
      [x - w * 0.34, y - h * 0.58],
      a,
      [x + w * 0.36, y - h * 0.63],
      [x + w * 0.54, y - h * 0.49],
      right,
      foot,
    ],
    true,
  )
  const fill = c.createLinearGradient(x, y - h, x + w * 0.3, y + 2)
  fill.addColorStop(0, snow ? '#fff9e5' : '#e9dec0')
  fill.addColorStop(0.58, '#c2aa80')
  fill.addColorStop(1, '#a1946e')
  c.fillStyle = fill
  c.fill(outline)
  c.fillStyle = snow ? '#879aa1' : '#877c63'
  c.fill(
    line(
      [
        a,
        fold,
        [x + w * 0.02, y - h * 0.31],
        foot,
        right,
        [x + w * 0.54, y - h * 0.49],
        [x + w * 0.36, y - h * 0.63],
      ],
      true,
    ),
  )
  ink(c, outline, '#645f4b', 0.52)
  for (let i = 1; i < 6; i++) {
    const t = i / 7,
      u = tip + (right[0] - tip) * t,
      v = y - h + (h + 2) * t
    ink(
      c,
      line([
        [u, v],
        [u - w * 0.09, v + h * 0.13],
        [u - w * 0.22, v + h * 0.22],
      ]),
      '#6d6959',
      0.31,
    )
  }
  if (snow) {
    c.fillStyle = '#f3f0dd'
    c.fill(
      line(
        [
          a,
          [tip - w * 0.27, y - h * 0.66],
          [tip - w * 0.1, y - h * 0.72],
          fold,
          [tip + w * 0.12, y - h * 0.76],
          [tip + w * 0.25, y - h * 0.71],
        ],
        true,
      ),
    )
  }
}
function tree(c: Brush, rng: Random, x: number, y: number, h: number) {
  const w = h * 0.39
  c.fillStyle = rng() > 0.5 ? '#637a57' : '#536d55'
  const p = line(
    [
      [x, y - h],
      [x + w * 0.58, y - h * 0.59],
      [x + w * 0.32, y - h * 0.57],
      [x + w, y - h * 0.18],
      [x + w * 0.4, y],
      [x - w, y - h * 0.15],
      [x - w * 0.32, y - h * 0.57],
      [x - w * 0.57, y - h * 0.54],
    ],
    true,
  )
  c.fill(p)
  ink(c, p, '#495d46', 0.3)
  ink(
    c,
    line([
      [x, y - h * 0.86],
      [x - w * 0.25, y - h * 0.58],
      [x - w * 0.04, y - h * 0.53],
      [x - w * 0.56, y - h * 0.23],
    ]),
    '#aabd86',
    0.48,
  )
}
function castle(c: Brush, x: number, y: number) {
  c.save()
  c.translate(x, y)
  const silhouette = line(
    [
      [-5, 0],
      [-5, -6],
      [-5.8, -6],
      [-5.8, -8],
      [-4.6, -8],
      [-4.6, -7],
      [-3.6, -7],
      [-3.6, -8],
      [-2.3, -8],
      [-2.3, -6],
      [-3, -6],
      [-3, -4],
      [-1, -4],
      [-1, -10],
      [0.7, -13],
      [2.4, -10],
      [2.4, -4],
      [3.6, -4],
      [3.6, -7],
      [5, -9],
      [6.4, -7],
      [6.4, 0],
    ],
    true,
  )
  c.fillStyle = '#e1cd9c'
  c.fill(silhouette)
  ink(c, silhouette, '#5e503d', 0.75)
  c.fillStyle = '#78634c'
  c.fillRect(0.6, -9, 0.8, 5)
  c.fillRect(4.7, -6, 0.9, 3)
  c.fillRect(-2, -2.7, 1.9, 2.7)
  c.restore()
}
function compass(c: Brush, x: number, y: number, r: number) {
  c.save()
  c.translate(x, y)
  c.strokeStyle = '#5d6b57'
  c.lineWidth = 0.65
  for (const radius of [r * 0.54, r * 0.63]) {
    c.beginPath()
    c.arc(0, 0, radius, 0, Math.PI * 2)
    c.stroke()
  }
  for (let i = 0; i < 8; i++) {
    c.save()
    c.rotate((i * Math.PI) / 4)
    const len = i % 2 ? r * 0.58 : r
    const light = line(
        [
          [0, 0],
          [-r * 0.11, -r * 0.14],
          [0, -len],
        ],
        true,
      ),
      dark = line(
        [
          [0, 0],
          [r * 0.11, -r * 0.14],
          [0, -len],
        ],
        true,
      )
    c.fillStyle = '#e4d6ac'
    c.fill(light)
    c.fillStyle = '#596c61'
    c.fill(dark)
    ink(c, light, '#5d6b57', 0.5)
    ink(c, dark, '#5d6b57', 0.5)
    c.restore()
  }
  c.textAlign = 'center'
  c.fillStyle = '#344e4c'
  c.font = '9px ' + serif
  c.fillText('北', 0, -r - 3)
  c.restore()
}
export function drawTerrain(
  g: AtlasGeometry,
  seed: string,
  sheet?: HTMLImageElement,
  layers: AtlasLayers = DEFAULT_ATLAS_LAYERS,
  painted?: HTMLImageElement,
  style: 'illustrated' | 'sketch' | 'painted' = 'illustrated',
  decorations = true,
) {
  if (style === 'sketch') return drawSketchTerrain(g, seed, layers, decorations)
  const continuous = style === 'painted' && !painted
  const rich = continuous || !!painted
  const surface = painted ? paintedSurface(painted, g, seed) : undefined
  const canvas = document.createElement('canvas')
  const scale = Math.min(3, 4096 / Math.max(g.width, g.height))
  canvas.width = Math.round(g.width * scale)
  canvas.height = Math.round(g.height * scale)
  const c = canvas.getContext('2d', { willReadFrequently: true })!
  c.scale(scale, scale)
  c.lineJoin = 'round'
  c.lineCap = 'round'
  const { width: w, height: h, features } = g,
    rng = seedRandom(seed)
  const realms = features.some((f) => f.kind === 'realm')
  const sea = c.createLinearGradient(0, 0, w, h)
  sea.addColorStop(0, realms ? '#4d4a59' : rich ? '#063e49' : '#638d90')
  sea.addColorStop(0.38, realms ? '#77747c' : rich ? '#12656a' : '#94b3a9')
  sea.addColorStop(0.68, realms ? '#656773' : rich ? '#075563' : '#81a5a0')
  sea.addColorStop(1, realms ? '#3f4653' : rich ? '#073a48' : '#4f7f83')
  c.fillStyle = sea
  c.fillRect(0, 0, w, h)
  if (surface) c.drawImage(surface.water, 0, 0, w, h)
  for (let i = 0; i < (painted ? 0 : 75); i++)
    wash(c, rng() * w, rng() * h, 35 + rng() * 100, rng() > 0.5 ? '#45787c26' : '#dfd8af36')
  for (let i = 0; i < (realms || painted ? 0 : 3800); i++) {
    const x = rng() * w,
      y = rng() * h,
      length = 1 + rng() * 5
    ink(
      c,
      line([
        [x, y],
        [x + length * 0.45, y - 0.45],
        [x + length, y],
      ]),
      '#e1e4c54d',
      0.45,
    )
  }
  c.setLineDash([1, 4])
  for (let x = 32; !rich && x < w; x += 60)
    ink(
      c,
      line([
        [x, 0],
        [x, h],
      ]),
      '#446e6f44',
      0.4,
    )
  for (let y = 32; !rich && y < h; y += 60)
    ink(
      c,
      line([
        [0, y],
        [w, y],
      ]),
      '#446e6f44',
      0.4,
    )
  c.setLineDash([])
  const { land, coast, realmEdges, waterEdges, outsideWaters, fillRule } = atlasSurfacePaths(g, seed, layers.waterBodies)
  if (layers.coastlines) {
    // Keep shoreline ink on the water side of the union. Overlapping land
    // polygons are one landmass, not artificial coastlines across its interior.
    const shoreCanvas = document.createElement('canvas')
    shoreCanvas.width = canvas.width; shoreCanvas.height = canvas.height
    const sc = shoreCanvas.getContext('2d')!
    sc.scale(scale, scale); sc.lineJoin = 'round'
    if (rich) {
      ink(sc, coast, '#6cb4a53c', 9)
      ink(sc, coast, '#8fc4ab8a', 3.4)
      ink(sc, coast, '#e1d4a1c7', 1.1)
    } else {
      ink(sc, coast, '#cbd4b039', 20)
      ink(sc, coast, '#d7d9b775', 12)
      ink(sc, coast, '#72938c', 7)
      ink(sc, coast, '#dce1be', 5.8)
      ink(sc, coast, '#638583', 2.6)
      ink(sc, coast, '#645f48', 0.95)
    }
    sc.globalCompositeOperation = 'destination-out'
    sc.fill(land, fillRule)
    c.drawImage(shoreCanvas, 0, 0, w, h)
  }
  c.save()
  c.clip(land, fillRule)
  for (const outsideWater of outsideWaters) c.clip(outsideWater, 'nonzero')
  c.fillStyle = '#e3dcc0'
  c.fillRect(0, 0, w, h)
  if (layers.terrain || continuous) {
    c.drawImage(surface?.base ?? (continuous ? continuousTerrain(g, seed, layers) : terrainWash(g, seed)), 0, 0, w, h)
    if (surface) c.drawImage(surface.land, 0, 0, w, h)
  }
  const glyphs: {
    x: number
    y: number
    size: number
    kind: 'ridge' | 'wood'
    snow: boolean
  }[] = []
  for (const f of features) {
    const k = f.kind
    if ((continuous || painted && layers.terrain) && ['ridge', 'wood', 'desert', 'marsh'].includes(k)) continue
    if (
      (k === 'ridge' && !layers.mountains) ||
      (k === 'wood' && !layers.forests) ||
      ((k === 'desert' || k === 'marsh') && !layers.terrain)
    )
      continue
    const rng = seedRandom(seed + JSON.stringify([f.kind, f.name, f.rank, f.points]))
    if (k === 'ridge' || k === 'wood' || k === 'desert' || k === 'marsh') {
      const place = (x: number, y: number) => {
        wash(
          c,
          x,
          y,
          k === 'desert' ? 32 : 18,
          {
            ridge: '#93846e18',
            wood: '#637f5832',
            desert: '#d7a36e29',
            marsh: '#67968b69',
          }[k],
        )
        if (k === 'ridge' || k === 'wood') {
          const count = sheet ? (k === 'wood' ? 4 : 2) : k === 'wood' ? 9 : 3
          for (let j = 0; j < count; j++)
            glyphs.push({
              kind: k,
              snow: /雪|冰|霜|寒/.test(f.name),
              x: x + (rng() - 0.5) * 24,
              y: y + (rng() - 0.5) * 19,
              size: k === 'wood' ? 3 + rng() * 4 : 5 + rng() * 10,
            })
        } else
          for (let j = 0; j < 7; j++) {
            const u = x + (rng() - 0.5) * 35,
              v = y + (rng() - 0.5) * 23
            ink(
              c,
              line([
                [u - 2, v],
                [u, v - 0.6],
                [u + 2.7, v + 0.2],
              ]),
              k === 'desert' ? '#a88658' : '#759c85',
              0.45,
            )
          }
      }
      // Area-shaped brush strokes fill the interior; narrow ones follow the stroke.
      const xs = f.points.map((p) => p[0]),
        ys = f.points.map((p) => p[1])
      const left = Math.min(...xs),
        right = Math.max(...xs),
        top = Math.min(...ys),
        bottom = Math.max(...ys)
      const patch = line(f.points, true)
      if (k !== 'ridge' && f.points.length >= 5 && right - left > 22 && bottom - top > 20) {
        const spacing = k === 'wood' ? 8 : 12
        for (let v = top; v < bottom; v += spacing)
          for (let u = left; u < right; u += spacing) {
            const x = u + rng() * spacing,
              y = v + rng() * spacing
            if (c.isPointInPath(patch, x * scale, y * scale)) place(x, y)
          }
      } else along(f.points, k === 'ridge' ? 8 : 7, place)
    }
  }
  const grain = seedRandom(seed + 'grain')
  // Short pen strokes give a continuous paper surface across biome boundaries.
  for (let i = 0; i < (rich ? 0 : 15000); i++) {
    const x = grain() * w,
      y = grain() * h
    ink(
      c,
      line([
        [x, y],
        [x + grain() * 2 + 0.2, y - grain() * 0.8],
      ]),
      grain() > 0.5 ? '#776a442e' : '#fff2ca60',
      0.34,
    )
  }
  for (const f of features) {
    if (f.kind === 'river' && layers.rivers) {
      const p = watercourse(f.points, f.name)
      ink(c, p, '#eae3c6', 2.7)
      ink(c, p, /血/.test(f.name) ? '#9a5c61' : '#648f94', 1.55)
      ink(c, p, /血/.test(f.name) ? '#cf9391' : '#a8cbbe', 0.57)
    }
  }
  glyphs.sort((a, b) => a.y - b.y)
  for (const s of glyphs) {
    const rng = seedRandom(seed + s.kind + s.x + ',' + s.y)
    if (sheet) {
      const index =
        s.kind === 'ridge' ? (s.snow ? 0 : 1) : s.y < h * 0.48 ? 2 : 3
      stamp(c, sheet, index, s.x, s.y, s.size * (s.kind === 'ridge' ? 2.15 : 2.4))
    } else if (s.kind === 'ridge') peak(c, rng, s.x, s.y, s.size, s.snow)
    else tree(c, rng, s.x, s.y, s.size)
  }
  for (const f of features)
    if (f.kind === 'wall' && layers.walls) {
      const p = line(f.points)
      ink(c, p, '#647c81', 3.8)
      ink(c, p, '#d5e5db', 2.55)
      c.setLineDash([0.8, 3])
      ink(c, p, '#758e94', 2.5)
      c.setLineDash([])
    }
  c.restore()
  // Roads include bridges and sea routes, so their lines must cross water.
  if (layers.roads) for (const f of features) if (f.kind === 'road' || f.kind === 'seaRoute') {
    const path = line(f.points)
    ink(c, path, '#e4d5b6', 2.2)
    c.setLineDash([2.5, 1.2])
    ink(c, path, /桥/.test(f.name) ? '#8a897d' : '#976e4d', 0.85)
    c.setLineDash([])
  }
  if (layers.coastlines && layers.waterBodies) {
    ink(c, waterEdges, '#71938b', 5)
    ink(c, waterEdges, '#dce1be', 3.6)
    ink(c, waterEdges, '#647b70', 0.9)
  }
  if (realms) {
    ink(c, realmEdges, '#c7c1b84d', 9)
    ink(c, realmEdges, '#a79b8b', 3)
    ink(c, realmEdges, '#e7d9b8', 1.2)
  }
  for (const f of features) {
    if (f.kind === 'passage' && layers.passages) {
      const path = line(f.points)
      ink(c, path, '#dfd6b44d', 5)
      c.setLineDash([5, 4])
      ink(c, path, '#eee1bc', 1.5)
      c.setLineDash([])
    }
    if (f.kind === 'rift' && layers.rifts) {
      ink(c, line(f.points), '#b7a7c34d', 8)
      ink(c, line(f.points), '#363347', 3.5)
      c.setLineDash([1, 3])
      ink(c, line(f.points), '#d3bddd', 0.8)
      c.setLineDash([])
    }
    if ((f.kind === 'border' && layers.borders) || (f.kind === 'province' && layers.provinces)) {
      c.setLineDash(f.kind === 'border' ? [5, 3] : [2, 3])
      ink(
        c,
        line(f.points),
        f.kind === 'border' ? '#965e47' : '#95765c',
        f.kind === 'border' ? 1.15 : 0.65,
      )
      c.setLineDash([])
    }
  }
  if (layers.vignette) {
    const shade = c.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.22,
      w / 2,
      h / 2,
      Math.hypot(w, h) * 0.5,
    )
    shade.addColorStop(0, '#1f332100')
    shade.addColorStop(1, '#1f332167')
    c.fillStyle = shade
    c.fillRect(0, 0, w, h)
  }
  // Place the rose only in a clear patch of water.
  for (const [x, y] of !decorations || realms
    ? []
    : [
        [w * 0.065, h * 0.89],
        [w * 0.93, h * 0.1],
        [w * 0.08, h * 0.12],
      ]) {
    if (
      [
        [0, 0],
        [20, 20],
        [-20, -20],
        [-20, 20],
        [20, -20],
      ].every(([dx, dy]) => !c.isPointInPath(land, (x + dx) * scale, (y + dy) * scale, fillRule))
    ) {
      compass(c, x, y, 18)
      break
    }
  }
  if (decorations) {
  c.strokeStyle = '#536d60'
  c.lineWidth = 0.8
  c.strokeRect(4, 4, w - 8, h - 8)
  c.strokeStyle = '#ddcf9f'
  c.lineWidth = 1.4
  c.strokeRect(6, 6, w - 12, h - 12)
  }
  return canvas
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}
export function drawLabels(
  c: Brush,
  g: AtlasGeometry,
  zoom: number,
  illustrated = false,
  options: {
    layers?: AtlasLayers
    sheet?: HTMLImageElement
    kmPerPixel?: number
    fullDetail?: boolean
    screenScale?: number
    textScale?: number
    style?: 'illustrated' | 'sketch'
  } = {},
) {
  const layers = options.layers ?? DEFAULT_ATLAS_LAYERS
  const sketch = options.style === 'sketch'

  const occupied: Box[] = []
  const labeledNames = new Set<string>()
  const order = {
    city: 1,
    fortress: 1,
    landmark: 1,
    region: 2,
    sea: 3,
    water: 3,
    passage: 4,
    rift: 4,
    wall: 4,
    river: 5,
    ridge: 6,
    wood: 6,
    marsh: 6,
    desert: 6,
  }
  const list = g.features
    .filter((f) => f.name && f.kind in order)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        order[a.kind as keyof typeof order] - order[b.kind as keyof typeof order],
    )
  for (const f of list) {
    const [x, y] = f.kind === 'water' || (['wood', 'marsh', 'desert'].includes(f.kind) && f.points.length >= 5)
      ? f.points.reduce(([x, y], [u, v]) => [x + u / f.points.length, y + v / f.points.length], [0, 0])
      : f.points[Math.floor(f.points.length / 2)]
    const fortress = f.kind === 'fortress'
    if (fortress && !layers.fortresses) continue
    const city = f.kind === 'city' || fortress,
      landmark = f.kind === 'landmark',
      area = f.kind === 'region',
      water = f.kind === 'sea' || f.kind === 'water'
    if (f.kind === 'water' && !layers.waterBodies) continue
    if (landmark && layers.burgIcons) {
      const r = 2.6 / Math.sqrt(zoom)
      c.fillStyle = '#f2e4c0'
      c.strokeStyle = '#675344'
      c.lineWidth = 0.8 / Math.sqrt(zoom)
      const marker = line(
        [
          [x, y - r],
          [x + r, y],
          [x, y + r],
          [x - r, y],
        ],
        true,
      )
      c.fill(marker)
      c.stroke(marker)
    }
    if (!sketch && city && layers.burgIcons && options.sheet && f.rank < 2)
      stamp(c, options.sheet, fortress ? 6 : f.rank === 0 ? 4 : 5, x, y, f.rank === 0 ? 24 : 15)
    if (!sketch && city && layers.burgIcons && f.rank === 0 && !illustrated) {
      castle(c, x, y)
    }
    if (city && layers.burgIcons) {
      const r = (f.rank === 0 ? 2.65 : 1.65) / Math.sqrt(zoom)
      c.fillStyle = sketch ? '#ebddb9' : '#ffefc5'
      c.strokeStyle = sketch ? '#584833' : '#664e3d'
      c.lineWidth = 0.8 / Math.sqrt(zoom)
      c.beginPath()
      c.arc(x, y, r, 0, 2 * Math.PI)
      c.fill()
      c.stroke()
      if (sketch && fortress) {
        c.strokeRect(x - r * 1.8, y - r * 1.8, r * 3.6, r * 3.6)
      }
      if (f.rank === 0) {
        c.fillStyle = '#84533e'
        c.beginPath()
        c.arc(x, y, r * 0.48, 0, 2 * Math.PI)
        c.fill()
      }
    }
    if ((area && !layers.stateLabels) || (!area && !layers.burgLabels)) continue
    if (
      (f.kind === 'river' && !layers.rivers) ||
      (f.kind === 'ridge' && !layers.mountains) ||
      (f.kind === 'wood' && !layers.forests) ||
      ((f.kind === 'desert' || f.kind === 'marsh') && !layers.terrain) ||
      (f.kind === 'wall' && !layers.walls) ||
      (f.kind === 'passage' && !layers.passages) ||
      (f.kind === 'rift' && !layers.rifts)
    )
      continue
    if (labeledNames.has(f.name)) continue
    if (!options.fullDetail && ((f.rank === 2 && zoom < 1.65) ||
      (!city && !landmark && !area && !water && f.rank > 0 && zoom < 1.45)))
      continue
    const nominalSize =
      (water ? 17 : area ? 13 : city ? (f.rank === 0 ? 11 : 9) : landmark ? 9 : 8) /
      Math.pow(zoom, 0.65) * (options.textScale ?? 1)
    const minimumPixels = (area || water ? 16 : city ? 14 : 12) * (options.textScale ?? 1)
    const size = Math.max(nominalSize, minimumPixels / (options.screenScale ?? Infinity))
    c.font = (city || area ? '600 ' : '500 ') + size + 'px ' + serif
    const width = c.measureText(f.name).width
    const labelPositions =
      city || landmark
        ? [
            [5, 1],
            [-width - 5, 1],
            [-width / 2, -size * 0.65],
            [-width / 2, size * 1.4],
          ]
        : [[-width / 2, 0], [-width / 2, size * 1.4], [-width / 2, -size * 1.4]]
    for (const [dx, dy] of labelPositions) {
      const tx = Math.max(10, Math.min(g.width - width - 10, x + dx)),
        ty = Math.max(size + 10, Math.min(g.height - 12, y + dy)),
        box = { x: tx - 1.5, y: ty - size, w: width + 3, h: size + 2 }
      if (
        occupied.some(
          (b) =>
            box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y,
        )
      )
        continue
      occupied.push(box)
      labeledNames.add(f.name)
      c.lineJoin = 'round'
      c.lineWidth = size * (sketch ? 0.14 : 0.22)
      c.strokeStyle = sketch ? '#ebddb9ef' : '#fff4dfdf'
      c.strokeText(f.name, tx, ty)
      c.fillStyle = water ? (sketch ? '#365b61' : '#154555') : area ? '#3d3020' : city ? '#201c18' : sketch ? '#5d513b' : '#263d36'
      c.fillText(f.name, tx, ty)
      break
    }
  }
  const realms = g.features.some((f) => f.kind === 'realm')
  if (realms) {
    c.font = '9px ' + serif
    const note = '诸天分区示意 · 分区间位置与大小仅用于排版 · 不共用比例尺'
    const width = c.measureText(note).width
    c.fillStyle = '#3c3d4bda'
    c.fillRect((g.width - width) / 2 - 10, g.height - 29, width + 20, 20)
    c.fillStyle = '#e8dec3'
    c.fillText(note, (g.width - width) / 2, g.height - 15)
  }
  if (!realms && layers.scaleBar && options.kmPerPixel && options.kmPerPixel > 0) {
    const maxKm = g.width * 0.13 * options.kmPerPixel,
      power = 10 ** Math.floor(Math.log10(maxKm))
    const distance = [5, 2, 1].map((v) => v * power).find((v) => v <= maxKm) ?? power
    const width = distance / options.kmPerPixel,
      x = g.width - 22 - width,
      y = g.height - 22
    c.fillStyle = '#e9dfbcdd'
    c.fillRect(x - 7, y - 23, width + 14, 33)
    c.fillStyle = '#394b45'
    c.fillRect(x, y, width / 2, 3)
    c.strokeStyle = '#394b45'
    c.lineWidth = 0.7
    c.strokeRect(x, y, width, 3)
    c.font = '9px ' + serif
    c.fillText('0', x, y - 5)
    c.textAlign = 'right'
    c.fillText(distance + ' km', x + width, y - 5)
    c.textAlign = 'start'
  }
}
