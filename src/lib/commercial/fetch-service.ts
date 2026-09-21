import type { CommercialGatewayRequestV1, CommercialGatewayResponseV1 } from './gateway'
import type {
  CommercialReleaseDeliveryGatewayHandlerV1,
  CommercialReleaseDeliveryGatewayRequestV1,
  CommercialReleaseDeliveryGatewayResponseV1,
} from './release-delivery-gateway'

type CommercialHandlerV1 = (request: CommercialGatewayRequestV1) => Promise<CommercialGatewayResponseV1>
type DeliveryHandlerV1 = (
  request: CommercialReleaseDeliveryGatewayRequestV1,
) => Promise<CommercialReleaseDeliveryGatewayResponseV1>

type PreflightCapableDeliveryHandlerV1 = DeliveryHandlerV1 & Partial<Pick<
  CommercialReleaseDeliveryGatewayHandlerV1,
  'preflightDistributionUpload'
>>

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('[commercial-fetch:configuration] allowedOrigins 必须是纯 http(s) origin')
  }
  return url.origin
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

type BoundedBodyReadV1 =
  | { status: 'ok'; text: string }
  | { status: 'too-large' }
  | { status: 'timed-out' }
  | { status: 'aborted' }
  | { status: 'unreadable' }

async function readRequestBodyBoundedV1(
  request: Request,
  maximumBytes: number,
  timeoutMs: number,
): Promise<BoundedBodyReadV1> {
  if (!request.body) return { status: 'ok', text: '' }
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let timeout: ReturnType<typeof setTimeout> | null = null
  let resolveInterruption!: (status: 'timed-out' | 'aborted') => void
  const interruption = new Promise<'timed-out' | 'aborted'>(resolve => { resolveInterruption = resolve })
  const abort = () => resolveInterruption('aborted')
  try {
    reader = request.body.getReader()
    if (request.signal.aborted) return { status: 'aborted' }
    request.signal.addEventListener('abort', abort, { once: true })
    timeout = setTimeout(() => resolveInterruption('timed-out'), timeoutMs)
    const decoder = new TextDecoder()
    const parts: string[] = []
    let receivedBytes = 0
    while (true) {
      const outcome = await Promise.race([
        reader.read().then(
          chunk => ({ status: 'read' as const, chunk }),
          () => ({ status: 'unreadable' as const }),
        ),
        interruption.then(status => ({ status })),
      ])
      if (outcome.status === 'timed-out' || outcome.status === 'aborted') {
        void reader.cancel(`storyforge-body-${outcome.status}`).catch(() => undefined)
        return { status: outcome.status }
      }
      if (outcome.status === 'unreadable') return { status: 'unreadable' }
      if (!('chunk' in outcome)) return { status: 'unreadable' }
      const { chunk } = outcome
      if (chunk.done) break
      receivedBytes += chunk.value.byteLength
      if (receivedBytes > maximumBytes) {
        try { await reader.cancel('storyforge-payload-too-large') } catch { /* best-effort transport abort */ }
        return { status: 'too-large' }
      }
      parts.push(decoder.decode(chunk.value, { stream: true }))
    }
    parts.push(decoder.decode())
    return { status: 'ok', text: parts.join('') }
  } catch {
    return { status: 'unreadable' }
  } finally {
    if (timeout) clearTimeout(timeout)
    request.signal.removeEventListener('abort', abort)
    try { reader?.releaseLock() } catch { /* reader may already be detached */ }
  }
}

function cancelUnreadBody(request: Request, reason: string): void {
  if (!request.body || request.bodyUsed) return
  try { void request.body.cancel(reason).catch(() => undefined) } catch { /* best-effort transport abort */ }
}

