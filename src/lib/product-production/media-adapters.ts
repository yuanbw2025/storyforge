import type { ProductMediaKind } from '../types'
import { sha256MediaData } from './media-blob-store'

export type ProductMediaClassV1 = 'image' | 'music' | 'sfx'
export type MediaExecutionLocationV1 = 'browser-direct' | 'local-relay' | 'trusted-relay'

export interface ProductMediaProviderCapabilityV1 {
  adapterId: string
  version: 1
  mediaClasses: ProductMediaClassV1[]
  operations: Array<'generate' | 'reuse' | 'import'>
  executionLocations: MediaExecutionLocationV1[]
  maximumOutputsPerRequest: number
  commercialEligible: boolean
  availability: 'implemented' | 'catalog-service' | 'import-service'
}

export interface ProductMediaRequestV1 {
  schema: 'storyforge.product-media-request'
  version: 1
  requestId: string
  adapterId: string
  mediaClass: ProductMediaClassV1
  mediaKind: ProductMediaKind
  requirementKey: string
  artifactKey: string
  prompt: string
  negativePrompt: string
  count: number
  width: number | null
  height: number | null
  durationMs: number | null
  inputHash: string
  qualityProfile: 'prototype' | 'internal' | 'commercial-candidate'
  environment: 'test' | 'development' | 'production'
  allowedDataClasses: string[]
  rightsPolicyVersion: string
}

export interface ProductMediaEstimateV1 {
  requestId: string
  outputCount: number
  estimatedCostUsd: number | null
  estimatedDurationMs: number
  estimatedStorageBytes: number
}

export interface RedactedMediaTransportRequestV1 {
  adapterId: string
  requestId: string
  method: 'POST'
  endpoint: string
  body: Record<string, unknown>
  allowedDataClasses: string[]
}

export interface MediaTransportResponseV1 {
  status: number
  contentType: string | null
  body: ArrayBuffer | null
  json: unknown
  providerRequestId: string | null
  usage: unknown
  costUsd: number | null
}

export interface MediaProviderTransportV1 {
  executionLocation: MediaExecutionLocationV1
  request(input: RedactedMediaTransportRequestV1, signal: AbortSignal): Promise<MediaTransportResponseV1>
  fetchExternalAsset?(input: { url: string; maximumBytes: number }, signal: AbortSignal): Promise<ArrayBuffer>
}

export interface ProductMediaCandidateV1 {
  schema: 'storyforge.product-media-candidate'
  version: 1
  adapterId: string
  requestId: string
  candidateIndex: number
  mediaClass: ProductMediaClassV1
  mediaKind: ProductMediaKind
  mimeType: string
  byteSize: number
  contentHash: string
  data: ArrayBuffer
  metadata: Record<string, unknown>
  rights: {
    origin: 'generated' | 'procedural' | 'fixture'
    adapterId: string
    rightsPolicyVersion: string
    commercialUse: boolean
    requiresProviderTermsReview: boolean
  }
  providerReceipt: {
    providerRequestId: string | null
    executionLocation: MediaExecutionLocationV1
    usage: unknown
    costUsd: number | null
  }
}

export interface ProductMediaProviderAdapterV1 {
  capability: ProductMediaProviderCapabilityV1
  estimate(request: ProductMediaRequestV1): Promise<ProductMediaEstimateV1>
  generate(
    request: ProductMediaRequestV1,
    transport: MediaProviderTransportV1,
    signal: AbortSignal,
  ): Promise<ProductMediaCandidateV1[]>
  parseAndVerify(candidate: unknown): Promise<ProductMediaCandidateV1>
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const HASH = /^[a-f0-9]{64}$/

function fail(message: string): never {
  throw new Error(`[product-media-adapter] ${message}`)
}

function providerSafetyRefused(response: MediaTransportResponseV1): boolean {
  if (response.status !== 400 && response.status !== 403 && response.status !== 422) return false
  let summary = ''
  try { summary = JSON.stringify(response.json ?? '').slice(0, 4_000).toLowerCase() } catch { return false }
  return /safety|content[_ -]?policy|moderation|unsafe|blocked[_ -]?prompt/.test(summary)
}

function assertProviderResponse(response: MediaTransportResponseV1, label: string, requiresBody = false): void {
  if (providerSafetyRefused(response)) fail('provider-safety-refusal')
  if (response.status < 200 || response.status >= 300 || (requiresBody && !response.body)) {
    fail(`${label} 响应无效:${response.status}`)
  }
}

function row(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !keys.includes(key))
  if (unknown.length) fail(`${label} 包含未允许字段:${unknown.join(',')}`)
}

