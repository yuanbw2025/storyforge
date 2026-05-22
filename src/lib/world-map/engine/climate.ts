/**
 * 气候系统：温度、降水量、生态群落
 */

import type { GridCells, BiomeDef } from './types'

/** 生态群落定义 — 标准等高线地形图配色 */
export const BIOMES: BiomeDef[] = [
  { id: 0, name: '海洋',       color: '#6baed6', habitability: 0,   moveCost: 10 },
  { id: 1, name: '热带沙漠',   color: '#e8d5a3', habitability: 4,   moveCost: 200 },
  { id: 2, name: '寒带荒漠',   color: '#c9b98a', habitability: 10,  moveCost: 150 },
  { id: 3, name: '热带草原',   color: '#c6e2a0', habitability: 22,  moveCost: 60 },
  { id: 4, name: '温带草原',   color: '#a8d86e', habitability: 30,  moveCost: 50 },
  { id: 5, name: '热带季风林', color: '#6abf5b', habitability: 50,  moveCost: 70 },
  { id: 6, name: '温带落叶林', color: '#3da33d', habitability: 100, moveCost: 70 },
  { id: 7, name: '热带雨林',   color: '#1e8a1e', habitability: 80,  moveCost: 80 },
  { id: 8, name: '温带雨林',   color: '#2d8c2d', habitability: 90,  moveCost: 90 },
  { id: 9, name: '针叶林',     color: '#4a7a3b', habitability: 12,  moveCost: 200 },
  { id: 10, name: '苔原',      color: '#b8c9a0', habitability: 4,   moveCost: 1000 },
  { id: 11, name: '冰川',      color: '#eaf0f6', habitability: 0,   moveCost: 5000 },
  { id: 12, name: '湿地',      color: '#7fb5a0', habitability: 12,  moveCost: 150 },
]

/**
 * 生态群落查找矩阵
 * 行: 湿润度 (0=干燥, 4=湿润)
 * 列: 温度 (0=热, 25=冷)
 */
const BIOME_MATRIX: number[][] = [
  // 干燥 → 湿润 (每行 26 列, 从热→冷)
  [1, 1, 1, 1, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11], // 极干
  [3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11],   // 干
  [5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 9, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11],     // 中等
  [5, 5, 7, 7, 7, 7, 6, 6, 6, 6, 6, 8, 8, 8, 9, 9, 9, 9, 9, 10, 10, 10, 11, 11, 11, 11],     // 湿
  [7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 10, 10, 10, 11, 11, 11, 11],     // 极湿
]

/** 计算温度 */
export function calculateTemperature(
  cells: GridCells,
  height: number,
  temperatureShift = 0,
): void {
  for (let i = 0; i < cells.length; i++) {
    const y = cells.p[i * 2 + 1]
    // 纬度效应：赤道(y=height/2)最热，两极最冷
    const lat = Math.abs(y / height - 0.5) * 2 // 0=赤道, 1=极地
    let temp = 30 - lat * 55 // 30°C 到 -25°C

    // 海拔效应：每升高 1 单位（约 100m），降温 0.6°C
    const h = cells.h[i]
    if (h >= 20) {
      temp -= (h - 20) * 0.4
    }

    // 沿海效应：靠海的单元格温度更温和
    if (Math.abs(cells.t[i]) <= 2 && cells.t[i] > 0) {
      temp = temp * 0.85 + 15 * 0.15 // 拉向 15°C
    }

    cells.temp[i] = Math.round(temp + temperatureShift)
  }
}

/** 计算降水量 */
export function calculatePrecipitation(
  cells: GridCells,
  height: number,
  factor = 1.0,
  rng: () => number,
): void {
  for (let i = 0; i < cells.length; i++) {
    const y = cells.p[i * 2 + 1]
    const lat = Math.abs(y / height - 0.5) * 2

    // 基础降水：赤道多，极地少，中纬度中等
    let prec = 0
    if (lat < 0.3) prec = 80 + rng() * 20 // 赤道多雨
    else if (lat < 0.5) prec = 30 + rng() * 30 // 亚热带干燥
    else if (lat < 0.7) prec = 50 + rng() * 30 // 温带中等
    else prec = 20 + rng() * 20 // 极地少雨

    // 沿海效应：靠海更湿润
    if (cells.t[i] > 0 && cells.t[i] <= 3) {
      prec += 20
    }

    // 高海拔增加降水（迎风坡效应简化）
    const h = cells.h[i]
    if (h > 50) prec += (h - 50) * 0.3

    cells.prec[i] = Math.min(255, Math.round(prec * factor))
  }
}

/** 指定生态群落 */
export function assignBiomes(cells: GridCells): void {
  for (let i = 0; i < cells.length; i++) {
    const h = cells.h[i]
    const temp = cells.temp[i]
    const prec = cells.prec[i]

    // 水域 → 海洋
    if (h < 20) { cells.biome[i] = 0; continue }

    // 冰川
    if (temp < -5) { cells.biome[i] = 11; continue }

    // 热带沙漠
    if (temp >= 25 && prec < 20 && cells.r[i] === 0) { cells.biome[i] = 1; continue }

    // 湿地
    const moisture = prec + (cells.fl[i] > 0 ? Math.min(cells.fl[i] / 10, 20) : 0)
    if (moisture > 80 && h < 30) { cells.biome[i] = 12; continue }

    // 查表
    const moistureIdx = Math.min(Math.floor(moisture / 25), 4)
    const tempIdx = Math.min(Math.max(Math.floor((25 - temp)), 0), 25)

    cells.biome[i] = BIOME_MATRIX[moistureIdx][tempIdx]
  }
}

/** 计算单元格适宜度评分 */
export function rankCells(cells: GridCells): void {
  for (let i = 0; i < cells.length; i++) {
    if (cells.h[i] < 20) { cells.s[i] = 0; continue }

    const biome = BIOMES[cells.biome[i]]
    let score = biome.habitability

    // 河流加分
    if (cells.r[i] > 0) score += 15

    // 港口加分
    if (cells.harbor[i] > 0) score += 10

    // 海拔过高减分
    if (cells.h[i] > 70) score -= (cells.h[i] - 70) * 2

    // 靠近海岸加分
    if (cells.t[i] > 0 && cells.t[i] <= 3) score += 5

    cells.s[i] = Math.max(0, score)
  }
}
