import { describe, expect, it, vi } from 'vitest'
import {
  createProductPlatformServiceRouterV1,
  createMemoryProductPlatformRateLimiterV1,
  evaluateProductPlatformProductionReadinessV1,
  type ProductPlatformRequestGuardAuditV1,
} from '../../src/lib/product-platform/service-router'

function guard(input: { limit?: number; audits?: ProductPlatformRequestGuardAuditV1[] } = {}) {
  return {
    resolveSubject: async () => ({ subjectKey: 'verified:test-user', subjectKind: 'account' as const }),
    rateLimiter: createMemoryProductPlatformRateLimiterV1({ limit: input.limit ?? 100, windowMs: 60_000 }),
    audit: async (entry: ProductPlatformRequestGuardAuditV1) => { input.audits?.push(entry) },
    now: () => 1_000,
  }
}

describe('PLATFORM-1F · unified deployable service router and readiness', () => {
  it('按稳定前缀只调用一个领域处理器，原始请求体仍可由领域边界读取', async () => {
    const seen: string[] = []
    const handler = (name: string) => vi.fn(async (request: Request) => {
      seen.push(`${name}:${new URL(request.url).pathname}:${await request.text()}`)
      return new Response(JSON.stringify({ domain: name }), { status: 200 })
    })
    const commercial = handler('commercial'); const community = handler('community')
    const online = handler('online'); const operations = handler('operations')
    const router = createProductPlatformServiceRouterV1({
      commercial, community, online, operations,
      readiness: () => ({ ready: true, serviceVersion: '1.0.0', checks: {} }),
      guard: guard(),
    })
    await expect((await router(new Request('https://platform.test/v1/commercial/discover', { method: 'POST', body: '{}' }))).json()).resolves.toEqual({ domain: 'commercial' })
    await expect((await router(new Request('https://platform.test/v1/community/lfg/discover', { method: 'POST', body: '{"q":1}' }))).json()).resolves.toEqual({ domain: 'community' })
    await expect((await router(new Request('https://platform.test/v1/rooms/wait', { method: 'POST', body: '{"cursor":2}' }))).json()).resolves.toEqual({ domain: 'online' })
    await expect((await router(new Request('https://platform.test/v1/operations/status', { method: 'POST', body: '{}' }))).json()).resolves.toEqual({ domain: 'operations' })
    expect(seen).toEqual([
      'commercial:/v1/commercial/discover:{}', 'community:/v1/community/lfg/discover:{"q":1}',
      'online:/v1/rooms/wait:{"cursor":2}', 'operations:/v1/operations/status:{}',
    ])
    expect(commercial).toHaveBeenCalledTimes(1); expect(community).toHaveBeenCalledTimes(1)
    expect(online).toHaveBeenCalledTimes(1); expect(operations).toHaveBeenCalledTimes(1)
  })

  it('生产环境缺少托管依赖时健康检查返回 503；内存实现只允许开发态', async () => {
    const development = evaluateProductPlatformProductionReadinessV1({
      serviceVersion: 'dev', environment: 'development', dependencies: { 'identity-provider': 'memory' },
    })
    expect(development).toMatchObject({ ready: true, checks: { 'identity-provider': 'development-only', 'payment-provider': 'missing' } })
    const production = evaluateProductPlatformProductionReadinessV1({
      serviceVersion: '2026.08.21', environment: 'production',
      dependencies: { 'identity-provider': 'configured', 'transactional-commercial-store': 'memory' },
    })
    expect(production.ready).toBe(false)
    const unavailable = vi.fn(async () => new Response(null, { status: 500 }))
    const router = createProductPlatformServiceRouterV1({ commercial: unavailable, community: unavailable, online: unavailable, operations: unavailable, readiness: () => production, guard: guard() })
    const response = await router(new Request('https://platform.test/healthz/platform'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ ready: false, checks: { 'transactional-commercial-store': 'development-only', 'object-storage': 'missing' } })
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('未知路径和错误健康检查方法 fail-closed', async () => {
    const unavailable = vi.fn(async () => new Response(null, { status: 500 }))
    const router = createProductPlatformServiceRouterV1({ commercial: unavailable, community: unavailable, online: unavailable, operations: unavailable, readiness: () => ({ ready: true, serviceVersion: '1', checks: {} }), guard: guard() })
    expect((await router(new Request('https://platform.test/v1/private/admin'))).status).toBe(404)
    expect((await router(new Request('https://platform.test/healthz/platform', { method: 'POST' }))).status).toBe(405)
  })

  it('每个领域请求先经过可信主体、限流与无凭据审计；超限返回 429 且不调用领域处理器', async () => {
    const audits: ProductPlatformRequestGuardAuditV1[] = []
    const commercial = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const unavailable = vi.fn(async () => new Response(null, { status: 500 }))
    const router = createProductPlatformServiceRouterV1({
      commercial, community: unavailable, online: unavailable, operations: unavailable,
      readiness: () => ({ ready: true, serviceVersion: '1', checks: {} }),
      guard: guard({ limit: 1, audits }),
    })
    const first = await router(new Request('https://platform.test/v1/commercial/discover', {
      headers: { authorization: 'Bearer must-not-enter-audit', 'x-request-id': 'request-0001' },
    }))
    expect(first.status).toBe(200)
    expect(first.headers.get('ratelimit-remaining')).toBe('0')
    expect(first.headers.get('x-request-id')).toBe('request-0001')
    const second = await router(new Request('https://platform.test/v1/commercial/discover'))
    expect(second.status).toBe(429)
    expect(second.headers.get('retry-after')).toBe('60')
    expect(commercial).toHaveBeenCalledTimes(1)
    expect(audits.map(item => [item.phase, item.status])).toEqual([
      ['admitted', null], ['completed', 200], ['completed', 429],
    ])
    expect(JSON.stringify(audits)).not.toContain('must-not-enter-audit')
    expect(JSON.stringify(audits)).not.toContain('verified:test-user')
  })

  it('请求守卫或审计不可用时 fail-closed，领域处理器不会收到请求', async () => {
    const handler = vi.fn(async () => new Response(null, { status: 200 }))
    const router = createProductPlatformServiceRouterV1({
      commercial: handler, community: handler, online: handler, operations: handler,
      readiness: () => ({ ready: true, serviceVersion: '1', checks: {} }),
      guard: {
        resolveSubject: async () => { throw new Error('identity provider down') },
        rateLimiter: createMemoryProductPlatformRateLimiterV1({ limit: 1, windowMs: 1000 }),
        audit: async () => undefined,
      },
    })
    const response = await router(new Request('https://platform.test/v1/community/lfg/discover'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'platform_guard_unavailable' })
    expect(handler).not.toHaveBeenCalled()
  })
})
