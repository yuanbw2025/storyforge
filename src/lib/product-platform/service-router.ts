export interface ProductPlatformReadinessV1 {
  ready: boolean
  serviceVersion: string
  checks: Record<string, 'ready' | 'missing' | 'development-only' | 'unhealthy'>
  /** Probe time, not service boot time. Omitted by the static evaluator. */
  checkedAt?: number
}

type FetchHandlerV1 = (request: Request) => Promise<Response>

export type ProductPlatformServiceDomainV1 = 'commercial' | 'community' | 'online' | 'operations'

export interface ProductPlatformRateLimitDecisionV1 {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterMs: number
}

export interface ProductPlatformRateLimiterV1 {
  consume(input: {
    /** Opaque deployment-derived subject. It must never enter audit output. */
    subjectKey: string
    bucket: string
    cost: number
    now: number
  }): ProductPlatformRateLimitDecisionV1 | Promise<ProductPlatformRateLimitDecisionV1>
}

export interface ProductPlatformRequestGuardAuditV1 {
  requestId: string
  domain: ProductPlatformServiceDomainV1
  method: string
  phase: 'admitted' | 'completed'
  subjectKind: 'account' | 'anonymous' | 'service'
  status: number | null
  createdAt: number
}

export interface ProductPlatformRequestGuardV1 {
  /**
   * Deployment boundary. The resolver must use a verified session or trusted
   * connection metadata, never a client-controlled forwarded-IP header.
   */
  resolveSubject(request: Request, domain: ProductPlatformServiceDomainV1): Promise<{
    subjectKey: string
    subjectKind: ProductPlatformRequestGuardAuditV1['subjectKind']
  }>
  rateLimiter: ProductPlatformRateLimiterV1
  audit(entry: ProductPlatformRequestGuardAuditV1): void | Promise<void>
  now?: () => number
}

export interface ProductPlatformRequestAuthorityV1 {
  /**
   * Revalidates deployment routing/lease ownership before a domain handler is
   * allowed to observe a request. It receives no bearer token or body.
   */
  assertAuthority(input: {
    domain: ProductPlatformServiceDomainV1
    method: string
    pathname: string
    requestId: string
  }): boolean | Promise<boolean>
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  } })
}

function domainForPath(pathname: string): ProductPlatformServiceDomainV1 | null {
  if (pathname.startsWith('/v1/commercial/')) return 'commercial'
  if (pathname.startsWith('/v1/community/')) return 'community'
  if (pathname === '/v1/rooms' || pathname.startsWith('/v1/rooms/')) return 'online'
  if (pathname.startsWith('/v1/operations/')) return 'operations'
  return null
}

function requestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim() ?? ''
  return /^[A-Za-z0-9._:-]{8,120}$/.test(supplied) ? supplied : crypto.randomUUID()
}

function guardedResponse(response: Response, input: {
  requestId: string
  decision: ProductPlatformRateLimitDecisionV1
}): Response {
  const headers = new Headers(response.headers)
  headers.set('x-request-id', input.requestId)
  headers.set('ratelimit-limit', String(input.decision.limit))
  headers.set('ratelimit-remaining', String(input.decision.remaining))
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/** One externally deployable origin; domain handlers retain their own byte/CORS/auth boundaries. */
export function createProductPlatformServiceRouterV1(input: {
  commercial: FetchHandlerV1
  community: FetchHandlerV1
  online: FetchHandlerV1
  operations: FetchHandlerV1
  readiness: (input?: { force?: boolean }) => ProductPlatformReadinessV1 | Promise<ProductPlatformReadinessV1>
  guard: ProductPlatformRequestGuardV1
  requestAuthority?: ProductPlatformRequestAuthorityV1
}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === '/healthz/platform') {
      if (request.method.toUpperCase() !== 'GET') return json(405, { code: 'method_not_allowed', message: '平台健康检查只支持 GET' })
      const readiness = await input.readiness({ force: true })
      return json(readiness.ready ? 200 : 503, readiness)
    }
    const domain = domainForPath(url.pathname)
    if (!domain) return json(404, { code: 'endpoint_not_found', message: 'StoryForge 平台端点不存在' })
    const readiness = await input.readiness()
    if (!readiness.ready) return json(503, { code: 'platform_not_ready', message: '平台托管依赖尚未就绪' })
    const id = requestId(request)
    const now = input.guard.now?.() ?? Date.now()
    try {
      const subject = await input.guard.resolveSubject(request, domain)
      if (!subject.subjectKey.trim() || subject.subjectKey.length > 500) {
        throw new Error('invalid rate-limit subject')
      }
      const decision = await input.guard.rateLimiter.consume({
        subjectKey: subject.subjectKey,
        bucket: `${domain}:${request.method.toUpperCase()}`,
        cost: domain === 'operations' ? 2 : 1,
        now,
      })
      if (!decision.allowed) {
        await input.guard.audit({
          requestId: id, domain, method: request.method.toUpperCase(), phase: 'completed',
          subjectKind: subject.subjectKind, status: 429, createdAt: now,
        })
        const response = json(429, { code: 'rate_limited', message: '请求过于频繁，请稍后重试', requestId: id })
        response.headers.set('retry-after', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))))
        return guardedResponse(response, { requestId: id, decision })
      }
      if (input.requestAuthority && !await input.requestAuthority.assertAuthority({
        domain,
        method: request.method.toUpperCase(),
        pathname: url.pathname,
        requestId: id,
      })) {
        await input.guard.audit({
          requestId: id, domain, method: request.method.toUpperCase(), phase: 'completed',
          subjectKind: subject.subjectKind, status: 503, createdAt: now,
        })
        return guardedResponse(json(503, {
          code: 'platform_authority_unavailable',
          message: '当前实例不持有该请求的服务权威',
          requestId: id,
        }), { requestId: id, decision })
      }
      await input.guard.audit({
        requestId: id, domain, method: request.method.toUpperCase(), phase: 'admitted',
        subjectKind: subject.subjectKind, status: null, createdAt: now,
      })
      const handler = input[domain]
      const response = await handler(request)
      await input.guard.audit({
        requestId: id, domain, method: request.method.toUpperCase(), phase: 'completed',
        subjectKind: subject.subjectKind, status: response.status, createdAt: input.guard.now?.() ?? Date.now(),
      })
      return guardedResponse(response, { requestId: id, decision })
    } catch {
      return json(503, { code: 'platform_guard_unavailable', message: '平台请求守卫暂不可用', requestId: id })
    }
  }
}

