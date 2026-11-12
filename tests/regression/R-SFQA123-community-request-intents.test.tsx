import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CommunityReviewPanel from '../../src/components/community/CommunityReviewPanel'
import CommunitySafetyPanel from '../../src/components/community/CommunitySafetyPanel'
import LfgCenterPanel from '../../src/components/community/LfgCenterPanel'
import {
  CommunityPlatformAuthorityV1,
  CommunityAuthorityErrorV1,
  type CommunityPlatformPersistenceV1,
  type CommunityPlatformSnapshotV1,
  type CommunityPrincipalV1,
} from '../../src/lib/community/authority'
import { createCommunityFetchHandlerV1 } from '../../src/lib/community/fetch-service'
import { createCommunityGatewayV1, type CommunityGatewayAuditV1 } from '../../src/lib/community/gateway'
import { CommunityHttpClientV1 } from '../../src/lib/community/http-client'
import { CommunityLfgRoomHandoffServiceV1, InMemoryCommunityLfgRoomHandoffPersistenceV1, InMemoryCommunityLfgRoomSecretVaultV1 } from '../../src/lib/community/lfg-room-handoff'
import type { HostedFormalTtrpgRoomRegistryV1 } from '../../src/lib/online/ttrpg-room-registry'

const RELEASE = 'f'.repeat(64)
const HOST = 'sfqa123-test-host-access-token'
const PLAYER = 'sfqa123-test-player-access-token'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class Store implements CommunityPlatformPersistenceV1 {
  snapshot: CommunityPlatformSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommunityPlatformSnapshotV1 }) {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

async function fixture() {
  const store = new Store()
  const principals = new Map<string, CommunityPrincipalV1>([
    [HOST, { userId: 'user.host', permissions: [] }],
    [PLAYER, { userId: 'user.player', permissions: [] }],
  ])
  const authority = await CommunityPlatformAuthorityV1.create({
    persistence: store,
    releasePolicy: {
      canHost: async (userId, hash) => userId === 'user.host' && hash === RELEASE,
      canRegisterOriginal: async () => false,
      isReleaseCreator: async (userId, hash) => userId === 'user.host' && hash === RELEASE,
      reviewEligibility: async (userId, hash) => ({
        entitled: userId === 'user.player' && hash === RELEASE, creator: userId === 'user.host',
      }),
    },
  })
  type InviteInput = Parameters<HostedFormalTtrpgRoomRegistryV1['issueMatchmakingInvite']>[0]
  const invitationCalls: InviteInput[] = []
  const issuedInvites = new Map<string, { fingerprint: string; result: { roomId: string; releaseHash: string; inviteId: string; inviteToken: string } }>()
  const handoffPersistence = new InMemoryCommunityLfgRoomHandoffPersistenceV1()
  const roomHandoff = new CommunityLfgRoomHandoffServiceV1({
    community: authority, persistence: handoffPersistence, vault: new InMemoryCommunityLfgRoomSecretVaultV1(),
    // The real community handoff boundary calls a typed external issuer. Its
    // exact idempotency check makes a changing retry expiry an actual failure.
    online: { issueMatchmakingInvite: async input => {
      invitationCalls.push(structuredClone(input))
      const fingerprint = JSON.stringify(input), prior = issuedInvites.get(input.requestId)
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new CommunityAuthorityErrorV1('request_conflict', 'Invitation intent body changed')
        return structuredClone(prior.result)
      }
      const result = { roomId: input.roomId, releaseHash: RELEASE,
        inviteId: `invite.${crypto.randomUUID()}`, inviteToken: `sfqa123-secret-${crypto.randomUUID()}` }
      issuedInvites.set(input.requestId, { fingerprint, result }); return result
    } },
  })
  const audits: CommunityGatewayAuditV1[] = []
  const gateway = createCommunityGatewayV1({
    authority, roomHandoff, identity: { authenticate: async token => principals.get(token) ?? null },
    audit: entry => { audits.push(entry) },
  })
  const handler = createCommunityFetchHandlerV1({ gateway, allowedOrigins: ['https://sfqa123.test'] })
  const requests: Array<{ path: string; body: Record<string, unknown>; status: number }> = []
  let dropResponsePath: string | null = null
  const client = new CommunityHttpClientV1({
    baseUrl: 'https://api.sfqa123.test',
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      const response = await handler(new Request(url, {
        ...init, headers: { ...init?.headers, origin: 'https://sfqa123.test' },
      }))
      requests.push({ path, body, status: response.status })
      // Lose only the response after the real authority has committed its
      // receipt. The next explicit UI retry still traverses the real gateway.
      if (path === dropResponsePath && response.ok) {
        dropResponsePath = null
        throw new Error('simulated response lost after committed command')
      }
      return response
    },
  })
  for (const [token, handle, displayName] of [[HOST, 'host', 'Host'], [PLAYER, 'player', 'Player']]) {
    await client.upsertProfile({ accessToken: token, requestId: `fixture.profile.${handle}`,
      handle, displayName, bio: '', locale: 'zh-CN', timeZone: 'Asia/Shanghai', ageBand: 'adult' })
  }
  requests.length = 0; audits.length = 0
  return { store, authority, client, audits, requests, invitationCalls, issuedInvites, handoffPersistence,
    writes: (path: string) => requests.filter(item => item.path === path),
    dropNextResponse: (path: string) => { dropResponsePath = path },
  }
}

