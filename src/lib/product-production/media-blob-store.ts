import Dexie, { type Table } from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import type { MediaBlobObjectRecordV1, ProductMediaBlob, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'

const INDEXED_DB_MAXIMUM_BYTES = 8 * 1024 * 1024
const SINGLE_OBJECT_MAXIMUM_BYTES = 100 * 1024 * 1024
const MAXIMUM_LEASE_MS = 15 * 60 * 1000
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

export async function sha256MediaData(data: ArrayBuffer): Promise<string> {
  const digestPromise = crypto.subtle.digest('SHA-256', data)
  const digest = Dexie.currentTransaction ? await Dexie.waitFor(digestPromise) : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function parseControlledOpfsPath(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 4 || segments[0] !== 'storyforge' || segments[1] !== 'media' || segments[2] !== 'v1'
    || segments.some(segment => segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('[product-production] 非法 OPFS 媒资路径')
  }
  return segments
}

async function readOpfsData(path: string): Promise<ArrayBuffer> {
  const getDirectory = navigator.storage?.getDirectory
  if (typeof getDirectory !== 'function') throw new Error('[product-production] 当前浏览器不支持 OPFS')
  const segments = parseControlledOpfsPath(path)
  let directory = await getDirectory.call(navigator.storage)
  for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment)
  const file = await (await directory.getFileHandle(segments[segments.length - 1])).getFile()
  return file.arrayBuffer()
}

async function writeOpfsData(path: string, data: ArrayBuffer): Promise<void> {
  const getDirectory = navigator.storage?.getDirectory
  if (typeof getDirectory !== 'function') throw new Error('[product-production] 当前浏览器不支持 OPFS')
  const segments = parseControlledOpfsPath(path)
  let directory = await getDirectory.call(navigator.storage)
  for (const segment of segments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment, { create: true })
  }
  const file = await directory.getFileHandle(segments[segments.length - 1], { create: true })
  const writable = await file.createWritable()
  try {
    await writable.write(data)
    await writable.close()
  } catch (cause) {
    await writable.abort().catch(() => undefined)
    throw cause
  }
}

async function deleteOpfsData(path: string): Promise<void> {
  const getDirectory = navigator.storage?.getDirectory
  if (typeof getDirectory !== 'function') throw new Error('[product-production] 当前浏览器不支持 OPFS')
  const segments = parseControlledOpfsPath(path)
  let directory = await getDirectory.call(navigator.storage)
  for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment)
  await directory.removeEntry(segments[segments.length - 1])
}

function normalizeMimeType(value: string, sanitizedSvg = false): string {
  const mimeType = value.trim().toLowerCase()
  if (!MIME_PATTERN.test(mimeType) || (mimeType === 'image/svg+xml' && !sanitizedSvg) || mimeType === 'text/html'
    || mimeType === 'application/javascript') {
    throw new Error('[product-production] 媒资 MIME 类型无效或不安全')
  }
  return mimeType
}

async function assertStorageBudget(byteSize: number): Promise<void> {
  const estimate = navigator.storage?.estimate
  if (typeof estimate !== 'function') return
  const result = await estimate.call(navigator.storage)
  if (typeof result.quota === 'number' && typeof result.usage === 'number'
    && result.quota - result.usage < byteSize) {
    throw new Error('[product-production] 浏览器存储空间不足')
  }
}

class MediaBlobIntegrityError extends Error {}

async function readPhysicalMediaBlobObjectData(row: MediaBlobObjectRecordV1): Promise<ArrayBuffer> {
  const data = row.backend === 'indexeddb'
    ? row.data
    : row.opfsPath ? await readOpfsData(row.opfsPath) : null
  if (!data) throw new Error('[product-production] 共享媒资物理数据缺失')
  if (data.byteLength !== row.byteSize) throw new MediaBlobIntegrityError('[product-production] 共享媒资大小不匹配')
  if (await sha256MediaData(data) !== row.contentHash) throw new MediaBlobIntegrityError('[product-production] 共享媒资哈希不匹配')
  return data
}

