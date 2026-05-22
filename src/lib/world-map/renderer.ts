/**
 * 世界地图 Canvas 渲染引擎
 * 纯函数，无 React 依赖 — 接收 WorldMapData + CanvasRenderingContext2D 输出画面
 */

import type {
  WorldMapData, MapRegion, MapMountainRange,
  MapRiver, MapRoad, MapMarker, MapLabel, Point2D,
} from '../types/world-map'
import { perturbPolygon, seededRandom } from './perlin'

// ── 色彩工具 ──────────────────────────────────────────────
function adjustColor(hex: string, amt: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, (num >> 16) + amt))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt))
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt))
  return `rgb(${r},${g},${b})`
}

// ── 地形纹理颜色 ─────────────────────────────────────────
const TERRAIN_COLORS: Record<string, string> = {
  ocean: '#1e3a5f',
  deepocean: '#142a47',
  coast: '#2a5a80',
  plains: '#4a7a3a',
  forest: '#2d5a2a',
  'dense-forest': '#1a4a1a',
  desert: '#b89840',
  tundra: '#c0c0d0',
  swamp: '#3a5a30',
  'mountain-region': '#7a6a5a',
  hills: '#6a7a4a',
  volcanic: '#5a2a1a',
  ice: '#d8d8e8',
  grassland: '#5a8a4a',
}

// ═══════════════════════════════════════════════════════════
// 主渲染函数
// ═══════════════════════════════════════════════════════════

export interface RenderOptions {
  /** 当前选中的 marker ID（高亮显示） */
  selectedMarkerId?: string | null
  /** 当前悬停的 marker ID */
  hoveredMarkerId?: string | null
  /** 是否显示道路 */
  showRoads?: boolean
  /** 是否显示标注 */
  showLabels?: boolean
}

export function renderWorldMap(
  ctx: CanvasRenderingContext2D,
  data: WorldMapData,
  opts: RenderOptions = {},
): void {
  const W = data.width
  const H = data.height

  ctx.clearRect(0, 0, W, H)

  // 1. 羊皮纸背景
  drawParchment(ctx, W, H)

  // 2. 按 zIndex 排序区域
  const sortedRegions = [...data.regions].sort((a, b) => a.zIndex - b.zIndex)

  // 3. 渲染区域（海洋 → 大陆 → 子区域）
  for (const region of sortedRegions) {
    if (region.type === 'ocean' || region.type === 'deepocean' || region.type === 'coast') {
      drawOceanRegion(ctx, region)
    } else {
      drawLandRegion(ctx, region)
    }
  }

  // 4. 山脉
  for (const mtn of data.mountains) {
    drawMountainRange(ctx, mtn)
  }

  // 5. 河流
  for (const river of data.rivers) {
    drawRiver(ctx, river)
  }

  // 6. 道路
  if (opts.showRoads !== false) {
    for (const road of data.roads) {
      drawRoad(ctx, road)
    }
  }

  // 7. 城市标记
  for (const marker of data.markers) {
    const isSelected = marker.id === opts.selectedMarkerId
    const isHovered = marker.id === opts.hoveredMarkerId
    drawMarker(ctx, marker, isSelected, isHovered)
  }

  // 8. 文字标注
  if (opts.showLabels !== false) {
    for (const label of data.labels) {
      drawLabel(ctx, label)
    }
  }

  // 9. UI 叠加
  drawCompass(ctx, W, H)
  drawTitleBox(ctx, data.title)
  drawScaleBar(ctx, W, H)
  drawBorderDecoration(ctx, W, H)
}

// ═══════════════════════════════════════════════════════════
// 分层渲染函数
// ═══════════════════════════════════════════════════════════

function drawParchment(ctx: CanvasRenderingContext2D, W: number, H: number) {
  // 基色径向渐变
  const grad = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, Math.max(W, H) * 0.7)
  grad.addColorStop(0, '#3a3425')
  grad.addColorStop(0.6, '#2e2818')
  grad.addColorStop(1, '#1a1810')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // 纸张纹理噪点
  const rng = seededRandom(42)
  ctx.globalAlpha = 0.03
  for (let i = 0; i < 12000; i++) {
    const x = rng() * W
    const y = rng() * H
    const s = rng() * 2
    ctx.fillStyle = rng() > 0.5 ? '#fff' : '#000'
    ctx.fillRect(x, y, s, s)
  }
  ctx.globalAlpha = 1
}

