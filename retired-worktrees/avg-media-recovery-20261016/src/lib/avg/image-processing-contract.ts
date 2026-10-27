import type { FrozenRuntimeMediaAssetV2, ProductBuildArtifactRecordV1, ProductProductionBriefV3 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { avgBoolean, avgEnum, avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { readAvgImageDefinitionV3 } from './media-production-definition'

export const AVG_IMAGE_PROCESSOR_V1 = 'storyforge.avg.local-canvas.v1' as const
export const AVG_IMAGE_PROCESSING_PIXEL_LIMIT_V1 = 16 * 1024 * 1024
/** Local pixels only. No provider edit, inferred mask, face repair or quality score. */
export interface AvgImageProcessingRecipeV1 {
  schema: 'storyforge.avg.image-processing-recipe'; version: 1
  /** Explicit crop in 1/10000 source coordinates, before fit/anchor. */
  crop: { x: number; y: number; width: number; height: number } | null
  width: number; height: number; fit: 'contain' | 'cover'
  anchor: { x: number; y: number }
  /** null preserves a transparent canvas; an explicit color flattens padding. */
  background: { red: number; green: number; blue: number; alpha: number } | null
  declaration: string
}
export interface AvgImageProcessingPlanV1 {
  schema: 'storyforge.avg.image-processing-plan'; version: 1
  entries: Array<{ requirementKey: string; recipe: AvgImageProcessingRecipeV1 }>
}
export interface AvgImageProcessingGeometryV1 {
  source: { x: number; y: number; width: number; height: number }
  destination: { x: number; y: number; width: number; height: number }
}
export interface AvgImageProcessingReceiptV1 {
  schema: 'storyforge.avg.image-processing-receipt'; version: 1
  processor: typeof AVG_IMAGE_PROCESSOR_V1; recipeHash: string
  source: { contentHash: string; mimeType: string; byteSize: number; width: number; height: number }
  output: { contentHash: string; pixelHash: string; mimeType: 'image/png'; byteSize: number; width: number; height: number; hasAlpha: boolean }
  geometry: AvgImageProcessingGeometryV1
  renderer: { userAgent: string; platform: string }
  receiptHash: string
}
export interface AvgProcessedImagePayloadV1 {
  schema: 'storyforge.avg.processed-image'; version: 1; requirementKey: string
  raw: { artifactKey: string; version: number; contentHash: string; producerReceiptHash: string }
  sourceAsset: FrozenRuntimeMediaAssetV2
  recipe: AvgImageProcessingRecipeV1; receipt: AvgImageProcessingReceiptV1
}
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
const rect = (value: unknown, label: string, maximum: number, zeroSize = false) => {
  const r = avgRecord(value, ['x', 'y', 'width', 'height'], label)
  return { x: avgNumber(r.x, `${label}.x`, 0, maximum), y: avgNumber(r.y, `${label}.y`, 0, maximum),
    width: avgNumber(r.width, `${label}.width`, zeroSize ? 0 : 1, maximum), height: avgNumber(r.height, `${label}.height`, zeroSize ? 0 : 1, maximum) }
}
export function parseAvgImageProcessingRecipeV1(value: unknown): AvgImageProcessingRecipeV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'crop', 'width', 'height', 'fit', 'anchor', 'background', 'declaration'], 'image processing recipe')
  if (r.schema !== 'storyforge.avg.image-processing-recipe' || r.version !== 1) throw new Error('[avg-process] 未登记的加工配方')
  const crop = r.crop === null ? null : rect(r.crop, 'crop', 10000)
  if (crop && (crop.x + crop.width > 10000 || crop.y + crop.height > 10000)) throw new Error('[avg-process] 裁切超出原图范围')
  const anchor = avgRecord(r.anchor, ['x', 'y'], 'anchor')
  const background = r.background === null ? null : avgRecord(r.background, ['red', 'green', 'blue', 'alpha'], 'background')
  const width = avgNumber(r.width, 'output.width', 32, 4096), height = avgNumber(r.height, 'output.height', 32, 4096)
  if (width * height > AVG_IMAGE_PROCESSING_PIXEL_LIMIT_V1) throw new Error('[avg-process] 加工画布超过像素上限')
  return { schema: r.schema, version: 1, crop, width, height, fit: avgEnum(r.fit, ['contain', 'cover'] as const, 'fit'),
    anchor: { x: avgNumber(anchor.x, 'anchor.x', 0, 10000), y: avgNumber(anchor.y, 'anchor.y', 0, 10000) },
    background: background === null ? null : { red: avgNumber(background.red, 'background.red', 0, 255), green: avgNumber(background.green, 'background.green', 0, 255),
      blue: avgNumber(background.blue, 'background.blue', 0, 255), alpha: avgNumber(background.alpha, 'background.alpha', 0, 255) },
    declaration: avgText(r.declaration, 'processing.declaration', 2000) }
}
export function parseAvgImageProcessingPlanV1(value: unknown): AvgImageProcessingPlanV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'entries'], 'image processing plan')
  if (r.schema !== 'storyforge.avg.image-processing-plan' || r.version !== 1) throw new Error('[avg-process] 未登记的加工方案')
  const entries = avgUnique(avgList(r.entries, 'processing.entries', value => {
    const e = avgRecord(value, ['requirementKey', 'recipe'], 'processing entry')
    return { requirementKey: avgKey(e.requirementKey, 'processing.requirementKey'), recipe: parseAvgImageProcessingRecipeV1(e.recipe) }
  }, 8), e => e.requirementKey, 'processing entries')
  if (!entries.length) throw new Error('[avg-process] 加工方案不能是空数组；不加工时省略整个字段')
  return { schema: r.schema, version: 1, entries }
}
/** Integer, bounded source and destination rectangles. cover crops the source
 * instead of allocating or drawing an unbounded off-canvas intermediate. */