/** Registry export and media resolvers remain read-only and require ready bytes. */
export async function readVerifiedMediaBlobObjectData(row: MediaBlobObjectRecordV1): Promise<ArrayBuffer> {
  if (row.storageState !== 'ready') throw new Error('[product-production] 共享媒资尚未 ready')
  return readPhysicalMediaBlobObjectData(row)
}

const MEDIA_READ_VERSION_FIELDS = [
  'id', 'projectId', 'worldId', 'workId', 'contentHash', 'mimeType', 'byteSize',
  'backend', 'opfsPath', 'storageState', 'createdAt', 'lastVerifiedAt',
  'width', 'height', 'disposition', 'deleteRequestedAt', 'deleteReceiptHash',
] as const satisfies readonly (keyof MediaBlobObjectRecordV1)[]

function sameMediaReadVersion(before: MediaBlobObjectRecordV1, current: MediaBlobObjectRecordV1): boolean {
  if (!MEDIA_READ_VERSION_FIELDS.every(field => before[field] === current[field])) return false
  // Same-Work preview readers may renew or release their shared lease while
  // IO is pending. That changes the row clock without replacing any bytes or
  // health/deletion metadata; an unrelated version change still fails closed.
  if (before.updatedAt !== current.updatedAt && before.leaseOwner === current.leaseOwner
    && before.leaseExpiresAt === current.leaseExpiresAt) return false
  if (before.backend !== 'indexeddb') return true
  if (!before.data || !current.data) return before.data === current.data
  const currentBytes = new Uint8Array(current.data)
  return before.data.byteLength === current.data.byteLength
    && new Uint8Array(before.data).every((byte, index) => byte === currentBytes[index])
}

/** Filesystem IO and hashing precede this transaction. Only the exact version
 * that was read may change health; references, deletion receipts and bytes stay put. */
async function finishScopedMediaRead(
  scope: WorkspaceScope,
  before: MediaBlobObjectRecordV1,
  verified: boolean,
  guard?: MediaBlobCommitGuardV1,
): Promise<MediaBlobObjectRecordV1> {
  return db.transaction('rw', scopeTransactionTables(db.mediaBlobObjects, ...(guard?.transactionTables ?? [])), async () => {
    await guard?.assertCurrentInTransaction()
    await resolveScope({ scope })
    const current = before.id == null ? undefined : await db.mediaBlobObjects.get(before.id)
    if (!current || !sameMediaReadVersion(before, current)
      || !await assertRecordInScope(scope, 'mediaBlobObjects', current, { owner: 'work' })) {
      throw new Error('[product-production] 共享媒资读取期间已变化，请重新读取')
    }
    if ((verified && current.storageState === 'corrupt') || (!verified && current.storageState === 'ready')) {
      const now = Date.now()
      const changes = verified
        ? { storageState: 'ready' as const, lastVerifiedAt: now, updatedAt: now }
        : { storageState: 'corrupt' as const, updatedAt: now }
      await db.mediaBlobObjects.update(current.id!, changes)
      return { ...current, ...changes }
    }
    return current
  })
}

async function readScopedMediaBlobObject(
  scope: WorkspaceScope,
  row: MediaBlobObjectRecordV1,
  guard?: MediaBlobCommitGuardV1,
): Promise<{ row: MediaBlobObjectRecordV1; data: ArrayBuffer }> {
  if (row.storageState !== 'ready' && row.storageState !== 'corrupt') {
    throw new Error('[product-production] 共享媒资尚未 ready')
  }
  if (row.storageState === 'corrupt' && (row.disposition === 'pending-delete'
    || row.deleteRequestedAt != null || row.deleteReceiptHash != null)) {
    throw new Error('[product-production] 共享媒资正在删除，不能恢复')
  }
  let data: ArrayBuffer
  try {
    // One physical attempt per explicit call. Unknown IO/permission failures
    // retain both their original cause and the existing health metadata.
    data = await readPhysicalMediaBlobObjectData(row)
  } catch (cause) {
    if (cause instanceof MediaBlobIntegrityError) await finishScopedMediaRead(scope, row, false, guard)
    throw cause
  }
  return { data, row: await finishScopedMediaRead(scope, row, true, guard) }
}

