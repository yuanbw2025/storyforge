import { seedRandom } from '../engine/random'
import { atlasIslandInsideWater } from './inspect'
import { atlasShorelinePoints } from './shoreline'
import type { AtlasGeometry, Point } from './geometry'

export function line(points: Point[], closed = false) {
  const path = new Path2D()
  if (points.length) {
    path.moveTo(...points[0])
    for (const point of points.slice(1)) path.lineTo(...point)
    if (closed) path.closePath()
  }
  return path
}

export function watercourse(points: Point[], name: string) {
  const rng = seedRandom('river-' + name), path = new Path2D()
  path.moveTo(...points[0])
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i - 1], [u, v] = points[i], dx = u - x, dy = v - y
    const length = Math.hypot(dx, dy)
    const bend = Math.min(8, length * 0.16) * (rng() > 0.5 ? 1 : -1)
    const ox = -dy / (length || 1) * bend, oy = dx / (length || 1) * bend
    path.bezierCurveTo(x + dx * 0.32 + ox, y + dy * 0.32 + oy,
      x + dx * 0.68 - ox, y + dy * 0.68 - oy, u, v)
  }
  return path
}

export function along(points: Point[], step: number, place: (x: number, y: number) => void) {
  if (points.length === 1) { place(...points[0]); return }
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i - 1], [u, v] = points[i]
    const n = Math.max(1, Math.ceil(Math.hypot(u - x, v - y) / step))
    for (let j = 0; j < n; j++) place(x + (u - x) * j / n, y + (v - y) * j / n)
  }
}

/** Both renderers share the same union, lake holes and enclosed islands. */
export function atlasSurfacePaths(g: AtlasGeometry, seed: string, waterBodies: boolean) {
  const land = new Path2D(), coast = new Path2D(), realmEdges = new Path2D(), waterEdges = new Path2D()
  const outsideWaters: Path2D[] = []
  const area = (points: Point[]) => points.reduce((sum, [x, y], i) => {
    const [u, v] = points[(i + 1) % points.length]
    return sum + x * v - u * y
  }, 0)
  const shore = (points: Point[]) => line(atlasShorelinePoints(points, seed), true)
  if (waterBodies) for (const f of g.features) if (f.kind === 'water') {
    const outline = shore(area(f.points) > 0 ? [...f.points].reverse() : f.points)
    waterEdges.addPath(outline)
    const outside = new Path2D()
    outside.rect(-8192, -8192, 16384, 16384)
    outside.addPath(outline)
    for (const island of g.features.filter(land => atlasIslandInsideWater(land, f))) {
      outside.addPath(shore(area(island.points) < 0 ? [...island.points].reverse() : island.points))
    }
    outsideWaters.push(outside)
  }
  const fillRule = g.cellCoast ? 'evenodd' as const : 'nonzero' as const
  for (const f of g.features) if (f.kind === 'land' || f.kind === 'realm') {
    const points = !g.cellCoast && area(f.points) < 0 ? [...f.points].reverse() : f.points
    const outline = f.kind === 'realm' ? line(points, true) : shore(points)
    land.addPath(outline)
    ;(f.kind === 'realm' ? realmEdges : coast).addPath(outline)
  }
  return { land, coast, realmEdges, waterEdges, outsideWaters, fillRule }
}
