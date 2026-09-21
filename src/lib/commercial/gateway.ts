import {
  CommercialAuthorityErrorV1,
  CommercialPlatformAuthorityV1,
  type CommercialLicenseV1,
  type CommercialOrderV1,
  type CommercialPrincipalV1,
} from './authority'
import { CommercialWebhookErrorV1, verifyCommercialWebhookWithSecretsV1 } from './webhook'
import type { CommercialPaymentEventV1 } from './webhook'
import { PRODUCTION_PRODUCT_KINDS_V1, type ProductionProductKindV1 } from '../types'
import {
  encodeCommercialDiscoveryCursorV1,
  isCommercialListingAfterCursorV1,
  parseCommercialDiscoveryCursorV1,
} from './discovery-cursor'

export interface CommercialGatewayRequestV1 {
  method: string
  path: string
  contentType: string
  headers: Record<string, string | undefined>
  body: unknown
  /** Exact provider bytes, required only for the payment webhook route. */
  rawBody?: string
}

export interface CommercialGatewayResponseV1 {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface CommercialIdentityV1 {
  authenticate(accessToken: string): Promise<CommercialPrincipalV1 | null>
}

export interface CommercialGatewayAuditV1 {
  path: string
  userId: string | null
  requestId: string | null
  eventId: string | null
  outcome: 'accepted' | 'rejected'
  code: string
  status: number
  latencyMs: number
}

export interface CommercialReleaseReadinessV1 {
  hasVerifiedRelease(input: {
    releaseHash: string
    creatorId: string
    listingId?: string
    productType?: ProductionProductKindV1
    verification?: 'full' | 'attestation'
    /** Discovery callers always supply a deadline-bound signal. Adapters must abort external I/O. */
    signal?: AbortSignal
  }): Promise<boolean>
}

export interface CommercialCheckoutSessionV1 {
  checkoutSessionId: string
  orderId: string
  checkoutUrl: string
  expiresAt: number
}

export interface CommercialCheckoutProviderV1 {
  /** Must return the same live session for repeated calls with one orderId. */
  createOrResumeSession(order: CommercialOrderV1): Promise<CommercialCheckoutSessionV1>
}

export interface CommercialPaymentSettlementV1 {
  prepare(input: { order: CommercialOrderV1; buyer: CommercialPrincipalV1 }): Promise<void>
  record(input: {
    event: CommercialPaymentEventV1
    order: CommercialOrderV1
    duplicate: boolean
  }): Promise<void>
}

export interface CommercialWebhookVerificationKeyV1 {
  keyId: string
  role: 'current' | 'previous'
  secret: string
  activeFrom: number
  expiresAt: number | null
}

export interface CommercialWebhookSecretProviderV1 {
  /** Returns the current key and, during a bounded rotation overlap, one previous key. */
  resolveVerificationKeys(input: { now: number }): Promise<CommercialWebhookVerificationKeyV1[]>
}

function checkoutSession(value: CommercialCheckoutSessionV1, orderId: string, now: number): CommercialCheckoutSessionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 4
    || Object.keys(value).some(key => !['checkoutSessionId', 'orderId', 'checkoutUrl', 'expiresAt'].includes(key))
    || value.orderId !== orderId
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.checkoutSessionId)
    || !Number.isInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 24 * 60 * 60 * 1_000) {
    throw new CommercialAuthorityErrorV1('checkout_invalid', '支付提供方返回了无效会话')
  }
  let url: URL
  try { url = new URL(value.checkoutUrl) } catch {
    throw new CommercialAuthorityErrorV1('checkout_invalid', '支付跳转 URL 无效')
  }
  if (url.protocol !== 'https:' || url.username || url.password || value.checkoutUrl.length > 2_000) {
    throw new CommercialAuthorityErrorV1('checkout_invalid', '支付跳转必须使用无凭据 HTTPS URL')
  }
  return structuredClone(value)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommercialAuthorityErrorV1('protocol', '请求体必须是对象')
  }
  return value as Record<string, unknown>
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional])
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => !allowed.has(key))) {
    throw new CommercialAuthorityErrorV1('protocol', '请求字段不符合协议')
  }
}

