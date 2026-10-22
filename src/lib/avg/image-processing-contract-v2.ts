import type { FrozenRuntimeMediaAssetV2, ProductProductionBriefV3 } from '../types'
import { readAvgImageDefinitionV3 } from './media-production-definition'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { avgHash, avgNumber, avgProtocolBody, avgRecord } from './protocol-validation'
import { assertAvgForegroundRequirementBinding } from './image-foreground-contract'
import { parseAvgForegroundPixelObservationV1, type AvgForegroundPixelObservationV1 } from './image-foreground-worker-protocol'
import { AVG_FOREGROUND_OBSERVATION_KEYS_V2, parseAvgForegroundPixelObservationV2,
  type AvgForegroundPixelObservationV2 } from './image-foreground-worker-protocol-v2'
import { AVG_IMAGE_PROCESSOR_V1, parseAvgImageProcessingReceiptV1, assertAvgImageProcessingReceiptV1,
  parseAvgImageProcessingRecipeV1, parseAvgImageProcessingRecipeV2, parseAvgImageProcessingPlan,
  deriveAvgImageProcessingGeometryV1, parseAvgProcessedImagePayloadV1, parseAvgProcessedImageSourceFieldsV1,
  assertAvgImageProcessingSourceFieldsV1, assertAvgProcessedImageArtifactMetadataV1,
  type AvgImageProcessingRecipeV1, type AvgImageProcessingRecipeV2, type AvgImageProcessingRecipe,
  type AvgImageProcessingPlan, type AvgImageProcessingReceiptV1, type AvgProcessedImagePayloadV1,
  type AvgProcessedImageArtifactFieldsV1 } from './image-processing-contract'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'

