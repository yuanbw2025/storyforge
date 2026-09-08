import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig } from '../ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../ai/config-readiness'
import type { AIConfig, ProviderCapabilityRequirementV1 } from '../types'
import { hashProductProductionValueV2 } from './hash'
import {
  resolveProductMediaProviderAdapterV1,
  type ProductMediaProviderAdapterV1,
  type MediaProviderTransportV1,
  type MediaTransportResponseV1,
  type RedactedMediaTransportRequestV1,
} from './media-adapters'
import type { ProductProductionCapabilityBindingV1 } from './scheduler'

const MAX_RELAY_RESPONSE_BYTES = 120 * 1024 * 1024
const MAX_USAGE_HEADER_BYTES = 8 * 1024
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

// WebKit requires Window.fetch to be invoked with its owning global. Keeping a
// bound wrapper also makes the default transport behave like injected fetchers
// instead of leaking a browser-only "Illegal invocation" at production time.
const DEFAULT_FETCHER: Fetcher = (input, init) => globalThis.fetch(input, init)

export interface MediaRelayBindingReceiptV1 {
  schema: 'storyforge.media-relay-binding-receipt'
  version: 1
  requirementKey: string
  adapterId: string
  adapterVersion: 1
  relayOrigin: string
  executionLocation: 'trusted-relay'
  credentialSource: 'relay-session'
  capabilityHash: string
  boundAt: number
  receiptHash: string
}

export interface ConfiguredAgnesImageBindingReceiptV1 {
  schema: 'storyforge.configured-agnes-image-binding-receipt'
  version: 1
  requirementKey: string
  adapterId: 'agnes.image-2.1-flash.v1'
  adapterVersion: 1
  provider: 'agnes'
  model: 'agnes-image-2.1-flash'
  endpointOrigin: string
  executionLocation: 'browser-direct'
  credentialSource: 'existing-ai-config'
  credentialPresent: true
  capabilityHash: string
  boundAt: number
  receiptHash: string
}

export interface AuthoredImagePackBindingReceiptV1 {
  schema: 'storyforge.authored-image-pack-binding-receipt'
  version: 1
  requirementKey: string
  adapterId: 'storyforge.authored-image-pack.v1'
  adapterVersion: 1
  packId: string
  manifestPath: string
  manifestContentHash: string
  executionLocation: 'browser-direct'
  credentialSource: 'none'
  capabilityHash: string
  boundAt: number
  receiptHash: string
}

export type ProductMediaCapabilityBindingReceiptV1 =
  | MediaRelayBindingReceiptV1
  | ConfiguredAgnesImageBindingReceiptV1
  | AuthoredImagePackBindingReceiptV1

export interface ResolvedProductMediaCapabilityV1 {
  adapter: ProductMediaProviderAdapterV1
  transport: MediaProviderTransportV1
  binding: ProductProductionCapabilityBindingV1
  receipt: ProductMediaCapabilityBindingReceiptV1
}

export interface MediaRelayConfigurationReadinessV1 {
  configured: boolean
  ready: boolean
  relayOrigin: string | null
  issue: string | null
}

export interface ConfiguredAgnesImageReadinessV1 {
  ready: boolean
  provider: string
  model: 'agnes-image-2.1-flash'
  endpointOrigin: string
  credentialSource: 'existing-ai-config'
  credentialPresent: boolean
  issue: string | null
}

export interface AuthoredImagePackReadinessV1 {
  configured: boolean
  ready: boolean
  manifestPath: string | null
  issue: string | null
}

interface AuthoredImagePackAssetV1 {
  artifactKey: string
  fileName: string
  contentHash: string
  byteSize: number
  mimeType: 'image/png'
  mediaKind: 'background' | 'character-pose' | 'character-expression' | 'cg' | 'ui'
  width: number
  height: number
  title: string
  altText: string
  license: string
  commercialUse: false
  source: string
}

interface AuthoredImagePackManifestV1 {
  schema: 'storyforge.authored-image-pack'
  version: 1
  packId: string
  title: string
  rightsReview: 'community-prototype-only'
  assets: AuthoredImagePackAssetV1[]
}

