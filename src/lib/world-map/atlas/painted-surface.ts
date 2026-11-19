import type { AtlasGeometry } from './geometry'
import { continuousTerrain } from './continuous'
import { DEFAULT_ATLAS_LAYERS } from './layers'

interface Surface {
  geometry: AtlasGeometry
  seed: string
  land: HTMLCanvasElement
  water: HTMLCanvasElement
  base: HTMLCanvasElement
}
const cache = new WeakMap<HTMLImageElement, Surface>()

/** Separate the requested teal water material from the painted land material.
 * This is a palette heuristic, never geographic evidence: canonical paths still
 * decide where land, islands and lakes are. Misaligned blue pixels on land expose
 * the deterministic terrain underneath instead of cutting new holes in it. */
export function paintedSurface(image: HTMLImageElement, geometry: AtlasGeometry, seed: string): Surface {
  const previous = cache.get(image)
  if (previous?.geometry === geometry && previous.seed === seed) return previous
  const land = document.createElement('canvas'), water = document.createElement('canvas')
  const scale = Math.min(1, 2400 / image.naturalWidth, 1600 / image.naturalHeight)
  land.width = water.width = Math.round(image.naturalWidth * scale)
  land.height = water.height = Math.round(image.naturalHeight * scale)
  const lc = land.getContext('2d')!, wc = water.getContext('2d')!
  lc.drawImage(image, 0, 0, land.width, land.height)
  const lp = lc.getImageData(0, 0, land.width, land.height), wp = wc.createImageData(land.width, land.height)
  for (let i = 0; i < lp.data.length; i += 4) {
    const red = lp.data[i], green = lp.data[i + 1], blue = lp.data[i + 2]
    // Conservative cyan/blue selection keeps cool-grey rock shadows and green
    // forest shadows in the painting rather than exposing speckled base terrain.
    const ocean = blue > red * 1.12 && green > red * 1.2 && blue > green * 0.9
      && red < Math.max(green, blue) * 0.5
    if (!ocean) continue
    wp.data[i] = red; wp.data[i + 1] = green; wp.data[i + 2] = blue; wp.data[i + 3] = lp.data[i + 3]
    lp.data[i + 3] = 0
  }
  lc.putImageData(lp, 0, 0); wc.putImageData(wp, 0, 0)
  const result = { geometry, seed, land, water, base: continuousTerrain(geometry, seed, DEFAULT_ATLAS_LAYERS) }
  cache.set(image, result)
  return result
}