function assertRequest(request: ProductMediaRequestV1, capability: ProductMediaProviderCapabilityV1): void {
  if (request.schema !== 'storyforge.product-media-request' || request.version !== 1
    || request.adapterId !== capability.adapterId || !KEY.test(request.requestId)
    || !KEY.test(request.requirementKey) || !KEY.test(request.artifactKey)
    || !HASH.test(request.inputHash) || !request.prompt.trim() || request.prompt.length > 20_000
    || request.negativePrompt.length > 8_000 || !Number.isInteger(request.count)
    || request.count < 1 || request.count > capability.maximumOutputsPerRequest
    || !capability.mediaClasses.includes(request.mediaClass)
    || request.allowedDataClasses.some(item => !KEY.test(item))
    || !KEY.test(request.rightsPolicyVersion)) fail('媒体请求不符合 adapter capability')
  if (request.mediaClass === 'image' && !['background', 'character-pose', 'character-expression', 'cg', 'ui'].includes(request.mediaKind)) {
    fail('图片请求的 mediaKind 无效')
  }
  if (request.mediaClass === 'music' && request.mediaKind !== 'bgm') fail('音乐请求必须使用 bgm')
  if (request.mediaClass === 'sfx' && !['sfx', 'ambience'].includes(request.mediaKind)) fail('音效请求 mediaKind 无效')
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function decodeBase64(value: unknown): ArrayBuffer {
  if (typeof value !== 'string' || value.length < 8 || value.length > 150_000_000) {
    fail('provider base64 无效')
  }
  // Some OpenAI-compatible image gateways preserve RFC 4648 line wrapping,
  // omit padding, use the URL-safe alphabet, or return a Data URI even though
  // the field is named b64_json. Normalize only those bounded encodings; the
  // decoded bytes are still checked against their real MIME signature below.
  const dataUri = value.match(/^data:(image\/(?:png|jpeg|webp));base64,/i)
  const payload = (dataUri ? value.slice(dataUri[0].length) : value)
    .replace(/[\t\n\f\r ]/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const padding = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4))
  const normalized = `${payload}${padding}`
  if (normalized.length < 8 || normalized.length > 150_000_000
    || normalized.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) fail('provider base64 无效')
  let decoded: string
  try { decoded = atob(normalized) } catch { fail('provider base64 无法解码') }
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index)
  return asArrayBuffer(bytes)
}

/** Detect the real supported media MIME from bytes; caller metadata is never trusted. */
export function detectProductMediaMimeTypeV1(data: ArrayBuffer): string | null {
  const bytes = new Uint8Array(data)
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length))
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'audio/wav'
  if (bytes.length >= 4 && ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (bytes.length >= 3 && ascii(0, 3) === 'ID3') return 'audio/mpeg'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  return null
}

/** Reads intrinsic dimensions from provider bytes without trusting request metadata. */
export function detectProductImageDimensionsV1(data: ArrayBuffer): { width: number; height: number } | null {
  const bytes = new Uint8Array(data)
  const view = new DataView(data)
  const valid = (width: number, height: number) => (
    Number.isInteger(width) && Number.isInteger(height)
      && width > 0 && height > 0 && width <= 32_768 && height <= 32_768
      ? { width, height } : null
  )
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50
    && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return valid(view.getUint32(16, false), view.getUint32(20, false))
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset++]
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset, false)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
        && length >= 7) return valid(view.getUint16(offset + 5, false), view.getUint16(offset + 3, false))
      offset += length
    }
    return null
  }
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length))
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4)
    if (chunk === 'VP8X') {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
      return valid(width, height)
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8)
      const height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10))
      return valid(width, height)
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return valid(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
    }
  }
  return null
}