async function createHostPost(f: Awaited<ReturnType<typeof fixture>>) {
  return f.client.createLfg({ accessToken: HOST, requestId: `fixture.lfg.${crypto.randomUUID()}`, releaseHash: RELEASE,
    title: '123独立招募', summary: '完整招募说明', locale: 'zh-CN', timeZone: 'Asia/Shanghai',
    startsAt: Date.now() + 2 * 86_400_000, durationMinutes: 180, playerCapacity: 4, waitlistCapacity: 2,
    audience: 'all-ages', safetyTags: ['X-card'] })
}
async function connectHost() {
  await change('公开 handle', 'host'); await change('显示名称', '主持人')
  await change('年龄准入', 'adult'); await change('时区', 'Asia/Shanghai')
  await click(button('保存社区资料'))
  await waitFor(() => expect(document.body.textContent).toContain('社区资料已保存'))
}

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function mount(element: ReactNode) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(element))
  return (next: ReactNode) => act(async () => root.render(next))
}
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(node => node.textContent === name)
  if (!found) throw new Error(`Missing actual form button: ${name}`)
  return found
}
async function change(name: string, value: string) {
  const control = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')]
    .find(node => node.getAttribute('aria-label') === name || node.closest('label')?.childNodes[0]?.textContent === name)
  if (!control) throw new Error(`Missing actual form field: ${name}`)
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) throw new Error(`Missing native form setter: ${name}`)
  await act(async () => {
    setter.call(control, value)
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function click(node: HTMLButtonElement) { await act(async () => node.click()) }
async function waitFor(assertion: () => unknown) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    assertion()
  })
}
afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount()); item.host.remove()
  }
  vi.restoreAllMocks()
})

