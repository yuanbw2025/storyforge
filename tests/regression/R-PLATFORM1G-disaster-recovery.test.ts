import { describe, expect, it } from 'vitest'
import {
  CommercialPlatformAuthorityV1,
  verifyCommercialPlatformSnapshotV1,
  type CommercialPlatformSnapshotV1,
  type CommercialPrincipalV1,
} from '../../src/lib/commercial/authority'
import { TransactionalPlatformSnapshotPersistenceV1 } from '../../src/lib/product-platform/transactional-snapshot-persistence'
import type {
  TransactionalKeyValueStorageV1,
  TransactionalKeyValueTransactionV1,
} from '../../src/lib/online/transactional-persistence'

class AtomicMemoryStorage implements TransactionalKeyValueStorageV1 {
  readonly values = new Map<string, unknown>()
  failNextBackupWrite = false

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key)
    return value == null ? undefined : structuredClone(value) as T
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value))
  }

  async transaction<T>(operation: (transaction: TransactionalKeyValueTransactionV1) => Promise<T>): Promise<T> {
    const staged = new Map(this.values)
    const transaction: TransactionalKeyValueTransactionV1 = {
      get: async <V>(key: string) => {
        const value = staged.get(key)
        return value == null ? undefined : structuredClone(value) as V
      },
      put: async <V>(key: string, value: V) => {
        if (this.failNextBackupWrite && key.includes('/backup/')) {
          this.failNextBackupWrite = false
          throw new Error('injected backup failure')
        }
        staged.set(key, structuredClone(value))
      },
    }
    const result = await operation(transaction)
    this.values.clear(); for (const [key, value] of staged) this.values.set(key, value)
    return result
  }
}

const creator: CommercialPrincipalV1 = { userId: 'user.creator', permissions: [] }

function persistence(storage: AtomicMemoryStorage, namespace: string) {
  return new TransactionalPlatformSnapshotPersistenceV1<CommercialPlatformSnapshotV1>(storage, {
    namespace, backupSlots: 4,
  })
}

describe('PLATFORM-1G · transactional platform backup and isolated restore', () => {
  it('商业权威的主快照与滚动备份原子提交，并可经领域校验恢复到全新存储', async () => {
    const sourceStorage = new AtomicMemoryStorage()
    const source = persistence(sourceStorage, 'storyforge.commercial.source')
    const authority = await CommercialPlatformAuthorityV1.create({ persistence: source, now: () => 1000 })
    const listing = await authority.createListing({
      principal: creator, requestId: 'listing.recovery.1', releaseHash: 'a'.repeat(64), productType: 'ttrpg',
      title: '雾港灾备战役', summary: '用于隔离恢复演练。', contentWarnings: [],
      license: {
        licenseId: 'license.recovery', licenseVersion: '1.0.0', allowOfflineExport: true,
        allowRemix: false, commercialReuse: false, requiresAttribution: false,
        termsUrl: 'https://storyforge.test/licenses/recovery',
      },
      currency: 'CNY', amountMinor: 0, creatorShareBps: 8000,
    })
    const current = await source.load()
    expect(current?.revision).toBe(2)
    expect(await source.loadBackup(1)).toMatchObject({ revision: 1, listings: [] })
    expect(await source.loadBackup(2)).toMatchObject({ revision: 2, listings: [{ listingId: listing.listingId }] })

    const targetStorage = new AtomicMemoryStorage()
    const target = persistence(targetStorage, 'storyforge.commercial.recovered')
    await target.restoreToEmpty({ snapshot: current!, verify: verifyCommercialPlatformSnapshotV1 })
    const restored = await CommercialPlatformAuthorityV1.restore({ persistence: target, now: () => 2000 })
    expect(restored.listingsForCreator({ principal: creator })).toMatchObject([{
      listingId: listing.listingId, title: '雾港灾备战役', status: 'draft',
    }])
    await expect(target.restoreToEmpty({ snapshot: current!, verify: verifyCommercialPlatformSnapshotV1 }))
      .rejects.toThrow(/不是空存储/)
  })

  it('备份写失败回滚 primary；重算前的篡改快照在恢复写入前被领域完整性门拒绝', async () => {
    const sourceStorage = new AtomicMemoryStorage()
    const source = persistence(sourceStorage, 'storyforge.commercial.rollback')
    await CommercialPlatformAuthorityV1.create({ persistence: source })
    const before = await source.load()
    sourceStorage.failNextBackupWrite = true
    const next = structuredClone(before!)
    next.revision += 1
    await expect(source.compareAndSwap({ expectedRevision: before!.revision, snapshot: next }))
      .rejects.toThrow('injected backup failure')
    expect(await source.load()).toEqual(before)

    const tampered = structuredClone(before!)
    tampered.audits.push({ sequence: 999, kind: 'forged', actorId: 'attacker', subjectId: 'ledger', createdAt: 1 })
    const target = persistence(new AtomicMemoryStorage(), 'storyforge.commercial.reject-corrupt')
    await expect(target.restoreToEmpty({ snapshot: tampered, verify: verifyCommercialPlatformSnapshotV1 }))
      .rejects.toThrow(/完整性/)
    expect(await target.load()).toBeNull()
  })
})