async function candidate(input: {
  adapterId: string
  request: ProductMediaRequestV1
  candidateIndex: number
  data: ArrayBuffer
  expectedMimeTypes: string[]
  metadata?: Record<string, unknown>
  origin: ProductMediaCandidateV1['rights']['origin']
  commercialUse: boolean
  transport: MediaProviderTransportV1
  response?: MediaTransportResponseV1
}): Promise<ProductMediaCandidateV1> {
  if (input.data.byteLength < 4 || input.data.byteLength > 100 * 1024 * 1024) fail('候选大小无效')
  const mimeType = detectProductMediaMimeTypeV1(input.data)
  if (!mimeType || !input.expectedMimeTypes.includes(mimeType)) fail('候选真实 MIME 与请求不一致')
  const contentHash = await sha256MediaData(input.data)
  return {
    schema: 'storyforge.product-media-candidate', version: 1,
    adapterId: input.adapterId, requestId: input.request.requestId,
    candidateIndex: input.candidateIndex, mediaClass: input.request.mediaClass,
    mediaKind: input.request.mediaKind, mimeType, byteSize: input.data.byteLength,
    contentHash, data: input.data.slice(0), metadata: structuredClone(input.metadata ?? {}),
    rights: {
      origin: input.origin, adapterId: input.adapterId,
      rightsPolicyVersion: input.request.rightsPolicyVersion,
      commercialUse: input.commercialUse,
      requiresProviderTermsReview: input.origin === 'generated',
    },
    providerReceipt: {
      providerRequestId: input.response?.providerRequestId ?? null,
      executionLocation: input.transport.executionLocation,
      usage: structuredClone(input.response?.usage ?? null),
      costUsd: input.response?.costUsd ?? null,
    },
  }
}

async function verifyCandidate(value: unknown, adapterId: string): Promise<ProductMediaCandidateV1> {
  const item = row(value, 'candidate') as unknown as ProductMediaCandidateV1
  if (item.schema !== 'storyforge.product-media-candidate' || item.version !== 1
    || item.adapterId !== adapterId || !KEY.test(item.requestId) || !Number.isInteger(item.candidateIndex)
    || item.candidateIndex < 0 || !(item.data instanceof ArrayBuffer)
    || item.byteSize !== item.data.byteLength || !HASH.test(item.contentHash)
    || await sha256MediaData(item.data) !== item.contentHash
    || detectProductMediaMimeTypeV1(item.data) !== item.mimeType) fail('候选验证失败')
  return structuredClone(item)
}

function estimate(request: ProductMediaRequestV1, bytesPerOutput: number, durationMs: number): ProductMediaEstimateV1 {
  return {
    requestId: request.requestId, outputCount: request.count, estimatedCostUsd: null,
    estimatedDurationMs: durationMs, estimatedStorageBytes: bytesPerOutput * request.count,
  }
}

const OPENAI_IMAGE_CAPABILITY: ProductMediaProviderCapabilityV1 = {
  adapterId: 'openai.gpt-image-2.v1', version: 1, mediaClasses: ['image'], operations: ['generate'],
  executionLocations: ['local-relay', 'trusted-relay'], maximumOutputsPerRequest: 4,
  commercialEligible: true, availability: 'implemented',
}

const AGNES_IMAGE_CAPABILITY: ProductMediaProviderCapabilityV1 = {
  adapterId: 'agnes.image-2.1-flash.v1', version: 1, mediaClasses: ['image'], operations: ['generate'],
  executionLocations: ['browser-direct'], maximumOutputsPerRequest: 1,
  commercialEligible: true, availability: 'implemented',
}

function agnesImageRatio(width: number | null, height: number | null): string {
  if (width == null || height == null || width === height) return '1:1'
  const requested = width / height
  const supported = [
    ['3:4', 3 / 4], ['4:3', 4 / 3], ['16:9', 16 / 9], ['9:16', 9 / 16],
    ['2:3', 2 / 3], ['3:2', 3 / 2], ['21:9', 21 / 9],
  ] as const
  return supported.reduce((best, candidate) => (
    Math.abs(candidate[1] - requested) < Math.abs(best[1] - requested) ? candidate : best
  ))[0]
}

/**
 * Agnes image generation uses the same user-owned Agnes connection as text,
 * but a dedicated image model and endpoint. The adapter receives only a
 * credential-holding transport; requests and durable receipts stay redacted.
 */
