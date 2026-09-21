import {
  verifyProductDistributionBundleV2,
  type ProductDistributionBundleV2,
} from '../product-platform/distribution-bundle'
import { hashCanonicalValue } from '../agent/run/hash'
import {
  verifyTextAdventureCommunitySubmissionV1,
  type TextAdventureCommunityCandidateDossierV1,
  type TextAdventureCommunitySubmissionV1,
} from '../adventure/community-package'
import type { ProductionProductKindV1 } from '../types'
import {
  CommercialAuthorityErrorV1,
  CommercialPlatformAuthorityV1,
  type CommercialOfflineDeliveryAuthorizationV1,
  type CommercialPrincipalV1,
} from './authority'

export interface CommercialReleaseDeliveryRecordV1 {
  schema: 'storyforge.commercial-release-delivery'
  version: 1
  releaseHash: string
  creatorId: string
  bundleHash: string
  encodedBytes: number
  bundle: ProductDistributionBundleV2
  registeredAt: number
}

export interface CommercialReleaseDeliveryHeadV1 {
  releaseHash: string
  creatorId: string
  bundleHash: string
  encodedBytes: number
  productType: ProductionProductKindV1
}

export interface CommercialTextAdventureReviewRecordV1 {
  schema: 'storyforge.commercial-text-adventure-review-record'
  version: 1
  status: 'pending-review'
  listingId: string
  releaseHash: string
  creatorId: string
  bundleHash: string
  candidateHash: string
  candidate: TextAdventureCommunitySubmissionV1
  evidenceSummary: TextAdventureCommunityCandidateDossierV1['evidence']
  verifiedAt: number
  recordHash: string
}

export interface CommercialTextAdventureReviewProjectionV1 {
  schema: 'storyforge.commercial-text-adventure-review-projection'
  version: 1
  status: 'pending-review'
  listingId: string
  releaseHash: string
  bundleHash: string
  candidateHash: string
  recordHash: string
  verifiedAt: number
  dossier: TextAdventureCommunityCandidateDossierV1
  evidenceSummary: TextAdventureCommunityCandidateDossierV1['evidence']
}

export interface CommercialTextAdventureReviewAttestationV1 {
  schema: 'storyforge.commercial-text-adventure-review-attestation'
  version: 1
  listingId: string
  releaseHash: string
  creatorId: string
  bundleHash: string
  candidateHash: string
  reviewRecordHash: string
  verifiedAt: number
  attestationHash: string
}

export interface CommercialReleaseRegistrationReceiptV1 {
  releaseHash: string
  bundleHash: string
  duplicate: boolean
  textAdventureReview?: Pick<CommercialTextAdventureReviewProjectionV1,
    'schema' | 'version' | 'status' | 'listingId' | 'candidateHash' | 'recordHash'>
}

export interface CommercialReleaseUploadRequestV1 {
  schema: 'storyforge.commercial-release-upload-request'
  version: 1
  creatorId: string
  requestId: string
  fingerprint: string
  status: 'processing' | 'completed'
  listingId: string | null
  releaseHash: string
  bundleHash: string
  candidateHash: string | null
  result: CommercialReleaseRegistrationReceiptV1
  createdAt: number
  completedAt: number | null
}

export interface CommercialReleaseDeliveryPersistenceV1 {
  load(releaseHash: string): Promise<CommercialReleaseDeliveryRecordV1 | null>
  /** Production adapters must bind signal to the external HEAD request. */
  head(releaseHash: string, options?: { signal?: AbortSignal }): Promise<CommercialReleaseDeliveryHeadV1 | null>
  putIfAbsent(record: CommercialReleaseDeliveryRecordV1): Promise<'created' | 'identical' | 'conflict'>
  loadUploadRequest(input: {
    creatorId: string
    requestId: string
  }): Promise<CommercialReleaseUploadRequestV1 | null>
  putUploadRequestIfAbsent(
    record: CommercialReleaseUploadRequestV1,
  ): Promise<'created' | 'identical' | 'conflict'>
  completeUploadRequest(input: {
    creatorId: string
    requestId: string
    fingerprint: string
    result: CommercialReleaseRegistrationReceiptV1
    completedAt: number
  }): Promise<'completed' | 'identical' | 'conflict' | 'missing'>
  loadTextAdventureReview(input: {
    listingId: string
    releaseHash: string
  }): Promise<CommercialTextAdventureReviewRecordV1 | null>
  putTextAdventureReviewIfAbsent(
    record: CommercialTextAdventureReviewRecordV1,
  ): Promise<'created' | 'identical' | 'conflict'>
  loadTextAdventureReviewAttestation(input: {
    listingId: string
    releaseHash: string
    /** Production adapters must bind signal to the external proof read. */
    signal?: AbortSignal
  }): Promise<CommercialTextAdventureReviewAttestationV1 | null>
  putTextAdventureReviewAttestationIfAbsent(
    record: CommercialTextAdventureReviewAttestationV1,
  ): Promise<'created' | 'identical' | 'conflict'>
}

