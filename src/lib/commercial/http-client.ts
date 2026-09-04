import {
  verifyProductDistributionBundleV2,
  type ProductDistributionBundleV2,
  type MarketplaceImportProvenanceV2,
} from '../product-platform/distribution-bundle'
import type {
  CommercialEntitlementV1,
  CommercialLicenseV1,
  CommercialListingV1,
  CommercialOrderV1,
} from './authority'
import type { CommercialCheckoutSessionV1 } from './gateway'
import { PRODUCTION_PRODUCT_KINDS_V1, type ProductionProductKindV1 } from '../types'

interface FetchResponseV1 {
  ok: boolean
  status: number
  text(): Promise<string>
}

type FetchV1 = (input: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}) => Promise<FetchResponseV1>

export class CommercialHttpErrorV1 extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly status: number | null = null,
  ) {
    super(`[commercial-http:${code}] ${message}`)
    this.name = 'CommercialHttpErrorV1'
  }
}

function fail(code: string, message: string, retryable = false, status: number | null = null): never {
  throw new CommercialHttpErrorV1(code, message, retryable, status)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('protocol', `${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, expected: string[], label: string): void {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) {
    fail('protocol', `${label} 字段不符合协议`)
  }
}

function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('protocol', `${label} 无效`)
  return value
}

function nullableText(value: unknown, label: string, maximum = 500): string | null {
  return value == null ? null : text(value, label, maximum)
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) fail('protocol', `${label} 无效`)
  return Number(value)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail('protocol', `${label} 无效`)
  return value
}

function sha(value: unknown, label: string): string {
  const result = text(value, label, 64)
  if (!/^[0-9a-f]{64}$/.test(result)) fail('protocol', `${label} 不是 sha256`)
  return result
}

function parseLicense(value: unknown): CommercialLicenseV1 {
  const row = record(value, 'license')
  exact(row, [
    'licenseId', 'licenseVersion', 'allowOfflineExport', 'allowRemix', 'commercialReuse',
    'requiresAttribution', 'termsUrl',
  ], 'license')
  const termsUrl = text(row.termsUrl, 'license.termsUrl')
  try {
    if (new URL(termsUrl).protocol !== 'https:') fail('protocol', 'license.termsUrl 必须使用 HTTPS')
  } catch { fail('protocol', 'license.termsUrl 无效') }
  return {
    licenseId: text(row.licenseId, 'license.licenseId', 200),
    licenseVersion: text(row.licenseVersion, 'license.licenseVersion', 200),
    allowOfflineExport: boolean(row.allowOfflineExport, 'license.allowOfflineExport'),
    allowRemix: boolean(row.allowRemix, 'license.allowRemix'),
    commercialReuse: boolean(row.commercialReuse, 'license.commercialReuse'),
    requiresAttribution: boolean(row.requiresAttribution, 'license.requiresAttribution'),
    termsUrl,
  }
}

function parseListing(value: unknown): CommercialListingV1 {
  const row = record(value, 'listing')
  exact(row, [
    'listingId', 'releaseHash', 'creatorId', 'productType', 'title', 'summary', 'contentWarnings',
    'license', 'currency', 'amountMinor', 'creatorShareBps', 'status', 'rightsConfirmed', 'reviewedBy',
    'reviewReasonCode', 'createdAt', 'updatedAt',
  ], 'listing')
  const products: readonly ProductionProductKindV1[] = PRODUCTION_PRODUCT_KINDS_V1
  if (!products.includes(row.productType as ProductionProductKindV1) || !['draft', 'submitted', 'changes-requested', 'published', 'suspended', 'withdrawn'].includes(String(row.status))
    || !Array.isArray(row.contentWarnings) || row.contentWarnings.some(item => typeof item !== 'string')) {
    fail('protocol', 'listing 枚举或警告字段无效')
  }
  return {
    listingId: text(row.listingId, 'listing.listingId', 200), releaseHash: sha(row.releaseHash, 'listing.releaseHash'),
    creatorId: text(row.creatorId, 'listing.creatorId', 200), productType: row.productType as ProductionProductKindV1,
    title: text(row.title, 'listing.title'), summary: text(row.summary, 'listing.summary', 4_000),
    contentWarnings: [...row.contentWarnings] as string[], license: parseLicense(row.license),
    currency: text(row.currency, 'listing.currency', 3), amountMinor: integer(row.amountMinor, 'listing.amountMinor'),
    creatorShareBps: integer(row.creatorShareBps, 'listing.creatorShareBps'),
    status: row.status as CommercialListingV1['status'], rightsConfirmed: boolean(row.rightsConfirmed, 'listing.rightsConfirmed'),
    reviewedBy: nullableText(row.reviewedBy, 'listing.reviewedBy', 200),
    reviewReasonCode: nullableText(row.reviewReasonCode, 'listing.reviewReasonCode', 200),
    createdAt: integer(row.createdAt, 'listing.createdAt'), updatedAt: integer(row.updatedAt, 'listing.updatedAt'),
  }
}

function parseOrder(value: unknown): CommercialOrderV1 {
  const row = record(value, 'order')
  exact(row, [
    'orderId', 'listingId', 'releaseHash', 'buyerId', 'creatorId', 'currency', 'amountMinor',
    'creatorShareMinor', 'platformShareMinor', 'status', 'providerReference', 'createdAt', 'updatedAt',
  ], 'order')
  if (!['pending', 'paid', 'failed', 'refunded', 'disputed'].includes(String(row.status))) fail('protocol', 'order.status 无效')
  return {
    orderId: text(row.orderId, 'order.orderId', 200), listingId: text(row.listingId, 'order.listingId', 200),
    releaseHash: sha(row.releaseHash, 'order.releaseHash'), buyerId: text(row.buyerId, 'order.buyerId', 200),
    creatorId: text(row.creatorId, 'order.creatorId', 200), currency: text(row.currency, 'order.currency', 3),
    amountMinor: integer(row.amountMinor, 'order.amountMinor'),
    creatorShareMinor: integer(row.creatorShareMinor, 'order.creatorShareMinor'),
    platformShareMinor: integer(row.platformShareMinor, 'order.platformShareMinor'),
    status: row.status as CommercialOrderV1['status'],
    providerReference: nullableText(row.providerReference, 'order.providerReference'),
    createdAt: integer(row.createdAt, 'order.createdAt'), updatedAt: integer(row.updatedAt, 'order.updatedAt'),
  }
}

function parseEntitlement(value: unknown): CommercialEntitlementV1 | null {
  if (value == null) return null
  const row = record(value, 'entitlement')
  exact(row, [
    'entitlementId', 'orderId', 'listingId', 'releaseHash', 'buyerId', 'license', 'status',
    'hostedAccess', 'localCopyPreserved', 'acquiredAt', 'updatedAt',
  ], 'entitlement')
  if (!['active', 'refunded', 'disputed', 'moderation-hold'].includes(String(row.status))) {
    fail('protocol', 'entitlement.status 无效')
  }
  return {
    entitlementId: text(row.entitlementId, 'entitlement.entitlementId', 200),
    orderId: text(row.orderId, 'entitlement.orderId', 200), listingId: text(row.listingId, 'entitlement.listingId', 200),
    releaseHash: sha(row.releaseHash, 'entitlement.releaseHash'), buyerId: text(row.buyerId, 'entitlement.buyerId', 200),
    license: parseLicense(row.license), status: row.status as CommercialEntitlementV1['status'],
    hostedAccess: boolean(row.hostedAccess, 'entitlement.hostedAccess'),
    localCopyPreserved: boolean(row.localCopyPreserved, 'entitlement.localCopyPreserved'),
    acquiredAt: integer(row.acquiredAt, 'entitlement.acquiredAt'), updatedAt: integer(row.updatedAt, 'entitlement.updatedAt'),
  }
}

function parseCheckout(value: unknown): CommercialCheckoutSessionV1 | null {
  if (value == null) return null
  const row = record(value, 'checkout')
  exact(row, ['checkoutSessionId', 'orderId', 'checkoutUrl', 'expiresAt'], 'checkout')
  const checkoutUrl = text(row.checkoutUrl, 'checkout.checkoutUrl')
  try { if (new URL(checkoutUrl).protocol !== 'https:') fail('protocol', 'checkout URL 必须使用 HTTPS') } catch {
    fail('protocol', 'checkout URL 无效')
  }
  return {
    checkoutSessionId: text(row.checkoutSessionId, 'checkout.checkoutSessionId', 200),
    orderId: text(row.orderId, 'checkout.orderId', 200), checkoutUrl,
    expiresAt: integer(row.expiresAt, 'checkout.expiresAt'),
  }
}

function normalizedBaseUrl(value: string): string {
  const raw = value.trim().replace(/\/+$/, '')
  let url: URL
  try { url = new URL(raw) } catch { fail('configuration', '市场服务地址无效') }
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    fail('configuration', '市场服务必须使用 HTTPS（本机开发地址除外）')
  }
  return raw
}

export class CommercialHttpClientV1 {
  private readonly baseUrl: string
  private readonly fetchImpl: FetchV1
  private readonly timeoutMs: number

  constructor(input: { baseUrl: string; fetch?: FetchV1; timeoutMs?: number }) {
    this.baseUrl = normalizedBaseUrl(input.baseUrl)
    this.fetchImpl = input.fetch ?? (globalThis.fetch as unknown as FetchV1)
    this.timeoutMs = input.timeoutMs ?? 30_000
    if (typeof this.fetchImpl !== 'function' || !Number.isInteger(this.timeoutMs)
      || this.timeoutMs < 100 || this.timeoutMs > 300_000) fail('configuration', '市场 HTTP 配置无效')
  }

  async discover(input: { productType?: ProductionProductKindV1; query?: string } = {}): Promise<CommercialListingV1[]> {
    const value = await this.post('/v1/commercial/discover', input, null, 2_000_000)
    if (!Array.isArray(value) || value.length > 10_000) fail('protocol', 'discover 响应无效')
    return value.map(parseListing)
  }

  async createListing(input: {
    accessToken: string
    requestId: string
    releaseHash: string
    productType: ProductionProductKindV1
    title: string
    summary: string
    contentWarnings: string[]
    license: CommercialLicenseV1
    currency: string
    amountMinor: number
    creatorShareBps: number
  }): Promise<CommercialListingV1> {
    const { accessToken, ...body } = input
    return parseListing(await this.post('/v1/commercial/listings', body, accessToken))
  }

  async myListings(accessToken: string): Promise<CommercialListingV1[]> {
    const value = await this.post('/v1/commercial/listings/mine', {}, accessToken)
    if (!Array.isArray(value) || value.length > 100_000) fail('protocol', 'my listings 响应无效')
    return value.map(parseListing)
  }

  async reviewQueue(accessToken: string): Promise<CommercialListingV1[]> {
    const value = await this.post('/v1/commercial/listings/review-queue', {}, accessToken)
    if (!Array.isArray(value) || value.length > 100_000) fail('protocol', 'review queue 响应无效')
    return value.map(parseListing)
  }

  async publishListing(input: {
    accessToken: string
    requestId: string
    listingId: string
  }): Promise<CommercialListingV1> {
    const { accessToken, ...body } = input
    return parseListing(await this.post('/v1/commercial/listings/publish', {
      ...body, rightsConfirmed: true,
    }, accessToken))
  }

  async requestListingChanges(input: {
    accessToken: string; requestId: string; listingId: string; reasonCode: string
  }): Promise<CommercialListingV1> {
    const { accessToken, ...body } = input
    return parseListing(await this.post('/v1/commercial/listings/request-changes', body, accessToken))
  }

  async reviseListing(input: {
    accessToken: string
    requestId: string
    listingId: string
    releaseHash: string
    title: string
    summary: string
    contentWarnings: string[]
    license: CommercialLicenseV1
    currency: string
    amountMinor: number
    creatorShareBps: number
  }): Promise<CommercialListingV1> {
    const { accessToken, ...body } = input
    return parseListing(await this.post('/v1/commercial/listings/revise', body, accessToken))
  }

  async submitListing(input: {
    accessToken: string
    requestId: string
    listingId: string
  }): Promise<CommercialListingV1> {
    const { accessToken, ...body } = input
    return parseListing(await this.post('/v1/commercial/listings/submit', {
      ...body, rightsConfirmed: true,
    }, accessToken))
  }

  async suspendListing(input: {
    accessToken: string; requestId: string; listingId: string; reasonCode: string
  }): Promise<CommercialListingV1> {
    const { accessToken, ...body } = input
    return parseListing(await this.post('/v1/commercial/listings/suspend', body, accessToken))
  }

  async withdrawListing(input: {
    accessToken: string; requestId: string; listingId: string
  }): Promise<CommercialListingV1> {
    const { accessToken, ...body } = input
    return parseListing(await this.post('/v1/commercial/listings/withdraw', body, accessToken))
  }

  async acquire(input: { accessToken: string; requestId: string; listingId: string }): Promise<{
    order: CommercialOrderV1
    entitlement: CommercialEntitlementV1 | null
    checkout: CommercialCheckoutSessionV1 | null
  }> {
    const { accessToken, ...body } = input
    const row = record(await this.post('/v1/commercial/acquisitions', body, accessToken), 'acquisition')
    exact(row, ['order', 'entitlement', 'checkout'], 'acquisition')
    const order = parseOrder(row.order)
    const entitlement = parseEntitlement(row.entitlement)
    const checkout = parseCheckout(row.checkout)
    if ((order.status === 'pending') !== Boolean(checkout)
      || (checkout && checkout.orderId !== order.orderId)
      || (entitlement && entitlement.orderId !== order.orderId)) fail('protocol', 'acquisition 回执不闭合')
    return { order, entitlement, checkout }
  }

  async registerRelease(input: {
    accessToken: string
    requestId: string
    bundle: ProductDistributionBundleV2
  }): Promise<{ releaseHash: string; bundleHash: string; duplicate: boolean }> {
    const bundle = await verifyProductDistributionBundleV2(input.bundle)
    const row = record(await this.post('/v1/commercial/releases/register', {
      requestId: input.requestId, bundle,
    }, input.accessToken, 2_000_000), 'release registration')
    exact(row, ['releaseHash', 'bundleHash', 'duplicate'], 'release registration')
    const result = {
      releaseHash: sha(row.releaseHash, 'release registration.releaseHash'),
      bundleHash: sha(row.bundleHash, 'release registration.bundleHash'),
      duplicate: boolean(row.duplicate, 'release registration.duplicate'),
    }
    if (result.releaseHash !== bundle.productRelease.contentHash || result.bundleHash !== bundle.bundleHash) {
      fail('protocol', 'release registration 回执与上传包不一致')
    }
    return result
  }

  async downloadRelease(input: { accessToken: string; releaseHash: string }): Promise<{
    bundle: ProductDistributionBundleV2
    provenance: MarketplaceImportProvenanceV2
  }> {
    const row = record(await this.post('/v1/commercial/releases/download', {
      releaseHash: input.releaseHash,
    }, input.accessToken, 380 * 1024 * 1024), 'release download')
    exact(row, ['authorization', 'bundle'], 'release download')
    const authorization = record(row.authorization, 'release authorization')
    exact(authorization, [
      'releaseHash', 'listingId', 'orderId', 'entitlementId', 'license', 'attribution',
      'localCopyPreserved', 'acquiredAt',
    ], 'release authorization')
    if (!Array.isArray(authorization.attribution) || authorization.attribution.some(item => typeof item !== 'string')) {
      fail('protocol', 'release authorization.attribution 无效')
    }
    const bundle = await verifyProductDistributionBundleV2(row.bundle)
    if (sha(authorization.releaseHash, 'release authorization.releaseHash') !== bundle.productRelease.contentHash) {
      fail('protocol', '下载授权与发行物哈希不一致')
    }
    return {
      bundle,
      provenance: {
        listingId: text(authorization.listingId, 'release authorization.listingId', 200),
        orderId: nullableText(authorization.orderId, 'release authorization.orderId', 200),
        entitlementId: nullableText(authorization.entitlementId, 'release authorization.entitlementId', 200),
        license: parseLicense(authorization.license),
        attribution: [...authorization.attribution] as string[],
        localCopyPreserved: boolean(authorization.localCopyPreserved, 'release authorization.localCopyPreserved'),
        acquiredAt: integer(authorization.acquiredAt, 'release authorization.acquiredAt'),
      },
    }
  }

  private async post(path: string, body: unknown, accessToken: string | null, maximumResponseBytes = 2_000_000) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
      if (accessToken) headers.authorization = `Bearer ${accessToken}`
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      })
      const raw = await response.text()
      if (new TextEncoder().encode(raw).byteLength > maximumResponseBytes) fail('response_too_large', '市场响应超过客户端上限')
      let value: unknown
      try { value = JSON.parse(raw) } catch { fail('protocol', '市场响应不是合法 JSON') }
      if (!response.ok) {
        const error = record(value, 'error response')
        const code = typeof error.code === 'string' ? error.code : 'request_failed'
        const message = typeof error.message === 'string' ? error.message : '市场请求失败'
        fail(code, message, response.status === 408 || response.status === 429 || response.status >= 500, response.status)
      }
      return value
    } catch (error) {
      if (error instanceof CommercialHttpErrorV1) throw error
      if (controller.signal.aborted) fail('timeout', '市场请求超时', true)
      fail('network', '无法连接市场服务', true)
    } finally {
      clearTimeout(timeout)
    }
  }
}