export async function readMediaBlobObjectData(input: {
  scope: WorkspaceScope
  blobObjectId: number
  expected?: { contentHash: string; byteSize: number; mimeType: string }
}): Promise<ArrayBuffer> {
  input = structuredClone(input)
  const scope = await resolveScope({ scope: input.scope })
  const row = await db.mediaBlobObjects.get(input.blobObjectId)
  if (!row || !await assertRecordInScope(scope, 'mediaBlobObjects', row, { owner: 'work' })) {
    throw new Error('[product-production] 共享媒资不存在或跨 Work')
  }
  if (input.expected && (row.contentHash !== input.expected.contentHash
    || row.byteSize !== input.expected.byteSize || row.mimeType !== input.expected.mimeType)) {
    throw new Error('[product-production] 共享媒资元数据与冻结引用不匹配')
  }
  return (await readScopedMediaBlobObject(scope, row)).data
}

/** Resolve a product-owned media binding through the content-addressed object. */
export async function readProductMediaBlobData(input: {
  scope: WorkspaceScope
  blob: ProductMediaBlob
  expected: { contentHash: string; byteSize: number; mimeType: string }
}): Promise<ArrayBuffer> {
  return readMediaBlobObjectData({
    scope: input.scope,
    blobObjectId: input.blob.blobObjectId,
    expected: input.expected,
  })
}

/** In-memory authority seam for an owning service. The guard may only perform
 * deterministic IDB reads; hashing, quota and filesystem IO stay outside it. */
export interface MediaBlobCommitGuardV1 {
  transactionTables: readonly Table[]
  assertCurrentInTransaction: () => Promise<void>
}