export class InMemoryCommercialReleaseDeliveryPersistenceV1 implements CommercialReleaseDeliveryPersistenceV1 {
  private readonly rows = new Map<string, CommercialReleaseDeliveryRecordV1>()
  private readonly uploadRequests = new Map<string, CommercialReleaseUploadRequestV1>()
  private readonly textAdventureReviews = new Map<string, CommercialTextAdventureReviewRecordV1>()
  private readonly textAdventureReviewAttestations = new Map<string, CommercialTextAdventureReviewAttestationV1>()

  async load(releaseHash: string): Promise<CommercialReleaseDeliveryRecordV1 | null> {
    const row = this.rows.get(releaseHash)
    return row ? structuredClone(row) : null
  }

  async head(releaseHash: string, options?: { signal?: AbortSignal }): Promise<CommercialReleaseDeliveryHeadV1 | null> {
    if (options?.signal?.aborted) return null
    const row = this.rows.get(releaseHash)
    return row ? {
      releaseHash: row.releaseHash, creatorId: row.creatorId, bundleHash: row.bundleHash,
      encodedBytes: row.encodedBytes, productType: row.bundle.productRelease.manifest.productType,
    } : null
  }

  async putIfAbsent(record: CommercialReleaseDeliveryRecordV1): Promise<'created' | 'identical' | 'conflict'> {
    const existing = this.rows.get(record.releaseHash)
    if (existing) {
      return existing.creatorId === record.creatorId && existing.bundleHash === record.bundleHash
        ? 'identical'
        : 'conflict'
    }
    this.rows.set(record.releaseHash, structuredClone(record))
    return 'created'
  }

  async loadUploadRequest(input: {
    creatorId: string
    requestId: string
  }): Promise<CommercialReleaseUploadRequestV1 | null> {
    const row = this.uploadRequests.get(`${input.creatorId}\u0000${input.requestId}`)
    return row ? structuredClone(row) : null
  }

  async putUploadRequestIfAbsent(
    record: CommercialReleaseUploadRequestV1,
  ): Promise<'created' | 'identical' | 'conflict'> {
    const key = `${record.creatorId}\u0000${record.requestId}`
    const existing = this.uploadRequests.get(key)
    if (existing) return existing.fingerprint === record.fingerprint ? 'identical' : 'conflict'
    this.uploadRequests.set(key, structuredClone(record))
    return 'created'
  }

  async completeUploadRequest(input: {
    creatorId: string
    requestId: string
    fingerprint: string
    result: CommercialReleaseRegistrationReceiptV1
    completedAt: number
  }): Promise<'completed' | 'identical' | 'conflict' | 'missing'> {
    const key = `${input.creatorId}\u0000${input.requestId}`
    const existing = this.uploadRequests.get(key)
    if (!existing) return 'missing'
    if (existing.fingerprint !== input.fingerprint) return 'conflict'
    if (existing.status === 'completed') {
      return await hashCanonicalValue(existing.result) === await hashCanonicalValue(input.result)
        ? 'identical'
        : 'conflict'
    }
    this.uploadRequests.set(key, {
      ...existing, status: 'completed', result: structuredClone(input.result),
      completedAt: Math.max(input.completedAt, existing.createdAt),
    })
    return 'completed'
  }

  async loadTextAdventureReview(input: {
    listingId: string
    releaseHash: string
  }): Promise<CommercialTextAdventureReviewRecordV1 | null> {
    const row = this.textAdventureReviews.get(`${input.listingId}\u0000${input.releaseHash}`)
    return row ? structuredClone(row) : null
  }

  async putTextAdventureReviewIfAbsent(
    record: CommercialTextAdventureReviewRecordV1,
  ): Promise<'created' | 'identical' | 'conflict'> {
    const key = `${record.listingId}\u0000${record.releaseHash}`
    const existing = this.textAdventureReviews.get(key)
    if (existing) {
      return existing.creatorId === record.creatorId
        && existing.releaseHash === record.releaseHash
        && existing.bundleHash === record.bundleHash
        && existing.candidateHash === record.candidateHash
        ? 'identical'
        : 'conflict'
    }
    this.textAdventureReviews.set(key, structuredClone(record))
    return 'created'
  }

