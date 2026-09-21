import { beforeAll, describe, expect, it } from 'vitest'
import {
  createTextAdventureCommunitySubmissionV1,
  type TextAdventureCommunityPackageV1,
} from '../../src/lib/adventure/community-package'
import {
  CommercialPlatformAuthorityV1,
  type CommercialPlatformPersistenceV1,
  type CommercialPlatformSnapshotV1,
  type CommercialPrincipalV1,
} from '../../src/lib/commercial/authority'
import { createCommercialFetchHandlerV1 } from '../../src/lib/commercial/fetch-service'
import { createCommercialGatewayV1 } from '../../src/lib/commercial/gateway'
import { CommercialHttpClientV1 } from '../../src/lib/commercial/http-client'
import { createCommercialReleaseDeliveryGatewayV1 } from '../../src/lib/commercial/release-delivery-gateway'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  CommercialReleaseDeliveryServiceV1,
  InMemoryCommercialReleaseDeliveryPersistenceV1,
  type CommercialReleaseDeliveryPersistenceV1,
  type CommercialTextAdventureReviewAttestationV1,
  type CommercialTextAdventureReviewRecordV1,
} from '../../src/lib/commercial/release-delivery'
import { createTextAdventureCommunityPackageFixtureV1 } from '../helpers/text-adventure-community-package'

const CREATOR_TOKEN = 'token-creator-remote-candidate'
const PUBLISHER_TOKEN = 'token-publisher-remote-candidate'
const BUYER_TOKEN = 'token-buyer-remote-candidate'
const principals = new Map<string, CommercialPrincipalV1>([
  [CREATOR_TOKEN, { userId: 'user.creator', permissions: [] }],
  [PUBLISHER_TOKEN, { userId: 'user.publisher', permissions: ['catalog:publish'] }],
  [BUYER_TOKEN, { userId: 'user.buyer', permissions: [] }],
])

class ValidCommercialStore implements CommercialPlatformPersistenceV1 {
  snapshot: CommercialPlatformSnapshotV1 | null = null
  async load() { return this.snapshot ? structuredClone(this.snapshot) : null }
  async compareAndSwap(input: { expectedRevision: number | null; snapshot: CommercialPlatformSnapshotV1 }) {
    if ((this.snapshot?.revision ?? null) !== input.expectedRevision) return false
    this.snapshot = structuredClone(input.snapshot)
    return true
  }
}

class TamperableDeliveryPersistence implements CommercialReleaseDeliveryPersistenceV1 {
  readonly delegate = new InMemoryCommercialReleaseDeliveryPersistenceV1()
  tamperReview = false
  lastHeadSignal: AbortSignal | undefined
  lastAttestationSignal: AbortSignal | undefined
  load = this.delegate.load.bind(this.delegate)
  putIfAbsent = this.delegate.putIfAbsent.bind(this.delegate)
  loadUploadRequest = this.delegate.loadUploadRequest.bind(this.delegate)
  putUploadRequestIfAbsent = this.delegate.putUploadRequestIfAbsent.bind(this.delegate)
  completeUploadRequest = this.delegate.completeUploadRequest.bind(this.delegate)
  putTextAdventureReviewIfAbsent = this.delegate.putTextAdventureReviewIfAbsent.bind(this.delegate)
  putTextAdventureReviewAttestationIfAbsent = this.delegate.putTextAdventureReviewAttestationIfAbsent.bind(this.delegate)
  async head(releaseHash: string, options?: { signal?: AbortSignal }) {
    this.lastHeadSignal = options?.signal
    return this.delegate.head(releaseHash, options)
  }
  async loadTextAdventureReviewAttestation(input: {
    listingId: string
    releaseHash: string
    signal?: AbortSignal
  }) {
    this.lastAttestationSignal = input.signal
    return this.delegate.loadTextAdventureReviewAttestation(input)
  }
  async loadTextAdventureReview(input: { listingId: string; releaseHash: string }) {
    const row = await this.delegate.loadTextAdventureReview(input)
    if (!row || !this.tamperReview) return row
    return { ...row, recordHash: '0'.repeat(64) } as CommercialTextAdventureReviewRecordV1
  }
}

class FaultAfterReviewPersistence extends InMemoryCommercialReleaseDeliveryPersistenceV1 {
  failAfterFirstReviewWrite = true
  override async putTextAdventureReviewIfAbsent(record: CommercialTextAdventureReviewRecordV1) {
    const result = await super.putTextAdventureReviewIfAbsent(record)
    if (this.failAfterFirstReviewWrite) {
      this.failAfterFirstReviewWrite = false
      throw new Error('simulated process loss after durable review write')
    }
    return result
  }
}

