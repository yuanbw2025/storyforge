import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { avgProtocolBody, avgRecord } from './protocol-validation'
import { parseAvgProcessedImageSourceFieldsV1, assertAvgImageProcessingSourceFieldsV1, type AvgProcessedImagePayloadV1 } from './image-processing-contract'
import { parseAvgImageRegionCompositeRecipeV3, type AvgImageRegionCompositeRecipeV3 } from './image-region-composite-contract'
import { assertAvgImageRegionCompositeReceiptV3, type AvgImageRegionCompositeReceiptV3 } from './image-region-composite-receipt'
import { parseAvgRegionInputEvidenceV1, type AvgRegionInputEvidenceV1 } from './image-region-input-contract'

export interface AvgProcessedImagePayloadV3 extends Omit<AvgProcessedImagePayloadV1, 'version' | 'recipe' | 'receipt'> {
  version: 3; recipe: AvgImageRegionCompositeRecipeV3; receipt: AvgImageRegionCompositeReceiptV3
  inputEvidence: AvgRegionInputEvidenceV1
}
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
export async function parseAvgProcessedImagePayloadV3(value: unknown): Promise<AvgProcessedImagePayloadV3> {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'requirementKey', 'raw', 'sourceAsset', 'recipe', 'receipt', 'inputEvidence'], 'region processed image')
  if (r.schema !== 'storyforge.avg.processed-image' || r.version !== 3) throw new Error('[avg-composite] 合成图工件版本无效')
  const source = parseAvgProcessedImageSourceFieldsV1({ requirementKey: r.requirementKey, raw: r.raw, sourceAsset: r.sourceAsset })
  const recipe = parseAvgImageRegionCompositeRecipeV3(r.recipe), receipt = await assertAvgImageRegionCompositeReceiptV3(recipe, r.receipt)
  assertAvgImageProcessingSourceFieldsV1(source, receipt)
  const inputEvidence = parseAvgRegionInputEvidenceV1(r.inputEvidence, source.requirementKey), ref = inputEvidence.base.reference, asset = inputEvidence.base.asset
  const raw = inputEvidence.raw
  if (!same(source.raw, { artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash, producerReceiptHash: raw.producerReceiptHash })
    || !same(inputEvidence.sourceAsset, source.sourceAsset)
    || !same(receipt.base, { contentHash: asset.contentHash, mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width, height: asset.height,
      assetKey: asset.assetKey, assetVersion: asset.version })
    || receipt.inputProof.rawProducerReceiptHash !== raw.producerReceiptHash
    || receipt.inputProof.baseReferenceHash !== await hashProductProductionValueV2(ref)
    || receipt.inputProof.baseGeneratedSourceHash !== await hashProductProductionValueV2(ref.generatedSource)
    || receipt.inputProof.inputProofHash !== await hashProductProductionValueV2(inputEvidence)) throw new Error('[avg-composite] 合成图未绑定准确两来源、权限与回执')
  return { schema: r.schema, version: 3, ...source, recipe, receipt, inputEvidence }
}
export function avgRegionCompositeRightsV3(payload: Pick<AvgProcessedImagePayloadV3, 'raw' | 'sourceAsset' | 'recipe' | 'inputEvidence' | 'receipt'>) {
  return { origin: 'local-composition', sourceContentHash: payload.raw.contentHash, sourceLicense: payload.sourceAsset.license,
    baseContentHash: payload.inputEvidence.base.asset.contentHash, baseLicense: payload.inputEvidence.base.asset.license,
    baseReferenceHash: payload.receipt.inputProof.baseReferenceHash, declaration: payload.recipe.declaration }
}
