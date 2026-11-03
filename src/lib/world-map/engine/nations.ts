/**
 * 国家和城市生成
 * 城市：按适宜度评分放置
 * 国家：从首都 Dijkstra 扩张
 */

import type {
  GridCells,
  Burg,
  State,
  Culture,
  Province,
  Road,
  MapSpatialEntity,
  SpatialPlacement,
  SpatialScaleTier,
} from './types'
import { BIOMES } from './climate'
import { getStateName, getCapitalName, getTownName, getCultureName, getProvinceName } from './name-pool'

const SEA_LEVEL = 20

// ── 颜色池 ──
const STATE_COLORS = [
  '#4e79a7', '#e15759', '#f28e2b', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  '#86bcb6', '#8cd17d', '#b6992d', '#499894', '#e15759',
  '#f1ce63', '#d37295', '#a0cbe8', '#fabfd2', '#d4a6c8',
]

/** 放置城镇 */
export function generateBurgs(
  cells: GridCells,
  stateCount: number,
  burgDensity: number,
  width: number,
  height: number,
  rng: () => number,
  burgNames?: string[],
  spatialEntities: MapSpatialEntity[] = [],
  spatialPlacements: SpatialPlacement[] = [],
): Burg[] {
  const burgs: Burg[] = [{ i: 0, name: '', cell: 0, x: 0, y: 0, state: 0, capital: false, port: false, population: 0 }]

  // 收集可用的陆地单元格，按适宜度排序
  const candidates = Array.from({ length: cells.length }, (_, i) => i)
    .filter(i => cells.h[i] >= SEA_LEVEL && cells.s[i] > 5)
    .sort((a, b) => cells.s[b] * (0.5 + rng()) - cells.s[a] * (0.5 + rng()))

  if (candidates.length === 0) return burgs

  // 最小间距（避免城市太密集）
  const spacing = Math.sqrt((width * height) / (stateCount * 4))

  const entityByName = new Map(spatialEntities.map(entity => [entity.name, entity]))
  const placementByName = new Map(spatialPlacements.map(placement => [placement.name, placement]))

  // 放置首都
  const placed: number[] = []
  for (let index = 0; index < stateCount; index++) {
    const name = burgNames?.[index] || getCapitalName(index)
    const target = placementByName.get(name)
    const cell = target
      ? nearestAvailableCell(cells, candidates, new Set(placed), target.x, target.y)
      : candidates.find(candidate => !placed.includes(candidate) && !isTooClose(cells, candidate, placed, spacing))
    if (cell == null) break
    placed.push(cell)
  }

  // 首都
  for (let i = 0; i < placed.length; i++) {
    const cell = placed[i]
    const name = burgNames?.[i] || getCapitalName(i)
    const scaleTier = entityByName.get(name)?.scaleTier ?? placementByName.get(name)?.scaleTier
    const burg: Burg = {
      i: burgs.length,
      name,
      cell,
      x: cells.p[cell * 2],
      y: cells.p[cell * 2 + 1],
      state: i + 1,
      capital: true,
      port: cells.harbor[cell] > 0,
      population: Math.round(cells.s[cell] * (1 + rng()) * 2 * burgPopulationFactor(scaleTier)),
      scaleTier,
    }

    // 港口城市移向海岸
    if (burg.port && cells.haven[cell]) {
      const haven = cells.haven[cell]
      burg.x = burg.x * 0.7 + cells.p[haven * 2] * 0.3
      burg.y = burg.y * 0.7 + cells.p[haven * 2 + 1] * 0.3
    }

    burgs.push(burg)
    cells.burg[cell] = burg.i
  }

  // 放置城镇
  const townSpacing = spacing * 0.4
  const namedTownCount = Math.max(0, (burgNames?.length ?? 0) - placed.length)
  const townCount = Math.max(namedTownCount, Math.floor(candidates.length * burgDensity * 0.02))
  let townPlaced = 0
  const allBurgCells = placed.slice()
  const occupied = new Set(allBurgCells)
  const preplacedNames = new Set<string>()

  // 先落实带约束的命名城镇/要塞，距离优先于随机撒点。
  for (const name of burgNames?.slice(placed.length) ?? []) {
    const target = placementByName.get(name)
    if (!target) continue
    const cell = nearestAvailableCell(cells, candidates, occupied, target.x, target.y)
    if (cell == null) continue
    addTown(cells, burgs, cell, name, rng, entityByName.get(name)?.scaleTier ?? target.scaleTier)
    occupied.add(cell)
    allBurgCells.push(cell)
    preplacedNames.add(name)
    townPlaced++
  }

  const pendingNames = (burgNames?.slice(placed.length) ?? [])
    .filter(name => !preplacedNames.has(name))

  for (const cell of candidates) {
    if (townPlaced >= townCount) break
    if (cells.burg[cell]) continue
    if (isTooClose(cells, cell, allBurgCells, townSpacing)) continue

    const name = pendingNames.shift() || getTownName(townPlaced)
    addTown(cells, burgs, cell, name, rng, entityByName.get(name)?.scaleTier)
    allBurgCells.push(cell)
    occupied.add(cell)
    townPlaced++
  }

  return burgs
}

