/**
 * Voronoi 地图 Canvas 渲染器
 * 支持风格预设、图层显隐、省份、道路
 */

import type { VoronoiMapData, LayerVisibility, BiomeOverride, MapStylePreset } from './types'
import { BIOMES } from './climate'
import { getStyleConfig, type StyleConfig } from './style-presets'

/** 渲染选项 */
export interface RenderOptions {
  /** 像素缩放倍率（默认 1） */
  scale?: number
  /** 比例尺：1 像素代表多少公里 */
  kmPerPixel?: number
  /** 渲染风格 */
  stylePreset?: MapStylePreset
  /** 图层显隐 */
  layers?: LayerVisibility
  /** 自定义生态群落配色 */
  biomeOverrides?: BiomeOverride[]
}

/** 默认图层全部显示 */
const DEFAULT_LAYERS: Required<LayerVisibility> = {
  terrain: true,
  coastlines: true,
  rivers: true,
  borders: true,
  provinces: false,
  roads: true,
  stateLabels: true,
  burgIcons: true,
  burgLabels: true,
  scaleBar: true,
  vignette: true,
}

/**
 * 渲染完整地图
 */
export function renderMap(
  canvas: HTMLCanvasElement,
  data: VoronoiMapData,
  scaleOrOptions: number | RenderOptions = 1,
): void {
  const opts: RenderOptions = typeof scaleOrOptions === 'number'
    ? { scale: scaleOrOptions }
    : scaleOrOptions
  const scale = opts.scale ?? 1
  const kmPerPixel = opts.kmPerPixel ?? 1
  const style = getStyleConfig(opts.stylePreset)
  const layers = { ...DEFAULT_LAYERS, ...opts.layers }

  // 构建有效的 biome 配色（覆盖默认）
  const biomeColors = BIOMES.map(b => b.color)
  if (opts.biomeOverrides) {
    for (const ov of opts.biomeOverrides) {
      if (ov.color && ov.id >= 0 && ov.id < biomeColors.length) {
        biomeColors[ov.id] = ov.color
      }
    }
  }

  const { width, height } = data
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true

  if (scale !== 1) ctx.scale(scale, scale)

  // 按图层顺序绘制
  if (layers.terrain) drawTerrain(ctx, data, style, biomeColors)
  if (layers.coastlines) drawCoastlines(ctx, data, style)
  if (layers.rivers) drawRivers(ctx, data, style)
  if (layers.roads) drawRoads(ctx, data, style)
  if (layers.provinces) drawProvinceBorders(ctx, data, style)
  if (layers.borders) drawBorders(ctx, data, style)
  if (layers.stateLabels) drawStateLabels(ctx, data, style)
  if (layers.burgIcons) drawBurgs(ctx, data, style)
  if (layers.burgLabels) drawBurgLabels(ctx, data, style)
  if (layers.scaleBar) drawScaleBar(ctx, width, height, kmPerPixel, style)
  if (layers.vignette) drawVignette(ctx, width, height, style)

  // 风格叠加滤镜
  if (style.overlayColor) {
    ctx.fillStyle = style.overlayColor
    ctx.fillRect(0, 0, width, height)
  }
}

// ── 地形 ────────────────────────────────────────────

function drawTerrain(
  ctx: CanvasRenderingContext2D, data: VoronoiMapData,
  style: StyleConfig, biomeColors: string[],
): void {
  const { cells, vertices, width, height } = data

  ctx.fillStyle = style.oceanBg
  ctx.fillRect(0, 0, width, height)

  for (let i = 0; i < cells.length; i++) {
    const cellVerts = cells.v[i]
    if (!cellVerts || cellVerts.length < 3) continue

    if (cells.h[i] < 20) {
      const depth = Math.abs(cells.t[i])
      const idx = depth <= 1 ? 0 : depth <= 2 ? 1 : depth <= 4 ? 2 : depth <= 7 ? 3 : 4
      ctx.fillStyle = style.oceanDepth[idx]
    } else {
      const h = cells.h[i]
      const color = biomeColors[cells.biome[i]] || '#888'

      if (h > 70) {
        const t = Math.min(1, (h - 70) / 30)
        const ml = style.mountainLow, mh = style.mountainHigh
        const r = Math.round(ml[0] + t * (mh[0] - ml[0]))
        const g = Math.round(ml[1] + t * (mh[1] - ml[1]))
        const b = Math.round(ml[2] + t * (mh[2] - ml[2]))
        ctx.fillStyle = `rgb(${r},${g},${b})`
      } else if (h > 55) {
        const t = (h - 55) / 15
        const base = hexToRGB(color)
        const ml = style.mountainLow
        const r = Math.round(base.r + t * (ml[0] - base.r))
        const g = Math.round(base.g + t * (ml[1] - base.g))
        const b = Math.round(base.b + t * (ml[2] - base.b))
        ctx.fillStyle = `rgb(${r},${g},${b})`
      } else {
        const heightAdj = (h - 30) * 0.2
        ctx.fillStyle = adjustBrightness(color, heightAdj)
      }
    }

    ctx.beginPath()
    for (let j = 0; j < cellVerts.length; j++) {
      const vi = cellVerts[j]
      const vx = vertices.p[vi * 2]
      const vy = vertices.p[vi * 2 + 1]
      if (j === 0) ctx.moveTo(vx, vy)
      else ctx.lineTo(vx, vy)
    }
    ctx.closePath()
    ctx.fill()
  }
}

