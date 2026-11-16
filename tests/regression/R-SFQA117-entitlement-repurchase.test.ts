import { describe, expect, it } from 'vitest'
import { CommercialPlatformAuthorityV1, type CommercialLicenseV1, type CommercialPlatformPersistenceV1, type CommercialPlatformSnapshotV1, type CommercialPrincipalV1 } from '../../src/lib/commercial/authority'
import { signCommercialWebhookV1, verifyCommercialWebhookV1, type CommercialPaymentEventV1 } from '../../src/lib/commercial/webhook'
import { CommercialCommunityReleasePolicyV1 } from '../../src/lib/community/commercial-release-policy'
import { createCommercialGatewayV1 } from '../../src/lib/commercial/gateway'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

const RELEASE = 'a'.repeat(64)
const SECRET = 'sfqa117-synthetic-signing-secret'
const creator: CommercialPrincipalV1 = { userId: 'creator.117', permissions: [] }
const buyer: CommercialPrincipalV1 = { userId: 'buyer.117', permissions: [] }
const reviewer: CommercialPrincipalV1 = { userId: 'reviewer.117', permissions: ['catalog:publish'] }
const moderator: CommercialPrincipalV1 = { userId: 'moderator.117', permissions: ['catalog:moderate'] }

class Store implements CommercialPlatformPersistenceV1 {
  snapshot: CommercialPlatformSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommercialPlatformSnapshotV1 }) {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}
async function fixture() {
  let now = 1_800_000_000_000, serial = 0
  const store = new Store()
  const authority = await CommercialPlatformAuthorityV1.create({ persistence: store, now: () => now++ })
  const published = async (suffix: string, patch: Partial<CommercialLicenseV1> = {}) => {
    const row = await authority.createListing({
      principal: creator, requestId: `create.${suffix}`, releaseHash: RELEASE, productType: 'ttrpg', title: `测试发布${suffix}`, summary: '独立测试发布包', contentWarnings: [],
      license: { licenseId: `license.${suffix}`, licenseVersion: '1', allowOfflineExport: true, allowRemix: true, commercialReuse: false, requiresAttribution: true, termsUrl: 'https://fixture.invalid/license', ...patch },
      currency: 'CNY', amountMinor: 2900, creatorShareBps: 8000,
    })
    await authority.submitListing({ principal: creator, requestId: `submit.${suffix}`, listingId: row.listingId, rightsConfirmed: true })
    return authority.publishListing({ principal: reviewer, requestId: `publish.${suffix}`, listingId: row.listingId, rightsConfirmed: true })
  }
  const event = async (orderId: string, type: CommercialPaymentEventV1['type']) => {
    const timestamp = now++
    const rawBody = JSON.stringify({ schema: 'storyforge.payment-event', version: 1, eventId: `event.${serial++}`, type, orderId, providerReference: 'checkout.fixture', currency: 'CNY', amountMinor: 2900, occurredAt: timestamp })
    const signatureHeader = await signCommercialWebhookV1({ rawBody, secret: SECRET, timestamp })
    return verifyCommercialWebhookV1({ rawBody, signatureHeader, secret: SECRET, now: timestamp })
  }
  const pay = async (orderId: string, type: CommercialPaymentEventV1['type'] = 'payment.succeeded') => authority.applyPaymentEvent({ event: await event(orderId, type) })
  const acquire = (listingId: string) => authority.beginAcquisition({ principal: buyer, requestId: `acquire.${serial++}`, listingId })
  return { store, authority, published, event, pay, acquire, input: { principal: buyer, releaseHash: RELEASE } }
}