/** 生成国家（从首都 Dijkstra 扩张） */
export function generateStates(
  cells: GridCells,
  burgs: Burg[],
  _stateCount: number,
  rng: () => number,
  stateNames?: string[],
  spatialEntities: MapSpatialEntity[] = [],
): State[] {
  const states: State[] = [{ i: 0, name: '无主之地', color: '#ccc', capital: 0, expansionism: 0, cells: 0, area: 0, totalPopulation: 0 }]

  // 创建国家（每个首都一个）
  const capitals = burgs.filter(b => b.capital)
  const stateEntityByName = new Map(
    spatialEntities.filter(entity => entity.kind === 'state').map(entity => [entity.name, entity]),
  )
  for (let i = 0; i < capitals.length; i++) {
    const burg = capitals[i]
    const name = stateNames?.[i] || getStateName(i)
    const scaleTier = stateEntityByName.get(name)?.scaleTier
    const state: State = {
      i: states.length,
      name,
      color: STATE_COLORS[i % STATE_COLORS.length],
      capital: burg.i,
      expansionism: (0.8 + rng() * 1.5) * stateExpansionFactor(scaleTier),
      cells: 0,
      area: 0,
      totalPopulation: 0,
      scaleTier,
    }
    states.push(state)
    burg.state = state.i
  }

  // Dijkstra 扩张
  expandStates(cells, states, burgs)

  // 分配城镇到所在国家
  for (const burg of burgs) {
    if (burg.i === 0) continue
    if (!burg.capital) {
      burg.state = cells.state[burg.cell]
    }
  }

  // 统计
  for (const state of states) {
    if (state.i === 0) continue
    let cellCount = 0
    let pop = 0
    for (let i = 0; i < cells.length; i++) {
      if (cells.state[i] === state.i) {
        cellCount++
        pop += cells.pop[i]
      }
    }
    state.cells = cellCount
    state.totalPopulation = pop
  }

  return states
}

/** Dijkstra 领土扩张 */
function expandStates(cells: GridCells, states: State[], burgs: Burg[]): void {
  const n = cells.length
  const cost = new Float64Array(n).fill(Infinity)

  // 优先队列（简单实现）
  const queue: { cell: number; state: number; cost: number }[] = []

  // 从每个首都开始
  for (const state of states) {
    if (state.i === 0) continue
    const burg = burgs[state.capital]
    if (!burg) continue

    cost[burg.cell] = 0
    cells.state[burg.cell] = state.i
    queue.push({ cell: burg.cell, state: state.i, cost: 0 })
  }

  // 按 cost 排序
  queue.sort((a, b) => a.cost - b.cost)

  const maxCost = n * 0.8

  while (queue.length > 0) {
    const { cell, state: stateId, cost: currentCost } = queue.shift()!

    if (currentCost > cost[cell]) continue

    const stateData = states[stateId]
    if (!stateData) continue

    for (const neighbor of cells.c[cell]) {
      if (cells.h[neighbor] < SEA_LEVEL) continue // 不越过海洋

      // 计算移动成本
      const biome = BIOMES[cells.biome[neighbor]]
      let moveCost = biome.moveCost / 10

      // 文化差异惩罚
      if (cells.culture[neighbor] && cells.culture[cell] &&
          cells.culture[neighbor] !== cells.culture[cell]) {
        moveCost += 50
      }

      // 无人区惩罚
      if (cells.s[neighbor] < 1) moveCost += 200

      // 山地惩罚
      if (cells.h[neighbor] > 70) moveCost += (cells.h[neighbor] - 70) * 5

      const totalCost = currentCost + moveCost / stateData.expansionism

      if (totalCost < cost[neighbor] && totalCost < maxCost) {
        cost[neighbor] = totalCost
        cells.state[neighbor] = stateId

        // 插入排序
        const entry = { cell: neighbor, state: stateId, cost: totalCost }
        const idx = queue.findIndex(q => q.cost > totalCost)
        if (idx === -1) queue.push(entry)
        else queue.splice(idx, 0, entry)
      }
    }
  }

  // 平滑：去除孤立单元格
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      if (cells.h[i] < SEA_LEVEL || cells.state[i] === 0) continue

      const neighborStates: Record<number, number> = {}
      for (const neighbor of cells.c[i]) {
        if (cells.state[neighbor] > 0) {
          neighborStates[cells.state[neighbor]] = (neighborStates[cells.state[neighbor]] || 0) + 1
        }
      }

      // 如果被其他国家包围，切换到多数国家
      const myCount = neighborStates[cells.state[i]] || 0
      for (const [sid, count] of Object.entries(neighborStates)) {
        if (count > myCount + 1 && +sid !== cells.state[i]) {
          cells.state[i] = +sid
          break
        }
      }
    }
  }
}

