import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarketplacePanel from '../../src/components/community/MarketplacePanel'
import { db } from '../../src/lib/db/schema'
import type { CommercialListingV1 } from '../../src/lib/commercial/authority'
import type { ProductDistributionBundleV1 } from '../../src/lib/product-platform/distribution-bundle'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const RELEASE = 'a'.repeat(64)
const listing: CommercialListingV1 = {
  listingId: 'listing.market-ui', releaseHash: RELEASE, creatorId: 'user.creator',
  productType: 'avg', title: '市场短篇', summary: '严格客户端可发现的完整作品', contentWarnings: [],
  license: {
    licenseId: 'license.ui', licenseVersion: '1.0.0', allowOfflineExport: true,
    allowRemix: false, commercialReuse: false, requiresAttribution: false,
    termsUrl: 'https://storyforge.example/licenses/ui',
  },
  currency: 'CNY', amountMinor: 2_900, creatorShareBps: 8_000,
  status: 'published', rightsConfirmed: true, reviewedBy: 'user.publisher', reviewReasonCode: null, createdAt: 1, updatedAt: 1,
}

function client() {
  return {
    discover: vi.fn().mockResolvedValue([listing]),
    acquire: vi.fn().mockResolvedValue({
      order: {
        orderId: 'order.ui', listingId: listing.listingId, releaseHash: RELEASE,
        buyerId: 'user.buyer', creatorId: 'user.creator', currency: 'CNY', amountMinor: 2_900,
        creatorShareMinor: 2_320, platformShareMinor: 580, status: 'pending', providerReference: null,
        createdAt: 1, updatedAt: 1,
      },
      entitlement: null,
      checkout: {
        checkoutSessionId: 'checkout.ui', orderId: 'order.ui',
        checkoutUrl: 'https://pay.storyforge.example/checkout/ui', expiresAt: Date.now() + 60_000,
      },
    }),
    downloadRelease: vi.fn(),
    createListing: vi.fn().mockResolvedValue({ ...listing, status: 'draft', amountMinor: 0 }),
    registerRelease: vi.fn().mockResolvedValue({ releaseHash: RELEASE, bundleHash: 'b'.repeat(64), duplicate: false }),
    submitListing: vi.fn().mockResolvedValue({ ...listing, status: 'submitted', amountMinor: 0 }),
    myListings: vi.fn().mockResolvedValue([{ ...listing, status: 'submitted', amountMinor: 0 }]),
    reviewQueue: vi.fn().mockResolvedValue([{ ...listing, status: 'submitted', amountMinor: 0 }]),
    publishListing: vi.fn().mockResolvedValue(listing),
    requestListingChanges: vi.fn().mockResolvedValue({ ...listing, status: 'changes-requested', reviewReasonCode: 'catalog.fix' }),
    reviseListing: vi.fn().mockResolvedValue({ ...listing, status: 'draft', reviewReasonCode: null }),
    suspendListing: vi.fn().mockResolvedValue({ ...listing, status: 'suspended' }),
    withdrawListing: vi.fn().mockResolvedValue({ ...listing, status: 'withdrawn' }),
  }
}

