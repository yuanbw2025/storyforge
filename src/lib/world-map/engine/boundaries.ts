import type { VoronoiMapData } from './types'

/** Province display follows the existing nearest same-state settlement policy. */
function provinceMembership(data: VoronoiMapData): Uint16Array {
  const { cells } = data
  const membership = new Uint16Array(cells.length)
  if (!data.provinces || data.provinces.length <= 1) return membership
  const byState = new Map<number, typeof data.burgs>()
  for (const burg of data.burgs) {
    if (!burg.i) continue
    const sameState = byState.get(burg.state) ?? []
    sameState.push(burg)
    byState.set(burg.state, sameState)
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells.h[i] < 20 || !cells.state[i]) continue
    let distance = Infinity
    for (const burg of byState.get(cells.state[i]) ?? []) {
      const candidate = (cells.p[i * 2] - burg.x) ** 2 + (cells.p[i * 2 + 1] - burg.y) ** 2
      if (candidate < distance) {
        distance = candidate
        membership[i] = burg.i
      }
    }
  }
  return membership
}

/** Shared segments keep original and illustrated readers on the same boundaries. */
export function collectMapBoundarySegments(data: VoronoiMapData, division: 'state' | 'province') {
  const { cells, vertices } = data
  const membership = division === 'state' ? cells.state : provinceMembership(data)
  const segments: { state: number; points: [number, number][] }[] = []
  for (let i = 0; i < cells.length; i++) {
    if (!membership[i]) continue
    for (const neighbor of cells.c[i]) {
      if (membership[neighbor] === membership[i] || cells.h[neighbor] < 20) continue
      if (division === 'province' && cells.state[neighbor] !== cells.state[i]) continue
      const shared = cells.v[i].filter((vertex) => cells.v[neighbor]?.includes(vertex))
      if (shared.length < 2) continue
      segments.push({
        state: cells.state[i],
        points: shared.slice(0, 2).map((vertex) => [vertices.p[vertex * 2], vertices.p[vertex * 2 + 1]]),
      })
    }
  }
  return segments
}