/** Web-standard deployment boundary for catalog, checkout, webhook and large release delivery. */
export function createCommercialFetchHandlerV1(input: {
  commercialGateway: CommercialHandlerV1
  deliveryGateway: PreflightCapableDeliveryHandlerV1
  allowedOrigins: string[]
  serviceVersion?: string
  maximumCommandBytes?: number
  maximumDistributionBytes?: number
  maximumConcurrentDistributionUploads?: number
  maximumCommandBodyReadMs?: number
  maximumDistributionBodyReadMs?: number
}) {
  const allowedOrigins = new Set(input.allowedOrigins.map(normalizeOrigin))
  if (allowedOrigins.size !== input.allowedOrigins.length) {
    throw new Error('[commercial-fetch:configuration] allowedOrigins 不能重复')
  }
  const maximumCommandBytes = input.maximumCommandBytes ?? 96_000
  const maximumDistributionBytes = input.maximumDistributionBytes ?? 360 * 1024 * 1024
  const maximumConcurrentDistributionUploads = input.maximumConcurrentDistributionUploads ?? 2
  const maximumCommandBodyReadMs = input.maximumCommandBodyReadMs ?? 10_000
  const maximumDistributionBodyReadMs = input.maximumDistributionBodyReadMs ?? 120_000
  if (!Number.isInteger(maximumCommandBytes) || maximumCommandBytes < 1_024 || maximumCommandBytes > 1_000_000
    || !Number.isInteger(maximumDistributionBytes) || maximumDistributionBytes < 1_000_000
    || maximumDistributionBytes > 400 * 1024 * 1024
    || !Number.isInteger(maximumConcurrentDistributionUploads)
    || maximumConcurrentDistributionUploads < 1 || maximumConcurrentDistributionUploads > 16
    || !Number.isInteger(maximumCommandBodyReadMs) || maximumCommandBodyReadMs < 10
    || maximumCommandBodyReadMs > 60_000
    || !Number.isInteger(maximumDistributionBodyReadMs) || maximumDistributionBodyReadMs < 10
    || maximumDistributionBodyReadMs > 10 * 60_000) {
    throw new Error('[commercial-fetch:configuration] 请求大小限制无效')
  }
  const serviceVersion = input.serviceVersion?.trim() || 'development'
  if (serviceVersion.length > 100 || /[\r\n]/.test(serviceVersion)) {
    throw new Error('[commercial-fetch:configuration] serviceVersion 无效')
  }
  let activeDistributionUploads = 0

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')
    const normalizedRequestOrigin = origin ? (() => {
      try { return normalizeOrigin(origin) } catch { return null }
    })() : null
    const originAllowed = !origin || (normalizedRequestOrigin != null && allowedOrigins.has(normalizedRequestOrigin))
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'cross-origin-resource-policy': 'cross-origin', 'x-storyforge-service-version': serviceVersion,
      'access-control-expose-headers': 'x-storyforge-next-cursor, retry-after',
      vary: 'origin',
    }
    if (originAllowed && normalizedRequestOrigin) headers['access-control-allow-origin'] = normalizedRequestOrigin
    if (!originAllowed) return json(403, { code: 'origin_forbidden', message: '请求 Origin 未获市场服务授权' }, headers)
    if (request.method.toUpperCase() === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type, accept, x-storyforge-signature',
          'access-control-max-age': '600',
        },
      })
    }
    if (url.search || url.hash) {
      return json(400, { code: 'query_forbidden', message: '市场 API 不接受 query 或 fragment' }, headers)
    }
    if (url.pathname === '/healthz') {
      return request.method.toUpperCase() === 'GET'
        ? json(200, { status: 'ok', protocolVersion: 1, serviceVersion }, headers)
        : json(405, { code: 'method_not_allowed', message: '健康检查只支持 GET' }, headers)
    }
    const isDistributionUpload = url.pathname === '/v1/commercial/releases/register'
    const maximumBytes = isDistributionUpload ? maximumDistributionBytes : maximumCommandBytes
    const bodyReadTimeoutMs = isDistributionUpload ? maximumDistributionBodyReadMs : maximumCommandBodyReadMs
    const contentLength = request.headers.get('content-length')
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
      cancelUnreadBody(request, 'storyforge-invalid-or-oversized-content-length')
      return json(413, { code: 'payload_too_large', message: `请求体超过 ${maximumBytes} bytes` }, headers)
    }
    const requestHeaders = Object.fromEntries(request.headers.entries())
    if (isDistributionUpload) {
      const preflight = input.deliveryGateway.preflightDistributionUpload
      if (!preflight) {
        cancelUnreadBody(request, 'storyforge-upload-preflight-unavailable')
        return json(503, {
          code: 'upload_authentication_unavailable', message: '发行物上传认证边界不可用',
        }, headers)
      }
      let rejected: CommercialReleaseDeliveryGatewayResponseV1 | null
      try {
        rejected = await preflight({
          method: request.method, path: url.pathname,
          contentType: request.headers.get('content-type') ?? '', headers: requestHeaders,
        })
      } catch {
        cancelUnreadBody(request, 'storyforge-upload-preflight-failed')
        return json(503, {
          code: 'upload_authentication_unavailable', message: '发行物上传认证边界暂不可用',
        }, headers)
      }
      if (rejected) {
        cancelUnreadBody(request, `storyforge-upload-preflight-${rejected.status}`)
        return json(rejected.status, rejected.body, { ...headers, ...rejected.headers })
      }
      if (request.signal.aborted) {
        cancelUnreadBody(request, 'storyforge-request-aborted')
        return json(408, { code: 'request_aborted', message: '请求在读取正文前已中止' }, headers)
      }
      if (activeDistributionUploads >= maximumConcurrentDistributionUploads) {
        cancelUnreadBody(request, 'storyforge-upload-concurrency-limited')
        return json(429, { code: 'upload_concurrency_limited', message: '发行物上传并发预算已满' }, {
          ...headers, 'retry-after': '1',
        })
      }
    }
    if (isDistributionUpload) activeDistributionUploads += 1
    try {
      const bodyRead = await readRequestBodyBoundedV1(request, maximumBytes, bodyReadTimeoutMs)
      if (bodyRead.status === 'too-large') {
        return json(413, { code: 'payload_too_large', message: `请求体超过 ${maximumBytes} bytes` }, headers)
      }
      if (bodyRead.status === 'timed-out') {
        return json(408, { code: 'body_timeout', message: '请求正文读取超时' }, {
          ...headers, 'retry-after': '1',
        })
      }
      if (bodyRead.status === 'aborted') {
        return json(408, { code: 'request_aborted', message: '请求在正文读取期间已中止' }, headers)
      }
      if (bodyRead.status === 'unreadable') {
        return json(400, { code: 'body_unreadable', message: '无法读取请求体' }, headers)
      }
      const rawBody = bodyRead.text
      let body: unknown
      try { body = JSON.parse(rawBody) } catch {
        return json(400, { code: 'invalid_json', message: '请求体不是合法 JSON' }, headers)
      }
      const gatewayResponse = url.pathname.startsWith('/v1/commercial/releases/')
        ? await input.deliveryGateway({
            method: request.method, path: url.pathname,
            contentType: request.headers.get('content-type') ?? '', headers: requestHeaders, body,
          })
        : await input.commercialGateway({
            method: request.method, path: url.pathname,
            contentType: request.headers.get('content-type') ?? '', headers: requestHeaders, body, rawBody,
          })
      return json(gatewayResponse.status, gatewayResponse.body, { ...headers, ...gatewayResponse.headers })
    } catch {
      return json(500, { code: 'service_unavailable', message: '市场服务暂时不可用' }, headers)
    } finally {
      if (isDistributionUpload) activeDistributionUploads -= 1
    }
  }
}
