// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { avgRegionCompositeByteFixture as fixture } from '../helpers/avg-region-composite-byte-fixture'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { encodeAvgStraightPngV1, decodeAvgStraightPngV1 } from '../../src/lib/avg/image-straight-png'
import { deriveAvgRegionCompositeGeometryV1 } from '../../src/lib/avg/image-region-composite-contract'
import { hashAvgRegionBytesV1, processAvgRegionCompositeBytesV1, verifyAvgRegionCompositeBytesV1 } from '../../src/lib/avg/image-region-composite-pixels'
import { assertAvgImageRegionCompositeReceiptV3 } from '../../src/lib/avg/image-region-composite-receipt'
import { parseAvgImageProcessingReceiptV1 } from '../../src/lib/avg/image-processing-contract'
import { parseAvgImageProcessingReceiptV2 } from '../../src/lib/avg/image-processing-contract-v2'

describe('AVG region-composition V3 physical receipt and independent recomputation', () => {
  it('binds two exact PNGs, the recipe and source hashes, then verifies the actual encoded pixels', async () => {
    const input = await fixture(), result = await processAvgRegionCompositeBytesV1(input)
    const receipt = await verifyAvgRegionCompositeBytesV1({ ...input, ...result })
    expect(receipt.version).toBe(3); expect(receipt.inputProof).toEqual(input.inputProof)
    expect(receipt.source).toEqual(input.source); expect(receipt.base).toEqual(input.base)
    expect(receipt.output.contentHash).toBe(await hashAvgRegionBytesV1(result.data))
    expect(receipt.output.hasAlpha).toBe(true); expect(receipt.preservation.regionPixelCount).toBe(256)
    expect(receipt.preservation.changedPixelCount).toBeGreaterThan(0)
    expect(() => parseAvgImageProcessingReceiptV1(receipt)).toThrow()
    expect(() => parseAvgImageProcessingReceiptV2(receipt)).toThrow()
  })
  it('rejects source/base hash, size, dimensions and substituted source-proof metadata', async () => {
    const input = await fixture(), result = await processAvgRegionCompositeBytesV1(input)
    await expect(processAvgRegionCompositeBytesV1({ ...input, source: { ...input.source, contentHash: 'f'.repeat(64) } })).rejects.toThrow(/hash/)
    await expect(processAvgRegionCompositeBytesV1({ ...input, source: { ...input.source, byteSize: input.source.byteSize + 1 } })).rejects.toThrow(/长度/)
    await expect(processAvgRegionCompositeBytesV1({ ...input, source: { ...input.source, width: 63 } })).rejects.toThrow(/尺寸/)
    await expect(processAvgRegionCompositeBytesV1({ ...input, base: { ...input.base, assetVersion: 3 } })).rejects.toThrow(/底图/)
    await expect(verifyAvgRegionCompositeBytesV1({ ...input, ...result, inputProof: { ...input.inputProof, baseGeneratedSourceHash: 'f'.repeat(64) } })).rejects.toThrow(/来源|证明/)
  })
  it('detects encoded alpha/outside changes rather than trusting a returned receipt', async () => {
    const input = await fixture(), result = await processAvgRegionCompositeBytesV1(input)
    const output = await decodeAvgStraightPngV1(result.data); output.rgba[0] = 200
    const outside = await encodeAvgStraightPngV1(output)
    await expect(verifyAvgRegionCompositeBytesV1({ ...input, receipt: result.receipt, data: outside })).rejects.toThrow(/保护区域/)
    output.rgba[3] = 255
    const alpha = await encodeAvgStraightPngV1(output)
    await expect(verifyAvgRegionCompositeBytesV1({ ...input, receipt: result.receipt, data: alpha })).rejects.toThrow(/alpha/)
  })
  it('rejects a self-consistent forged local output whose ROI pixels came from a different declared source rectangle', async () => {
    const input = await fixture(), otherRecipe = structuredClone(input.recipe); otherRecipe.regions[0].source.x = 5000
    const other = await processAvgRegionCompositeBytesV1({ ...input, recipe: otherRecipe })
    const { receiptHash: _hash, ...body } = other.receipt
    const forgedBody = { ...body, recipeHash: await hashProductProductionValueV2(input.recipe),
      geometry: deriveAvgRegionCompositeGeometryV1(input.recipe, input.source.width, input.source.height) }
    const forged = { ...forgedBody, receiptHash: await hashProductProductionValueV2(forgedBody) }
    await expect(assertAvgImageRegionCompositeReceiptV3(input.recipe, forged)).resolves.toBeDefined()
    await expect(verifyAvgRegionCompositeBytesV1({ ...input, data: other.data, receipt: forged })).rejects.toThrow(/准确算法/)
  })
  it('honors pre-cancel and rejects a changed recipe/receipt without any output admission', async () => {
    const input = await fixture(), controller = new AbortController(); controller.abort()
    await expect(processAvgRegionCompositeBytesV1({ ...input, signal: controller.signal })).rejects.toThrow(/aborted/)
    const result = await processAvgRegionCompositeBytesV1(input), corrupt = structuredClone(result.receipt)
    corrupt.preservation.changedPixelCount++
    await expect(verifyAvgRegionCompositeBytesV1({ ...input, data: result.data, receipt: corrupt })).rejects.toThrow(/回执/)
  })
})
