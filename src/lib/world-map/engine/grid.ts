/**
 * Voronoi 网格生成
 * 用 Delaunator 生成 Delaunay 三角剖分，再求对偶得到 Voronoi 图
 */

import Delaunator from 'delaunator'
import type { GridCells, GridVertices } from './types'

/** 生成抖动的网格点（基于泊松盘分布的近似） */
export function generatePoints(
  width: number,
  height: number,
  count: number,
  rng: () => number,
): Float64Array {
  // 用 jittered grid 近似均匀分布
  const cellSize = Math.sqrt((width * height) / count)
  const cols = Math.ceil(width / cellSize)
  const rows = Math.ceil(height / cellSize)
  const jitter = cellSize * 0.35

  const points: number[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (col + 0.5) * cellSize + (rng() - 0.5) * jitter * 2
      const y = (row + 0.5) * cellSize + (rng() - 0.5) * jitter * 2
      // 确保在画布内
      if (x > 0 && x < width && y > 0 && y < height) {
        points.push(x, y)
      }
    }
  }

  // 如果点数不够，随机补充
  while (points.length / 2 < count) {
    points.push(rng() * width, rng() * height)
  }

  return Float64Array.from(points.slice(0, count * 2))
}

/** 从 Delaunator 结果构建 Voronoi 数据结构 */
export function buildVoronoi(
  points: Float64Array,
  _width: number,
  _height: number,
): { cells: GridCells; vertices: GridVertices } {
  const n = points.length / 2
  const delaunay = new Delaunator(points)
  const { triangles, halfedges } = delaunay
  const numTriangles = triangles.length / 3

  // ── 计算三角形外接圆心（Voronoi 顶点） ──
  const vp = new Float64Array(numTriangles * 2)
  for (let t = 0; t < numTriangles; t++) {
    const i0 = triangles[t * 3]
    const i1 = triangles[t * 3 + 1]
    const i2 = triangles[t * 3 + 2]
    const ax = points[i0 * 2], ay = points[i0 * 2 + 1]
    const bx = points[i1 * 2], by = points[i1 * 2 + 1]
    const cx = points[i2 * 2], cy = points[i2 * 2 + 1]

    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if (Math.abs(D) < 1e-10) {
      vp[t * 2] = (ax + bx + cx) / 3
      vp[t * 2 + 1] = (ay + by + cy) / 3
    } else {
      const ad = ax * ax + ay * ay
      const bd = bx * bx + by * by
      const cd = cx * cx + cy * cy
      vp[t * 2] = Math.floor((ad * (by - cy) + bd * (cy - ay) + cd * (ay - by)) / D)
      vp[t * 2 + 1] = Math.floor((ad * (cx - bx) + bd * (ax - cx) + cd * (bx - ax)) / D)
    }
  }

  // ── 构建单元格的邻居和顶点列表 ──
  const cellVertices: number[][] = Array.from({ length: n }, () => [])
  const cellNeighbors: number[][] = Array.from({ length: n }, () => [])
  const cellBorder = new Uint8Array(n)

  // 构建 incoming edge 索引：每个点的一条入边
  const incomingEdge = new Int32Array(n).fill(-1)
  for (let e = 0; e < triangles.length; e++) {
    const p = triangles[e]
    if (incomingEdge[p] === -1 || halfedges[e] === -1) {
      incomingEdge[p] = e
    }
  }

  for (let p = 0; p < n; p++) {
    const startEdge = incomingEdge[p]
    if (startEdge === -1) continue

    const verts: number[] = []
    const neighs: number[] = []
    let e = startEdge
    let isBorder = false

    do {
      const t = Math.floor(e / 3)
      verts.push(t)

      // 对面的点就是邻居
      const nextE = e % 3 === 2 ? e - 2 : e + 1
      const neighbor = triangles[nextE]
      if (neighbor !== p) neighs.push(neighbor)

      // 走到下一条边
      const twin = halfedges[e]
      if (twin === -1) {
        isBorder = true
        break
      }
      e = twin % 3 === 2 ? twin - 2 : twin + 1
    } while (e !== startEdge)

    cellVertices[p] = verts
    cellNeighbors[p] = neighs
    if (isBorder) cellBorder[p] = 1
  }

  // ── 构建顶点的邻居和相邻单元格 ──
  const vertexVertices: number[][] = Array.from({ length: numTriangles }, () => [])
  const vertexCells: number[][] = Array.from({ length: numTriangles }, () => [])

  for (let t = 0; t < numTriangles; t++) {
    vertexCells[t] = [triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]]
    // 相邻三角形就是相邻顶点
    for (let j = 0; j < 3; j++) {
      const twin = halfedges[t * 3 + j]
      if (twin !== -1) {
        vertexVertices[t].push(Math.floor(twin / 3))
      }
    }
  }

  // ── 构建 GridCells ──
  const cellP = new Float64Array(n * 2)
  for (let i = 0; i < n * 2; i++) cellP[i] = points[i]

  const cells: GridCells = {
    length: n,
    p: cellP,
    c: cellNeighbors,
    v: cellVertices,
    b: cellBorder,
    h: new Uint8Array(n),
    t: new Int8Array(n),
    f: new Uint16Array(n),
    temp: new Int8Array(n),
    prec: new Uint8Array(n),
    biome: new Uint8Array(n),
    r: new Uint16Array(n),
    fl: new Float32Array(n),
    s: new Float32Array(n),
    pop: new Float32Array(n),
    culture: new Uint16Array(n),
    state: new Uint16Array(n),
    burg: new Uint16Array(n),
    haven: new Uint16Array(n),
    harbor: new Uint8Array(n),
  }

  const vertices: GridVertices = {
    length: numTriangles,
    p: vp,
    v: vertexVertices,
    c: vertexCells,
  }

  return { cells, vertices }
}