/** 简单文化生成（为国家扩张提供依据） */
export function generateCultures(
  cells: GridCells,
  count: number,
  rng: () => number,
): Culture[] {
  const cultures: Culture[] = [{ i: 0, name: '蛮荒', color: '#ccc', center: 0, type: 'generic', expansionism: 0 }]

  // 找到高适宜度的陆地单元格作为文化中心
  const candidates = Array.from({ length: cells.length }, (_, i) => i)
    .filter(i => cells.h[i] >= SEA_LEVEL && cells.s[i] > 10)
    .sort((a, b) => cells.s[b] - cells.s[a])

  const spacing = Math.sqrt((cells.p[0] || 1000) * 2 / count) * 3
  const placed: number[] = []

  for (const cell of candidates) {
    if (placed.length >= count) break
    if (isTooClose(cells, cell, placed, spacing)) continue

    const culture: Culture = {
      i: cultures.length,
      name: getCultureName(cultures.length - 1),
      color: STATE_COLORS[(cultures.length - 1) % STATE_COLORS.length],
      center: cell,
      type: cells.harbor[cell] > 0 ? 'naval'
        : cells.h[cell] > 60 ? 'highland'
        : cells.r[cell] > 0 ? 'river'
        : 'generic',
      expansionism: 0.5 + rng() * 1.5,
    }

    cultures.push(culture)
    placed.push(cell)
  }

  // 简单扩张：每个单元格分配到最近的文化中心
  for (let i = 0; i < cells.length; i++) {
    if (cells.h[i] < SEA_LEVEL) continue

    let bestCulture = 0
    let bestDist = Infinity

    for (const culture of cultures) {
      if (culture.i === 0) continue
      const dx = cells.p[i * 2] - cells.p[culture.center * 2]
      const dy = cells.p[i * 2 + 1] - cells.p[culture.center * 2 + 1]
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        bestCulture = culture.i
      }
    }

    cells.culture[i] = bestCulture
  }

  return cultures
}

/** 检查是否距离已放置点太近 */
function isTooClose(cells: GridCells, cell: number, placed: number[], minDist: number): boolean {
  const x = cells.p[cell * 2]
  const y = cells.p[cell * 2 + 1]
  const minDist2 = minDist * minDist

  for (const other of placed) {
    const dx = x - cells.p[other * 2]
    const dy = y - cells.p[other * 2 + 1]
    if (dx * dx + dy * dy < minDist2) return true
  }

  return false
}

function nearestAvailableCell(
  cells: GridCells,
  candidates: number[],
  occupied: Set<number>,
  targetX: number,
  targetY: number,
): number | undefined {
  let bestCell: number | undefined
  let bestScore = Infinity
  for (const cell of candidates) {
    if (occupied.has(cell) || cells.burg[cell]) continue
    const dx = cells.p[cell * 2] - targetX
    const dy = cells.p[cell * 2 + 1] - targetY
    // 以距离为主，在距离接近时偏好更宜居的陆地。
    const score = dx * dx + dy * dy - Math.min(cells.s[cell], 100) * 4
    if (score < bestScore) {
      bestScore = score
      bestCell = cell
    }
  }
  return bestCell
}