// ── 海岸线 ──────────────────────────────────────────

function drawCoastlines(ctx: CanvasRenderingContext2D, data: VoronoiMapData, style: StyleConfig): void {
  const { cells, vertices } = data
  const segs = collectCoastSegments(cells, vertices)

  ctx.strokeStyle = style.coastGlow
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const [x1, y1, x2, y2] of segs) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  }

  ctx.strokeStyle = style.coastline
  ctx.lineWidth = 1.5
  for (const [x1, y1, x2, y2] of segs) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  }
}

function collectCoastSegments(cells: VoronoiMapData['cells'], vertices: VoronoiMapData['vertices']): [number, number, number, number][] {
  const segs: [number, number, number, number][] = []
  for (let i = 0; i < cells.length; i++) {
    if (cells.t[i] !== 1) continue
    const cv = cells.v[i]
    if (!cv || cv.length < 3) continue
    for (let j = 0; j < cv.length; j++) {
      const vi = cv[j], viN = cv[(j + 1) % cv.length]
      const ac = vertices.c[vi], acN = vertices.c[viN]
      if (!ac || !acN) continue
      const shared = ac.filter(c => acN.includes(c))
      if (shared.some(c => cells.h[c] < 20) && shared.some(c => cells.h[c] >= 20)) {
        segs.push([vertices.p[vi * 2], vertices.p[vi * 2 + 1], vertices.p[viN * 2], vertices.p[viN * 2 + 1]])
      }
    }
  }
  return segs
}

// ── 河流 ────────────────────────────────────────────

function drawRivers(ctx: CanvasRenderingContext2D, data: VoronoiMapData, style: StyleConfig): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const river of data.rivers) {
    if (river.points.length < 2) continue

    // 光晕
    ctx.strokeStyle = style.riverGlow
    drawRiverPath(ctx, river.points, river.widths, 2)

    // 主河道
    ctx.strokeStyle = style.river
    drawRiverPath(ctx, river.points, river.widths, 0)

    // 高光
    ctx.strokeStyle = style.riverHighlight
    drawRiverPath(ctx, river.points, river.widths, -1)
  }
}

function drawRiverPath(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][], widths: number[], extra: number,
): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const w = Math.max(0.5, (widths[i] || 1) + extra)
    ctx.lineWidth = w
    ctx.beginPath()
    ctx.moveTo(pts[i][0], pts[i][1])
    if (i < pts.length - 2) {
      const mx = (pts[i + 1][0] + pts[i + 2][0]) / 2
      const my = (pts[i + 1][1] + pts[i + 2][1]) / 2
      ctx.quadraticCurveTo(pts[i + 1][0], pts[i + 1][1], mx, my)
    } else {
      ctx.lineTo(pts[i + 1][0], pts[i + 1][1])
    }
    ctx.stroke()
  }
}

// ── 道路 ────────────────────────────────────────────

function drawRoads(ctx: CanvasRenderingContext2D, data: VoronoiMapData, style: StyleConfig): void {
  if (!data.roads || data.roads.length === 0) return

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const road of data.roads) {
    if (road.points.length < 2) continue

    switch (road.type) {
      case 'major':
        ctx.strokeStyle = style.roadMajor
        ctx.lineWidth = 2
        ctx.setLineDash([])
        break
      case 'minor':
        ctx.strokeStyle = style.roadMinor
        ctx.lineWidth = 1.2
        ctx.setLineDash([4, 3])
        break
      case 'trade':
        ctx.strokeStyle = style.roadTrade
        ctx.lineWidth = 1.5
        ctx.setLineDash([6, 4])
        break
      case 'sea':
        ctx.strokeStyle = style.roadSea
        ctx.lineWidth = 1
        ctx.setLineDash([3, 5])
        break
    }

    ctx.beginPath()
    ctx.moveTo(road.points[0][0], road.points[0][1])
    for (let i = 1; i < road.points.length; i++) {
      // 简单的贝塞尔平滑（每隔几个点取控制点）
      if (i < road.points.length - 1 && i % 3 === 0) {
        const mx = (road.points[i][0] + road.points[i + 1][0]) / 2
        const my = (road.points[i][1] + road.points[i + 1][1]) / 2
        ctx.quadraticCurveTo(road.points[i][0], road.points[i][1], mx, my)
      } else {
        ctx.lineTo(road.points[i][0], road.points[i][1])
      }
    }
    ctx.stroke()
  }

  ctx.setLineDash([])
}

