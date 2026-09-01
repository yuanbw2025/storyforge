import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  acquireMediaBlobLease,
  collectUnreferencedMediaBlobObjects,
  putMediaBlobObject,
  readMediaBlobObjectData,
  recoverInterruptedMediaBlobObjects,
} from '../../src/lib/game-production/media-blob-store'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    name, genre: 'visual', genres: ['visual'], status: 'drafting', description: '',
    targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  return ensureWorkspaceOwnership(projectId)
}

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer
}

describe('R-GAMEPROD-1A2 · shared media blob store', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('同一 Work 按 contentHash 去重，跨 Work 不共享，预期 hash 错误零写入', async () => {
    const first = await workspace('媒资 Work A')
    const second = await workspace('媒资 Work B')
    const data = bytes('same-physical-media')
    const one = await putMediaBlobObject({ scope: first.scope, data, mimeType: 'image/png' })
    const repeated = await putMediaBlobObject({ scope: first.scope, data, mimeType: 'image/png' })
    const isolated = await putMediaBlobObject({ scope: second.scope, data, mimeType: 'image/png' })
    expect(repeated.id).toBe(one.id)
    expect(isolated.id).not.toBe(one.id)
    expect(await db.mediaBlobObjects.count()).toBe(2)

    await expect(putMediaBlobObject({
      scope: first.scope,
      data: bytes('different'),
      mimeType: 'image/png',
      expectedContentHash: one.contentHash,
    })).rejects.toThrow(/哈希与预期不一致/)
    expect(await db.mediaBlobObjects.count()).toBe(2)
  })

  it('lease 和正式链接阻止 GC；释放且移除引用后两阶段回收对象', async () => {
    const owned = await workspace('媒资 GC')
    const object = await putMediaBlobObject({ scope: owned.scope, data: bytes('gc-object'), mimeType: 'image/png' })
    const lease = await acquireMediaBlobLease({ scope: owned.scope, blobObjectId: object.id!, owner: 'preview:test' })
    expect((await collectUnreferencedMediaBlobObjects({ scope: owned.scope })).retained).toContain(object.id)
    await lease.release()

    const now = Date.now()
    const mediaAssetId = await db.productMediaAssets.add({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      assetKey: 'gc.asset', version: 1, kind: 'background', name: 'GC 测试素材', mimeType: 'image/png',
      byteSize: object.byteSize, width: null, height: null, durationMs: null, contentHash: object.contentHash,
      source: 'test', license: 'test-only', altText: '', characterTag: '', sceneTag: 'test',
      createdAt: now, updatedAt: now,
    }) as number
    const linkId = await db.productMediaBlobs.add({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      mediaAssetId, blobObjectId: object.id!, data: null, createdAt: now,
    }) as number
    expect((await collectUnreferencedMediaBlobObjects({ scope: owned.scope })).retained).toContain(object.id)
    await db.productMediaBlobs.delete(linkId)
    expect((await collectUnreferencedMediaBlobObjects({ scope: owned.scope })).deleted).toContain(object.id)
    expect(await db.mediaBlobObjects.get(object.id!)).toBeUndefined()
  })

  it('恢复扫描把超时 pending-write 标为 corrupt，并在无引用时完成清理', async () => {
    const owned = await workspace('媒资恢复')
    const now = Date.now()
    const id = await db.mediaBlobObjects.add({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      contentHash: 'f'.repeat(64), mimeType: 'image/png', byteSize: 5, backend: 'indexeddb',
      storageState: 'pending-write', data: null, opfsPath: null, leaseOwner: null, leaseExpiresAt: null,
      lastVerifiedAt: null, createdAt: now - 10_000, updatedAt: now - 10_000,
    }) as number
    const recovered = await recoverInterruptedMediaBlobObjects({ scope: owned.scope, staleBefore: now - 1_000 })
    expect(recovered.markedCorrupt).toContain(id)
    expect(recovered.garbageCollection.deleted).toContain(id)
  })

  it('OPFS 对象通过受控路径读回，并在项目导出时物化为已验 hash 的便携二进制', async () => {
    const files = new Map<string, ArrayBuffer>()
    const directory = (prefix: string): any => ({
      async getDirectoryHandle(name: string) { return directory(`${prefix}/${name}`) },
      async getFileHandle(name: string) {
        const path = `${prefix}/${name}`
        return {
          async createWritable() {
            return {
              async write(data: ArrayBuffer) { files.set(path, data.slice(0)) },
              async close() {},
              async abort() {},
            }
          },
          async getFile() {
            const data = files.get(path)
            if (!data) throw new Error('missing fake OPFS file')
            return new Blob([data])
          },
        }
      },
      async removeEntry(name: string) { files.delete(`${prefix}/${name}`) },
    })
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: async () => directory(''), estimate: async () => ({ quota: 1_000_000, usage: 0 }) },
    })
    try {
      const owned = await workspace('OPFS 媒资')
      const data = bytes('opfs-portable-object')
      const object = await putMediaBlobObject({
        scope: owned.scope, data, mimeType: 'audio/wav', backend: 'opfs',
      })
      expect(object).toMatchObject({ backend: 'opfs', storageState: 'ready', data: null })
      expect(await readMediaBlobObjectData({ scope: owned.scope, blobObjectId: object.id! })).toEqual(data)

      const exported = await exportProjectJSON(owned.scope.projectId)
      expect(exported.mediaBlobObjects?.[0]).toMatchObject({ backend: 'indexeddb', opfsPath: null })
      expect(exported.mediaBlobObjects?.[0].data).toMatch(/^data:audio\/wav;base64,/)
      const importedProjectId = await importProjectJSON(exported)
      const imported = await db.mediaBlobObjects.where('projectId').equals(importedProjectId).first()
      expect(imported).toMatchObject({ backend: 'indexeddb', storageState: 'ready', opfsPath: null })
      expect(imported?.data).toEqual(data)
    } finally {
      if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage)
      else delete (navigator as { storage?: unknown }).storage
    }
  })
})
