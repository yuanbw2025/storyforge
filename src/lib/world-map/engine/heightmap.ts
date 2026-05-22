/**
 * 高度图生成
 * 支持 10 种地形模板，通过 Hill/Range 等工具组合生成自然地形
 */

import type { GridCells, HeightmapTemplate } from './types'

/**
 * 生成高度图
 */
export function generateHeightmap(
  cells: GridCells,
  width: number,
  height: number,
  rng: () => number,
  landRatio = 0.45,
  continentCount = 2,
  template: HeightmapTemplate = 'continents',
): void {
  const n = cells.length
  const blobPower = n < 5000 ? 0.94 : n < 10000 ? 0.95 : 0.96

  // 边缘遮罩
  const edgeMask = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = cells.p[i * 2] / width
    const y = cells.p[i * 2 + 1] / height
    edgeMask[i] = (1 - (2 * x - 1) ** 6) * (1 - (2 * y - 1) ** 6)
  }

  // 根据模板选择生成策略
  switch (template) {
    case 'pangea':
      templatePangea(cells, width, height, rng, blobPower)
      break
    case 'archipelago':
      templateArchipelago(cells, width, height, rng, blobPower)
      break
    case 'volcano':
      templateVolcano(cells, width, height, rng, blobPower)
      break
    case 'isthmus':
      templateIsthmus(cells, width, height, rng, blobPower)
      break
    case 'peninsula':
      templatePeninsula(cells, width, height, rng, blobPower)
      break
    case 'mediterranean':
      templateMediterranean(cells, width, height, rng, blobPower)
      break
    case 'atoll':
      templateAtoll(cells, width, height, rng, blobPower)
      break
    case 'shattered':
      templateShattered(cells, width, height, rng, blobPower)
      break
    case 'highland':
      templateHighland(cells, width, height, rng, blobPower)
      break
    case 'continents':
    default:
      templateContinents(cells, width, height, rng, blobPower, continentCount)
      break
  }

  // 应用边缘遮罩
  for (let i = 0; i < n; i++) {
    cells.h[i] = Math.max(0, Math.min(100, Math.round(cells.h[i] * edgeMask[i])))
  }

  // 平滑
  smooth(cells, 2)

  // 调整海陆比例
  adjustSeaLevel(cells, landRatio)

  // 最终平滑
  smooth(cells, 1)
}

// ── 模板函数 ────────────────────────────────────────

/** 多大陆（默认） */
function templateContinents(
  cells: GridCells, w: number, h: number, rng: () => number,
  bp: number, continentCount: number,
) {
  for (let c = 0; c < continentCount; c++) {
    const cx = 0.2 + rng() * 0.6
    const cy = 0.2 + rng() * 0.6
    addHill(cells, findNearestCell(cells, cx * w, cy * h), 40 + rng() * 25, bp, rng)
  }
  const hillCount = 4 + Math.floor(rng() * 5)
  for (let i = 0; i < hillCount; i++) {
    addHill(cells, findNearestCell(cells, rng() * w, rng() * h), 15 + rng() * 25, bp * 1.01, rng)
  }
  const rangeCount = 1 + Math.floor(rng() * 3)
  for (let i = 0; i < rangeCount; i++) {
    addRange(cells, findNearestCell(cells, rng() * w, rng() * h),
      findNearestCell(cells, rng() * w, rng() * h), 50 + rng() * 30, rng)
  }
}

/** 盘古大陆 — 中央一整块大陆 */
function templatePangea(
  cells: GridCells, w: number, h: number, rng: () => number, bp: number,
) {
  // 中心一个超大丘陵
  addHill(cells, findNearestCell(cells, w * 0.5, h * 0.5), 60 + rng() * 15, bp * 0.98, rng)
  // 周围4个中等丘陵，让大陆不规则
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + rng() * 0.5
    const dist = 0.15 + rng() * 0.15
    const cx = 0.5 + Math.cos(angle) * dist
    const cy = 0.5 + Math.sin(angle) * dist
    addHill(cells, findNearestCell(cells, cx * w, cy * h), 30 + rng() * 20, bp, rng)
  }
  // 2-3条山脉穿过大陆
  for (let i = 0; i < 2 + Math.floor(rng() * 2); i++) {
    addRange(cells, findNearestCell(cells, (0.25 + rng() * 0.5) * w, (0.25 + rng() * 0.5) * h),
      findNearestCell(cells, (0.25 + rng() * 0.5) * w, (0.25 + rng() * 0.5) * h), 55 + rng() * 30, rng)
  }
}