// ── 省份边界 ────────────────────────────────────────

function drawProvinceBorders(ctx: CanvasRenderingContext2D, data: VoronoiMapData, style: StyleConfig): void {
  // 省份边界需要 province 分配到 cells 上
  // 由于我们没有在 cells 上存省份 ID，这里用城镇最近归属来画
  if (!data.provinces || data.provinces.length <= 1) return

  const { cells, vertices, burgs } = data

  // 构建每个单元格所属的省份（按最近城镇）
  const cellProv = new Uint16Array(cells.length)
  const activeBurgs = burgs.filter(b => b.i > 0)

  for (let i = 0; i < cells.length; i++) {
    if (cells.h[i] < 20 || cells.state[i] === 0) continue
    const myState = cells.state[i]
    const stateBurgs = activeBurgs.filter(b => b.state === myState)
    if (stateBurgs.length === 0) continue

    let bestBurg = stateBurgs[0]
    let bestDist = Infinity
    for (const b of stateBurgs) {
      const dx = cells.p[i * 2] - b.x
      const dy = cells.p[i * 2 + 1] - b.y
      const d = dx * dx + dy * dy
      if (d < bestDist) { bestDist = d; bestBurg = b }
    }
    cellProv[i] = bestBurg.i
  }

  // 画省界
  ctx.strokeStyle = style.provinceBorder
  ctx.lineWidth = 0.8
  ctx.setLineDash([3, 3])
  ctx.lineCap = 'round'

  for (let i = 0; i < cells.length; i++) {
    if (cellProv[i] === 0) continue
    for (const neighbor of cells.c[i]) {
      if (cellProv[neighbor] === cellProv[i]) continue
      if (cells.state[neighbor] !== cells.state[i]) continue // 国界不画省界
      if (cells.h[neighbor] < 20) continue

      const shared = cells.v[i].filter(v => cells.v[neighbor]?.includes(v))
      if (shared.length >= 2) {
        ctx.beginPath()
        ctx.moveTo(vertices.p[shared[0] * 2], vertices.p[shared[0] * 2 + 1])
        ctx.lineTo(vertices.p[shared[1] * 2], vertices.p[shared[1] * 2 + 1])
        ctx.stroke()
      }
    }
  }
  ctx.setLineDash([])
}

// ── 国界 ────────────────────────────────────────────

function drawBorders(ctx: CanvasRenderingContext2D, data: VoronoiMapData, style: StyleConfig): void {
  const { cells, vertices, states } = data

  ctx.lineWidth = 1.2
  ctx.setLineDash([5, 3])
  ctx.lineCap = 'round'

  for (let i = 0; i < cells.length; i++) {
    if (cells.state[i] === 0) continue
    for (const neighbor of cells.c[i]) {
      if (cells.state[neighbor] === cells.state[i]) continue
      if (cells.h[neighbor] < 20) continue

      const stateColor = states[cells.state[i]]?.color || '#666'
      ctx.strokeStyle = hexToRgba(stateColor, style.borderAlpha)

      const shared = cells.v[i].filter(v => cells.v[neighbor]?.includes(v))
      if (shared.length >= 2) {
        ctx.beginPath()
        ctx.moveTo(vertices.p[shared[0] * 2], vertices.p[shared[0] * 2 + 1])
        ctx.lineTo(vertices.p[shared[1] * 2], vertices.p[shared[1] * 2 + 1])
        ctx.stroke()
      }
    }
  }
  ctx.setLineDash([])
}

// ── 城镇图标 ────────────────────────────────────────

