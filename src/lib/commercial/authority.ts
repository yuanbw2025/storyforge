import { hashCanonicalValue } from '../agent/run/hash'
import { isProductionProductKindV1, type ProductionProductKindV1 } from '../types'
import { parseCommercialPaymentEventV1, type CommercialPaymentEventV1 } from './webhook'

export type CommercialListingStatusV1 = 'draft' | 'submitted' | 'changes-requested' | 'published' | 'suspended' | 'withdrawn'
export type CommercialOrderStatusV1 = 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed'
export type CommercialEntitlementStatusV1 = 'active' | 'refunded' | 'disputed' | 'moderation-hold'
export type CommercialPermissionV1 =
  | 'catalog:publish'
  | 'catalog:moderate'
  | 'commerce:support'
  | 'commerce:finance'
  | 'privacy:operate'
  | 'operations:incident'

export interface CommercialPrincipalV1 {
  userId: string
  permissions: CommercialPermissionV1[]
}

export interface CommercialLicenseV1 {
  licenseId: string
  licenseVersion: string
  allowOfflineExport: boolean
  allowRemix: boolean
  commercialReuse: boolean
  requiresAttribution: boolean
  termsUrl: string
}

export interface CommercialListingV1 {
  listingId: string
  releaseHash: string
  creatorId: string
  productType: ProductionProductKindV1
  title: string
  summary: string
  contentWarnings: string[]
  license: CommercialLicenseV1
  currency: string
  amountMinor: number
  creatorShareBps: number
  status: CommercialListingStatusV1
  rightsConfirmed: boolean
  reviewedBy: string | null
  reviewReasonCode: string | null
  createdAt: number
  updatedAt: number
}

export interface CommercialOrderV1 {
  orderId: string
  listingId: string
  releaseHash: string
  buyerId: string
  creatorId: string
  currency: string
  amountMinor: number
  creatorShareMinor: number
  platformShareMinor: number
  status: CommercialOrderStatusV1
  providerReference: string | null
  createdAt: number
  updatedAt: number
}

export interface CommercialEntitlementV1 {
  entitlementId: string
  orderId: string
  listingId: string
  releaseHash: string
  buyerId: string
  license: CommercialLicenseV1
  status: CommercialEntitlementStatusV1
  hostedAccess: boolean
  /** A refund/takedown never issues a delete command for a lawful exported local copy. */
  localCopyPreserved: boolean
  acquiredAt: number
  updatedAt: number
}

export interface CommercialOfflineDeliveryAuthorizationV1 {
  releaseHash: string
  listingId: string
  orderId: string | null
  entitlementId: string | null
  license: CommercialLicenseV1
  attribution: string[]
  localCopyPreserved: true
  acquiredAt: number
}

export interface CommercialLedgerEntryV1 {
  entryId: string
  orderId: string
  account: 'cash' | 'creator-payable' | 'platform-revenue'
  direction: 'debit' | 'credit'
  amountMinor: number
  reason: 'sale' | 'refund'
  createdAt: number
}

export interface CommercialAuditEntryV1 {
  sequence: number
  kind: string
  actorId: string
  subjectId: string
  outcome: 'accepted' | 'rejected'
  createdAt: number
}

interface StoredReceiptV1 {
  fingerprint: string
  result: unknown
}

interface StoredPaymentEventV1 {
  fingerprint: string
  orderId: string
  status: CommercialOrderStatusV1
}

export interface CommercialPlatformSnapshotV1 {
  schema: 'storyforge.commercial-platform-snapshot'
  version: 1
  revision: number
  listings: CommercialListingV1[]
  orders: CommercialOrderV1[]
  entitlements: CommercialEntitlementV1[]
  ledger: CommercialLedgerEntryV1[]
  receipts: Array<[string, StoredReceiptV1]>
  paymentEvents: Array<[string, StoredPaymentEventV1]>
  audits: CommercialAuditEntryV1[]
  updatedAt: number
  integrityHash: string
}

export interface CommercialPlatformPersistenceV1 {
  load(): Promise<CommercialPlatformSnapshotV1 | null>
  compareAndSwap(input: {
    expectedRevision: number | null
    snapshot: CommercialPlatformSnapshotV1
  }): Promise<boolean>
}

