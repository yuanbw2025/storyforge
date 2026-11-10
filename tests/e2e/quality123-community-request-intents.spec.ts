import { expect, test } from '@playwright/test'
import type { CommunityPlatformSnapshotV1 } from '../../src/lib/community/authority'
import type { CommunityGatewayAuditV1 } from '../../src/lib/community/gateway'

interface CommunityObservation {
  snapshot(): CommunityPlatformSnapshotV1 | null
  requests: Array<{ path: string; body: Record<string, unknown>; status: number }>
  audits: CommunityGatewayAuditV1[]
  dropResponsePath: string | null
  ownersBefore: string
  postId: string
}
type CommunityWindow = typeof window & { __sfqa123?: CommunityObservation }

const API = 'https://api.sfqa123.test'
const HOST = 'sfqa123-browser-test-host-token'
const PLAYER = 'sfqa123-browser-test-player-token'
const RELEASE = 'f'.repeat(64)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

test.use({ storageState: { cookies: [], origins: [] } })

// Actual CommunityPage/Marketplace callers and protocol implementation, with
// only a private in-browser Request/Response transport and synthetic accounts.
// This test does not contact a deployed community service or a real model.
test('community forms keep free text in bodies and exact unknown-result commands idempotent', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000)
  const origin = new URL(baseURL!).origin
  let modelRequests = 0
  const modelPath = /\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/
  await page.route(url => url.origin !== origin || modelPath.test(url.pathname), route => {
    if (modelPath.test(new URL(route.request().url()).pathname)) modelRequests += 1
    return route.abort()
  })
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'sfqa123-isolated')
    localStorage.setItem('storyforge:experimental-products', 'enabled')
  })
  await page.goto(new URL('community/market', baseURL!).href)
  const market = page.getByTestId('community-marketplace')
  await expect(market).toBeVisible({ timeout: 45_000 })
  await page.evaluate(async ({ api, host, player, release }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const [authorityModule, gatewayModule, fetchModule, clientModule, schema] = await Promise.all([
      load('/storyforge/src/lib/community/authority.ts'), load('/storyforge/src/lib/community/gateway.ts'),
      load('/storyforge/src/lib/community/fetch-service.ts'), load('/storyforge/src/lib/community/http-client.ts'),
      load('/storyforge/src/lib/db/schema.ts'),
    ]) as [typeof import('../../src/lib/community/authority'), typeof import('../../src/lib/community/gateway'),
      typeof import('../../src/lib/community/fetch-service'), typeof import('../../src/lib/community/http-client'),
      typeof import('../../src/lib/db/schema')]
    let snapshot: CommunityPlatformSnapshotV1 | null = null
    let now = Date.now()
    const authority = await authorityModule.CommunityPlatformAuthorityV1.create({
      now: () => now,
      persistence: {
        load: async () => snapshot ? structuredClone(snapshot) : null,
        compareAndSwap: async input => {
          if ((snapshot?.revision ?? null) !== input.expectedRevision) return false
          snapshot = structuredClone(input.snapshot); return true
        },
      },
      releasePolicy: {
        canHost: async (userId, hash) => userId === 'user.host' && hash === release,
        canRegisterOriginal: async () => false,
        isReleaseCreator: async (userId, hash) => userId === 'user.host' && hash === release,
        reviewEligibility: async (userId, hash) => ({ entitled: userId === 'user.player' && hash === release, creator: false }),
      },
    })
    const state: CommunityObservation = { snapshot: () => snapshot, requests: [], audits: [], dropResponsePath: null,
      ownersBefore: JSON.stringify({ projects: await schema.db.projects.toArray(), worlds: await schema.db.worlds.toArray(), works: await schema.db.works.toArray() }), postId: '' }
    ;(window as CommunityWindow).__sfqa123 = state
    const gateway = gatewayModule.createCommunityGatewayV1({ authority, now: () => now,
      identity: { authenticate: async token => token === host ? { userId: 'user.host', permissions: [] }
        : token === player ? { userId: 'user.player', permissions: [] } : null },
      audit: entry => { state.audits.push(entry) },
    })
    const handler = fetchModule.createCommunityFetchHandlerV1({ gateway, allowedOrigins: [location.origin] })
    const platformFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href)
      if (url.origin !== api) return platformFetch(input, init)
      const request = new Request(input, init)
      const body = await request.clone().json() as Record<string, unknown>
      const response = await handler(request)
      state.requests.push({ path: url.pathname, body, status: response.status })
      if (state.dropResponsePath === url.pathname && response.ok) {
        state.dropResponsePath = null
        throw new TypeError('Synthetic response loss after actual committed receipt')
      }
      return response
    }
    const client = new clientModule.CommunityHttpClientV1({ baseUrl: api })
    for (const [accessToken, handle] of [[host, 'host'], [player, 'player']]) {
      await client.upsertProfile({ accessToken, requestId: `fixture.profile.${handle}`, handle,
        displayName: handle, bio: '', locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand: 'adult' })
    }
    const post = await client.createLfg({ accessToken: host, requestId: 'fixture.post', releaseHash: release,
      title: '123浏览器历史场次', summary: '已确认出席的私有测试场次', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
      startsAt: now + 60_000, durationMinutes: 30, playerCapacity: 4, waitlistCapacity: 0,
      audience: 'all-ages', safetyTags: ['X-card'] })
    const application = await client.applyToLfg({ accessToken: player, requestId: 'fixture.apply', postId: post.postId, characterPreference: '调查员', note: '' })
    await client.decideApplication({ accessToken: host, requestId: 'fixture.accept', applicationId: application.applicationId, decision: 'accept' })
    await client.markAttendance({ accessToken: host, requestId: 'fixture.attendance', applicationId: application.applicationId, status: 'confirmed' })
    now += 120_000
    await client.closeLfg({ accessToken: host, requestId: 'fixture.close', postId: post.postId, status: 'closed' })
    state.postId = post.postId; state.requests.length = 0; state.audits.length = 0
  }, { api: API, host: HOST, player: PLAYER, release: RELEASE })
  await market.getByLabel('市场服务地址', { exact: true }).fill(API)
  await market.getByLabel('账号访问凭据（仅保存在当前页面内存）', { exact: true }).fill(PLAYER)
  await market.getByRole('button', { name: '组团中心', exact: true }).click()
  const groups = page.getByTestId('lfg-center')
  await groups.getByLabel('公开 handle', { exact: true }).fill('player')
  await groups.getByLabel('显示名称', { exact: true }).fill('中文浏览器玩家')
  await groups.getByLabel('时区', { exact: true }).fill('Asia/Shanghai')
  await groups.getByRole('combobox', { name: '年龄准入', exact: true }).selectOption('adult')
  await groups.getByRole('button', { name: '保存社区资料', exact: true }).click()
  await expect(groups.getByText('社区资料已保存；年龄段只用于招募准入，不在公开卡片展示。', { exact: true })).toBeVisible()
  await groups.getByRole('button', { name: '刷新招募', exact: true }).click()
  await groups.getByRole('button', { name: '评价实际场次 · 123浏览器历史场次', exact: true }).click()
  const reviews = groups.getByTestId('community-review-panel')
  await reviews.getByLabel('评价标题', { exact: true }).fill('Native English Review')
  await reviews.getByLabel('评价正文', { exact: true }).fill('Plain English first line.\nSecond line.')
  await page.evaluate(() => { (window as CommunityWindow).__sfqa123!.dropResponsePath = '/v1/community/reviews' })
  await reviews.getByRole('button', { name: '发布已验证评价', exact: true }).click()
  await expect(reviews.getByText('无法连接社区服务', { exact: true })).toBeVisible()
  await reviews.getByRole('button', { name: '发布已验证评价', exact: true }).click()
  await expect(reviews.getByText('已发布已验证参团评价。', { exact: true })).toBeVisible()
  const reviewRetry = await page.evaluate(() => {
    const state = (window as CommunityWindow).__sfqa123!, writes = state.requests.filter(row => row.path === '/v1/community/reviews')
    return { statuses: writes.map(row => row.status), sameBody: JSON.stringify(writes[0].body) === JSON.stringify(writes[1].body),
      ids: writes.map(row => row.body.requestId), count: state.snapshot()!.reviews.length }
  })
  expect(reviewRetry).toMatchObject({ statuses: [200, 200], sameBody: true, count: 1 })
  reviewRetry.ids.forEach(id => expect(id).toMatch(UUID))
  await reviews.getByLabel('评价正文', { exact: true }).fill('Edited after an acknowledged success.')
  await reviews.getByRole('button', { name: '发布已验证评价', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as CommunityWindow).__sfqa123!.requests.filter(row => row.path === '/v1/community/reviews').length)).toBe(3)
  const revisedId = await page.evaluate(() => (window as CommunityWindow).__sfqa123!.requests.filter(row => row.path === '/v1/community/reviews')[2].body.requestId)
  expect(revisedId).toMatch(UUID); expect(revisedId).not.toBe(reviewRetry.ids[0])
  await market.getByRole('button', { name: '安全与申诉', exact: true }).click()
  const safety = page.getByTestId('community-safety-center')
  await safety.getByLabel('举报对象 ID', { exact: true }).fill('user.host')
  await safety.getByLabel('事实说明', { exact: true }).fill('中文举报第一行\n第二行')
  await page.evaluate(() => { (window as CommunityWindow).__sfqa123!.dropResponsePath = '/v1/community/reports' })
  await safety.getByRole('button', { name: '提交举报', exact: true }).click()
  await expect(safety.getByText('无法连接社区服务', { exact: true })).toBeVisible()
  const credential = market.getByLabel('账号访问凭据（仅保存在当前页面内存）', { exact: true })
  await credential.fill(HOST)
  await safety.getByRole('button', { name: '提交举报', exact: true }).click()
  await expect(safety.getByText('举报已进入治理队列；自由正文只对举报者和治理人员可见。', { exact: true })).toBeVisible()
  await credential.fill(PLAYER)
  await safety.getByRole('button', { name: '提交举报', exact: true }).click()
  await expect(safety.getByText('举报已进入治理队列；自由正文只对举报者和治理人员可见。', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as CommunityWindow).__sfqa123!.requests.filter(row => row.path === '/v1/community/reports').length)).toBe(3)
  const reportRetry = await page.evaluate(() => {
    const state = (window as CommunityWindow).__sfqa123!, writes = state.requests.filter(row => row.path === '/v1/community/reports')
    return { statuses: writes.map(row => row.status), sameBody: JSON.stringify(writes[0].body) === JSON.stringify(writes[2].body),
      ids: writes.map(row => row.body.requestId), reporters: state.snapshot()!.reports.map(report => report.reporterId) }
  })
  expect(reportRetry).toMatchObject({ statuses: [201, 201, 201], sameBody: true, reporters: ['user.player', 'user.host'] })
  expect(reportRetry.ids[1]).not.toBe(reportRetry.ids[0])
  reportRetry.ids.forEach(id => expect(id).toMatch(UUID))
  const final = await page.evaluate(async ({ api, player }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const [clients, schema] = await Promise.all([load('/storyforge/src/lib/community/http-client.ts'), load('/storyforge/src/lib/db/schema.ts')]) as [typeof import('../../src/lib/community/http-client'), typeof import('../../src/lib/db/schema')]
    const client = new clients.CommunityHttpClientV1({ baseUrl: api }), state = (window as CommunityWindow).__sfqa123!
    let rejected = ''
    try { await client.createReport({ accessToken: player, requestId: 'never-log-this\n{"private":"自由正文"}',
      subjectType: 'profile', subjectId: 'user.host', category: 'other', details: 'private synthetic audit probe' }) }
    catch (cause) { rejected = cause instanceof clients.CommunityHttpErrorV1 ? cause.code : 'unknown' }
    const auditText = JSON.stringify(state.audits), snapshot = state.snapshot()!
    return { rejected, unsafeAuditId: state.audits[state.audits.length - 1]?.requestId,
      freeBodyAbsent: ['中文浏览器玩家', 'Native English Review', 'Plain English first line.', 'Edited after an acknowledged success.', '中文举报第一行', 'never-log-this', '自由正文', player].every(value => !auditText.includes(value)),
      profile: snapshot.profiles.find(row => row.userId === 'user.player')?.displayName,
      reviews: snapshot.reviews.map(row => ({ authorId: row.authorId, body: row.body })),
      reports: snapshot.reports.length,
      ownersUnchanged: state.ownersBefore === JSON.stringify({ projects: await schema.db.projects.toArray(), worlds: await schema.db.worlds.toArray(), works: await schema.db.works.toArray() }) }
  }, { api: API, player: PLAYER })
  expect(final).toMatchObject({ rejected: 'protocol', unsafeAuditId: null, freeBodyAbsent: true,
    profile: '中文浏览器玩家', reviews: [{ authorId: 'user.player', body: 'Edited after an acknowledged success.' }], reports: 2, ownersUnchanged: true })
  expect(modelRequests).toBe(0)
  await safety.screenshot({ path: testInfo.outputPath('community-accepted-report.png') })
  await testInfo.attach('sfqa123-community-request-proof', { body: Buffer.from(JSON.stringify({ reviewRetry, reportRetry, final, modelRequests }, null, 2)), contentType: 'application/json' })
})

