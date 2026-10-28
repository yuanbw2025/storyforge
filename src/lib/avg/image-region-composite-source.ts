import Dexie from 'dexie'
import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2, ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertAvgConsumedRawImageV5 } from './image-consumption-v5'
import { readAvgHistoricalRawImageV5, readAvgHistoricalCompiledImageDefinitionV5 } from './visual-image-history-v5'
import type { AvgHistoricalVisualBoundary } from './visual-history-authority'
import { readAvgGeneratedReferenceForPurposeV2 } from './media-generated-reference'
import { parseAvgImageRegionCompositeRecipeV3 } from './image-region-composite-contract'
import { parseAvgRegionImagePhysicalV1 } from './image-region-composite-receipt'
import type { AvgImageRegionCompositeRecipeV3 } from './image-region-composite-contract'
import type { AvgRegionInputEvidenceV1 } from './image-region-input-contract'
import { readAvgRegionRecipeReferenceV1 } from './image-region-composite-binding'
import type { AvgVisualProductionRequirementV2 } from './media-production-contract-v2'

export interface AvgRegionCompositeSourceReadV1 {
  scope: WorkspaceScope; recipe: AvgImageRegionCompositeRecipeV3
  raw: { buildId: number; artifactKey: string; version: number; contentHash: string }
  source: { mode: 'current'; brief: ProductProductionBriefV3 }
    | { mode: 'historical'; frozen: Omit<AvgHistoricalVisualBoundary, 'scope' | 'buildId'> }
}
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
function physical(asset: FrozenRuntimeMediaAssetV2) {
  return parseAvgRegionImagePhysicalV1({ contentHash: asset.contentHash, mimeType: asset.mimeType,
    byteSize: asset.byteSize, width: asset.width, height: asset.height })
}
/** Pre-generation base preflight. It grants no image request or Plan claim. */
export async function readAvgRegionCompositeBaseV1(scope:WorkspaceScope,recipeInput:AvgImageRegionCompositeRecipeV3,requirement:AvgVisualProductionRequirementV2){
  const recipe=parseAvgImageRegionCompositeRecipeV3(recipeInput),reference=readAvgRegionRecipeReferenceV1(recipe,requirement)
  const base=await readAvgGeneratedReferenceForPurposeV2(scope,reference,requirement.family),family=requirement.family
  if(!family||base.referenceOnly||!['character-pose','character-expression'].includes(base.asset.kind)
    ||base.family.subjectKey!==family.subjectKey||base.family.familyKey!==family.familyKey||base.family.revision!==family.revision)throw new Error('[avg-composite] 底图必须是同主体同家族修订的正式已采用角色图')
  const metadata=physical(base.asset)
  if(metadata.width!==recipe.width||metadata.height!==recipe.height||recipe.width<requirement.width||recipe.height<requirement.height
    ||Math.abs((recipe.width/recipe.height)/(requirement.width/requirement.height)-1)>0.02)throw new Error('[avg-composite] 底图画布不能缩放，且必须满足原冻结需求')
  return {reference,base,physical:metadata}
}
async function readRaw(input: AvgRegionCompositeSourceReadV1) {
  if (input.source.mode === 'historical') {
    const boundary={scope:input.scope,buildId:input.raw.buildId,...input.source.frozen}
    const compiled=await readAvgHistoricalCompiledImageDefinitionV5(boundary)
    if(compiled.planning.rawReuse?.some(source=>input.raw.artifactKey===`avg.media.raw.${source.requirementKey}`)){
      const load=()=>import('./visual-image-revalidation-v5')
      const {readAvgVisualRawReuseEvidenceV5}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
      const source=await readAvgVisualRawReuseEvidenceV5({scope:input.scope,compiled,artifact:input.raw})
      return {row:source.raw,build:compiled.build,production:compiled.production,asset:source.asset,payload:source.payload,requirement:source.requirement}
    }
    const original = await readAvgHistoricalRawImageV5({ scope: input.scope, buildId: input.raw.buildId,
      ...input.source.frozen, artifact: input.raw })
    return { row: original.raw, build: original.build, production: original.production, asset: original.asset,
      payload: original.payload, requirement: original.payload.requirement }
  }
  const row = await verifyAcceptedProductBuildArtifactV1({ scope: input.scope, ...input.raw })
  const original = await assertAvgConsumedRawImageV5({ scope: input.scope, brief: input.source.brief, row })
  if (original.compiled.production.currentBuildNumber !== original.compiled.build.buildNumber
    || original.compiled.build.controlEpoch !== row.controlEpoch) throw new Error('[avg-composite] 已停止或被替换的原图必须按准确历史边界读取')
  return { row, build: original.compiled.build, production: original.compiled.production, asset: original.asset,
    payload: original.payload, requirement: original.requirement }
}

