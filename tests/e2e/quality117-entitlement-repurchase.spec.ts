import { expect, test } from '@playwright/test'
import type { CommercialPlatformSnapshotV1 } from '../../src/lib/commercial/authority'
import type { CommercialPaymentEventV1 } from '../../src/lib/commercial/webhook'

test('SFQA117 signed gateway repurchase resolves the new order and keeps refund history under a later catalog hold', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { CommercialPlatformAuthorityV1 } = await load<typeof import('../../src/lib/commercial/authority')>('/storyforge/src/lib/commercial/authority.ts')
    const { createCommercialGatewayV1 } = await load<typeof import('../../src/lib/commercial/gateway')>('/storyforge/src/lib/commercial/gateway.ts')
    const { signCommercialWebhookV1 } = await load<typeof import('../../src/lib/commercial/webhook')>('/storyforge/src/lib/commercial/webhook.ts')
    const { CommercialCommunityReleasePolicyV1 } = await load<typeof import('../../src/lib/community/commercial-release-policy')>('/storyforge/src/lib/community/commercial-release-policy.ts')
    let snapshot: CommercialPlatformSnapshotV1 | null = null, now = 1_800_000_000_000
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: {
      load: async () => snapshot ? structuredClone(snapshot) : null,
      compareAndSwap: async (input: { expectedRevision: number | null; snapshot: CommercialPlatformSnapshotV1 }) => {
        if ((snapshot?.revision ?? null) !== input.expectedRevision) return false
        snapshot = structuredClone(input.snapshot)
        return true
      },
    }, now: () => now++ })
    const releaseHash = 'a'.repeat(64), secret = 'sfqa117-browser-synthetic-secret'
    const buyer = { userId: 'buyer.117', permissions: [] }, creator = { userId: 'creator.117', permissions: [] }
    const draft = await authority.createListing({ principal: creator, requestId: 'listing.create', releaseHash, productType: 'ttrpg', title: '浏览器隔离发布', summary: '测试发布包', contentWarnings: [],
      license: { licenseId: 'license.browser', licenseVersion: '1', allowOfflineExport: true, allowRemix: true, commercialReuse: false, requiresAttribution: true, termsUrl: 'https://fixture.invalid/license' }, currency: 'CNY', amountMinor: 2900, creatorShareBps: 8000 })
    await authority.submitListing({ principal: creator, requestId: 'listing.submit', listingId: draft.listingId, rightsConfirmed: true })
    await authority.publishListing({ principal: { userId: 'reviewer.117', permissions: ['catalog:publish'] }, requestId: 'listing.publish', listingId: draft.listingId, rightsConfirmed: true })
    const gateway = createCommercialGatewayV1({ authority, webhookSecret: secret, now: () => now++, identity: { authenticate: async token => token === 'sfqa117-buyer-token' ? buyer : null }, releaseDelivery: { hasVerifiedRelease: async () => true }, checkoutProvider: {
      createOrResumeSession: async order => ({ checkoutSessionId: `checkout.${order.orderId}`, orderId: order.orderId, checkoutUrl: 'https://fixture.invalid/pay', expiresAt: now + 60000 }),
    } })
    const acquire = async (requestId: string) => {
      const result = await gateway({ method: 'POST', path: '/v1/commercial/acquisitions', contentType: 'application/json', headers: { authorization: 'Bearer sfqa117-buyer-token' }, body: { requestId, listingId: draft.listingId } })
      if (result.status !== 201) throw new Error(JSON.stringify(result.body))
      return (result.body as { order: { orderId: string } }).order.orderId
    }
    const payment = async (orderId: string, eventId: string, type: CommercialPaymentEventV1['type']) => {
      const rawBody = JSON.stringify({ schema: 'storyforge.payment-event', version: 1, orderId, eventId, type, providerReference: 'checkout.synthetic', currency: 'CNY', amountMinor: 2900, occurredAt: now })
      const signature = await signCommercialWebhookV1({ rawBody, secret, timestamp: now })
      const result = await gateway({ method: 'POST', path: '/v1/commercial/payment-webhook', contentType: 'application/json', headers: { 'x-storyforge-signature': signature }, body: null, rawBody })
      if (result.status !== 200) throw new Error(JSON.stringify(result.body))
    }
    const oldOrder = await acquire('buy.first')
    await payment(oldOrder, 'paid.first', 'payment.succeeded')
    await payment(oldOrder, 'refund.first', 'refund.succeeded')
    const readSnapshot = (): CommercialPlatformSnapshotV1 => {
      if (!snapshot) throw new Error('Missing commercial snapshot')
      return structuredClone(snapshot)
    }
    const old = readSnapshot().entitlements.find(row => row.orderId === oldOrder)!
    const newOrder = await acquire('buy.second')
    await payment(newOrder, 'paid.second', 'payment.succeeded')
    const input = { principal: buyer, releaseHash }
    const publicGet = await gateway({ method: 'POST', path: '/v1/commercial/entitlements/get', contentType: 'application/json', headers: { authorization: 'Bearer sfqa117-buyer-token' }, body: { releaseHash } })
    const consumer = { host: authority.canHostRelease(input), offline: authority.authorizeOfflineDelivery(input).orderId, remix: authority.authorizeRemix(input).license.licenseId, review: await new CommercialCommunityReleasePolicyV1(authority).reviewEligibility(buyer.userId, releaseHash) }
    await authority.suspendListing({ principal: { userId: 'moderator.117', permissions: ['catalog:moderate'] }, requestId: 'hold.current', listingId: draft.listingId, reasonCode: 'rights-review' })
    return {
      newOrder, publicGet, consumer, held: authority.entitlementFor(input),
      hostedAfterHold: authority.canHostRelease(input),
      reviewAfterHold: await new CommercialCommunityReleasePolicyV1(authority).reviewEligibility(buyer.userId, releaseHash),
      historyPreserved: JSON.stringify(old) === JSON.stringify(readSnapshot().entitlements.find(row => row.orderId === oldOrder)),
      oldLedger: authority.ledgerForOrder(oldOrder).length,
    }
  })
  expect(result.publicGet).toMatchObject({ status: 200, body: { entitlement: { orderId: result.newOrder, status: 'active', hostedAccess: true } } })
  expect(result.consumer).toEqual({ host: true, offline: result.newOrder, remix: 'license.browser', review: { entitled: true, creator: false } })
  expect(result.held).toMatchObject({ orderId: result.newOrder, status: 'moderation-hold', hostedAccess: false })
  expect(result.hostedAfterHold).toBe(false)
  expect(result.reviewAfterHold.entitled).toBe(false)
  expect(result.historyPreserved).toBe(true)
  expect(result.oldLedger).toBe(6)
})