function drawBurgs(ctx: CanvasRenderingContext2D, data: VoronoiMapData, style: StyleConfig): void {
  const towns = data.burgs.filter(b => b.i > 0 && !b.capital)
  const capitals = data.burgs.filter(b => b.i > 0 && b.capital)

  for (const burg of towns) {
    const { x, y } = burg
    ctx.fillStyle = 'rgba(0,0,0,0.2)'
    ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = style.townStroke
    ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = burg.port ? '#5b9fd4' : '#666'
    ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill()
  }

  for (const burg of capitals) {
    const { x, y } = burg
    const stateColor = data.states[burg.state]?.color || '#e15759'
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.arc(x + 1, y + 1, 7, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = style.capitalStroke
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = stateColor
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.beginPath(); ctx.arc(x - 1.5, y - 1.5, 1.5, 0, Math.PI * 2); ctx.fill()
  }
}

// ── 国家标签 ────────────────────────────────────────

function drawStateLabels(ctx: CanvasRenderingContext2D, data: VoronoiMapData, style: StyleConfig): void {
  const { cells, states } = data

  for (const state of states) {
    if (state.i === 0 || state.cells === 0) continue

    let cx = 0, cy = 0, count = 0
    for (let i = 0; i < cells.length; i++) {
      if (cells.state[i] === state.i) {
        cx += cells.p[i * 2]; cy += cells.p[i * 2 + 1]; count++
      }
    }
    if (count === 0) continue
    cx /= count; cy /= count

    const fontSize = Math.max(13, Math.min(26, Math.sqrt(count) * 1.5))
    const spacing = fontSize * 0.3

    ctx.font = `bold ${fontSize}px ${style.stateLabelFont}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const name = state.name
    const totalWidth = ctx.measureText(name).width + spacing * (name.length - 1)

    ctx.shadowColor = style.stateLabelGlow
    ctx.shadowBlur = 6
    ctx.fillStyle = style.stateLabelColor

    let drawX = cx - totalWidth / 2
    for (let i = 0; i < name.length; i++) {
      const charW = ctx.measureText(name[i]).width
      ctx.fillText(name[i], drawX + charW / 2, cy)
      drawX += charW + spacing
    }
    ctx.shadowBlur = 0
  }
}

// ── 城镇标签 ────────────────────────────────────────

function drawBurgLabels(ctx: CanvasRenderingContext2D, data: VoronoiMapData, style: StyleConfig): void {
  for (const burg of data.burgs) {
    if (burg.i === 0) continue

    const fontSize = burg.capital ? 12 : 9
    ctx.font = `${burg.capital ? 'bold ' : ''}${fontSize}px ${style.burgLabelFont}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    const labelY = burg.y + (burg.capital ? 10 : 6)

    ctx.strokeStyle = style.burgLabelStroke
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.strokeText(burg.name, burg.x, labelY)

    ctx.fillStyle = burg.capital ? style.burgLabelColor : (style.burgLabelColor === '#111' ? '#2a2a2a' : style.burgLabelColor)
    ctx.fillText(burg.name, burg.x, labelY)
  }
}

// ── 比例尺 ──────────────────────────────────────────

function drawScaleBar(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  kmPerPixel: number, style: StyleConfig,
): void {
  const targetBarPx = 120
  const targetKm = targetBarPx * kmPerPixel
  const niceSteps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
  let barKm = niceSteps[0]
  for (const step of niceSteps) {
    if (step <= targetKm * 2) barKm = step
    else break
  }
  const barPx = barKm / kmPerPixel

  const x = w - barPx - 30
  const y = h - 25

  ctx.fillStyle = style.scaleBarBg
  ctx.fillRect(x - 6, y - 16, barPx + 12, 28)

  ctx.strokeStyle = style.scaleBarColor
  ctx.fillStyle = style.scaleBarColor
  ctx.lineWidth = 1.5
  ctx.lineCap = 'butt'

  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + barPx, y); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x + barPx, y - 5); ctx.lineTo(x + barPx, y + 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x + barPx / 2, y - 3); ctx.lineTo(x + barPx / 2, y + 1); ctx.stroke()

  const halfPx = barPx / 2
  ctx.fillStyle = style.scaleBarColor
  ctx.fillRect(x, y - 3, halfPx, 3)
  ctx.fillStyle = '#fff'
  ctx.fillRect(x + halfPx, y - 3, halfPx, 3)
  ctx.strokeStyle = style.scaleBarColor
  ctx.lineWidth = 0.8
  ctx.strokeRect(x, y - 3, barPx, 3)

  ctx.font = '10px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = style.scaleBarColor
  const label = barKm >= 1000 ? `${barKm / 1000}千公里` : `${barKm}公里`
  ctx.fillText(label, x + barPx / 2, y + 3)
}

// ── 暗角 ────────────────────────────────────────────

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, style: StyleConfig): void {
  const grad = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.4,
    w / 2, h / 2, Math.max(w, h) * 0.8,
  )
  grad.addColorStop(0, `rgba(${style.vignetteColor},0)`)
  grad.addColorStop(1, `rgba(${style.vignetteColor},${style.vignetteAlpha})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

// ── 工具函数 ────────────────────────────────────────

function adjustBrightness(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xFF) + amount))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + amount))
  const b = Math.max(0, Math.min(255, (num & 0xFF) + amount))
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
}

function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const num = parseInt(hex.slice(1), 16)
  return { r: (num >> 16) & 0xFF, g: (num >> 8) & 0xFF, b: num & 0xFF }
}

function hexToRgba(hex: string, alpha: number): string {
  const num = parseInt(hex.slice(1), 16)
  return `rgba(${(num >> 16) & 0xFF},${(num >> 8) & 0xFF},${num & 0xFF},${alpha})`
}