class FaultBeforeReviewPersistence extends InMemoryCommercialReleaseDeliveryPersistenceV1 {
  failBeforeFirstReviewWrite = true
  override async putTextAdventureReviewIfAbsent(record: CommercialTextAdventureReviewRecordV1) {
    if (this.failBeforeFirstReviewWrite) {
      this.failBeforeFirstReviewWrite = false
      throw new Error('simulated process loss before durable review write')
    }
    return super.putTextAdventureReviewIfAbsent(record)
  }
}

class ConcurrentReviewPersistence extends InMemoryCommercialReleaseDeliveryPersistenceV1 {
  private arrivals = 0
  private release!: () => void
  private readonly bothArrived = new Promise<void>(resolve => { this.release = resolve })

  override async putTextAdventureReviewIfAbsent(record: CommercialTextAdventureReviewRecordV1) {
    this.arrivals += 1
    if (this.arrivals === 2) this.release()
    await this.bothArrived
    const result = await super.putTextAdventureReviewIfAbsent(record)
    if (result !== 'identical') return result
    const persisted = await this.loadTextAdventureReview({
      listingId: record.listingId, releaseHash: record.releaseHash,
    })
    // Model a strict provider CAS that compares the complete immutable record,
    // including its first-writer verifiedAt/recordHash.
    return persisted?.recordHash === record.recordHash ? 'identical' : 'conflict'
  }

  override async putTextAdventureReviewAttestationIfAbsent(
    record: CommercialTextAdventureReviewAttestationV1,
  ) {
    const result = await super.putTextAdventureReviewAttestationIfAbsent(record)
    return result === 'identical' ? 'conflict' : result
  }
}

class ConflictingCandidatePersistence extends InMemoryCommercialReleaseDeliveryPersistenceV1 {
  override async putTextAdventureReviewIfAbsent(record: CommercialTextAdventureReviewRecordV1) {
    const conflictingBody: Omit<CommercialTextAdventureReviewRecordV1, 'recordHash'> = {
      ...record,
      candidateHash: 'f'.repeat(64),
      candidate: { ...record.candidate, candidateHash: 'f'.repeat(64) },
    }
    await super.putTextAdventureReviewIfAbsent({
      ...conflictingBody,
      recordHash: await hashCanonicalValue(conflictingBody),
    })
    return 'conflict' as const
  }
}

function listingInput(candidate: TextAdventureCommunityPackageV1, productType: 'text-adventure' | 'avg' = 'text-adventure') {
  return {
    releaseHash: candidate.distributionBundle.productRelease.contentHash,
    productType,
    title: '远端候选闭环', summary: '服务端复验并冻结候选证据', contentWarnings: [],
    license: {
      licenseId: 'license.remote-candidate', licenseVersion: '1.0.0', allowOfflineExport: true,
      allowRemix: false, commercialReuse: false, requiresAttribution: false,
      termsUrl: 'https://storyforge.example/licenses/remote-candidate',
    },
    currency: 'CNY', amountMinor: 0, creatorShareBps: 8_000,
  } as const
}

async function platform(persistence: CommercialReleaseDeliveryPersistenceV1 = new InMemoryCommercialReleaseDeliveryPersistenceV1()) {
  const authority = await CommercialPlatformAuthorityV1.create({ persistence: new ValidCommercialStore() })
  const delivery = new CommercialReleaseDeliveryServiceV1(authority, persistence, () => 1_900_000_000_000)
  const identity = { authenticate: async (token: string) => structuredClone(principals.get(token) ?? null) }
  const commercialGateway = createCommercialGatewayV1({
    authority, identity, releaseDelivery: delivery,
    webhookSecret: 'remote-candidate-secret-at-least-16',
    checkoutProvider: { createOrResumeSession: async order => ({
      checkoutSessionId: `checkout.${order.orderId}`, orderId: order.orderId,
      checkoutUrl: `https://pay.storyforge.example/${order.orderId}`, expiresAt: 1_900_000_060_000,
    }) },
    now: () => 1_900_000_000_000,
  })
  const deliveryGateway = createCommercialReleaseDeliveryGatewayV1({ service: delivery, identity })
  const fetch = createCommercialFetchHandlerV1({
    commercialGateway, deliveryGateway, allowedOrigins: ['https://app.storyforge.test'], serviceVersion: 'test',
  })
  const client = new CommercialHttpClientV1({
    baseUrl: 'https://api.storyforge.test',
    fetch: async (url, init) => fetch(new Request(url, {
      ...init, headers: { ...init.headers, origin: 'https://app.storyforge.test' },
    })),
  })
  return { authority, delivery, persistence, client }
}