function header(headers: Record<string, string | undefined>, name: string): string | null {
  return Object.entries(headers).find(([candidate]) => candidate.toLocaleLowerCase() === name)?.[1] ?? null
}

async function authenticate(identity: CommercialIdentityV1, request: CommercialGatewayRequestV1): Promise<CommercialPrincipalV1> {
  const match = header(request.headers, 'authorization')?.match(/^Bearer ([^\s]{16,2000})$/)
  if (!match) throw new CommercialAuthorityErrorV1('unauthorized', '缺少有效 Bearer 凭据')
  const principal = await identity.authenticate(match[1])
  if (!principal) throw new CommercialAuthorityErrorV1('unauthorized', '身份凭据无效或已过期')
  return principal
}

function response(status: number, body: unknown): CommercialGatewayResponseV1 {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
    body,
  }
}

function statusFor(code: string): number {
  if (code === 'unauthorized') return 401
  if (['forbidden', 'self_purchase', 'entitlement_required', 'license_forbidden', 'release_forbidden'].includes(code)) return 403
  if (['listing_not_found', 'order_not_found', 'entitlement_missing'].includes(code)) return 404
  if (['request_conflict', 'event_conflict', 'already_owned', 'payment_pending', 'invalid_transition', 'checkout_invalid',
    'persistence_conflict', 'release_delivery_missing', 'release_conflict', 'release_corrupt', 'candidate_missing'].includes(code)) return 409
  if (code === 'payload_too_large') return 413
  if (['signature', 'stale'].includes(code)) return 401
  if (code === 'configuration') return 503
  if (code === 'protocol') return 422
  return 400
}

async function webhookSecrets(input: {
  provider: CommercialWebhookSecretProviderV1
  now: number
}): Promise<string[]> {
  let keys: CommercialWebhookVerificationKeyV1[]
  try {
    keys = await input.provider.resolveVerificationKeys({ now: input.now })
  } catch (error) {
    if (error instanceof CommercialWebhookErrorV1) throw error
    throw new CommercialWebhookErrorV1('configuration', 'webhook secret manager 暂不可用')
  }
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 2) {
    throw new CommercialWebhookErrorV1('configuration', 'webhook secret manager 必须返回当前密钥及最多一个轮换密钥')
  }
  const allowed = ['keyId', 'role', 'secret', 'activeFrom', 'expiresAt']
  if (keys.some(key => !key || typeof key !== 'object' || Array.isArray(key)
    || Object.keys(key).length !== allowed.length || Object.keys(key).some(name => !allowed.includes(name))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key.keyId)
    || !['current', 'previous'].includes(key.role)
    || typeof key.secret !== 'string' || key.secret.length < 16
    || !Number.isInteger(key.activeFrom) || key.activeFrom < 0 || key.activeFrom > input.now
    || (key.expiresAt != null && (!Number.isInteger(key.expiresAt) || key.expiresAt <= input.now)))) {
    throw new CommercialWebhookErrorV1('configuration', 'webhook secret manager 返回了无效密钥记录')
  }
  if (keys.filter(key => key.role === 'current').length !== 1
    || keys.filter(key => key.role === 'previous').length > 1
    || keys.some(key => key.role === 'previous' && key.expiresAt == null)
    || new Set(keys.map(key => key.keyId)).size !== keys.length
    || new Set(keys.map(key => key.secret)).size !== keys.length) {
    throw new CommercialWebhookErrorV1('configuration', 'webhook 密钥轮换集合无效')
  }
  return [...keys].sort((left, right) => left.role === 'current' ? -1 : right.role === 'current' ? 1 : 0)
    .map(key => key.secret)
}