export async function putMediaBlobObject(input: {
  scope: WorkspaceScope
  data: ArrayBuffer
  mimeType: string
  expectedContentHash?: string
  backend?: 'auto' | 'indexeddb' | 'opfs'
  /** Only the governed SVG sanitizer may set this after producing new safe bytes. */
  sanitizedSvg?: boolean
  commitGuard?: MediaBlobCommitGuardV1
}): Promise<MediaBlobObjectRecordV1> {
  const guard = input.commitGuard
  const assertGuardCurrent = guard?.assertCurrentInTransaction
  const guardTables = guard ? [...guard.transactionTables] : []
  const readGuard: MediaBlobCommitGuardV1 | undefined = guard ? {
    transactionTables: guardTables,
    assertCurrentInTransaction: () => assertGuardCurrent!.call(guard),
  } : undefined
  // Detach only request data. Guard/table objects keep their original opaque
  // identities, and the original method keeps its receiver across all awaits.
  input = { ...input, scope: structuredClone(input.scope), data: input.data.slice(0) }
  const guardedWrite = <T>(write: () => Promise<T>): Promise<T> => guard
    ? db.transaction('rw', [db.mediaBlobObjects, ...guardTables], async () => {
        await assertGuardCurrent!.call(guard)
        return write()
      })
    : write()
  const scope = await resolveScope({ scope: input.scope })
  const data = input.data
  if (data.byteLength < 1 || data.byteLength > SINGLE_OBJECT_MAXIMUM_BYTES) {
    throw new Error('[product-production] 媒资必须在 1 byte 到 100 MiB 之间')
  }
  const mimeType = normalizeMimeType(input.mimeType, input.sanitizedSvg)
  const contentHash = await sha256MediaData(data)
  if (input.expectedContentHash != null && input.expectedContentHash !== contentHash) {
    throw new Error('[product-production] 媒资内容哈希与预期不一致')
  }
  await assertStorageBudget(data.byteLength)

  const existing = await db.mediaBlobObjects
    .where('[workId+contentHash]').equals([scope.workId, contentHash]).first()
  if (existing) {
    if (!await assertRecordInScope(scope, 'mediaBlobObjects', existing, { owner: 'work' })
      || existing.mimeType !== mimeType || existing.byteSize !== data.byteLength) {
      throw new Error('[product-production] 相同 contentHash 的共享媒资元数据冲突')
    }
    return (await readScopedMediaBlobObject(scope, existing, readGuard)).row
  }

  const supportsOpfs = typeof navigator.storage?.getDirectory === 'function'
  const backend = input.backend === 'opfs'
    || (input.backend !== 'indexeddb' && data.byteLength > INDEXED_DB_MAXIMUM_BYTES && supportsOpfs)
    ? 'opfs'
    : 'indexeddb'
  if (input.backend === 'opfs' && !supportsOpfs) throw new Error('[product-production] 当前浏览器不支持 OPFS')
  const opfsPath = backend === 'opfs' ? `storyforge/media/v1/work-${scope.workId}/${contentHash}` : null
  const now = Date.now()
  // IndexedDB stores metadata and bytes in one atomic row. Publishing a
  // pending row first exposes a false incomplete object to concurrent
  // consumers of identical bytes. OPFS still requires its journaled write.
  const pending = stampNewRecord(scope, 'mediaBlobObjects', {
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    contentHash,
    mimeType,
    byteSize: data.byteLength,
    backend,
    storageState: backend === 'indexeddb' ? 'ready' : 'pending-write',
    data: backend === 'indexeddb' ? data : null,
    opfsPath,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastVerifiedAt: backend === 'indexeddb' ? now : null,
    createdAt: now,
    updatedAt: now,
  } satisfies MediaBlobObjectRecordV1, { owner: 'work' })
  let id: number
  let insertionConstraint = false
  try {
    id = await guardedWrite(async () => {
      try { return await db.mediaBlobObjects.add(pending) as number }
      catch (cause) {
        insertionConstraint = cause instanceof Error && cause.name === 'ConstraintError'
        throw cause
      }
    })
  } catch (cause) {
    // A stale/owner guard failure, including a ConstraintError thrown by the
    // guard itself, must never be converted to dedup success.
    if (!insertionConstraint) throw cause
    const raced = await db.mediaBlobObjects
      .where('[workId+contentHash]').equals([scope.workId, contentHash]).first()
    if (!raced) throw cause
    if (!await assertRecordInScope(scope, 'mediaBlobObjects', raced, { owner: 'work' })
      || raced.mimeType !== mimeType || raced.byteSize !== data.byteLength) {
      throw new Error('[product-production] 相同 contentHash 的共享媒资元数据冲突')
    }
    return (await readScopedMediaBlobObject(scope, raced, readGuard)).row
  }
  if (backend === 'indexeddb') return { ...pending, id }

  try {
    if (backend === 'opfs') await writeOpfsData(opfsPath!, data)
    const updatedAt = Date.now()
    await guardedWrite(() => db.mediaBlobObjects.update(id, {
      data: null,
      storageState: 'ready',
      lastVerifiedAt: updatedAt,
      updatedAt,
    }))
    return (await db.mediaBlobObjects.get(id))!
  } catch (cause) {
    await db.mediaBlobObjects.update(id, { storageState: 'corrupt', updatedAt: Date.now() })
    throw cause
  }
}

export interface MediaBlobLeaseV1 {
  blobObjectId: number
  owner: string
  expiresAt: number
  release(): Promise<void>
}