function addTown(
  cells: GridCells,
  burgs: Burg[],
  cell: number,
  name: string,
  rng: () => number,
  scaleTier?: SpatialScaleTier,
): void {
  const burg: Burg = {
    i: burgs.length,
    name,
    cell,
    x: cells.p[cell * 2],
    y: cells.p[cell * 2 + 1],
    state: 0,
    capital: false,
    port: cells.harbor[cell] > 0,
    population: Math.round(cells.s[cell] * (0.5 + rng()) * burgPopulationFactor(scaleTier)),
    scaleTier,
  }
  if (burg.port && cells.haven[cell]) {
    const haven = cells.haven[cell]
    burg.x = burg.x * 0.8 + cells.p[haven * 2] * 0.2
    burg.y = burg.y * 0.8 + cells.p[haven * 2 + 1] * 0.2
  }
  burgs.push(burg)
  cells.burg[cell] = burg.i
}

function burgPopulationFactor(tier?: SpatialScaleTier): number {
  switch (tier) {
    case 'metropolis': return 3
    case 'city': return 2
    case 'town': return 1.25
    case 'village': return 0.55
    case 'fortress': return 0.85
    default: return 1
  }
}

function stateExpansionFactor(tier?: SpatialScaleTier): number {
  switch (tier) {
    case 'empire': return 1.6
    case 'kingdom': return 1.3
    case 'province': return 0.85
    default: return 1
  }
}

// ── 省份生成 ────────────────────────────────────────

/** 为每个国家生成省份 */
export function generateProvinces(
  cells: GridCells,
  states: State[],
  burgs: Burg[],
  rng: () => number,
): Province[] {
  const provinces: Province[] = [{ i: 0, name: '', color: '#ccc', state: 0, capital: 0, cells: 0 }]

  // 为每个国家的每个城镇创建一个省份（Voronoi 划分）
  for (const state of states) {
    if (state.i === 0) continue

    // 找出该国家所有城镇
    const stateBurgs = burgs.filter(b => b.state === state.i && b.i > 0)
    if (stateBurgs.length === 0) continue

    // 每个城镇作为省会
    const provIds: number[] = []
    for (let bi = 0; bi < stateBurgs.length; bi++) {
      const burg = stateBurgs[bi]
      const prov: Province = {
        i: provinces.length,
        name: getProvinceName(provinces.length - 1),
        color: lightenColor(state.color, (rng() - 0.5) * 30),
        state: state.i,
        capital: burg.i,
        cells: 0,
      }
      provinces.push(prov)
      provIds.push(prov.i)
    }

    // 按最近城镇分配该国家的单元格到省份
    for (let i = 0; i < cells.length; i++) {
      if (cells.state[i] !== state.i) continue

      let bestProv = provIds[0]
      let bestDist = Infinity

      for (let pi = 0; pi < stateBurgs.length; pi++) {
        const burg = stateBurgs[pi]
        const dx = cells.p[i * 2] - burg.x
        const dy = cells.p[i * 2 + 1] - burg.y
        const dist = dx * dx + dy * dy
        if (dist < bestDist) {
          bestDist = dist
          bestProv = provIds[pi]
        }
      }

      // 使用 culture 数组临时存省份（或可加新字段，这里复用不冲突）
      // 实际上我们不修改 cells，省份信息存在 Province 对象中
      provinces[bestProv].cells++
    }
  }

  return provinces
}

/** 颜色亮度微调 */
function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xFF) + amount))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + amount))
  const b = Math.max(0, Math.min(255, (num & 0xFF) + amount))
  return `#${(0x1000000 + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1)}`
}

// ── 道路生成 ────────────────────────────────────────

