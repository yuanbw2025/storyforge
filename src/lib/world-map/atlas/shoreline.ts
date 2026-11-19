import { seedRandom } from '../engine/random'
import type { Point } from './geometry'

/** Shared polygon edges must get exactly the same perturbation in either
 * direction; otherwise two adjoining land fills expose tiny water slivers. */
export function atlasShorelinePoints(points: Point[], seed: string): Point[] {
  const result: Point[] = []
  points.forEach((start, i) => {
    const end = points[(i + 1) % points.length]
    const forward = start[0] < end[0] || (start[0] === end[0] && start[1] <= end[1])
    const [a, b] = forward ? [start, end] : [end, start]
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    const count = Math.max(1, Math.ceil(length / 2.7))
    const rng = seedRandom(seed + ':shore-edge:' + JSON.stringify([a, b]))
    const edge: Point[] = []
    for (let j = 0; j <= count; j++) {
      const t = j / count
      const offset = j === 0 || j === count ? 0 : Math.sin(t * Math.PI) * (rng() - 0.5) * Math.min(5, length / 5)
      edge.push([a[0] + dx * t - dy / (length || 1) * offset, a[1] + dy * t + dx / (length || 1) * offset])
    }
    if (!forward) edge.reverse()
    result.push(...edge.slice(0, -1))
  })
  return result
}