describe('SFQA123: actual community forms through strict client, gateway and authority', () => {
  it.each([
    { name: 'plain English review with its JSON fingerprint', title: 'Playable release', body: 'A clear and complete experience.' },
    { name: 'Chinese multiline domain maximums', title: '题'.repeat(200), body: '文'.repeat(3998) + '\n末' },
  ])('accepts $name without placing the body in its wire ID', async ({ title, body }) => {
    const f = await fixture()
    await mount(<CommunityReviewPanel client={f.client} accessToken={PLAYER} subjectType="release" releaseHash={RELEASE} heading="123评价" />)
    const submit = button('发布已验证评价')
    await change('评价标题', title)
    await change('评价正文', body)
    await waitFor(() => expect(submit.disabled).toBe(false))
    await click(submit)
    await waitFor(() => expect(f.writes('/v1/community/reviews')).toHaveLength(1))
    const wire = f.writes('/v1/community/reviews')[0]
    expect(wire.status).toBe(200)
    expect(wire.body.requestId).toMatch(UUID)
    expect(f.store.snapshot?.reviews).toMatchObject([{ title, body, authorId: 'user.player' }])
    expect(JSON.stringify(f.audits)).not.toContain(title)
    expect(JSON.stringify(f.audits)).not.toContain(body)
    expect(JSON.stringify(f.audits)).not.toContain(PLAYER)
  })

  it('saves a full Chinese profile and legitimate timezone via the actual LFG caller', async () => {
    const f = await fixture(), displayName = '名'.repeat(100)
    await mount(<LfgCenterPanel client={f.client} accessToken={HOST} releases={[]} />)
    await change('公开 handle', 'host')
    await change('显示名称', displayName)
    await change('年龄准入', 'adult')
    await change('时区', 'Asia/Shanghai')
    await click(button('保存社区资料'))
    await waitFor(() => expect(f.writes('/v1/community/profiles')).toHaveLength(1))
    expect(f.writes('/v1/community/profiles')[0]).toMatchObject({ status: 200, body: { displayName, timeZone: 'Asia/Shanghai' } })
    expect(f.writes('/v1/community/profiles')[0].body.requestId).toMatch(UUID)
    expect(f.store.snapshot?.profiles.find(row => row.userId === 'user.host')).toMatchObject({ displayName, timeZone: 'Asia/Shanghai' })
  })

  it('submits a multiline maximum-length safety report while audit omits the free body', async () => {
    const f = await fixture(), details = '报'.repeat(3998) + '\n告'
    await mount(<CommunitySafetyPanel client={f.client} accessToken={PLAYER} />)
    await change('举报对象 ID', 'user.host')
    await change('事实说明', details)
    await click(button('提交举报'))
    await waitFor(() => expect(f.writes('/v1/community/reports')).toHaveLength(1))
    const wire = f.writes('/v1/community/reports')[0]
    expect(wire.status).toBe(201)
    expect(wire.body.requestId).toMatch(UUID)
    expect(f.store.snapshot?.reports).toMatchObject([{ details, reporterId: 'user.player' }])
    expect(JSON.stringify(f.audits)).not.toContain(details)
    expect(JSON.stringify(f.audits)).not.toContain(PLAYER)
  })

  it('reuses the exact unknown-result intent, then rotates a successful new report intent', async () => {
    const f = await fixture()
    f.dropNextResponse('/v1/community/reports')
    await mount(<CommunitySafetyPanel client={f.client} accessToken={PLAYER} />)
    await change('举报对象 ID', 'user.host')
    await change('事实说明', 'payloadone')
    const submit = button('提交举报')
    await click(submit)
    await waitFor(() => expect(f.writes('/v1/community/reports')).toHaveLength(1))
    expect(f.writes('/v1/community/reports')[0].status).toBe(201)
    await waitFor(() => expect(document.body.textContent?.slice(-200)).toContain('无法连接社区服务'))
    expect(f.store.snapshot?.reports).toHaveLength(1)
    await waitFor(() => expect(submit.disabled).toBe(false))
    await click(submit)
    await waitFor(() => expect(f.writes('/v1/community/reports')).toHaveLength(2))
    expect(f.writes('/v1/community/reports')[1].status).toBe(201)
    expect(f.writes('/v1/community/reports')[1].body).toEqual(f.writes('/v1/community/reports')[0].body)
    await waitFor(() => expect(document.body.textContent?.slice(-240)).toContain('举报已进入治理队列；自由正文只对举报者和治理人员可见。'))
    expect(f.writes('/v1/community/reports')).toHaveLength(2)
    expect(f.writes('/v1/community/reports')[1].body).toEqual(f.writes('/v1/community/reports')[0].body)
    expect(f.store.snapshot?.reports).toHaveLength(1)
    await waitFor(() => expect(submit.disabled).toBe(false))
    await click(submit)
    await waitFor(() => expect(f.writes('/v1/community/reports')).toHaveLength(3))
    expect(f.writes('/v1/community/reports')[2].body.requestId).not.toBe(f.writes('/v1/community/reports')[0].body.requestId)
    expect(f.store.snapshot?.reports).toHaveLength(2)
    expect(f.writes('/v1/community/reports')[2].body.requestId).toMatch(UUID)
  })

  it('keeps an unknown report available to its original account after another account submits the same form', async () => {
    const f = await fixture()
    const panel = (token: string) => <CommunitySafetyPanel client={f.client} accessToken={token} />
    const render = await mount(panel(PLAYER))
    await change('举报对象 ID', 'room.shared')
    await change('事实说明', '两人分别举报同一个房间')
    f.dropNextResponse('/v1/community/reports')
    await click(button('提交举报'))
    await waitFor(() => expect(document.body.textContent).toContain('无法连接社区服务'))

    await render(panel(HOST))
    await click(button('提交举报'))
    await waitFor(() => expect(f.writes('/v1/community/reports')).toHaveLength(2))
    await render(panel(PLAYER))
    await click(button('提交举报'))
    await waitFor(() => expect(f.writes('/v1/community/reports')).toHaveLength(3))

    const [first, other, retry] = f.writes('/v1/community/reports')
    expect(other.body.requestId).not.toBe(first.body.requestId)
    expect(retry.body).toEqual(first.body)
    expect([first.status, other.status, retry.status]).toEqual([201, 201, 201])
    expect(f.store.snapshot?.reports.map(report => report.reporterId)).toEqual(['user.player', 'user.host'])
  })

  it('rejects unsafe request IDs without copying unknown raw data to gateway audit', async () => {
    const f = await fixture(), unsafeId = 'private report\n{"body":"正文不得进audit"}'
    await expect(f.client.createReport({ accessToken: PLAYER, requestId: unsafeId,
      subjectType: 'profile', subjectId: 'user.host', category: 'other', details: 'private detail',
    })).rejects.toMatchObject({ code: 'protocol' })
    expect(f.store.snapshot?.reports).toHaveLength(0)
    expect(f.audits).toMatchObject([{ requestId: null, outcome: 'rejected', code: 'protocol' }])
    expect(JSON.stringify(f.audits)).not.toContain('正文不得进audit')
  })

  it('accepts a legacy ASCII form key, replays its receipt and omits only unsafe audit IDs', async () => {
    const f = await fixture()
    const details = 'privatewords'
    const command = { accessToken: PLAYER, requestId: 'report:profile:user.host:other:' + details + '.' + crypto.randomUUID(),
      subjectType: 'profile' as const, subjectId: 'user.host', category: 'other' as const, details }
    const first = await f.client.createReport(command)
    expect(await f.client.createReport(command)).toEqual(first)
    expect(f.store.snapshot?.reports).toHaveLength(1)
    expect(f.audits).toHaveLength(2)
    expect(f.audits.map(entry => entry.requestId)).toEqual([null, null])
    expect(JSON.stringify(f.audits)).not.toContain(details)
    for (const requestId of ['safe.audit.123', crypto.randomUUID()]) {
      await f.client.createReport({ ...command, requestId })
      expect(f.audits[f.audits.length - 1]).toMatchObject({ requestId, outcome: 'accepted', code: 'ok' })
    }
  })

  it('changes a failed review body into a new intent and preserves the original pending receipt', async () => {
    const f = await fixture()
    await mount(<CommunityReviewPanel client={f.client} accessToken={PLAYER} subjectType="release" releaseHash={RELEASE} heading="123改稿" />)
    await change('评价标题', '首份评价'); await change('评价正文', '原正文')
    const submit = button('发布已验证评价')
    await waitFor(() => expect(submit.disabled).toBe(false))
    f.dropNextResponse('/v1/community/reviews'); await click(submit)
    await waitFor(() => expect(document.body.textContent).toContain('无法连接社区服务'))
    await change('评价正文', '修改后的正文\n第二行')
    await click(submit)
    await waitFor(() => expect(f.writes('/v1/community/reviews')).toHaveLength(2))
    const writes = f.writes('/v1/community/reviews')
    expect(writes[1].status).toBe(200)
    expect(writes[1].body.requestId).not.toBe(writes[0].body.requestId)
    expect(f.store.snapshot?.reviews).toMatchObject([{ body: '修改后的正文\n第二行' }])
    expect(f.store.snapshot?.receipts.filter(([key]) => writes.some(row => key.endsWith(String(row.body.requestId))))).toHaveLength(2)
  })

  it('retires a successful command before a separate follow-up read failure', async () => {
    const f = await fixture()
    await mount(<CommunityReviewPanel client={f.client} accessToken={PLAYER} subjectType="release" releaseHash={RELEASE} heading="123读取失败" />)
    await change('评价标题', '已成功写入'); await change('评价正文', '读取失败不能复用成功命令')
    const submit = button('发布已验证评价')
    await waitFor(() => expect(submit.disabled).toBe(false))
    f.dropNextResponse('/v1/community/reviews/list'); await click(submit)
    await waitFor(() => expect(document.body.textContent).toContain('无法连接社区服务'))
    expect(f.store.snapshot?.reviews).toHaveLength(1)
    await click(submit)
    await waitFor(() => expect(f.writes('/v1/community/reviews')).toHaveLength(2))
    const writes = f.writes('/v1/community/reviews')
    expect(writes[1].status).toBe(200)
    expect(writes[1].body.requestId).not.toBe(writes[0].body.requestId)
    expect(f.store.snapshot?.reviews).toHaveLength(1)
  })

  it('sends a Chinese creator response and keeps review ownership enforcement', async () => {
    const f = await fixture()
    const review = await f.client.upsertReview({ accessToken: PLAYER, requestId: 'fixture.review',
      subjectType: 'release', releaseHash: RELEASE, postId: null, rating: 5,
      title: '玩家评价', body: '玩家原文', tags: [], containsSpoilers: false })
    await mount(<CommunityReviewPanel client={f.client} accessToken={HOST} subjectType="release" releaseHash={RELEASE} heading="123回应" />)
    await waitFor(() => expect(button('公开回应').disabled).toBe(false))
    await click(button('公开回应')); await change(`回应评价 ${review.reviewId}`, '谢谢反馈，已收到。')
    await click(button('发布回应'))
    await waitFor(() => expect(f.writes('/v1/community/reviews/respond')).toHaveLength(1))
    expect(f.writes('/v1/community/reviews/respond')[0]).toMatchObject({ status: 200, body: { response: '谢谢反馈，已收到。' } })
    expect(f.writes('/v1/community/reviews/respond')[0].body.requestId).toMatch(UUID)
    expect(f.store.snapshot?.reviews[0]).toMatchObject({ authorId: 'user.player', creatorResponse: '谢谢反馈，已收到。' })
    expect(JSON.stringify(f.audits)).not.toContain('谢谢反馈')
  })

  it('submits a maximum-length Chinese appeal through the subject account and retries its committed receipt', async () => {
    const f = await fixture(), statement = '诉'.repeat(3998) + '\n明'
    const report = await f.client.createReport({ accessToken: HOST, requestId: 'fixture.actioned.report',
      subjectType: 'profile', subjectId: 'user.player', category: 'other', details: 'subject case' })
    await f.authority.decideReport({ principal: { userId: 'user.moderator', permissions: ['community:moderate'] },
      requestId: 'fixture.action', reportId: report.reportId, action: 'warning', reasonCode: 'warning.123' })
    await mount(<CommunitySafetyPanel client={f.client} accessToken={PLAYER} />)
    await click(button('刷新'))
    await waitFor(() => expect(button('对此处罚申诉')).toBeDefined())
    await click(button('对此处罚申诉')); await change('申诉陈述', statement)
    f.dropNextResponse('/v1/community/appeals'); await click(button('提交独立复核'))
    await waitFor(() => expect(document.body.textContent).toContain('无法连接社区服务'))
    expect(f.store.snapshot?.appeals).toMatchObject([{ appellantId: 'user.player', statement }])
    await click(button('提交独立复核'))
    await waitFor(() => expect(f.writes('/v1/community/appeals')).toHaveLength(2))
    const writes = f.writes('/v1/community/appeals')
    expect(writes.map(row => row.status)).toEqual([201, 201])
    expect(writes[1].body).toEqual(writes[0].body)
    expect(writes[0].body.requestId).toMatch(UUID)
    expect(f.store.snapshot?.appeals).toHaveLength(1)
    expect(JSON.stringify(f.audits)).not.toContain(statement)
  })

  it('binds real LFG JSON seats with a stable expiry after a lost response', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const f = await fixture(), post = await createHostPost(f)
    const application = await f.client.applyToLfg({ accessToken: PLAYER, requestId: 'fixture.application',
      postId: post.postId, characterPreference: '调查员', note: '绑定测试' })
    await f.client.decideApplication({ accessToken: HOST, requestId: 'fixture.accept', applicationId: application.applicationId, decision: 'accept' })
    await mount(<LfgCenterPanel client={f.client} accessToken={HOST} releases={[{ releaseHash: RELEASE, title: '123发行' }]} />)
    await connectHost(); await click(button('刷新招募'))
    await waitFor(() => expect(button('管理申请')).toBeDefined()); await click(button('管理申请'))
    await waitFor(() => expect(document.body.textContent).toContain('分配权威在线房间'))
    await change(`角色席位 ${application.applicationId}`, 'investigator.123')
    await change('交接在线房间 ID', 'room.sfqa123')
    f.dropNextResponse('/v1/community/lfg/room-handoffs/bind'); await click(button('分配在线席位'))
    await waitFor(() => expect(document.body.textContent).toContain('无法连接社区服务'))
    const frozen = await f.handoffPersistence.load(application.applicationId)
    expect(frozen).toMatchObject({ applicantId: 'user.player', actorKey: 'investigator.123', roomId: 'room.sfqa123' })
    now += 5_000
    await click(button('分配在线席位'))
    await waitFor(() => expect(f.writes('/v1/community/lfg/room-handoffs/bind')).toHaveLength(2))
    const writes = f.writes('/v1/community/lfg/room-handoffs/bind')
    expect(writes.map(row => row.status)).toEqual([200, 200])
    expect(writes[0].body.requestId).toMatch(UUID)
    expect(writes[1].body).toEqual(writes[0].body)
    expect(f.invitationCalls).toHaveLength(2)
    expect(f.invitationCalls[1]).toEqual(f.invitationCalls[0])
    expect(f.issuedInvites.size).toBe(1)
    expect(await f.handoffPersistence.load(application.applicationId)).toEqual(frozen)
    const claim = await f.client.claimRoomHandoff({ accessToken: PLAYER, applicationId: application.applicationId })
    expect(claim).toMatchObject({ roomId: 'room.sfqa123', actorKey: 'investigator.123', releaseHash: RELEASE })
    expect(JSON.stringify(f.audits)).not.toContain(claim.inviteToken)
    expect(JSON.stringify(f.audits)).not.toContain(JSON.stringify(writes[0].body.bindings))
  })

  it('withdraws only the account-owned review through the unchanged authority guard', async () => {
    const f = await fixture()
    await f.client.upsertReview({ accessToken: PLAYER, requestId: 'fixture.withdraw.review', subjectType: 'release',
      releaseHash: RELEASE, postId: null, rating: 4, title: '本人评价', body: '可撤回的原评价', tags: [], containsSpoilers: false })
    await mount(<CommunityReviewPanel client={f.client} accessToken={PLAYER} subjectType="release" releaseHash={RELEASE} heading="123撤回" />)
    await waitFor(() => expect(button('撤回我的评价').disabled).toBe(false))
    await click(button('撤回我的评价'))
    await waitFor(() => expect(f.writes('/v1/community/reviews/withdraw')).toHaveLength(1))
    expect(f.writes('/v1/community/reviews/withdraw')[0]).toMatchObject({ status: 200 })
    expect(f.writes('/v1/community/reviews/withdraw')[0].body.requestId).toMatch(UUID)
    expect(f.store.snapshot?.reviews).toMatchObject([{ authorId: 'user.player', status: 'withdrawn' }])
  })

  it('rotates a changed LFG summary and capacity after a lost create response', async () => {
    const f = await fixture()
    await mount(<LfgCenterPanel client={f.client} accessToken={HOST} releases={[{ releaseHash: RELEASE, title: '123发行' }]} />)
    await connectHost()
    await change('开团时间', new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 16))
    await change('标题', '团'.repeat(200)); await change('说明', '述'.repeat(4000))
    f.dropNextResponse('/v1/community/lfg'); await click(button('发布招募'))
    await waitFor(() => expect(document.body.textContent).toContain('无法连接社区服务'))
    expect(f.store.snapshot?.lfgPosts).toHaveLength(1)
    await change('说明', '作者修改了招募说明'); await change('正式席位', '5')
    await click(button('发布招募'))
    await waitFor(() => expect(f.writes('/v1/community/lfg')).toHaveLength(2))
    const writes = f.writes('/v1/community/lfg')
    expect(writes.map(row => row.status)).toEqual([201, 201])
    expect(writes[0].body.requestId).toMatch(UUID)
    expect(writes[1].body.requestId).not.toBe(writes[0].body.requestId)
    expect(writes[1].body).toMatchObject({ summary: '作者修改了招募说明', playerCapacity: 5 })
    expect(f.store.snapshot?.lfgPosts).toHaveLength(2)
    expect(f.store.snapshot?.lfgPosts.every(row => row.creatorId === 'user.host')).toBe(true)
    expect(JSON.stringify(f.audits)).not.toContain('作者修改了招募说明')
  })

  it('treats an edited unknown-result application as a new intent while retaining the domain duplicate guard', async () => {
    const f = await fixture(), post = await createHostPost(f)
    await mount(<LfgCenterPanel client={f.client} accessToken={PLAYER} releases={[]} />)
    await click(button('刷新招募'))
    await waitFor(() => expect(button('申请加入').disabled).toBe(false))
    await change('角色偏好', '调查员'); await change('给主持人的私密备注', '原私密备注')
    f.dropNextResponse('/v1/community/lfg/applications'); await click(button('申请加入'))
    await waitFor(() => expect(document.body.textContent).toContain('无法连接社区服务'))
    await change('给主持人的私密备注', '修改后的私密备注')
    await click(button('申请加入'))
    await waitFor(() => expect(f.writes('/v1/community/lfg/applications')).toHaveLength(2))
    const writes = f.writes('/v1/community/lfg/applications')
    expect(writes[0].status).toBe(201)
    expect(writes[1].status).toBeGreaterThanOrEqual(400)
    expect(writes[0].body.requestId).toMatch(UUID)
    expect(writes[1].body.requestId).not.toBe(writes[0].body.requestId)
    const applicationAudits = f.audits.filter(row => row.path === '/v1/community/lfg/applications')
    expect(applicationAudits[applicationAudits.length - 1]).toMatchObject({ code: 'application_exists' })
    expect(f.store.snapshot?.lfgApplications).toMatchObject([{ postId: post.postId, note: '原私密备注', userId: 'user.player' }])
    expect(JSON.stringify(f.audits)).not.toContain('修改后的私密备注')
    await waitFor(() => expect(button('刷新招募').disabled).toBe(false))
    await click(button('刷新招募'))
    await waitFor(() => expect(document.body.textContent).toContain('已申请 · pending'))
    expect(f.writes('/v1/community/lfg/applications')).toHaveLength(2)
  })

})
