import Dexie from 'dexie'
import { db } from '../db/schema'
import type { MediaBlobObject, MediaBlobObjectRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope, stampNewRecord } from '../workspace/scope'
import { hashCanonicalValue } from '../agent/run/hash'
import { assertMediaBlobObjectV1 } from '../comic/contracts'
import { PROJECT_TABLES } from '../registry/project-tables'
import { decodeRasterImageV1, isRasterImageMimeV1, MAX_RASTER_IMAGE_BYTES_V1 } from './raster-image'

const MAX_AUDIO_BYTES = 50 * 1024 * 1024

export interface PreparedMediaBlobV1 {
  data: ArrayBuffer
  contentHash: string
  mimeType: MediaBlobObject['mimeType']
  width: number
  height: number
}

export interface PreparedAudioBlobV1 {
  data: ArrayBuffer
  contentHash: string
  mimeType: 'audio/mpeg' | 'audio/ogg' | 'audio/wav' | 'audio/mp4'
}

function mediaReferenceSpecs() {
  return PROJECT_TABLES.filter(spec => spec.mediaRef?.blobTable === 'mediaBlobObjects')
}

async function hasRegisteredMediaReferences(blobObjectId: number): Promise<boolean> {
  for (const spec of mediaReferenceSpecs()) if (await spec.table.where(spec.mediaRef!.field).equals(blobObjectId).count()) return true
  return false
}

export async function sha256BinaryV1(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function binaryDataUrlV1(data: ArrayBuffer, mimeType: string): string {
  if (!(data instanceof ArrayBuffer) || !mimeType.trim() || /[\r\n;,]/.test(mimeType)) throw new Error('[media] 二进制或 MIME 非法')
  const bytes = new Uint8Array(data); let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return `data:${mimeType};base64,${btoa(binary)}`
}

/** Sniff audio bytes instead of trusting a browser-supplied extension or MIME. */
export function inspectAudioBytesV1(data: ArrayBuffer): { mimeType: PreparedAudioBlobV1['mimeType'] } {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 4 || data.byteLength > MAX_AUDIO_BYTES) throw new Error('[media] 音频体积非法或超过 50 MiB')
  const bytes = new Uint8Array(data)
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return { mimeType: 'audio/wav' }
  if (ascii(0, 4) === 'OggS') return { mimeType: 'audio/ogg' }
  if (ascii(0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return { mimeType: 'audio/mpeg' }
  if (bytes.length >= 12 && ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)
    if (['M4A ', 'M4B ', 'mp41', 'mp42', 'isom'].includes(brand)) return { mimeType: 'audio/mp4' }
  }
  throw new Error('[media] 仅支持可验证签名的 MP3、WAV、OGG、M4A 音频')
}

const preparedImages = new WeakMap<PreparedMediaBlobV1, ArrayBuffer>()

/** Decode and hash an owned snapshot before opening a caller-owned transaction. */
export async function prepareMediaBlobV1(data: ArrayBuffer): Promise<PreparedMediaBlobV1> {
  if (!(data instanceof ArrayBuffer) || data.byteLength > MAX_RASTER_IMAGE_BYTES_V1) {
    throw new Error('[media] 图片体积非法或超过 25 MiB')
  }
  const bytes = data.slice(0)
  const image = await decodeRasterImageV1(bytes)
  const prepared = Object.freeze({
    get data() { return bytes.slice(0) },
    contentHash: await sha256BinaryV1(bytes),
    ...image,
  })
  preparedImages.set(prepared, bytes)
  return prepared
}

export async function prepareAudioBlobV1(data: ArrayBuffer): Promise<PreparedAudioBlobV1> {
  const audio = inspectAudioBytesV1(data)
  return { data: data.slice(0), contentHash: await sha256BinaryV1(data), ...audio }
}

/** Store verified audio bytes in the same content-addressed registry used by visual references. */
export async function putPreparedAudioBlobV1(
  scope: WorkspaceScope,
  audio: PreparedAudioBlobV1,
): Promise<MediaBlobObjectRecordV1 & { id: number }> {
  const existing = await db.mediaBlobObjects.where('[workId+contentHash]').equals([scope.workId, audio.contentHash]).first()
  if (existing?.id) {
    if (!await assertRecordInScope(scope, 'mediaBlobObjects', existing, { owner: 'work' })) throw new Error('[media] 同 hash Blob 越界')
    if (existing.storageState !== 'ready' || existing.byteSize !== audio.data.byteLength || existing.mimeType !== audio.mimeType) throw new Error('[media] 同 hash 音频 Blob 元数据冲突')
    if (existing.disposition === 'pending-delete') {
      const restored = { ...existing, disposition: 'available' as const, storageState: 'ready' as const, deleteRequestedAt: null, deleteReceiptHash: null, updatedAt: Date.now() }
      await db.mediaBlobObjects.put(restored)
      return restored as MediaBlobObjectRecordV1 & { id: number }
    }
    return existing as MediaBlobObjectRecordV1 & { id: number }
  }
  const now = Date.now()
  const row: MediaBlobObjectRecordV1 = stampNewRecord(scope, 'mediaBlobObjects', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    contentHash: audio.contentHash, mimeType: audio.mimeType, byteSize: audio.data.byteLength,
    data: audio.data.slice(0), backend: 'indexeddb', storageState: 'ready', opfsPath: null,
    leaseOwner: null, leaseExpiresAt: null, lastVerifiedAt: now, disposition: 'available',
    deleteRequestedAt: null, deleteReceiptHash: null, createdAt: now, updatedAt: now,
  }, { owner: 'work' })
  const id = await db.mediaBlobObjects.add(row) as number
  return { ...row, id }
}

