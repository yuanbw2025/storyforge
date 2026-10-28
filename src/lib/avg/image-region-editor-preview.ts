import type { WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readMediaBlobObjectData } from '../product-production/media-blob-store'
import { readAvgVisualRawReuseSourceV5 } from './visual-image-reuse'
import type { AvgVisualRawReuseSourceV5 } from './visual-image-reuse-contract'
import type { AvgMediaReferenceV2 } from './media-reference-contract-v2'
import { readAvgGeneratedReferenceForPurposeV2 } from './media-generated-reference'
import type { AvgImageRegionCompositeRecipeV3 } from './image-region-composite-contract'
import { readAvgRegionCompositeInputsV1, type AvgRegionCompositeSourceReadV1 } from './image-region-composite-source'
import { runAvgRegionCompositeWorkersV1 } from './image-region-composite-worker-client'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Work-scoped, read-only editor images. A displayed pair is neither a new
 * processing claim nor an author review, adoption or outbound permission. */
export async function readAvgRegionEditorImagesV1(input: { scope: WorkspaceScope; source: AvgVisualRawReuseSourceV5; reference: AvgMediaReferenceV2 }) {
  const raw = await readAvgVisualRawReuseSourceV5(input), requirement = raw.payload.requirement, reference = input.reference
  if (requirement.mediaKind !== 'character-expression' || !requirement.family || reference.purpose !== 'identity'
    || !reference.generatedSource || !reference.derivativeUseAllowed || !reference.providerInputAllowed
    || !requirement.references.some(ref => same(ref, reference)) || raw.raw.blobObjectId === null) throw new Error('[avg-region-editor] 只能对原请求实际使用的已采用身份底图配置表情')
  const base = await readAvgGeneratedReferenceForPurposeV2(input.scope, reference, requirement.family), family = requirement.family
  if (base.referenceOnly || base.family.subjectKey !== family.subjectKey || base.family.familyKey !== family.familyKey || base.family.revision !== family.revision
    || !['character-pose', 'character-expression'].includes(base.asset.kind) || base.asset.mimeType !== 'image/png' || raw.asset.mimeType !== 'image/png'
    || !raw.asset.width || !raw.asset.height || !base.asset.width || !base.asset.height || base.asset.width < requirement.width || base.asset.height < requirement.height) throw new Error('[avg-region-editor] 底图角色家族、PNG或画布不满足本项表情需求')
  const data = await readMediaBlobObjectData({ scope: input.scope, blobObjectId: raw.raw.blobObjectId, expected: raw.asset })
  const sourceRead: Omit<AvgRegionCompositeSourceReadV1, 'scope' | 'recipe'> = {
    raw: { buildId: raw.build.id!, artifactKey: raw.raw.artifactKey, version: raw.raw.version, contentHash: raw.raw.contentHash },
    source: { mode: 'historical', frozen: { expectedBuildRevision: raw.build.stateRevision, expectedBriefHash: raw.build.briefHash,
      expectedPlanHash: raw.build.planHash, controlEpoch: input.source.raw.controlEpoch } },
  }
  return { raw: { asset: raw.asset, data, width: raw.asset.width, height: raw.asset.height },
    base: { asset: base.asset, data: base.data, width: base.asset.width, height: base.asset.height }, sourceRead }
}

/** Explicit in-memory trial only. Uses the same physical sources/workers and
 * rechecks them, but never puts a Blob, creates a Run or accepts an artifact. */
export async function previewAvgRegionEditorV1(input: { scope: WorkspaceScope; recipe: AvgImageRegionCompositeRecipeV3;
  sourceRead: Omit<AvgRegionCompositeSourceReadV1, 'scope' | 'recipe'>; signal: AbortSignal }) {
  const read = { scope: input.scope, recipe: input.recipe, ...input.sourceRead }, original = await readAvgRegionCompositeInputsV1(read)
  if (input.signal.aborted) throw new Error('[avg-region-editor] 试算已取消')
  const result = await runAvgRegionCompositeWorkersV1({ ...original.input, signal: input.signal }), fresh = await readAvgRegionCompositeInputsV1(read)
  if (input.signal.aborted || !same(original.evidence, fresh.evidence)) throw new Error('[avg-region-editor] 两图来源已变化，试算结果已丢弃')
  return result
}