describe('TEXTADV-7 · remote community candidate handoff', () => {
  let candidate: TextAdventureCommunityPackageV1
  beforeAll(async () => { candidate = await createTextAdventureCommunityPackageFixtureV1() }, 30_000)

  it('把 bundle、版本化 dossier 与证据交给服务端复验并持久为可审核记录', async () => {
    const system = await platform()
    const listing = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.valid', ...listingInput(candidate),
    })
    const submission = createTextAdventureCommunitySubmissionV1(candidate)
    const registered = await system.client.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.remote.valid', listingId: listing.listingId,
      bundle: candidate.distributionBundle, textAdventureCandidate: submission,
    })
    expect(registered.textAdventureReview).toMatchObject({
      status: 'pending-review', listingId: listing.listingId,
      candidateHash: candidate.candidatePackageHash,
    })
    await expect(system.persistence.loadTextAdventureReview({
      listingId: listing.listingId, releaseHash: listing.releaseHash,
    })).resolves.toMatchObject({
      schema: 'storyforge.commercial-text-adventure-review-record', status: 'pending-review',
      candidateHash: candidate.candidatePackageHash,
      evidenceSummary: candidate.dossier.evidence,
    })
    await system.client.submitListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.submit', listingId: listing.listingId,
    })
    const review = await system.client.reviewTextAdventureCandidate({
      accessToken: PUBLISHER_TOKEN, listingId: listing.listingId,
    })
    expect(review).toMatchObject({
      listingId: listing.listingId, releaseHash: listing.releaseHash,
      bundleHash: candidate.distributionBundle.bundleHash,
      candidateHash: candidate.candidatePackageHash,
      dossier: candidate.dossier, evidenceSummary: candidate.dossier.evidence,
    })
    await system.client.publishListing({
      accessToken: PUBLISHER_TOKEN, requestId: 'listing.remote.publish', listingId: listing.listingId,
    })
    await expect(system.client.discover({ productType: 'text-adventure' }))
      .resolves.toMatchObject([{ listingId: listing.listingId }])
    await system.client.acquire({ accessToken: BUYER_TOKEN, requestId: 'listing.remote.claim', listingId: listing.listingId })
    await expect(system.client.downloadRelease({ accessToken: BUYER_TOKEN, releaseHash: listing.releaseHash }))
      .resolves.toMatchObject({ bundle: { bundleHash: candidate.distributionBundle.bundleHash } })
  }, 40_000)

  it('拒绝篡改 candidateHash、跨 Release/产品作用域和缺失候选的文字冒险上传', async () => {
    const system = await platform()
    const listing = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.negative', ...listingInput(candidate),
    })
    const tampered = createTextAdventureCommunitySubmissionV1(candidate)
    tampered.candidateHash = '0'.repeat(64)
    await expect(system.client.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.remote.tampered', listingId: listing.listingId,
      bundle: candidate.distributionBundle, textAdventureCandidate: tampered,
    })).rejects.toMatchObject({ code: 'candidate_invalid', status: 422 })
    await expect(system.client.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.remote.missing', bundle: candidate.distributionBundle,
    })).rejects.toMatchObject({ code: 'candidate_required', status: 422 })

    const wrongProduct = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.wrong-product', ...listingInput(candidate, 'avg'),
    })
    await expect(system.client.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.remote.wrong-product', listingId: wrongProduct.listingId,
      bundle: candidate.distributionBundle,
      textAdventureCandidate: createTextAdventureCommunitySubmissionV1(candidate),
    })).rejects.toMatchObject({ code: 'release_forbidden', status: 403 })

    const wrongRelease = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.wrong-release',
      ...listingInput(candidate), releaseHash: 'f'.repeat(64),
    })
    await expect(system.client.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.remote.wrong-release', listingId: wrongRelease.listingId,
      bundle: candidate.distributionBundle,
      textAdventureCandidate: createTextAdventureCommunitySubmissionV1(candidate),
    })).rejects.toMatchObject({ code: 'release_forbidden', status: 403 })
  }, 40_000)

  it('持久化候选损坏后发布完整复验 fail-closed，legacy published 文字冒险不进入发现或领取', async () => {
    const persistence = new TamperableDeliveryPersistence()
    const system = await platform(persistence)
    const listing = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.corrupt', ...listingInput(candidate),
    })
    await system.client.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.remote.corrupt', listingId: listing.listingId,
      bundle: candidate.distributionBundle,
      textAdventureCandidate: createTextAdventureCommunitySubmissionV1(candidate),
    })
    persistence.tamperReview = true
    await expect(system.client.submitListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.corrupt-submit', listingId: listing.listingId,
    })).resolves.toMatchObject({ status: 'submitted' })
    await expect(system.client.publishListing({
      accessToken: PUBLISHER_TOKEN, requestId: 'listing.remote.corrupt-publish', listingId: listing.listingId,
    })).rejects.toMatchObject({ code: 'release_corrupt', status: 409 })

    const legacy = await system.authority.createListing({
      principal: principals.get(CREATOR_TOKEN)!, requestId: 'listing.legacy.create', ...listingInput(candidate),
    })
    await system.authority.submitListing({
      principal: principals.get(CREATOR_TOKEN)!, requestId: 'listing.legacy.submit',
      listingId: legacy.listingId, rightsConfirmed: true,
    })
    await system.authority.publishListing({
      principal: principals.get(PUBLISHER_TOKEN)!, requestId: 'listing.legacy.publish',
      listingId: legacy.listingId, rightsConfirmed: true,
    })
    await expect(system.client.discover({ productType: 'text-adventure' })).resolves.toEqual([])
    await expect(system.client.acquire({
      accessToken: BUYER_TOKEN, requestId: 'listing.legacy.claim', listingId: legacy.listingId,
    })).rejects.toMatchObject({ code: 'release_delivery_missing', status: 409 })
  }, 40_000)

  it('持久化 requestId 回执跨 service 重建及系统时钟回拨恢复，并拒绝同 requestId 更换绑定', async () => {
    const persistence = new FaultAfterReviewPersistence()
    const system = await platform(persistence)
    const listing = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.idempotent', ...listingInput(candidate),
    })
    const submission = createTextAdventureCommunitySubmissionV1(candidate)
    await expect(system.client.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.remote.idempotent', listingId: listing.listingId,
      bundle: candidate.distributionBundle, textAdventureCandidate: submission,
    })).rejects.toMatchObject({ code: 'internal_error', status: 500 })
    await expect(persistence.loadUploadRequest({
      creatorId: 'user.creator', requestId: 'release.remote.idempotent',
    })).resolves.toMatchObject({
      status: 'processing', listingId: listing.listingId,
      releaseHash: listing.releaseHash, bundleHash: candidate.distributionBundle.bundleHash,
      candidateHash: candidate.candidatePackageHash, completedAt: null,
    })

    const reconstructed = new CommercialReleaseDeliveryServiceV1(
      system.authority, persistence, () => 1_899_999_000_000,
    )
    const recovered = await reconstructed.registerCreatorBundle({
      principal: principals.get(CREATOR_TOKEN)!, requestId: 'release.remote.idempotent',
      listingId: listing.listingId, bundle: candidate.distributionBundle,
      textAdventureCandidate: submission,
    })
    const exactRetry = await new CommercialReleaseDeliveryServiceV1(
      system.authority, persistence, () => 1_900_000_200_000,
    ).registerCreatorBundle({
      principal: principals.get(CREATOR_TOKEN)!, requestId: 'release.remote.idempotent',
      listingId: listing.listingId, bundle: candidate.distributionBundle,
      textAdventureCandidate: submission,
    })
    expect(exactRetry).toEqual(recovered)
    expect(recovered).toMatchObject({
      releaseHash: listing.releaseHash, bundleHash: candidate.distributionBundle.bundleHash,
      duplicate: false,
      textAdventureReview: { listingId: listing.listingId, candidateHash: candidate.candidatePackageHash },
    })
    await expect(persistence.loadUploadRequest({
      creatorId: 'user.creator', requestId: 'release.remote.idempotent',
    })).resolves.toMatchObject({ status: 'completed', result: recovered, completedAt: 1_900_000_000_000 })

    const otherListing = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.idempotent-conflict', ...listingInput(candidate),
    })
    await expect(system.client.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.remote.idempotent', listingId: otherListing.listingId,
      bundle: candidate.distributionBundle, textAdventureCandidate: submission,
    })).rejects.toMatchObject({ code: 'request_conflict', status: 409 })
  }, 40_000)

  it('A 在候选写入前中断、B 用新 requestId 完成后，A 的精确重试复用同一审核记录', async () => {
    const persistence = new FaultBeforeReviewPersistence()
    const system = await platform(persistence)
    const listing = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.cross-request-recovery', ...listingInput(candidate),
    })
    const submission = createTextAdventureCommunitySubmissionV1(candidate)
    const registration = {
      principal: principals.get(CREATOR_TOKEN)!, listingId: listing.listingId,
      bundle: candidate.distributionBundle, textAdventureCandidate: submission,
    }
    await expect(new CommercialReleaseDeliveryServiceV1(
      system.authority, persistence, () => 1_900_000_100_000,
    ).registerCreatorBundle({ ...registration, requestId: 'release.remote.request-a' }))
      .rejects.toThrow('simulated process loss before durable review write')

    const requestB = await new CommercialReleaseDeliveryServiceV1(
      system.authority, persistence, () => 1_900_000_200_000,
    ).registerCreatorBundle({ ...registration, requestId: 'release.remote.request-b' })
    const recoveredA = await new CommercialReleaseDeliveryServiceV1(
      system.authority, persistence, () => 1_900_000_300_000,
    ).registerCreatorBundle({ ...registration, requestId: 'release.remote.request-a' })

    expect(recoveredA.textAdventureReview).toEqual(requestB.textAdventureReview)
    const review = await persistence.loadTextAdventureReview({
      listingId: listing.listingId, releaseHash: listing.releaseHash,
    })
    expect(review).toMatchObject({
      verifiedAt: 1_900_000_200_000,
      recordHash: requestB.textAdventureReview?.recordHash,
    })
    await expect(Promise.all(['release.remote.request-a', 'release.remote.request-b'].map(requestId => (
      persistence.loadUploadRequest({ creatorId: 'user.creator', requestId })
    )))).resolves.toMatchObject([
      { status: 'completed', result: recoveredA },
      { status: 'completed', result: requestB },
    ])
  }, 40_000)

  it('两个不同 requestId 并发写同一候选时收敛到一个规范 review/attestation', async () => {
    const persistence = new ConcurrentReviewPersistence()
    const system = await platform(persistence)
    const listing = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.concurrent', ...listingInput(candidate),
    })
    const registration = {
      principal: principals.get(CREATOR_TOKEN)!, listingId: listing.listingId,
      bundle: candidate.distributionBundle,
      textAdventureCandidate: createTextAdventureCommunitySubmissionV1(candidate),
    }
    const [first, second] = await Promise.all([
      new CommercialReleaseDeliveryServiceV1(
        system.authority, persistence, () => 1_900_000_400_000,
      ).registerCreatorBundle({ ...registration, requestId: 'release.remote.concurrent-a' }),
      new CommercialReleaseDeliveryServiceV1(
        system.authority, persistence, () => 1_900_000_500_000,
      ).registerCreatorBundle({ ...registration, requestId: 'release.remote.concurrent-b' }),
    ])
    expect(first.textAdventureReview).toEqual(second.textAdventureReview)
    const [review, attestation] = await Promise.all([
      persistence.loadTextAdventureReview({ listingId: listing.listingId, releaseHash: listing.releaseHash }),
      persistence.loadTextAdventureReviewAttestation({ listingId: listing.listingId, releaseHash: listing.releaseHash }),
    ])
    expect(review).toMatchObject({
      recordHash: first.textAdventureReview?.recordHash,
    })
    expect(attestation).toMatchObject({
      reviewRecordHash: first.textAdventureReview?.recordHash,
    })
    expect([1_900_000_400_000, 1_900_000_500_000]).toContain(review?.verifiedAt)
    expect(attestation?.verifiedAt).toBe(review?.verifiedAt)
  }, 40_000)

  it('不同 candidateHash 的首写 CAS 冲突不得被并发收敛逻辑接纳', async () => {
    const persistence = new ConflictingCandidatePersistence()
    const system = await platform(persistence)
    const listing = await system.client.createListing({
      accessToken: CREATOR_TOKEN, requestId: 'listing.remote.candidate-conflict', ...listingInput(candidate),
    })
    await expect(system.client.registerRelease({
      accessToken: CREATOR_TOKEN, requestId: 'release.remote.candidate-conflict', listingId: listing.listingId,
      bundle: candidate.distributionBundle,
      textAdventureCandidate: createTextAdventureCommunitySubmissionV1(candidate),
    })).rejects.toMatchObject({ code: 'candidate_conflict', status: 409 })
    await expect(persistence.loadUploadRequest({
      creatorId: 'user.creator', requestId: 'release.remote.candidate-conflict',
    })).resolves.toMatchObject({ status: 'processing', completedAt: null })
    await expect(persistence.loadTextAdventureReviewAttestation({
      listingId: listing.listingId, releaseHash: listing.releaseHash,
    })).resolves.toBeNull()
  }, 40_000)
})
