import { describe, expect, it } from 'vitest'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import type { AvgVisualProductionRequirementV1 } from '../../src/lib/avg/media-production-contract'
import { compileAvgForegroundRequirement, type AvgForegroundPolicyV2 } from '../../src/lib/avg/image-foreground-contract'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from '../../src/lib/avg/image-foreground-boundary-unmix'
import { executeAvgForegroundWorkerRequestV2, hashAvgForegroundPixelsV2 } from '../../src/lib/avg/image-foreground-worker-protocol-v2'
import { deriveAvgImageProcessingGeometryV1, type AvgImageProcessingRecipeV2 } from '../../src/lib/avg/image-processing-contract'
import { AVG_IMAGE_PROCESSOR_V2, assertAvgImageProcessingReceiptV2, assertAvgProcessedImageArtifactFromDefinition,
  parseAvgForegroundProcessingObservationV1, parseAvgProcessedImagePayload, projectAvgForegroundCanvasRecipeV1,
  type AvgImageProcessingReceiptV2, type AvgProcessedImagePayloadV2 } from '../../src/lib/avg/image-processing-contract-v2'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { avgImageProcessingRecipeFixture } from '../helpers/avg-image-processing-fixture'

// Mixed scalar/real numerical fixtures only: no encoded PNG, producer, DB or
// author command. In particular a valid codec cannot establish byte authority.
async function fixture() {
  const policy: AvgForegroundPolicyV2 = { schema: 'storyforge.avg.foreground-policy', version: 2, method: 'reserved-magenta',
    reservedColor: '#FF00FF', subjectUsesReservedColor: false, algorithm: AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2,
    declaration: '数值与合同夹具；不授人物/参考/作者采用或美术权限' }
  const recipe: AvgImageProcessingRecipeV2 = { ...avgImageProcessingRecipeFixture(), version: 2, foreground: policy }
  const requirement = compileAvgForegroundRequirement<AvgVisualProductionRequirementV1>(policy, {
    requirementKey: 'boundary.pose', revision: 1, assetKey: 'boundary.pose', name: '合同人物', altText: '合同原图',
    family: { subjectKey: 'keeper', familyKey: 'keeper.uniform', variantKey: 'standing', revision: 1 },
    consumer: { consumerKey: 'keeper.actor', domain: 'stage', slot: 'actor', subjectKey: 'keeper', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
    triggerBeatKey: 'desk.intro', itemVariantKey: null, mediaKind: 'character-pose', prompt: '数值合同夹具', negativePrompt: '',
    invariants: [], forbiddenDepictions: [], width: 576, height: 324, resolutionTier: '1K', alpha: 'required', references: [] })
  const rgba = new Uint8ClampedArray(30 * 30 * 4)
  for (let at = 0; at < rgba.length; at += 4) rgba.set([255, 0, 255, 255], at)
  for (let y = 5; y < 25; y += 1) for (let x = 6; x < 24; x += 1) rgba.set([200, 149, 99, 255], (y * 30 + x) * 4)
  const computed = await executeAvgForegroundWorkerRequestV2({ schema: 'storyforge.avg.foreground-worker-request', version: 2,
    phase: 'compute', jobId: 'codec-fixture-not-producer', width: 30, height: 30, rgba: rgba.buffer, policy })
  if (!computed.ok || computed.phase !== 'compute') throw new Error('Fixture computation failed')
  const pixels = new Uint8ClampedArray(computed.rgba), alpha = new Uint8Array(900)
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels[i * 4 + 3]
  const sourceAsset: FrozenRuntimeMediaAssetV2 = { assetKey: requirement.assetKey, version: 1, kind: 'character-pose', name: '未编码合同原图',
    mimeType: 'image/png', byteSize: 456, width: 30, height: 30, durationMs: null, contentHash: 'a'.repeat(64),
    source: 'unit-codec-no-encoded-png', license: '原创数值夹具，不代表真实许可', altText: '合同原图', characterTag: 'keeper', sceneTag: 'desk', blobContentHash: 'a'.repeat(64) }
  const body: Omit<AvgImageProcessingReceiptV2, 'receiptHash'> = { schema: 'storyforge.avg.image-processing-receipt', version: 2,
    processor: AVG_IMAGE_PROCESSOR_V2, recipeHash: await hashProductProductionValueV2(recipe),
    source: { contentHash: sourceAsset.contentHash, mimeType: 'image/png', byteSize: 456, width: 30, height: 30 },
    output: { contentHash: 'b'.repeat(64), pixelHash: 'e'.repeat(64), mimeType: 'image/png', byteSize: 123, width: 576, height: 324, hasAlpha: true },
    geometry: deriveAvgImageProcessingGeometryV1(projectAvgForegroundCanvasRecipeV1(recipe), 30, 30),
    renderer: { userAgent: 'codec-not-native-png', platform: 'fixture' },
    foreground: { ...computed.observation, width: 30, height: 30, policyHash: await hashProductProductionValueV2(policy),
      sourcePixelHash: await hashAvgForegroundPixelsV2(rgba), cutoutPixelHash: await hashAvgForegroundPixelsV2(pixels), alphaPlaneHash: await hashAvgForegroundPixelsV2(alpha) } }
  const receipt = { ...body, receiptHash: await hashProductProductionValueV2(body) }
  const payload: AvgProcessedImagePayloadV2 = { schema: 'storyforge.avg.processed-image', version: 2, requirementKey: requirement.requirementKey,
    raw: { artifactKey: `avg.media.raw.${requirement.requirementKey}`, version: 1, contentHash: sourceAsset.contentHash, producerReceiptHash: '9'.repeat(64) },
    sourceAsset, recipe, receipt }
  const asset = { ...sourceAsset, version: 2, contentHash: receipt.output.contentHash, blobContentHash: receipt.output.contentHash,
    byteSize: 123, width: 576, height: 324, source: AVG_IMAGE_PROCESSOR_V2 }
  const row = { artifactKey: `avg.media.processed.${requirement.requirementKey}`, kind: 'image' as const, mediaKind: 'character-pose' as const,
    payloadJson: JSON.stringify(payload), metadataJson: JSON.stringify(asset), rightsJson: JSON.stringify({ origin: 'local-processing', sourceContentHash: sourceAsset.contentHash,
      sourceLicense: sourceAsset.license, declaration: recipe.declaration }), contentHash: asset.contentHash, mimeType: asset.mimeType, byteSize: asset.byteSize, blobObjectId: 1 }
  const definition = { imageProcessing: { schema: 'storyforge.avg.image-processing-plan' as const, version: 2 as const,
    entries: [{ requirementKey: requirement.requirementKey, recipe }] }, mediaBatch: { requirements: [requirement] } }
  return { policy, recipe, receipt, payload, definition, row, asset }
}
async function rehash(receipt: AvgImageProcessingReceiptV2) {
  const { receiptHash: _old, ...body } = receipt; void _old
  return { ...body, receiptHash: await hashProductProductionValueV2(body) }
}

describe('AVG boundary policy2 through exact processed receipt/metadata codecs', () => {
  it('binds a distinct policy/algorithm/observation without presenting it to the old observation codec', async () => {
    const f = await fixture()
    expect(await assertAvgImageProcessingReceiptV2(f.recipe, f.receipt)).toEqual(f.receipt)
    expect(await parseAvgProcessedImagePayload(JSON.stringify(f.payload))).toEqual(f.payload)
    expect(() => parseAvgForegroundProcessingObservationV1(f.receipt.foreground)).toThrow()
    expect((await assertAvgProcessedImageArtifactFromDefinition(f.definition, f.row)).asset).toEqual(f.asset)
  })

  it('rejects changed policies and false numerical observations even when the outer hash is recalculated', async () => {
    const f = await fixture()
    const observation = f.receipt.foreground
    if (!('version' in observation) || observation.version !== 2) throw new Error('Expected actual boundary observation')
    await expect(assertAvgImageProcessingReceiptV2(f.recipe, await rehash({ ...f.receipt,
      foreground: { ...observation, policyHash: '0'.repeat(64) } }))).rejects.toThrow(/策略/)
    await expect(assertAvgImageProcessingReceiptV2(f.recipe, await rehash({ ...f.receipt,
      foreground: { ...observation, maxCompositeResidual: 2 } }))).rejects.toThrow()
  })

  it('requires original frozen reservation and exact source metadata instead of accepting a valid-looking receipt alone', async () => {
    const f = await fixture()
    await expect(assertAvgProcessedImageArtifactFromDefinition({ ...f.definition,
      mediaBatch: { requirements: [{ ...f.definition.mediaBatch.requirements[0], invariants: [] }] } }, f.row)).rejects.toThrow(/冻结/)
    await expect(assertAvgProcessedImageArtifactFromDefinition(f.definition, { ...f.row,
      metadataJson: JSON.stringify({ ...f.asset, source: 'unit-codec-no-encoded-png' }) })).rejects.toThrow(/元数据/)
  })
})
