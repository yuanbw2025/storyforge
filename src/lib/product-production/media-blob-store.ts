import Dexie from 'dexie'
import { db } from '../db/schema'
import type { MediaBlobObjectRecordV1, ProductMediaBlob, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope, stampNewRecord } from '../workspace/scope'

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

/** Registry export and media resolvers share this single physical-byte verifier. */
export async function readVerifiedMediaBlobObjectData(row: MediaBlobObjectRecordV1): Promise<ArrayBuffer> {
  if (row.storageState !== 'ready') throw new Error('[product-production] 共享媒资尚未 ready')
  const data = row.backend === 'indexeddb'
    ? row.data
    : row.opfsPath ? await readOpfsData(row.opfsPath) : null
  if (!data) throw new Error('[product-production] 共享媒资物理数据缺失')
  if (data.byteLength !== row.byteSize) throw new Error('[product-production] 共享媒资大小不匹配')
  if (await sha256MediaData(data) !== row.contentHash) throw new Error('[product-production] 共享媒资哈希不匹配')
  return data
}

export async function readMediaBlobObjectData(input: {
  scope: WorkspaceScope
  blobObjectId: number
  expected?: { contentHash: string; byteSize: number; mimeType: string }
}): Promise<ArrayBuffer> {
  const scope = await resolveScope({ scope: input.scope })
  const row = await db.mediaBlobObjects.get(input.blobObjectId)
  if (!row || !await assertRecordInScope(scope, 'mediaBlobObjects', row, { owner: 'work' })) {
    throw new Error('[product-production] 共享媒资不存在或跨 Work')
  }
  if (input.expected && (row.contentHash !== input.expected.contentHash
    || row.byteSize !== input.expected.byteSize || row.mimeType !== input.expected.mimeType)) {
    throw new Error('[product-production] 共享媒资元数据与冻结引用不匹配')
  }
  try {
    return await readVerifiedMediaBlobObjectData(row)
  } catch (cause) {
    if (row.id != null) {
      await db.mediaBlobObjects.update(row.id, { storageState: 'corrupt', updatedAt: Date.now() })
    }
    throw cause
  }
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

export async function putMediaBlobObject(input: {
  scope: WorkspaceScope
  data: ArrayBuffer
  mimeType: string
  expectedContentHash?: string
  backend?: 'auto' | 'indexeddb' | 'opfs'
  /** Only the governed SVG sanitizer may set this after producing new safe bytes. */
  sanitizedSvg?: boolean
}): Promise<MediaBlobObjectRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const data = input.data.slice(0)
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
    await readVerifiedMediaBlobObjectData(existing)
    return existing
  }

  const supportsOpfs = typeof navigator.storage?.getDirectory === 'function'
  const backend = input.backend === 'opfs'
    || (input.backend !== 'indexeddb' && data.byteLength > INDEXED_DB_MAXIMUM_BYTES && supportsOpfs)
    ? 'opfs'
    : 'indexeddb'
  if (input.backend === 'opfs' && !supportsOpfs) throw new Error('[product-production] 当前浏览器不支持 OPFS')
  const opfsPath = backend === 'opfs' ? `storyforge/media/v1/work-${scope.workId}/${contentHash}` : null
  const now = Date.now()
  const pending = stampNewRecord(scope, 'mediaBlobObjects', {
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    contentHash,
    mimeType,
    byteSize: data.byteLength,
    backend,
    storageState: 'pending-write',
    data: null,
    opfsPath,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies MediaBlobObjectRecordV1, { owner: 'work' })
  let id: number
  try {
    id = await db.mediaBlobObjects.add(pending) as number
  } catch (cause) {
    const raced = await db.mediaBlobObjects
      .where('[workId+contentHash]').equals([scope.workId, contentHash]).first()
    if (!raced) throw cause
    await readVerifiedMediaBlobObjectData(raced)
    return raced
  }

  try {
    if (backend === 'opfs') await writeOpfsData(opfsPath!, data)
    const updatedAt = Date.now()
    await db.mediaBlobObjects.update(id, {
      data: backend === 'indexeddb' ? data : null,
      storageState: 'ready',
      lastVerifiedAt: updatedAt,
      updatedAt,
    })
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
  const scope = await resolveScope({ scope: input.scope })
  const durationMs = input.durationMs ?? 60_000
  if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > MAXIMUM_LEASE_MS) {
    throw new Error('[product-production] 媒资 lease 时长无效')
  }
  const owner = input.owner?.trim() || crypto.randomUUID()
  if (owner.length > 200) throw new Error('[product-production] 媒资 lease owner 无效')
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

export async function collectUnreferencedMediaBlobObjects(input: {
  scope: WorkspaceScope
  now?: number
}): Promise<MediaBlobGcReceiptV1> {
  const scope = await resolveScope({ scope: input.scope })
  const now = input.now ?? Date.now()
  const [objects, artifacts, productBlobs] = await Promise.all([
    db.mediaBlobObjects.where('workId').equals(scope.workId).toArray(),
    db.productBuildArtifacts.where('workId').equals(scope.workId).toArray(),
    db.productMediaBlobs.where('workId').equals(scope.workId).toArray(),
  ])
  const referenced = new Set([
    ...artifacts
      .filter(row => row.status === 'accepted' || row.status === 'carried-forward')
      .flatMap(row => row.blobObjectId == null ? [] : [row.blobObjectId]),
    ...productBlobs.map(row => row.blobObjectId),
  ])
  const retained: number[] = []
  const deleted: number[] = []
  for (const object of objects) {
    if (object.id == null) continue
    if (referenced.has(object.id) || (object.leaseExpiresAt ?? 0) > now || object.storageState === 'pending-write') {
      retained.push(object.id)
      continue
    }
    const claimed = await db.transaction(
      'rw',
      [
        db.mediaBlobObjects,
        db.productBuildArtifacts,
        db.productMediaBlobs,
      ],
      async () => {
        const current = await db.mediaBlobObjects.get(object.id!)
        if (!current || current.workId !== scope.workId || current.storageState === 'pending-write'
          || (current.leaseExpiresAt ?? 0) > now) return null
        const [artifactRef, productRef] = await Promise.all([
          db.productBuildArtifacts.where('blobObjectId').equals(object.id!).filter(row => (
            row.status === 'accepted' || row.status === 'carried-forward'
          )).first(),
          db.productMediaBlobs.where('blobObjectId').equals(object.id!).first(),
        ])
        if (artifactRef || productRef) return null
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