/** 群岛 — 大量小岛 */
function templateArchipelago(
  cells: GridCells, w: number, h: number, rng: () => number, bp: number,
) {
  const islandCount = 10 + Math.floor(rng() * 15)
  for (let i = 0; i < islandCount; i++) {
    const cx = 0.1 + rng() * 0.8
    const cy = 0.1 + rng() * 0.8
    const size = 8 + rng() * 20
    addHill(cells, findNearestCell(cells, cx * w, cy * h), size, bp * 1.02, rng)
  }
  // 少量小山脉
  for (let i = 0; i < 2; i++) {
    addRange(cells, findNearestCell(cells, rng() * w, rng() * h),
      findNearestCell(cells, rng() * w, rng() * h), 30 + rng() * 20, rng)
  }
}

/** 火山岛 — 中心高峰 */
function templateVolcano(
  cells: GridCells, w: number, h: number, rng: () => number, bp: number,
) {
  // 中心火山
  const center = findNearestCell(cells, w * 0.5 + (rng() - 0.5) * w * 0.15, h * 0.5 + (rng() - 0.5) * h * 0.15)
  addHill(cells, center, 80, bp * 0.97, rng)
  // 几个卫星丘陵
  for (let i = 0; i < 3; i++) {
    const angle = rng() * Math.PI * 2
    const dist = 0.1 + rng() * 0.15
    addHill(cells, findNearestCell(cells, (0.5 + Math.cos(angle) * dist) * w,
      (0.5 + Math.sin(angle) * dist) * h), 15 + rng() * 15, bp * 1.01, rng)
  }
}

/** 地峡 — 两块陆地窄桥相连 */
function templateIsthmus(
  cells: GridCells, w: number, h: number, rng: () => number, bp: number,
) {
  // 左右两块大陆
  addHill(cells, findNearestCell(cells, w * 0.25, h * 0.5), 40 + rng() * 20, bp, rng)
  addHill(cells, findNearestCell(cells, w * 0.75, h * 0.5), 40 + rng() * 20, bp, rng)
  // 连接桥（山脉）
  addRange(cells, findNearestCell(cells, w * 0.35, h * 0.5),
    findNearestCell(cells, w * 0.65, h * 0.5), 25 + rng() * 10, rng)
  // 各自的小丘陵
  for (let i = 0; i < 4; i++) {
    const side = i < 2 ? 0.25 : 0.75
    addHill(cells, findNearestCell(cells, (side + (rng() - 0.5) * 0.2) * w,
      (0.3 + rng() * 0.4) * h), 15 + rng() * 15, bp * 1.01, rng)
  }
}

/** 半岛 — 大陆从一边延伸 */
function templatePeninsula(
  cells: GridCells, w: number, h: number, rng: () => number, bp: number,
) {
  // 主大陆在左侧
  addHill(cells, findNearestCell(cells, w * 0.2, h * 0.5), 50 + rng() * 20, bp * 0.99, rng)
  // 半岛向右延伸
  addRange(cells, findNearestCell(cells, w * 0.2, h * 0.5),
    findNearestCell(cells, w * 0.75, h * (0.3 + rng() * 0.4)), 35 + rng() * 20, rng)
  // 额外丘陵
  for (let i = 0; i < 3; i++) {
    addHill(cells, findNearestCell(cells, (0.1 + rng() * 0.3) * w,
      (0.2 + rng() * 0.6) * h), 20 + rng() * 15, bp * 1.01, rng)
  }
}