export async function acquireMediaBlobLease(input: {
  scope: WorkspaceScope
  blobObjectId: number
  durationMs?: number
  owner?: string
}): Promise<MediaBlobLeaseV1> {
  input = structuredClone(input)
  const scope = await resolveScope({ scope: input.scope })
  const durationMs = input.durationMs ?? 60_000
  if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > MAXIMUM_LEASE_MS) {
    throw new Error('[product-production] 媒资 lease 时长无效')
  }
  const owner = input.owner?.trim() || crypto.randomUUID()
  if (owner.length > 200) throw new Error('[product-production] 媒资 lease owner 无效')
  // Preview consumers acquire before reading. Revalidate a legacy health
  // marker first; only the unchanged ready-only transaction can grant a lease.
  const candidate = await db.mediaBlobObjects.get(input.blobObjectId)
  if (candidate?.storageState === 'corrupt') {
    await readMediaBlobObjectData({ scope, blobObjectId: input.blobObjectId })
  }
  const expiresAt = Date.now() + durationMs
  await db.transaction('rw', db.mediaBlobObjects, async () => {
    const row = await db.mediaBlobObjects.get(input.blobObjectId)
    if (!row || !await assertRecordInScope(scope, 'mediaBlobObjects', row, { owner: 'work' })
      || row.storageState !== 'ready') throw new Error('[product-production] 媒资不可租用')
    if (row.leaseOwner && row.leaseOwner !== owner && (row.leaseExpiresAt ?? 0) > Date.now()) {
      throw new Error('[product-production] 媒资已被其他读取者租用')
    }
    await db.mediaBlobObjects.update(row.id!, { leaseOwner: owner, leaseExpiresAt: expiresAt, updatedAt: Date.now() })
  })
  return {
    blobObjectId: input.blobObjectId,
    owner,
    expiresAt,
    async release() {
      await db.transaction('rw', db.mediaBlobObjects, async () => {
        const current = await db.mediaBlobObjects.get(input.blobObjectId)
        if (current?.leaseOwner === owner) {
          await db.mediaBlobObjects.update(input.blobObjectId, {
            leaseOwner: null, leaseExpiresAt: null, updatedAt: Date.now(),
          })
        }
      })
    },
  }
}

export interface MediaBlobGcReceiptV1 {
  workId: number
  scanned: number
  retained: number[]
  deleted: number[]
}

function registeredMediaReferenceSpecs() {
  return PROJECT_TABLES.filter(spec => spec.mediaRef?.blobTable === 'mediaBlobObjects')
}

async function collectRegisteredMediaReferenceIds(workId: number): Promise<number[]> {
  const specs = registeredMediaReferenceSpecs()
  const rows = await Promise.all(specs.map(spec => spec.table.where('workId').equals(workId).toArray()))
  return rows.flatMap((tableRows, index) => tableRows.flatMap(row => {
    const value = row[specs[index].mediaRef!.field]
    return Number.isInteger(value) && value > 0 ? [value as number] : []
  }))
}

/**
 * Best-effort rollback for physical objects staged by one failed import. It is
 * deliberately id-scoped so a failed package cannot sweep unrelated author
 * uploads that merely happen to be unreferenced at that moment.
 */
export async function discardUnreferencedMediaBlobObjectsV1(input: {
  scope: WorkspaceScope
  blobObjectIds: number[]
}): Promise<number[]> {
  const scope = await resolveScope({ scope: input.scope })
  const ids = [...new Set(input.blobObjectIds.filter(id => Number.isInteger(id) && id > 0))]
  const deleted: number[] = []
  const referenceSpecs = registeredMediaReferenceSpecs()
  for (const id of ids) {
    const claimed = await db.transaction(
      'rw',
      [db.mediaBlobObjects, db.productBuildArtifacts, db.productMediaBlobs, ...referenceSpecs.map(spec=>spec.table)],
      async () => {
        const current = await db.mediaBlobObjects.get(id)
        if (!current || !await assertRecordInScope(scope, 'mediaBlobObjects', current, { owner: 'work' })
          || current.storageState === 'pending-write' || (current.leaseExpiresAt ?? 0) > Date.now()) return null
        const [artifactRef, productRef, ...registeredRefs] = await Promise.all([
          db.productBuildArtifacts.where('blobObjectId').equals(id)
            .filter(row => row.status === 'accepted' || row.status === 'carried-forward').first(),
          db.productMediaBlobs.where('blobObjectId').equals(id).first(),
          ...referenceSpecs.map(spec=>spec.table.where(spec.mediaRef!.field).equals(id).first()),
        ])
        if (artifactRef || productRef || registeredRefs.some(Boolean)) return null
        await db.mediaBlobObjects.update(id, { storageState: 'pending-delete', updatedAt: Date.now() })
        return current
      },
    )
    if (!claimed) continue
    try {
      if (claimed.backend === 'opfs' && claimed.opfsPath) await deleteOpfsData(claimed.opfsPath)
      await db.mediaBlobObjects.delete(id)
      deleted.push(id)
    } catch {
      await db.mediaBlobObjects.update(id, { storageState: 'corrupt', updatedAt: Date.now() }).catch(() => undefined)
    }
  }
  return deleted
}