function drawBorderDecoration(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.strokeStyle = '#4a3a20'
  ctx.lineWidth = 1.5
  ctx.strokeRect(10, 10, W - 20, H - 20)
  ctx.strokeStyle = '#3a2a15'
  ctx.lineWidth = 0.5
  ctx.strokeRect(14, 14, W - 28, H - 28)
}

// ── 海洋区域 ──────────────────────────────────────────────
function drawOceanRegion(ctx: CanvasRenderingContext2D, region: MapRegion) {
  const poly = perturbPolygon(region.polygon, 6, 4, hashStr(region.id))

  ctx.save()
  ctx.globalAlpha = 0.75

  // 填充
  const cx = centroidX(region.polygon)
  const cy = centroidY(region.polygon)
  const rad = maxRadius(region.polygon, cx, cy)
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
  grad.addColorStop(0, region.color || TERRAIN_COLORS[region.type] || '#1e3a5f')
  grad.addColorStop(1, adjustColor(region.color || '#1e3a5f', -20))
  ctx.fillStyle = grad

  drawPolygonPath(ctx, poly)
  ctx.fill()

  // 波浪纹理
  ctx.globalAlpha = 0.12
  ctx.strokeStyle = '#5a8ab0'
  ctx.lineWidth = 0.5
  const rng = seededRandom(hashStr(region.id) + 1)
  for (let i = 0; i < 30; i++) {
    const ox = cx + (rng() - 0.5) * rad * 1.6
    const oy = cy + (rng() - 0.5) * rad * 1.2
    ctx.beginPath()
    ctx.moveTo(ox - 14, oy)
    ctx.quadraticCurveTo(ox - 7, oy - 4, ox, oy)
    ctx.quadraticCurveTo(ox + 7, oy + 4, ox + 14, oy)
    ctx.stroke()
  }

  ctx.restore()
}

// ── 陆地区域 ──────────────────────────────────────────────
function drawLandRegion(ctx: CanvasRenderingContext2D, region: MapRegion) {
  const amplitude = region.isContinent ? 12 : 8
  const subs = region.isContinent ? 8 : 5
  const poly = perturbPolygon(region.polygon, amplitude, subs, hashStr(region.id))

  ctx.save()
  ctx.globalAlpha = region.isContinent ? 0.5 : 0.65

  // 填充
  const color = region.color || TERRAIN_COLORS[region.type] || '#4a7a3a'
  const cx = centroidX(region.polygon)
  const cy = centroidY(region.polygon)
  const rad = maxRadius(region.polygon, cx, cy)
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
  grad.addColorStop(0, color)
  grad.addColorStop(1, adjustColor(color, -25))
  ctx.fillStyle = grad

  drawPolygonPath(ctx, poly)
  ctx.fill()

  // 轮廓线（微弱）
  ctx.globalAlpha = 0.2
  ctx.strokeStyle = adjustColor(color, 40)
  ctx.lineWidth = region.isContinent ? 1.2 : 0.8
  ctx.stroke()

  // 地形纹理
  ctx.globalAlpha = 0.35
  const rng = seededRandom(hashStr(region.id) + 100)
  const type = region.type

  if (type === 'forest' || type === 'dense-forest') {
    drawTreeTexture(ctx, region.polygon, rng, type === 'dense-forest' ? 50 : 30)
  } else if (type === 'desert') {
    drawDotTexture(ctx, region.polygon, rng, '#c4a040', 25)
  } else if (type === 'tundra' || type === 'ice') {
    drawDotTexture(ctx, region.polygon, rng, '#e0e0f0', 20)
  } else if (type === 'swamp') {
    drawCircleTexture(ctx, region.polygon, rng, '#2a4a20')
  } else if (type === 'hills') {
    drawHillTexture(ctx, region.polygon, rng)
  }

  ctx.restore()
}

