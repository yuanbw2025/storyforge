import { CommercialAuthorityErrorV1, type CommercialPrincipalV1 } from './authority'
import type { CommercialGatewayAuditV1, CommercialIdentityV1 } from './gateway'
import { CommercialReleaseDeliveryServiceV1 } from './release-delivery'

export interface CommercialReleaseDeliveryGatewayRequestV1 {
  method: string
  path: string
  contentType: string
  headers: Record<string, string | undefined>
  body: unknown
}

export interface CommercialReleaseDeliveryGatewayResponseV1 {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface CommercialReleaseDeliveryGatewayPreflightRequestV1 {
  method: string
  path: string
  contentType: string
  headers: Record<string, string | undefined>
}

export interface CommercialReleaseDeliveryGatewayHandlerV1 {
  (request: CommercialReleaseDeliveryGatewayRequestV1): Promise<CommercialReleaseDeliveryGatewayResponseV1>
  /** Header-only admission before the Fetch boundary reserves a large-body slot. */
  preflightDistributionUpload(
    request: CommercialReleaseDeliveryGatewayPreflightRequestV1,
  ): Promise<CommercialReleaseDeliveryGatewayResponseV1 | null>
}

const MAXIMUM_ENCODED_DISTRIBUTION_BYTES = 360 * 1024 * 1024

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommercialAuthorityErrorV1('protocol', '请求体必须是对象')
  }
  return value as Record<string, unknown>
}

function exactFields(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).length !== expected.length
    || Object.keys(value).some(key => !expected.includes(key))) {
    throw new CommercialAuthorityErrorV1('protocol', '请求字段不符合协议')
  }
}

function header(headers: Record<string, string | undefined>, name: string): string | null {
  return Object.entries(headers).find(([candidate]) => candidate.toLocaleLowerCase() === name)?.[1] ?? null
}

async function authenticate(identity: CommercialIdentityV1, request: CommercialReleaseDeliveryGatewayRequestV1) {
  const match = header(request.headers, 'authorization')?.match(/^Bearer ([^\s]{16,2000})$/)
  if (!match) throw new CommercialAuthorityErrorV1('unauthorized', '缺少有效 Bearer 凭据')
  const principal = await identity.authenticate(match[1])
  if (!principal) throw new CommercialAuthorityErrorV1('unauthorized', '身份凭据无效或已过期')
  return principal
}

function response(status: number, body: unknown): CommercialReleaseDeliveryGatewayResponseV1 {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
    body,
  }
}

function statusFor(code: string): number {
  if (code === 'unauthorized') return 401
  if (['forbidden', 'release_forbidden', 'entitlement_required', 'license_forbidden', 'moderation_hold'].includes(code)) return 403
  if (['release_delivery_missing', 'listing_not_found'].includes(code)) return 404
  if (['request_conflict', 'release_conflict', 'release_corrupt', 'candidate_conflict', 'candidate_missing', 'invalid_transition'].includes(code)) return 409
  if (code === 'payload_too_large') return 413
  if (['protocol', 'candidate_required', 'candidate_invalid', 'candidate_not_applicable'].includes(code)) return 422
  return 400
}

/**
 * Dedicated large-object API. A deployment adapter must enforce the same byte
 * limit while reading the request stream; this framework-neutral boundary
 * keeps catalog/payment commands on their separate 96KB gateway.
 */
