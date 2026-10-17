import { detectProductImageDimensionsV1 } from '../product-production/media-adapters'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { sha256MediaData } from '../product-production/media-blob-store'
import { assertAvgMediaBytesV1 } from './media-import-contract'
import { inspectAvgImageBytesV1 } from './image-decoder'
import { AVG_IMAGE_PROCESSOR_V1, assertAvgImageProcessingReceiptV1, deriveAvgImageProcessingGeometryV1,
  parseAvgImageProcessingRecipeV1, type AvgImageProcessingRecipeV1, type AvgImageProcessingReceiptV1 } from './image-processing-contract'

const aborted = () => new DOMException('AVG image processing aborted', 'AbortError')
/** One bounded native operation. Timeout/abort disposes late results too. */
async function bounded<T>(start: () => Promise<T>, signal?: AbortSignal, dispose?: (value: T) => void): Promise<T> {
  if (signal?.aborted) throw aborted()
  return new Promise<T>((resolve, reject) => {
    let done = false
    const finish = (error: unknown, value?: T) => {
      if (done) { if (value !== undefined) dispose?.(value); return }
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort)
      if (error) reject(error); else resolve(value!)
    }
    const onAbort = () => finish(aborted())
    const timer = setTimeout(() => finish(new Error('[avg-process] 本地图像处理超时，未调用供应商')), 20_000)
    signal?.addEventListener('abort', onAbort, { once: true })
    try { void start().then(value => finish(null, value), error => finish(error)) } catch (error) { finish(error) }
  })
}

/** DB-free pixel transform. The durable task owns scope, frozen source, Blob,
 * candidate/receipt and author adoption. Calling this helper grants none of
 * those authorities; PNG bytes/renderer observation are evidence, not art QA. */
export async function processAvgImageBytesV1(input: {
  data: ArrayBuffer; source: { contentHash: string; mimeType: string; width: number; height: number }
  recipe: AvgImageProcessingRecipeV1; signal?: AbortSignal
}): Promise<{ data: ArrayBuffer; receipt: AvgImageProcessingReceiptV1 }> {
  const recipe = parseAvgImageProcessingRecipeV1(input.recipe), source = { ...input.source }
  if (!input.data.byteLength || input.data.byteLength > 32 * 1024 * 1024) throw new Error('[avg-process] 加工原图需为 1 字节～32 MiB')
  const data=input.data.slice(0)
  if (input.signal?.aborted) throw aborted()
  assertAvgMediaBytesV1(data, source.mimeType)
  if (await sha256MediaData(data) !== source.contentHash) throw new Error('[avg-process] 加工原图 hash 不一致')
  const dimensions = detectProductImageDimensionsV1(data)
  if (!dimensions || dimensions.width !== source.width || dimensions.height !== source.height) throw new Error('[avg-process] 加工原图尺寸与准确来源不符')
  const geometry = deriveAvgImageProcessingGeometryV1(recipe, source.width, source.height)
  const bitmap = await bounded(() => createImageBitmap(new Blob([data], { type: source.mimeType }), { imageOrientation: 'none', premultiplyAlpha: 'default', colorSpaceConversion: 'default' }), input.signal, image => image.close())
  const canvas = document.createElement('canvas'); canvas.width = recipe.width; canvas.height = recipe.height
  let output: ArrayBuffer, pixelHash: string
  try {
    if (input.signal?.aborted) throw aborted()
    if (bitmap.width !== source.width || bitmap.height !== source.height) throw new Error('[avg-process] 原图实际解码尺寸不符；不隐式旋转或更换来源')
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true, colorSpace: 'srgb' })
    if (!context) throw new Error('[avg-process] 当前浏览器不支持本地画布处理')
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    const b = recipe.background
    if (b) { context.fillStyle = `rgba(${b.red},${b.green},${b.blue},${b.alpha / 255})`; context.fillRect(0, 0, recipe.width, recipe.height) }
    const s = geometry.source, d = geometry.destination
    context.drawImage(bitmap, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height)
    const pixels = context.getImageData(0, 0, recipe.width, recipe.height)
    pixelHash = await sha256MediaData(new Uint8Array(pixels.data).buffer)
    const blob = await bounded(() => new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('[avg-process] PNG 编码失败')), 'image/png')), input.signal)
    if (blob.type !== 'image/png' || blob.size > 32 * 1024 * 1024) throw new Error('[avg-process] 加工结果格式或字节超限')
    output = await bounded(() => blob.arrayBuffer(), input.signal)
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0 }
  if (input.signal?.aborted) throw aborted()
  const contentHash = await sha256MediaData(output)
  const measured = await inspectAvgImageBytesV1({ data: output, assetKey: 'avg.local-processing.output', contentHash,
    mimeType: 'image/png', width: recipe.width, height: recipe.height })
  if (input.signal?.aborted) throw aborted()
  const body: Omit<AvgImageProcessingReceiptV1, 'receiptHash'> = { schema: 'storyforge.avg.image-processing-receipt', version: 1,
    processor: AVG_IMAGE_PROCESSOR_V1, recipeHash: await hashProductProductionValueV2(recipe), source: { ...source, byteSize: data.byteLength },
    output: { contentHash, pixelHash, mimeType: 'image/png', byteSize: output.byteLength, width: measured.width, height: measured.height, hasAlpha: measured.hasAlpha }, geometry,
    renderer: { userAgent: navigator.userAgent, platform: navigator.platform } }
  const receipt = await assertAvgImageProcessingReceiptV1(recipe, { ...body, receiptHash: await hashProductProductionValueV2(body) })
  return { data: output, receipt }
}
