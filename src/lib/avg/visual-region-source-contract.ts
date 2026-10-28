import { avgHash, avgKey, avgNumber, avgRecord } from './protocol-validation'
import { parseAvgVisualRawProducerProofV5, parseAvgImageRevalidationProducerProofV1,
  type AvgGeneratedReferenceSourceV5, type AvgGeneratedReferenceSourceV7, type AvgGeneratedReferenceSourceV8 } from './media-generated-reference-contract'
import { parseAvgVisualRawReuseSourceV5 } from './visual-image-reuse-contract'
import { parseAvgLocalProcessingProducerProofV1 } from './visual-processed-source-contract'
import { avgMediaChoiceArtifactKeyV1, avgVisualReviewArtifactKeyV1 } from './media-production-contract'

/** Distinct composed-image lineage. Older sources cannot acquire this
 * meaning from the existence of a similarly shaped processing proof. */
export interface AvgGeneratedReferenceSourceV9 extends Omit<AvgGeneratedReferenceSourceV5, 'version' | 'raw' | 'processing'> {
  version: 9
  raw: AvgGeneratedReferenceSourceV5['raw'] | AvgGeneratedReferenceSourceV7['raw']
  original: AvgGeneratedReferenceSourceV7['original'] | null
  processing: AvgGeneratedReferenceSourceV8['processing']
  composition: { recipeHash: string; processingReceiptHash: string; baseReferenceHash: string; baseGeneratedSourceHash: string; inputProofHash: string }
}
export function parseAvgGeneratedReferenceSourceV9(value: unknown): AvgGeneratedReferenceSourceV9 {
  const r = avgRecord(value, ['schema', 'version', 'productionKey', 'requirementKey', 'raw', 'original', 'compilation', 'choice', 'review', 'processing', 'composition'], 'composed image source')
  if (r.schema !== 'storyforge.avg.generated-reference-source' || r.version !== 9) throw new Error('[avg-composite] 合成图来源版本无效')
  const productionKey = avgKey(r.productionKey, 'composed productionKey'), requirementKey = avgKey(r.requirementKey, 'composed requirementKey')
  const original = r.original === null ? null : parseAvgVisualRawReuseSourceV5(r.original)
  const raw = original ? parseAvgImageRevalidationProducerProofV1(r.raw, requirementKey) : parseAvgVisualRawProducerProofV5(r.raw, requirementKey)
  if (original && (original.productionKey !== productionKey || original.requirementKey !== requirementKey
    || original.raw.contentHash !== raw.contentHash || original.raw.buildNumber >= raw.buildNumber)) throw new Error('[avg-composite] 原始图片、本版复验与合成来源不闭合')
  const processing = parseAvgLocalProcessingProducerProofV1(r.processing, requirementKey, raw)
  const c = avgRecord(r.compilation, ['artifactKey', 'version', 'contentHash'], 'composed compilation')
  if (c.artifactKey !== 'avg.media.compiled-visual-requirements') throw new Error('[avg-composite] 合成缺少准确编译来源')
  const author = (value: unknown, artifactKey: string) => {
    const a = avgRecord(value, ['artifactKey', 'version', 'contentHash', 'authorReceiptHash'], 'composed author witness')
    if (a.artifactKey !== artifactKey) throw new Error('[avg-composite] 合成缺少准确独立评审或作者采用')
    return { artifactKey, version: avgNumber(a.version, 'composed author version', 1, 1e9), contentHash: avgHash(a.contentHash, 'composed author hash'), authorReceiptHash: avgHash(a.authorReceiptHash, 'composed author receipt') }
  }
  const p = avgRecord(r.composition, ['recipeHash', 'processingReceiptHash', 'baseReferenceHash', 'baseGeneratedSourceHash', 'inputProofHash'], 'composed physical witness')
  return { schema: r.schema, version: 9, productionKey, requirementKey, raw, original, processing,
    compilation: { artifactKey: c.artifactKey, version: avgNumber(c.version, 'composed compilation version', 1, 1e9), contentHash: avgHash(c.contentHash, 'composed compilation hash') },
    choice: author(r.choice, avgMediaChoiceArtifactKeyV1(requirementKey)), review: author(r.review, avgVisualReviewArtifactKeyV1(requirementKey)),
    composition: { recipeHash: avgHash(p.recipeHash, 'composition recipeHash'), processingReceiptHash: avgHash(p.processingReceiptHash, 'composition receiptHash'),
      baseReferenceHash: avgHash(p.baseReferenceHash, 'composition baseReferenceHash'), baseGeneratedSourceHash: avgHash(p.baseGeneratedSourceHash, 'composition baseSourceHash'), inputProofHash: avgHash(p.inputProofHash, 'composition inputProofHash') } }
}
