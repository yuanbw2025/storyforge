import { describe, expect, it } from 'vitest'
import { AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3, matteAvgForegroundEstimatedMagentaV3 } from '../../src/lib/avg/image-foreground-estimated-magenta-v3'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from '../../src/lib/avg/image-foreground-boundary-unmix'
import { parseAvgForegroundPolicy, type AvgForegroundPolicyV3 } from '../../src/lib/avg/image-foreground-contract'
import { executeAvgForegroundWorkerRequestV2, hashAvgForegroundPixelsV2, parseAvgForegroundPixelObservationV3 } from '../../src/lib/avg/image-foreground-worker-protocol-v2'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { avgImageProcessingRecipeFixture } from '../helpers/avg-image-processing-fixture'
import { deriveAvgImageProcessingGeometryV1, type AvgImageProcessingRecipeV2 } from '../../src/lib/avg/image-processing-contract'
import { AVG_IMAGE_PROCESSOR_V2, assertAvgImageProcessingReceiptV2, projectAvgForegroundCanvasRecipeV1,
  type AvgImageProcessingReceiptV2 } from '../../src/lib/avg/image-processing-contract-v2'

const policy: AvgForegroundPolicyV3 = { schema: 'storyforge.avg.foreground-policy', version: 3,
  method: 'estimated-magenta-family', reservedColor: '#FF00FF', subjectUsesReservedColor: false,
  algorithm: AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3,
  declaration: '本地估算偏色品红底色；保留原图，结果须逐张视觉评审。' }
function shiftedMagenta() {
  const width = 60, height = 40, rgba = new Uint8ClampedArray(width * height * 4)
  for (let at = 0; at < rgba.length; at += 4) rgba.set([244, 58, 222, 255], at)
  for (let y = 10; y < 30; y += 1) for (let x = 10; x < 50; x += 1) rgba.set([200, 149, 99, 255], (y * width + x) * 4)
  // Connected purple cast shadow; V3 records and removes it with the background mask.
  for (let y = 30; y < 34; y += 1) for (let x = 23; x < 39; x += 1) rgba.set([145, 34, 130, 255], (y * width + x) * 4)
  // A half-covered edge pixel checks unmix against a stable interior sample.
  for (let y = 12; y < 28; y += 1) for (const x of [9, 50]) rgba.set([222, 104, 161, 255], (y * width + x) * 4)
  return { width, height, rgba }
}

