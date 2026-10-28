import { detectProductImageDimensionsV1 } from '../product-production/media-adapters'
import { verifyProductMediaRuntimeUrlsV1 } from '../product-production/media-runtime-verifier'
import { assertAvgMediaBytesV1 } from './media-import-contract'

export const AVG_IMAGE_DECODE_PIXEL_LIMIT_V1 = 16 * 1024 * 1024

/** One actual browser observation over already owner/hash-verified bytes. The
 * native decoder is shared with imported media and the player quality probes. */
export async function inspectAvgImageBytesV1(input: { data: ArrayBuffer; assetKey: string; contentHash: string; mimeType: string;
  width?: number | null; height?: number | null; requireAlpha?: boolean }) {
  assertAvgMediaBytesV1(input.data, input.mimeType)
  const dimensions = detectProductImageDimensionsV1(input.data)
  if (!dimensions || dimensions.width * dimensions.height > AVG_IMAGE_DECODE_PIXEL_LIMIT_V1) throw new Error('[avg-media] 图片像素超过当前解码边界，请先明确加工为较小图片')
  const url = URL.createObjectURL(new Blob([input.data], { type: input.mimeType }))
  try {
    const result = await verifyProductMediaRuntimeUrlsV1({ assets: [{ assetKey: input.assetKey, contentHash: input.contentHash,
      mimeType: input.mimeType, width: input.width ?? null, height: input.height ?? null, durationMs: null }], urls: { [input.assetKey]: url }, timeoutMs: 15_000,
      environment: { browserName: 'browser', browserVersion: navigator.userAgent, platform: navigator.platform,
        viewport: { width: window.innerWidth, height: window.innerHeight } } })
    const p = result.assets[0]
    if (!p || p.status !== 'decoded' || p.decodedWidth !== dimensions.width || p.decodedHeight !== dimensions.height || p.decodedHasAlpha === null
      || input.width != null && p.decodedWidth !== input.width || input.height != null && p.decodedHeight !== input.height) {
      throw new Error('[avg-media] 图片实际解码或尺寸校验失败')
    }
    if (input.requireAlpha && !p.decodedHasAlpha) throw new Error('[avg-media] 当前需求需要透明底；原图没有透明像素，须另行加工或返修')
    return { width: p.decodedWidth!, height: p.decodedHeight!, hasAlpha: p.decodedHasAlpha }
  } finally { URL.revokeObjectURL(url) }
}