test('marketplace favorite actions use the active credential and service', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const first = origin + '/sfqa123/first'
  const second = origin + '/sfqa123/second'
  const listing = {
    listingId: 'listing.scope', releaseHash: RELEASE, creatorId: 'creator.scope', productType: 'avg',
    title: '合成作品', summary: '隔离市场', contentWarnings: [], license: {
      licenseId: 'license.scope', licenseVersion: '1.0.0', allowOfflineExport: true,
      allowRemix: false, commercialReuse: false, requiresAttribution: false,
      termsUrl: 'https://terms.example.invalid/license',
    },
    currency: 'CNY', amountMinor: 0, creatorShareBps: 8000, status: 'published', rightsConfirmed: true,
    reviewedBy: 'reviewer.scope', reviewReasonCode: null, createdAt: 1, updatedAt: 1,
  }
  const commands: Array<[string, string, boolean]> = []
  const ids: string[] = []
  let interruptWrite = false
  const rows = new Map<string, { edgeId: string; kind: string; actorId: string; targetId: string; active: boolean; createdAt: number; updatedAt: number }>()
  await page.route(url => url.origin !== origin || url.pathname.startsWith('/sfqa123/'), async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    const service = [first, second].find(value => url.href.startsWith(value + '/'))
    if (!service) return route.abort()
    const path = url.href.slice(service.length)
    const token = request.headers().authorization?.replace(/^Bearer /, '') ?? ''
    const owner = [service, token].join('/')
    if (path === '/v1/commercial/discover') return route.fulfill({ json: [listing] })
    if (path === '/v1/community/social/mine') return route.fulfill({ json: rows.has(owner) ? [rows.get(owner)] : [] })
    if (path !== '/v1/community/social') return route.abort()
    const body = request.postDataJSON()
    const edge = { edgeId: 'edge.scope', actorId: token, kind: body.kind, targetId: body.targetId, active: body.active, createdAt: 1, updatedAt: 1 }
    commands.push([service, token, body.active])
    ids.push(body.requestId)
    if (interruptWrite) { interruptWrite = false; return route.abort() }
    if (edge.active) rows.set(owner, edge)
    else rows.delete(owner)
    return route.fulfill({ json: edge })
  })
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'sfqa123-isolated')
    localStorage.setItem('storyforge:experimental-products', 'enabled')
  })
  await page.goto(new URL('community/market', baseURL!).href)
  const panel = page.getByTestId('community-marketplace')
  const service = panel.getByLabel('市场服务地址', { exact: true })
  const token = panel.getByLabel('账号访问凭据（仅保存在当前页面内存）', { exact: true })
  const action = (name: string) => panel.getByRole('button', { name, exact: true })
  await service.fill(first)
  await token.fill(HOST)
  await action('刷新').click()
  await action('收藏').click()
  await expect(action('已收藏')).toBeVisible()
  await token.fill(PLAYER)
  await token.press('Tab')
  await action('收藏').click()
  await expect(action('已收藏')).toBeVisible()
  await token.fill(HOST)
  await token.press('Tab')
  await action('已收藏').click()
  await expect(action('收藏')).toBeVisible()
  await service.fill(second)
  await action('刷新').click()
  await action('收藏').click()
  await expect(action('已收藏')).toBeVisible()
  interruptWrite = true
  await action('已收藏').click()
  await expect(panel.getByText(/无法连接社区服务/)).toBeVisible()
  await service.fill(first)
  await action('刷新').click()
  await expect(action('收藏')).toBeVisible()
  await service.fill(second)
  await action('刷新').click()
  await action('已收藏').click()
  await expect(action('收藏')).toBeVisible()
  expect(commands).toEqual([[first, HOST, true], [first, PLAYER, true], [first, HOST, false], [second, HOST, true], [second, HOST, false], [second, HOST, false]])
  expect(ids[4]).toMatch(UUID)
  expect(ids[5]).toBe(ids[4])
})