export const AVG_IMAGE_PROCESSOR_V2 = 'storyforge.avg.local-foreground-canvas.v2' as const
export interface AvgForegroundProcessingObservationV1 extends AvgForegroundPixelObservationV1 {
  width: number; height: number; policyHash: string
  sourcePixelHash: string; cutoutPixelHash: string; alphaPlaneHash: string
}
export type AvgForegroundProcessingObservation = (AvgForegroundPixelObservationV1 | AvgForegroundPixelObservationV2) & {
  width: number; height: number; policyHash: string
  sourcePixelHash: string; cutoutPixelHash: string; alphaPlaneHash: string
}
export interface AvgImageProcessingReceiptV2 extends Omit<AvgImageProcessingReceiptV1, 'version' | 'processor'> {
  version: 2
  processor: typeof AVG_IMAGE_PROCESSOR_V2
  foreground: AvgForegroundProcessingObservation
}
export type AvgImageProcessingReceipt = AvgImageProcessingReceiptV1 | AvgImageProcessingReceiptV2
export interface AvgProcessedImagePayloadV2 extends Omit<AvgProcessedImagePayloadV1, 'version' | 'recipe' | 'receipt'> {
  version: 2
  recipe: AvgImageProcessingRecipeV2
  receipt: AvgImageProcessingReceiptV2
}
export type AvgProcessedImagePayload = AvgProcessedImagePayloadV1 | AvgProcessedImagePayloadV2
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Geometry projection only, without legacy execution, receipt or Run authority. */
export function projectAvgForegroundCanvasRecipeV1(value: AvgImageProcessingRecipeV2): AvgImageProcessingRecipeV1 {
  const r = parseAvgImageProcessingRecipeV2(value)
  return parseAvgImageProcessingRecipeV1({ schema: r.schema, version: 1, crop: r.crop, width: r.width, height: r.height,
    fit: r.fit, anchor: r.anchor, background: r.background, declaration: r.declaration })
}
export function parseAvgForegroundProcessingObservationV1(value: unknown): AvgForegroundProcessingObservationV1 {
  const r = avgRecord(value, ['algorithm', 'removedPixelRatio', 'algorithmMaskRatio', 'reservedBorderRatio',
    'clearedPixelCount', 'translucentPixelCount', 'opaquePixelCount', 'width', 'height', 'policyHash',
    'sourcePixelHash', 'cutoutPixelHash', 'alphaPlaneHash'], 'foreground processing observation')
  const width = avgNumber(r.width, 'foreground.width', 2, 10_000), height = avgNumber(r.height, 'foreground.height', 2, 10_000)
  const observed = parseAvgForegroundPixelObservationV1({ algorithm: r.algorithm, removedPixelRatio: r.removedPixelRatio,
    algorithmMaskRatio: r.algorithmMaskRatio, reservedBorderRatio: r.reservedBorderRatio, clearedPixelCount: r.clearedPixelCount,
    translucentPixelCount: r.translucentPixelCount, opaquePixelCount: r.opaquePixelCount }, width, height)
  return { ...observed, width, height, policyHash: avgHash(r.policyHash, 'foreground.policyHash'),
    sourcePixelHash: avgHash(r.sourcePixelHash, 'foreground.sourcePixelHash'), cutoutPixelHash: avgHash(r.cutoutPixelHash, 'foreground.cutoutPixelHash'),
    alphaPlaneHash: avgHash(r.alphaPlaneHash, 'foreground.alphaPlaneHash') }
}
export function parseAvgForegroundProcessingObservation(value: unknown): AvgForegroundProcessingObservation {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2) return parseAvgForegroundProcessingObservationV1(value)
  const r = avgRecord(value, [...AVG_FOREGROUND_OBSERVATION_KEYS_V2, 'width', 'height', 'policyHash',
    'sourcePixelHash', 'cutoutPixelHash', 'alphaPlaneHash'], 'foreground boundary processing observation')
  const width = avgNumber(r.width, 'foreground.width', 2, 10_000), height = avgNumber(r.height, 'foreground.height', 2, 10_000)
  const observed = parseAvgForegroundPixelObservationV2(Object.fromEntries(AVG_FOREGROUND_OBSERVATION_KEYS_V2.map(key => [key, r[key]])), width, height)
  return { ...observed, width, height, policyHash: avgHash(r.policyHash, 'foreground.policyHash'),
    sourcePixelHash: avgHash(r.sourcePixelHash, 'foreground.sourcePixelHash'), cutoutPixelHash: avgHash(r.cutoutPixelHash, 'foreground.cutoutPixelHash'),
    alphaPlaneHash: avgHash(r.alphaPlaneHash, 'foreground.alphaPlaneHash') }
}
export function parseAvgImageProcessingReceiptV2(value: unknown): AvgImageProcessingReceiptV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'processor', 'recipeHash', 'source', 'output',
    'geometry', 'renderer', 'foreground', 'receiptHash'], 'foreground processing receipt')
  if (r.schema !== 'storyforge.avg.image-processing-receipt' || r.version !== 2 || r.processor !== AVG_IMAGE_PROCESSOR_V2) throw new Error('[avg-process] 前景加工回执版本无效')
  // Reuse only common scalar/geometry parsing. No legacy hash assertion or
  // synthetic legacy producer is created; the actual V2 body is hashed below.
  const base = parseAvgImageProcessingReceiptV1({ schema: r.schema, version: 1, processor: AVG_IMAGE_PROCESSOR_V1,
    recipeHash: r.recipeHash, source: r.source, output: r.output, geometry: r.geometry, renderer: r.renderer, receiptHash: r.receiptHash })
  const foreground = parseAvgForegroundProcessingObservation(r.foreground)
  if (foreground.width !== base.source.width || foreground.height !== base.source.height || !base.output.hasAlpha) throw new Error('[avg-process] 前景来源尺寸或实际输出 alpha 不符')
  return { ...base, version: 2, processor: AVG_IMAGE_PROCESSOR_V2, foreground }
}
export async function assertAvgImageProcessingReceiptV2(recipeInput: AvgImageProcessingRecipeV2, value: unknown) {
  const recipe = parseAvgImageProcessingRecipeV2(recipeInput), receipt = parseAvgImageProcessingReceiptV2(value), { receiptHash, ...body } = receipt
  if (receiptHash !== await hashProductProductionValueV2(body) || receipt.recipeHash !== await hashProductProductionValueV2(recipe)
    || receipt.foreground.policyHash !== await hashProductProductionValueV2(recipe.foreground)
    || receipt.foreground.algorithm !== recipe.foreground.algorithm || receipt.output.width !== recipe.width || receipt.output.height !== recipe.height
    || !same(receipt.geometry, deriveAvgImageProcessingGeometryV1(projectAvgForegroundCanvasRecipeV1(recipe), receipt.source.width, receipt.source.height))) {
    throw new Error('[avg-process] 前景配方、策略、几何或回执 hash 不一致')
  }
  return receipt
}
export async function assertAvgImageProcessingReceipt(recipe: AvgImageProcessingRecipe, value: unknown): Promise<AvgImageProcessingReceipt> {
  return recipe.version === 1 ? assertAvgImageProcessingReceiptV1(recipe, value) : assertAvgImageProcessingReceiptV2(recipe, value)
}
export async function parseAvgProcessedImagePayloadV2(value: unknown): Promise<AvgProcessedImagePayloadV2> {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'requirementKey', 'raw', 'sourceAsset', 'recipe', 'receipt'], 'foreground processed image')
  if (r.schema !== 'storyforge.avg.processed-image' || r.version !== 2) throw new Error('[avg-process] 前景加工工件版本无效')
  const source = parseAvgProcessedImageSourceFieldsV1({ requirementKey: r.requirementKey, raw: r.raw, sourceAsset: r.sourceAsset })
  const recipe = parseAvgImageProcessingRecipeV2(r.recipe), receipt = await assertAvgImageProcessingReceiptV2(recipe, r.receipt)
  assertAvgImageProcessingSourceFieldsV1(source, receipt)
  return { schema: 'storyforge.avg.processed-image', version: 2, ...source, recipe, receipt }
}
export async function parseAvgProcessedImagePayload(value: unknown): Promise<AvgProcessedImagePayload> {
  const body = avgProtocolBody(value), version = body && typeof body === 'object' && 'version' in body ? body.version : null
  if (version === 1) return parseAvgProcessedImagePayloadV1(body)
  if (version === 2) return parseAvgProcessedImagePayloadV2(body)
  throw new Error('[avg-process] 未登记的加工工件版本')
}
export async function assertAvgProcessedImageArtifact(brief:ProductProductionBriefV3,row:AvgProcessedImageArtifactFieldsV1){
  return assertAvgProcessedImageArtifactFromDefinition(readAvgImageDefinitionV3(brief),row)
}
/** Pure codecs and metadata only. The caller separately proves actual frozen
 * Brief/task/raw/producer, Work ownership, physical bytes and author adoption. */
export async function assertAvgProcessedImageArtifactFromDefinition<R extends Omit<AvgVisualProductionRequirementV1, 'references'>>(a: {
  imageProcessing?: AvgImageProcessingPlan; mediaBatch: { requirements: R[] }
}, row: AvgProcessedImageArtifactFieldsV1): Promise<{ payload: AvgProcessedImagePayload; asset: FrozenRuntimeMediaAssetV2; requirement: R }> {
  const payload = await parseAvgProcessedImagePayload(row.payloadJson), plan = a.imageProcessing ? parseAvgImageProcessingPlan(a.imageProcessing) : null
  const entry = plan?.entries.find(e => e.requirementKey === payload.requirementKey), requirement = a.mediaBatch.requirements.find(r => r.requirementKey === payload.requirementKey)
  if (payload.version === 2) {
    if (entry?.recipe.version !== 2 || !requirement) throw new Error('[avg-process] 缺少准确前景配方和冻结需求')
    assertAvgForegroundRequirementBinding(entry.recipe.foreground, requirement)
  }
  const metadata = assertAvgProcessedImageArtifactMetadataV1({ payload, entry, requirement, row, processor: payload.receipt.processor })
  return { payload, ...metadata }
}
