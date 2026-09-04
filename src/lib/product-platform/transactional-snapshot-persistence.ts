import type {
  TransactionalKeyValueStorageV1,
  TransactionalKeyValueTransactionV1,
} from '../online/transactional-persistence'

export interface RevisionedPlatformSnapshotV1 {
  revision: number
}

function safeNamespace(value: string): string {
  const parsed = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(parsed)) {
    throw new Error('[platform-snapshot-persistence:configuration] namespace 无效')
  }
  return parsed
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/**
 * Serializable persistence shared by commercial/community/operations
 * authorities. Every successful CAS writes the primary and a rolling recovery
 * slot in one storage transaction.
 */
export class TransactionalPlatformSnapshotPersistenceV1<T extends RevisionedPlatformSnapshotV1> {
  private readonly namespace: string
  private readonly backupSlots: number
  private readonly maximumSnapshotBytes: number

  constructor(private readonly storage: TransactionalKeyValueStorageV1, input: {
    namespace: string
    backupSlots?: number
    maximumSnapshotBytes?: number
  }) {
    this.namespace = safeNamespace(input.namespace)
    this.backupSlots = input.backupSlots ?? 32
    this.maximumSnapshotBytes = input.maximumSnapshotBytes ?? 32_000_000
    if (!Number.isInteger(this.backupSlots) || this.backupSlots < 2 || this.backupSlots > 1_024) {
      throw new Error('[platform-snapshot-persistence:configuration] backupSlots 无效')
    }
    if (!Number.isInteger(this.maximumSnapshotBytes) || this.maximumSnapshotBytes < 64_000
      || this.maximumSnapshotBytes > 256_000_000) {
      throw new Error('[platform-snapshot-persistence:configuration] maximumSnapshotBytes 无效')
    }
  }

  async load(): Promise<T | null> {
    const value = await this.storage.get<T>(this.primaryKey())
    return value ? structuredClone(value) : null
  }

  async compareAndSwap(input: { expectedRevision: number | null; snapshot: T }): Promise<boolean> {
    this.validateSnapshot(input.snapshot)
    const expectedNext = input.expectedRevision == null ? 1 : input.expectedRevision + 1
    if (input.snapshot.revision !== expectedNext) {
      throw new Error('[platform-snapshot-persistence:revision_invalid] snapshot revision 不是预期下一版本')
    }
    return this.writeIfRevision({ expectedRevision: input.expectedRevision, snapshot: input.snapshot })
  }

  async loadBackup(revision: number): Promise<T | null> {
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error('[platform-snapshot-persistence:protocol] backup revision 无效')
    }
    const value = await this.storage.get<T>(this.backupKey(revision))
    return value?.revision === revision ? structuredClone(value) : null
  }

  /**
   * Disaster recovery writes only to an empty isolated target. The caller must
   * run the domain's exact integrity/semantic verifier before any write.
   */
  async restoreToEmpty(input: {
    snapshot: T
    verify: (snapshot: T) => void | Promise<void>
  }): Promise<void> {
    this.validateSnapshot(input.snapshot)
    await input.verify(structuredClone(input.snapshot))
    const restored = await this.writeIfRevision({ expectedRevision: null, snapshot: input.snapshot, allowHistoricalRevision: true })
    if (!restored) throw new Error('[platform-snapshot-persistence:restore_target_not_empty] 恢复目标不是空存储')
  }

  private async writeIfRevision(input: {
    expectedRevision: number | null
    snapshot: T
    allowHistoricalRevision?: boolean
  }): Promise<boolean> {
    const primaryKey = this.primaryKey()
    return this.storage.transaction(async (transaction: TransactionalKeyValueTransactionV1) => {
      const current = await transaction.get<T>(primaryKey)
      if ((current?.revision ?? null) !== input.expectedRevision) return false
      if (!input.allowHistoricalRevision) {
        const expectedNext = input.expectedRevision == null ? 1 : input.expectedRevision + 1
        if (input.snapshot.revision !== expectedNext) return false
      }
      const snapshot = structuredClone(input.snapshot)
      await transaction.put(primaryKey, snapshot)
      await transaction.put(this.backupKey(snapshot.revision), snapshot)
      return true
    })
  }

  private validateSnapshot(snapshot: T): void {
    if (!snapshot || !Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
      throw new Error('[platform-snapshot-persistence:snapshot_invalid] snapshot revision 无效')
    }
    const size = bytes(snapshot)
    if (size > this.maximumSnapshotBytes) {
      throw new Error(`[platform-snapshot-persistence:snapshot_too_large] snapshot ${size} bytes 超过上限`)
    }
  }

  private primaryKey(): string { return `${this.namespace}/current` }
  private backupKey(revision: number): string { return `${this.namespace}/backup/${revision % this.backupSlots}` }
}