function button(host: ParentNode, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!result) throw new Error(`找不到按钮:${label}`)
  return result
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function setTextarea(input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function labeledInput(host: ParentNode, label: string): HTMLInputElement {
  const wrapper = [...host.querySelectorAll('label')].find(item => item.textContent?.includes(label))
  const input = wrapper?.querySelector<HTMLInputElement>('input')
  if (!input) throw new Error(`找不到输入框:${label}`)
  return input
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const started = Date.now(); let last: unknown
  while (Date.now() - started < 5_000) {
    try { await act(async () => { await assertion() }); return }
    catch (cause) { last = cause; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
  }
  throw last
}

describe('PLATFORM-1E · Marketplace product UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    localStorage.clear(); await db.delete(); await db.open()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  afterAll(() => db.close())

  it('发现付费发行物、以内存凭据建单，并只把 HTTPS 结账链接交给显式用户点击', async () => {
    const fake = client()
    await act(async () => { root.render(createElement(MarketplacePanel, { client: fake as never })); await settle() })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-buyer-12345678901'))
    await act(async () => { button(host, '刷新').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('市场短篇'))
    await act(async () => { button(host, '创建支付订单').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('前往支付'))
    const payment = [...host.querySelectorAll('a')].find(item => item.textContent?.includes('前往支付'))!
    expect(payment.href).toBe('https://pay.storyforge.example/checkout/ui')
    expect(payment.rel).toBe('noopener noreferrer')
    expect(fake.acquire).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-buyer-12345678901', listingId: listing.listingId,
      requestId: expect.stringMatching(/^acquire\./),
    }))
    expect(JSON.stringify(localStorage)).not.toContain('token-buyer')
  })

  it('创作者对本地正式 Release 依次执行冻结、建目录、上传和提交审核', async () => {
    await db.productReleases.add({
      projectId: 1, worldId: 1, workId: 1, worldReleaseId: 1,
      productionKey: 'market-ui-local', productType: 'avg', version: 1, label: '本地短篇 v1',
      manifestJson: JSON.stringify({
        productType: 'avg', runtimePackage: { productType: 'avg', definition: { title: '本地短篇' } },
      }),
      contentHash: RELEASE, createdAt: 1,
    })
    const fake = client()
    const bundle = {
      productRelease: { contentHash: RELEASE }, bundleHash: 'b'.repeat(64),
    } as unknown as ProductDistributionBundleV1
    const exportBundle = vi.fn().mockResolvedValue(bundle)
    await act(async () => {
      root.render(createElement(MarketplacePanel, {
        client: fake as never, scope: { projectId: 1, worldId: 1, workId: 1 }, exportBundle,
      }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-creator-123456789'))
    await act(async () => { button(host, '创作者提交').click(); await settle() })
    await waitFor(() => expect([...host.querySelectorAll('input')].some(input => input.value === '本地短篇')).toBe(true))
    await act(async () => { button(host, '冻结、上传并提交审核').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('完整发行物已提交审核'))
    expect(exportBundle).toHaveBeenCalledWith({
      scope: { projectId: 1, worldId: 1, workId: 1 }, productReleaseId: expect.any(Number),
    })
    expect(fake.createListing).toHaveBeenCalledWith(expect.objectContaining({ releaseHash: RELEASE }))
    expect(fake.registerRelease).toHaveBeenCalledWith(expect.objectContaining({ bundle }))
    expect(fake.submitListing).toHaveBeenCalledWith(expect.objectContaining({ listingId: listing.listingId }))
    expect(host.textContent).toContain('submitted')
  })

  it('有权限的发行审核员读取 submitted 队列并显式批准发布', async () => {
    const fake = client()
    await act(async () => {
      root.render(createElement(MarketplacePanel, { client: fake as never }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-catalog-reviewer-123'))
    await act(async () => { button(host, '发行审核').click(); await settle() })
    await act(async () => { button(host, '加载待审').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('市场短篇'))
    await act(async () => { button(host, '审核发布').click(); await settle() })
    await waitFor(() => expect(fake.publishListing).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-catalog-reviewer-123', listingId: listing.listingId,
      requestId: expect.stringMatching(/^approve:listing\.market-ui\./),
    })))
    expect(host.textContent).toContain('已审核发布')
  })

  it('市场详情公开展示聚合分数，并只通过社区服务提交已验证权益评价', async () => {
    const fake = client()
    let published = false
    const review = {
      reviewId: `review.release.user.buyer.${RELEASE}`, authorId: 'user.buyer', subjectType: 'release' as const,
      releaseHash: RELEASE, postId: null, rating: 5 as const, title: '规则清楚', body: '索引和回放都很完整。',
      tags: ['规则清楚'], containsSpoilers: false, verification: 'entitlement' as const,
      status: 'published' as const, creatorResponse: null, responseBy: null, responseAt: null, createdAt: 1, updatedAt: 1,
    }
    const community = {
      listReviews: vi.fn(async () => ({
        reviews: published ? [review] : [],
        aggregate: {
          subjectType: 'release' as const, releaseHash: RELEASE, postId: null,
          count: published ? 1 : 0, average: published ? 5 : null,
          histogram: { '1': 0, '2': 0, '3': 0, '4': 0, '5': published ? 1 : 0 },
          tagCounts: published ? [{ tag: '规则清楚', count: 1 }] : [],
        },
      })),
      reviewCapabilities: vi.fn(async () => ({ ownReviewId: published ? review.reviewId : null, respondableReviewIds: [] })),
      upsertReview: vi.fn(async () => { published = true; return review }),
      withdrawReview: vi.fn(), respondToReview: vi.fn(),
    }
    await act(async () => {
      root.render(createElement(MarketplacePanel, { client: fake as never, communityClient: community as never }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-buyer-review-123456'))
    await act(async () => { button(host, '刷新').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('市场短篇'))
    await act(async () => { button(host, '评价与评分').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('暂无已验证评价'))
    await act(async () => {
      setInput(host.querySelector<HTMLInputElement>('[aria-label="评价标题"]')!, '规则清楚')
      setTextarea(host.querySelector<HTMLTextAreaElement>('[aria-label="评价正文"]')!, '索引和回放都很完整。')
    })
    await act(async () => { button(host, '发布已验证评价').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('已发布已验证权益评价'))
    expect(community.upsertReview).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-buyer-review-123456', subjectType: 'release', releaseHash: RELEASE,
      rating: 5, title: '规则清楚', body: '索引和回放都很完整。',
    }))
    expect(host.textContent).toContain('已验证权益')
    expect(host.textContent).toContain('5.00')
  })

  it('收藏、订阅与关注关系由账号社区服务保存并即时投影', async () => {
    const fake = client()
    const community = {
      mySocialEdges: vi.fn().mockResolvedValue([]),
      setSocialEdge: vi.fn(async input => ({
        edgeId: `edge.${input.kind}.user.buyer.${input.targetId}`, kind: input.kind,
        actorId: 'user.buyer', targetId: input.targetId, active: input.active, createdAt: 1, updatedAt: 1,
      })),
    }
    await act(async () => {
      root.render(createElement(MarketplacePanel, { client: fake as never, communityClient: community as never }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-social-buyer-12345'))
    await act(async () => { button(host, '刷新').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('市场短篇'))
    await act(async () => { button(host, '收藏').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('已收藏'))
    expect(community.setSocialEdge).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-social-buyer-12345', kind: 'favorite-listing', targetId: listing.listingId, active: true,
    }))
    await act(async () => { button(host, '订阅更新').click(); await settle() })
    await act(async () => { button(host, '关注创作者').click(); await settle() })
    expect(community.setSocialEdge).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'follow-creator', targetId: listing.creatorId, active: true,
    }))
  })

  it('安全中心提交举报并允许处罚主体发起独立申诉', async () => {
    const fake = client()
    const reportId = 'report.ui-safety'
    const reporterView = {
      reportId, relation: 'reporter' as const, subjectType: 'lfg' as const, subjectId: 'lfg.unsafe',
      category: 'harassment' as const, details: '事实说明', status: 'open' as const,
      action: null, reasonCode: null, createdAt: 1, updatedAt: 1,
    }
    const subjectView = {
      ...reporterView, relation: 'subject' as const, subjectType: 'profile' as const,
      subjectId: 'user.subject', details: null, status: 'actioned' as const,
      action: 'suspend' as const, reasonCode: 'safety.harassment',
    }
    const community = {
      createReport: vi.fn().mockResolvedValue(reporterView),
      myReports: vi.fn().mockResolvedValue([reporterView]), myAppeals: vi.fn().mockResolvedValue([]),
      createAppeal: vi.fn().mockResolvedValue({
        appealId: 'appeal.ui', reportId, appellantId: 'user.subject', statement: '请求复核',
        status: 'open', reviewedBy: null, createdAt: 2, updatedAt: 2,
      }),
    }
    await act(async () => {
      root.render(createElement(MarketplacePanel, { client: fake as never, communityClient: community as never }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-safety-subject-12345'))
    await act(async () => { button(host, '安全与申诉').click(); await settle() })
    await act(async () => {
      setInput(host.querySelector<HTMLInputElement>('[aria-label="举报对象 ID"]')!, 'lfg.unsafe')
      const details = [...host.querySelectorAll('label')].find(label => label.textContent?.includes('事实说明'))?.querySelector('textarea')
      setTextarea(details!, '事实说明')
    })
    await act(async () => { button(host, '提交举报').click(); await settle() })
    await waitFor(() => expect(community.createReport).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-safety-subject-12345', subjectId: 'lfg.unsafe', details: '事实说明',
    })))
    community.myReports.mockResolvedValue([subjectView])
    await act(async () => { button(host, '刷新').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('对此处罚申诉'))
    await act(async () => { button(host, '对此处罚申诉').click(); await settle() })
    await act(async () => setTextarea(host.querySelector<HTMLTextAreaElement>('[aria-label="申诉陈述"]')!, '请求复核'))
    await act(async () => { button(host, '提交独立复核').click(); await settle() })
    await waitFor(() => expect(community.createAppeal).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-safety-subject-12345', reportId, statement: '请求复核',
    })))
  })

  it('组团中心先建立社区资料，再公开发现并提交私密申请', async () => {
    const fake = client()
    const startsAt = Date.now() + 3_600_000
    const community = {
      upsertProfile: vi.fn().mockResolvedValue({
        userId: 'user.player', handle: 'player', displayName: '玩家', bio: '', locale: 'zh-CN',
        timeZone: 'Asia/Shanghai', ageBand: 'adult', status: 'active', createdAt: 1, updatedAt: 1,
      }),
      discoverLfg: vi.fn().mockResolvedValue([{
        post: {
          postId: 'lfg.ui', creatorId: 'user.host', releaseHash: RELEASE, title: '雾港周末团',
          summary: '使用 X-card', locale: 'zh-CN', timeZone: 'Asia/Shanghai', startsAt,
          durationMinutes: 180, playerCapacity: 4, waitlistCapacity: 2, audience: 'all-ages',
          safetyTags: ['X-card'], status: 'open', createdAt: 1, updatedAt: 1,
        },
        accepted: 0, waitlisted: 0, availableSeats: 4,
      }]),
      myApplications: vi.fn().mockResolvedValue([]),
      myParticipation: vi.fn().mockResolvedValue([]),
      applyToLfg: vi.fn().mockResolvedValue({
        applicationId: 'application.ui', postId: 'lfg.ui', userId: 'user.player',
        characterPreference: '', note: '', status: 'pending', createdAt: 1, updatedAt: 1,
      }),
      createLfg: vi.fn(), applicationsForPost: vi.fn(), decideApplication: vi.fn(), closeLfg: vi.fn(),
      attendanceForPost: vi.fn(), markAttendance: vi.fn(), promoteWaitlist: vi.fn(),
      bindRoomHandoffs: vi.fn(), claimRoomHandoff: vi.fn(), listReviews: vi.fn(), upsertReview: vi.fn(),
      withdrawReview: vi.fn(), respondToReview: vi.fn(),
    }
    await act(async () => {
      root.render(createElement(MarketplacePanel, {
        client: fake as never, communityClient: community as never,
      }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-community-player-123'))
    await act(async () => { button(host, '组团中心').click(); await settle() })
    await act(async () => {
      setInput(labeledInput(host, '公开 handle'), 'player')
      setInput(labeledInput(host, '显示名称'), '玩家')
    })
    await act(async () => { button(host, '保存社区资料').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('已连接 @player'))
    await act(async () => { button(host, '刷新招募').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('雾港周末团'))
    await act(async () => { button(host, '申请加入').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('等待主持人处理'))
    expect(community.applyToLfg).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-community-player-123', postId: 'lfg.ui',
      requestId: expect.stringMatching(/^apply:lfg\.ui\./),
    }))
  })

  it('已接受申请领取自己的密钥交接，并把账号凭据以内存载荷交给跑团入口', async () => {
    const fake = client()
    const application = {
      applicationId: 'application.accepted', postId: 'lfg.accepted', userId: 'user.player',
      characterPreference: '调查员', note: '', status: 'accepted' as const, createdAt: 1, updatedAt: 2,
    }
    const community = {
      upsertProfile: vi.fn(), discoverLfg: vi.fn().mockResolvedValue([]),
      myApplications: vi.fn().mockResolvedValue([application]), applyToLfg: vi.fn(), createLfg: vi.fn(),
      myParticipation: vi.fn().mockResolvedValue([]),
      applicationsForPost: vi.fn(), decideApplication: vi.fn(), closeLfg: vi.fn(), bindRoomHandoffs: vi.fn(),
      attendanceForPost: vi.fn(), markAttendance: vi.fn(), promoteWaitlist: vi.fn(),
      listReviews: vi.fn(), upsertReview: vi.fn(), withdrawReview: vi.fn(), respondToReview: vi.fn(),
      claimRoomHandoff: vi.fn().mockResolvedValue({
        applicationId: application.applicationId, roomId: 'room.accepted', releaseHash: RELEASE,
        actorKey: 'investigator.chen', inviteId: 'invite.accepted', inviteToken: 'secret.invite',
        displayName: '玩家', expiresAt: Date.now() + 60_000,
      }),
    }
    const onRoomHandoff = vi.fn().mockResolvedValue(undefined)
    await act(async () => {
      root.render(createElement(MarketplacePanel, {
        client: fake as never, communityClient: community as never, onRoomHandoff,
      }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-community-player-accepted'))
    await act(async () => { button(host, '组团中心').click(); await settle() })
    await act(async () => { button(host, '刷新招募').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('进入在线房间'))
    await act(async () => { button(host, '进入在线房间').click(); await settle() })
    await waitFor(() => expect(onRoomHandoff).toHaveBeenCalledTimes(1))
    expect(community.claimRoomHandoff).toHaveBeenCalledWith({
      accessToken: 'token-community-player-accepted', applicationId: application.applicationId,
    })
    expect(onRoomHandoff).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room.accepted', releaseHash: RELEASE, actorKey: 'investigator.chen',
      inviteToken: 'secret.invite', memberAccessToken: 'token-community-player-accepted',
    }))
    expect(JSON.stringify(localStorage)).not.toContain('secret.invite')
  })

  it('已确认出席的历史场次显示实际参团评价入口', async () => {
    const fake = client()
    const closedPost = {
      postId: 'lfg.closed', creatorId: 'user.host', releaseHash: RELEASE, title: '已完成周末团', summary: '完成',
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', startsAt: Date.now() - 3_600_000, durationMinutes: 180,
      playerCapacity: 4, waitlistCapacity: 2, audience: 'all-ages' as const, safetyTags: ['X-card'],
      status: 'closed' as const, createdAt: 1, updatedAt: 2,
    }
    const application = {
      applicationId: 'application.closed', postId: closedPost.postId, userId: 'user.player',
      characterPreference: '调查员', note: '', status: 'accepted' as const, createdAt: 1, updatedAt: 2,
    }
    const attendance = {
      attendanceId: 'attendance.application.closed', postId: closedPost.postId,
      applicationId: application.applicationId, userId: application.userId, status: 'confirmed' as const,
      replacementApplicationId: null, markedBy: 'user.host', createdAt: 1, updatedAt: 2,
    }
    const community = {
      discoverLfg: vi.fn().mockResolvedValue([]), myApplications: vi.fn().mockResolvedValue([application]),
      myParticipation: vi.fn().mockResolvedValue([{ post: closedPost, application, attendance }]),
      listReviews: vi.fn().mockResolvedValue({
        reviews: [], aggregate: { subjectType: 'actual-play', releaseHash: RELEASE, postId: closedPost.postId, count: 0, average: null, histogram: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }, tagCounts: [] },
      }),
      reviewCapabilities: vi.fn().mockResolvedValue({ ownReviewId: null, respondableReviewIds: [] }),
      upsertReview: vi.fn(), withdrawReview: vi.fn(), respondToReview: vi.fn(), upsertProfile: vi.fn(),
      applyToLfg: vi.fn(), createLfg: vi.fn(), applicationsForPost: vi.fn(), decideApplication: vi.fn(), closeLfg: vi.fn(),
      attendanceForPost: vi.fn(), markAttendance: vi.fn(), promoteWaitlist: vi.fn(), bindRoomHandoffs: vi.fn(), claimRoomHandoff: vi.fn(),
    }
    await act(async () => {
      root.render(createElement(MarketplacePanel, { client: fake as never, communityClient: community as never }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-attended-player-123'))
    await act(async () => { button(host, '组团中心').click(); await settle() })
    await act(async () => { button(host, '刷新招募').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('评价实际场次'))
    await act(async () => { button(host, '评价实际场次').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('实际参团评价 · 已完成周末团'))
    expect(host.textContent).toContain('仅该场次已确认出席的正式成员可评价')
  })

  it('主持人只为已接受申请填写唯一角色后分配权威房间', async () => {
    const fake = client()
    const startsAt = Date.now() + 3_600_000
    const post = {
      postId: 'lfg.host', creatorId: 'user.host', releaseHash: RELEASE, title: '主持人周末团',
      summary: '安全开团', locale: 'zh-CN', timeZone: 'Asia/Shanghai', startsAt,
      durationMinutes: 180, playerCapacity: 4, waitlistCapacity: 2, audience: 'all-ages' as const,
      safetyTags: ['X-card'], status: 'open' as const, createdAt: 1, updatedAt: 1,
    }
    const accepted = {
      applicationId: 'application.host-ui', postId: post.postId, userId: 'user.player',
      characterPreference: '记者', note: '偏调查', status: 'accepted' as const, createdAt: 1, updatedAt: 2,
    }
    const community = {
      upsertProfile: vi.fn().mockResolvedValue({
        userId: 'user.host', handle: 'host', displayName: '主持人', bio: '', locale: 'zh-CN',
        timeZone: 'Asia/Shanghai', ageBand: 'adult', status: 'active', createdAt: 1, updatedAt: 1,
      }),
      discoverLfg: vi.fn().mockResolvedValue([{ post, accepted: 1, waitlisted: 0, availableSeats: 3 }]),
      myApplications: vi.fn().mockResolvedValue([]), applyToLfg: vi.fn(), createLfg: vi.fn(),
      myParticipation: vi.fn().mockResolvedValue([]),
      applicationsForPost: vi.fn().mockResolvedValue([accepted]), decideApplication: vi.fn(), closeLfg: vi.fn(),
      attendanceForPost: vi.fn().mockResolvedValue([]), markAttendance: vi.fn().mockResolvedValue({
        attendanceId: `attendance.${accepted.applicationId}`, postId: post.postId, applicationId: accepted.applicationId,
        userId: accepted.userId, status: 'confirmed', replacementApplicationId: null, markedBy: 'user.host', createdAt: 1, updatedAt: 2,
      }), promoteWaitlist: vi.fn(),
      listReviews: vi.fn(), upsertReview: vi.fn(), withdrawReview: vi.fn(), respondToReview: vi.fn(),
      claimRoomHandoff: vi.fn(), bindRoomHandoffs: vi.fn().mockResolvedValue([{
        schema: 'storyforge.lfg-room-handoff', version: 1, applicationId: accepted.applicationId,
        postId: post.postId, applicantId: accepted.userId, roomId: 'room.hosted', releaseHash: RELEASE,
        actorKey: 'investigator.reporter', expiresAt: Date.now() + 60_000, createdAt: 1,
      }]),
    }
    await act(async () => {
      root.render(createElement(MarketplacePanel, { client: fake as never, communityClient: community as never }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-community-host-12345'))
    await act(async () => { button(host, '组团中心').click(); await settle() })
    await act(async () => {
      setInput(labeledInput(host, '公开 handle'), 'host')
      setInput(labeledInput(host, '显示名称'), '主持人')
    })
    await act(async () => { button(host, '保存社区资料').click(); await settle() })
    await act(async () => { button(host, '刷新招募').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('主持人周末团'))
    await act(async () => { button(host, '管理申请').click(); await settle() })
    await waitFor(() => expect(host.textContent).toContain('偏调查'))
    await act(async () => {
      setInput(host.querySelector<HTMLInputElement>('[aria-label="角色席位 application.host-ui"]')!, 'investigator.reporter')
      setInput(host.querySelector<HTMLInputElement>('[aria-label="交接在线房间 ID"]')!, 'room.hosted')
    })
    await act(async () => { button(host, '分配在线席位').click(); await settle() })
    await waitFor(() => expect(community.bindRoomHandoffs).toHaveBeenCalledTimes(1))
    expect(community.bindRoomHandoffs).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-community-host-12345', postId: post.postId, roomId: 'room.hosted',
      releaseHash: RELEASE,
      bindings: [{ applicationId: accepted.applicationId, actorKey: 'investigator.reporter' }],
    }))
    await act(async () => { button(host, '确认出席').click(); await settle() })
    await waitFor(() => expect(community.markAttendance).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-community-host-12345', applicationId: accepted.applicationId, status: 'confirmed',
    })))
  })

  it('支持与结算页读取公开状态并创建只向请求者可见的客服工单', async () => {
    const fake = client()
    const operations = {
      status: vi.fn().mockResolvedValue([]), myTickets: vi.fn().mockResolvedValue([]),
      openTicket: vi.fn().mockResolvedValue({
        ticketId: 'ticket.ui', requesterId: 'user.player', category: 'technical', subject: '在线房间断线',
        orderId: null, status: 'waiting-support', priority: 'normal', assignedTo: null,
        messages: [{ messageId: 'message.ui', authorId: 'user.player', visibility: 'requester', body: '反复断线。', createdAt: 1 }],
        createdAt: 1, updatedAt: 1,
      }), replyTicket: vi.fn(), myPayoutAccounts: vi.fn().mockResolvedValue([]),
      registerPayoutAccount: vi.fn(), balance: vi.fn().mockResolvedValue(0), myPayouts: vi.fn().mockResolvedValue([]),
      requestPayout: vi.fn(), myDeletions: vi.fn().mockResolvedValue([]), requestDeletion: vi.fn(),
    }
    await act(async () => {
      root.render(createElement(MarketplacePanel, { client: fake as never, operationsClient: operations as never }))
      await settle()
    })
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'token-operations-player-123'))
    await act(async () => { button(host, '支持与结算').click(); await settle() })
    await waitFor(() => expect(operations.status).toHaveBeenCalledTimes(1))
    await act(async () => { button(host, '客户支持').click(); await settle() })
    await act(async () => {
      setInput(host.querySelector<HTMLInputElement>('[aria-label="工单主题"]')!, '在线房间断线')
      setTextarea(host.querySelector<HTMLTextAreaElement>('[aria-label="工单正文"]')!, '反复断线。')
    })
    await act(async () => { button(host, '提交工单').click(); await settle() })
    await waitFor(() => expect(operations.openTicket).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'token-operations-player-123', subject: '在线房间断线', body: '反复断线。',
    })))
    expect(host.textContent).toContain('正文只对你和客服可见')
  })
})