function createSharedSemaphore(limit: number): {
  acquire(signal: AbortSignal): Promise<(() => void) | null>
} {
  let active = 0
  const queue: Array<{
    signal: AbortSignal
    resolve: (release: (() => void) | null) => void
    abort: () => void
  }> = []
  const releaseToken = () => {
    let released = false
    return () => {
      if (released) return
      released = true
      active -= 1
      while (queue.length > 0) {
        const next = queue.shift()!
        next.signal.removeEventListener('abort', next.abort)
        if (next.signal.aborted) {
          next.resolve(null)
          continue
        }
        active += 1
        next.resolve(releaseToken())
        break
      }
    }
  }
  return {
    acquire(signal) {
      if (signal.aborted) return Promise.resolve(null)
      if (active < limit) {
        active += 1
        return Promise.resolve(releaseToken())
      }
      return new Promise(resolve => {
        const waiter = {
          signal,
          resolve,
          abort: () => {
            const index = queue.indexOf(waiter)
            if (index >= 0) queue.splice(index, 1)
            resolve(null)
          },
        }
        queue.push(waiter)
        signal.addEventListener('abort', waiter.abort, { once: true })
      })
    },
  }
}

/**
 * Framework-neutral commercial API boundary. Deployment adapters own TLS,
 * identity sessions, rate limits and raw-body capture. Neither bearer tokens,
 * webhook signatures nor provider references enter the gateway audit shape.
 */