// ── 地形纹理辅助 ──────────────────────────────────────────
function drawTreeTexture(ctx: CanvasRenderingContext2D, poly: Point2D[], rng: () => number, count: number) {
  const bounds = getBounds(poly)
  for (let i = 0; i < count; i++) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX)
    const y = bounds.minY + rng() * (bounds.maxY - bounds.minY)
    if (!isPointInPolygon(x, y, poly)) continue

    const isPine = rng() < 0.6
    const size = 3 + rng() * 4

    if (isPine) {
      // 松树：三角形 + 树干，带明暗
      const h = size * 1.8
      // 树干
      ctx.fillStyle = '#3a2a18'
      ctx.fillRect(x - 0.5, y, 1, size * 0.4)
      // 阴影面（右半）
      ctx.fillStyle = '#1a3a10'
      ctx.beginPath()
      ctx.moveTo(x, y - h)
      ctx.lineTo(x + size * 0.55, y)
      ctx.lineTo(x, y)
      ctx.closePath()
      ctx.fill()
      // 受光面（左半）
      ctx.fillStyle = '#2a5a1a'
      ctx.beginPath()
      ctx.moveTo(x, y - h)
      ctx.lineTo(x - size * 0.55, y)
      ctx.lineTo(x, y)
      ctx.closePath()
      ctx.fill()
    } else {
      // 阔叶树：圆形树冠 + 高光
      const r = size * 0.7
      // 阴影
      ctx.fillStyle = 'rgba(0,0,0,0.15)'
      ctx.beginPath()
      ctx.arc(x + 1, y - r + 1, r, 0, Math.PI * 2)
      ctx.fill()
      // 树冠
      const hue = 0.28 + (rng() - 0.5) * 0.06
      const lum = 0.2 + rng() * 0.08
      ctx.fillStyle = `hsl(${hue * 360}, 55%, ${lum * 100}%)`
      ctx.beginPath()
      ctx.arc(x, y - r, r, 0, Math.PI * 2)
      ctx.fill()
      // 高光
      ctx.fillStyle = 'rgba(120,180,80,0.25)'
      ctx.beginPath()
      ctx.arc(x - r * 0.25, y - r * 1.2, r * 0.4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawDotTexture(ctx: CanvasRenderingContext2D, poly: Point2D[], rng: () => number, color: string, count: number) {
  ctx.fillStyle = color
  const bounds = getBounds(poly)
  for (let i = 0; i < count; i++) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX)
    const y = bounds.minY + rng() * (bounds.maxY - bounds.minY)
    if (!isPointInPolygon(x, y, poly)) continue
    ctx.beginPath()
    ctx.arc(x, y, 1 + rng(), 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawCircleTexture(ctx: CanvasRenderingContext2D, poly: Point2D[], rng: () => number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 0.5
  const bounds = getBounds(poly)
  for (let i = 0; i < 15; i++) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX)
    const y = bounds.minY + rng() * (bounds.maxY - bounds.minY)
    if (!isPointInPolygon(x, y, poly)) continue
    ctx.beginPath()
    ctx.arc(x, y, 3 + rng() * 5, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function drawHillTexture(ctx: CanvasRenderingContext2D, poly: Point2D[], rng: () => number) {
  ctx.fillStyle = '#5a5040'
  const bounds = getBounds(poly)
  for (let i = 0; i < 20; i++) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX)
    const y = bounds.minY + rng() * (bounds.maxY - bounds.minY)
    if (!isPointInPolygon(x, y, poly)) continue
    const w = 5 + rng() * 4
    ctx.beginPath()
    ctx.arc(x, y, w, Math.PI, 0)
    ctx.fill()
  }
}

// ── 山脉（手绘 Inkarnate 风格） ──────────────────────────────
function drawMountainRange(ctx: CanvasRenderingContext2D, mtn: MapMountainRange) {
  const pts = mtn.ridgeLine
  if (pts.length < 2) return

  const peakH = mtn.height === 'epic' ? 28 : mtn.height === 'high' ? 22 : mtn.height === 'medium' ? 16 : 11
  const showSnow = peakH >= 16
  const rng = seededRandom(hashStr(mtn.name))

  ctx.save()

  // 收集所有山峰（主峰 + 侧峰），从后到前排序绘制（painter's algorithm）
  const peaks: { x: number; y: number; h: number; w: number }[] = []
  const step = Math.max(16, mtn.width * 0.6)
  const totalLen = totalPathLength(pts)

  for (let d = 0; d < totalLen; d += step) {
    const pt = pointAlongPath(pts, d)
    if (!pt) continue
    const h = peakH * (0.7 + rng() * 0.3)
    const w = h * (0.6 + rng() * 0.3)
    peaks.push({ x: pt[0] + (rng() - 0.5) * 4, y: pt[1], h, w })

    // 旁侧小峰
    if (rng() < 0.6) {
      const side = (rng() < 0.5 ? -1 : 1) * mtn.width * (0.2 + rng() * 0.3)
      const sh = h * (0.35 + rng() * 0.3)
      peaks.push({ x: pt[0] + side, y: pt[1] + (rng() - 0.5) * 3, h: sh, w: sh * 0.7 })
    }
  }

  // 按 y 排序：远处（小 y）先画
  peaks.sort((a, b) => (a.y - a.h) - (b.y - b.h))

  for (const pk of peaks) {
    const { x, y, h, w } = pk

    // ── 山体阴影（右侧深色） ──
    ctx.fillStyle = 'rgba(30,20,10,0.25)'
    ctx.beginPath()
    ctx.moveTo(x + 1, y - h + 1)
    ctx.lineTo(x + w + 3, y + 3)
    ctx.lineTo(x - w + 3, y + 3)
    ctx.closePath()
    ctx.fill()

    // ── 山体左侧（受光面） ──
    ctx.fillStyle = '#8a7860'
    ctx.beginPath()
    ctx.moveTo(x, y - h)
    ctx.lineTo(x - w, y + 2)
    ctx.lineTo(x, y + 2)
    ctx.closePath()
    ctx.fill()

    // ── 山体右侧（阴影面） ──
    ctx.fillStyle = '#5a4838'
    ctx.beginPath()
    ctx.moveTo(x, y - h)
    ctx.lineTo(x + w, y + 2)
    ctx.lineTo(x, y + 2)
    ctx.closePath()
    ctx.fill()

    // ── 山脊线（明暗交界） ──
    ctx.strokeStyle = 'rgba(180,160,130,0.3)'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(x, y - h)
    ctx.lineTo(x, y + 2)
    ctx.stroke()

    // ── 岩石纹理线条 ──
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 0.4
    for (let i = 0; i < 3; i++) {
      const ty = y - h * (0.2 + i * 0.2)
      ctx.beginPath()
      ctx.moveTo(x - w * (0.3 + i * 0.15), ty + h * 0.1)
      ctx.quadraticCurveTo(x, ty - 1, x + w * (0.2 + i * 0.1), ty + h * 0.15)
      ctx.stroke()
    }

    // ── 雪顶 ──
    if (showSnow && h >= peakH * 0.6) {
      const snowLine = h * 0.35
      ctx.fillStyle = '#e8e0d0'
      ctx.beginPath()
      ctx.moveTo(x, y - h)
      // 不规则雪线
      ctx.lineTo(x - w * 0.25, y - h + snowLine)
      ctx.quadraticCurveTo(x - w * 0.1, y - h + snowLine * 0.85, x, y - h + snowLine * 0.7)
      ctx.quadraticCurveTo(x + w * 0.1, y - h + snowLine * 0.85, x + w * 0.25, y - h + snowLine)
      ctx.closePath()
      ctx.fill()
    }
  }

  // 山脉名称
  const midPt = pointAlongPath(pts, totalLen / 2)
  if (midPt) {
    ctx.fillStyle = '#7a6a50'
    ctx.font = 'italic 10px serif'
    ctx.textAlign = 'center'
    ctx.strokeStyle = '#1a1810'
    ctx.lineWidth = 2
    ctx.strokeText(mtn.name, midPt[0], midPt[1] + peakH + 14)
    ctx.fillText(mtn.name, midPt[0], midPt[1] + peakH + 14)
  }

  ctx.restore()
}

// ── 河流（双线描边 + 发光） ──────────────────────────────────
function drawRiver(ctx: CanvasRenderingContext2D, river: MapRiver) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (river.underground) ctx.setLineDash([5, 5])

  const baseWidth = Math.max(river.width || 2, 2)

  // 外层发光
  ctx.strokeStyle = 'rgba(60,130,190,0.25)'
  ctx.lineWidth = baseWidth + 4
  ctx.globalAlpha = 0.6
  drawSmoothPath(ctx, river.path)
  ctx.stroke()

  // 主河道
  ctx.strokeStyle = '#4a90c0'
  ctx.lineWidth = baseWidth + 1
  ctx.globalAlpha = 0.85
  drawSmoothPath(ctx, river.path)
  ctx.stroke()

  // 高光中线
  ctx.strokeStyle = 'rgba(140,200,240,0.35)'
  ctx.lineWidth = Math.max(1, baseWidth * 0.4)
  ctx.globalAlpha = 0.7
  drawSmoothPath(ctx, river.path)
  ctx.stroke()

  // 支流
  if (river.tributaries) {
    for (const trib of river.tributaries) {
      const tw = Math.max(trib.width || 1, 1)
      ctx.strokeStyle = '#4a90c0'
      ctx.lineWidth = tw + 0.5
      ctx.globalAlpha = 0.65
      drawSmoothPath(ctx, trib.path)
      ctx.stroke()
    }
  }

  // 河名
  if (river.path.length >= 3) {
    const mid = river.path[Math.floor(river.path.length / 2)]
    ctx.fillStyle = '#5a9ac0'
    ctx.font = 'italic 9px serif'
    ctx.textAlign = 'center'
    ctx.globalAlpha = 0.75
    ctx.strokeStyle = '#1a1810'
    ctx.lineWidth = 2
    ctx.strokeText(river.name, mid[0] + 14, mid[1] - 8)
    ctx.fillText(river.name, mid[0] + 14, mid[1] - 8)
  }

  ctx.setLineDash([])
  ctx.restore()
}

// ── 道路 ──────────────────────────────────────────────────
function drawRoad(ctx: CanvasRenderingContext2D, road: MapRoad) {
  ctx.save()
  ctx.globalAlpha = 0.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (road.type) {
    case 'major':
      ctx.strokeStyle = '#8a7a60'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 3])
      break
    case 'trade':
      ctx.strokeStyle = '#c9a84c'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      break
    case 'ancient':
      ctx.strokeStyle = '#6a5a4a'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 4])
      break
    default:
      ctx.strokeStyle = '#7a6a50'
      ctx.lineWidth = 0.8
      ctx.setLineDash([3, 3])
  }

  drawSmoothPath(ctx, road.path)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

