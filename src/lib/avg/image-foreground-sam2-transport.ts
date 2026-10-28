import { sha256MediaData } from '../product-production/media-blob-store'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { avgNumber } from './protocol-validation'
import type { AvgForegroundPolicyV4, AvgForegroundPolicyV5, AvgForegroundPolicyV6 } from './image-foreground-contract'

export const AVG_SAM2_LOCAL_ENDPOINT = 'http://127.0.0.1:5278' as const
export const AVG_SAM2_TIMEOUT_MS = 180_000
export const AVG_SAM2_PREFLIGHT_TIMEOUT_MS = 5_000
export type AvgSam2Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export interface AvgSam2TransportInput {
  data: ArrayBuffer
  source: { contentHash: string; mimeType: string; width: number; height: number }
  policy: AvgForegroundPolicyV4 | AvgForegroundPolicyV5 | AvgForegroundPolicyV6
  signal?: AbortSignal
}
export interface AvgSam2DecodedObservation {
  alphaCoverage: number; clearedPixelCount: number; translucentPixelCount: number; opaquePixelCount: number
  cutoutPixelHash: string; policyHash: string
}
interface Sam2ByteClaims { alphaPlaneHash: string; resultPngSha256: string; serviceCutoutPixelHash: string; promptSha256: string }

function interrupted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('SAM 2 request aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => { cleanup(); reject(signal.reason ?? new DOMException('SAM 2 request aborted', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
async function readBoundedBody(response: Response, signal: AbortSignal, maximum: number): Promise<ArrayBuffer> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximum) throw new Error('SAM 2 response too large')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('SAM 2 response body missing')
  const chunks: Uint8Array[] = []
  let length = 0, complete = false
  try {
    while (true) {
      const next = await interrupted(reader.read(), signal)
      if (next.done) { complete = true; break }
      length += next.value.byteLength
      if (length > maximum) throw new Error('SAM 2 response too large')
      chunks.push(next.value.slice())
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes.buffer
}
function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function hashBytes(value: Uint8Array | Uint8ClampedArray): Promise<string> {
  const bytes = new Uint8Array(value.byteLength); bytes.set(value)
  return hex(await crypto.subtle.digest('SHA-256', bytes.buffer))
}
async function hashText(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value).buffer))
}
export function readAvgSam2RatioHeader(value: string | null, label: string, min: number, max: number): number {
  if (!value || !/^(?:0|1)(?:\.\d+)?$/.test(value)) throw new Error(`[avg-foreground-sam2] ${label} 服务观察格式无效`)
  return avgNumber(Number(value), label, min, max, false)
}

/** Shared bounded loopback I/O; each version supplies its exact identity codec.
 * No image or credential is sent by this readiness probe. */