/**
 * Atomically reuse or store bytes that were already verified outside the
 * current transaction. Callers can include this in a larger asset commit
 * without duplicating the shared Blob contract.
 */
export async function putPreparedMediaBlobV1(
  scope: WorkspaceScope,
  image: PreparedMediaBlobV1,
): Promise<MediaBlobObject & { id: number }> {
  const bytes = preparedImages.get(image)
  if (!bytes) throw new Error('[media] 图片尚未经共享解码验证')
  const existing = await db.mediaBlobObjects.where('[workId+contentHash]').equals([scope.workId, image.contentHash]).first()
  if (existing?.id) {
    if (!await assertRecordInScope(scope, 'mediaBlobObjects', existing, { owner: 'work' })) {
      throw new Error('[media] 同 hash Blob 越界')
    }
    assertMediaBlobObjectV1(existing)
    if (existing.byteSize !== bytes.byteLength
      || existing.mimeType !== image.mimeType
      || existing.width !== image.width
      || existing.height !== image.height) {
      throw new Error('[media] 同 hash Blob 元数据冲突')
    }
    const storedBytes = new Uint8Array(existing.data)
    const verifiedBytes = new Uint8Array(bytes)
    if (storedBytes.some((byte, index) => byte !== verifiedBytes[index])) {
      throw new Error('[media] 同 hash Blob 内容冲突')
    }
    if (existing.disposition === 'pending-delete') {
      const restored = { ...existing, disposition: 'available' as const, storageState: 'ready' as const, deleteRequestedAt: null, deleteReceiptHash: null, updatedAt: Date.now() }
      await db.mediaBlobObjects.put(restored)
      return restored as MediaBlobObject & { id: number }
    }
    return existing as MediaBlobObject & { id: number }
  }
  const now = Date.now()
  const row: MediaBlobObject = stampNewRecord(scope, 'mediaBlobObjects', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, contentHash: image.contentHash, mimeType: image.mimeType,
    byteSize: bytes.byteLength, width: image.width, height: image.height, data: bytes.slice(0),
    backend: 'indexeddb', storageState: 'ready', opfsPath: null, leaseOwner: null,
    leaseExpiresAt: null, lastVerifiedAt: now,
    disposition: 'available', deleteRequestedAt: null, deleteReceiptHash: null, createdAt: now, updatedAt: now,
  }, { owner: 'work' })
  assertMediaBlobObjectV1(row)
  const id = await db.mediaBlobObjects.add(row) as number
  return { ...row, id }
}

export async function putVerifiedMediaBlobV1(input: { scope: WorkspaceScope; data: ArrayBuffer }): Promise<MediaBlobObject & { id: number }> {
  const scope = await resolveScope({ scope: input.scope })
  const image = await prepareMediaBlobV1(input.data)
  const existing = await db.mediaBlobObjects.where('[workId+contentHash]').equals([scope.workId, image.contentHash]).first()
  if (existing?.id) {
    assertMediaBlobObjectV1(existing)
    if (await sha256BinaryV1(existing.data) !== image.contentHash) throw new Error('[media] 同 hash Blob 内容冲突')
  }
  return putPreparedMediaBlobV1(scope, image)
}

export async function assertStoredRasterImageV1(data: ArrayBuffer, stored: { mimeType: string; width?: number | null; height?: number | null }): Promise<void> {
  const image = await decodeRasterImageV1(data)
  if (image.mimeType !== stored.mimeType
    || (stored.width != null && stored.width !== image.width)
    || (stored.height != null && stored.height !== image.height)) {
    throw new Error('[media] 图片解码结果与冻结 MIME 或尺寸不一致')
  }
}