export async function collectUnreferencedMediaBlobObjects(input: {
  scope: WorkspaceScope
  now?: number
}): Promise<MediaBlobGcReceiptV1> {
  const scope = await resolveScope({ scope: input.scope })
  const now = input.now ?? Date.now()
  const [objects, artifacts, productBlobs, registeredReferenceIds] = await Promise.all([
    db.mediaBlobObjects.where('workId').equals(scope.workId).toArray(),
    db.productBuildArtifacts.where('workId').equals(scope.workId).toArray(),
    db.productMediaBlobs.where('workId').equals(scope.workId).toArray(),
    collectRegisteredMediaReferenceIds(scope.workId),
  ])
  const referenced = new Set([
    ...artifacts
      .filter(row => row.status === 'accepted' || row.status === 'carried-forward')
      .flatMap(row => row.blobObjectId == null ? [] : [row.blobObjectId]),
    ...productBlobs.map(row => row.blobObjectId),
    ...registeredReferenceIds,
  ])
  const retained: number[] = []
  const deleted: number[] = []
  for (const object of objects) {
    if (object.id == null) continue
    if (referenced.has(object.id) || (object.leaseExpiresAt ?? 0) > now || object.storageState === 'pending-write') {
      retained.push(object.id)
      continue
    }
    const referenceSpecs = registeredMediaReferenceSpecs()
    const claimed = await db.transaction(
      'rw',
      [
        db.mediaBlobObjects,
        db.productBuildArtifacts,
        db.productMediaBlobs,
        ...referenceSpecs.map(spec => spec.table),
      ],
      async () => {
        const current = await db.mediaBlobObjects.get(object.id!)
        if (!current || current.workId !== scope.workId || current.storageState === 'pending-write'
          || (current.leaseExpiresAt ?? 0) > now) return null
        const [artifactRef, productRef, ...registeredRefs] = await Promise.all([
          db.productBuildArtifacts.where('blobObjectId').equals(object.id!).filter(row => (
            row.status === 'accepted' || row.status === 'carried-forward'
          )).first(),
          db.productMediaBlobs.where('blobObjectId').equals(object.id!).first(),
          ...referenceSpecs.map(spec => spec.table.where(spec.mediaRef!.field).equals(object.id!).first()),
        ])
        if (artifactRef || productRef || registeredRefs.some(Boolean)) return null
        await db.mediaBlobObjects.update(object.id!, { storageState: 'pending-delete', updatedAt: now })
        return current
      },
    )
    if (!claimed) {
      retained.push(object.id)
      continue
    }
    try {
      if (claimed.backend === 'opfs' && claimed.opfsPath) await deleteOpfsData(claimed.opfsPath)
      await db.mediaBlobObjects.delete(object.id)
      deleted.push(object.id)
    } catch {
      retained.push(object.id)
    }
  }
  return { workId: scope.workId, scanned: objects.length, retained, deleted }
}

export async function recoverInterruptedMediaBlobObjects(input: {
  scope: WorkspaceScope
  staleBefore: number
}): Promise<{ markedCorrupt: number[]; garbageCollection: MediaBlobGcReceiptV1 }> {
  const scope = await resolveScope({ scope: input.scope })
  const pending = await db.mediaBlobObjects.where('workId').equals(scope.workId)
    .filter(row => row.storageState === 'pending-write' && row.updatedAt < input.staleBefore).toArray()
  const markedCorrupt: number[] = []
  for (const row of pending) {
    if (row.id == null) continue
    await db.mediaBlobObjects.update(row.id, { storageState: 'corrupt', updatedAt: Date.now() })
    markedCorrupt.push(row.id)
  }
  return {
    markedCorrupt,
    garbageCollection: await collectUnreferencedMediaBlobObjects({ scope, now: Date.now() }),
  }
}
