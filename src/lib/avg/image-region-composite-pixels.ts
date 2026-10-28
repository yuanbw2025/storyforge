import { hashProductProductionValueV2 } from '../product-production/hash'
import { parseAvgImageRegionCompositeRecipeV3, deriveAvgRegionCompositeGeometryV1, type AvgImageRegionCompositeRecipeV3 } from './image-region-composite-contract'
import { composeAvgCharacterRegionsV1, type AvgCompositeRasterV1 } from './image-region-composite-kernel'
import { decodeAvgStraightPngV1, encodeAvgStraightPngV1, AVG_STRAIGHT_PNG_CODEC_V1 } from './image-straight-png'
import { AVG_IMAGE_PROCESSOR_V3, assertAvgImageRegionCompositeReceiptV3, parseAvgRegionImagePhysicalV1, parseAvgRegionInputProofV1, sameAvgRegionValueV1,
  type AvgImageRegionCompositeReceiptV3, type AvgRegionImagePhysicalV1, type AvgRegionInputProofV1 } from './image-region-composite-receipt'

export interface AvgRegionCompositeByteInputV1 {
  recipe: AvgImageRegionCompositeRecipeV3
  source: AvgRegionImagePhysicalV1; sourceData: ArrayBuffer
  base: AvgRegionImagePhysicalV1 & { assetKey: string; assetVersion: number }; baseData: ArrayBuffer
  inputProof: AvgRegionInputProofV1
}
function abortIfNeeded(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('AVG region bytes aborted', 'AbortError') }
export async function hashAvgRegionBytesV1(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function parseAvgRegionCompositeByteMetadataV1(input: Omit<AvgRegionCompositeByteInputV1, 'sourceData' | 'baseData'>) {
  const recipe = parseAvgImageRegionCompositeRecipeV3(input.recipe), source = parseAvgRegionImagePhysicalV1(input.source)
  const { assetKey, assetVersion, ...physicalBase } = input.base, base = { ...parseAvgRegionImagePhysicalV1(physicalBase), assetKey, assetVersion }
  const inputProof = parseAvgRegionInputProofV1(input.inputProof)
  if (!sameAvgRegionValueV1(recipe.baseReference, { assetKey, assetVersion, contentHash: base.contentHash })
    || base.width !== recipe.width || base.height !== recipe.height) throw new Error('[avg-composite] 两输入元数据不属于准确底图与画布')
  deriveAvgRegionCompositeGeometryV1(recipe, source.width, source.height)
  return { recipe, source, base, inputProof }
}
async function decodeExact(data: ArrayBuffer, metadata: AvgRegionImagePhysicalV1, signal?: AbortSignal) {
  abortIfNeeded(signal)
  if (!(data instanceof ArrayBuffer) || data.byteLength !== metadata.byteSize || data.byteLength > 32 * 1024 * 1024) throw new Error('[avg-composite] 输入 PNG 字节长度不符')
  const owned = data.slice(0)
  if (await hashAvgRegionBytesV1(owned) !== metadata.contentHash) throw new Error('[avg-composite] 输入 PNG hash 不符')
  const raster = await decodeAvgStraightPngV1(owned, signal)
  if (raster.width !== metadata.width || raster.height !== metadata.height) throw new Error('[avg-composite] 输入 PNG 实际尺寸不符')
  abortIfNeeded(signal)
  return raster
}
async function readInputs(input: AvgRegionCompositeByteInputV1, signal?: AbortSignal) {
  abortIfNeeded(signal)
  const metadata = parseAvgRegionCompositeByteMetadataV1(input)
  const source = await decodeExact(input.sourceData, metadata.source, signal), base = await decodeExact(input.baseData, metadata.base, signal)
  return { ...metadata, sourceRaster: source, baseRaster: base }
}
async function inspectOutput(input: { recipe: AvgImageRegionCompositeRecipeV3; base: AvgCompositeRasterV1; source: AvgCompositeRasterV1; data: ArrayBuffer; signal?: AbortSignal }) {
  const { base, source, recipe, signal } = input, output = await decodeAvgStraightPngV1(input.data, signal)
  if (output.width !== base.width || output.height !== base.height) throw new Error('[avg-composite] 成品尺寸变化')
  const geometry = deriveAvgRegionCompositeGeometryV1(recipe, source.width, source.height), total = base.width * base.height
  const regionPixels = geometry.reduce((sum, g) => sum + g.target.width * g.target.height, 0)
  const mask = new Uint8Array(Math.ceil(total / 8)), alpha = new Uint8Array(total), protectedBytes = new Uint8Array((total - regionPixels) * 4)
  for (const { target: r } of geometry) for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    const pixel = y * base.width + x; mask[pixel >> 3] |= 1 << (pixel & 7)
  }
  let offset = 0, changedPixelCount = 0, hasAlpha = false
  for (let pixel = 0; pixel < total; pixel++) {
    if (pixel % 65536 === 0) abortIfNeeded(signal)
    const i = pixel * 4, inside = Boolean(mask[pixel >> 3] & (1 << (pixel & 7)))
    alpha[pixel] = output.rgba[i + 3]; if (alpha[pixel] !== 255) hasAlpha = true
    if (alpha[pixel] !== base.rgba[i + 3]) throw new Error('[avg-composite] 编码成品改变了底图 alpha')
    let changed = false
    for (let c = 0; c < 4; c++) if (output.rgba[i + c] !== base.rgba[i + c]) changed = true
    if (!inside) {
      if (changed) throw new Error('[avg-composite] 编码成品改写了保护区域')
      protectedBytes.set(output.rgba.subarray(i, i + 4), offset); offset += 4
    } else if (changed) changedPixelCount++
  }
  if (!changedPixelCount) throw new Error('[avg-composite] 编码后没有实际局部变化')
  const hashes = await Promise.all([hashAvgRegionBytesV1(source.rgba.buffer as ArrayBuffer), hashAvgRegionBytesV1(base.rgba.buffer as ArrayBuffer),
    hashAvgRegionBytesV1(alpha.buffer), hashAvgRegionBytesV1(mask.buffer), hashAvgRegionBytesV1(protectedBytes.buffer),
    hashAvgRegionBytesV1(output.rgba.buffer), hashAvgRegionBytesV1(input.data)])
  abortIfNeeded(signal)
  return { output, geometry, preservation: { algorithm: recipe.algorithm, sourcePixelHash: hashes[0], basePixelHash: hashes[1],
    alphaPlaneHash: hashes[2], regionMaskHash: hashes[3], protectedRgbaHash: hashes[4], regionPixelCount: regionPixels, changedPixelCount },
    physicalOutput: { contentHash: hashes[6], mimeType: 'image/png' as const, byteSize: input.data.byteLength, width: output.width, height: output.height, pixelHash: hashes[5], hasAlpha } }
}
/** Compute plus encoded-output proof only. The Work reader and durable owner
 * separately prove input authority, actual Plan, cancellation and admission. */
