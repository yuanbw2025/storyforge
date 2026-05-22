/**
 * 地理特征检测
 * 用 Flood-fill 识别海洋、岛屿、湖泊等连通区域
 */

import type { GridCells, Feature } from './types'

/** 水域阈值：高度 < 20 为水域 */
const SEA_LEVEL = 20

/** 检测所有地理特征 */
export function detectFeatures(cells: GridCells): Feature[] {
  const n = cells.length
  const assigned = new Uint8Array(n) // 0=未分配
  const features: Feature[] = [{ i: 0, type: 'ocean', cells: 0, cellIds: [], border: [] }] // 占位

  let featureId = 1

  for (let i = 0; i < n; i++) {
    if (assigned[i]) continue

    const isWater = cells.h[i] < SEA_LEVEL
    const feature: Feature = {
      i: featureId,
      type: 'ocean', // 稍后确定
      cells: 0,
      cellIds: [],
      border: [],
    }

    // BFS flood fill
    const queue = [i]
    assigned[i] = featureId
    let touchesBorder = false

    while (queue.length > 0) {
      const cell = queue.shift()!
      feature.cells++
      feature.cellIds.push(cell)
      cells.f[cell] = featureId

      if (cells.b[cell]) touchesBorder = true

      for (const neighbor of cells.c[cell]) {
        if (assigned[neighbor]) continue
        const neighborIsWater = cells.h[neighbor] < SEA_LEVEL
        if (neighborIsWater === isWater) {
          assigned[neighbor] = featureId
          queue.push(neighbor)
        }
      }
    }

    // 确定类型
    if (isWater) {
      if (touchesBorder) {
        feature.type = feature.cells > n / 25 ? 'ocean' : 'sea'
      } else {
        feature.type = 'lake'
      }
    } else {
      feature.type = feature.cells > n / 10 ? 'continent' : 'island'
    }

    features.push(feature)
    featureId++
  }

  // 计算海岸距离和港口数据
  computeCoastDistance(cells, features)
  computeHarbors(cells)

  return features
}

/** 计算每个单元格到海岸的距离 */
function computeCoastDistance(cells: GridCells, features: Feature[]): void {
  const n = cells.length

  // 第一遍：标记海岸线
  for (let i = 0; i < n; i++) {
    const isLand = cells.h[i] >= SEA_LEVEL
    for (const neighbor of cells.c[i]) {
      const neighborIsLand = cells.h[neighbor] >= SEA_LEVEL
      if (isLand !== neighborIsLand) {
        cells.t[i] = isLand ? 1 : -1
        break
      }
    }
  }

  // 识别海岸单元格归入 feature.border
  for (let i = 0; i < n; i++) {
    if (cells.t[i] !== 0) {
      const fId = cells.f[i]
      if (features[fId]) features[fId].border.push(i)
    }
  }

  // BFS 传播距离：陆地 2, 3, 4... 水域 -2, -3, -4...
  const queue: number[] = []
  for (let i = 0; i < n; i++) {
    if (cells.t[i] !== 0) queue.push(i)
  }

  while (queue.length > 0) {
    const cell = queue.shift()!
    const isLand = cells.t[cell] > 0
    const nextDist = isLand ? cells.t[cell] + 1 : cells.t[cell] - 1

    if (Math.abs(nextDist) > 20) continue // 最大距离

    for (const neighbor of cells.c[cell]) {
      if (cells.t[neighbor] !== 0) continue
      const neighborIsLand = cells.h[neighbor] >= SEA_LEVEL
      if (neighborIsLand === isLand) {
        cells.t[neighbor] = nextDist
        queue.push(neighbor)
      }
    }
  }
}

/** 计算港口数据 */
function computeHarbors(cells: GridCells): void {
  for (let i = 0; i < cells.length; i++) {
    if (cells.h[i] < SEA_LEVEL) continue // 水域无港口

    let waterCount = 0
    let nearestWater = 0
    let minDist = Infinity

    for (const neighbor of cells.c[i]) {
      if (cells.h[neighbor] < SEA_LEVEL) {
        waterCount++
        const dx = cells.p[neighbor * 2] - cells.p[i * 2]
        const dy = cells.p[neighbor * 2 + 1] - cells.p[i * 2 + 1]
        const d = dx * dx + dy * dy
        if (d < minDist) {
          minDist = d
          nearestWater = neighbor
        }
      }
    }

    cells.harbor[i] = waterCount
    cells.haven[i] = nearestWater
  }
}
