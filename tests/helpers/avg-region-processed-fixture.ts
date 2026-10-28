import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { avgRegionCompositeByteFixture } from './avg-region-composite-byte-fixture'
import { parseAvgMediaReferencesV2 } from '../../src/lib/avg/media-reference-contract-v2'
import { parseAvgRegionInputEvidenceV1 } from '../../src/lib/avg/image-region-input-contract'
import { processAvgRegionCompositeBytesV1 } from '../../src/lib/avg/image-region-composite-pixels'
import { parseAvgProcessedImagePayloadV3 } from '../../src/lib/avg/image-processing-contract-v3'

/** Synthetic scalar source witness and real local pixels; intentionally no
 * matching saved producer, Work or adoption. This grants no author authority. */
export async function avgRegionProcessedFixture() {
  const pixels = await avgRegionCompositeByteFixture(), requirementKey = 'synthetic.expression'
  const asset = (key: string, kind: 'character-pose' | 'character-expression', version: number,
    physical: typeof pixels.source): FrozenRuntimeMediaAssetV2 => ({ assetKey: key, version, kind, name: key,
    contentHash:physical.contentHash,mimeType:physical.mimeType,byteSize:physical.byteSize,width:physical.width,height:physical.height,
    durationMs: null, source: 'synthetic-unit-pixels', license: 'CC0 synthetic test pixels',
    altText: 'synthetic pixel contract fixture', characterTag: 'keeper', sceneTag: 'scene', blobContentHash: physical.contentHash })
  const base = asset(pixels.base.assetKey, 'character-pose', pixels.base.assetVersion, pixels.base), sourceAsset = asset('synthetic.expression.asset', 'character-expression', 1, pixels.source)
  const generatedSource = { schema: 'storyforge.avg.generated-reference-source', version: 1, productionKey: 'synthetic.absent-base-producer', requirementKey: 'base',
    raw: { schema: 'storyforge.avg.retained-raw-image-proof', version: 1, buildNumber: 1, briefHash: 'a'.repeat(64), planHash: 'b'.repeat(64), controlEpoch: 0,
      taskKey: 'avg.media.generate.base', artifactKey: 'avg.media.raw.base', artifactVersion: 1, contentHash: base.contentHash,
      inputHash: 'c'.repeat(64), producerReceiptHash: 'd'.repeat(64), candidateHash: 'e'.repeat(64), proofHash: 'f'.repeat(64) },
    choice: { artifactKey: 'avg.media.choice.base', version: 1, contentHash: '1'.repeat(64), authorReceiptHash: '2'.repeat(64) } }
  const reference = parseAvgMediaReferencesV2([{ schema: 'storyforge.avg.media-reference', version: 2, assetKey: base.assetKey, assetVersion: base.version,
    contentHash: base.contentHash, mimeType: base.mimeType, byteSize: base.byteSize, purpose: 'identity', allowedChange: 'Expression only',
    dataClass: 'synthetic', license: base.license, providerInputAllowed: true, derivativeUseAllowed: true, crop: null, mask: null,
    contentPolicy: { permittedFeatures: ['identity'], excludedFeatures: ['pose-change'] }, generatedSource }])[0]!
  const raw = { artifactKey: `avg.media.raw.${requirementKey}`, version: 1, contentHash: sourceAsset.contentHash, producerReceiptHash: 'a'.repeat(64) }
  const inputEvidence = parseAvgRegionInputEvidenceV1({ schema: 'storyforge.avg.region-input-evidence', version: 1,
    raw: { productionKey: 'synthetic.current', buildNumber: 2, briefHash: 'b'.repeat(64), planHash: 'c'.repeat(64), controlEpoch: 0, ...raw },
    sourceAsset, base: { reference, asset: base } }, requirementKey)
  const inputProof = { rawProducerReceiptHash: raw.producerReceiptHash, baseReferenceHash: await hashProductProductionValueV2(reference),
    baseGeneratedSourceHash: await hashProductProductionValueV2(reference.generatedSource), inputProofHash: await hashProductProductionValueV2(inputEvidence) }
  const result = await processAvgRegionCompositeBytesV1({ ...pixels, inputProof })
  const payload = await parseAvgProcessedImagePayloadV3({ schema: 'storyforge.avg.processed-image', version: 3, requirementKey, raw, sourceAsset,
    recipe: pixels.recipe, receipt: result.receipt, inputEvidence })
  return { pixels, reference, inputEvidence, payload, result }
}