// ── 城市标记（手绘风格图标） ──────────────────────────────
function drawMarker(
  ctx: CanvasRenderingContext2D,
  marker: MapMarker,
  isSelected: boolean,
  isHovered: boolean,
) {
  const { x, y } = marker
  const importance = marker.importance || 3
  const isCapital = marker.type === 'capital'
  const isCity = marker.type === 'city' || marker.type === 'capital'
  const isFortress = marker.type === 'fortress' || marker.type === 'sect'
  const isPort = marker.type === 'port'

  ctx.save()

  // 选中高亮
  if (isSelected) {
    ctx.globalAlpha = 0.4
    ctx.fillStyle = '#3b82f6'
    ctx.beginPath()
    ctx.arc(x, y, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // 悬停高亮
  if (isHovered && !isSelected) {
    ctx.globalAlpha = 0.25
    ctx.fillStyle = '#60a5fa'
    ctx.beginPath()
    ctx.arc(x, y, 14, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  if (isCapital) {
    // ── 首都：城堡图标 ──
    // 光晕
    ctx.globalAlpha = 0.25
    ctx.fillStyle = '#c9a84c'
    ctx.beginPath()
    ctx.arc(x, y, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    // 城堡主体
    ctx.fillStyle = '#c9a84c'
    ctx.fillRect(x - 7, y - 4, 14, 10)
    // 城垛
    for (let i = -6; i <= 4; i += 4) {
      ctx.fillRect(x + i, y - 8, 3, 4)
    }
    // 门
    ctx.fillStyle = '#1a1810'
    ctx.beginPath()
    ctx.arc(x, y + 2, 2.5, Math.PI, 0)
    ctx.fillRect(x - 2.5, y + 2, 5, 4)
    ctx.fill()
    // 旗帜
    ctx.strokeStyle = '#c9a84c'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y - 8)
    ctx.lineTo(x, y - 15)
    ctx.stroke()
    ctx.fillStyle = '#c44'
    ctx.beginPath()
    ctx.moveTo(x, y - 15)
    ctx.lineTo(x + 6, y - 13)
    ctx.lineTo(x, y - 11)
    ctx.closePath()
    ctx.fill()
  } else if (isFortress) {
    // ── 要塞：菱形 + 双圈 ──
    ctx.strokeStyle = '#8a6a4a'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, y - 7)
    ctx.lineTo(x + 7, y)
    ctx.lineTo(x, y + 7)
    ctx.lineTo(x - 7, y)
    ctx.closePath()
    ctx.stroke()
    ctx.fillStyle = '#5a4a38'
    ctx.fill()
    ctx.fillStyle = '#c9a84c'
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  } else if (isPort) {
    // ── 港口：锚形 ──
    ctx.fillStyle = '#4a7a9a'
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#b0d0e0'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.stroke()
    // 锚杆
    ctx.strokeStyle = '#b0d0e0'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(x, y - 5)
    ctx.lineTo(x, y + 4)
    ctx.moveTo(x - 4, y + 2)
    ctx.quadraticCurveTo(x - 4, y + 5, x, y + 4)
    ctx.quadraticCurveTo(x + 4, y + 5, x + 4, y + 2)
    ctx.stroke()
  } else if (isCity) {
    // ── 城市：实心圆 + 外圈 ──
    const r = 4 + Math.min(importance, 4)
    ctx.fillStyle = '#b08060'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#d0a878'
    ctx.lineWidth = 1.2
    ctx.stroke()
    // 内圈
    ctx.fillStyle = '#1a1810'
    ctx.beginPath()
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // ── 通用标记：小圆点 ──
    const r = 3 + Math.min(importance, 3)
    ctx.fillStyle = '#a08060'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#c0a878'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  // 城市名
  const nameColor = isCapital ? '#c9a84c' : '#b0a080'
  const fontSize = isCapital ? 12 : 8 + Math.min(importance, 3)
  const nameFont = isCapital ? `bold ${fontSize}px serif` : `${fontSize}px serif`
  ctx.fillStyle = nameColor
  ctx.font = nameFont
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.strokeStyle = '#1a1810'
  ctx.lineWidth = 2.5
  const nameY = y + (isCapital ? 10 : 8)
  ctx.strokeText(marker.name, x, nameY)
  ctx.fillText(marker.name, x, nameY)

  ctx.restore()
}

// ── 文字标注 ──────────────────────────────────────────────
function drawLabel(ctx: CanvasRenderingContext2D, label: MapLabel) {
  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.fillStyle = label.color || '#8a7d60'
  const style = label.fontStyle === 'italic' ? 'italic ' : ''
  ctx.font = `${style}${label.fontSize || 11}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (label.rotation) {
    ctx.translate(label.x, label.y)
    ctx.rotate((label.rotation * Math.PI) / 180)
    ctx.strokeStyle = '#1a1810'
    ctx.lineWidth = 2.5
    ctx.strokeText(label.text, 0, 0)
    ctx.fillText(label.text, 0, 0)
  } else {
    ctx.strokeStyle = '#1a1810'
    ctx.lineWidth = 2.5
    ctx.strokeText(label.text, label.x, label.y)
    ctx.fillText(label.text, label.x, label.y)
  }

  ctx.restore()
}

// ── 指南针 ────────────────────────────────────────────────
function drawCompass(ctx: CanvasRenderingContext2D, W: number, _H: number) {
  ctx.save()
  const cx = W - 55
  const cy = 55

  ctx.strokeStyle = '#5a4a30'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, 22, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = '#4a3a25'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20)
  ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy)
  ctx.stroke()

  // 北
  ctx.fillStyle = '#c9a84c'
  ctx.beginPath()
  ctx.moveTo(cx, cy - 18)
  ctx.lineTo(cx - 4, cy)
  ctx.lineTo(cx + 4, cy)
  ctx.closePath()
  ctx.fill()

  // 南
  ctx.fillStyle = '#5a4a30'
  ctx.beginPath()
  ctx.moveTo(cx, cy + 18)
  ctx.lineTo(cx - 4, cy)
  ctx.lineTo(cx + 4, cy)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#c9a84c'
  ctx.font = 'bold 10px serif'
  ctx.textAlign = 'center'
  ctx.fillText('N', cx, cy - 26)

  ctx.restore()
}

// ── 标题框 ────────────────────────────────────────────────
function drawTitleBox(ctx: CanvasRenderingContext2D, title: string) {
  ctx.save()
  const w = Math.max(160, ctx.measureText(title).width + 40)

  ctx.fillStyle = 'rgba(26,24,16,0.75)'
  ctx.fillRect(20, 20, w, 36)
  ctx.strokeStyle = '#5a4a30'
  ctx.lineWidth = 1
  ctx.strokeRect(20, 20, w, 36)
  ctx.strokeStyle = '#3a2a18'
  ctx.lineWidth = 0.5
  ctx.strokeRect(23, 23, w - 6, 30)

  ctx.fillStyle = '#c9a84c'
  ctx.font = 'bold 16px serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, 20 + w / 2, 38)

  ctx.restore()
}

// ── 比例尺 ────────────────────────────────────────────────
function drawScaleBar(ctx: CanvasRenderingContext2D, _W: number, H: number) {
  ctx.save()
  const x = 30
  const y = H - 35

  ctx.strokeStyle = '#6a5a40'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y); ctx.lineTo(x + 80, y)
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4)
  ctx.moveTo(x + 80, y - 4); ctx.lineTo(x + 80, y + 4)
  ctx.moveTo(x + 40, y - 3); ctx.lineTo(x + 40, y + 3)
  ctx.stroke()

  ctx.fillStyle = '#7a6a50'
  ctx.font = '9px serif'
  ctx.textAlign = 'center'
  ctx.fillText('0', x, y + 14)
  ctx.fillText('500里', x + 40, y + 14)
  ctx.fillText('千里', x + 80, y + 14)

  ctx.restore()
}

// ═══════════════════════════════════════════════════════════
// 几何工具
// ═══════════════════════════════════════════════════════════

function drawPolygonPath(ctx: CanvasRenderingContext2D, pts: Point2D[]) {
  if (pts.length < 3) return
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1])
  }
  ctx.closePath()
}

function drawSmoothPath(ctx: CanvasRenderingContext2D, pts: Point2D[]) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length - 1; i++) {
    const xc = (pts[i][0] + pts[i + 1][0]) / 2
    const yc = (pts[i][1] + pts[i + 1][1]) / 2
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc)
  }
  const last = pts[pts.length - 1]
  ctx.lineTo(last[0], last[1])
}

function centroidX(pts: Point2D[]): number {
  return pts.reduce((s, p) => s + p[0], 0) / pts.length
}

function centroidY(pts: Point2D[]): number {
  return pts.reduce((s, p) => s + p[1], 0) / pts.length
}

function maxRadius(pts: Point2D[], cx: number, cy: number): number {
  let r = 0
  for (const [x, y] of pts) {
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    if (d > r) r = d
  }
  return r
}

function getBounds(pts: Point2D[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** 射线法判断点是否在多边形内 */
function isPointInPolygon(px: number, py: number, poly: Point2D[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 沿路径累计距离，返回总长 */
function totalPathLength(pts: Point2D[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0]
    const dy = pts[i][1] - pts[i - 1][1]
    len += Math.sqrt(dx * dx + dy * dy)
  }
  return len
}

/** 沿路径行走 distance 距离，返回坐标 */
function pointAlongPath(pts: Point2D[], distance: number): Point2D | null {
  let walked = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0]
    const dy = pts[i][1] - pts[i - 1][1]
    const segLen = Math.sqrt(dx * dx + dy * dy)
    if (walked + segLen >= distance) {
      const t = (distance - walked) / segLen
      return [pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t]
    }
    walked += segLen
  }
  return pts.length > 0 ? pts[pts.length - 1] : null
}

/** 简单字符串 hash（用于种子） */
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

// ═══════════════════════════════════════════════════════════
// Hit-test（用于交互层）
// ═══════════════════════════════════════════════════════════

/** 找到给定坐标处的 marker（用于点击/悬停检测） */
export function hitTestMarker(
  data: WorldMapData,
  mx: number,
  my: number,
  radius = 16,
): MapMarker | null {
  // 倒序遍历（顶层优先）
  for (let i = data.markers.length - 1; i >= 0; i--) {
    const m = data.markers[i]
    const dx = mx - m.x
    const dy = my - m.y
    if (dx * dx + dy * dy <= radius * radius) return m
  }
  return null
}
