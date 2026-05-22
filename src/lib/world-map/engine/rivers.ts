/**
 * 河流生成
 * 从高处往低处流，累积水流量
 */

import type { GridCells, River } from './types'
import { getRiverName } from './name-pool'

const SEA_LEVEL = 20
const MIN_FLUX = 20 // 形成河流的最小水流量

/** 生成河流 */
export function generateRivers(
  cells: GridCells,
  rng: () => number,
): River[] {
  const n = cells.length

  // 1. 解决洼地：抬高比所有邻居都低的陆地单元格
  resolveDepressions(cells)

  // 2. 计算排水方向和水流量
  const drainage = new Int32Array(n).fill(-1) // 每个单元格的下游单元格
  const flux = new Float32Array(n)

  // 初始化：每个陆地单元格根据降水量贡献水流
  for (let i = 0; i < n; i++) {
    if (cells.h[i] >= SEA_LEVEL) {
      flux[i] = cells.prec[i] / 5
    }
  }

  // 按高度从高到低排序陆地单元格
  const sorted = Array.from({ length: n }, (_, i) => i)
    .filter(i => cells.h[i] >= SEA_LEVEL)
    .sort((a, b) => cells.h[b] - cells.h[a])

  // 3. 从高到低流水
  for (const cell of sorted) {
    // 找最低邻居
    let lowest = -1
    let lowestH = cells.h[cell]

    for (const neighbor of cells.c[cell]) {
      if (cells.h[neighbor] < lowestH) {
        lowestH = cells.h[neighbor]
        lowest = neighbor
      }
    }

    // 如果是海岸单元格，流向最近水域
    if (lowest === -1 && cells.harbor[cell] > 0) {
      lowest = cells.haven[cell]
    }

    if (lowest !== -1) {
      drainage[cell] = lowest
      flux[lowest] += flux[cell]
    }
  }

  // 保存流量
  cells.fl.set(flux)

  // 4. 提取河流路径
  const rivers: River[] = []
  const assigned = new Uint16Array(n) // 每个单元格的河流 ID
  let riverId = 1

  // 按流量降序找河流源头
  const sources = sorted
    .filter(i => flux[i] >= MIN_FLUX && drainage[i] !== -1 && assigned[i] === 0)
    .sort((a, b) => flux[b] - flux[a])

  for (const source of sources) {
    // 向上游追溯找真正的源头
    let trueSource = source
    // 只从还没被分配的、有足够流量的开始
    if (assigned[trueSource]) continue

    // 沿排水方向向下追踪
    const path: number[] = [trueSource]
    let current = trueSource
    let mouth = trueSource

    for (let step = 0; step < 1000; step++) {
      const next = drainage[current]
      if (next === -1 || next === current) break

      // 汇入已有河流 → 停止
      if (assigned[next] && assigned[next] !== riverId) {
        mouth = current
        break
      }

      path.push(next)
      current = next

      // 到达水域 → 停止
      if (cells.h[next] < SEA_LEVEL) {
        mouth = next
        break
      }
    }

    if (path.length < 3) continue // 太短的河流不要

    // 创建河流
    const river: River = {
      i: riverId,
      name: getRiverName(riverId - 1),
      cells: path,
      points: [],
      widths: [],
      mouth,
      source: trueSource,
    }

    // 生成渲染用的路径点和宽度
    for (let j = 0; j < path.length; j++) {
      const c = path[j]
      const x = cells.p[c * 2]
      const y = cells.p[c * 2 + 1]

      // 添加蜿蜒偏移
      const step = j / path.length
      const meander = 0.5 + 1 / (j + 1) + Math.max(0.5 - step, 0)
      const offset = Math.sin(j * 1.5 + rng() * 3) * meander * 3
      const angle = j < path.length - 1
        ? Math.atan2(
            cells.p[path[j + 1] * 2 + 1] - y,
            cells.p[path[j + 1] * 2] - x,
          )
        : 0
      const px = x + Math.cos(angle + Math.PI / 2) * offset
      const py = y + Math.sin(angle + Math.PI / 2) * offset

      river.points.push([px, py])

      // 宽度：源头窄，下游宽
      const fluxWidth = Math.min(flux[c] ** 0.5 / 15, 4)
      const lengthWidth = (j / path.length) * 2
      river.widths.push(0.5 + fluxWidth + lengthWidth)

      assigned[c] = riverId
      cells.r[c] = riverId
    }

    rivers.push(river)
    riverId++

    if (rivers.length > 50) break // 限制河流数量
  }

  return rivers
}

/** 解决洼地：抬高无法排水的陆地单元格 */
function resolveDepressions(cells: GridCells): void {
  const n = cells.length

  for (let iter = 0; iter < 100; iter++) {
    let changed = false

    for (let i = 0; i < n; i++) {
      if (cells.h[i] < SEA_LEVEL) continue
      if (cells.harbor[i] > 0) continue // 海岸单元格可以排入海洋

      // 检查是否有比自己低的邻居
      let hasLower = false
      let minNeighborH = 255

      for (const neighbor of cells.c[i]) {
        if (cells.h[neighbor] < cells.h[i]) {
          hasLower = true
          break
        }
        minNeighborH = Math.min(minNeighborH, cells.h[neighbor])
      }

      if (!hasLower && minNeighborH < 100) {
        // 抬高到比最低邻居高 1
        cells.h[i] = Math.min(100, minNeighborH + 1)
        changed = true
      }
    }

    if (!changed) break
  }
}
