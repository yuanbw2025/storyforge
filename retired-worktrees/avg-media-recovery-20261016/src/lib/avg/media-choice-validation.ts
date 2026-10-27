import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { parseAvgAuthorMediaChoice, type AvgAuthorMediaChoice } from './media-production-contract'
import { inspectAvgImageBytesV1 } from './image-decoder'
import { inspectAvgProcessedImageSourceV1, readAvgProcessedImageSourceV1 } from './image-processing-source'
import { readAvgImageDefinitionV3 } from './media-production-definition'

export interface AvgMediaChoiceValidationV1 {
  schema: 'storyforge.avg.media-choice-validation'
  version: 1
  choiceHash: string
  rawReceiptHash: string
  width: number
  height: number
  hasAlpha: boolean
}
export type AvgMediaChoiceValidation=AvgMediaChoiceValidationV1|(Omit<AvgMediaChoiceValidationV1,'version'>&{
  version:2;processedProducerReceiptHash:string;processingReceiptHash:string
})

/** Exact producer evidence, original pixels and actual browser decoding are
 * rechecked before candidate staging, adoption and stage compilation. */
export async function readAvgChosenMediaSourceV2(input: { scope: WorkspaceScope; buildId: number; brief: ProductProductionBriefV3; choice: AvgAuthorMediaChoice }) {
  const choice = parseAvgAuthorMediaChoice(input.choice)
  const row = await verifyAcceptedProductBuildArtifactV1({ scope: input.scope, buildId: input.buildId, ...choice.raw })
  return inspectAvgChosenImageV1({ ...input, choice, row })
}

/** Byte/choice validation only. Callers separately supply a verified current
 * or read-only historical producer proof; this grants no adoption authority. */
export async function inspectAvgChosenImageV1(input: { scope: WorkspaceScope; brief: ProductProductionBriefV3;
  choice: AvgAuthorMediaChoice; row: ProductBuildArtifactRecordV1; processed?:ProductBuildArtifactRecordV1 }) {
  const choice = parseAvgAuthorMediaChoice(input.choice), row = input.row
  const raw = await assertAvgRawImageArtifactV1(input.brief, row), r = raw.payload.requirement
  const frozenProcessing=readAvgImageDefinitionV3(input.brief).imageProcessing?.entries.some(e=>e.requirementKey===r.requirementKey)??false
  if(frozenProcessing!==(choice.version===2))throw new Error('[avg-process] 选择不能绕过冻结的加工步骤，也不能夹带未冻结加工')
  const processed=choice.version===2?(input.processed?await inspectAvgProcessedImageSourceV1({...input,raw:row,processed:input.processed})
    :await readAvgProcessedImageSourceV1({scope:input.scope,buildId:row.buildId,brief:input.brief,raw:row,version:choice.processed.version,contentHash:choice.processed.contentHash})):undefined
  if(choice.version===2&&(!processed||processed.row.artifactKey!==choice.processed.artifactKey||processed.row.version!==choice.processed.version||processed.row.contentHash!==choice.processed.contentHash))throw new Error('[avg-process] 选择的准确加工版本已变化')
  const asset=processed?.asset??raw.asset,image=processed?.row??row
  if (choice.requirementKey !== r.requirementKey || choice.requirementRevision !== r.revision
    || choice.referenceOnly !== (r.consumer.domain === 'reference') || canonicalProductProductionJsonV2(choice.asset) !== canonicalProductProductionJsonV2(asset)) {
    throw new Error('[avg-media] 作者选择与准确的原图、需求修订或用途不一致')
  }
  if (asset.width! < r.width || asset.height! < r.height
    || Math.abs(asset.width! / asset.height! / (r.width / r.height) - 1) > 0.02) {
    throw new Error('[avg-media] 原图未达到冻结的最小尺寸或画幅；保留候选待返修')
  }
  const blob = image.blobObjectId === null ? null : await db.mediaBlobObjects.get(image.blobObjectId)
  if (!blob || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' }) || blob.contentHash !== asset.contentHash
    || blob.byteSize !== asset.byteSize || blob.mimeType !== asset.mimeType) throw new Error('[avg-media] 作者选择缺少同作品的准确图片字节')
  const inspect = async () => {
    const bytes = await readVerifiedMediaBlobObjectData(blob)
    return inspectAvgImageBytesV1({ data: bytes, ...asset, requireAlpha: r.alpha === 'required' })
  }
  const measured = Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(inspect), 20_000) : await inspect()
  const base={schema:'storyforge.avg.media-choice-validation' as const,choiceHash:await hashProductProductionValueV2(choice),rawReceiptHash:row.producerReceiptHash!,...measured}
  const validation:AvgMediaChoiceValidation=processed?{...base,version:2,processedProducerReceiptHash:processed.row.producerReceiptHash!,processingReceiptHash:processed.payload.receipt.receiptHash}:{...base,version:1}
  return { validation, raw: row, image, processed, asset, requirement: r }
}

export async function validateAvgMediaChoiceV1(input: Parameters<typeof readAvgChosenMediaSourceV2>[0]): Promise<AvgMediaChoiceValidation> {
  return (await readAvgChosenMediaSourceV2(input)).validation
}