describe('AVG foreground estimated magenta-family policy V3', () => {
  it('estimates a stable shifted border, removes connected backdrop/shadow and records real edge unmix', () => {
    const source = shiftedMagenta(), original = source.rgba.slice()
    const result = matteAvgForegroundEstimatedMagentaV3({ width: source.width, height: source.height, data: source.rgba })
    const shadow = (31 * source.width + 30) * 4, edge = (18 * source.width + 9) * 4
    expect(source.rgba).toEqual(original)
    expect(result).toMatchObject({ algorithm: AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3,
      backdropColor: { red: 244, green: 58, blue: 222 }, backdropBorderCoverage: 1 })
    expect(result.data[shadow + 3]).toBe(0)
    expect(result.data[edge + 3]).toBeGreaterThan(120)
    expect(result.data[edge + 3]).toBeLessThan(136)
    expect([...result.data.slice(edge, edge + 3)]).toEqual([200, 149, 99])
    expect(result.correctedPixelCount).toBeGreaterThan(0)
    expect(result.clearedPixelCount + result.translucentPixelCount + result.opaquePixelCount).toBe(source.width * source.height)
  })

  it('rejects non-magenta or unstable borders instead of relaxing exact V1/V2', () => {
    const source = shiftedMagenta()
    for (let y = 0; y < source.height; y += 1) for (let x = 0; x < 4; x += 1) source.rgba.set([24, 90, 160, 255], (y * source.width + x) * 4)
    expect(() => matteAvgForegroundEstimatedMagentaV3({ width: source.width, height: source.height, data: source.rgba })).toThrow(/覆盖率不足/)
    expect(parseAvgForegroundPolicy({ ...policy, version: 2, method: 'reserved-magenta', algorithm: AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 }))
      .toMatchObject({ version: 2, method: 'reserved-magenta' })
    expect(() => parseAvgForegroundPolicy({ ...policy, version: 4 })).toThrow(/SAM 2/)
  })

  it('uses exact same V3 observation and bytes for compute and independent Worker verification', async () => {
    const source = shiftedMagenta(), rgba = source.rgba.slice()
    const request = { schema: 'storyforge.avg.foreground-worker-request', version: 2, phase: 'compute',
      jobId: 'estimated-magenta-compute', width: source.width, height: source.height, rgba: rgba.buffer, policy } as const
    const computed = await executeAvgForegroundWorkerRequestV2(request)
    if (!computed.ok || computed.phase !== 'compute') throw new Error('Expected V3 compute result')
    const verify = await executeAvgForegroundWorkerRequestV2({ ...request, phase: 'verify', jobId: 'estimated-magenta-verify',
      rgba: rgba.buffer, expectedRGBA: computed.rgba, expectedObservation: computed.observation })
    expect(verify).toMatchObject({ ok: true, phase: 'verify', observation: computed.observation })
    expect(parseAvgForegroundPixelObservationV3(computed.observation, source.width, source.height)).toEqual(computed.observation)
    if (verify.ok && verify.phase === 'verify') expect(verify.verifiedCandidatePixelHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('binds the V3 estimated-color observation into the existing immutable processing receipt', async () => {
    const source = shiftedMagenta(), recipe: AvgImageProcessingRecipeV2 = {
      ...avgImageProcessingRecipeFixture(), version: 2, foreground: policy }
    const result = matteAvgForegroundEstimatedMagentaV3({ width: source.width, height: source.height, data: source.rgba })
    const alpha = new Uint8Array(source.width * source.height)
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = result.data[i * 4 + 3]
    const foreground = parseAvgForegroundPixelObservationV3({ version: 3, algorithm: result.algorithm,
      baseAlgorithm: result.baseAlgorithm, removedPixelRatio: (result.clearedPixelCount + result.translucentPixelCount) / alpha.length,
      algorithmMaskRatio: result.algorithmMaskRatio, backdropColor: result.backdropColor,
      backdropBorderCoverage: result.backdropBorderCoverage, clearedPixelCount: result.clearedPixelCount,
      translucentPixelCount: result.translucentPixelCount, opaquePixelCount: result.opaquePixelCount,
      correctedPixelCount: result.correctedPixelCount, unsupportedBoundaryPixelCount: result.unsupportedBoundaryPixelCount,
      maxCompositeResidual: result.maxCompositeResidual }, source.width, source.height)
    const body: Omit<AvgImageProcessingReceiptV2, 'receiptHash'> = {
      schema: 'storyforge.avg.image-processing-receipt', version: 2, processor: AVG_IMAGE_PROCESSOR_V2,
      recipeHash: await hashProductProductionValueV2(recipe),
      source: { contentHash: 'a'.repeat(64), mimeType: 'image/png', byteSize: source.rgba.byteLength, width: source.width, height: source.height },
      output: { contentHash: 'b'.repeat(64), pixelHash: await hashAvgForegroundPixelsV2(result.data), mimeType: 'image/png',
        byteSize: result.data.byteLength, width: recipe.width, height: recipe.height, hasAlpha: true },
      geometry: deriveAvgImageProcessingGeometryV1(projectAvgForegroundCanvasRecipeV1(recipe), source.width, source.height),
      renderer: { userAgent: 'contract-fixture', platform: 'test' },
      foreground: { ...foreground, width: source.width, height: source.height,
        policyHash: await hashProductProductionValueV2(policy), sourcePixelHash: await hashAvgForegroundPixelsV2(source.rgba),
        cutoutPixelHash: await hashAvgForegroundPixelsV2(result.data), alphaPlaneHash: await hashAvgForegroundPixelsV2(alpha) },
    }
    const receipt = { ...body, receiptHash: await hashProductProductionValueV2(body) }
    await expect(assertAvgImageProcessingReceiptV2(recipe, receipt)).resolves.toMatchObject({
      foreground: { version: 3, algorithm: AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3, backdropBorderCoverage: 1 },
    })
  })
})