export function createCommercialReleaseDeliveryGatewayV1(input: {
  service: CommercialReleaseDeliveryServiceV1
  identity: CommercialIdentityV1
  audit?: (entry: CommercialGatewayAuditV1) => void | Promise<void>
  now?: () => number
}): CommercialReleaseDeliveryGatewayHandlerV1 {
  const now = input.now ?? (() => Date.now())
  const handler = async (
    request: CommercialReleaseDeliveryGatewayRequestV1,
  ): Promise<CommercialReleaseDeliveryGatewayResponseV1> => {
    const startedAt = now()
    let principal: CommercialPrincipalV1 | null = null
    let requestId: string | null = null
    let code = 'ok'
    let result = response(500, { code: 'internal_error', message: '发行物服务未产生响应' })
    try {
      if (request.method.toUpperCase() !== 'POST') {
        code = 'method_not_allowed'
        result = response(405, { code, message: '只支持 POST' })
      } else if (!/^application\/json(?:\s*;|$)/i.test(request.contentType)) {
        code = 'unsupported_media_type'
        result = response(415, { code, message: '请求必须使用 application/json' })
      } else {
        principal = await authenticate(input.identity, request)
        const body = record(request.body)
        requestId = typeof body.requestId === 'string' ? body.requestId : null
        if (request.path === '/v1/commercial/releases/register') {
          const hasCandidateFields = 'listingId' in body || 'textAdventureCandidate' in body
          exactFields(body, hasCandidateFields
            ? ['requestId', 'listingId', 'bundle', 'textAdventureCandidate']
            : ['requestId', 'bundle'])
          const encoded = JSON.stringify(request.body)
          if (new TextEncoder().encode(encoded).byteLength > MAXIMUM_ENCODED_DISTRIBUTION_BYTES) {
            throw new CommercialAuthorityErrorV1('payload_too_large', '发行物请求超过 360MiB')
          }
          const registered = await input.service.registerCreatorBundle({
            principal,
            requestId: body.requestId as string,
            bundle: body.bundle,
            ...(hasCandidateFields ? {
              listingId: body.listingId as string,
              textAdventureCandidate: body.textAdventureCandidate,
            } : {}),
          })
          result = response(registered.duplicate ? 200 : 201, registered)
        } else if (request.path === '/v1/commercial/releases/review-candidate') {
          exactFields(body, ['listingId'])
          result = response(200, await input.service.reviewTextAdventureCandidate({
            principal, listingId: body.listingId as string,
          }))
        } else if (request.path === '/v1/commercial/releases/download') {
          exactFields(body, ['releaseHash'])
          result = response(200, await input.service.download({
            principal, releaseHash: body.releaseHash as string,
          }))
        } else {
          code = 'endpoint_not_found'
          result = response(404, { code, message: '发行物端点不存在' })
        }
      }
    } catch (error) {
      if (error instanceof CommercialAuthorityErrorV1) {
        code = error.code
        result = response(statusFor(error.code), {
          code: error.code,
          message: error.message.replace(/^\[commercial-authority:[^\]]+\]\s*/, ''),
        })
      } else {
        code = 'internal_error'
        result = response(500, { code, message: '发行物服务发生内部错误' })
      }
    }
    await input.audit?.({
      path: request.path, userId: principal?.userId ?? null, requestId, eventId: null,
      outcome: result.status < 400 ? 'accepted' : 'rejected', code, status: result.status,
      latencyMs: Math.max(0, now() - startedAt),
    })
    return result
  }
  handler.preflightDistributionUpload = async (
    request: CommercialReleaseDeliveryGatewayPreflightRequestV1,
  ): Promise<CommercialReleaseDeliveryGatewayResponseV1 | null> => {
    const startedAt = now()
    let principal: CommercialPrincipalV1 | null = null
    let code = 'ok'
    let result: CommercialReleaseDeliveryGatewayResponseV1 | null = null
    try {
      if (request.path !== '/v1/commercial/releases/register') {
        code = 'endpoint_not_found'
        result = response(404, { code, message: '发行物端点不存在' })
      } else if (request.method.toUpperCase() !== 'POST') {
        code = 'method_not_allowed'
        result = response(405, { code, message: '只支持 POST' })
      } else if (!/^application\/json(?:\s*;|$)/i.test(request.contentType)) {
        code = 'unsupported_media_type'
        result = response(415, { code, message: '请求必须使用 application/json' })
      } else {
        principal = await authenticate(input.identity, { ...request, body: null })
      }
    } catch (error) {
      if (error instanceof CommercialAuthorityErrorV1) {
        code = error.code
        result = response(statusFor(error.code), {
          code: error.code,
          message: error.message.replace(/^\[commercial-authority:[^\]]+\]\s*/, ''),
        })
      } else {
        code = 'internal_error'
        result = response(500, { code, message: '发行物服务发生内部错误' })
      }
    }
    if (result) {
      await input.audit?.({
        path: request.path, userId: principal?.userId ?? null, requestId: null, eventId: null,
        outcome: 'rejected', code, status: result.status,
        latencyMs: Math.max(0, now() - startedAt),
      })
    }
    return result
  }
  return handler
}
