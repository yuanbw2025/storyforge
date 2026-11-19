import { collectMapBoundarySegments } from '../engine/boundaries'
import type { VoronoiMapData } from '../engine/types'
export type Point = [number, number]
const kinds = [
  'land',
  'realm',
  'water',
  'ridge',
  'wood',
  'marsh',
  'desert',
  'river',
  'road',
  'wall',
  'sea',
  'region',
  'city',
  'fortress',
  'border',
  'province',
  'seaRoute',
  'passage',
  'rift',
  'landmark',
] as const
export type AtlasKind = (typeof kinds)[number]
export interface AtlasFeature {
  kind: AtlasKind
  name: string
  points: Point[]
  rank: number
}
export interface AtlasGeometry {
  cellCoast?: true
  version: 1
  width: number
  height: number
  features: AtlasFeature[]
}

/** Optional author geometry uses map-space units. No scripts, URLs or media payloads. */
export function parseAtlasReference(input: unknown): AtlasGeometry {
  const doc = input as AtlasGeometry
  if (
    !doc ||
    doc.version !== 1 ||
    ![doc.width, doc.height].every((v) => Number.isInteger(v) && v >= 100 && v <= 4096) ||
    !Array.isArray(doc.features) ||
    doc.features.length > 3000
  )
    throw Error('参考布局的版本、尺寸或要素数量无效。')
  let count = 0
  let totalLength = 0
  let brushArea = 0
  const features = doc.features.map((f, index) => {
    const pointKind = ['city', 'fortress', 'region', 'sea', 'landmark'].includes(f?.kind)
    const minimum = ['land', 'realm', 'water'].includes(f?.kind) ? 3
      : pointKind || ['ridge', 'wood', 'desert', 'marsh'].includes(f?.kind) ? 1 : 2
    if (
      !f ||
      !kinds.includes(f.kind) ||
      typeof f.name !== 'string' ||
      f.name.length > 120 ||
      (pointKind && f.points?.length !== 1) ||
      ![0, 1, 2].includes(f.rank) ||
      !Array.isArray(f.points) ||
      f.points.length < minimum ||
      (count += f.points.length) > 50000 ||
      !f.points.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          p.every((v) => Number.isFinite(v) && Math.abs(v) < 8192),
      )
    )
      throw Error(`参考布局第 ${index + 1} 项的格式或数量无效（${String(f?.kind)}，${String(f?.name ?? '').slice(0, 120)}，${f?.points?.length ?? 0} 个点）。`)
    const [firstX, firstY] = f.points[0]
    let minX = firstX,
      minY = firstY,
      maxX = firstX,
      maxY = firstY
    for (let i = 1; i < f.points.length; i++) {
      const [x, y] = f.points[i],
        [u, v] = f.points[i - 1]
      totalLength += Math.hypot(x - u, y - v)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    if (['wood', 'marsh', 'desert'].includes(f.kind)) brushArea += (maxX - minX) * (maxY - minY)
    if (totalLength > 120000 || brushArea > 16000000) throw Error('参考布局超出绘制预算。')
    return {
      kind: f.kind,
      name: f.name,
      rank: f.rank,
      points: f.points.map(([x, y]): Point => [x, y]),
    }
  })
  if (!features.some((f) => f.kind === 'land' || f.kind === 'realm'))
    throw Error('参考布局缺少陆地或空间分区轮廓。')
  return { version: 1, ...(doc.cellCoast === true ? { cellCoast: true as const } : {}), width: doc.width, height: doc.height, features }
}

// Cancel internal polygon edges to recover coast and lake rings from the actual grid.
function coastline(data: VoronoiMapData): Point[][] {
  const { cells, vertices } = data
  const edges = new Map<string, [number, number]>()
  for (let i = 0; i < cells.length; i++) {
    if (cells.h[i] < 20) continue
    const polygon = cells.v[i]
    polygon.forEach((a, j) => {
      const b = polygon[(j + 1) % polygon.length],
        key = a < b ? a + ',' + b : b + ',' + a
      if (!edges.delete(key)) edges.set(key, [a, b])
    })
  }
  const links = new Map<number, Set<number>>()
  for (const [a, b] of edges.values()) {
    if (!links.has(a)) links.set(a, new Set())
    if (!links.has(b)) links.set(b, new Set())
    links.get(a)!.add(b)
    links.get(b)!.add(a)
  }
  const rings: Point[][] = []
  for (const start of links.keys()) {
    while (links.get(start)!.size) {
      const points: Point[] = []
      let a = start
      do {
        const b = links.get(a)?.values().next().value
        if (b === undefined) break
        points.push([vertices.p[a * 2], vertices.p[a * 2 + 1]])
        links.get(a)!.delete(b)
        links.get(b)!.delete(a)
        a = b
      } while (a !== start)
      if (a === start && points.length >= 3) rings.push(points)
    }
  }
  return rings
}

export function geometryFromMap(data: VoronoiMapData): AtlasGeometry {
  const features: AtlasFeature[] = []
  const add = (kind: AtlasKind, name: string, points: Point[], rank = 1) =>
    features.push({ kind, name, points, rank })
  for (const ring of coastline(data)) add('land', '', ring)
  const { cells } = data
  for (let i = 0; i < cells.length; i++) {
    const x = cells.p[i * 2],
      y = cells.p[i * 2 + 1]
    if (cells.h[i] >= 65 && i % 3 === 0) add('ridge', '', [[x, y]])
    else if (cells.biome[i] >= 5 && cells.biome[i] <= 9 && i % 5 === 0) add('wood', '', [[x, y]])
    else if (cells.biome[i] === 1 && i % 9 === 0) add('desert', '', [[x, y]])
  }
  for (const r of data.rivers) if (r.points.length > 1) add('river', r.name, r.points, 2)
  for (const r of data.roads)
    if (r.points.length > 1) add(r.type === 'sea' ? 'seaRoute' : 'road', r.name, r.points, 2)
  for (const segment of collectMapBoundarySegments(data, 'state')) add('border', '', segment.points)
  for (const segment of collectMapBoundarySegments(data, 'province'))
    add('province', '', segment.points)
  const fortresses = new Set(
    data.spatialPlacements?.filter((p) => p.kind === 'fortress').map((p) => p.name),
  )
  for (const b of data.burgs)
    if (b.i)
      add(fortresses.has(b.name) ? 'fortress' : 'city', b.name, [[b.x, b.y]], b.capital ? 0 : 2)
  for (const s of data.states) {
    const b = data.burgs[s.capital]
    if (s.i && b) add('region', s.name, [[b.x, b.y - 16]])
  }
  const named = new Set(features.map((f) => f.name))
  for (const p of data.spatialPlacements ?? [])
    if (!named.has(p.name))
      add(p.kind === 'fortress' ? 'fortress' : 'region', p.name, [[p.x, p.y]], 2)
  return {
    version: 1,
    cellCoast: true,
    width: data.width,
    height: data.height,
    features,
  }
}
