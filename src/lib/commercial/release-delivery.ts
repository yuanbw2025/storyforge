import {
  verifyGameDistributionBundleV2,
  type GameDistributionBundleV2,
} from '../game-platform/distribution-bundle'
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
  bundle: GameDistributionBundleV2
  registeredAt: number
}

export interface CommercialReleaseDeliveryPersistenceV1 {
  load(releaseHash: string): Promise<CommercialReleaseDeliveryRecordV1 | null>
  putIfAbsent(record: CommercialReleaseDeliveryRecordV1): Promise<'created' | 'identical' | 'conflict'>
}

export class InMemoryCommercialReleaseDeliveryPersistenceV1 implements CommercialReleaseDeliveryPersistenceV1 {
  private readonly rows = new Map<string, CommercialReleaseDeliveryRecordV1>()

  async load(releaseHash: string): Promise<CommercialReleaseDeliveryRecordV1 | null> {
    const row = this.rows.get(releaseHash)
    return row ? structuredClone(row) : null
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
    bundle: unknown
  }): Promise<{ releaseHash: string; bundleHash: string; duplicate: boolean }> {
    const creatorId = stablePrincipal(input.principal.userId)
    const bundle = await verifyGameDistributionBundleV2(input.bundle)
    const hash = releaseHash(bundle.gameRelease.contentHash)
    if (!this.authority.canRegisterRelease({ principal: input.principal, releaseHash: hash })) {
      throw new CommercialAuthorityErrorV1('release_forbidden', '只有目录所有者可以登记发行物')
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
    return { releaseHash: hash, bundleHash: bundle.bundleHash, duplicate: result === 'identical' }
  }

  async hasVerifiedRelease(input: { releaseHash: string; creatorId: string }): Promise<boolean> {
    const hash = releaseHash(input.releaseHash)
    const row = await this.persistence.load(hash)
    return row?.creatorId === stablePrincipal(input.creatorId)
  }

  async download(input: {
    principal: CommercialPrincipalV1
    releaseHash: string
  }): Promise<{
    authorization: CommercialOfflineDeliveryAuthorizationV1
    bundle: GameDistributionBundleV2
  }> {
    const authorization = this.authority.authorizeOfflineDelivery(input)
    const row = await this.persistence.load(authorization.releaseHash)
    if (!row) throw new CommercialAuthorityErrorV1('release_delivery_missing', '发行物尚未完成上传')
    const bundle = await verifyGameDistributionBundleV2(row.bundle)
    if (bundle.gameRelease.contentHash !== authorization.releaseHash || bundle.bundleHash !== row.bundleHash) {
      throw new CommercialAuthorityErrorV1('release_corrupt', '发行物存储完整性校验失败')
    }
    return { authorization, bundle }
  }
}