export function deriveAvgImageProcessingGeometryV1(recipeInput: AvgImageProcessingRecipeV1, width: number, height: number): AvgImageProcessingGeometryV1 {
  const r = parseAvgImageProcessingRecipeV1(recipeInput)
  avgNumber(width, 'source.width', 1, 32768); avgNumber(height, 'source.height', 1, 32768)
  if (width * height > AVG_IMAGE_PROCESSING_PIXEL_LIMIT_V1) throw new Error('[avg-process] 原图超过有界解码像素上限')
  const c = r.crop ?? { x: 0, y: 0, width: 10000, height: 10000 }
  const x = Math.floor(c.x * width / 10000), y = Math.floor(c.y * height / 10000)
  const source = { x, y, width: Math.ceil((c.x + c.width) * width / 10000) - x, height: Math.ceil((c.y + c.height) * height / 10000) - y }
  const destination = { x: 0, y: 0, width: r.width, height: r.height }
  const scale = Math.min(r.width / source.width, r.height / source.height)
  if (r.fit === 'contain') {
    destination.width = Math.max(1, Math.min(r.width, Math.round(source.width * scale)))
    destination.height = Math.max(1, Math.min(r.height, Math.round(source.height * scale)))
    destination.x = Math.round((r.width - destination.width) * r.anchor.x / 10000)
    destination.y = Math.round((r.height - destination.height) * r.anchor.y / 10000)
  } else if (source.width / source.height > r.width / r.height) {
    const size = Math.max(1, Math.min(source.width, Math.round(source.height * r.width / r.height)))
    source.x += Math.round((source.width - size) * r.anchor.x / 10000); source.width = size
  } else {
    const size = Math.max(1, Math.min(source.height, Math.round(source.width * r.height / r.width)))
    source.y += Math.round((source.height - size) * r.anchor.y / 10000); source.height = size
  }
  return { source, destination }
}
export function avgProcessedImageArtifactKeyV1(requirementKey: string) { return `avg.media.processed.${avgKey(requirementKey, 'requirementKey')}` }
export function parseAvgImageProcessingReceiptV1(value: unknown): AvgImageProcessingReceiptV1 {
  const r = avgRecord(value, ['schema', 'version', 'processor', 'recipeHash', 'source', 'output', 'geometry', 'renderer', 'receiptHash'], 'processing receipt')
  if (r.schema !== 'storyforge.avg.image-processing-receipt' || r.version !== 1 || r.processor !== AVG_IMAGE_PROCESSOR_V1) throw new Error('[avg-process] 加工回执版本无效')
  const source = avgRecord(r.source, ['contentHash', 'mimeType', 'byteSize', 'width', 'height'], 'processing source')
  const output = avgRecord(r.output, ['contentHash', 'pixelHash', 'mimeType', 'byteSize', 'width', 'height', 'hasAlpha'], 'processing output')
  if (output.mimeType !== 'image/png') throw new Error('[avg-process] 当前加工只输出 PNG')
  const geometry = avgRecord(r.geometry, ['source', 'destination'], 'processing geometry'), renderer = avgRecord(r.renderer, ['userAgent', 'platform'], 'processing renderer')
  const parsed: AvgImageProcessingReceiptV1 = { schema: r.schema, version: 1, processor: AVG_IMAGE_PROCESSOR_V1, recipeHash: avgHash(r.recipeHash, 'recipeHash'),
    source: { contentHash: avgHash(source.contentHash, 'source.contentHash'), mimeType: avgEnum(source.mimeType, ['image/png', 'image/jpeg', 'image/webp'] as const, 'source.mimeType'),
      byteSize: avgNumber(source.byteSize, 'source.byteSize', 1, 32 * 1024 * 1024), width: avgNumber(source.width, 'source.width', 1, 32768), height: avgNumber(source.height, 'source.height', 1, 32768) },
    output: { contentHash: avgHash(output.contentHash, 'output.contentHash'), pixelHash: avgHash(output.pixelHash, 'output.pixelHash'), mimeType: 'image/png',
      byteSize: avgNumber(output.byteSize, 'output.byteSize', 1, 32 * 1024 * 1024), width: avgNumber(output.width, 'output.width', 32, 4096), height: avgNumber(output.height, 'output.height', 32, 4096), hasAlpha: avgBoolean(output.hasAlpha, 'output.hasAlpha') },
    geometry: { source: rect(geometry.source, 'geometry.source', 32768), destination: rect(geometry.destination, 'geometry.destination', 4096) },
    renderer: { userAgent: avgText(renderer.userAgent, 'renderer.userAgent', 1000), platform: avgText(renderer.platform, 'renderer.platform', 200, true) }, receiptHash: avgHash(r.receiptHash, 'receiptHash') }
  if (parsed.source.width * parsed.source.height > AVG_IMAGE_PROCESSING_PIXEL_LIMIT_V1 || parsed.output.width * parsed.output.height > AVG_IMAGE_PROCESSING_PIXEL_LIMIT_V1) throw new Error('[avg-process] 加工回执超过像素上限')
  return parsed
}
export async function assertAvgImageProcessingReceiptV1(recipeInput: AvgImageProcessingRecipeV1, value: unknown) {
  const recipe = parseAvgImageProcessingRecipeV1(recipeInput), receipt = parseAvgImageProcessingReceiptV1(value), { receiptHash, ...body } = receipt
  if (receiptHash !== await hashProductProductionValueV2(body) || receipt.recipeHash !== await hashProductProductionValueV2(recipe)
    || receipt.output.width !== recipe.width || receipt.output.height !== recipe.height
    || !same(receipt.geometry, deriveAvgImageProcessingGeometryV1(recipe, receipt.source.width, receipt.source.height))) throw new Error('[avg-process] 加工配方、几何或回执 hash 不一致')
  return receipt
}
export async function parseAvgProcessedImagePayloadV1(value: unknown): Promise<AvgProcessedImagePayloadV1> {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'requirementKey', 'raw', 'sourceAsset', 'recipe', 'receipt'], 'processed image')
  if (r.schema !== 'storyforge.avg.processed-image' || r.version !== 1) throw new Error('[avg-process] 加工图工件版本无效')
  const requirementKey = avgKey(r.requirementKey, 'requirementKey'), raw = avgRecord(r.raw, ['artifactKey', 'version', 'contentHash', 'producerReceiptHash'], 'processing raw')
  if (raw.artifactKey !== `avg.media.raw.${requirementKey}`) throw new Error('[avg-process] 加工来源与准确原图不一致')
  const sourceAsset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [r.sourceAsset] }).assets[0]!
  const recipe = parseAvgImageProcessingRecipeV1(r.recipe), receipt = await assertAvgImageProcessingReceiptV1(recipe, r.receipt)
  if (sourceAsset.contentHash !== raw.contentHash || !same(receipt.source, { contentHash: sourceAsset.contentHash, mimeType: sourceAsset.mimeType,
    byteSize: sourceAsset.byteSize, width: sourceAsset.width, height: sourceAsset.height })) throw new Error('[avg-process] 加工来源字节、尺寸或元数据不一致')
  return { schema: r.schema, version: 1, requirementKey, raw: { artifactKey: raw.artifactKey, version: avgNumber(raw.version, 'raw.version', 1, 1e9),
    contentHash: avgHash(raw.contentHash, 'raw.contentHash'), producerReceiptHash: avgHash(raw.producerReceiptHash, 'raw.producerReceiptHash') }, sourceAsset, recipe, receipt }
}
/** Producer authority and physical bytes are verified by the caller. */
export async function assertAvgProcessedImageArtifactV1(brief: ProductProductionBriefV3, row: Pick<ProductBuildArtifactRecordV1,
  'artifactKey'|'kind'|'mediaKind'|'payloadJson'|'metadataJson'|'rightsJson'|'contentHash'|'mimeType'|'byteSize'|'blobObjectId'>) {
  const payload = await parseAvgProcessedImagePayloadV1(row.payloadJson), a = readAvgImageDefinitionV3(brief)
  const entry = a.imageProcessing?.entries.find(e => e.requirementKey === payload.requirementKey)
  const requirement = a.mediaBatch.requirements.find(r => r.requirementKey === payload.requirementKey)
  if (!entry || !requirement || !same(entry.recipe, payload.recipe) || payload.sourceAsset.assetKey !== requirement.assetKey || payload.sourceAsset.kind !== requirement.mediaKind
    || row.artifactKey !== avgProcessedImageArtifactKeyV1(payload.requirementKey) || row.kind !== 'image' || row.mediaKind !== requirement.mediaKind) throw new Error('[avg-process] 加工图不属于冻结需求和配方')
  const asset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [JSON.parse(row.metadataJson)] }).assets[0]!
  const output = payload.receipt.output
  const expected = { ...payload.sourceAsset, version: payload.sourceAsset.version + 1, contentHash: output.contentHash, blobContentHash: output.contentHash,
    byteSize: output.byteSize, mimeType: output.mimeType, width: output.width, height: output.height, source: AVG_IMAGE_PROCESSOR_V1 }
  if (!same(asset, expected) || row.contentHash !== output.contentHash || row.mimeType !== output.mimeType || row.byteSize !== output.byteSize
    || !row.blobObjectId || !same(JSON.parse(row.rightsJson), { origin: 'local-processing', sourceContentHash: payload.raw.contentHash,
      sourceLicense: payload.sourceAsset.license, declaration: entry.recipe.declaration })) throw new Error('[avg-process] 加工输出元数据或权利记录不一致')
  return { payload, asset, requirement }
}