/** Bounded development/test limiter. Production readiness must mark it memory. */
export function createMemoryProductPlatformRateLimiterV1(input: {
  limit: number
  windowMs: number
  maximumSubjects?: number
}): ProductPlatformRateLimiterV1 {
  if (!Number.isInteger(input.limit) || input.limit <= 0) throw new Error('[product-platform-rate-limit] limit 无效')
  if (!Number.isInteger(input.windowMs) || input.windowMs <= 0) throw new Error('[product-platform-rate-limit] windowMs 无效')
  const maximumSubjects = input.maximumSubjects ?? 10_000
  if (!Number.isInteger(maximumSubjects) || maximumSubjects <= 0) throw new Error('[product-platform-rate-limit] maximumSubjects 无效')
  const windows = new Map<string, { startedAt: number; used: number }>()
  return {
    consume({ subjectKey, bucket, cost, now }) {
      if (!Number.isInteger(cost) || cost <= 0) throw new Error('[product-platform-rate-limit] cost 无效')
      const key = `${bucket}\u0000${subjectKey}`
      let window = windows.get(key)
      if (!window || now - window.startedAt >= input.windowMs) {
        if (!window && windows.size >= maximumSubjects) {
          for (const [candidate, value] of windows) {
            if (now - value.startedAt >= input.windowMs) windows.delete(candidate)
          }
          if (windows.size >= maximumSubjects) throw new Error('[product-platform-rate-limit] subject capacity reached')
        }
        window = { startedAt: now, used: 0 }
        windows.set(key, window)
      }
      if (window.used + cost > input.limit) {
        return {
          allowed: false, limit: input.limit, remaining: Math.max(0, input.limit - window.used),
          retryAfterMs: Math.max(1, input.windowMs - (now - window.startedAt)),
        }
      }
      window.used += cost
      return {
        allowed: true, limit: input.limit, remaining: Math.max(0, input.limit - window.used), retryAfterMs: 0,
      }
    },
  }
}

export type ProductPlatformProductionDependencyV1 =
  | 'identity-provider' | 'transactional-commercial-store' | 'transactional-community-store'
  | 'transactional-online-store' | 'transactional-operations-store' | 'object-storage'
  | 'payment-provider' | 'webhook-secret-manager' | 'realtime-fanout' | 'rate-limiter'
  | 'single-writer-coordination'

export const PRODUCT_PLATFORM_PRODUCTION_DEPENDENCIES_V1: readonly ProductPlatformProductionDependencyV1[] = [
  'identity-provider', 'transactional-commercial-store', 'transactional-community-store',
  'transactional-online-store', 'transactional-operations-store', 'object-storage',
  'payment-provider', 'webhook-secret-manager', 'realtime-fanout', 'rate-limiter',
  'single-writer-coordination',
]

export function evaluateProductPlatformProductionReadinessV1(input: {
  serviceVersion: string
  environment: 'development' | 'production'
  dependencies: Partial<Record<ProductPlatformProductionDependencyV1, 'configured' | 'memory'>>
}): ProductPlatformReadinessV1 {
  if (!input.serviceVersion.trim() || input.serviceVersion.length > 100 || /[\r\n]/.test(input.serviceVersion)) throw new Error('[product-platform-router:configuration] serviceVersion 无效')
  const checks = Object.fromEntries(PRODUCT_PLATFORM_PRODUCTION_DEPENDENCIES_V1.map(key => [key, input.dependencies[key] === 'configured' ? 'ready' : input.dependencies[key] === 'memory' ? 'development-only' : 'missing'])) as ProductPlatformReadinessV1['checks']
  return { ready: input.environment === 'development' || Object.values(checks).every(value => value === 'ready'), serviceVersion: input.serviceVersion, checks }
}