/** Read-only input evidence, not a new Plan claim or author adoption.
 * It resolves the base solely from the original request's adopted identity
 * input. A matching imported key or later reference never grants this use.
 * The durable caller must freeze this recipe, re-read this evidence after the
 * bounded workers and enforce its actual claim/epoch before admitting output. */
export async function readAvgRegionCompositeInputsV1(input: AvgRegionCompositeSourceReadV1) {
  const recipe = parseAvgImageRegionCompositeRecipeV3(input.recipe), raw = await readRaw(input)
  if (raw.requirement.mediaKind !== 'character-expression' || !raw.requirement.family) throw new Error('[avg-composite] 只允许准确角色表情原图')
  const {reference,base,physical:physicalBase}=await readAvgRegionCompositeBaseV1(input.scope,recipe,raw.payload.requirement)
  const family = raw.requirement.family
  const source = physical(raw.asset)
  const blob = raw.row.blobObjectId === null ? null : await db.mediaBlobObjects.get(raw.row.blobObjectId)
  if (!blob || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' })
    || blob.contentHash !== source.contentHash || blob.byteSize !== source.byteSize || blob.mimeType !== source.mimeType) throw new Error('[avg-composite] 原图缺少同作品准确字节')
  const readBytes=()=>readVerifiedMediaBlobObjectData(blob)
  const sourceData = Dexie.currentTransaction?await Dexie.waitFor(Dexie.ignoreTransaction(readBytes),20_000):await readBytes()
  const rawRef = { artifactKey: raw.row.artifactKey, version: raw.row.version, contentHash: raw.row.contentHash, producerReceiptHash: raw.row.producerReceiptHash }
  if (!rawRef.producerReceiptHash) throw new Error('[avg-composite] 原图缺少已知 producer 回执')
  const evidence: AvgRegionInputEvidenceV1 = { schema: 'storyforge.avg.region-input-evidence', version: 1, raw: {
    productionKey: raw.production.productionKey, buildNumber: raw.build.buildNumber, briefHash: raw.build.briefHash,
    planHash: raw.build.planHash, controlEpoch: raw.row.controlEpoch, ...rawRef, producerReceiptHash: rawRef.producerReceiptHash }, sourceAsset: raw.asset,
    base: { reference, asset: base.asset } }
  const inputProof = { rawProducerReceiptHash: rawRef.producerReceiptHash, baseReferenceHash: await hashProductProductionValueV2(reference),
    baseGeneratedSourceHash: await hashProductProductionValueV2(reference.generatedSource), inputProofHash: await hashProductProductionValueV2(evidence) }
  const fresh = await readRaw(input)
  const checkedBase = await readAvgGeneratedReferenceForPurposeV2(input.scope, reference, family)
  if (!same(raw.row, fresh.row) || !same(raw.build, fresh.build) || !same(base.asset, checkedBase.asset)
    || !same(base.family, checkedBase.family) || checkedBase.referenceOnly !== base.referenceOnly) throw new Error('[avg-composite] 两输入来源在读取期间改变')
  return { evidence, input: { recipe, source, sourceData, base: { ...physicalBase, assetKey: base.asset.assetKey, assetVersion: base.asset.version },
    baseData: base.data, inputProof }, requirement: raw.requirement }
}