function fail(message: string): never {
  throw new Error(`[product-media-relay] ${message}`)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} 字段不符合严格合同`)
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function parseAuthoredImagePackManifestV1(value: unknown): AuthoredImagePackManifestV1 {
  const root = record(value, '作者媒资包清单')
  exactKeys(root, ['schema', 'version', 'packId', 'title', 'rightsReview', 'assets'], '作者媒资包清单')
  if (root.schema !== 'storyforge.authored-image-pack' || root.version !== 1
    || !SAFE_ID.test(String(root.packId ?? ''))
    || typeof root.title !== 'string' || root.title.trim().length < 1 || root.title.length > 200
    || root.rightsReview !== 'community-prototype-only'
    || !Array.isArray(root.assets) || root.assets.length < 1 || root.assets.length > 100) {
    fail('作者媒资包清单无效')
  }
  const assets = root.assets.map((raw, index) => {
    const asset = record(raw, `作者媒资包 assets[${index}]`)
    exactKeys(asset, [
      'artifactKey', 'fileName', 'contentHash', 'byteSize', 'mimeType', 'mediaKind',
      'width', 'height', 'title', 'altText', 'license', 'commercialUse', 'source',
    ], `作者媒资包 assets[${index}]`)
    if (!SAFE_ID.test(String(asset.artifactKey ?? ''))
      || typeof asset.fileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.png$/.test(asset.fileName)
      || !/^[a-f0-9]{64}$/.test(String(asset.contentHash ?? ''))
      || !Number.isInteger(asset.byteSize) || Number(asset.byteSize) < 8 || Number(asset.byteSize) > 100 * 1024 * 1024
      || asset.mimeType !== 'image/png'
      || !['background', 'character-pose', 'character-expression', 'cg', 'ui'].includes(String(asset.mediaKind))
      || !Number.isInteger(asset.width) || Number(asset.width) < 1 || Number(asset.width) > 32_768
      || !Number.isInteger(asset.height) || Number(asset.height) < 1 || Number(asset.height) > 32_768
      || typeof asset.title !== 'string' || asset.title.length > 200
      || typeof asset.altText !== 'string' || asset.altText.length > 1_000
      || typeof asset.license !== 'string' || asset.license.length < 1 || asset.license.length > 200
      || asset.commercialUse !== false
      || typeof asset.source !== 'string' || asset.source.length < 1 || asset.source.length > 300) {
      fail(`作者媒资包 assets[${index}] 无效`)
    }
    return structuredClone(asset) as unknown as AuthoredImagePackAssetV1
  })
  if (new Set(assets.map(asset => asset.artifactKey)).size !== assets.length) fail('作者媒资包 artifactKey 重复')
  if (new Set(assets.map(asset => asset.fileName)).size !== assets.length) fail('作者媒资包 fileName 重复')
  return {
    schema: 'storyforge.authored-image-pack', version: 1,
    packId: String(root.packId), title: String(root.title),
    rightsReview: 'community-prototype-only', assets,
  }
}

function currentPageOrigin(): string {
  const origin = globalThis.location?.origin
  return origin && origin !== 'null' ? origin : 'http://localhost'
}

function authoredPackManifestUrl(input: {
  manifestUrl: string
  environment: 'test' | 'development' | 'production'
  pageOrigin?: string
}): URL {
  let base: URL
  let target: URL
  try {
    base = new URL(input.pageOrigin ?? currentPageOrigin())
    target = new URL(input.manifestUrl, base)
  } catch { fail('作者媒资包清单 URL 无效') }
  if (target.username || target.password || target.search || target.hash) {
    fail('作者媒资包清单 URL 不能包含凭据、查询或片段')
  }
  if (target.origin !== base.origin) fail('作者媒资包清单必须与应用同源')
  const loopback = target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.hostname === '::1'
  if (target.protocol !== 'https:' && !(input.environment !== 'production' && target.protocol === 'http:' && loopback)) {
    fail('作者媒资包清单必须使用同源 HTTPS；开发 HTTP 仅允许 loopback')
  }
  if (!target.pathname.endsWith('.json')) fail('作者媒资包清单必须是 JSON 文件')
  return target
}

async function readAuthoredImagePackManifestV1(input: {
  url: URL
  fetcher: Fetcher
  signal?: AbortSignal
}): Promise<AuthoredImagePackManifestV1> {
  const response = await input.fetcher(input.url, {
    method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
    referrerPolicy: 'no-referrer', signal: input.signal,
  })
  if (!response.ok) fail(`作者媒资包清单读取失败:${response.status}`)
  const declared = response.headers.get('content-length')
  if (declared != null && (!Number.isInteger(Number(declared)) || Number(declared) > 1024 * 1024)) {
    fail('作者媒资包清单大小声明无效')
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) fail('作者媒资包清单过大')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { fail('作者媒资包清单不是合法 JSON') }
  return parseAuthoredImagePackManifestV1(parsed)
}

function endpointOrigin(baseUrl: string): string {
  try { return new URL(baseUrl).origin } catch { return 'custom-endpoint' }
}

function configuredAgnesConfig(projectId: number, config?: AIConfig): AIConfig {
  return config ?? resolveRequestConfig(useAIConfigStore.getState().config, {
    category: 'product-production', projectId,
  }).config
}

function agnesImageEndpoint(baseUrl: string): URL {
  let root = baseUrl.trim().replace(/\/+$/, '')
  root = root.replace(/\/(?:chat\/completions|images\/generations)$/i, '')
  let endpoint: URL
  try { endpoint = new URL(`${root}/images/generations`) } catch { fail('Agnes Base URL 无效') }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    fail('Agnes Base URL 不能包含凭据、查询或片段')
  }
  const loopback = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost' || endpoint.hostname === '::1'
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) {
    fail('Agnes 图片直连必须使用 HTTPS；本地代理仅允许 loopback HTTP')
  }
  return endpoint
}

export function inspectConfiguredAgnesImageCapabilityV1(input: {
  projectId: number
  config?: AIConfig
}): ConfiguredAgnesImageReadinessV1 {
  const config = configuredAgnesConfig(input.projectId, input.config)
  const credentialPresent = isAIConfigReady(config)
  let issue: string | null = null
  if (config.provider !== 'agnes') issue = '全局 AI 提供商当前不是 Agnes，无法复用同一配置生成图片。'
  else if (!credentialPresent) issue = getAIConfigRequiredMessage(config)
  else {
    try { agnesImageEndpoint(config.baseUrl) } catch (cause) {
      issue = cause instanceof Error ? cause.message : 'Agnes 图片端点无效。'
    }
  }
  return {
    ready: issue == null,
    provider: config.provider,
    model: 'agnes-image-2.1-flash',
    endpointOrigin: endpointOrigin(config.baseUrl),
    credentialSource: 'existing-ai-config',
    credentialPresent,
    issue,
  }
}

function responseRequestId(response: Response): string | null {
  const value = response.headers.get('x-request-id') ?? response.headers.get('request-id')
  if (!value) return null
  return SAFE_ID.test(value) ? value : null
}

async function readAgnesJson(response: Response): Promise<unknown> {
  boundedContentLength(response)
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RELAY_RESPONSE_BYTES) fail('Agnes 图片响应过大')
  try { return text ? JSON.parse(text) : null } catch { fail('Agnes 图片响应不是合法 JSON') }
}

function createConfiguredAgnesImageTransportV1(input: {
  config: AIConfig
  fetcher?: Fetcher
}): MediaProviderTransportV1 {
  const endpoint = agnesImageEndpoint(input.config.baseUrl)
  const fetcher = input.fetcher ?? DEFAULT_FETCHER
  const validateAssetUrl = (raw: string): URL => {
    let url: URL
    try { url = new URL(raw) } catch { fail('Agnes 图片 URL 无效') }
    const agnesHost = url.hostname === 'agnes-ai.com' || url.hostname.endsWith('.agnes-ai.com')
      || url.hostname === 'platform-outputs.agnes-ai.space'
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || (!agnesHost && url.hostname !== 'storage.googleapis.com')) {
      fail(`Agnes 图片 URL 不在允许的 HTTPS 存储域:${url.hostname || 'invalid-host'}`)
    }
    return url
  }
  return {
    executionLocation: 'browser-direct',
    async request(request: RedactedMediaTransportRequestV1, signal: AbortSignal) {
      if (request.adapterId !== 'agnes.image-2.1-flash.v1' || !SAFE_ID.test(request.requestId)
        || request.method !== 'POST' || request.endpoint !== '/v1/images/generations'
        || request.allowedDataClasses.some(item => !SAFE_ID.test(item))) {
        fail('Agnes 图片请求不符合已登记能力合同')
      }
      if (Object.keys(request.body).some(key => /api[-_]?key|authorization|credential/i.test(key))) {
        fail('Agnes 图片请求体不能携带凭据字段')
      }
      const response = await fetcher(endpoint, {
        method: 'POST', mode: 'cors', credentials: 'omit', signal,
        headers: {
          authorization: `Bearer ${input.config.apiKey}`,
          'content-type': 'application/json',
          'x-storyforge-idempotency-key': request.requestId,
        },
        body: JSON.stringify(request.body),
      })
      const json = await readAgnesJson(response)
      const usage = json && typeof json === 'object' && !Array.isArray(json)
        ? (json as Record<string, unknown>).usage ?? null
        : null
      return {
        status: response.status, contentType: response.headers.get('content-type'), body: null, json,
        providerRequestId: responseRequestId(response), usage, costUsd: null,
      }
    },
    async fetchExternalAsset(asset, signal) {
      if (!Number.isInteger(asset.maximumBytes) || asset.maximumBytes < 1
        || asset.maximumBytes > MAX_RELAY_RESPONSE_BYTES) fail('Agnes 图片下载上限无效')
      const url = validateAssetUrl(asset.url)
      const response = await fetcher(url, {
        method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'follow',
        referrerPolicy: 'no-referrer', signal,
      })
      if (!response.ok) fail(`Agnes 图片下载失败:${response.status}`)
      const finalUrl = validateAssetUrl(response.url || url.href)
      void finalUrl
      const declared = response.headers.get('content-length')
      if (declared != null) {
        const length = Number(declared)
        if (!Number.isInteger(length) || length < 1 || length > asset.maximumBytes) {
          fail('Agnes 图片下载大小声明无效')
        }
      }
      const body = await response.arrayBuffer()
      if (body.byteLength < 1 || body.byteLength > asset.maximumBytes) fail('Agnes 图片下载大小无效')
      return body
    },
  }
}

export async function resolveConfiguredAgnesImageCapabilityV1(input: {
  projectId: number
  requirement: ProviderCapabilityRequirementV1
  config?: AIConfig
  fetcher?: Fetcher
  now?: number
}): Promise<ResolvedProductMediaCapabilityV1> {
  if (input.requirement.mediaClass !== 'image') fail('Agnes 图片 capability 只能绑定 image requirement')
  const config = configuredAgnesConfig(input.projectId, input.config)
  const readiness = inspectConfiguredAgnesImageCapabilityV1({ projectId: input.projectId, config })
  if (!readiness.ready) fail(readiness.issue || 'Agnes 图片能力未就绪')
  const adapterId = 'agnes.image-2.1-flash.v1' as const
  const adapter = resolveProductMediaProviderAdapterV1(adapterId)
  const identity = {
    schema: 'storyforge.configured-agnes-image-capability' as const, version: 1 as const,
    requirementKey: input.requirement.requirementKey, adapterId, adapterVersion: 1 as const,
    provider: 'agnes' as const, model: 'agnes-image-2.1-flash' as const,
    endpointOrigin: readiness.endpointOrigin, executionLocation: 'browser-direct' as const,
    credentialSource: 'existing-ai-config' as const, credentialPresent: true as const,
  }
  const capabilityHash = await hashProductProductionValueV2(identity)
  const body = {
    schema: 'storyforge.configured-agnes-image-binding-receipt' as const, version: 1 as const,
    requirementKey: input.requirement.requirementKey, adapterId, adapterVersion: 1 as const,
    provider: 'agnes' as const, model: 'agnes-image-2.1-flash' as const,
    endpointOrigin: readiness.endpointOrigin, executionLocation: 'browser-direct' as const,
    credentialSource: 'existing-ai-config' as const, credentialPresent: true as const,
    capabilityHash, boundAt: input.now ?? Date.now(),
  }
  const receipt: ConfiguredAgnesImageBindingReceiptV1 = {
    ...body, receiptHash: await hashProductProductionValueV2(body),
  }
  if (/api[-_]?key|authorization|bearer/i.test(JSON.stringify(receipt))) {
    fail('Agnes 图片 binding receipt 含敏感字段')
  }
  return {
    adapter,
    transport: createConfiguredAgnesImageTransportV1({ config, fetcher: input.fetcher }),
    binding: { requirementKey: input.requirement.requirementKey, adapterId, bindingHash: capabilityHash },
    receipt,
  }
}

export function configuredAuthoredImagePackUrlV1(): string | null {
  const value = import.meta.env.VITE_STORYFORGE_AUTHORED_IMAGE_PACK_URL?.trim()
  if (!value) return null
  const base = import.meta.env.BASE_URL?.trim() || '/'
  if (value.startsWith('/prototypes/') && base !== '/') {
    return `${base.replace(/\/$/, '')}${value}`
  }
  return value
}

export function inspectAuthoredImagePackConfigurationV1(input: {
  manifestUrl?: string | null
  environment?: 'test' | 'development' | 'production'
  pageOrigin?: string
} = {}): AuthoredImagePackReadinessV1 {
  const manifestUrl = input.manifestUrl === undefined ? configuredAuthoredImagePackUrlV1() : input.manifestUrl
  if (!manifestUrl) return {
    configured: false, ready: false, manifestPath: null,
    issue: '当前部署未绑定作者媒资包。',
  }
  try {
    const environment = input.environment
      ?? (import.meta.env.PROD ? 'production' : import.meta.env.MODE === 'test' ? 'test' : 'development')
    const url = authoredPackManifestUrl({ manifestUrl, environment, pageOrigin: input.pageOrigin })
    return { configured: true, ready: true, manifestPath: url.pathname, issue: null }
  } catch (cause) {
    return {
      configured: true, ready: false, manifestPath: null,
      issue: cause instanceof Error ? cause.message : '作者媒资包配置无效。',
    }
  }
}

export function createAuthoredImagePackTransportV1(input: {
  manifestUrl: URL
  manifest: AuthoredImagePackManifestV1
  fetcher?: Fetcher
}): MediaProviderTransportV1 {
  const fetcher = input.fetcher ?? DEFAULT_FETCHER
  const manifestDirectory = new URL('.', input.manifestUrl)
  const assets = new Map(input.manifest.assets.map(asset => [asset.artifactKey, asset]))
  return {
    executionLocation: 'browser-direct',
    async request(request: RedactedMediaTransportRequestV1, signal: AbortSignal) {
      if (request.adapterId !== 'storyforge.authored-image-pack.v1'
        || !SAFE_ID.test(request.requestId)
        || request.method !== 'POST'
        || request.endpoint !== '/v1/storyforge/authored-image-pack/read'
        || request.allowedDataClasses.some(item => !SAFE_ID.test(item))) {
        fail('作者媒资包请求不符合已登记能力合同')
      }
      const body = record(request.body, '作者媒资包请求')
      exactKeys(body, ['artifactKey', 'mediaKind'], '作者媒资包请求')
      if (!SAFE_ID.test(String(body.artifactKey ?? ''))) fail('作者媒资包 artifactKey 无效')
      const asset = assets.get(String(body.artifactKey))
      if (!asset) fail(`作者媒资包缺少 Artifact:${String(body.artifactKey)}`)
      if (body.mediaKind !== asset.mediaKind) fail(`作者媒资包 mediaKind 不匹配:${asset.artifactKey}`)
      const assetUrl = new URL(asset.fileName, manifestDirectory)
      if (assetUrl.origin !== input.manifestUrl.origin
        || !assetUrl.pathname.startsWith(manifestDirectory.pathname)
        || assetUrl.pathname.includes('/../')) {
        fail(`作者媒资包资产路径越界:${asset.artifactKey}`)
      }
      const response = await fetcher(assetUrl, {
        method: 'GET', credentials: 'omit', mode: 'same-origin', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal,
      })
      if (!response.ok) fail(`作者媒资包资产读取失败:${asset.artifactKey}/${response.status}`)
      const declared = response.headers.get('content-length')
      if (declared != null && (!Number.isInteger(Number(declared)) || Number(declared) !== asset.byteSize)) {
        fail(`作者媒资包资产大小声明不一致:${asset.artifactKey}`)
      }
      const data = await response.arrayBuffer()
      if (data.byteLength !== asset.byteSize) fail(`作者媒资包资产大小不一致:${asset.artifactKey}`)
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: data,
        json: {
          packId: input.manifest.packId,
          packVersion: input.manifest.version,
          artifactKey: asset.artifactKey,
          fileName: asset.fileName,
          declaredContentHash: asset.contentHash,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          title: asset.title,
          altText: asset.altText,
          license: asset.license,
          commercialUse: asset.commercialUse,
          source: asset.source,
        },
        providerRequestId: null,
        usage: null,
        costUsd: null,
      }
    },
  }
}

export async function resolveAuthoredImagePackCapabilityV1(input: {
  requirement: ProviderCapabilityRequirementV1
  manifestUrl?: string | null
  environment?: 'test' | 'development' | 'production'
  pageOrigin?: string
  fetcher?: Fetcher
  now?: number
}): Promise<ResolvedProductMediaCapabilityV1> {
  if (input.requirement.mediaClass !== 'image') fail('作者媒资包只能绑定 image requirement')
  const manifestUrl = input.manifestUrl ?? configuredAuthoredImagePackUrlV1()
  if (!manifestUrl) fail('当前部署未绑定作者媒资包')
  const environment = input.environment
    ?? (import.meta.env.PROD ? 'production' : import.meta.env.MODE === 'test' ? 'test' : 'development')
  const url = authoredPackManifestUrl({ manifestUrl, environment, pageOrigin: input.pageOrigin })
  const fetcher = input.fetcher ?? DEFAULT_FETCHER
  const manifest = await readAuthoredImagePackManifestV1({ url, fetcher })
  const adapterId = 'storyforge.authored-image-pack.v1' as const
  const adapter = resolveProductMediaProviderAdapterV1(adapterId)
  if (!adapter.capability.mediaClasses.includes('image') || adapter.capability.commercialEligible) {
    fail('作者媒资包 adapter capability 无效')
  }
  const manifestContentHash = await hashProductProductionValueV2(manifest)
  const identity = {
    schema: 'storyforge.authored-image-pack-capability' as const,
    version: 1 as const,
    requirementKey: input.requirement.requirementKey,
    adapterId,
    adapterVersion: 1 as const,
    packId: manifest.packId,
    manifestPath: url.pathname,
    manifestContentHash,
    executionLocation: 'browser-direct' as const,
    credentialSource: 'none' as const,
  }
  const capabilityHash = await hashProductProductionValueV2(identity)
  const body = {
    schema: 'storyforge.authored-image-pack-binding-receipt' as const,
    version: 1 as const,
    requirementKey: input.requirement.requirementKey,
    adapterId,
    adapterVersion: 1 as const,
    packId: manifest.packId,
    manifestPath: url.pathname,
    manifestContentHash,
    executionLocation: 'browser-direct' as const,
    credentialSource: 'none' as const,
    capabilityHash,
    boundAt: input.now ?? Date.now(),
  }
  const receipt: AuthoredImagePackBindingReceiptV1 = {
    ...body,
    receiptHash: await hashProductProductionValueV2(body),
  }
  return {
    adapter,
    transport: createAuthoredImagePackTransportV1({ manifestUrl: url, manifest, fetcher }),
    binding: { requirementKey: input.requirement.requirementKey, adapterId, bindingHash: capabilityHash },
    receipt,
  }
}

function relayEndpoint(value: string, environment: 'test' | 'development' | 'production'): URL {
  let base: URL
  try { base = new URL(value) } catch { fail('Relay URL 无效') }
  if (base.username || base.password || base.search || base.hash) fail('Relay URL 不能包含凭据、查询或片段')
  const loopback = base.hostname === '127.0.0.1' || base.hostname === 'localhost' || base.hostname === '::1'
  if (base.protocol !== 'https:' && !(environment !== 'production' && base.protocol === 'http:' && loopback)) {
    fail('生产 Relay 必须使用 HTTPS；开发 HTTP 仅允许 loopback')
  }
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/v1/storyforge/game-media/execute`
  return base
}