export const agnesImage21FlashAdapterV1: ProductMediaProviderAdapterV1 = {
  capability: AGNES_IMAGE_CAPABILITY,
  async estimate(request) { assertRequest(request, AGNES_IMAGE_CAPABILITY); return estimate(request, 4_000_000, 120_000) },
  async generate(request, transport, signal) {
    assertRequest(request, AGNES_IMAGE_CAPABILITY)
    if (!AGNES_IMAGE_CAPABILITY.executionLocations.includes(transport.executionLocation)) {
      fail('Agnes 图片 transport 位置未授权')
    }
    const ratio = agnesImageRatio(request.width, request.height)
    const prompt = request.negativePrompt.trim()
      ? `${request.prompt}\nAvoid: ${request.negativePrompt}`
      : request.prompt
    const requiresAlpha = request.mediaKind === 'character-pose' || request.mediaKind === 'character-expression'
    const response = await transport.request({
      adapterId: AGNES_IMAGE_CAPABILITY.adapterId, requestId: request.requestId, method: 'POST',
      endpoint: '/v1/images/generations', allowedDataClasses: [...request.allowedDataClasses],
      body: {
        model: 'agnes-image-2.1-flash', prompt, size: '1K', ratio, return_base64: true,
        extra_body: { response_format: 'b64_json' },
        ...(requiresAlpha ? { background: 'transparent', output_format: 'png' } : {}),
      },
    }, signal)
    assertProviderResponse(response, 'Agnes 图片')
    const root = row(response.json, 'Agnes image response')
    allowedKeys(root, [
      'created', 'data', 'usage',
      'background', 'output_format', 'quality', 'size',
    ], 'Agnes image response')
    for (const metadataKey of ['background', 'output_format', 'quality', 'size'] as const) {
      const value = root[metadataKey]
      if (value != null && (typeof value !== 'string' || value.length > 100)) {
        fail(`Agnes image response.${metadataKey} 元数据无效`)
      }
    }
    if (!Array.isArray(root.data) || root.data.length !== request.count) fail('Agnes 图片数量不一致')
    return Promise.all(root.data.map(async (raw, index) => {
      const image = row(raw, `Agnes image data[${index}]`)
      allowedKeys(image, ['url', 'b64_json', 'revised_prompt'], `Agnes image data[${index}]`)
      const hasBase64 = typeof image.b64_json === 'string' && image.b64_json.trim().length > 0
      const hasUrl = typeof image.url === 'string' && image.url.trim().length > 0
      if (hasBase64 === hasUrl) fail(`Agnes image data[${index}] 必须且只能提供一个图片载荷`)
      let data: ArrayBuffer
      let providerDelivery: 'base64' | 'url'
      let providerAssetOrigin: string | null = null
      if (hasBase64) {
        data = decodeBase64(image.b64_json)
        providerDelivery = 'base64'
      } else {
        if (!transport.fetchExternalAsset) fail('Agnes URL 图片 transport 未授权')
        data = await transport.fetchExternalAsset({ url: String(image.url), maximumBytes: 100 * 1024 * 1024 }, signal)
        providerDelivery = 'url'
        try { providerAssetOrigin = new URL(String(image.url)).origin } catch { fail('Agnes 图片 URL 无效') }
      }
      return candidate({
        adapterId: AGNES_IMAGE_CAPABILITY.adapterId, request, candidateIndex: index,
        data, expectedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        origin: 'generated', commercialUse: true, transport, response,
        metadata: {
          model: 'agnes-image-2.1-flash', providerSize: '1K', providerRatio: ratio,
          requestedWidth: request.width, requestedHeight: request.height,
          requestedTransparentBackground: requiresAlpha,
          providerDelivery, providerAssetOrigin,
          providerBackground: typeof root.background === 'string' ? root.background : null,
          providerOutputFormat: typeof root.output_format === 'string' ? root.output_format : null,
          providerQuality: typeof root.quality === 'string' ? root.quality : null,
          providerResolvedSize: typeof root.size === 'string' ? root.size : null,
          revisedPrompt: typeof image.revised_prompt === 'string' ? image.revised_prompt : null,
        },
      })
    }))
  },
  parseAndVerify(value) { return verifyCandidate(value, AGNES_IMAGE_CAPABILITY.adapterId) },
}

