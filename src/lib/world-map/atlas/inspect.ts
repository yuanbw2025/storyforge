import type { AtlasGeometry, Point } from './geometry'

export function atlasRingContains([x, y]: Point, ring: Point[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [u, v] = ring[j]
    if (b > y !== v > y && x < ((u - a) * (y - b)) / (v - b) + a) inside = !inside
  }
  return inside
}

export function atlasIslandInsideWater(land: AtlasGeometry['features'][number], water: AtlasGeometry['features'][number]) {
  return land.kind === 'land' && water.kind === 'water' && land.points.every(p => atlasRingContains(p, water.points))
}

/** Only diagnose point-in-water. A landward point alone cannot prove a river mouth. */
export function inspectCityPlacement(g: AtlasGeometry): string[] {
  const rings = g.features.filter((f) => f.kind === 'land' || f.kind === 'realm')
  const waters = g.features.filter((f) => f.kind === 'water')
  return g.features
    .filter(
      (f) =>
        (f.kind === 'city' || f.kind === 'fortress') &&
        (!(g.cellCoast
          ? rings.reduce((land, r) => (atlasRingContains(f.points[0], r.points) ? !land : land), false)
          : rings.some((r) => atlasRingContains(f.points[0], r.points))) ||
          waters.some((water) => atlasRingContains(f.points[0], water.points) &&
            !rings.some(land => atlasIslandInsideWater(land, water) && atlasRingContains(f.points[0], land.points)))),
    )
    .map((f) => f.name)
}