export async function assertAvgSam2ServiceReady(input: {
  api: 'v1' | 'v2' | 'v3'; assertCapability: (value: unknown) => unknown; fetcher?: AvgSam2Fetcher
}): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('SAM 2 capability probe timed out')), AVG_SAM2_PREFLIGHT_TIMEOUT_MS)
  try {
    const response = await interrupted((input.fetcher ?? globalThis.fetch)(`${AVG_SAM2_LOCAL_ENDPOINT}/${input.api}/capabilities`, {
      method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
    }), controller.signal)
    if (!response.ok || response.headers.get('content-type')?.toLowerCase().split(';', 1)[0]?.trim() !== 'application/json') {
      throw new Error('capability endpoint unavailable')
    }
    const bytes = await readBoundedBody(response, controller.signal, 8192)
    if (controller.signal.aborted) throw controller.signal.reason
    input.assertCapability(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch (cause) {
    throw Object.assign(new Error('[avg-foreground-sam2] 本机 SAM 2 服务未就绪或版本不匹配；Build 尚未授权，请启动匹配服务后重试'), { cause })
  } finally { clearTimeout(timer) }
}

/** Version-neutral byte transport only. The caller owns the frozen policy,
 * exact header codec, prompt manifest and any version-specific quality gate. */
export async function runAvgSam2Transport<C extends Sam2ByteClaims>(input: AvgSam2TransportInput, profile: {
  api: 'v1' | 'v2' | 'v3'; prompts: readonly unknown[]; parseClaims: (headers: Headers) => C
}): Promise<{ rgba: Uint8ClampedArray; observation: C & AvgSam2DecodedObservation; thresholdCoverage: number }> {
  if (input.signal?.aborted) throw new DOMException('AVG SAM 2 processing aborted', 'AbortError')
  if (input.data.byteLength < 1 || input.data.byteLength > 32 * 1024 * 1024) throw new Error('[avg-foreground-sam2] 原图字节超出上限')
  const data = input.data.slice(0)
  if (await sha256MediaData(data) !== input.source.contentHash) throw new Error('[avg-foreground-sam2] 原图字节 hash 与冻结来源不一致')
  if (input.signal?.aborted) throw new DOMException('AVG SAM 2 processing aborted', 'AbortError')
  const controller = new AbortController(), abort = () => controller.abort(input.signal?.reason)
  input.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('本机 SAM 2 处理超时；不自动重发')), AVG_SAM2_TIMEOUT_MS)
  try {
    const response = await interrupted(fetch(`${AVG_SAM2_LOCAL_ENDPOINT}/${profile.api}/segment`, {
      method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      headers: { 'Content-Type': 'application/octet-stream', 'X-SF-Operation-ID': crypto.randomUUID(),
        'X-SF-Source-SHA256': input.source.contentHash, 'X-SF-Source-Mime': input.source.mimeType,
        'X-SF-Source-Width': String(input.source.width), 'X-SF-Source-Height': String(input.source.height) }, body: data,
    }), controller.signal)
    if (!response.ok) throw new Error(`[avg-foreground-sam2] 本机处理未成功（HTTP ${response.status}）；没有自动重试`)
    if (response.headers.get('content-type')?.toLowerCase().split(';', 1)[0]?.trim() !== 'image/png') throw new Error('[avg-foreground-sam2] 本机服务没有返回 PNG 候选')
    const claims = profile.parseClaims(response.headers)
    const expectedPromptHash = await hashText(JSON.stringify({ prompts: profile.prompts, strategy: input.policy.promptStrategy }))
    if (claims.promptSha256 !== expectedPromptHash) throw new Error('[avg-foreground-sam2] 本地服务没有执行冻结的人物提示策略')
    const encoded = await readBoundedBody(response, controller.signal, 32 * 1024 * 1024)
    if (encoded.byteLength < 1 || await sha256MediaData(encoded) !== claims.resultPngSha256) throw new Error('[avg-foreground-sam2] 候选 PNG 传输 hash 不一致')
    const decoding = createImageBitmap(new Blob([encoded], { type: 'image/png' })).then(bitmap => {
      if (controller.signal.aborted) bitmap.close()
      return bitmap
    })
    const bitmap = await interrupted(decoding, controller.signal)
    const canvas = document.createElement('canvas'); canvas.width = input.source.width; canvas.height = input.source.height
    try {
      if (bitmap.width !== input.source.width || bitmap.height !== input.source.height) throw new Error('[avg-foreground-sam2] 候选 PNG 尺寸与冻结原图不符')
      const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true, colorSpace: 'srgb' })
      if (!context) throw new Error('[avg-foreground-sam2] 当前浏览器不能读取本地候选像素')
      context.drawImage(bitmap, 0, 0)
      const rgba = new Uint8ClampedArray(context.getImageData(0, 0, input.source.width, input.source.height).data)
      const alpha = new Uint8Array(input.source.width * input.source.height)
      let clearedPixelCount = 0, translucentPixelCount = 0, opaquePixelCount = 0, alphaSum = 0, thresholdPixels = 0
      for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
        const value = rgba[index + 3]; alpha[pixel] = value; alphaSum += value
        if (value >= 128) thresholdPixels += 1
        if (value === 0) clearedPixelCount += 1
        else if (value === 255) opaquePixelCount += 1
        else translucentPixelCount += 1
      }
      if (!clearedPixelCount || !opaquePixelCount) throw new Error('[avg-foreground-sam2] 候选没有真实透明区域或前景区域')
      const [alphaPlaneHash, cutoutPixelHash] = await Promise.all([hashBytes(alpha), hashBytes(rgba)])
      if (alphaPlaneHash !== claims.alphaPlaneHash) throw new Error('[avg-foreground-sam2] 浏览器解码 alpha 与本机服务 hash 不一致')
      const policyHash = await hashProductProductionValueV2(input.policy)
      if (controller.signal.aborted) throw controller.signal.reason
      return { rgba, thresholdCoverage: thresholdPixels / alpha.length, observation: { ...claims,
        alphaCoverage: alphaSum / (255 * alpha.length), clearedPixelCount, translucentPixelCount, opaquePixelCount,
        cutoutPixelHash, policyHash } }
    } finally { bitmap.close(); canvas.width = 0; canvas.height = 0 }
  } catch (error) {
    if (input.signal?.aborted) throw new DOMException('AVG SAM 2 processing aborted', 'AbortError')
    if (controller.signal.aborted) throw new Error('[avg-foreground-sam2] 本机处理超时或中止；没有自动重发')
    throw error
  } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort) }
}
