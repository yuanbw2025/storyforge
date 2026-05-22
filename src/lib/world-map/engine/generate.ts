/**
 * 地图生成主管线
 * 按顺序执行所有生成步骤
 */

import type { MapGenConfig, VoronoiMapData } from './types'
import { seedRandom } from './random'
import { generatePoints, buildVoronoi } from './grid'
import { generateHeightmap } from './heightmap'
import { detectFeatures } from './features'
import { calculateTemperature, calculatePrecipitation, assignBiomes, rankCells } from './climate'
import { generateRivers } from './rivers'
import { generateCultures, generateBurgs, generateStates, generateProvinces, generateRoads } from './nations'
import { setNamingStyle } from './name-pool'

/** 生成完整地图 */
export function generateMap(config: MapGenConfig = {}): VoronoiMapData {
  const {
    width = 1200,
    height = 800,
    seed = String(Math.floor(Math.random() * 1e10)),
    pointCount = 10000,
    landRatio = 0.45,
    continentCount = 2,
    stateCount = 8,
    burgDensity = 0.5,
    temperatureShift = 0,
    precipitationFactor = 1.0,
    mapName = 'Fantasy World',
    heightmapTemplate = 'continents',
    namingStyle = 'chinese',
    generateProvinces: doProvinces = true,
    generateRoads: doRoads = true,
    stateNames,
    burgNames,
    riverNames,
  } = config

  const rng = seedRandom(seed)

  // 设置命名风格
  setNamingStyle(namingStyle)

  console.time('[MapEngine] Total generation')

  // 1. 生成 Voronoi 网格
  console.time('[MapEngine] Grid')
  const points = generatePoints(width, height, pointCount, rng)
  const { cells, vertices } = buildVoronoi(points, width, height)
  console.timeEnd('[MapEngine] Grid')

  // 2. 生成高度图（支持模板）
  console.time('[MapEngine] Heightmap')
  generateHeightmap(cells, width, height, rng, landRatio, continentCount, heightmapTemplate)
  console.timeEnd('[MapEngine] Heightmap')

  // 3. 检测地理特征（岛屿、湖泊、海洋）
  console.time('[MapEngine] Features')
  const features = detectFeatures(cells)
  console.timeEnd('[MapEngine] Features')

  // 4. 气候：温度、降水量
  console.time('[MapEngine] Climate')
  calculateTemperature(cells, height, temperatureShift)
  calculatePrecipitation(cells, height, precipitationFactor, rng)
  console.timeEnd('[MapEngine] Climate')

  // 5. 河流
  console.time('[MapEngine] Rivers')
  const rivers = generateRivers(cells, rng)
  if (riverNames) {
    for (let i = 0; i < Math.min(rivers.length, riverNames.length); i++) {
      rivers[i].name = riverNames[i]
    }
  }
  console.timeEnd('[MapEngine] Rivers')

  // 6. 生态群落
  console.time('[MapEngine] Biomes')
  assignBiomes(cells)
  console.timeEnd('[MapEngine] Biomes')

  // 7. 适宜度评分
  rankCells(cells)

  // 8. 人口分布
  for (let i = 0; i < cells.length; i++) {
    cells.pop[i] = cells.s[i] > 0 ? cells.s[i] * (0.5 + rng() * 0.5) : 0
  }

  // 9. 文化
  console.time('[MapEngine] Cultures')
  const cultureCount = Math.max(3, Math.floor(stateCount * 0.8))
  const cultures = generateCultures(cells, cultureCount, rng)
  console.timeEnd('[MapEngine] Cultures')

  // 10. 城镇
  console.time('[MapEngine] Burgs')
  const burgs = generateBurgs(cells, stateCount, burgDensity, width, height, rng, burgNames)
  console.timeEnd('[MapEngine] Burgs')

  // 11. 国家
  console.time('[MapEngine] States')
  const states = generateStates(cells, burgs, stateCount, rng, stateNames)
  console.timeEnd('[MapEngine] States')

  // 12. 省份
  let provinces = [{ i: 0, name: '', color: '#ccc', state: 0, capital: 0, cells: 0 }]
  if (doProvinces) {
    console.time('[MapEngine] Provinces')
    provinces = generateProvinces(cells, states, burgs, rng)
    console.timeEnd('[MapEngine] Provinces')
  }

  // 13. 道路
  let roads: VoronoiMapData['roads'] = []
  if (doRoads) {
    console.time('[MapEngine] Roads')
    roads = generateRoads(cells, burgs, states, rng)
    console.timeEnd('[MapEngine] Roads')
  }

  console.timeEnd('[MapEngine] Total generation')

  return {
    width,
    height,
    seed,
    cells,
    vertices,
    features,
    rivers,
    burgs,
    states,
    cultures,
    provinces,
    roads,
    name: mapName,
  }
}
