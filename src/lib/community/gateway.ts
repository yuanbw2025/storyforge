import {
  CommunityAuthorityErrorV1,
  CommunityPlatformAuthorityV1,
  communityRequestIdForAuditV1,
  type CommunityAgeBandV1,
  type CommunityLfgPostV1,
  type CommunityPrincipalV1,
  type CommunityReviewV1,
  type CommunityReportV1,
  type CommunitySocialEdgeV1,
} from './authority'
import type { CommunityLfgRoomHandoffServiceV1 } from './lfg-room-handoff'

export interface CommunityGatewayRequestV1 {
  method: string
  path: string
  contentType: string
  headers: Record<string, string | undefined>
  body: unknown
}

export interface CommunityGatewayResponseV1 {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface CommunityIdentityV1 {
  authenticate(accessToken: string): Promise<CommunityPrincipalV1 | null>
}

export interface CommunityGatewayAuditV1 {
  path: string
  userId: string | null
  requestId: string | null
  outcome: 'accepted' | 'rejected'
  code: string
  status: number
  latencyMs: number
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommunityAuthorityErrorV1('protocol', '请求体必须是对象')
  }
  return value as Record<string, unknown>
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional])
  if (required.some(key => !(key in value)) || Object.keys(value).some(key => !allowed.has(key))) {
    throw new CommunityAuthorityErrorV1('protocol', '请求字段不符合协议')
  }
}

function bearer(headers: Record<string, string | undefined>): string | null {
  const entry = Object.entries(headers).find(([name]) => name.toLocaleLowerCase() === 'authorization')?.[1]
  const match = entry?.match(/^Bearer ([^\s]{16,2000})$/)
  return match?.[1] ?? null
}

function response(status: number, body: unknown): CommunityGatewayResponseV1 {
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
  if (['unauthorized', 'profile_required'].includes(code)) return 401
  if (['forbidden', 'account_suspended', 'appeal_forbidden', 'release_forbidden', 'remix_forbidden', 'entitlement_required', 'age_restricted', 'review_eligibility_required'].includes(code)) return 403
  if (['lfg_not_found', 'application_not_found', 'report_not_found', 'review_not_found', 'handoff_missing'].includes(code)) return 404
  if (['request_conflict', 'handle_taken', 'lineage_exists', 'lineage_cycle', 'application_exists', 'appeal_exists',
    'invalid_transition', 'lfg_closed', 'lfg_full', 'persistence_conflict', 'handoff_conflict',
    'handoff_invalid', 'room_mismatch', 'self_review', 'review_removed'].includes(code)) return 409
  if (code === 'rate_limited') return 429
  if (code === 'service_unavailable') return 503
  if (['protocol', 'payload_too_large'].includes(code)) return 422
  return 400
}

async function authenticate(identity: CommunityIdentityV1, request: CommunityGatewayRequestV1): Promise<CommunityPrincipalV1> {
  const token = bearer(request.headers)
  if (!token) throw new CommunityAuthorityErrorV1('unauthorized', '缺少有效 Bearer 凭据')
  const principal = await identity.authenticate(token)
  if (!principal) throw new CommunityAuthorityErrorV1('unauthorized', '身份凭据无效或已过期')
  return principal
}

/**
 * Framework-neutral community boundary. The deployment owns TLS, rate limits,
 * identity verification and durable persistence. Bearer tokens and free-text
 * report/appeal bodies are intentionally absent from the gateway audit shape.
 */
