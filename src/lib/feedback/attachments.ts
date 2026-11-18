import { imageSize } from 'image-size'

export const MAX_FEEDBACK_IMAGES = 3
export const MAX_FEEDBACK_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_FEEDBACK_TOTAL_BYTES = 4 * 1024 * 1024
export interface FeedbackImage {
  name: string
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  data: string
}
export function imageFormat(bytes: Uint8Array): FeedbackImage['mime'] | undefined {
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)
    && String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR') return 'image/png'
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return 'image/jpeg'
  const head = String.fromCharCode(...bytes.slice(0, 12))
  if (bytes.length >= 14 && /^(GIF87a|GIF89a)/.test(head) && bytes[bytes.length - 1] === 59) return 'image/gif'
  if (bytes.length >= 16 && head.startsWith('RIFF') && head.slice(8) === 'WEBP'
    && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length) return 'image/webp'
}
export function feedbackImageBytes(image: FeedbackImage): number { return Math.floor(image.data.length * 3 / 4) - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0) }
export async function readFeedbackImage(file: File, index: number): Promise<FeedbackImage> {
  if (!file.size || file.size > MAX_FEEDBACK_IMAGE_BYTES) throw new Error('每张截图需在 2 MB 以内，且不能为空。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = imageFormat(bytes)
  if (!mime || (file.type && file.type !== mime)) throw new Error('请选择实际格式为 PNG、JPEG、GIF 或 WebP 的截图。')
  // Bound the declared pixel allocation before the browser decoder runs.
  let dimensions: ReturnType<typeof imageSize>
  try { dimensions = imageSize(bytes) } catch { throw new Error('截图头信息无效，请重新选择图片。') }
  const formats: Record<string, FeedbackImage['mime']> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
  if (formats[dimensions.type ?? ''] !== mime || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height)
    || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width * dimensions.height > 40_000_000) throw new Error('截图像素过大或尺寸无效，请缩小后重试。')
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  const data = btoa(binary)
  // Decode locally before accepting. Neither paste nor preview sends a request.
  if (typeof createImageBitmap === 'function') {
    const decoded = await createImageBitmap(new Blob([bytes], { type: mime })).catch(() => { throw new Error('截图无法解码，请重新选择图片。') })
    const valid = decoded.width > 0 && decoded.height > 0 && decoded.width * decoded.height <= 40_000_000
    decoded.close()
    if (!valid) throw new Error('截图像素过大，请缩小后重试。')
  } else {
    const preview = new Image()
    if (typeof preview.decode !== 'function') throw new Error('当前浏览器无法验证截图，请更换浏览器后重试。')
    preview.src = `data:${mime};base64,${data}`
    await preview.decode().catch(() => { throw new Error('截图无法解码，请重新选择图片。') })
    if (!preview.naturalWidth || !preview.naturalHeight || preview.naturalWidth * preview.naturalHeight > 40_000_000) throw new Error('截图像素过大或尺寸无效，请缩小后重试。')
  }
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice(6)
  return { name: `screenshot-${index + 1}.${extension}`, mime, data }
}