/** 生成城镇之间的道路 */
export function generateRoads(
  cells: GridCells,
  burgs: Burg[],
  _states: State[],
  rng: () => number,
): Road[] {
  const roads: Road[] = []
  const activeBurgs = burgs.filter(b => b.i > 0)
  if (activeBurgs.length < 2) return roads

  let roadId = 1

  // 1. 主干道：每个首都连接最近的 2-3 个首都
  const capitals = activeBurgs.filter(b => b.capital)
  for (const cap of capitals) {
    const sorted = capitals
      .filter(c => c.i !== cap.i)
      .map(c => ({
        burg: c,
        dist: (c.x - cap.x) ** 2 + (c.y - cap.y) ** 2,
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 2 + Math.floor(rng()))

    for (const { burg: target } of sorted) {
      // 避免重复路线（A→B 和 B→A）
      if (roads.some(r => r.type === 'major' &&
        ((r.cells[0] === cap.cell && r.cells[r.cells.length - 1] === target.cell) ||
         (r.cells[0] === target.cell && r.cells[r.cells.length - 1] === cap.cell)))) continue

      const path = findPath(cells, cap.cell, target.cell)
      if (path.length < 2) continue

      roads.push({
        i: roadId++,
        name: `${cap.name}—${target.name}`,
        type: 'major',
        cells: path,
        points: path.map(c => [cells.p[c * 2], cells.p[c * 2 + 1]] as [number, number]),
      })
    }
  }

  // 2. 支路：每个城镇连接最近的首都或大城镇
  const towns = activeBurgs.filter(b => !b.capital)
  for (const town of towns) {
    // 找最近的首都
    let nearest: Burg | null = null
    let nearDist = Infinity
    for (const cap of capitals) {
      if (cap.state !== town.state && rng() > 0.3) continue // 跨国连接概率低
      const d = (cap.x - town.x) ** 2 + (cap.y - town.y) ** 2
      if (d < nearDist) {
        nearDist = d
        nearest = cap
      }
    }

    if (!nearest) continue
    // 距离太远的跳过
    if (nearDist > (cells.length * 0.1) ** 2) continue

    const path = findPath(cells, town.cell, nearest.cell)
    if (path.length < 2 || path.length > 80) continue

    roads.push({
      i: roadId++,
      name: `${town.name}道`,
      type: 'minor',
      cells: path,
      points: path.map(c => [cells.p[c * 2], cells.p[c * 2 + 1]] as [number, number]),
    })

    if (roads.length > 60) break // 限制道路数量
  }

  // 3. 商路：连接有港口的城镇（海上贸易）
  const ports = activeBurgs.filter(b => b.port)
  for (let i = 0; i < ports.length && roads.length < 80; i++) {
    for (let j = i + 1; j < ports.length; j++) {
      const a = ports[i], b = ports[j]
      const dist = (a.x - b.x) ** 2 + (a.y - b.y) ** 2
      // 只连接相对近的港口
      if (dist > (cells.length * 0.15) ** 2) continue
      if (rng() > 0.4) continue // 不是所有港口都有航线

      roads.push({
        i: roadId++,
        name: `${a.name}—${b.name}航线`,
        type: 'sea',
        cells: [a.cell, b.cell],
        points: [[a.x, a.y], [b.x, b.y]],
      })
    }
  }

  return roads
}

/** A* 寻路（陆地，沿 Voronoi 邻居） */
function findPath(cells: GridCells, start: number, end: number): number[] {
  if (start === end) return [start]

  const n = cells.length
  const cost = new Float32Array(n).fill(Infinity)
  const from = new Int32Array(n).fill(-1)
  cost[start] = 0

  // 简单优先队列
  const queue: { cell: number; f: number }[] = [{ cell: start, f: 0 }]

  const endX = cells.p[end * 2]
  const endY = cells.p[end * 2 + 1]

  while (queue.length > 0) {
    queue.sort((a, b) => a.f - b.f)
    const { cell } = queue.shift()!

    if (cell === end) break

    for (const neighbor of cells.c[cell]) {
      if (cells.h[neighbor] < SEA_LEVEL) continue // 不走水域

      const biome = BIOMES[cells.biome[neighbor]]
      let moveCost = (biome?.moveCost ?? 100) / 50
      if (cells.h[neighbor] > 70) moveCost += (cells.h[neighbor] - 70) * 0.5
      // 河流有桥 → 降低成本
      if (cells.r[neighbor] > 0) moveCost *= 0.8

      const g = cost[cell] + moveCost
      if (g < cost[neighbor]) {
        cost[neighbor] = g
        from[neighbor] = cell
        const dx = cells.p[neighbor * 2] - endX
        const dy = cells.p[neighbor * 2 + 1] - endY
        const h = Math.sqrt(dx * dx + dy * dy) * 0.01
        queue.push({ cell: neighbor, f: g + h })
      }
    }

    if (queue.length > 5000) break // 安全阀
  }

  // 回溯路径
  if (from[end] === -1) return []
  const path: number[] = []
  let c = end
  while (c !== -1 && c !== start) {
    path.unshift(c)
    c = from[c]
  }
  path.unshift(start)
  return path
}
