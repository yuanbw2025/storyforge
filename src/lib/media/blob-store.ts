import Dexie from 'dexie'
import { db } from '../db/schema'
import type { MediaBlobObject, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope, stampNewRecord } from '../workspace/scope'
import { hashCanonicalValue } from '../agent/run/hash'
import { assertMediaBlobObjectV1 } from '../comic/contracts'
import { PROJECT_TABLES } from '../registry/project-tables'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export interface PreparedMediaBlobV1 {
  data: ArrayBuffer
  contentHash: string
  mimeType: MediaBlobObject['mimeType']
  width: number
  height: number
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

function readPng(bytes: Uint8Array): { mimeType: 'image/png'; width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) }
}

function readJpeg(bytes: Uint8Array): { mimeType: 'image/jpeg'; width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue }
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (length < 2 || offset + length + 2 > bytes.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { mimeType: 'image/jpeg', height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] }
    }
    offset += length + 2
  }
  return null
}

function readWebp(bytes: Uint8Array): { mimeType: 'image/webp'; width: number; height: number } | null {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
  if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return null
  const kind = ascii(12, 4)
  if (kind === 'VP8X') return { mimeType: 'image/webp', width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) }
  if (kind === 'VP8 ' && bytes.length >= 30) return { mimeType: 'image/webp', width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff }
  if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    return { mimeType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

export function inspectImageBytesV1(data: ArrayBuffer): { mimeType: MediaBlobObject['mimeType']; width: number; height: number } {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 16 || data.byteLength > MAX_IMAGE_BYTES) throw new Error('[media] 图片体积非法或超过 25 MiB')
  const bytes = new Uint8Array(data)
  const result = readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes)
  if (!result || !Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 1 || result.height < 1 || result.width > 16384 || result.height > 16384) throw new Error('[media] 仅支持可验证尺寸的 PNG、JPEG、WebP 图片')
  return result
}

/** Prepare and hash bytes before entering a caller-owned IndexedDB transaction. */
export async function prepareMediaBlobV1(data: ArrayBuffer): Promise<PreparedMediaBlobV1> {
  const image = inspectImageBytesV1(data)
  return { data: data.slice(0), contentHash: await sha256BinaryV1(data), ...image }
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
  const existing = await db.mediaBlobObjects.where('[workId+contentHash]').equals([scope.workId, image.contentHash]).first()
  if (existing?.id) {
    if (!await assertRecordInScope(scope, 'mediaBlobObjects', existing, { owner: 'work' })) {
      throw new Error('[media] 同 hash Blob 越界')
    }
    assertMediaBlobObjectV1(existing)
    if (existing.byteSize !== image.data.byteLength
      || existing.mimeType !== image.mimeType
      || existing.width !== image.width
      || existing.height !== image.height) {
      throw new Error('[media] 同 hash Blob 元数据冲突')
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
    byteSize: image.data.byteLength, width: image.width, height: image.height, data: image.data.slice(0),
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

export async function readVerifiedMediaBlobV1(input: { scope: WorkspaceScope; blobObjectId: number }): Promise<MediaBlobObject & { id: number }> {
  const scope = await resolveScope({ scope: input.scope })
  const row = await db.mediaBlobObjects.get(input.blobObjectId)
  if (!row?.id || !await assertRecordInScope(scope, 'mediaBlobObjects', row, { owner: 'work' })) throw new Error('[media] Blob 不存在、已回收或越界')
  assertMediaBlobObjectV1(row)
  if (row.disposition !== 'available' || row.storageState !== 'ready') throw new Error('[media] Blob 不存在、已回收或越界')
  if (await sha256BinaryV1(row.data) !== row.contentHash) throw new Error('[media] Blob 内容 hash 不匹配')
  return row as MediaBlobObject & { id: number }
}

export async function mediaBlobDataUrlV1(input: { scope: WorkspaceScope; blobObjectId: number }): Promise<string> {
  const row = await readVerifiedMediaBlobV1(input)
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