export function createCommercialGatewayV1(input: {
  authority: CommercialPlatformAuthorityV1
  identity: CommercialIdentityV1
  releaseDelivery: CommercialReleaseReadinessV1
  checkoutProvider: CommercialCheckoutProviderV1
  paymentSettlement?: CommercialPaymentSettlementV1
  /** Development/test fallback. Production composition injects webhookSecrets. */
  webhookSecret?: string
  webhookSecrets?: CommercialWebhookSecretProviderV1
  audit?: (entry: CommercialGatewayAuditV1) => void | Promise<void>
  now?: () => number
  maximumDiscoveryPageSize?: number
  discoveryVerificationConcurrency?: number
  discoveryVerificationTimeoutMs?: number
}) {
  if ((typeof input.webhookSecret === 'string') === Boolean(input.webhookSecrets)) {
    throw new Error('[commercial-gateway:configuration] webhookSecret 与 webhookSecrets 必须且只能配置一个')
  }
  if (typeof input.webhookSecret === 'string' && input.webhookSecret.length < 16) {
    throw new Error('[commercial-gateway:configuration] webhookSecret 长度不足')
  }
  const maximumDiscoveryPageSize = input.maximumDiscoveryPageSize ?? 50
  const discoveryVerificationConcurrency = input.discoveryVerificationConcurrency ?? 4
  const discoveryVerificationTimeoutMs = input.discoveryVerificationTimeoutMs ?? 2_000
  if (!Number.isInteger(maximumDiscoveryPageSize) || maximumDiscoveryPageSize < 1
    || maximumDiscoveryPageSize > 100
    || !Number.isInteger(discoveryVerificationConcurrency) || discoveryVerificationConcurrency < 1
    || discoveryVerificationConcurrency > 16
    || !Number.isInteger(discoveryVerificationTimeoutMs) || discoveryVerificationTimeoutMs < 10
    || discoveryVerificationTimeoutMs > 30_000) {
    throw new Error('[commercial-gateway:configuration] 发现分页或验证并发配置无效')
  }
  const discoveryVerificationSemaphore = createSharedSemaphore(discoveryVerificationConcurrency)
  const verifyDiscoveryCandidate = async (listing: {
    releaseHash: string
    creatorId: string
    listingId: string
    productType: ProductionProductKindV1
  }): Promise<boolean> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), discoveryVerificationTimeoutMs)
    let abortListener: (() => void) | null = null
    try {
      const release = await discoveryVerificationSemaphore.acquire(controller.signal)
      if (!release) return false
      const aborted = new Promise<boolean>(resolve => {
        abortListener = () => resolve(false)
        if (controller.signal.aborted) resolve(false)
        else controller.signal.addEventListener('abort', abortListener, { once: true })
      })
      // Keep the shared permit until the adapter really settles. If an adapter
      // ignores AbortSignal, the public request still fails closed at deadline,
      // while the leaked external I/O cannot make later requests exceed budget.
      const verification = input.releaseDelivery.hasVerifiedRelease({
        releaseHash: listing.releaseHash, creatorId: listing.creatorId,
        listingId: listing.listingId, productType: listing.productType,
        verification: 'attestation', signal: controller.signal,
      }).then(value => value === true, () => false).finally(release)
      return await Promise.race([verification, aborted])
    } finally {
      clearTimeout(timeout)
      if (abortListener) controller.signal.removeEventListener('abort', abortListener)
    }
  }
  const now = input.now ?? (() => Date.now())
  return async (request: CommercialGatewayRequestV1): Promise<CommercialGatewayResponseV1> => {
    const startedAt = now()
    let userId: string | null = null
    let requestId: string | null = null
    let eventId: string | null = null
    let code = 'ok'
    let result = response(500, { code: 'internal_error', message: '商业服务未产生响应' })
    try {
      if (request.method.toUpperCase() !== 'POST') {
        code = 'method_not_allowed'
        result = response(405, { code, message: '只支持 POST' })
      } else if (!/^application\/json(?:\s*;|$)/i.test(request.contentType)) {
        code = 'unsupported_media_type'
        result = response(415, { code, message: '请求必须使用 application/json' })
      } else if (request.path === '/v1/commercial/payment-webhook') {
        if (typeof request.rawBody !== 'string') throw new CommercialWebhookErrorV1('protocol', '支付回调缺少原始请求体')
        const signatureHeader = header(request.headers, 'x-storyforge-signature')
        if (!signatureHeader) throw new CommercialWebhookErrorV1('signature', '支付回调缺少签名')
        const secrets = input.webhookSecrets
          ? await webhookSecrets({ provider: input.webhookSecrets, now: now() })
          : [input.webhookSecret as string]
        const event = await verifyCommercialWebhookWithSecretsV1({
          rawBody: request.rawBody,
          signatureHeader,
          secrets,
          now: now(),
        })
        eventId = event.eventId
        const payment = await input.authority.applyPaymentEvent({ event })
        await input.paymentSettlement?.record({ event, order: payment.order, duplicate: payment.duplicate })
        result = response(200, payment)
      } else {
        const encoded = JSON.stringify(request.body)
        if (encoded === undefined || encoded.length > 96_000) {
          throw new CommercialAuthorityErrorV1('payload_too_large', '请求体超过 96KB')
        }
        const body = record(request.body)
        requestId = typeof body.requestId === 'string' ? body.requestId : null
        if (request.path === '/v1/commercial/discover') {
          fields(body, [], ['productType', 'query', 'cursor', 'limit'])
          const products: readonly ProductionProductKindV1[] = PRODUCTION_PRODUCT_KINDS_V1
          if ((body.productType != null && (typeof body.productType !== 'string' || !products.includes(body.productType as ProductionProductKindV1)))
            || (body.query != null && (typeof body.query !== 'string' || body.query.length > 500))
            || (body.cursor != null && typeof body.cursor !== 'string')
            || (body.limit != null && (!Number.isInteger(body.limit) || Number(body.limit) < 1
              || Number(body.limit) > maximumDiscoveryPageSize))) {
            throw new CommercialAuthorityErrorV1('protocol', '发现筛选字段无效')
          }
          const productType = body.productType as ProductionProductKindV1 | undefined
          const query = body.query as string | undefined
          const cursor = body.cursor == null ? null : parseCommercialDiscoveryCursorV1({
            value: body.cursor, productType, query,
          })
          if (body.cursor != null && !cursor) {
            throw new CommercialAuthorityErrorV1('protocol', '发现分页游标无效或不属于当前筛选')
          }
          const discovered = input.authority.discover({ productType, query })
            .filter(listing => !cursor || isCommercialListingAfterCursorV1(listing, cursor))
          const pageSize = body.limit == null ? maximumDiscoveryPageSize : Number(body.limit)
          const candidates = discovered.slice(0, pageSize)
          const hasMore = discovered.length > candidates.length
          const accepted = new Array<boolean>(candidates.length).fill(false)
          let nextCandidateIndex = 0
          const workers = Array.from({
            length: Math.min(discoveryVerificationConcurrency, candidates.length),
          }, async () => {
            while (true) {
              const index = nextCandidateIndex
              nextCandidateIndex += 1
              const listing = candidates[index]
              if (!listing) return
              accepted[index] = await verifyDiscoveryCandidate(listing)
            }
          })
          await Promise.all(workers)
          result = response(200, candidates.filter((_listing, index) => accepted[index]))
          const lastCandidate = candidates[candidates.length - 1]
          if (hasMore && lastCandidate) {
            result.headers['x-storyforge-next-cursor'] = encodeCommercialDiscoveryCursorV1({
              productType, query, updatedAt: lastCandidate.updatedAt, listingId: lastCandidate.listingId,
            })
          }
        } else {
          const principal = await authenticate(input.identity, request)
          userId = principal.userId
          if (request.path === '/v1/commercial/listings') {
            fields(body, [
              'requestId', 'releaseHash', 'productType', 'title', 'summary', 'contentWarnings',
              'license', 'currency', 'amountMinor', 'creatorShareBps',
            ])
            result = response(201, await input.authority.createListing({
              principal, requestId: body.requestId as string, releaseHash: body.releaseHash as string,
              productType: body.productType as ProductionProductKindV1, title: body.title as string,
              summary: body.summary as string, contentWarnings: body.contentWarnings as string[],
              license: body.license as CommercialLicenseV1, currency: body.currency as string,
              amountMinor: body.amountMinor as number, creatorShareBps: body.creatorShareBps as number,
            }))
          } else if (request.path === '/v1/commercial/listings/mine') {
            fields(body, [])
            result = response(200, input.authority.listingsForCreator({ principal }))
          } else if (request.path === '/v1/commercial/listings/review-queue') {
            fields(body, [])
            result = response(200, input.authority.listingReviewQueue({ principal }))
          } else if (request.path === '/v1/commercial/listings/submit') {
            fields(body, ['requestId', 'listingId', 'rightsConfirmed'])
            const listing = input.authority.listingForCreator({
              principal, listingId: body.listingId as string,
            })
            if (!await input.releaseDelivery.hasVerifiedRelease({
              releaseHash: listing.releaseHash, creatorId: listing.creatorId,
              listingId: listing.listingId, productType: listing.productType,
              verification: 'attestation',
            })) {
              throw new CommercialAuthorityErrorV1('release_delivery_missing', '提交审核前必须上传并验证完整发行物')
            }
            result = response(200, await input.authority.submitListing({
              principal, requestId: body.requestId as string, listingId: body.listingId as string,
              rightsConfirmed: body.rightsConfirmed as boolean,
            }))
          } else if (request.path === '/v1/commercial/listings/publish') {
            fields(body, ['requestId', 'listingId', 'rightsConfirmed'])
            const listing = input.authority.listingForReview({
              principal, listingId: body.listingId as string,
            })
            if (!await input.releaseDelivery.hasVerifiedRelease({
              releaseHash: listing.releaseHash, creatorId: listing.creatorId,
              listingId: listing.listingId, productType: listing.productType,
              verification: 'full',
            })) {
              throw new CommercialAuthorityErrorV1('release_delivery_missing', '发布前必须上传并验证完整发行物')
            }
            result = response(200, await input.authority.publishListing({
              principal, requestId: body.requestId as string, listingId: body.listingId as string,
              rightsConfirmed: body.rightsConfirmed as boolean,
            }))
          } else if (request.path === '/v1/commercial/listings/request-changes') {
            fields(body, ['requestId', 'listingId', 'reasonCode'])
            result = response(200, await input.authority.requestListingChanges({
              principal, requestId: body.requestId as string, listingId: body.listingId as string,
              reasonCode: body.reasonCode as string,
            }))
          } else if (request.path === '/v1/commercial/listings/revise') {
            fields(body, [
              'requestId', 'listingId', 'releaseHash', 'title', 'summary', 'contentWarnings',
              'license', 'currency', 'amountMinor', 'creatorShareBps',
            ])
            result = response(200, await input.authority.reviseListing({
              principal, requestId: body.requestId as string, listingId: body.listingId as string,
              releaseHash: body.releaseHash as string, title: body.title as string,
              summary: body.summary as string, contentWarnings: body.contentWarnings as string[],
              license: body.license as CommercialLicenseV1, currency: body.currency as string,
              amountMinor: body.amountMinor as number, creatorShareBps: body.creatorShareBps as number,
            }))
          } else if (request.path === '/v1/commercial/listings/suspend') {
            fields(body, ['requestId', 'listingId', 'reasonCode'])
            result = response(200, await input.authority.suspendListing({
              principal, requestId: body.requestId as string, listingId: body.listingId as string,
              reasonCode: body.reasonCode as string,
            }))
          } else if (request.path === '/v1/commercial/listings/withdraw') {
            fields(body, ['requestId', 'listingId'])
            result = response(200, await input.authority.withdrawListing({
              principal, requestId: body.requestId as string, listingId: body.listingId as string,
            }))
          } else if (request.path === '/v1/commercial/acquisitions') {
            fields(body, ['requestId', 'listingId'])
            const listing = input.authority.listingForAcquisition({ listingId: body.listingId as string })
            if (!await input.releaseDelivery.hasVerifiedRelease({
              releaseHash: listing.releaseHash, creatorId: listing.creatorId,
              listingId: listing.listingId, productType: listing.productType,
              verification: 'attestation',
            })) {
              throw new CommercialAuthorityErrorV1('release_delivery_missing', '目录项缺少服务端验证的发行物或候选记录')
            }
            const acquisition = await input.authority.beginAcquisition({
              principal, requestId: body.requestId as string, listingId: body.listingId as string,
            })
            if (acquisition.order.status === 'pending') {
              await input.paymentSettlement?.prepare({ order: acquisition.order, buyer: principal })
            }
            const checkout = acquisition.order.status === 'pending'
              ? checkoutSession(
                  await input.checkoutProvider.createOrResumeSession(acquisition.order),
                  acquisition.order.orderId,
                  now(),
                )
              : null
            result = response(201, { ...acquisition, checkout })
          } else if (request.path === '/v1/commercial/entitlements/get') {
            fields(body, ['releaseHash'])
            result = response(200, { entitlement: input.authority.entitlementFor({
              principal,
              releaseHash: body.releaseHash as string,
            }) })
          } else if (request.path === '/v1/commercial/remix/authorize') {
            fields(body, ['releaseHash'])
            result = response(200, input.authority.authorizeRemix({
              principal,
              releaseHash: body.releaseHash as string,
            }))
          } else {
            code = 'endpoint_not_found'
            result = response(404, { code, message: '商业端点不存在' })
          }
        }
      }
    } catch (error) {
      if (error instanceof CommercialAuthorityErrorV1 || error instanceof CommercialWebhookErrorV1) {
        code = error.code
        result = response(statusFor(error.code), {
          code: error.code,
          message: error.message.replace(/^\[(?:commercial-authority|commercial-webhook):[^\]]+\]\s*/, ''),
        })
      } else {
        code = 'internal_error'
        result = response(500, { code, message: '商业服务发生内部错误' })
      }
    }
    await input.audit?.({
      path: request.path, userId, requestId, eventId,
      outcome: result.status < 400 ? 'accepted' : 'rejected', code, status: result.status,
      latencyMs: Math.max(0, now() - startedAt),
    })
    return result
  }
}
