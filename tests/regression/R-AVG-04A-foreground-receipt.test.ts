import { describe, expect, it } from 'vitest'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../../src/lib/product-production/character-alpha-matting'
import { AVG_IMAGE_PROCESSOR_V1, parseAvgProcessedImagePayloadV1, deriveAvgImageProcessingGeometryV1,
  compileAvgForegroundRequirementV1, type AvgImageProcessingRecipeV2 } from '../../src/lib/avg/image-processing-contract'
import { AVG_IMAGE_PROCESSOR_V2, assertAvgImageProcessingReceiptV2, parseAvgImageProcessingReceiptV2,
  parseAvgProcessedImagePayload, assertAvgProcessedImageArtifactFromDefinition, projectAvgForegroundCanvasRecipeV1,
  type AvgImageProcessingReceiptV2, type AvgProcessedImagePayloadV2 } from '../../src/lib/avg/image-processing-contract-v2'
import type { AvgVisualProductionRequirementV1 } from '../../src/lib/avg/media-production-contract'
import type { AvgForegroundPolicyV1 } from '../../src/lib/avg/image-foreground-contract'
import { avgImageProcessingRecipeFixture, avgImageProcessingReceiptFixture } from '../helpers/avg-image-processing-fixture'

async function fixture() {
  const recipe: AvgImageProcessingRecipeV2 & { foreground: AvgForegroundPolicyV1 } = { ...avgImageProcessingRecipeFixture(), version: 2,
    foreground: { schema: 'storyforge.avg.foreground-policy', version: 1, method: 'reserved-magenta', reservedColor: '#FF00FF',
      subjectUsesReservedColor: false, algorithm: DECLARED_MAGENTA_ALPHA_MATTING_ID_V1, declaration: '明确保留底色；工程合同夹具不代表真实画面。' } }
  const requirement = compileAvgForegroundRequirementV1<AvgVisualProductionRequirementV1>(recipe.foreground, {
    requirementKey: 'keeper.pose', revision: 1, assetKey: 'keeper.pose', name: '工程立绘', altText: '工程原图',
    family: { subjectKey: 'keeper', familyKey: 'keeper.uniform', variantKey: 'standing', revision: 1 },
    consumer: { consumerKey: 'keeper.actor', domain: 'stage', slot: 'actor', subjectKey: 'keeper', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
    triggerBeatKey: 'desk.intro', itemVariantKey: null, mediaKind: 'character-pose', prompt: '原创工程立绘', negativePrompt: '',
    invariants: [], forbiddenDepictions: [], width: 576, height: 324, resolutionTier: '1K', alpha: 'required', references: [] })
  const sourceAsset: FrozenRuntimeMediaAssetV2 = { assetKey: requirement.assetKey, version: 1, kind: 'character-pose', name: '工程原图',
    mimeType: 'image/png', byteSize: 456, width: 640, height: 360, durationMs: null, contentHash: 'a'.repeat(64),
    source: 'unit-fixture-no-producer', license: '原创工程夹具；不代表真实许可验收', altText: '工程原图', characterTag: 'keeper', sceneTag: 'desk', blobContentHash: 'a'.repeat(64) }
  // Codec fixtures only: no PNG, Worker, producer, database or adoption proof.
  const body: Omit<AvgImageProcessingReceiptV2, 'receiptHash'> = { schema: 'storyforge.avg.image-processing-receipt', version: 2,
    processor: AVG_IMAGE_PROCESSOR_V2, recipeHash: await hashProductProductionValueV2(recipe),
    source: { contentHash: sourceAsset.contentHash, mimeType: sourceAsset.mimeType, byteSize: sourceAsset.byteSize, width: 640, height: 360 },
    output: { contentHash: 'b'.repeat(64), pixelHash: 'e'.repeat(64), mimeType: 'image/png', byteSize: 123, width: 576, height: 324, hasAlpha: true },
    geometry: deriveAvgImageProcessingGeometryV1(projectAvgForegroundCanvasRecipeV1(recipe), 640, 360),
    renderer: { userAgent: 'unit-fixture-no-native-pixels', platform: 'fixture' },
    foreground: { algorithm: DECLARED_MAGENTA_ALPHA_MATTING_ID_V1, removedPixelRatio: 0.5, algorithmMaskRatio: 0.5,
      reservedBorderRatio: 1, clearedPixelCount: 115200, translucentPixelCount: 0, opaquePixelCount: 115200,
      width: 640, height: 360, policyHash: await hashProductProductionValueV2(recipe.foreground),
      sourcePixelHash: 'c'.repeat(64), cutoutPixelHash: 'f'.repeat(64), alphaPlaneHash: 'd'.repeat(64) } }
  const receipt = { ...body, receiptHash: await hashProductProductionValueV2(body) }
  const payload: AvgProcessedImagePayloadV2 = { schema: 'storyforge.avg.processed-image', version: 2, requirementKey: requirement.requirementKey,
    raw: { artifactKey: `avg.media.raw.${requirement.requirementKey}`, version: 1, contentHash: sourceAsset.contentHash, producerReceiptHash: '9'.repeat(64) },
    sourceAsset, recipe, receipt }
  const asset = { ...sourceAsset, version: 2, contentHash: receipt.output.contentHash, blobContentHash: receipt.output.contentHash,
    mimeType: 'image/png', byteSize: 123, width: 576, height: 324, source: AVG_IMAGE_PROCESSOR_V2 }
  const row = { artifactKey: `avg.media.processed.${requirement.requirementKey}`, kind: 'image' as const, mediaKind: 'character-pose' as const,
    payloadJson: JSON.stringify(payload), metadataJson: JSON.stringify(asset), rightsJson: JSON.stringify({ origin: 'local-processing',
      sourceContentHash: sourceAsset.contentHash, sourceLicense: sourceAsset.license, declaration: recipe.declaration }),
    contentHash: asset.contentHash, mimeType: asset.mimeType, byteSize: asset.byteSize, blobObjectId: 1 }
  const definition = { imageProcessing: { schema: 'storyforge.avg.image-processing-plan' as const, version: 2 as const,
    entries: [{ requirementKey: requirement.requirementKey, recipe }] }, mediaBatch: { requirements: [requirement] } }
  return { recipe, receipt, payload, sourceAsset, asset, row, definition }
}
async function rehash(receipt: AvgImageProcessingReceiptV2) {
  const { receiptHash: _old, ...body } = receipt; void _old
  return { ...body, receiptHash: await hashProductProductionValueV2(body) }
}

describe('AVG foreground PNG receipt and portable metadata codecs without producer authority', () => {
  it('binds the explicit policy, original frame, cutout alpha and final PNG in a distinct V2 receipt', async () => {
    const f = await fixture()
    expect(await assertAvgImageProcessingReceiptV2(f.recipe, f.receipt)).toEqual(f.receipt)
    expect(await parseAvgProcessedImagePayload(JSON.stringify(f.payload))).toEqual(f.payload)
    await expect(parseAvgProcessedImagePayloadV1(f.payload)).rejects.toThrow(/版本/)
    expect(() => parseAvgImageProcessingReceiptV2({ ...f.receipt, ownerWorkId: 1 })).toThrow(/未知/)
  })

  it('checks policy and geometry independently even if the outer receipt has a newly valid hash', async () => {
    const f = await fixture()
    const policy = await rehash({ ...f.receipt, foreground: { ...f.receipt.foreground, policyHash: '0'.repeat(64) } })
    await expect(assertAvgImageProcessingReceiptV2(f.recipe, policy)).rejects.toThrow(/策略/)
    const geometry = await rehash({ ...f.receipt, geometry: { ...f.receipt.geometry,
      destination: { ...f.receipt.geometry.destination, x: 1 } } })
    await expect(assertAvgImageProcessingReceiptV2(f.recipe, geometry)).rejects.toThrow(/几何/)
  })

  it('refuses layout aliases, missing output alpha and forged physical counters', async () => {
    const f = await fixture()
    expect(() => parseAvgImageProcessingReceiptV2({ ...f.receipt,
      foreground: { ...f.receipt.foreground, width: 320, height: 720 } })).toThrow(/来源尺寸/)
    expect(() => parseAvgImageProcessingReceiptV2({ ...f.receipt, output: { ...f.receipt.output, hasAlpha: false } })).toThrow(/alpha/)
    expect(() => parseAvgImageProcessingReceiptV2({ ...f.receipt,
      foreground: { ...f.receipt.foreground, clearedPixelCount: 1 } })).toThrow(/统计/)
    await expect(assertAvgImageProcessingReceiptV2(f.recipe, { ...f.receipt,
      foreground: { ...f.receipt.foreground, alphaPlaneHash: '1'.repeat(64) } })).rejects.toThrow(/hash/)
  })

  it('matches the actual V2 processed metadata and requires the pre-request backdrop declaration', async () => {
    const f = await fixture(), actual = await assertAvgProcessedImageArtifactFromDefinition(f.definition, f.row)
    expect(actual.asset).toEqual(f.asset)
    expect(actual.payload).toEqual(f.payload)
    await expect(assertAvgProcessedImageArtifactFromDefinition({ ...f.definition,
      mediaBatch: { requirements: [{ ...f.definition.mediaBatch.requirements[0]!, invariants: [] }] } }, f.row)).rejects.toThrow(/冻结/)
    await expect(assertAvgProcessedImageArtifactFromDefinition(f.definition, { ...f.row,
      metadataJson: JSON.stringify({ ...f.asset, source: AVG_IMAGE_PROCESSOR_V1 }) })).rejects.toThrow(/元数据/)
    await expect(parseAvgProcessedImagePayload({ ...f.payload, raw: { ...f.payload.raw, contentHash: '0'.repeat(64) } })).rejects.toThrow(/来源/)
  })

  it('keeps the original V1 parsed JSON and hash fields unchanged', async () => {
    const f = await fixture(), recipe = avgImageProcessingRecipeFixture(), receipt = await avgImageProcessingReceiptFixture({ recipe,
      source: f.receipt.source, data: new Uint8Array([1, 2, 3]).buffer })
    const payload = { schema: 'storyforge.avg.processed-image', version: 1, requirementKey: f.payload.requirementKey,
      raw: f.payload.raw, sourceAsset: f.sourceAsset, recipe, receipt }
    expect(JSON.stringify(await parseAvgProcessedImagePayloadV1(payload))).toBe(JSON.stringify(payload))
    expect(JSON.stringify(await parseAvgProcessedImagePayload(payload))).toBe(JSON.stringify(payload))
  })
})
