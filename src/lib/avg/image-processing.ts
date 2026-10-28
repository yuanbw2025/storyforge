import { detectProductImageDimensionsV1 } from '../product-production/media-adapters'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { sha256MediaData } from '../product-production/media-blob-store'
import { assertAvgMediaBytesV1 } from './media-import-contract'
import { inspectAvgImageBytesV1 } from './image-decoder'
import { AVG_IMAGE_PROCESSOR_V1, assertAvgImageProcessingReceiptV1, deriveAvgImageProcessingGeometryV1,
  parseAvgImageProcessingRecipeV1, parseAvgImageProcessingRecipeV2, type AvgImageProcessingRecipeV1,
  type AvgImageProcessingRecipeV2, type AvgImageProcessingRecipe, type AvgImageProcessingReceiptV1 } from './image-processing-contract'
import { AVG_IMAGE_PROCESSOR_V2, assertAvgImageProcessingReceiptV2, projectAvgForegroundCanvasRecipeV1,
  type AvgImageProcessingReceiptV2 } from './image-processing-contract-v2'
import { assertAvgForegroundRequirementBinding, parseAvgForegroundPolicy, type AvgForegroundPolicy } from './image-foreground-contract'
import { assertAvgForegroundRasterV1 } from './image-foreground-worker-protocol'
import { runAvgForegroundWorker } from './image-foreground-worker-client'
import { runAvgForegroundSam2V4, type AvgForegroundSam2ProcessingObservationV4 } from './image-foreground-sam2-v4'
import { assertAvgSam2OpaqueSourceV5, runAvgForegroundSam2V5, type AvgForegroundSam2ProcessingObservationV5 } from './image-foreground-sam2-v5'
import { runAvgForegroundSam2V6, type AvgForegroundSam2ProcessingObservationV6 } from './image-foreground-sam2-v6'
export { runAvgForegroundWorkerV1, runAvgForegroundWorker } from './image-foreground-worker-client'

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

interface AvgImageByteInput {
  data: ArrayBuffer; source: { contentHash: string; mimeType: string; width: number; height: number }
  signal?: AbortSignal
}
/** Shared physical canvas kernel. Foreground runs at original dimensions
 * before fit/crop, so transparent padding cannot become a cutout observation. */
async function processAvgImagePixels(input: AvgImageByteInput & { recipe: AvgImageProcessingRecipeV1; foreground?: AvgForegroundPolicy }) {
  const recipe = parseAvgImageProcessingRecipeV1(input.recipe), source = { ...input.source }
  const signal = input.signal, foreground = input.foreground ? parseAvgForegroundPolicy(input.foreground) : null
  if (!input.data.byteLength || input.data.byteLength > 32 * 1024 * 1024) throw new Error('[avg-process] 加工原图需为 1 字节～32 MiB')
  const data=input.data.slice(0)
  if (signal?.aborted) throw aborted()
  assertAvgMediaBytesV1(data, source.mimeType)
  if (await sha256MediaData(data) !== source.contentHash) throw new Error('[avg-process] 加工原图 hash 不一致')
  const dimensions = detectProductImageDimensionsV1(data)
  if (!dimensions || dimensions.width !== source.width || dimensions.height !== source.height) throw new Error('[avg-process] 加工原图尺寸与准确来源不符')
  const geometry = deriveAvgImageProcessingGeometryV1(recipe, source.width, source.height)
  if (foreground) assertAvgForegroundRasterV1(source.width, source.height, source.width * source.height * 4)
  const bitmap = await bounded(() => createImageBitmap(new Blob([data], { type: source.mimeType }), { imageOrientation: 'none', premultiplyAlpha: 'default', colorSpaceConversion: 'default' }), signal, image => image.close())
  const canvas = document.createElement('canvas'); canvas.width = recipe.width; canvas.height = recipe.height
  let foregroundCanvas: HTMLCanvasElement | null = null, foregroundObservation: Awaited<ReturnType<typeof runAvgForegroundWorker>>['observation'] | AvgForegroundSam2ProcessingObservationV4 | AvgForegroundSam2ProcessingObservationV5 | AvgForegroundSam2ProcessingObservationV6 | null = null
  let output: ArrayBuffer, pixelHash: string
  try {
    if (signal?.aborted) throw aborted()
    if (bitmap.width !== source.width || bitmap.height !== source.height) throw new Error('[avg-process] 原图实际解码尺寸不符；不隐式旋转或更换来源')
    let drawable: CanvasImageSource = bitmap
    if (foreground) {
      foregroundCanvas = document.createElement('canvas'); foregroundCanvas.width = source.width; foregroundCanvas.height = source.height
      const rawContext = foregroundCanvas.getContext('2d', { alpha: true, willReadFrequently: true, colorSpace: 'srgb' })
      if (!rawContext) throw new Error('[avg-process] 当前浏览器不支持原图像素读取')
      rawContext.drawImage(bitmap, 0, 0)
      const rawPixels = rawContext.getImageData(0, 0, source.width, source.height)
      if (foreground.version === 5 || foreground.version === 6) assertAvgSam2OpaqueSourceV5(rawPixels.data)
      const cutout = foreground.version === 4
        ? await runAvgForegroundSam2V4({ data, source, policy: foreground, signal })
        : foreground.version === 5 ? await runAvgForegroundSam2V5({ data, source, policy: foreground, signal })
          : foreground.version === 6 ? await runAvgForegroundSam2V6({ data, source, policy: foreground, rgba: rawPixels.data, signal })
            : await runAvgForegroundWorker({ width: source.width, height: source.height, rgba: rawPixels.data, policy: foreground, signal })
      if (signal?.aborted) throw aborted()
      foregroundObservation = cutout.observation
      rawContext.putImageData(new ImageData(new Uint8ClampedArray(cutout.rgba), source.width, source.height), 0, 0)
      drawable = foregroundCanvas
    }
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true, colorSpace: 'srgb' })
    if (!context) throw new Error('[avg-process] 当前浏览器不支持本地画布处理')
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    const b = recipe.background
    if (b) { context.fillStyle = `rgba(${b.red},${b.green},${b.blue},${b.alpha / 255})`; context.fillRect(0, 0, recipe.width, recipe.height) }
    const s = geometry.source, d = geometry.destination
    context.drawImage(drawable, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height)
    const pixels = context.getImageData(0, 0, recipe.width, recipe.height)
    pixelHash = await sha256MediaData(new Uint8Array(pixels.data).buffer)
    const blob = await bounded(() => new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('[avg-process] PNG 编码失败')), 'image/png')), signal)
    if (blob.type !== 'image/png' || blob.size > 32 * 1024 * 1024) throw new Error('[avg-process] 加工结果格式或字节超限')
    output = await bounded(() => blob.arrayBuffer(), signal)
  } finally {
    bitmap.close(); canvas.width = 0; canvas.height = 0
    if (foregroundCanvas) { foregroundCanvas.width = 0; foregroundCanvas.height = 0 }
  }
  if (signal?.aborted) throw aborted()
  const contentHash = await sha256MediaData(output)
  const measured = await inspectAvgImageBytesV1({ data: output, assetKey: 'avg.local-processing.output', contentHash,
    mimeType: 'image/png', width: recipe.width, height: recipe.height })
  if (signal?.aborted) throw aborted()
  return { data: output, recipe, source: { ...source, byteSize: data.byteLength },
    output: { contentHash, pixelHash, mimeType: 'image/png' as const, byteSize: output.byteLength, width: measured.width, height: measured.height, hasAlpha: measured.hasAlpha },
    geometry, renderer: { userAgent: navigator.userAgent, platform: navigator.platform }, foregroundObservation }
}