function boundedContentLength(response: Response): void {
  const raw = response.headers.get('content-length')
  if (raw == null) return
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > MAX_RELAY_RESPONSE_BYTES) fail('Relay 响应大小声明无效')
}

function providerRequestId(response: Response): string | null {
  const value = response.headers.get('x-storyforge-provider-request-id')
  if (value == null || value === '') return null
  if (!SAFE_ID.test(value)) fail('Relay provider request id 无效')
  return value
}

function providerCost(response: Response): number | null {
  const raw = response.headers.get('x-storyforge-provider-cost-usd')
  if (raw == null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) fail('Relay provider cost 无效')
  return value
}

function providerUsage(response: Response): unknown {
  const raw = response.headers.get('x-storyforge-provider-usage-b64')
  if (raw == null || raw === '') return null
  if (raw.length > MAX_USAGE_HEADER_BYTES * 2 || !/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) fail('Relay usage header 无效')
  let binary: string
  try { binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/')) } catch { fail('Relay usage header 无法解码') }
  if (binary.length > MAX_USAGE_HEADER_BYTES) fail('Relay usage header 过大')
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { fail('Relay usage header 不是合法 JSON') }
}

async function readRelayResponse(response: Response): Promise<Pick<MediaTransportResponseV1, 'body' | 'json'>> {
  boundedContentLength(response)
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_RELAY_RESPONSE_BYTES) fail('Relay JSON 响应过大')
    try { return { body: null, json: text ? JSON.parse(text) : null } } catch { fail('Relay JSON 响应损坏') }
  }
  const body = await response.arrayBuffer()
  if (body.byteLength > MAX_RELAY_RESPONSE_BYTES) fail('Relay 二进制响应过大')
  return { body, json: null }
}