/** 内海/地中海 — 大陆环绕中心海域 */
function templateMediterranean(
  cells: GridCells, w: number, h: number, rng: () => number, bp: number,
) {
  // 环形大陆：上下两块弧形陆地
  // 上方弧
  for (let i = 0; i < 5; i++) {
    const angle = Math.PI * 0.2 + (i / 4) * Math.PI * 0.6
    const cx = 0.5 + Math.cos(angle) * 0.3
    const cy = 0.5 + Math.sin(angle) * 0.3
    addHill(cells, findNearestCell(cells, cx * w, cy * h), 25 + rng() * 15, bp, rng)
  }
  // 下方弧
  for (let i = 0; i < 5; i++) {
    const angle = Math.PI * 1.2 + (i / 4) * Math.PI * 0.6
    const cx = 0.5 + Math.cos(angle) * 0.3
    const cy = 0.5 + Math.sin(angle) * 0.3
    addHill(cells, findNearestCell(cells, cx * w, cy * h), 25 + rng() * 15, bp, rng)
  }
  // 山脉
  addRange(cells, findNearestCell(cells, w * 0.2, h * 0.3),
    findNearestCell(cells, w * 0.8, h * 0.3), 40 + rng() * 20, rng)
  addRange(cells, findNearestCell(cells, w * 0.2, h * 0.7),
    findNearestCell(cells, w * 0.8, h * 0.7), 40 + rng() * 20, rng)
}

/** 环礁 — 环状小岛 */
function templateAtoll(
  cells: GridCells, w: number, h: number, rng: () => number, bp: number,
) {
  const ringCount = 12 + Math.floor(rng() * 8)
  for (let i = 0; i < ringCount; i++) {
    const angle = (i / ringCount) * Math.PI * 2 + rng() * 0.3
    const dist = 0.22 + rng() * 0.08
    const cx = 0.5 + Math.cos(angle) * dist
    const cy = 0.5 + Math.sin(angle) * dist
    addHill(cells, findNearestCell(cells, cx * w, cy * h), 10 + rng() * 12, bp * 1.03, rng)
  }
  // 中心可能有小岛
  if (rng() > 0.4) {
    addHill(cells, findNearestCell(cells, w * 0.5, h * 0.5), 15 + rng() * 10, bp * 1.02, rng)
  }
}

/** 碎裂大陆 — 原本一块，现在碎了 */
function templateShattered(
  cells: GridCells, w: number, h: number, rng: () => number, bp: number,
) {
  // 先做一块大陆
  addHill(cells, findNearestCell(cells, w * 0.5, h * 0.5), 50 + rng() * 15, bp * 0.99, rng)
  // 然后用多个低洼区"切割"
  for (let i = 0; i < 6 + Math.floor(rng() * 5); i++) {
    const cx = 0.2 + rng() * 0.6
    const cy = 0.2 + rng() * 0.6
    addPit(cells, findNearestCell(cells, cx * w, cy * h), 25 + rng() * 15, bp * 1.01, rng)
  }
  // 碎片间加点丘陵
  for (let i = 0; i < 5; i++) {
    addHill(cells, findNearestCell(cells, rng() * w, rng() * h), 10 + rng() * 15, bp * 1.02, rng)
  }
}

/** 高原 — 中心大面积平坦高地 */
function templateHighland(
  cells: GridCells, w: number, h: number, rng: () => number, bp: number,
) {
  // 大面积平缓高地
  addHill(cells, findNearestCell(cells, w * 0.5, h * 0.5), 45, bp * 0.97, rng)
  addHill(cells, findNearestCell(cells, w * 0.4, h * 0.4), 40, bp * 0.97, rng)
  addHill(cells, findNearestCell(cells, w * 0.6, h * 0.6), 40, bp * 0.97, rng)
  // 边缘山脉
  addRange(cells, findNearestCell(cells, w * 0.2, h * 0.3),
    findNearestCell(cells, w * 0.8, h * 0.3), 60 + rng() * 20, rng)
  addRange(cells, findNearestCell(cells, w * 0.3, h * 0.7),
    findNearestCell(cells, w * 0.7, h * 0.7), 55 + rng() * 20, rng)
  // 高原上的平滑处理更多
  smooth(cells, 3)
}

// ── 工具函数 ────────────────────────────────────────

