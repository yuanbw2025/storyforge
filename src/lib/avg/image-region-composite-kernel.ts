import { assertAvgRegionCompositeRasterV1, deriveAvgRegionCompositeGeometryV1, parseAvgImageRegionCompositeRecipeV3,
  type AvgImageRegionCompositeRecipeV3, type AvgRegionCompositeGeometryV1, type AvgRegionRectV1 } from './image-region-composite-contract'

export interface AvgCompositeRasterV1 { width: number; height: number; rgba: Uint8ClampedArray }
function assertRaster(raster: AvgCompositeRasterV1) {
  if (!(raster.rgba instanceof Uint8ClampedArray) || !(raster.rgba.buffer instanceof ArrayBuffer)
    || raster.rgba.byteOffset !== 0 || raster.rgba.buffer.byteLength !== raster.rgba.byteLength) {
    throw new Error('[avg-composite] RGBA 必须是独占 ArrayBuffer 的 Uint8ClampedArray')
  }
  assertAvgRegionCompositeRasterV1(raster.width, raster.height, raster.rgba.byteLength)
}
const abortIfNeeded = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('AVG region composite aborted', 'AbortError')
}

function sample(source: AvgCompositeRasterV1, r: AvgRegionRectV1, x: number, y: number, channel: number): number {
  const sx = Math.max(r.x, Math.min(r.x + r.width - 1, x)), sy = Math.max(r.y, Math.min(r.y + r.height - 1, y))
  const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(r.x + r.width - 1, x0 + 1), y1 = Math.min(r.y + r.height - 1, y0 + 1)
  const fx = sx - x0, fy = sy - y0, p = source.rgba, stride = source.width * 4
  const top = p[y0 * stride + x0 * 4 + channel] * (1 - fx) + p[y0 * stride + x1 * 4 + channel] * fx
  const bottom = p[y1 * stride + x0 * 4 + channel] * (1 - fx) + p[y1 * stride + x1 * 4 + channel] * fx
  return top * (1 - fy) + bottom * fy
}

function applyRegion(base: AvgCompositeRasterV1, source: AvgCompositeRasterV1, geometry: AvgRegionCompositeGeometryV1,
  output: Uint8ClampedArray, mask: Uint8Array, signal?: AbortSignal): number {
  const s = geometry.source, t = geometry.target
  let changed = 0
  for (let y = 0; y < t.height; y++) {
    abortIfNeeded(signal)
    const sy = s.y + (y + 0.5) * s.height / t.height - 0.5
    for (let x = 0; x < t.width; x++) {
      const pixel = (t.y + y) * base.width + t.x + x, offset = pixel * 4
      mask[pixel >> 3] |= 1 << (pixel & 7)
      // Preserve invisible base RGB too; no hidden painting below zero alpha.
      if (base.rgba[offset + 3] === 0) continue
      const sx = s.x + (x + 0.5) * s.width / t.width - 0.5
      const distance = Math.min(x + 0.5, t.width - x - 0.5, y + 0.5, t.height - y - 0.5)
      const feather = geometry.featherPx === 0 ? 1 : Math.min(1, distance / geometry.featherPx)
      const weight = Math.round(feather * sample(source, s, sx, sy, 3))
      if (!weight) continue
      let pixelChanged = false
      for (let channel = 0; channel < 3; channel++) {
        const value = Math.round((base.rgba[offset + channel] * (255 - weight) + sample(source, s, sx, sy, channel) * weight) / 255)
        output[offset + channel] = value
        if (value !== base.rgba[offset + channel]) pixelChanged = true
      }
      if (pixelChanged) changed++
    }
  }
  return changed
}

/** Experimental CPU pixel kernel only; not a PNG, source proof, adoption or
 * quality receipt. The bounded Worker owner must terminate active work on cancel. */
export function composeAvgCharacterRegionsV1(input: { recipe: AvgImageRegionCompositeRecipeV3;
  base: AvgCompositeRasterV1; source: AvgCompositeRasterV1; signal?: AbortSignal }) {
  abortIfNeeded(input.signal)
  const recipe = parseAvgImageRegionCompositeRecipeV3(input.recipe), { base, source } = input
  assertRaster(base); assertRaster(source)
  if (base.width !== recipe.width || base.height !== recipe.height) throw new Error('[avg-composite] 画布必须准确等于底图尺寸')
  const geometry = deriveAvgRegionCompositeGeometryV1(recipe, source.width, source.height)
  const rgba = new Uint8ClampedArray(base.rgba), regionMask = new Uint8Array(Math.ceil(base.width * base.height / 8))
  let changedPixelCount = 0
  for (const region of geometry) changedPixelCount += applyRegion(base, source, region, rgba, regionMask, input.signal)
  abortIfNeeded(input.signal)
  if (!changedPixelCount) throw new Error('[avg-composite] 明确 ROI 没有改变任何可见 RGB 像素')
  return { width: base.width, height: base.height, rgba, regionMask, geometry, changedPixelCount }
}
