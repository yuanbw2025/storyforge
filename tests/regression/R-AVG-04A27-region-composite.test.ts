import { describe, expect, it } from 'vitest'
import { deriveAvgRegionCompositeGeometryV1, parseAvgImageRegionCompositeRecipeV3,
  type AvgImageRegionCompositeRecipeV3 } from '../../src/lib/avg/image-region-composite-contract'
import { composeAvgCharacterRegionsV1 } from '../../src/lib/avg/image-region-composite-kernel'
import { parseAvgImageProcessingRecipeV1, parseAvgImageProcessingRecipeV2 } from '../../src/lib/avg/image-processing-contract'

const recipe = (): AvgImageRegionCompositeRecipeV3 => ({ schema: 'storyforge.avg.image-processing-recipe', version: 3,
  algorithm: 'storyforge.avg.region-bilinear-srgb.v1', width: 64, height: 64,
  baseReference: { assetKey: 'keeper.base', assetVersion: 1, contentHash: 'a'.repeat(64) },
  regions: [{ source: { x: 2500, y: 2500, width: 2500, height: 2500 }, target: { x: 2500, y: 2500, width: 2500, height: 2500 }, featherPx: 2 }],
  alphaPolicy: 'preserve-base-alpha', declaration: 'Explicit expression area; preserve the selected body and every alpha byte.' })