export const openAIGptImage2AdapterV1: ProductMediaProviderAdapterV1 = {
  capability: OPENAI_IMAGE_CAPABILITY,
  async estimate(request) { assertRequest(request, OPENAI_IMAGE_CAPABILITY); return estimate(request, 4_000_000, 120_000) },
  async generate(request, transport, signal) {
    assertRequest(request, OPENAI_IMAGE_CAPABILITY)
    if (request.qualityProfile === 'commercial-candidate' && transport.executionLocation !== 'trusted-relay') {
      fail('商业候选的 OpenAI 图片调用必须使用 trusted-relay')
    }
    if (!OPENAI_IMAGE_CAPABILITY.executionLocations.includes(transport.executionLocation)) fail('OpenAI 图片 transport 位置未授权')
    const size = request.width == null || request.height == null
      ? 'auto'
      : request.width === request.height
        ? '1024x1024'
        : request.width > request.height ? '1536x1024' : '1024x1536'
    const response = await transport.request({
      adapterId: OPENAI_IMAGE_CAPABILITY.adapterId, requestId: request.requestId, method: 'POST',
      endpoint: '/v1/images/generations', allowedDataClasses: [...request.allowedDataClasses],
      body: {
        model: 'gpt-image-2', prompt: request.prompt, n: request.count,
        size,
        output_format: 'png', quality: request.qualityProfile === 'prototype' ? 'low' : 'high',
      },
    }, signal)
    assertProviderResponse(response, 'OpenAI 图片')
    const root = row(response.json, 'OpenAI image response')
    allowedKeys(root, ['created', 'data', 'usage'], 'OpenAI image response')
    if (!Array.isArray(root.data) || root.data.length !== request.count) fail('OpenAI 图片数量不一致')
    return Promise.all(root.data.map(async (raw, index) => {
      const image = row(raw, `OpenAI image data[${index}]`)
      allowedKeys(image, ['b64_json', 'revised_prompt'], `OpenAI image data[${index}]`)
      return candidate({
        adapterId: OPENAI_IMAGE_CAPABILITY.adapterId, request, candidateIndex: index,
        data: decodeBase64(image.b64_json), expectedMimeTypes: ['image/png'], origin: 'generated',
        commercialUse: true, transport, response,
        metadata: {
          model: 'gpt-image-2', providerSize: size,
          requestedWidth: request.width, requestedHeight: request.height,
          revisedPrompt: typeof image.revised_prompt === 'string' ? image.revised_prompt : null,
        },
      })
    }))
  },
  parseAndVerify(value) { return verifyCandidate(value, OPENAI_IMAGE_CAPABILITY.adapterId) },
}

function elevenAdapter(input: {
  adapterId: 'elevenlabs.sound-effects.v2' | 'elevenlabs.music.v2'
  mediaClass: 'sfx' | 'music'
  endpoint: string
}): ProductMediaProviderAdapterV1 {
  const capability: ProductMediaProviderCapabilityV1 = {
    adapterId: input.adapterId, version: 1, mediaClasses: [input.mediaClass], operations: ['generate'],
    executionLocations: ['local-relay', 'trusted-relay'], maximumOutputsPerRequest: 1,
    commercialEligible: true, availability: 'implemented',
  }
  return {
    capability,
    async estimate(request) { assertRequest(request, capability); return estimate(request, 5_000_000, 120_000) },
    async generate(request, transport, signal) {
      assertRequest(request, capability)
      if (request.qualityProfile === 'commercial-candidate' && transport.executionLocation !== 'trusted-relay') {
        fail('商业候选的 ElevenLabs 调用必须使用 trusted-relay')
      }
      if (!capability.executionLocations.includes(transport.executionLocation)) fail('ElevenLabs transport 位置未授权')
      const response = await transport.request({
        adapterId: capability.adapterId, requestId: request.requestId, method: 'POST',
        endpoint: input.endpoint, allowedDataClasses: [...request.allowedDataClasses],
        body: input.mediaClass === 'music'
          ? { prompt: request.prompt, music_length_ms: request.durationMs, instrumental: true, output_format: 'mp3_44100_128' }
          : { text: request.prompt, duration_seconds: request.durationMs == null ? null : request.durationMs / 1000, prompt_influence: 0.3 },
      }, signal)
      assertProviderResponse(response, 'ElevenLabs', true)
      return [await candidate({
        adapterId: capability.adapterId, request, candidateIndex: 0, data: response.body!,
        expectedMimeTypes: ['audio/mpeg'], origin: 'generated', commercialUse: true,
        transport, response, metadata: { outputFormat: 'mp3' },
      })]
    },
    parseAndVerify(value) { return verifyCandidate(value, capability.adapterId) },
  }
}

export const elevenLabsSoundEffectsAdapterV2 = elevenAdapter({
  adapterId: 'elevenlabs.sound-effects.v2', mediaClass: 'sfx', endpoint: '/v1/sound-generation',
})
export const elevenLabsMusicAdapterV2 = elevenAdapter({
  adapterId: 'elevenlabs.music.v2', mediaClass: 'music', endpoint: '/v1/music',
})