/** BFS 添加山丘 */
function addHill(
  cells: GridCells, start: number, baseHeight: number,
  power: number, rng: () => number,
): void {
  const change = new Float32Array(cells.length)
  change[start] = baseHeight
  const queue = [start]
  const visited = new Set<number>([start])

  while (queue.length > 0) {
    const cell = queue.shift()!
    cells.h[cell] = Math.min(100, cells.h[cell] + Math.round(change[cell]))

    for (const neighbor of cells.c[cell]) {
      if (visited.has(neighbor)) continue
      const newChange = change[cell] ** power * (0.9 + rng() * 0.2)
      if (newChange < 1) continue
      change[neighbor] = newChange
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }
}

/** BFS 挖坑（负高度） */
function addPit(
  cells: GridCells, start: number, depth: number,
  power: number, rng: () => number,
): void {
  const change = new Float32Array(cells.length)
  change[start] = depth
  const queue = [start]
  const visited = new Set<number>([start])

  while (queue.length > 0) {
    const cell = queue.shift()!
    cells.h[cell] = Math.max(0, cells.h[cell] - Math.round(change[cell]))

    for (const neighbor of cells.c[cell]) {
      if (visited.has(neighbor)) continue
      const newChange = change[cell] ** power * (0.9 + rng() * 0.2)
      if (newChange < 1) continue
      change[neighbor] = newChange
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }
}

/** 在两点间添加山脉 */
function addRange(
  cells: GridCells, start: number, end: number,
  baseHeight: number, rng: () => number,
): void {
  const ridge: number[] = [start]
  let current = start
  const endX = cells.p[end * 2]
  const endY = cells.p[end * 2 + 1]

  for (let step = 0; step < 500 && current !== end; step++) {
    let best = -1
    let bestDist = Infinity

    for (const neighbor of cells.c[current]) {
      if (ridge.includes(neighbor)) continue
      const dx = cells.p[neighbor * 2] - endX
      const dy = cells.p[neighbor * 2 + 1] - endY
      let dist = dx * dx + dy * dy
      if (rng() < 0.15) dist *= 0.5
      if (dist < bestDist) {
        bestDist = dist
        best = neighbor
      }
    }

    if (best === -1) break
    ridge.push(best)
    current = best
  }

  for (const cell of ridge) {
    cells.h[cell] = Math.min(100, cells.h[cell] + Math.round(baseHeight * (0.8 + rng() * 0.4)))
  }

  const visited = new Set(ridge)
  let frontier = [...ridge]
  let layerH = baseHeight * 0.6

  for (let layer = 0; layer < 5 && layerH > 2; layer++) {
    const nextFrontier: number[] = []
    for (const cell of frontier) {
      for (const neighbor of cells.c[cell]) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        const h = layerH * (0.7 + rng() * 0.6)
        cells.h[neighbor] = Math.min(100, cells.h[neighbor] + Math.round(h))
        nextFrontier.push(neighbor)
      }
    }
    frontier = nextFrontier
    layerH *= 0.5
  }
}

/** 平滑处理 */
function smooth(cells: GridCells, passes: number): void {
  for (let pass = 0; pass < passes; pass++) {
    const newH = new Uint8Array(cells.length)
    for (let i = 0; i < cells.length; i++) {
      const neighbors = cells.c[i]
      if (neighbors.length === 0) { newH[i] = cells.h[i]; continue }
      let sum = cells.h[i] * 2
      for (const n of neighbors) sum += cells.h[n]
      newH[i] = Math.round(sum / (neighbors.length + 2))
    }
    cells.h.set(newH)
  }
}

/** 调整海平面以达到目标海陆比例 */
function adjustSeaLevel(cells: GridCells, targetLandRatio: number): void {
  const heights = Array.from(cells.h).sort((a, b) => a - b)
  const targetWaterCount = Math.floor(cells.length * (1 - targetLandRatio))
  const seaLevel = heights[Math.min(targetWaterCount, heights.length - 1)]

  const shift = 20 - seaLevel
  for (let i = 0; i < cells.length; i++) {
    cells.h[i] = Math.max(0, Math.min(100, cells.h[i] + shift))
  }
}

/** 找到最近的单元格 */
function findNearestCell(cells: GridCells, x: number, y: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < cells.length; i++) {
    const dx = cells.p[i * 2] - x
    const dy = cells.p[i * 2 + 1] - y
    const d = dx * dx + dy * dy
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}