function raster(red: number, alpha = 255) {
  const rgba = new Uint8ClampedArray(64 * 64 * 4)
  for (let pixel = 0; pixel < 4096; pixel++) rgba.set([red, pixel % 251, (pixel * 7) % 253, alpha], pixel * 4)
  return { width: 64, height: 64, rgba }
}
describe('AVG 04A.27 internal region composition — not product admission', () => {
  it('preserves every protected RGBA byte and every alpha byte, without mutating either input', () => {
    const base = raster(20), source = raster(220)
    for (let pixel = 0; pixel < 4096; pixel++) base.rgba[pixel * 4 + 3] = pixel % 256
    const before = new Uint8ClampedArray(base.rgba), sourceBefore = new Uint8ClampedArray(source.rgba)
    const result = composeAvgCharacterRegionsV1({ recipe: recipe(), base, source })
    let observedChanges = 0
    for (let pixel = 0; pixel < 4096; pixel++) {
      const x = pixel % 64, y = Math.floor(pixel / 64), offset = pixel * 4
      const inside = x >= 16 && x < 32 && y >= 16 && y < 32
      expect(Boolean(result.regionMask[pixel >> 3] & (1 << (pixel & 7)))).toBe(inside)
      expect(result.rgba[offset + 3]).toBe(before[offset + 3])
      if (!inside || !before[offset + 3]) expect(Array.from(result.rgba.subarray(offset, offset + 4))).toEqual(Array.from(before.subarray(offset, offset + 4)))
      if (result.rgba[offset] !== before[offset]) observedChanges++
    }
    expect(result.changedPixelCount).toBe(observedChanges)
    expect(observedChanges).toBeGreaterThan(0)
    expect(observedChanges).toBeLessThanOrEqual(256)
    expect(base.rgba).toEqual(before); expect(source.rgba).toEqual(sourceBefore)
  })
  it('uses the declared feather and source alpha; does not borrow pixels outside the source ROI', () => {
    const base = raster(20), source = raster(240, 128), p = recipe()
    const result = composeAvgCharacterRegionsV1({ recipe: p, base, source })
    expect(result.rgba[(16 * 64 + 16) * 4]).toBe(48) // round(20*223/255 + 240*32/255)
    expect(result.rgba[(20 * 64 + 20) * 4]).toBe(130)
    p.regions[0].featherPx = 0
    for (let y = 16; y < 32; y++) for (let x = 16; x < 32; x++) source.rgba.set([100, 100, 100, 255], (y * 64 + x) * 4)
    p.regions[0].source = { x: 2500, y: 2500, width: 1250, height: 1250 }
    const scaled = composeAvgCharacterRegionsV1({ recipe: p, base, source })
    for (let y = 16; y < 32; y++) for (let x = 16; x < 32; x++) expect(scaled.rgba[(y * 64 + x) * 4]).toBe(100)
  })
  it('refuses resolved overlap even when normalized rectangles only meet at a fractional edge', () => {
    const p = recipe()
    p.regions = [
      { source: p.regions[0].source, target: { x: 2500, y: 2500, width: 100, height: 100 }, featherPx: 0 },
      { source: p.regions[0].source, target: { x: 2600, y: 2500, width: 100, height: 100 }, featherPx: 0 },
    ]
    expect(() => deriveAvgRegionCompositeGeometryV1(p, 64, 64)).toThrow(/取整后.*重叠/)
  })
  it.each(['bounds', 'area', 'feather', 'empty', 'unknown', 'nan', 'wrong-alpha', 'sparse'] as const)('rejects invalid %s before creating an output', kind => {
    const p: Record<string, unknown> = structuredClone(recipe()) as unknown as Record<string, unknown>
    const regions = p.regions as AvgImageRegionCompositeRecipeV3['regions']
    if (kind === 'bounds') regions[0].target.x = 9000
    if (kind === 'area') regions[0].target.width = 7500
    if (kind === 'feather') regions[0].featherPx = 5
    if (kind === 'empty') p.regions = []
    if (kind === 'unknown') p.inferFace = true
    if (kind === 'nan') p.width = Number.NaN
    if (kind === 'wrong-alpha') p.alphaPolicy = 'replace-alpha'
    if (kind === 'sparse') p.regions = new Array(1)
    expect(() => composeAvgCharacterRegionsV1({ recipe: p as unknown as AvgImageRegionCompositeRecipeV3, base: raster(20), source: raster(220) })).toThrow()
  })
  it('rejects wrong base dimensions, truncated rasters, a transparent/no-op patch and pre-aborted work', () => {
    const p = recipe(), base = raster(20), source = raster(220)
    expect(() => composeAvgCharacterRegionsV1({ recipe: p, base: { ...base, width: 32 }, source })).toThrow(/RGBA/)
    expect(() => composeAvgCharacterRegionsV1({ recipe: p, base, source: { ...source, rgba: source.rgba.subarray(4) } })).toThrow(/RGBA/)
    expect(() => composeAvgCharacterRegionsV1({ recipe: p, base, source: raster(220, 0) })).toThrow(/没有改变/)
    expect(() => composeAvgCharacterRegionsV1({ recipe: p, base, source: base })).toThrow(/没有改变/)
    const controller = new AbortController(); controller.abort()
    expect(() => composeAvgCharacterRegionsV1({ recipe: p, base, source, signal: controller.signal })).toThrow(/aborted/)
  })
  it('retains strict old codecs; this isolated recipe is not admitted by either legacy parser', () => {
    const p = recipe()
    expect(parseAvgImageRegionCompositeRecipeV3(JSON.stringify(p))).toEqual(p)
    expect(() => parseAvgImageProcessingRecipeV1(p)).toThrow()
    expect(() => parseAvgImageProcessingRecipeV2(p)).toThrow()
  })
  it('refuses wrong typed arrays, hidden backing ranges and shared mutable buffers', () => {
    const base = raster(20), source = raster(220), p = recipe()
    const wrong = new Uint16Array(8192) as unknown as Uint8ClampedArray
    const hidden = new Uint8ClampedArray(16388).subarray(4)
    const shared = new Uint8ClampedArray(new SharedArrayBuffer(16384))
    for (const rgba of [wrong, hidden, shared]) expect(() => composeAvgCharacterRegionsV1({ recipe: p, base: { ...base, rgba }, source })).toThrow(/ArrayBuffer/)
  })
})