function wavTone(durationMs: number): ArrayBuffer {
  const sampleRate = 8_000
  const sampleCount = Math.max(80, Math.min(sampleRate * 10, Math.floor(sampleRate * durationMs / 1000)))
  const buffer = new ArrayBuffer(44 + sampleCount * 2)
  const view = new DataView(buffer)
  const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  write(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); write(8, 'WAVE'); write(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data')
  view.setUint32(40, sampleCount * 2, true)
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = 1 - index / sampleCount
    view.setInt16(44 + index * 2, Math.round(Math.sin(index / sampleRate * Math.PI * 880) * 4_000 * envelope), true)
  }
  return buffer
}

const PROCEDURAL_CAPABILITY: ProductMediaProviderCapabilityV1 = {
  adapterId: 'procedural-audio.v1', version: 1, mediaClasses: ['sfx'], operations: ['generate'],
  executionLocations: ['browser-direct'], maximumOutputsPerRequest: 1,
  commercialEligible: false, availability: 'implemented',
}

export const proceduralAudioAdapterV1: ProductMediaProviderAdapterV1 = {
  capability: PROCEDURAL_CAPABILITY,
  async estimate(request) { assertRequest(request, PROCEDURAL_CAPABILITY); return estimate(request, 160_044, 10) },
  async generate(request, transport) {
    assertRequest(request, PROCEDURAL_CAPABILITY)
    if (request.qualityProfile === 'commercial-candidate') fail('procedural audio 不能作为商业候选完成证据')
    return [await candidate({
      adapterId: PROCEDURAL_CAPABILITY.adapterId, request, candidateIndex: 0,
      data: wavTone(request.durationMs ?? 1_000), expectedMimeTypes: ['audio/wav'],
      origin: 'procedural', commercialUse: false, transport,
      metadata: { generator: 'storyforge-decay-tone-v1' },
    })]
  },
  parseAndVerify(value) { return verifyCandidate(value, PROCEDURAL_CAPABILITY.adapterId) },
}

const UNIMPLEMENTED_CAPABILITIES: ProductMediaProviderCapabilityV1[] = [
  {
    adapterId: 'fixture.media.v1', version: 1, mediaClasses: ['image', 'music', 'sfx'],
    operations: ['generate'], executionLocations: ['browser-direct'], maximumOutputsPerRequest: 8,
    commercialEligible: false, availability: 'import-service',
  },
  {
    adapterId: 'existing-project-media.v1', version: 1, mediaClasses: ['image', 'music', 'sfx'],
    operations: ['reuse'], executionLocations: ['browser-direct'], maximumOutputsPerRequest: 100,
    commercialEligible: true, availability: 'catalog-service',
  },
  {
    adapterId: 'local-import-media.v1', version: 1, mediaClasses: ['image', 'music', 'sfx'],
    operations: ['import'], executionLocations: ['browser-direct'], maximumOutputsPerRequest: 100,
    commercialEligible: true, availability: 'import-service',
  },
]

const IMPLEMENTED_ADAPTERS = new Map<string, ProductMediaProviderAdapterV1>([
  agnesImage21FlashAdapterV1,
  openAIGptImage2AdapterV1,
  elevenLabsSoundEffectsAdapterV2,
  elevenLabsMusicAdapterV2,
  proceduralAudioAdapterV1,
].map(adapter => [adapter.capability.adapterId, adapter]))

export function listProductMediaProviderCapabilitiesV1(): ProductMediaProviderCapabilityV1[] {
  return [[...IMPLEMENTED_ADAPTERS.values()].map(adapter => adapter.capability), UNIMPLEMENTED_CAPABILITIES]
    .flat()
    .map(item => structuredClone(item))
    .sort((left, right) => left.adapterId.localeCompare(right.adapterId))
}

export function resolveProductMediaProviderAdapterV1(adapterId: string): ProductMediaProviderAdapterV1 {
  const adapter = IMPLEMENTED_ADAPTERS.get(adapterId)
  if (!adapter) {
    const declared = UNIMPLEMENTED_CAPABILITIES.find(item => item.adapterId === adapterId)
    if (declared) fail(`${adapterId} 必须通过 ${declared.availability} 绑定，不能伪装成 provider generate`)
    fail(`未知 adapter:${adapterId}`)
  }
  return adapter
}
