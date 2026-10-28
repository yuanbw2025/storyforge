import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import type { AvgMediaReferenceV2 } from '../../src/lib/avg/media-reference-contract-v2'
import { processAvgRegionCompositeBytesV1 } from '../../src/lib/avg/image-region-composite-pixels'
import { avgRegionCompositeByteFixture } from './avg-region-composite-byte-fixture'

/** Physical pixels with scalar UI-only source tokens. There are no matching
 * Work, Run or adoption records, so actual source readers must reject these. */
export async function avgRegionEditorUiFixture() {
  const pixels = await avgRegionCompositeByteFixture(), result = await processAvgRegionCompositeBytesV1(pixels)
  const asset = (key: string, kind: 'character-pose' | 'character-expression', version: number, physical: typeof pixels.source): FrozenRuntimeMediaAssetV2 => ({
    assetKey: key, kind, version, name: key, contentHash: physical.contentHash, mimeType: physical.mimeType, byteSize: physical.byteSize,
    width: physical.width, height: physical.height, blobContentHash: physical.contentHash, durationMs: null,
    source: 'synthetic-region-ui-only', license: 'CC0 synthetic UI pixels; no actual source authority', altText: 'synthetic UI pixels', characterTag: 'keeper', sceneTag: '',
  })
  const baseAsset = asset(pixels.base.assetKey, 'character-pose', 2, pixels.base), rawAsset = asset('synthetic.expression.asset', 'character-expression', 1, pixels.source)
  const reference: AvgMediaReferenceV2 = { schema: 'storyforge.avg.media-reference', version: 2,
    assetKey: baseAsset.assetKey, assetVersion: 2, contentHash: baseAsset.contentHash, mimeType: 'image/png', byteSize: baseAsset.byteSize,
    purpose: 'identity', allowedChange: 'Synthetic UI expression only', dataClass: 'synthetic', license: baseAsset.license,
    providerInputAllowed: true, derivativeUseAllowed: true, crop: null, mask: null,
    contentPolicy: { permittedFeatures: ['synthetic identity'], excludedFeatures: ['pose'] },
    generatedSource: { schema: 'storyforge.avg.generated-reference-source', version: 1, productionKey: 'synthetic.absent-base', requirementKey: 'base',
      raw: { schema: 'storyforge.avg.retained-raw-image-proof', version: 1, buildNumber: 1, briefHash: 'a'.repeat(64), planHash: 'b'.repeat(64), controlEpoch: 0,
        taskKey: 'avg.media.generate.base', artifactKey: 'avg.media.raw.base', artifactVersion: 1, contentHash: baseAsset.contentHash,
        inputHash: 'c'.repeat(64), producerReceiptHash: 'd'.repeat(64), candidateHash: 'e'.repeat(64), proofHash: 'f'.repeat(64) },
      choice: { artifactKey: 'avg.media.choice.base', version: 1, contentHash: '1'.repeat(64), authorReceiptHash: '2'.repeat(64) } },
  }
  return { pixels, result, rawAsset, baseAsset, reference }
}
