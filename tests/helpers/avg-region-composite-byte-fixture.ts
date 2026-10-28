import { encodeAvgStraightPngV1 } from '../../src/lib/avg/image-straight-png'
import { hashAvgRegionBytesV1 } from '../../src/lib/avg/image-region-composite-pixels'
import type { AvgImageRegionCompositeRecipeV3 } from '../../src/lib/avg/image-region-composite-contract'

export async function avgRegionCompositeByteFixture() {
  const baseRgba = new Uint8ClampedArray(64 * 64 * 4), sourceRgba = new Uint8ClampedArray(baseRgba.length)
  for (let pixel = 0; pixel < 4096; pixel++) {
    baseRgba.set([20, 40, 60, [0, 1, 64, 128, 254, 255][pixel % 6]], pixel * 4)
    sourceRgba.set([100 + pixel % 64, 120 + Math.floor(pixel / 64), 220, 255], pixel * 4)
  }
  const baseData = await encodeAvgStraightPngV1({ width: 64, height: 64, rgba: baseRgba })
  const sourceData = await encodeAvgStraightPngV1({ width: 64, height: 64, rgba: sourceRgba })
  const baseHash = await hashAvgRegionBytesV1(baseData), sourceHash = await hashAvgRegionBytesV1(sourceData)
  const recipe: AvgImageRegionCompositeRecipeV3 = { schema: 'storyforge.avg.image-processing-recipe', version: 3,
    algorithm: 'storyforge.avg.region-bilinear-srgb.v1', width: 64, height: 64,
    baseReference: { assetKey: 'synthetic.base', assetVersion: 2, contentHash: baseHash },
    regions: [{ source: { x: 2500, y: 2500, width: 2500, height: 2500 }, target: { x: 2500, y: 2500, width: 2500, height: 2500 }, featherPx: 2 }],
    alphaPolicy: 'preserve-base-alpha', declaration: 'Synthetic physical computation; not ownership, art or author adoption.' }
  return { recipe, baseData, sourceData,
    base: { assetKey: 'synthetic.base', assetVersion: 2, contentHash: baseHash, mimeType: 'image/png' as const, byteSize: baseData.byteLength, width: 64, height: 64 },
    source: { contentHash: sourceHash, mimeType: 'image/png' as const, byteSize: sourceData.byteLength, width: 64, height: 64 },
    inputProof: { rawProducerReceiptHash: 'a'.repeat(64), baseReferenceHash: 'b'.repeat(64), baseGeneratedSourceHash: 'c'.repeat(64), inputProofHash: 'd'.repeat(64) },
    renderer: { userAgent: 'native-node-unit', platform: 'test' } }
}