export async function processAvgRegionCompositeBytesV1(input: AvgRegionCompositeByteInputV1 & { renderer: { userAgent: string; platform: string }; signal?: AbortSignal }) {
  const read = await readInputs(input, input.signal), pixels = composeAvgCharacterRegionsV1({ recipe: read.recipe, base: read.baseRaster, source: read.sourceRaster, signal: input.signal })
  const data = await encodeAvgStraightPngV1({ ...pixels, signal: input.signal })
  const measured = await inspectOutput({ recipe: read.recipe, base: read.baseRaster, source: read.sourceRaster, data, signal: input.signal })
  const body: Omit<AvgImageRegionCompositeReceiptV3, 'receiptHash'> = { schema: 'storyforge.avg.image-processing-receipt', version: 3, processor: AVG_IMAGE_PROCESSOR_V3,
    recipeHash: await hashProductProductionValueV2(read.recipe), source: read.source, base: read.base, inputProof: read.inputProof,
    output: measured.physicalOutput, geometry: measured.geometry, preservation: measured.preservation,
    renderer: { ...input.renderer, codec: AVG_STRAIGHT_PNG_CODEC_V1 } }
  const receipt = await assertAvgImageRegionCompositeReceiptV3(read.recipe, { ...body, receiptHash: await hashProductProductionValueV2(body) })
  abortIfNeeded(input.signal)
  return { data, receipt }
}
/** Recompute the declared algorithm independently of the returned pixels,
 * then inspect the exact PNG and all source/receipt hashes before admission. */
export async function verifyAvgRegionCompositeBytesV1(input: AvgRegionCompositeByteInputV1 & { data: ArrayBuffer; receipt: unknown; signal?: AbortSignal }) {
  const read = await readInputs(input, input.signal), receipt = await assertAvgImageRegionCompositeReceiptV3(read.recipe, input.receipt)
  if (!sameAvgRegionValueV1(receipt.source, read.source) || !sameAvgRegionValueV1(receipt.base, read.base)
    || !sameAvgRegionValueV1(receipt.inputProof, read.inputProof)) throw new Error('[avg-composite] 成品回执替换了来源或原始证明')
  const data = input.data.slice(0), measured = await inspectOutput({ recipe: read.recipe, base: read.baseRaster, source: read.sourceRaster, data, signal: input.signal })
  const expected = composeAvgCharacterRegionsV1({ recipe: read.recipe, base: read.baseRaster, source: read.sourceRaster, signal: input.signal })
  if (!sameAvgRegionValueV1(measured.preservation, receipt.preservation) || !sameAvgRegionValueV1(measured.physicalOutput, receipt.output)
    || expected.rgba.some((value, index) => measured.output.rgba[index] !== value)) throw new Error('[avg-composite] 成品未满足准确算法、保护像素或真实回执')
  abortIfNeeded(input.signal)
  return receipt
}
