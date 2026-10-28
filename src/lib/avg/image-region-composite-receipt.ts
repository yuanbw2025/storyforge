import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { avgBoolean, avgEnum, avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { AVG_REGION_COMPOSITE_ALGORITHM_V1, assertAvgRegionCompositeRasterV1, deriveAvgRegionCompositeGeometryV1,
  parseAvgImageRegionCompositeRecipeV3, type AvgImageRegionCompositeRecipeV3, type AvgRegionCompositeGeometryV1 } from './image-region-composite-contract'
import { AVG_STRAIGHT_PNG_CODEC_V1 } from './image-straight-png'

export const AVG_IMAGE_PROCESSOR_V3 = 'storyforge.avg.local-region-composite.v3' as const
export interface AvgRegionImagePhysicalV1 {
  contentHash: string; mimeType: 'image/png'; byteSize: number; width: number; height: number
}
/** Portable source hashes only. A pixel receipt never grants Work/Plan/author authority. */
export interface AvgRegionInputProofV1 {
  rawProducerReceiptHash: string; baseReferenceHash: string; baseGeneratedSourceHash: string; inputProofHash: string
}
export interface AvgImageRegionCompositeReceiptV3 {
  schema: 'storyforge.avg.image-processing-receipt'; version: 3; processor: typeof AVG_IMAGE_PROCESSOR_V3
  recipeHash: string; source: AvgRegionImagePhysicalV1
  base: AvgRegionImagePhysicalV1 & { assetKey: string; assetVersion: number }
  inputProof: AvgRegionInputProofV1
  output: AvgRegionImagePhysicalV1 & { pixelHash: string; hasAlpha: boolean }
  geometry: AvgRegionCompositeGeometryV1[]
  preservation: { algorithm: typeof AVG_REGION_COMPOSITE_ALGORITHM_V1; sourcePixelHash: string; basePixelHash: string;
    alphaPlaneHash: string; regionMaskHash: string; protectedRgbaHash: string; regionPixelCount: number; changedPixelCount: number }
  renderer: { userAgent: string; platform: string; codec: typeof AVG_STRAIGHT_PNG_CODEC_V1 }
  receiptHash: string
}
export const sameAvgRegionValueV1 = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
export function parseAvgRegionImagePhysicalV1(value: unknown): AvgRegionImagePhysicalV1 {
  const r = avgRecord(value, ['contentHash', 'mimeType', 'byteSize', 'width', 'height'], 'region physical image')
  const width = avgNumber(r.width, 'region image.width', 1, 32768), height = avgNumber(r.height, 'region image.height', 1, 32768)
  assertAvgRegionCompositeRasterV1(width, height, width * height * 4)
  return { contentHash: avgHash(r.contentHash, 'region image.hash'), mimeType: avgEnum(r.mimeType, ['image/png'], 'region image.mimeType'),
    byteSize: avgNumber(r.byteSize, 'region image.byteSize', 57, 32 * 1024 * 1024), width, height }
}
export function parseAvgRegionInputProofV1(value: unknown): AvgRegionInputProofV1 {
  const r = avgRecord(value, ['rawProducerReceiptHash', 'baseReferenceHash', 'baseGeneratedSourceHash', 'inputProofHash'], 'region input proof')
  return { rawProducerReceiptHash: avgHash(r.rawProducerReceiptHash, 'region.rawProducerReceiptHash'),
    baseReferenceHash: avgHash(r.baseReferenceHash, 'region.baseReferenceHash'), baseGeneratedSourceHash: avgHash(r.baseGeneratedSourceHash, 'region.baseGeneratedSourceHash'),
    inputProofHash: avgHash(r.inputProofHash, 'region.inputProofHash') }
}
function parsePixelRect(value: unknown, label: string) {
  const r = avgRecord(value, ['x', 'y', 'width', 'height'], label)
  return { x: avgNumber(r.x, label, 0, 32768), y: avgNumber(r.y, label, 0, 32768),
    width: avgNumber(r.width, label, 1, 32768), height: avgNumber(r.height, label, 1, 32768) }
}
export function parseAvgImageRegionCompositeReceiptV3(value: unknown): AvgImageRegionCompositeReceiptV3 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'processor', 'recipeHash', 'source', 'base', 'inputProof', 'output', 'geometry', 'preservation', 'renderer', 'receiptHash'], 'region receipt')
  if (r.schema !== 'storyforge.avg.image-processing-receipt' || r.version !== 3 || r.processor !== AVG_IMAGE_PROCESSOR_V3) throw new Error('[avg-composite] 合成回执版本无效')
  const base = avgRecord(r.base, ['contentHash', 'mimeType', 'byteSize', 'width', 'height', 'assetKey', 'assetVersion'], 'region base')
  const { assetKey, assetVersion, ...physicalBase } = base
  const output = avgRecord(r.output, ['contentHash', 'mimeType', 'byteSize', 'width', 'height', 'pixelHash', 'hasAlpha'], 'region output')
  const { pixelHash, hasAlpha, ...physicalOutput } = output
  const p = avgRecord(r.preservation, ['algorithm', 'sourcePixelHash', 'basePixelHash', 'alphaPlaneHash', 'regionMaskHash', 'protectedRgbaHash', 'regionPixelCount', 'changedPixelCount'], 'region preservation')
  const renderer = avgRecord(r.renderer, ['userAgent', 'platform', 'codec'], 'region renderer')
  const source = parseAvgRegionImagePhysicalV1(r.source), parsedBase = parseAvgRegionImagePhysicalV1(physicalBase), parsedOutput = parseAvgRegionImagePhysicalV1(physicalOutput)
  const regionPixelCount = avgNumber(p.regionPixelCount, 'region pixel count', 1, parsedBase.width * parsedBase.height)
  const geometry = avgList(r.geometry, 'region geometry', (value, label) => {
    const g = avgRecord(value, ['source', 'target', 'featherPx'], label)
    return { source: parsePixelRect(g.source, label), target: parsePixelRect(g.target, label), featherPx: avgNumber(g.featherPx, label, 0, 16) }
  }, 4)
  if (!geometry.length) throw new Error('[avg-composite] 合成回执缺少实际几何')
  return { schema: r.schema, version: 3, processor: AVG_IMAGE_PROCESSOR_V3, recipeHash: avgHash(r.recipeHash, 'region recipeHash'), source,
    base: { ...parsedBase, assetKey: avgKey(assetKey, 'region base.assetKey'), assetVersion: avgNumber(assetVersion, 'region base.assetVersion', 1, 1_000_000) },
    inputProof: parseAvgRegionInputProofV1(r.inputProof), output: { ...parsedOutput, pixelHash: avgHash(pixelHash, 'region output.pixelHash'), hasAlpha: avgBoolean(hasAlpha, 'region output.hasAlpha') },
    geometry, preservation: { algorithm: avgEnum(p.algorithm, [AVG_REGION_COMPOSITE_ALGORITHM_V1], 'region algorithm'),
      sourcePixelHash: avgHash(p.sourcePixelHash, 'region sourcePixelHash'), basePixelHash: avgHash(p.basePixelHash, 'region basePixelHash'),
      alphaPlaneHash: avgHash(p.alphaPlaneHash, 'region alphaPlaneHash'), regionMaskHash: avgHash(p.regionMaskHash, 'region maskHash'),
      protectedRgbaHash: avgHash(p.protectedRgbaHash, 'region protectedHash'), regionPixelCount,
      changedPixelCount: avgNumber(p.changedPixelCount, 'region changed count', 1, regionPixelCount) },
    renderer: { userAgent: avgText(renderer.userAgent, 'region renderer.userAgent', 2000, true), platform: avgText(renderer.platform, 'region renderer.platform', 500, true),
      codec: avgEnum(renderer.codec, [AVG_STRAIGHT_PNG_CODEC_V1], 'region renderer.codec') }, receiptHash: avgHash(r.receiptHash, 'region receiptHash') }
}
export async function assertAvgImageRegionCompositeReceiptV3(recipeInput: AvgImageRegionCompositeRecipeV3, value: unknown) {
  const recipe = parseAvgImageRegionCompositeRecipeV3(recipeInput), receipt = parseAvgImageRegionCompositeReceiptV3(value)
  const { receiptHash, ...body } = receipt, geometry = deriveAvgRegionCompositeGeometryV1(recipe, receipt.source.width, receipt.source.height)
  const regionPixels = geometry.reduce((sum, region) => sum + region.target.width * region.target.height, 0)
  if (receipt.recipeHash !== await hashProductProductionValueV2(recipe) || receiptHash !== await hashProductProductionValueV2(body)
    || !sameAvgRegionValueV1(receipt.geometry, geometry) || receipt.preservation.regionPixelCount !== regionPixels
    || !sameAvgRegionValueV1(recipe.baseReference, { assetKey: receipt.base.assetKey, assetVersion: receipt.base.assetVersion, contentHash: receipt.base.contentHash })
    || receipt.base.width !== recipe.width || receipt.base.height !== recipe.height || receipt.output.width !== recipe.width || receipt.output.height !== recipe.height) {
    throw new Error('[avg-composite] 合成回执未绑定准确配方、基准、几何或输出')
  }
  return receipt
}