export function createTrustedRelayMediaTransportV1(input: {
  relayUrl: string
  environment: 'test' | 'development' | 'production'
  fetcher?: Fetcher
}): MediaProviderTransportV1 {
  const endpoint = relayEndpoint(input.relayUrl, input.environment)
  const fetcher = input.fetcher ?? DEFAULT_FETCHER
  return {
    executionLocation: 'trusted-relay',
    async request(request: RedactedMediaTransportRequestV1, signal: AbortSignal) {
      if (!SAFE_ID.test(request.adapterId) || !SAFE_ID.test(request.requestId)
        || request.method !== 'POST' || !request.endpoint.startsWith('/')
        || request.allowedDataClasses.some(item => !SAFE_ID.test(item))) fail('Relay 请求不符合去敏合同')
      const envelope = {
        schema: 'storyforge.media-relay-request', version: 1,
        adapterId: request.adapterId, requestId: request.requestId,
        upstream: { method: request.method, endpoint: request.endpoint, body: request.body },
        allowedDataClasses: [...request.allowedDataClasses],
      }
      const serialized = JSON.stringify(envelope)
      if (/api[-_]?key|authorization|bearer\s|sk-[A-Za-z0-9]/i.test(serialized)) fail('Relay 请求含疑似凭据')
      const response = await fetcher(endpoint, {
        method: 'POST', credentials: 'include', mode: 'cors', signal,
        headers: {
          'content-type': 'application/json',
          'x-storyforge-relay-contract': '1',
          'x-storyforge-idempotency-key': request.requestId,
        },
        body: serialized,
      })
      const parsed = await readRelayResponse(response)
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        ...parsed,
        providerRequestId: providerRequestId(response),
        usage: providerUsage(response),
        costUsd: providerCost(response),
      }
    },
  }
}