export async function readVerifiedMediaBlobV1(input: { scope: WorkspaceScope; blobObjectId: number }): Promise<MediaBlobObject & { id: number }> {
  const scope = await resolveScope({ scope: input.scope })
  const row = await db.mediaBlobObjects.get(input.blobObjectId)
  if (!row?.id || !await assertRecordInScope(scope, 'mediaBlobObjects', row, { owner: 'work' })) throw new Error('[media] Blob 不存在、已回收或越界')
  assertMediaBlobObjectV1(row)
  if (row.disposition !== 'available' || row.storageState !== 'ready') throw new Error('[media] Blob 不存在、已回收或越界')
  if (await sha256BinaryV1(row.data) !== row.contentHash) throw new Error('[media] Blob 内容 hash 不匹配')
  await assertStoredRasterImageV1(row.data, row)
  return row as MediaBlobObject & { id: number }
}

export async function mediaBlobDataUrlV1(input: { scope: WorkspaceScope; blobObjectId: number }): Promise<string> {
  const row = await readVerifiedMediaBlobV1(input)
  return binaryDataUrlV1(row.data, row.mimeType)
}

/** Product-neutral preview helper for verified image or audio references. */
export async function mediaObjectDataUrlV1(input: { scope: WorkspaceScope; blobObjectId: number }): Promise<string> {
  const scope = await resolveScope({ scope: input.scope })
  const row = await db.mediaBlobObjects.get(input.blobObjectId)
  if (!row?.id || !await assertRecordInScope(scope, 'mediaBlobObjects', row, { owner: 'work' }) || row.storageState !== 'ready' || row.disposition === 'pending-delete' || !row.data) throw new Error('[media] Blob 不存在、已回收、越界或不支持本地预览')
  if (row.data.byteLength !== row.byteSize || await sha256BinaryV1(row.data) !== row.contentHash) throw new Error('[media] Blob 内容校验失败')
  if (isRasterImageMimeV1(row.mimeType)) await assertStoredRasterImageV1(row.data, row)
  return binaryDataUrlV1(row.data, row.mimeType)
}

export async function markUnreferencedMediaBlobForDeletionV1(input: { scope: WorkspaceScope; blobObjectId: number }): Promise<MediaBlobObject & { id: number } | null> {
  const scope = await resolveScope({ scope: input.scope })
  const refs = mediaReferenceSpecs()
  return db.transaction('rw', [db.mediaBlobObjects, ...refs.map(spec => spec.table)], async () => {
    const row = await db.mediaBlobObjects.get(input.blobObjectId)
    if (!row?.id || !await assertRecordInScope(scope, 'mediaBlobObjects', row, { owner: 'work' })) throw new Error('[media] Blob 不存在或越界')
    assertMediaBlobObjectV1(row)
    if (await hasRegisteredMediaReferences(row.id)) return null
    const requestedAt = Date.now()
    const next = { ...row, disposition: 'pending-delete' as const, storageState: 'pending-delete' as const, deleteRequestedAt: requestedAt, deleteReceiptHash: await Dexie.waitFor(hashCanonicalValue({ version: 1, blobObjectId: row.id, workId: scope.workId, contentHash: row.contentHash, requestedAt })), updatedAt: requestedAt }
    await db.mediaBlobObjects.put(next); return next as MediaBlobObject & { id: number }
  })
}

export async function finalizePendingMediaBlobDeletionV1(input: { scope: WorkspaceScope; blobObjectId: number; receiptHash: string }): Promise<boolean> {
  const scope = await resolveScope({ scope: input.scope })
  const refs = mediaReferenceSpecs()
  return db.transaction('rw', [db.mediaBlobObjects, ...refs.map(spec => spec.table)], async () => {
    const row = await db.mediaBlobObjects.get(input.blobObjectId)
    if (!row?.id || !await assertRecordInScope(scope, 'mediaBlobObjects', row, { owner: 'work' })) throw new Error('[media] Blob 不存在或越界')
    assertMediaBlobObjectV1(row)
    if (row.disposition !== 'pending-delete' || row.deleteReceiptHash !== input.receiptHash) throw new Error('[media] Blob 删除回执不匹配')
    if (await hasRegisteredMediaReferences(row.id)) {
      await db.mediaBlobObjects.update(row.id, { disposition: 'available', storageState: 'ready', deleteRequestedAt: null, deleteReceiptHash: null, updatedAt: Date.now() })
      return false
    }
    await db.mediaBlobObjects.delete(row.id); return true
  })
}

export async function recoverPendingMediaBlobDeletionsV1(scopeInput: WorkspaceScope): Promise<{ deleted: number; restored: number }> {
  const scope = await resolveScope({ scope: scopeInput })
  const rows = await db.mediaBlobObjects.where('workId').equals(scope.workId).filter(row => row.disposition === 'pending-delete').toArray()
  let deleted = 0; let restored = 0
  for (const row of rows) {
    if (!row.id || !row.deleteReceiptHash) continue
    if (await finalizePendingMediaBlobDeletionV1({ scope, blobObjectId: row.id, receiptHash: row.deleteReceiptHash })) deleted++
    else restored++
  }
  return { deleted, restored }
}