/** Pixel/receipt helper only. The durable task retains producer, scope, Blob
 * and adoption authority. V1 never receives the private foreground option. */
export async function processAvgImageBytesV1(input: AvgImageByteInput & { recipe: AvgImageProcessingRecipeV1 }): Promise<{ data: ArrayBuffer; receipt: AvgImageProcessingReceiptV1 }> {
  const result = await processAvgImagePixels({ data: input.data, source: input.source, recipe: input.recipe, signal: input.signal })
  const body: Omit<AvgImageProcessingReceiptV1, 'receiptHash'> = { schema: 'storyforge.avg.image-processing-receipt', version: 1,
    processor: AVG_IMAGE_PROCESSOR_V1, recipeHash: await hashProductProductionValueV2(result.recipe), source: result.source,
    output: result.output, geometry: result.geometry, renderer: result.renderer }
  const receipt = await assertAvgImageProcessingReceiptV1(result.recipe, { ...body, receiptHash: await hashProductProductionValueV2(body) })
  return { data: result.data, receipt }
}
export async function processAvgImageBytesV2(input: AvgImageByteInput & { recipe: AvgImageProcessingRecipeV2;
  frozenRequirement: Parameters<typeof assertAvgForegroundRequirementBinding>[1]
}): Promise<{ data: ArrayBuffer; receipt: AvgImageProcessingReceiptV2 }> {
  const signal = input.signal
  if (signal?.aborted) throw aborted()
  const recipe = parseAvgImageProcessingRecipeV2(input.recipe)
  assertAvgForegroundRequirementBinding(recipe.foreground, input.frozenRequirement)
  const result = await processAvgImagePixels({ data: input.data, source: input.source,
    recipe: projectAvgForegroundCanvasRecipeV1(recipe), foreground: recipe.foreground, signal })
  if (!result.foregroundObservation || !result.output.hasAlpha) throw new Error('[avg-process] 前景加工没有实际分离观察或 PNG alpha')
  const body: Omit<AvgImageProcessingReceiptV2, 'receiptHash'> = { schema: 'storyforge.avg.image-processing-receipt', version: 2,
    processor: AVG_IMAGE_PROCESSOR_V2, recipeHash: await hashProductProductionValueV2(recipe), source: result.source,
    output: result.output, geometry: result.geometry, renderer: result.renderer,
    foreground: { ...result.foregroundObservation, policyHash: await hashProductProductionValueV2(recipe.foreground) } }
  const receipt = await assertAvgImageProcessingReceiptV2(recipe, { ...body, receiptHash: await hashProductProductionValueV2(body) })
  if (signal?.aborted) throw aborted()
  return { data: result.data, receipt }
}
export async function processAvgImageBytes(input: AvgImageByteInput & { recipe: AvgImageProcessingRecipe;
  frozenRequirement?: Parameters<typeof assertAvgForegroundRequirementBinding>[1]
}) {
  if(input.recipe.version===3)throw new Error('[avg-composite] 局部合成需要准确双输入来源与专用后台流程')
  if (input.recipe.version === 1) return processAvgImageBytesV1({ data: input.data, source: input.source, recipe: input.recipe, signal: input.signal })
  if (!input.frozenRequirement) throw new Error('[avg-process] 前景加工缺少准确冻结需求')
  return processAvgImageBytesV2({ data: input.data, source: input.source, recipe: input.recipe, signal: input.signal, frozenRequirement: input.frozenRequirement })
}