function adapterIdFor(requirement: ProviderCapabilityRequirementV1): string {
  if (requirement.mediaClass === 'image') return 'openai.gpt-image-2.v1'
  if (requirement.mediaClass === 'music') return 'elevenlabs.music.v2'
  if (requirement.mediaClass === 'sfx') return 'elevenlabs.sound-effects.v2'
  fail(`Relay 不支持 capability mediaClass:${requirement.mediaClass}`)
}

export function configuredMediaRelayUrlV1(): string | null {
  const value = import.meta.env.VITE_STORYFORGE_MEDIA_RELAY_URL?.trim()
  return value || null
}

/**
 * Safe deployment preflight. It validates only the non-secret relay location;
 * provider credentials remain on the relay and are never returned to the UI.
 */
export function inspectTrustedRelayMediaConfigurationV1(input: {
  relayUrl?: string | null
  environment?: 'test' | 'development' | 'production'
} = {}): MediaRelayConfigurationReadinessV1 {
  const relayUrl = input.relayUrl === undefined ? configuredMediaRelayUrlV1() : input.relayUrl
  if (!relayUrl) return {
    configured: false,
    ready: false,
    relayOrigin: null,
    issue: '外部媒体可信中继尚未由部署方配置。',
  }
  try {
    const environment = input.environment
      ?? (import.meta.env.PROD ? 'production' : import.meta.env.MODE === 'test' ? 'test' : 'development')
    const endpoint = relayEndpoint(relayUrl, environment)
    return { configured: true, ready: true, relayOrigin: endpoint.origin, issue: null }
  } catch (cause) {
    return {
      configured: true,
      ready: false,
      relayOrigin: null,
      issue: cause instanceof Error ? cause.message : '外部媒体可信中继配置无效。',
    }
  }
}