export class CommercialAuthorityErrorV1 extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[commercial-authority:${code}] ${message}`)
    this.name = 'CommercialAuthorityErrorV1'
  }
}

function fail(code: string, message: string): never {
  throw new CommercialAuthorityErrorV1(code, message)
}

function stableKey(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !value || value.length > maximum
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail('protocol', `${label} 无效`)
  return value
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('protocol', `${label} 无效`)
  return value.trim().normalize('NFC')
}

function sha(value: unknown, label: string): string {
  const result = text(value, label, 64)
  if (!/^[0-9a-f]{64}$/.test(result)) fail('protocol', `${label} 必须是 sha256`)
  return result
}

function requestId(value: unknown): string {
  return stableKey(value, 'requestId')
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function publicListing(listing: CommercialListingV1): CommercialListingV1 {
  return clone(listing)
}

function requirePermission(principal: CommercialPrincipalV1, permission: CommercialPermissionV1): void {
  if (!principal.permissions.includes(permission)) fail('forbidden', `缺少权限:${permission}`)
}

function validateLicense(value: CommercialLicenseV1): CommercialLicenseV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('protocol', 'license 无效')
  const expected = [
    'licenseId', 'licenseVersion', 'allowOfflineExport', 'allowRemix', 'commercialReuse',
    'requiresAttribution', 'termsUrl',
  ]
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) fail('protocol', 'license 字段不符合合同')
  if (['allowOfflineExport', 'allowRemix', 'commercialReuse', 'requiresAttribution']
    .some(field => typeof value[field as keyof CommercialLicenseV1] !== 'boolean')) fail('protocol', 'license 权限无效')
  const termsUrl = text(value.termsUrl, 'license.termsUrl', 2_000)
  let parsed: URL
  try { parsed = new URL(termsUrl) } catch { fail('protocol', 'license.termsUrl 无效') }
  if (parsed.protocol !== 'https:') fail('protocol', 'license.termsUrl 必须使用 HTTPS')
  return {
    licenseId: stableKey(value.licenseId, 'license.licenseId'),
    licenseVersion: stableKey(value.licenseVersion, 'license.licenseVersion'),
    allowOfflineExport: value.allowOfflineExport,
    allowRemix: value.allowRemix,
    commercialReuse: value.commercialReuse,
    requiresAttribution: value.requiresAttribution,
    termsUrl,
  }
}

function validProduct(value: ProductionProductKindV1): ProductionProductKindV1 {
  if (!isProductionProductKindV1(value)) {
    fail('protocol', 'productType 无效')
  }
  return value
}

function snapshotBody(snapshot: Omit<CommercialPlatformSnapshotV1, 'integrityHash'>) {
  return snapshot
}

export async function verifyCommercialPlatformSnapshotV1(snapshot: CommercialPlatformSnapshotV1): Promise<void> {
  if (snapshot.schema !== 'storyforge.commercial-platform-snapshot' || snapshot.version !== 1
    || !Number.isInteger(snapshot.revision) || snapshot.revision < 1
    || !Array.isArray(snapshot.listings) || !Array.isArray(snapshot.orders)
    || !Array.isArray(snapshot.entitlements) || !Array.isArray(snapshot.ledger)
    || !Array.isArray(snapshot.receipts) || !Array.isArray(snapshot.paymentEvents)
    || !Array.isArray(snapshot.audits)) fail('snapshot_invalid', '商业平台快照结构无效')
  const { integrityHash: _integrityHash, ...body } = snapshot
  if (await hashCanonicalValue(snapshotBody(body)) !== snapshot.integrityHash) {
    fail('snapshot_corrupt', '商业平台快照完整性校验失败')
  }
}

export class CommercialPlatformAuthorityV1 {
  private revision = 0
  private readonly listings = new Map<string, CommercialListingV1>()
  private readonly orders = new Map<string, CommercialOrderV1>()
  private readonly entitlements = new Map<string, CommercialEntitlementV1>()
  private readonly ledger: CommercialLedgerEntryV1[] = []
  private readonly receipts = new Map<string, StoredReceiptV1>()
  private readonly paymentEvents = new Map<string, StoredPaymentEventV1>()
  private readonly audits: CommercialAuditEntryV1[] = []
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly persistence: CommercialPlatformPersistenceV1,
    private readonly now: () => number,
  ) {}

  static async create(input: {
    persistence: CommercialPlatformPersistenceV1
    now?: () => number
  }): Promise<CommercialPlatformAuthorityV1> {
    const authority = new CommercialPlatformAuthorityV1(input.persistence, input.now ?? (() => Date.now()))
    await authority.persist(null)
    return authority
  }

  static async restore(input: {
    persistence: CommercialPlatformPersistenceV1
    now?: () => number
  }): Promise<CommercialPlatformAuthorityV1> {
    const snapshot = await input.persistence.load()
    if (!snapshot) fail('snapshot_missing', '商业平台持久化快照不存在')
    await verifyCommercialPlatformSnapshotV1(snapshot)
    const authority = new CommercialPlatformAuthorityV1(input.persistence, input.now ?? (() => Date.now()))
    authority.restoreLocal(snapshot)
    return authority
  }

  async createListing(input: {
    principal: CommercialPrincipalV1
    requestId: string
    releaseHash: string
    productType: ProductionProductKindV1
    title: string
    summary: string
    contentWarnings: string[]
    license: CommercialLicenseV1
    currency: string
    amountMinor: number
    creatorShareBps: number
  }): Promise<CommercialListingV1> {
    const principalId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(principalId, requestId(input.requestId), input, async () => {
      if (!/^[A-Z]{3}$/.test(input.currency)) fail('protocol', 'currency 无效')
      if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0 || input.amountMinor > 1_000_000_000) {
        fail('protocol', 'amountMinor 无效')
      }
      if (!Number.isInteger(input.creatorShareBps) || input.creatorShareBps < 0 || input.creatorShareBps > 10_000) {
        fail('protocol', 'creatorShareBps 无效')
      }
      if (!Array.isArray(input.contentWarnings) || input.contentWarnings.length > 50) fail('protocol', 'contentWarnings 无效')
      const contentWarnings = input.contentWarnings.map((item, index) => text(item, `contentWarnings[${index}]`, 500))
      if (new Set(contentWarnings).size !== contentWarnings.length) fail('protocol', 'contentWarnings 不能重复')
      const createdAt = this.now()
      const listing: CommercialListingV1 = {
        listingId: `listing.${crypto.randomUUID()}`,
        releaseHash: sha(input.releaseHash, 'releaseHash'),
        creatorId: principalId,
        productType: validProduct(input.productType),
        title: text(input.title, 'title', 300),
        summary: text(input.summary, 'summary', 4_000),
        contentWarnings,
        license: validateLicense(input.license),
        currency: input.currency,
        amountMinor: input.amountMinor,
        creatorShareBps: input.creatorShareBps,
        status: 'draft', rightsConfirmed: false, reviewedBy: null, reviewReasonCode: null,
        createdAt, updatedAt: createdAt,
      }
      this.listings.set(listing.listingId, listing)
      this.audit('listing.created', principalId, listing.listingId)
      return publicListing(listing)
    })
  }

  publishListing(input: {
    principal: CommercialPrincipalV1
    requestId: string
    listingId: string
    rightsConfirmed: boolean
  }): Promise<CommercialListingV1> {
    const principalId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(principalId, requestId(input.requestId), input, async () => {
      requirePermission(input.principal, 'catalog:publish')
      const listing = this.requireListing(input.listingId)
      if (listing.status !== 'submitted') fail('invalid_transition', '只有已提交审核的目录项可以发布')
      if (input.rightsConfirmed !== true) fail('rights_required', '发布前必须确认权利与许可')
      listing.status = 'published'
      listing.rightsConfirmed = true
      listing.reviewedBy = principalId
      listing.reviewReasonCode = null
      listing.updatedAt = this.now()
      this.audit('listing.published', principalId, listing.listingId)
      return publicListing(listing)
    })
  }

  submitListing(input: {
    principal: CommercialPrincipalV1
    requestId: string
    listingId: string
    rightsConfirmed: boolean
  }): Promise<CommercialListingV1> {
    const principalId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(principalId, requestId(input.requestId), input, async () => {
      const listing = this.requireListing(input.listingId)
      if (listing.creatorId !== principalId) fail('forbidden', '只有创作者可以提交目录审核')
      if (listing.status !== 'draft') fail('invalid_transition', '只有草稿目录项可以提交审核')
      if (input.rightsConfirmed !== true) fail('rights_required', '提交审核前必须确认权利与许可')
      listing.status = 'submitted'
      listing.rightsConfirmed = true
      listing.reviewedBy = null
      listing.reviewReasonCode = null
      listing.updatedAt = this.now()
      this.audit('listing.submitted', principalId, listing.listingId)
      return publicListing(listing)
    })
  }

  requestListingChanges(input: {
    principal: CommercialPrincipalV1
    requestId: string
    listingId: string
    reasonCode: string
  }): Promise<CommercialListingV1> {
    const principalId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(principalId, requestId(input.requestId), input, async () => {
      requirePermission(input.principal, 'catalog:publish')
      const listing = this.requireListing(input.listingId)
      if (listing.status !== 'submitted') fail('invalid_transition', '只有审核中的目录项可以要求修改')
      listing.status = 'changes-requested'
      listing.rightsConfirmed = false
      listing.reviewedBy = principalId
      listing.reviewReasonCode = stableKey(input.reasonCode, 'reasonCode')
      listing.updatedAt = this.now()
      this.audit('listing.changes-requested', principalId, listing.listingId)
      return publicListing(listing)
    })
  }

  reviseListing(input: {
    principal: CommercialPrincipalV1
    requestId: string
    listingId: string
    releaseHash: string
    title: string
    summary: string
    contentWarnings: string[]
    license: CommercialLicenseV1
    currency: string
    amountMinor: number
    creatorShareBps: number
  }): Promise<CommercialListingV1> {
    const principalId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(principalId, requestId(input.requestId), input, async () => {
      const listing = this.requireListing(input.listingId)
      if (listing.creatorId !== principalId) fail('forbidden', '只有创作者可以修订目录项')
      if (listing.status !== 'changes-requested') fail('invalid_transition', '只有被要求修改的目录项可以修订')
      if (!/^[A-Z]{3}$/.test(input.currency)) fail('protocol', 'currency 无效')
      if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0 || input.amountMinor > 1_000_000_000) fail('protocol', 'amountMinor 无效')
      if (!Number.isInteger(input.creatorShareBps) || input.creatorShareBps < 0 || input.creatorShareBps > 10_000) fail('protocol', 'creatorShareBps 无效')
      if (!Array.isArray(input.contentWarnings) || input.contentWarnings.length > 50) fail('protocol', 'contentWarnings 无效')
      const contentWarnings = input.contentWarnings.map((item, index) => text(item, `contentWarnings[${index}]`, 500))
      if (new Set(contentWarnings).size !== contentWarnings.length) fail('protocol', 'contentWarnings 不能重复')
      listing.releaseHash = sha(input.releaseHash, 'releaseHash')
      listing.title = text(input.title, 'title', 300)
      listing.summary = text(input.summary, 'summary', 4_000)
      listing.contentWarnings = contentWarnings
      listing.license = validateLicense(input.license)
      listing.currency = input.currency
      listing.amountMinor = input.amountMinor
      listing.creatorShareBps = input.creatorShareBps
      listing.status = 'draft'
      listing.rightsConfirmed = false
      listing.reviewedBy = null
      listing.reviewReasonCode = null
      listing.updatedAt = this.now()
      this.audit('listing.revised', principalId, listing.listingId)
      return publicListing(listing)
    })
  }

  suspendListing(input: {
    principal: CommercialPrincipalV1
    requestId: string
    listingId: string
    reasonCode: string
  }): Promise<CommercialListingV1> {
    const principalId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(principalId, requestId(input.requestId), input, async () => {
      requirePermission(input.principal, 'catalog:moderate')
      stableKey(input.reasonCode, 'reasonCode')
      const listing = this.requireListing(input.listingId)
      if (listing.status === 'suspended') return publicListing(listing)
      listing.status = 'suspended'
      listing.updatedAt = this.now()
      for (const entitlement of this.entitlements.values()) {
        if (entitlement.listingId !== listing.listingId) continue
        entitlement.status = 'moderation-hold'
        entitlement.hostedAccess = false
        entitlement.updatedAt = this.now()
      }
      this.audit('listing.suspended', principalId, listing.listingId)
      return publicListing(listing)
    })
  }

  withdrawListing(input: {
    principal: CommercialPrincipalV1
    requestId: string
    listingId: string
  }): Promise<CommercialListingV1> {
    const principalId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(principalId, requestId(input.requestId), input, async () => {
      const listing = this.requireListing(input.listingId)
      if (listing.creatorId !== principalId) fail('forbidden', '只有创作者可以撤回目录项')
      if (!['draft', 'submitted', 'changes-requested', 'published'].includes(listing.status)) fail('invalid_transition', '当前目录状态不能撤回')
      listing.status = 'withdrawn'
      listing.updatedAt = this.now()
      this.audit('listing.withdrawn', principalId, listing.listingId)
      return publicListing(listing)
    })
  }

  async beginAcquisition(input: {
    principal: CommercialPrincipalV1
    requestId: string
    listingId: string
  }): Promise<{ order: CommercialOrderV1; entitlement: CommercialEntitlementV1 | null }> {
    const buyerId = stableKey(input.principal.userId, 'principal.userId')
    return this.command(buyerId, requestId(input.requestId), input, async () => {
      const listing = this.requireListing(input.listingId)
      if (listing.status !== 'published' || !listing.rightsConfirmed) fail('listing_unavailable', '目录项当前不可领取或购买')
      if (listing.creatorId === buyerId) fail('self_purchase', '创作者不需要购买自己的 Release')
      if ([...this.entitlements.values()].some(row => row.buyerId === buyerId
        && row.releaseHash === listing.releaseHash && row.status === 'active')) {
        fail('already_owned', '当前账号已经拥有这个 Release')
      }
      if ([...this.orders.values()].some(row => row.buyerId === buyerId
        && row.releaseHash === listing.releaseHash && row.status === 'pending')) {
        fail('payment_pending', '当前账号已有待支付订单')
      }
      const createdAt = this.now()
      const creatorShareMinor = Math.floor(listing.amountMinor * listing.creatorShareBps / 10_000)
      const order: CommercialOrderV1 = {
        orderId: `order.${crypto.randomUUID()}`,
        listingId: listing.listingId,
        releaseHash: listing.releaseHash,
        buyerId,
        creatorId: listing.creatorId,
        currency: listing.currency,
        amountMinor: listing.amountMinor,
        creatorShareMinor,
        platformShareMinor: listing.amountMinor - creatorShareMinor,
        status: listing.amountMinor === 0 ? 'paid' : 'pending',
        providerReference: listing.amountMinor === 0 ? 'free' : null,
        createdAt, updatedAt: createdAt,
      }
      this.orders.set(order.orderId, order)
      const entitlement = listing.amountMinor === 0 ? this.grantEntitlement(order, listing) : null
      this.audit(listing.amountMinor === 0 ? 'listing.claimed' : 'order.created', buyerId, order.orderId)
      return { order: clone(order), entitlement: entitlement ? clone(entitlement) : null }
    })
  }

  async applyPaymentEvent(input: {
    event: CommercialPaymentEventV1
  }): Promise<{ order: CommercialOrderV1; entitlement: CommercialEntitlementV1 | null; duplicate: boolean }> {
    return this.mutate(async () => {
      const event = parseCommercialPaymentEventV1(input.event)
      const fingerprint = await hashCanonicalValue(event)
      const prior = this.paymentEvents.get(stableKey(event.eventId, 'eventId'))
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('event_conflict', '支付 eventId 已被不同事件使用')
        const order = this.requireOrder(prior.orderId)
        return { order: clone(order), entitlement: this.entitlementForOrder(order.orderId), duplicate: true }
      }
      const order = this.requireOrder(event.orderId)
      if (event.currency !== order.currency || event.amountMinor !== order.amountMinor) {
        fail('payment_mismatch', '支付事件金额或币种与订单不一致')
      }
      if (event.providerReference === 'free') fail('payment_mismatch', '付费回执不能使用 free providerReference')
      const listing = this.requireListing(order.listingId)
      let entitlement: CommercialEntitlementV1 | null = null
      if (event.type === 'payment.succeeded') {
        if (order.status !== 'pending') fail('invalid_transition', '当前订单不能确认支付')
        order.status = 'paid'
        order.providerReference = event.providerReference
        order.updatedAt = this.now()
        entitlement = this.grantEntitlement(order, listing)
        this.appendSaleLedger(order)
      } else if (event.type === 'payment.failed') {
        if (order.status !== 'pending') fail('invalid_transition', '当前订单不能标记失败')
        order.status = 'failed'
        order.providerReference = event.providerReference
        order.updatedAt = this.now()
      } else if (event.type === 'refund.succeeded') {
        if (!['paid', 'disputed'].includes(order.status)) fail('invalid_transition', '当前订单不能退款')
        order.status = 'refunded'
        order.updatedAt = this.now()
        entitlement = this.requireEntitlementForOrder(order.orderId)
        entitlement.status = 'refunded'
        entitlement.hostedAccess = false
        entitlement.localCopyPreserved = entitlement.license.allowOfflineExport
        entitlement.updatedAt = this.now()
        this.appendRefundLedger(order)
      } else {
        if (order.status !== 'paid') fail('invalid_transition', '当前订单不能进入争议')
        order.status = 'disputed'
        order.updatedAt = this.now()
        entitlement = this.requireEntitlementForOrder(order.orderId)
        entitlement.status = 'disputed'
        entitlement.hostedAccess = false
        entitlement.updatedAt = this.now()
      }
      this.paymentEvents.set(event.eventId, { fingerprint, orderId: order.orderId, status: order.status })
      this.audit(`payment.${event.type}`, 'payment-provider', order.orderId)
      return { order: clone(order), entitlement: entitlement ? clone(entitlement) : null, duplicate: false }
    })
  }

  discover(input: { productType?: ProductionProductKindV1; query?: string }): CommercialListingV1[] {
    const query = input.query?.trim().toLocaleLowerCase() ?? ''
    return [...this.listings.values()]
      .filter(listing => listing.status === 'published')
      .filter(listing => !input.productType || listing.productType === input.productType)
      .filter(listing => !query || `${listing.title}\n${listing.summary}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.listingId.localeCompare(right.listingId))
      .map(publicListing)
  }

  listingForReview(input: {
    principal: CommercialPrincipalV1
    listingId: string
  }): CommercialListingV1 {
    requirePermission(input.principal, 'catalog:publish')
    return publicListing(this.requireListing(input.listingId))
  }

  listingForCreator(input: {
    principal: CommercialPrincipalV1
    listingId: string
  }): CommercialListingV1 {
    const userId = stableKey(input.principal.userId, 'principal.userId')
    const listing = this.requireListing(input.listingId)
    if (listing.creatorId !== userId) fail('forbidden', '目录项不属于当前创作者')
    return publicListing(listing)
  }

  listingsForCreator(input: { principal: CommercialPrincipalV1 }): CommercialListingV1[] {
    const userId = stableKey(input.principal.userId, 'principal.userId')
    return [...this.listings.values()].filter(listing => listing.creatorId === userId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.listingId.localeCompare(right.listingId))
      .map(publicListing)
  }

  listingReviewQueue(input: { principal: CommercialPrincipalV1 }): CommercialListingV1[] {
    requirePermission(input.principal, 'catalog:publish')
    return [...this.listings.values()].filter(listing => listing.status === 'submitted')
      .sort((left, right) => left.updatedAt - right.updatedAt || left.listingId.localeCompare(right.listingId))
      .map(publicListing)
  }

  entitlementFor(input: { principal: CommercialPrincipalV1; releaseHash: string }): CommercialEntitlementV1 | null {
    const buyerId = stableKey(input.principal.userId, 'principal.userId')
    const releaseHash = sha(input.releaseHash, 'releaseHash')
    const entitlement = [...this.entitlements.values()].find(row => row.buyerId === buyerId && row.releaseHash === releaseHash)
    return entitlement ? clone(entitlement) : null
  }

  authorizeRemix(input: { principal: CommercialPrincipalV1; releaseHash: string }): {
    sourceReleaseHash: string
    license: CommercialLicenseV1
    attributionRequired: boolean
  } {
    const entitlement = this.entitlementFor(input)
    if (!entitlement || entitlement.status !== 'active' || !entitlement.hostedAccess) {
      fail('entitlement_required', '没有可用于派生的有效权益')
    }
    const listing = this.requireListing(entitlement.listingId)
    if (listing.status === 'suspended') fail('moderation_hold', '来源 Release 正在治理冻结')
    if (!entitlement.license.allowRemix) fail('license_forbidden', '当前许可不允许 remix')
    return {
      sourceReleaseHash: entitlement.releaseHash,
      license: clone(entitlement.license),
      attributionRequired: entitlement.license.requiresAttribution,
    }
  }

  /**
   * Authorize an immutable offline copy. The creator may verify their own
   * registered delivery; a buyer needs an active hosted entitlement. Refunds
   * preserve copies already exported but do not mint a fresh download grant.
   */
  authorizeOfflineDelivery(input: {
    principal: CommercialPrincipalV1
    releaseHash: string
  }): CommercialOfflineDeliveryAuthorizationV1 {
    const userId = stableKey(input.principal.userId, 'principal.userId')
    const releaseHash = sha(input.releaseHash, 'releaseHash')
    const ownedListing = [...this.listings.values()].find(row => row.creatorId === userId
      && row.releaseHash === releaseHash && row.status !== 'suspended' && row.status !== 'withdrawn')
    if (ownedListing) {
      if (!ownedListing.license.allowOfflineExport) fail('license_forbidden', '当前许可不允许离线交付')
      return {
        releaseHash, listingId: ownedListing.listingId, orderId: null, entitlementId: null,
        license: clone(ownedListing.license),
        attribution: ownedListing.license.requiresAttribution ? [ownedListing.title] : [],
        localCopyPreserved: true, acquiredAt: ownedListing.createdAt,
      }
    }
    const entitlement = [...this.entitlements.values()].find(row => row.buyerId === userId
      && row.releaseHash === releaseHash)
    if (!entitlement || entitlement.status !== 'active' || !entitlement.hostedAccess) {
      fail('entitlement_required', '没有可下载此 Release 的有效权益')
    }
    const listing = this.requireListing(entitlement.listingId)
    if (listing.status === 'suspended') fail('moderation_hold', '来源 Release 正在治理冻结')
    if (!entitlement.license.allowOfflineExport) fail('license_forbidden', '当前许可不允许离线交付')
    return {
      releaseHash, listingId: listing.listingId, orderId: entitlement.orderId,
      entitlementId: entitlement.entitlementId, license: clone(entitlement.license),
      attribution: entitlement.license.requiresAttribution ? [listing.title] : [],
      localCopyPreserved: true, acquiredAt: entitlement.acquiredAt,
    }
  }

  /**
   * Service-to-service authorization used by room/LFG provisioning. It does
   * not mint a new capability: creators derive access from their own active
   * catalog entry, buyers from an active hosted entitlement.
   */
  canHostRelease(input: { principal: CommercialPrincipalV1; releaseHash: string }): boolean {
    const userId = stableKey(input.principal.userId, 'principal.userId')
    const releaseHash = sha(input.releaseHash, 'releaseHash')
    const creatorListing = [...this.listings.values()].find(row => row.creatorId === userId
      && row.releaseHash === releaseHash && row.status === 'published' && row.rightsConfirmed)
    if (creatorListing) return true
    const entitlement = [...this.entitlements.values()].find(row => row.buyerId === userId
      && row.releaseHash === releaseHash)
    return entitlement?.status === 'active' && entitlement.hostedAccess
  }

  /** A release may enter the lineage graph only through its catalog owner. */
  canRegisterRelease(input: { principal: CommercialPrincipalV1; releaseHash: string }): boolean {
    const userId = stableKey(input.principal.userId, 'principal.userId')
    const releaseHash = sha(input.releaseHash, 'releaseHash')
    return [...this.listings.values()].some(row => row.creatorId === userId
      && row.releaseHash === releaseHash && row.status !== 'suspended' && row.status !== 'withdrawn')
  }

  ledgerForOrder(orderId: string): CommercialLedgerEntryV1[] {
    return this.ledger.filter(entry => entry.orderId === orderId).map(clone)
  }

  auditLog(): CommercialAuditEntryV1[] {
    return this.audits.map(clone)
  }

  private requireListing(listingId: string): CommercialListingV1 {
    const listing = this.listings.get(stableKey(listingId, 'listingId'))
    if (!listing) fail('listing_not_found', '目录项不存在')
    return listing
  }

  private requireOrder(orderId: string): CommercialOrderV1 {
    const order = this.orders.get(stableKey(orderId, 'orderId'))
    if (!order) fail('order_not_found', '订单不存在')
    return order
  }

  private entitlementForOrder(orderId: string): CommercialEntitlementV1 | null {
    const entitlement = [...this.entitlements.values()].find(row => row.orderId === orderId)
    return entitlement ? clone(entitlement) : null
  }

  private requireEntitlementForOrder(orderId: string): CommercialEntitlementV1 {
    const entitlement = [...this.entitlements.values()].find(row => row.orderId === orderId)
    if (!entitlement) fail('entitlement_missing', '订单缺少权益')
    return entitlement
  }

  private grantEntitlement(order: CommercialOrderV1, listing: CommercialListingV1): CommercialEntitlementV1 {
    const existing = [...this.entitlements.values()].find(row => row.orderId === order.orderId)
    if (existing) return existing
    const entitlement: CommercialEntitlementV1 = {
      entitlementId: `entitlement.${crypto.randomUUID()}`,
      orderId: order.orderId,
      listingId: order.listingId,
      releaseHash: order.releaseHash,
      buyerId: order.buyerId,
      license: clone(listing.license),
      status: 'active', hostedAccess: true, localCopyPreserved: listing.license.allowOfflineExport,
      acquiredAt: this.now(), updatedAt: this.now(),
    }
    this.entitlements.set(entitlement.entitlementId, entitlement)
    return entitlement
  }

  private appendSaleLedger(order: CommercialOrderV1): void {
    this.appendLedger(order, 'cash', 'debit', order.amountMinor, 'sale')
    this.appendLedger(order, 'creator-payable', 'credit', order.creatorShareMinor, 'sale')
    this.appendLedger(order, 'platform-revenue', 'credit', order.platformShareMinor, 'sale')
  }

  private appendRefundLedger(order: CommercialOrderV1): void {
    this.appendLedger(order, 'creator-payable', 'debit', order.creatorShareMinor, 'refund')
    this.appendLedger(order, 'platform-revenue', 'debit', order.platformShareMinor, 'refund')
    this.appendLedger(order, 'cash', 'credit', order.amountMinor, 'refund')
  }

  private appendLedger(
    order: CommercialOrderV1,
    account: CommercialLedgerEntryV1['account'],
    direction: CommercialLedgerEntryV1['direction'],
    amountMinor: number,
    reason: CommercialLedgerEntryV1['reason'],
  ): void {
    if (amountMinor === 0) return
    this.ledger.push({
      entryId: `ledger.${crypto.randomUUID()}`, orderId: order.orderId,
      account, direction, amountMinor, reason, createdAt: this.now(),
    })
  }

  private audit(kind: string, actorId: string, subjectId: string): void {
    this.audits.push({
      sequence: this.audits.length + 1,
      kind, actorId, subjectId, outcome: 'accepted', createdAt: this.now(),
    })
  }

  private async command<T>(
    actorId: string,
    requestIdValue: string,
    fingerprintBody: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.mutate(async () => {
      const receiptKey = `${actorId}\u0000${requestIdValue}`
      const fingerprint = await hashCanonicalValue({ actorId, requestId: requestIdValue, body: fingerprintBody })
      const prior = this.receipts.get(receiptKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('request_conflict', 'requestId 已被不同命令使用')
        return clone(prior.result) as T
      }
      const result = await operation()
      this.receipts.set(receiptKey, { fingerprint, result: clone(result) })
      return result
    })
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    let releaseLock!: () => void
    const previous = this.mutationTail
    this.mutationTail = new Promise<void>(resolve => { releaseLock = resolve })
    await previous
    const backup = await this.snapshot(this.revision)
    try {
      const result = await operation()
      await this.persist(this.revision)
      return result
    } catch (error) {
      this.restoreLocal(backup)
      throw error
    } finally {
      releaseLock()
    }
  }

  private async persist(expectedRevision: number | null): Promise<void> {
    const nextRevision = expectedRevision == null ? 1 : expectedRevision + 1
    const snapshot = await this.snapshot(nextRevision)
    if (!await this.persistence.compareAndSwap({ expectedRevision, snapshot })) {
      fail('persistence_conflict', '商业平台持久化版本冲突')
    }
    this.revision = nextRevision
  }

  private async snapshot(revision: number): Promise<CommercialPlatformSnapshotV1> {
    const body: Omit<CommercialPlatformSnapshotV1, 'integrityHash'> = {
      schema: 'storyforge.commercial-platform-snapshot', version: 1, revision,
      listings: [...this.listings.values()].map(clone),
      orders: [...this.orders.values()].map(clone),
      entitlements: [...this.entitlements.values()].map(clone),
      ledger: this.ledger.map(clone),
      receipts: clone([...this.receipts]),
      paymentEvents: clone([...this.paymentEvents]),
      audits: this.audits.map(clone),
      updatedAt: this.now(),
    }
    return { ...body, integrityHash: await hashCanonicalValue(snapshotBody(body)) }
  }

  private restoreLocal(snapshot: CommercialPlatformSnapshotV1): void {
    this.revision = snapshot.revision
    this.listings.clear()
    this.orders.clear()
    this.entitlements.clear()
    this.receipts.clear()
    this.paymentEvents.clear()
    for (const row of snapshot.listings) this.listings.set(row.listingId, {
      ...clone(row), reviewReasonCode: row.reviewReasonCode ?? null,
    })
    for (const row of snapshot.orders) this.orders.set(row.orderId, clone(row))
    for (const row of snapshot.entitlements) this.entitlements.set(row.entitlementId, clone(row))
    this.ledger.splice(0, this.ledger.length, ...snapshot.ledger.map(clone))
    for (const [key, value] of snapshot.receipts) this.receipts.set(key, clone(value))
    for (const [key, value] of snapshot.paymentEvents) this.paymentEvents.set(key, clone(value))
    this.audits.splice(0, this.audits.length, ...snapshot.audits.map(clone))
  }
}