export function createCommunityGatewayV1(input: {
  authority: CommunityPlatformAuthorityV1
  identity: CommunityIdentityV1
  roomHandoff?: CommunityLfgRoomHandoffServiceV1
  audit?: (entry: CommunityGatewayAuditV1) => void | Promise<void>
  now?: () => number
}) {
  const now = input.now ?? (() => Date.now())
  return async (request: CommunityGatewayRequestV1): Promise<CommunityGatewayResponseV1> => {
    const startedAt = now()
    let userId: string | null = null
    let requestId: string | null = null
    let code = 'ok'
    let result = response(500, { code: 'internal_error', message: '社区服务未产生响应' })
    try {
      if (request.method.toUpperCase() !== 'POST') {
        code = 'method_not_allowed'
        result = response(405, { code, message: '只支持 POST' })
      } else if (!/^application\/json(?:\s*;|$)/i.test(request.contentType)) {
        code = 'unsupported_media_type'
        result = response(415, { code, message: '请求必须使用 application/json' })
      } else {
        const encoded = JSON.stringify(request.body)
        if (encoded === undefined || encoded.length > 64_000) {
          throw new CommunityAuthorityErrorV1('payload_too_large', '请求体超过 64KB')
        }
        const body = record(request.body)
        requestId = communityRequestIdForAuditV1(body.requestId)
        if (request.path === '/v1/community/lfg/discover') {
          fields(body, [], ['locale', 'releaseHash', 'includeFull'])
          if ((body.locale != null && typeof body.locale !== 'string')
            || (body.releaseHash != null && typeof body.releaseHash !== 'string')
            || (body.includeFull != null && typeof body.includeFull !== 'boolean')) {
            throw new CommunityAuthorityErrorV1('protocol', '招募发现筛选字段无效')
          }
          result = response(200, input.authority.discoverLfg({
            locale: typeof body.locale === 'string' ? body.locale : undefined,
            releaseHash: typeof body.releaseHash === 'string' ? body.releaseHash : undefined,
            includeFull: body.includeFull === true,
          }))
        } else if (request.path === '/v1/community/reviews/list') {
          fields(body, ['subjectType', 'releaseHash'], ['postId'])
          result = response(200, input.authority.reviewsFor({
            subjectType: body.subjectType as CommunityReviewV1['subjectType'],
            releaseHash: body.releaseHash as string,
            postId: body.postId == null ? null : body.postId as string,
          }))
        } else if (request.path === '/v1/community/profiles/get') {
          fields(body, ['userId'])
          result = response(200, { profile: input.authority.profile(body.userId as string) })
        } else {
          const principal = await authenticate(input.identity, request)
          userId = principal.userId
          if (request.path === '/v1/community/profiles') {
            fields(body, ['requestId', 'handle', 'displayName', 'bio', 'locale', 'timeZone', 'ageBand'])
            result = response(200, await input.authority.upsertProfile({
              principal, requestId: body.requestId as string, handle: body.handle as string,
              displayName: body.displayName as string, bio: body.bio as string, locale: body.locale as string,
              timeZone: body.timeZone as string, ageBand: body.ageBand as CommunityAgeBandV1,
            }))
          } else if (request.path === '/v1/community/social') {
            fields(body, ['requestId', 'kind', 'targetId', 'active'])
            result = response(200, await input.authority.setSocialEdge({
              principal, requestId: body.requestId as string, kind: body.kind as CommunitySocialEdgeV1['kind'],
              targetId: body.targetId as string, active: body.active as boolean,
            }))
          } else if (request.path === '/v1/community/social/mine') {
            fields(body, [])
            result = response(200, input.authority.socialEdges(principal.userId))
          } else if (request.path === '/v1/community/releases/lineage') {
            fields(body, ['requestId', 'releaseHash', 'licenseId', 'attribution'], ['parentReleaseHash', 'remixAuthorization'])
            result = response(201, await input.authority.registerReleaseLineage({
              principal, requestId: body.requestId as string, releaseHash: body.releaseHash as string,
              parentReleaseHash: body.parentReleaseHash == null ? null : body.parentReleaseHash as string,
              licenseId: body.licenseId as string, attribution: body.attribution as string[],
              remixAuthorization: body.remixAuthorization as {
                sourceReleaseHash: string
                licenseId: string
                attributionRequired: boolean
              } | null | undefined,
            }))
          } else if (request.path === '/v1/community/lfg') {
            fields(body, [
              'requestId', 'releaseHash', 'title', 'summary', 'locale', 'timeZone', 'startsAt',
              'durationMinutes', 'playerCapacity', 'waitlistCapacity', 'audience', 'safetyTags',
            ])
            result = response(201, await input.authority.createLfgPost({
              principal, requestId: body.requestId as string, releaseHash: body.releaseHash as string,
              title: body.title as string, summary: body.summary as string, locale: body.locale as string,
              timeZone: body.timeZone as string, startsAt: body.startsAt as number,
              durationMinutes: body.durationMinutes as number, playerCapacity: body.playerCapacity as number,
              waitlistCapacity: body.waitlistCapacity as number, audience: body.audience as CommunityLfgPostV1['audience'],
              safetyTags: body.safetyTags as string[],
            }))
          } else if (request.path === '/v1/community/lfg/applications') {
            fields(body, ['requestId', 'postId', 'characterPreference', 'note'])
            result = response(201, await input.authority.applyToLfg({
              principal, requestId: body.requestId as string, postId: body.postId as string,
              characterPreference: body.characterPreference as string, note: body.note as string,
            }))
          } else if (request.path === '/v1/community/lfg/applications/list') {
            fields(body, ['postId'])
            result = response(200, input.authority.applicationsForPost({
              principal, postId: body.postId as string,
            }))
          } else if (request.path === '/v1/community/lfg/my-applications') {
            fields(body, [])
            result = response(200, input.authority.applicationsForUser({ principal }))
          } else if (request.path === '/v1/community/lfg/my-participation') {
            fields(body, [])
            result = response(200, input.authority.participationForUser({ principal }))
          } else if (request.path === '/v1/community/lfg/applications/decide') {
            fields(body, ['requestId', 'applicationId', 'decision'])
            result = response(200, await input.authority.decideLfgApplication({
              principal, requestId: body.requestId as string, applicationId: body.applicationId as string,
              decision: body.decision as 'accept' | 'decline',
            }))
          } else if (request.path === '/v1/community/lfg/close') {
            fields(body, ['requestId', 'postId', 'status'])
            result = response(200, await input.authority.closeLfgPost({
              principal, requestId: body.requestId as string, postId: body.postId as string,
              status: body.status as 'closed' | 'cancelled',
            }))
          } else if (request.path === '/v1/community/lfg/attendance') {
            fields(body, ['requestId', 'applicationId', 'status'])
            result = response(200, await input.authority.markLfgAttendance({
              principal, requestId: body.requestId as string, applicationId: body.applicationId as string,
              status: body.status as 'confirmed' | 'no-show',
            }))
          } else if (request.path === '/v1/community/lfg/attendance/list') {
            fields(body, ['postId'])
            result = response(200, input.authority.attendanceForPost({
              principal, postId: body.postId as string,
            }))
          } else if (request.path === '/v1/community/lfg/promote-waitlist') {
            fields(body, ['requestId', 'absentApplicationId', 'replacementApplicationId'])
            result = response(200, await input.authority.promoteLfgWaitlist({
              principal, requestId: body.requestId as string,
              absentApplicationId: body.absentApplicationId as string,
              replacementApplicationId: body.replacementApplicationId as string,
            }))
          } else if (request.path === '/v1/community/lfg/room-handoffs/bind') {
            fields(body, ['requestId', 'postId', 'roomId', 'releaseHash', 'expiresAt', 'bindings'])
            if (!input.roomHandoff) throw new CommunityAuthorityErrorV1('service_unavailable', '当前部署未配置房间交接服务')
            result = response(200, await input.roomHandoff.bindAcceptedSeats({
              principal, hostAccessToken: bearer(request.headers)!, requestId: body.requestId as string,
              postId: body.postId as string, roomId: body.roomId as string,
              releaseHash: body.releaseHash as string, expiresAt: body.expiresAt as number,
              bindings: body.bindings as Array<{ applicationId: string; actorKey: string }>,
            }))
          } else if (request.path === '/v1/community/lfg/room-handoffs/claim') {
            fields(body, ['applicationId'])
            if (!input.roomHandoff) throw new CommunityAuthorityErrorV1('service_unavailable', '当前部署未配置房间交接服务')
            result = response(200, await input.roomHandoff.claimForApplicant({
              principal, applicationId: body.applicationId as string,
            }))
          } else if (request.path === '/v1/community/reviews') {
            fields(body, ['requestId', 'subjectType', 'releaseHash', 'postId', 'rating', 'title', 'body', 'tags', 'containsSpoilers'])
            result = response(200, await input.authority.upsertReview({
              principal, requestId: body.requestId as string,
              subjectType: body.subjectType as CommunityReviewV1['subjectType'],
              releaseHash: body.releaseHash as string, postId: body.postId == null ? null : body.postId as string,
              rating: body.rating as number, title: body.title as string, body: body.body as string,
              tags: body.tags as string[], containsSpoilers: body.containsSpoilers as boolean,
            }))
          } else if (request.path === '/v1/community/reviews/capabilities') {
            fields(body, ['subjectType', 'releaseHash'], ['postId'])
            result = response(200, await input.authority.reviewCapabilities({
              principal, subjectType: body.subjectType as CommunityReviewV1['subjectType'],
              releaseHash: body.releaseHash as string, postId: body.postId == null ? null : body.postId as string,
            }))
          } else if (request.path === '/v1/community/reviews/withdraw') {
            fields(body, ['requestId', 'reviewId'])
            result = response(200, await input.authority.withdrawReview({
              principal, requestId: body.requestId as string, reviewId: body.reviewId as string,
            }))
          } else if (request.path === '/v1/community/reviews/respond') {
            fields(body, ['requestId', 'reviewId', 'response'])
            result = response(200, await input.authority.respondToReview({
              principal, requestId: body.requestId as string, reviewId: body.reviewId as string,
              response: body.response as string,
            }))
          } else if (request.path === '/v1/community/reports') {
            fields(body, ['requestId', 'subjectType', 'subjectId', 'category', 'details'])
            result = response(201, await input.authority.createReport({
              principal, requestId: body.requestId as string, subjectType: body.subjectType as CommunityReportV1['subjectType'],
              subjectId: body.subjectId as string, category: body.category as CommunityReportV1['category'],
              details: body.details as string,
            }))
          } else if (request.path === '/v1/community/reports/mine') {
            fields(body, [])
            result = response(200, input.authority.reportsForPrincipal({ principal }))
          } else if (request.path === '/v1/community/reports/decide') {
            fields(body, ['requestId', 'reportId', 'action', 'reasonCode'])
            result = response(200, await input.authority.decideReport({
              principal, requestId: body.requestId as string, reportId: body.reportId as string,
              action: body.action as NonNullable<CommunityReportV1['action']>, reasonCode: body.reasonCode as string,
            }))
          } else if (request.path === '/v1/community/appeals') {
            fields(body, ['requestId', 'reportId', 'statement'])
            result = response(201, await input.authority.appealReport({
              principal, requestId: body.requestId as string, reportId: body.reportId as string,
              statement: body.statement as string,
            }))
          } else if (request.path === '/v1/community/appeals/mine') {
            fields(body, [])
            result = response(200, input.authority.appealsForPrincipal({ principal }))
          } else if (request.path === '/v1/community/appeals/resolve') {
            fields(body, ['requestId', 'appealId', 'decision'])
            result = response(200, await input.authority.resolveAppeal({
              principal, requestId: body.requestId as string, appealId: body.appealId as string,
              decision: body.decision as 'uphold' | 'reverse',
            } satisfies Parameters<CommunityPlatformAuthorityV1['resolveAppeal']>[0]))
          } else {
            code = 'endpoint_not_found'
            result = response(404, { code, message: '社区端点不存在' })
          }
        }
      }
    } catch (error) {
      if (error instanceof CommunityAuthorityErrorV1) {
        code = error.code
        result = response(statusFor(error.code), {
          code: error.code,
          message: error.message.replace(/^\[community-authority:[^\]]+\]\s*/, ''),
        })
      } else {
        code = 'internal_error'
        result = response(500, { code, message: '社区服务发生内部错误' })
      }
    }
    await input.audit?.({
      path: request.path, userId, requestId,
      outcome: result.status < 400 ? 'accepted' : 'rejected', code, status: result.status,
      latencyMs: Math.max(0, now() - startedAt),
    })
    return result
  }
}