export async function resolveTrustedRelayMediaCapabilityV1(input: {
  requirement: ProviderCapabilityRequirementV1
  relayUrl?: string | null
  environment?: 'test' | 'development' | 'production'
  fetcher?: Fetcher
  now?: number
}): Promise<ResolvedProductMediaCapabilityV1> {
  const relayUrl = input.relayUrl ?? configuredMediaRelayUrlV1()
  if (!relayUrl) fail('未配置可信媒资 Relay；生产页不会要求重复填写 provider Key')
  const environment = input.environment ?? (import.meta.env.PROD ? 'production' : import.meta.env.MODE === 'test' ? 'test' : 'development')
  const adapterId = adapterIdFor(input.requirement)
  const adapter = resolveProductMediaProviderAdapterV1(adapterId)
  if (!adapter.capability.commercialEligible || !adapter.capability.mediaClasses.includes(input.requirement.mediaClass as never)) {
    fail('adapter capability 与 Brief requirement 不一致')
  }
  const endpoint = relayEndpoint(relayUrl, environment)
  const identity = {
    schema: 'storyforge.media-relay-capability' as const, version: 1 as const,
    requirementKey: input.requirement.requirementKey, adapterId, adapterVersion: 1 as const,
    relayOrigin: endpoint.origin, executionLocation: 'trusted-relay' as const,
    credentialSource: 'relay-session' as const,
  }
  const capabilityHash = await hashProductProductionValueV2(identity)
  const body = {
    schema: 'storyforge.media-relay-binding-receipt' as const, version: 1 as const,
    requirementKey: input.requirement.requirementKey, adapterId, adapterVersion: 1 as const,
    relayOrigin: endpoint.origin, executionLocation: 'trusted-relay' as const,
    credentialSource: 'relay-session' as const, capabilityHash,
    boundAt: input.now ?? Date.now(),
  }
  const receipt: MediaRelayBindingReceiptV1 = {
    ...body, receiptHash: await hashProductProductionValueV2(body),
  }
  return {
    adapter,
    transport: createTrustedRelayMediaTransportV1({ relayUrl, environment, fetcher: input.fetcher }),
    binding: { requirementKey: input.requirement.requirementKey, adapterId, bindingHash: capabilityHash },
    receipt,
  }
}