  async loadTextAdventureReviewAttestation(input: {
    listingId: string
    releaseHash: string
    signal?: AbortSignal
  }): Promise<CommercialTextAdventureReviewAttestationV1 | null> {
    if (input.signal?.aborted) return null
    const row = this.textAdventureReviewAttestations.get(`${input.listingId}\u0000${input.releaseHash}`)
    return row ? structuredClone(row) : null
  }

  async putTextAdventureReviewAttestationIfAbsent(
    record: CommercialTextAdventureReviewAttestationV1,
  ): Promise<'created' | 'identical' | 'conflict'> {
    const key = `${record.listingId}\u0000${record.releaseHash}`
    const existing = this.textAdventureReviewAttestations.get(key)
    if (existing) return existing.attestationHash === record.attestationHash ? 'identical' : 'conflict'
    this.textAdventureReviewAttestations.set(key, structuredClone(record))
    return 'created'
  }
}

function stablePrincipal(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new CommercialAuthorityErrorV1('protocol', 'principal.userId 无效')
  }
  return value
}

function releaseHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new CommercialAuthorityErrorV1('protocol', 'releaseHash 必须是 sha256')
  }
  return value
}

function stableListingId(value: unknown): string {
  if (typeof value !== 'string' || !/^listing\.[A-Za-z0-9._:-]+$/.test(value) || value.length > 200) {
    throw new CommercialAuthorityErrorV1('protocol', 'listingId 无效')
  }
  return value
}

function stableRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || value.length > 200) {
    throw new CommercialAuthorityErrorV1('protocol', 'requestId 无效')
  }
  return value
}

function exactRecord(value: unknown, expected: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== expected.length
    || Object.keys(value).some(key => !expected.includes(key))) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险审核记录结构无效')
  }
  return value as Record<string, unknown>
}

function verifyUploadRequestRecord(input: {
  value: CommercialReleaseUploadRequestV1 | null
  creatorId: string
  requestId: string
  fingerprint: string
}): CommercialReleaseUploadRequestV1 {
  if (!input.value) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求持久化后不可读取')
  }
  const raw = exactRecord(input.value, [
    'schema', 'version', 'creatorId', 'requestId', 'fingerprint', 'status', 'listingId',
    'releaseHash', 'bundleHash', 'candidateHash', 'result', 'createdAt', 'completedAt',
  ])
  if (raw.creatorId !== input.creatorId || raw.requestId !== input.requestId) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求作用域不一致')
  }
  if (raw.fingerprint !== input.fingerprint) {
    throw new CommercialAuthorityErrorV1('request_conflict', 'requestId 已被不同发行上传使用')
  }
  if (raw.schema !== 'storyforge.commercial-release-upload-request' || raw.version !== 1
    || !['processing', 'completed'].includes(String(raw.status))
    || !Number.isInteger(raw.createdAt) || Number(raw.createdAt) < 0
    || (raw.status === 'processing' && raw.completedAt !== null)
    || (raw.status === 'completed' && (!Number.isInteger(raw.completedAt) || Number(raw.completedAt) < Number(raw.createdAt)))) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求状态无效')
  }
  const listingId = raw.listingId == null ? null : stableListingId(raw.listingId)
  const candidateHash = raw.candidateHash == null ? null : releaseHash(raw.candidateHash)
  if ((listingId == null) !== (candidateHash == null)) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求候选绑定不完整')
  }
  const result = exactRecord(raw.result, listingId
    ? ['releaseHash', 'bundleHash', 'duplicate', 'textAdventureReview']
    : ['releaseHash', 'bundleHash', 'duplicate'])
  const storedReleaseHash = releaseHash(raw.releaseHash)
  const bundleHash = releaseHash(raw.bundleHash)
  if (result.releaseHash !== storedReleaseHash || result.bundleHash !== bundleHash
    || typeof result.duplicate !== 'boolean') {
    throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求回执绑定无效')
  }
  let textAdventureReview: CommercialReleaseRegistrationReceiptV1['textAdventureReview']
  if (listingId && candidateHash) {
    const review = exactRecord(result.textAdventureReview, [
      'schema', 'version', 'status', 'listingId', 'candidateHash', 'recordHash',
    ])
    if (review.schema !== 'storyforge.commercial-text-adventure-review-projection'
      || review.version !== 1 || review.status !== 'pending-review'
      || review.listingId !== listingId || review.candidateHash !== candidateHash) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求候选回执绑定无效')
    }
    textAdventureReview = {
      schema: review.schema, version: 1, status: review.status,
      listingId, candidateHash, recordHash: releaseHash(review.recordHash),
    }
  }
  return {
    schema: 'storyforge.commercial-release-upload-request', version: 1,
    creatorId: input.creatorId, requestId: input.requestId,
    fingerprint: releaseHash(raw.fingerprint), status: raw.status as 'processing' | 'completed',
    listingId, releaseHash: storedReleaseHash, bundleHash, candidateHash,
    result: {
      releaseHash: storedReleaseHash, bundleHash, duplicate: result.duplicate,
      ...(textAdventureReview ? { textAdventureReview } : {}),
    },
    createdAt: Number(raw.createdAt), completedAt: raw.completedAt == null ? null : Number(raw.completedAt),
  }
}