describe('SFQA-117 · current entitlement selection', () => {
  it('first purchase and repeated refund/repurchase keep current access and every old order/ledger', async () => {
    const f = await fixture()
    const listing = await f.published('original')
    expect(f.authority.entitlementFor(f.input)).toBeNull()
    const history: Array<{ id: string; ledger: ReturnType<typeof f.authority.ledgerForOrder>; entitlement: NonNullable<Awaited<ReturnType<typeof f.store.load>>>['entitlements'][number] }> = []
    for (let cycle = 0; cycle < 3; cycle++) {
      const acquired = await f.acquire(listing.listingId)
      const paid = await f.pay(acquired.order.orderId)
      expect(f.authority.entitlementFor(f.input)).toMatchObject({ entitlementId: paid.entitlement!.entitlementId, orderId: acquired.order.orderId, status: 'active', hostedAccess: true })
      for (const old of history) {
        expect(f.authority.ledgerForOrder(old.id)).toEqual(old.ledger)
        expect(f.store.snapshot!.entitlements.find(row => row.orderId === old.id)).toEqual(old.entitlement)
      }
      const refund = await f.pay(acquired.order.orderId, 'refund.succeeded')
      history.push({ id: acquired.order.orderId, ledger: f.authority.ledgerForOrder(acquired.order.orderId), entitlement: refund.entitlement! })
      expect(f.authority.canHostRelease(f.input)).toBe(false)
    }
    expect(f.store.snapshot!.orders).toHaveLength(3)
    expect(f.store.snapshot!.entitlements).toHaveLength(3)
    for (const { ledger } of history) expect(ledger.filter(row => row.direction === 'debit').reduce((sum, row) => sum + row.amountMinor, 0)).toBe(ledger.filter(row => row.direction === 'credit').reduce((sum, row) => sum + row.amountMinor, 0))
  })

  it('a new listing of the same Release governs host/offline/remix and community access after a refund', async () => {
    const f = await fixture()
    const first = await f.published('old')
    const old = await f.acquire(first.listingId)
    await f.pay(old.order.orderId); await f.pay(old.order.orderId, 'refund.succeeded')
    const next = await f.published('new')
    const current = await f.acquire(next.listingId)
    await f.pay(current.order.orderId)
    const beforeRead = await f.store.load()
    expect(f.authority.canHostRelease(f.input)).toBe(true)
    expect(f.authority.authorizeOfflineDelivery(f.input)).toMatchObject({ orderId: current.order.orderId, listingId: next.listingId })
    expect(f.authority.authorizeRemix(f.input).license.licenseId).toBe('license.new')
    expect(await new CommercialCommunityReleasePolicyV1(f.authority).reviewEligibility(buyer.userId, RELEASE)).toEqual({ entitled: true, creator: false })
    expect(await f.store.load()).toEqual(beforeRead)
  })

  it('the new order license is authoritative while the refunded license and local copy remain historical', async () => {
    const f = await fixture()
    const first = await f.published('old-license')
    const old = await f.acquire(first.listingId)
    await f.pay(old.order.orderId); await f.pay(old.order.orderId, 'refund.succeeded')
    const next = await f.published('limited', { allowOfflineExport: false, allowRemix: false })
    const current = await f.acquire(next.listingId); await f.pay(current.order.orderId)
    expect(f.authority.entitlementFor(f.input)?.license.licenseId).toBe('license.limited')
    expect(() => f.authority.authorizeOfflineDelivery(f.input)).toThrow('许可不允许离线交付')
    expect(() => f.authority.authorizeRemix(f.input)).toThrow('许可不允许 remix')
    expect(f.store.snapshot!.entitlements.find(row => row.orderId === old.order.orderId)).toMatchObject({ status: 'refunded', localCopyPreserved: true })
  })

  it('a late paid event cannot revive a listing that was put on moderation hold while payment was pending', async () => {
    const f = await fixture()
    const listing = await f.published('held')
    const current = await f.acquire(listing.listingId)
    await f.authority.suspendListing({ principal: moderator, requestId: 'hold.pending', listingId: listing.listingId, reasonCode: 'review-required' })
    await f.pay(current.order.orderId)
    expect(f.authority.entitlementFor(f.input)).toMatchObject({ status: 'moderation-hold', hostedAccess: false })
    expect(f.authority.canHostRelease(f.input)).toBe(false)
    expect(() => f.authority.authorizeRemix(f.input)).toThrow()
    expect(() => f.authority.authorizeOfflineDelivery(f.input)).toThrow()
    expect((await new CommercialCommunityReleasePolicyV1(f.authority).reviewEligibility(buyer.userId, RELEASE)).entitled).toBe(false)
    expect(f.store.snapshot!.orders[0].status).toBe('paid')
    expect(f.authority.ledgerForOrder(current.order.orderId)).toHaveLength(3)
  })

  it('a disputed repurchase fails closed and a subsequent refunded/paid order regains access', async () => {
    const f = await fixture()
    const listing = await f.published('dispute')
    const first = await f.acquire(listing.listingId); await f.pay(first.order.orderId); await f.pay(first.order.orderId, 'refund.succeeded')
    const second = await f.acquire(listing.listingId); await f.pay(second.order.orderId); await f.pay(second.order.orderId, 'dispute.opened')
    expect(f.authority.entitlementFor(f.input)?.status).toBe('disputed')
    expect(f.authority.canHostRelease(f.input)).toBe(false)
    await f.pay(second.order.orderId, 'refund.succeeded')
    const third = await f.acquire(listing.listingId); await f.pay(third.order.orderId)
    expect(f.authority.entitlementFor(f.input)).toMatchObject({ orderId: third.order.orderId, status: 'active' })
  })

  it('moderation preserves refunded entitlement history and ledger while holding the current purchase', async () => {
    const f = await fixture()
    const listing = await f.published('history-hold')
    const old = await f.acquire(listing.listingId); await f.pay(old.order.orderId); await f.pay(old.order.orderId, 'refund.succeeded')
    const oldEntitlement = structuredClone(f.store.snapshot!.entitlements.find(row => row.orderId === old.order.orderId)!)
    const oldLedger = f.authority.ledgerForOrder(old.order.orderId)
    const current = await f.acquire(listing.listingId); await f.pay(current.order.orderId)
    await f.authority.suspendListing({ principal: moderator, requestId: 'hold.history', listingId: listing.listingId, reasonCode: 'rights-review' })
    expect(f.store.snapshot!.entitlements.find(row => row.orderId === old.order.orderId)).toEqual(oldEntitlement)
    expect(f.authority.ledgerForOrder(old.order.orderId)).toEqual(oldLedger)
    expect(f.authority.entitlementFor(f.input)).toMatchObject({ orderId: current.order.orderId, status: 'moderation-hold', hostedAccess: false })
  })

  it('serialized checkout and idempotent concurrent payment select the new order through the public gateway', async () => {
    const f = await fixture()
    const listing = await f.published('gateway')
    const first = await f.acquire(listing.listingId); await f.pay(first.order.orderId); await f.pay(first.order.orderId, 'refund.succeeded')
    const attempts = await Promise.allSettled([f.acquire(listing.listingId), f.acquire(listing.listingId)])
    const paidAttempt = attempts.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof f.acquire>>> => result.status === 'fulfilled')!
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const event = await f.event(paidAttempt.value.order.orderId, 'payment.succeeded')
    await Promise.all([f.authority.applyPaymentEvent({ event }), f.authority.applyPaymentEvent({ event })])
    expect(f.authority.ledgerForOrder(paidAttempt.value.order.orderId)).toHaveLength(3)
    const gateway = createCommercialGatewayV1({ authority: f.authority, webhookSecret: SECRET, identity: { authenticate: async () => buyer }, releaseDelivery: { hasVerifiedRelease: async () => true }, checkoutProvider: { createOrResumeSession: async order => ({ checkoutSessionId: 'checkout.test', orderId: order.orderId, checkoutUrl: 'https://fixture.invalid/pay', expiresAt: 1_800_000_100_000 }) } })
    const result = await gateway({ method: 'POST', path: '/v1/commercial/entitlements/get', contentType: 'application/json', headers: { authorization: 'Bearer sfqa117-buyer-token' }, body: { releaseHash: RELEASE } })
    expect(result).toMatchObject({ status: 200, body: { entitlement: { orderId: paidAttempt.value.order.orderId, status: 'active' } } })
  })

  it('valid snapshot ordering cannot change the selected active entitlement or revive hostedAccess=false for community', async () => {
    const f = await fixture()
    const listing = await f.published('restore')
    const old = await f.acquire(listing.listingId); await f.pay(old.order.orderId); await f.pay(old.order.orderId, 'refund.succeeded')
    const current = await f.acquire(listing.listingId); await f.pay(current.order.orderId)
    const snapshot = (await f.store.load())!
    for (const reverse of [false, true]) {
      const store = new Store(); store.snapshot = structuredClone(snapshot)
      if (reverse) store.snapshot.entitlements.reverse()
      const { integrityHash: _, ...body } = store.snapshot
      store.snapshot.integrityHash = await hashCanonicalValue(body)
      const restored = await CommercialPlatformAuthorityV1.restore({ persistence: store })
      expect(restored.entitlementFor(f.input)?.orderId).toBe(current.order.orderId)
    }
    const store = new Store(); store.snapshot = structuredClone(snapshot)
    store.snapshot.entitlements.find(row => row.orderId === current.order.orderId)!.hostedAccess = false
    const { integrityHash: _, ...body } = store.snapshot
    store.snapshot.integrityHash = await hashCanonicalValue(body)
    const restored = await CommercialPlatformAuthorityV1.restore({ persistence: store })
    expect((await new CommercialCommunityReleasePolicyV1(restored).reviewEligibility(buyer.userId, RELEASE)).entitled).toBe(false)
  })
})
