import type { AtlasGeometry, Point } from './geometry'

function contains([x, y]: Point, ring: Point[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [u, v] = ring[j]
    if (b > y !== v > y && x < ((u - a) * (y - b)) / (v - b) + a) inside = !inside
  }
  return inside
}

/** Only diagnose point-in-water. A landward point alone cannot prove a river mouth. */
export function inspectCityPlacement(g: AtlasGeometry): string[] {
  const rings = g.features.filter((f) => f.kind === 'land')
  return g.features
    .filter(
      (f) =>
        f.kind === 'city' &&
        !(g.cellCoast
          ? rings.reduce((land, r) => (contains(f.points[0], r.points) ? !land : land), false)
          : rings.some((r) => contains(f.points[0], r.points))),
    )
    .map((f) => f.name)
}