function reviewProjection(record: CommercialTextAdventureReviewRecordV1): CommercialTextAdventureReviewProjectionV1 {
  return {
    schema: 'storyforge.commercial-text-adventure-review-projection',
    version: 1,
    status: 'pending-review',
    listingId: record.listingId,
    releaseHash: record.releaseHash,
    bundleHash: record.bundleHash,
    candidateHash: record.candidateHash,
    recordHash: record.recordHash,
    verifiedAt: record.verifiedAt,
    dossier: structuredClone(record.candidate.dossier),
    evidenceSummary: structuredClone(record.evidenceSummary),
  }
}

async function verifyTextAdventureReviewRecord(input: {
  value: unknown
  bundle: ProductDistributionBundleV2
}): Promise<CommercialTextAdventureReviewRecordV1> {
  const raw = exactRecord(input.value, [
    'schema', 'version', 'status', 'listingId', 'releaseHash', 'creatorId', 'bundleHash',
    'candidateHash', 'candidate', 'evidenceSummary', 'verifiedAt', 'recordHash',
  ])
  if (raw.schema !== 'storyforge.commercial-text-adventure-review-record'
    || raw.version !== 1 || raw.status !== 'pending-review'
    || typeof raw.verifiedAt !== 'number' || !Number.isInteger(raw.verifiedAt) || raw.verifiedAt < 0) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险审核记录版本或状态无效')
  }
  const listingId = stableListingId(raw.listingId)
  const creatorId = stablePrincipal(raw.creatorId)
  const storedReleaseHash = releaseHash(raw.releaseHash)
  const bundleHash = releaseHash(raw.bundleHash)
  const candidateHash = releaseHash(raw.candidateHash)
  const recordHash = releaseHash(raw.recordHash)
  const { recordHash: _recordHash, ...body } = raw
  if (await hashCanonicalValue(body) !== recordHash) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险审核记录 hash 不匹配')
  }
  let verified: Awaited<ReturnType<typeof verifyTextAdventureCommunitySubmissionV1>>
  try {
    verified = await verifyTextAdventureCommunitySubmissionV1({
      submission: raw.candidate,
      distributionBundle: input.bundle,
    })
  } catch {
    throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险候选证据无法重新验证')
  }
  if (storedReleaseHash !== input.bundle.productRelease.contentHash
    || bundleHash !== input.bundle.bundleHash
    || candidateHash !== verified.submission.candidateHash
    || await hashCanonicalValue(raw.evidenceSummary) !== await hashCanonicalValue(verified.submission.dossier.evidence)) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险审核记录与发行物或证据摘要不匹配')
  }
  return {
    schema: 'storyforge.commercial-text-adventure-review-record', version: 1,
    status: 'pending-review', listingId, releaseHash: storedReleaseHash, creatorId,
    bundleHash, candidateHash, candidate: verified.submission,
    evidenceSummary: structuredClone(verified.submission.dossier.evidence),
    verifiedAt: raw.verifiedAt, recordHash,
  }
}

async function verifyTextAdventureReviewAttestation(
  value: unknown,
): Promise<CommercialTextAdventureReviewAttestationV1> {
  const raw = exactRecord(value, [
    'schema', 'version', 'listingId', 'releaseHash', 'creatorId', 'bundleHash',
    'candidateHash', 'reviewRecordHash', 'verifiedAt', 'attestationHash',
  ])
  if (raw.schema !== 'storyforge.commercial-text-adventure-review-attestation'
    || raw.version !== 1 || !Number.isInteger(raw.verifiedAt) || Number(raw.verifiedAt) < 0) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险候选证明结构无效')
  }
  const { attestationHash: rawAttestationHash, ...body } = raw
  const attestationHash = releaseHash(rawAttestationHash)
  if (await hashCanonicalValue(body) !== attestationHash) {
    throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险候选证明 hash 不匹配')
  }
  return {
    schema: 'storyforge.commercial-text-adventure-review-attestation', version: 1,
    listingId: stableListingId(raw.listingId), releaseHash: releaseHash(raw.releaseHash),
    creatorId: stablePrincipal(raw.creatorId), bundleHash: releaseHash(raw.bundleHash),
    candidateHash: releaseHash(raw.candidateHash), reviewRecordHash: releaseHash(raw.reviewRecordHash),
    verifiedAt: Number(raw.verifiedAt), attestationHash,
  }
}

