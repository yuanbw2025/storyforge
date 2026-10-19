import { detectProductMediaMimeTypeV1 } from '../product-production/media-adapters'

/** Shared by native import and actual-byte revalidation after restoration. */
export function assertAvgMediaBytesV1(data: ArrayBuffer, mimeType: string) {
  if (!['image/png','image/jpeg','image/webp','audio/mpeg','audio/wav','audio/ogg','audio/mp4'].includes(mimeType)) throw new Error('[avg] 作者媒资格式不支持')
  if (!data.byteLength || data.byteLength > 32*1024*1024) throw new Error('[avg] 单个作者媒资需为 1 字节～32 MiB')
  const detected = detectProductMediaMimeTypeV1(data)
  const bytes = new Uint8Array(data)
  const isMp4 = bytes.length >= 12 && String.fromCharCode(...bytes.slice(4,8)) === 'ftyp'
  if (detected !== mimeType && !(mimeType === 'audio/mp4' && isMp4)) throw new Error('[avg] 素材真实格式与 MIME 声明不一致')
}