/**
 * Large immutable release delivery boundary. A deployment can back this with
 * object storage; the authority snapshot deliberately contains only commerce
 * state and never embeds multi-megabyte game bytes.
 */
export class CommercialReleaseDeliveryServiceV1 {
  constructor(
    private readonly authority: CommercialPlatformAuthorityV1,
    private readonly persistence: CommercialReleaseDeliveryPersistenceV1,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async registerCreatorBundle(input: {
    principal: CommercialPrincipalV1
    requestId: string
    listingId?: string
    bundle: unknown
    textAdventureCandidate?: unknown
  }): Promise<CommercialReleaseRegistrationReceiptV1> {
    const creatorId = stablePrincipal(input.principal.userId)
    const requestId = stableRequestId(input.requestId)
    const bundle = await verifyProductDistributionBundleV2(input.bundle)
    const hash = releaseHash(bundle.productRelease.contentHash)
    if (!this.authority.canRegisterRelease({ principal: input.principal, releaseHash: hash })) {
      throw new CommercialAuthorityErrorV1('release_forbidden', '只有目录所有者可以登记发行物')
    }
    const productType = bundle.productRelease.manifest.productType
    let listingId: string | null = null
    let candidate: Awaited<ReturnType<typeof verifyTextAdventureCommunitySubmissionV1>> | null = null
    if (productType === 'text-adventure') {
      if (input.listingId == null || input.textAdventureCandidate == null) {
        throw new CommercialAuthorityErrorV1('candidate_required', '文字冒险发行物必须携带完整社区候选证据')
      }
      listingId = stableListingId(input.listingId)
      const listing = this.authority.listingForCreator({ principal: input.principal, listingId })
      if (listing.productType !== 'text-adventure' || listing.releaseHash !== hash) {
        throw new CommercialAuthorityErrorV1('release_forbidden', '候选证据与目录项产品或 Release 作用域不一致')
      }
      try {
        candidate = await verifyTextAdventureCommunitySubmissionV1({
          submission: input.textAdventureCandidate,
          distributionBundle: bundle,
        })
      } catch {
        throw new CommercialAuthorityErrorV1('candidate_invalid', '文字冒险社区候选证据验证失败')
      }
    } else if (input.listingId != null || input.textAdventureCandidate != null) {
      throw new CommercialAuthorityErrorV1('protocol', '非文字冒险发行物不得携带文字冒险候选证据')
    }
    const candidateHash = candidate?.submission.candidateHash ?? null
    const fingerprint = await hashCanonicalValue({
      creatorId, requestId, listingId, releaseHash: hash,
      bundleHash: bundle.bundleHash, candidateHash, productType,
    })
    let uploadRequest = await this.persistence.loadUploadRequest({ creatorId, requestId })
    if (uploadRequest) {
      uploadRequest = verifyUploadRequestRecord({
        value: uploadRequest, creatorId, requestId, fingerprint,
      })
    } else {
      const existingDelivery = await this.persistence.head(hash)
      const existingReview = listingId
        ? await this.persistence.loadTextAdventureReview({ listingId, releaseHash: hash })
        : null
      const createdAt = this.now()
      let textAdventureReview: CommercialReleaseRegistrationReceiptV1['textAdventureReview']
      if (candidate && listingId) {
        const verifiedAt = existingReview?.verifiedAt ?? createdAt
        const reviewBody: Omit<CommercialTextAdventureReviewRecordV1, 'recordHash'> = {
          schema: 'storyforge.commercial-text-adventure-review-record', version: 1,
          status: 'pending-review', listingId, releaseHash: hash, creatorId,
          bundleHash: bundle.bundleHash, candidateHash: candidate.submission.candidateHash,
          candidate: candidate.submission,
          evidenceSummary: structuredClone(candidate.submission.dossier.evidence),
          verifiedAt,
        }
        textAdventureReview = {
          schema: 'storyforge.commercial-text-adventure-review-projection', version: 1,
          status: 'pending-review', listingId, candidateHash: candidate.submission.candidateHash,
          recordHash: existingReview?.recordHash ?? await hashCanonicalValue(reviewBody),
        }
      }
      const plannedResult: CommercialReleaseRegistrationReceiptV1 = {
        releaseHash: hash, bundleHash: bundle.bundleHash,
        duplicate: existingDelivery?.creatorId === creatorId
          && existingDelivery.bundleHash === bundle.bundleHash
          && (!listingId || existingReview?.candidateHash === candidateHash),
        ...(textAdventureReview ? { textAdventureReview } : {}),
      }
      const pending: CommercialReleaseUploadRequestV1 = {
        schema: 'storyforge.commercial-release-upload-request', version: 1,
        creatorId, requestId, fingerprint, status: 'processing', listingId,
        releaseHash: hash, bundleHash: bundle.bundleHash, candidateHash,
        result: plannedResult, createdAt, completedAt: null,
      }
      const claimed = await this.persistence.putUploadRequestIfAbsent(pending)
      if (claimed === 'conflict') {
        throw new CommercialAuthorityErrorV1('request_conflict', 'requestId 已被不同发行上传使用')
      }
      uploadRequest = verifyUploadRequestRecord({
        value: await this.persistence.loadUploadRequest({ creatorId, requestId }),
        creatorId, requestId, fingerprint,
      })
    }
    const encodedBytes = new TextEncoder().encode(JSON.stringify(bundle)).byteLength
    const result = await this.persistence.putIfAbsent({
      schema: 'storyforge.commercial-release-delivery', version: 1,
      releaseHash: hash, creatorId, bundleHash: bundle.bundleHash, encodedBytes,
      bundle, registeredAt: this.now(),
    })
    if (result === 'conflict') {
      throw new CommercialAuthorityErrorV1('release_conflict', '相同 Release 哈希已绑定不同发行物或创作者')
    }
    const persistedDelivery = await this.persistence.load(hash)
    if (!persistedDelivery || persistedDelivery.creatorId !== creatorId
      || persistedDelivery.bundleHash !== bundle.bundleHash
      || persistedDelivery.encodedBytes !== encodedBytes) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行物持久化回读与上传回执不一致')
    }
    let persistedBundle: ProductDistributionBundleV2
    try {
      persistedBundle = await verifyProductDistributionBundleV2(persistedDelivery.bundle)
    } catch {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行物持久化回读校验失败')
    }
    if (persistedBundle.productRelease.contentHash !== hash || persistedBundle.bundleHash !== bundle.bundleHash) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行物持久化回读绑定不一致')
    }
    if (!candidate || !listingId) {
      const completion = await this.persistence.completeUploadRequest({
        creatorId, requestId, fingerprint, result: uploadRequest.result,
        completedAt: Math.max(this.now(), uploadRequest.createdAt),
      })
      if (!['completed', 'identical'].includes(completion)) {
        throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求无法提交完成状态')
      }
      const completed = verifyUploadRequestRecord({
        value: await this.persistence.loadUploadRequest({ creatorId, requestId }),
        creatorId, requestId, fingerprint,
      })
      if (completed.status !== 'completed') {
        throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求完成状态回读失败')
      }
      return structuredClone(completed.result)
    }
    const existingReview = await this.persistence.loadTextAdventureReview({ listingId, releaseHash: hash })
    const verifiedAt = existingReview?.verifiedAt ?? uploadRequest.createdAt
    const reviewBody: Omit<CommercialTextAdventureReviewRecordV1, 'recordHash'> = {
      schema: 'storyforge.commercial-text-adventure-review-record', version: 1,
      status: 'pending-review', listingId, releaseHash: hash, creatorId,
      bundleHash: bundle.bundleHash, candidateHash: candidate.submission.candidateHash,
      candidate: candidate.submission,
      evidenceSummary: structuredClone(candidate.submission.dossier.evidence),
      verifiedAt,
    }
    const reviewRecord: CommercialTextAdventureReviewRecordV1 = {
      ...reviewBody, recordHash: await hashCanonicalValue(reviewBody),
    }
    // A strict object-store CAS may report conflict when another request won
    // with the same semantic candidate but a different provisional verifiedAt.
    // The persisted, fully verified owner is canonical; do not poison either
    // durable request merely because their proposed records were byte-different.
    const reviewWriteResult = await this.persistence.putTextAdventureReviewIfAbsent(reviewRecord)
    const persistedReview = await this.persistence.loadTextAdventureReview({ listingId, releaseHash: hash })
    if (!persistedReview) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险候选证据持久化后不可读取')
    }
    if (reviewWriteResult === 'conflict'
      && persistedReview.candidateHash !== candidate.submission.candidateHash) {
      throw new CommercialAuthorityErrorV1('candidate_conflict', '目录项已绑定不同文字冒险候选证据')
    }
    const verifiedReview = await verifyTextAdventureReviewRecord({ value: persistedReview, bundle: persistedBundle })
    if (verifiedReview.listingId !== listingId || verifiedReview.releaseHash !== hash
      || verifiedReview.creatorId !== creatorId || verifiedReview.bundleHash !== bundle.bundleHash
      || verifiedReview.candidateHash !== candidate.submission.candidateHash) {
      throw new CommercialAuthorityErrorV1('candidate_conflict', '目录项已绑定不同文字冒险候选证据')
    }
    const attestationBody: Omit<CommercialTextAdventureReviewAttestationV1, 'attestationHash'> = {
      schema: 'storyforge.commercial-text-adventure-review-attestation', version: 1,
      listingId: verifiedReview.listingId, releaseHash: verifiedReview.releaseHash,
      creatorId: verifiedReview.creatorId, bundleHash: verifiedReview.bundleHash,
      candidateHash: verifiedReview.candidateHash, reviewRecordHash: verifiedReview.recordHash,
      verifiedAt: verifiedReview.verifiedAt,
    }
    const attestation: CommercialTextAdventureReviewAttestationV1 = {
      ...attestationBody, attestationHash: await hashCanonicalValue(attestationBody),
    }
    const attestationResult = await this.persistence.putTextAdventureReviewAttestationIfAbsent(attestation)
    const persistedAttestation = await this.persistence.loadTextAdventureReviewAttestation({
      listingId, releaseHash: hash,
    })
    if (!persistedAttestation) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险候选证明持久化后不可读取')
    }
    const verifiedAttestation = await verifyTextAdventureReviewAttestation(persistedAttestation)
    if (verifiedAttestation.reviewRecordHash !== verifiedReview.recordHash
      || verifiedAttestation.candidateHash !== verifiedReview.candidateHash
      || verifiedAttestation.bundleHash !== bundle.bundleHash) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险候选证明与审核记录不一致')
    }
    if (attestationResult === 'conflict'
      && verifiedAttestation.attestationHash !== attestation.attestationHash) {
      throw new CommercialAuthorityErrorV1('candidate_conflict', '目录项已绑定不同文字冒险候选证明')
    }
    const projection = reviewProjection(verifiedReview)
    const completedResult: CommercialReleaseRegistrationReceiptV1 = {
      releaseHash: hash,
      bundleHash: bundle.bundleHash,
      duplicate: uploadRequest.result.duplicate,
      textAdventureReview: {
        schema: projection.schema,
        version: projection.version,
        status: projection.status,
        listingId: projection.listingId,
        candidateHash: projection.candidateHash,
        recordHash: projection.recordHash,
      },
    }
    const completion = await this.persistence.completeUploadRequest({
      creatorId, requestId, fingerprint, result: completedResult,
      completedAt: Math.max(this.now(), uploadRequest.createdAt),
    })
    if (!['completed', 'identical'].includes(completion)) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求无法提交完成状态')
    }
    const completed = verifyUploadRequestRecord({
      value: await this.persistence.loadUploadRequest({ creatorId, requestId }),
      creatorId, requestId, fingerprint,
    })
    if (completed.status !== 'completed') {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行上传请求完成状态回读失败')
    }
    return structuredClone(completed.result)
  }

  async hasVerifiedRelease(input: {
    releaseHash: string
    creatorId: string
    listingId?: string
    productType?: ProductionProductKindV1
    verification?: 'full' | 'attestation'
    signal?: AbortSignal
  }): Promise<boolean> {
    if (input.signal?.aborted) return false
    const hash = releaseHash(input.releaseHash)
    if (input.verification === 'attestation') {
      if (!input.productType) return false
      const head = await this.persistence.head(hash, { signal: input.signal })
      if (input.signal?.aborted) return false
      if (!head || head.releaseHash !== hash || head.creatorId !== stablePrincipal(input.creatorId)
        || head.productType !== input.productType || !releaseHash(head.bundleHash)
        || !Number.isInteger(head.encodedBytes) || head.encodedBytes < 1) return false
      if (input.productType !== 'text-adventure') return true
      if (!input.listingId) return false
      const listingId = stableListingId(input.listingId)
      const attestation = await this.persistence.loadTextAdventureReviewAttestation({
        listingId, releaseHash: hash, signal: input.signal,
      })
      if (input.signal?.aborted) return false
      if (!attestation) return false
      const verified = await verifyTextAdventureReviewAttestation(attestation)
      if (input.signal?.aborted) return false
      return verified.listingId === listingId
        && verified.releaseHash === hash
        && verified.creatorId === stablePrincipal(input.creatorId)
        && verified.bundleHash === head.bundleHash
    }
    const row = await this.persistence.load(hash)
    if (!row || row.creatorId !== stablePrincipal(input.creatorId)) return false
    let bundle: ProductDistributionBundleV2
    try {
      bundle = await verifyProductDistributionBundleV2(row.bundle)
    } catch {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行物存储完整性校验失败')
    }
    if (bundle.productRelease.contentHash !== hash || bundle.bundleHash !== row.bundleHash) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行物存储绑定不一致')
    }
    if (input.productType && bundle.productRelease.manifest.productType !== input.productType) {
      throw new CommercialAuthorityErrorV1('release_forbidden', '目录项产品类型与冻结发行物不一致')
    }
    if (input.productType !== 'text-adventure') return true
    if (!input.listingId || bundle.productRelease.manifest.productType !== 'text-adventure') return false
    const listingId = stableListingId(input.listingId)
    const review = await this.persistence.loadTextAdventureReview({ listingId, releaseHash: hash })
    if (!review) return false
    const verified = await verifyTextAdventureReviewRecord({ value: review, bundle })
    return verified.listingId === listingId
      && verified.releaseHash === hash
      && verified.creatorId === input.creatorId
  }

  async reviewTextAdventureCandidate(input: {
    principal: CommercialPrincipalV1
    listingId: string
  }): Promise<CommercialTextAdventureReviewProjectionV1> {
    const listingId = stableListingId(input.listingId)
    const listing = this.authority.listingForReview({ principal: input.principal, listingId })
    if (listing.status !== 'submitted') {
      throw new CommercialAuthorityErrorV1('invalid_transition', '只有审核中的文字冒险目录项可以读取候选证据')
    }
    if (listing.productType !== 'text-adventure') {
      throw new CommercialAuthorityErrorV1('candidate_not_applicable', '该目录项不是文字冒险产品')
    }
    const delivery = await this.persistence.load(listing.releaseHash)
    const review = await this.persistence.loadTextAdventureReview({
      listingId, releaseHash: listing.releaseHash,
    })
    if (!delivery || !review || delivery.creatorId !== listing.creatorId) {
      throw new CommercialAuthorityErrorV1('candidate_missing', '文字冒险目录项缺少服务端候选审核记录')
    }
    let bundle: ProductDistributionBundleV2
    try {
      bundle = await verifyProductDistributionBundleV2(delivery.bundle)
    } catch {
      throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险发行物存储完整性校验失败')
    }
    const verified = await verifyTextAdventureReviewRecord({ value: review, bundle })
    if (verified.listingId !== listing.listingId || verified.releaseHash !== listing.releaseHash
      || verified.creatorId !== listing.creatorId || verified.bundleHash !== delivery.bundleHash) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险审核记录越过目录项作用域')
    }
    return reviewProjection(verified)
  }

  async download(input: {
    principal: CommercialPrincipalV1
    releaseHash: string
  }): Promise<{
    authorization: CommercialOfflineDeliveryAuthorizationV1
    bundle: ProductDistributionBundleV2
  }> {
    const authorization = this.authority.authorizeOfflineDelivery(input)
    const row = await this.persistence.load(authorization.releaseHash)
    if (!row) throw new CommercialAuthorityErrorV1('release_delivery_missing', '发行物尚未完成上传')
    const bundle = await verifyProductDistributionBundleV2(row.bundle)
    if (bundle.productRelease.contentHash !== authorization.releaseHash || bundle.bundleHash !== row.bundleHash) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行物存储完整性校验失败')
    }
    if (bundle.productRelease.manifest.productType === 'text-adventure') {
      const review = await this.persistence.loadTextAdventureReview({
        listingId: authorization.listingId,
        releaseHash: authorization.releaseHash,
      })
      if (!review) {
        throw new CommercialAuthorityErrorV1('candidate_missing', '文字冒险发行物缺少服务端候选审核记录')
      }
      const verifiedReview = await verifyTextAdventureReviewRecord({ value: review, bundle })
      if (verifiedReview.listingId !== authorization.listingId
        || verifiedReview.releaseHash !== authorization.releaseHash
        || verifiedReview.creatorId !== row.creatorId) {
        throw new CommercialAuthorityErrorV1('release_corrupt', '文字冒险候选记录与下载授权不一致')
      }
    }
    return { authorization, bundle }
  }
}
