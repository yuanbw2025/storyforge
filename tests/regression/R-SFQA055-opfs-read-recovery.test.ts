import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import {
  putMediaBlobObject, readMediaBlobObjectData, readVerifiedMediaBlobObjectData,
  acquireMediaBlobLease, collectUnreferencedMediaBlobObjects,
  type MediaBlobCommitGuardV1,
} from '../../src/lib/product-production/media-blob-store'
import type { MediaBlobObjectRecordV1 } from '../../src/lib/types'
import { createCurrentTtrpgRuntimeTestBedV1 } from '../helpers/current-product-runtime'
import { createBuildProductMediaResolver } from '../../src/lib/product-production/media-resolver'
import { seedAvgNativePreview } from '../helpers/avg-native-fixture'
import { avgInventoryMediaFixture } from '../helpers/avg-inventory-media-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'

interface FakeWritable {
  write(data: ArrayBuffer): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}
interface FakeFile {
  createWritable(): Promise<FakeWritable>
  getFile(): Promise<Blob>
}
interface FakeDirectory {
  getDirectoryHandle(name: string): Promise<FakeDirectory>
  getFileHandle(name: string): Promise<FakeFile>
  removeEntry(name: string): Promise<void>
}

function fakeOpfs() {
  const state = {
    files: new Map<string, ArrayBuffer>(), directoryCalls: 0, readCalls: 0, deletes: 0,
    directoryFailure: null as Error | null, fileFailure: null as Error | null,
    beforeRead: null as (() => Promise<void>) | null,
  }
  function directory(prefix: string): FakeDirectory {
    return {
      async getDirectoryHandle(name) { return directory(`${prefix}/${name}`) },
      async getFileHandle(name) {
        const path = `${prefix}/${name}`
        return {
          async createWritable() {
            return { async write(data) { state.files.set(path, data.slice(0)) }, async close() {}, async abort() {} }
          },
          async getFile() {
            state.readCalls += 1
            if (state.beforeRead) await state.beforeRead()
            if (state.fileFailure) throw state.fileFailure
            const data = state.files.get(path)
            if (!data) throw new DOMException('missing isolated OPFS fixture', 'NotFoundError')
            return new Blob([data])
          },
        }
      },
      async removeEntry(name) { state.deletes += 1; state.files.delete(`${prefix}/${name}`) },
    }
  }
  Object.defineProperty(navigator, 'storage', { configurable: true, value: {
    async getDirectory() {
      state.directoryCalls += 1
      if (state.directoryFailure) throw state.directoryFailure
      return directory('')
    },
    async estimate() { return { quota: 100_000_000, usage: 0 } },
  } })
  return state
}

const bytes = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer

describe('SFQA055 · bounded scoped physical media recovery', () => {
  let originalStorage: PropertyDescriptor | undefined
  let storage: ReturnType<typeof fakeOpfs>
  beforeEach(async () => {
    await db.delete(); await db.open()
    originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')
    storage = fakeOpfs()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage)
    else Reflect.deleteProperty(navigator, 'storage')
    await db.delete(); db.close()
  })

  async function fixture() {
    const owner = await createWorkspace({ name: '055 isolated media owner', genres: [], description: '', status: 'drafting', targetWordCount: 10_000 })
    const data = bytes('055 original physical bytes')
    const row = await putMediaBlobObject({ scope: owner.scope, data, mimeType: 'audio/ogg', backend: 'opfs' })
    return { ...owner, data, row, expected: { contentHash: row.contentHash, byteSize: row.byteSize, mimeType: row.mimeType } }
  }

  async function previewFixture(storageState: 'ready' | 'corrupt') {
    const media = await avgInventoryMediaFixture(), owner = await seedAvgNativePreview(avgSystemFixture(), media)
    const selected = media[0]
    const artifact = (await db.productBuildArtifacts.where('buildId').equals(owner.buildId)
      .filter(row => row.contentHash === selected.asset.contentHash).first())!
    const row = (await db.mediaBlobObjects.get(artifact.blobObjectId!))!
    const opfsPath = `storyforge/media/v1/work-${owner.scope.workId}/${row.contentHash}`
    storage.files.set(`/${opfsPath}`, selected.data.slice(0))
    await db.mediaBlobObjects.update(row.id!, { backend: 'opfs', data: null, opfsPath, storageState })
    return { owner, selected, artifact, row }
  }

  it('keeps healthy reads and the exported verifier read-only', async () => {
    const f = await fixture(), before = await db.mediaBlobObjects.get(f.row.id!)
    expect(await readVerifiedMediaBlobObjectData(f.row)).toEqual(f.data)
    expect(await readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id!, expected: f.expected })).toEqual(f.data)
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
    expect(storage.deletes).toBe(0)
  })

  it('preserves a temporary permission error and ready state, then reads restored bytes on the next explicit call', async () => {
    const f = await fixture(), before = await db.mediaBlobObjects.get(f.row.id!)
    const unavailable = new DOMException('055 temporary permission failure', 'NotAllowedError')
    storage.directoryFailure = unavailable
    await expect(readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toBe(unavailable)
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
    storage.directoryFailure = null
    expect(await readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).toEqual(f.data)
    expect(storage.deletes).toBe(0)
  })

  it('revalidates a legacy corrupt object only through the scoped reader and preserves frozen references', async () => {
    const f = await fixture()
    await db.mediaBlobObjects.update(f.row.id!, { storageState: 'corrupt' })
    const corrupt = (await db.mediaBlobObjects.get(f.row.id!))!
    const frozenReference = { blobObjectId: f.row.id!, ...f.expected }, wire = JSON.stringify(frozenReference)
    await expect(readVerifiedMediaBlobObjectData(corrupt)).rejects.toThrow('ready')
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(corrupt)
    expect(storage.readCalls).toBe(0)
    expect(await readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id!, expected: frozenReference })).toEqual(f.data)
    expect(await db.mediaBlobObjects.get(f.row.id!)).toMatchObject({ ...corrupt, storageState: 'ready',
      lastVerifiedAt: expect.any(Number), updatedAt: expect.any(Number) })
    expect(JSON.stringify(frozenReference)).toBe(wire)
    expect(storage.files.get(`/${f.row.opfsPath}`)).toEqual(f.data)
    expect(storage.deletes).toBe(0)
  })

  it('preserves actual product media bindings and the owning runtime/build during health recovery', async () => {
    const owner = await createCurrentTtrpgRuntimeTestBedV1({ title: '055 scoped reference owner' })
    const data = bytes('055 referenced physical bytes')
    const row = await putMediaBlobObject({ scope: owner.scope, data, mimeType: 'audio/ogg', backend: 'opfs' })
    const now = Date.now()
    const mediaAssetId = await db.productMediaAssets.add({
      projectId: owner.scope.projectId, worldId: owner.scope.worldId, workId: owner.scope.workId,
      ownerKind: 'runtime', productType: 'ttrpg', productReleaseId: null, productRuntimeSessionId: owner.session.id!,
      assetKey: '055.frozen.reference', version: 1, kind: 'sfx', name: '055 immutable binding fixture',
      mimeType: row.mimeType, byteSize: row.byteSize, width: null, height: null, durationMs: null,
      contentHash: row.contentHash, source: 'test', license: 'isolated fixture', altText: '',
      characterTag: '', sceneTag: '', createdAt: now, updatedAt: now,
    }) as number
    const bindingId = await db.productMediaBlobs.add({
      projectId: owner.scope.projectId, worldId: owner.scope.worldId, workId: owner.scope.workId,
      mediaAssetId, blobObjectId: row.id!, data: null, createdAt: now,
    }) as number
    const before = {
      asset: await db.productMediaAssets.get(mediaAssetId), binding: await db.productMediaBlobs.get(bindingId),
      session: await db.productRuntimeSessions.get(owner.session.id!), build: await db.productBuilds.get(owner.buildId),
    }
    await db.mediaBlobObjects.update(row.id!, { storageState: 'corrupt' })
    expect(await readMediaBlobObjectData({ scope: owner.scope, blobObjectId: row.id!, expected: row })).toEqual(data)
    expect(await db.productMediaAssets.get(mediaAssetId)).toEqual(before.asset)
    expect(await db.productMediaBlobs.get(bindingId)).toEqual(before.binding)
    expect(await db.productRuntimeSessions.get(owner.session.id!)).toEqual(before.session)
    expect(await db.productBuilds.get(owner.buildId)).toEqual(before.build)
    expect(storage.files.get(`/${row.opfsPath}`)).toEqual(data)
  })

  it('same-content put recovers an existing legacy corrupt object without replacing its bytes or identity', async () => {
    const f = await fixture()
    await db.mediaBlobObjects.update(f.row.id!, { storageState: 'corrupt' })
    const saved = await putMediaBlobObject({ scope: f.scope, data: f.data, mimeType: f.row.mimeType, backend: 'opfs' })
    expect(saved.id).toBe(f.row.id)
    expect(saved.storageState).toBe('ready')
    expect(await db.mediaBlobObjects.count()).toBe(1)
    expect(storage.files.get(`/${f.row.opfsPath}`)).toEqual(f.data)
  })

  it('recovers physically restored legacy OPFS bytes through the real Build Preview resolver', async () => {
    const { owner, selected, artifact, row } = await previewFixture('corrupt')
    const before = { artifact: await db.productBuildArtifacts.get(artifact.id!), build: await db.productBuilds.get(owner.buildId) }
    const resolver = await createBuildProductMediaResolver({ scope: owner.scope, productBuildId: owner.buildId, preview: owner.preview })
    try {
      expect(await (await resolver.read(selected.asset.assetKey)).arrayBuffer()).toEqual(selected.data)
      expect((await db.mediaBlobObjects.get(row.id!))!.storageState).toBe('ready')
      expect(await db.productBuildArtifacts.get(artifact.id!)).toEqual(before.artifact)
      expect(await db.productBuilds.get(owner.buildId)).toEqual(before.build)
      expect(storage.deletes).toBe(0)
    } finally {
      resolver.dispose()
      await vi.waitFor(async () => { expect((await db.mediaBlobObjects.get(row.id!))!.leaseOwner).toBeNull() })
    }
  })

  it('keeps overlapping real preview readers valid when the same Work renews its read lease', async () => {
    const { owner, selected, row } = await previewFixture('ready')
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let enterFirst!: () => void, enterBoth!: () => void, release!: () => void, reads = 0
    const firstEntered = new Promise<void>(resolve => { enterFirst = resolve })
    const bothEntered = new Promise<void>(resolve => { enterBoth = resolve })
    const hold = new Promise<void>(resolve => { release = resolve })
    storage.beforeRead = async () => {
      reads += 1
      if (reads === 1) enterFirst()
      if (reads === 2) enterBoth()
      await hold
    }
    const first = await createBuildProductMediaResolver({ scope: owner.scope, productBuildId: owner.buildId, preview: owner.preview })
    const firstRead = first.read(selected.asset.assetKey)
    await firstEntered
    now += 1
    const second = await createBuildProductMediaResolver({ scope: owner.scope, productBuildId: owner.buildId, preview: owner.preview })
    const secondRead = second.read(selected.asset.assetKey)
    await bothEntered
    release()
    try {
      const results = await Promise.allSettled([firstRead, secondRead])
      expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
      for (const result of results) {
        if (result.status !== 'fulfilled') throw result.reason
        expect(await result.value.arrayBuffer()).toEqual(selected.data)
      }
    } finally {
      first.dispose(); second.dispose()
      await vi.waitFor(async () => { expect((await db.mediaBlobObjects.get(row.id!))!.leaseOwner).toBeNull() })
    }
  })

  it.each(['ready', 'corrupt'] as const)('persistent IO failure stays bounded for %s and does not rewrite the original record', async storageState => {
    const f = await fixture()
    await db.mediaBlobObjects.update(f.row.id!, { storageState })
    const before = await db.mediaBlobObjects.get(f.row.id!)
    const failure = new DOMException('055 persistent IO failure', 'UnknownError')
    storage.fileFailure = failure
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toBe(failure)
    }
    expect(storage.readCalls).toBe(2)
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
    expect(storage.deletes).toBe(0)
  })

  it('keeps unavailable OPFS and hashing failures distinct from verified byte corruption', async () => {
    const f = await fixture(), before = await db.mediaBlobObjects.get(f.row.id!)
    const storageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage')!
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })
    await expect(readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toThrow('不支持 OPFS')
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
    Object.defineProperty(navigator, 'storage', storageDescriptor)
    const failure = new DOMException('055 hash service unavailable', 'OperationError')
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(failure)
    await expect(readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toBe(failure)
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
    expect(storage.files.get(`/${f.row.opfsPath}`)).toEqual(f.data)
    expect(storage.deletes).toBe(0)
  })

  it.each(['length', 'hash'] as const)('rejects confirmed %s corruption, preserves the bad file, and can revalidate after physical restoration', async kind => {
    const f = await fixture()
    const damaged = kind === 'length' ? bytes('short') : f.data.slice(0)
    if (kind === 'hash') new Uint8Array(damaged)[0] ^= 1
    storage.files.set(`/${f.row.opfsPath}`, damaged)
    await expect(readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toThrow(kind === 'length' ? '大小不匹配' : '哈希不匹配')
    expect((await db.mediaBlobObjects.get(f.row.id!))!.storageState).toBe('corrupt')
    expect(storage.files.get(`/${f.row.opfsPath}`)).toEqual(damaged)
    storage.files.set(`/${f.row.opfsPath}`, f.data)
    expect(await readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).toEqual(f.data)
    expect((await db.mediaBlobObjects.get(f.row.id!))!.storageState).toBe('ready')
    expect(storage.deletes).toBe(0)
  })

  it.each(['pending-write', 'pending-delete'] as const)('does not rewrite or revive %s', async storageState => {
    const f = await fixture()
    await db.mediaBlobObjects.update(f.row.id!, { storageState })
    const before = await db.mediaBlobObjects.get(f.row.id!)
    await expect(readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toThrow()
    await expect(acquireMediaBlobLease({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toThrow('不可租用')
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
    expect(storage.readCalls).toBe(0)
  })

  it.each([
    { disposition: 'pending-delete' as const },
    { deleteRequestedAt: 123 },
    { deleteReceiptHash: 'd'.repeat(64) },
  ])('does not recover a corrupt object with a retained deletion intent %j', async intent => {
    const f = await fixture()
    await db.mediaBlobObjects.update(f.row.id!, { storageState: 'corrupt', ...intent })
    const before = await db.mediaBlobObjects.get(f.row.id!)
    await expect(readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toThrow('正在删除')
    await expect(putMediaBlobObject({ scope: f.scope, data: f.data, mimeType: f.row.mimeType })).rejects.toThrow('正在删除')
    await expect(acquireMediaBlobLease({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toThrow('正在删除')
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
    expect(storage.readCalls).toBe(0)
    expect(storage.files.get(`/${f.row.opfsPath}`)).toEqual(f.data)
  })

  it.each(['temporary', 'hash', 'length'] as const)('does not lease unverifiable corrupt bytes after %s failure', async failureKind => {
    const f = await fixture()
    await db.mediaBlobObjects.update(f.row.id!, { storageState: 'corrupt' })
    const before = await db.mediaBlobObjects.get(f.row.id!)
    const unavailable = new DOMException('055 lease read unavailable', 'NotAllowedError')
    if (failureKind === 'temporary') storage.fileFailure = unavailable
    else {
      const damaged = failureKind === 'length' ? bytes('short') : f.data.slice(0)
      if (failureKind === 'hash') new Uint8Array(damaged)[0] ^= 1
      storage.files.set(`/${f.row.opfsPath}`, damaged)
    }
    const physicalBefore = storage.files.get(`/${f.row.opfsPath}`)!.slice(0)
    const leasing = acquireMediaBlobLease({ scope: f.scope, blobObjectId: f.row.id!, owner: '055 verified-only lease' })
    if (failureKind === 'temporary') await expect(leasing).rejects.toBe(unavailable)
    else await expect(leasing).rejects.toThrow(failureKind === 'length' ? '大小不匹配' : '哈希不匹配')
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
    expect(storage.readCalls).toBe(1)
    expect(storage.files.get(`/${f.row.opfsPath}`)).toEqual(physicalBefore)
    expect(storage.deletes).toBe(0)
  })

  it('does not revive or lease an unreferenced object actually collected during revalidation', async () => {
    const f = await fixture()
    await db.mediaBlobObjects.update(f.row.id!, { storageState: 'corrupt' })
    let entered!: () => void, release!: () => void
    const reading = new Promise<void>(resolve => { entered = resolve }), hold = new Promise<void>(resolve => { release = resolve })
    storage.beforeRead = async () => { entered(); await hold }
    const leasing = acquireMediaBlobLease({ scope: f.scope, blobObjectId: f.row.id!, owner: '055 competing GC' })
    await reading
    const gc = await collectUnreferencedMediaBlobObjects({ scope: f.scope })
    expect(gc.deleted).toContain(f.row.id!)
    release()
    await expect(leasing).rejects.toThrow()
    expect(await db.mediaBlobObjects.get(f.row.id!)).toBeUndefined()
    expect(storage.files.has(`/${f.row.opfsPath}`)).toBe(false)
    expect(storage.deletes).toBe(1)
  })

  it('rejects foreign owners and mismatched frozen metadata before touching the file', async () => {
    const f = await fixture()
    const other = await createWorkspace({ name: '055 other Work', genres: [], description: '', status: 'drafting', targetWordCount: 10_000 })
    const before = await db.mediaBlobObjects.get(f.row.id!)
    await expect(readMediaBlobObjectData({ scope: other.scope, blobObjectId: f.row.id! })).rejects.toThrow('跨 Work')
    await expect(readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id!, expected: { ...f.expected, contentHash: 'f'.repeat(64) } })).rejects.toThrow('元数据')
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
    expect(storage.readCalls).toBe(0)
  })

  const changes = ['delete-state', 'write-state', 'owner', 'hash', 'mime', 'size', 'backend', 'path', 'delete-receipt', 'version', 'width', 'height', 'deleted', 'deleted-work'] as const
  it.each((['ready', 'corrupt'] as const).flatMap(state => changes.map(change => ({ state, change }))))('rejects a stale $state physical result after $change changes during IO', async ({ state, change }) => {
    const f = await fixture()
    await db.mediaBlobObjects.update(f.row.id!, { storageState: state })
    let entered!: () => void, release!: () => void
    const reading = new Promise<void>(resolve => { entered = resolve }), hold = new Promise<void>(resolve => { release = resolve })
    storage.beforeRead = async () => { entered(); await hold }
    const pending = readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })
    await reading
    if (change === 'deleted') await db.mediaBlobObjects.delete(f.row.id!)
    else if (change === 'deleted-work') await db.works.delete(f.scope.workId)
    else {
      const patch: Partial<MediaBlobObjectRecordV1> = change === 'delete-state' ? { storageState: 'pending-delete' }
        : change === 'write-state' ? { storageState: 'pending-write' }
        : change === 'owner' ? { workId: f.scope.workId + 1000 }
        : change === 'mime' ? { mimeType: 'audio/wav' }
        : change === 'size' ? { byteSize: f.row.byteSize + 1 }
        : change === 'backend' ? { backend: 'indexeddb', data: f.data }
        : change === 'path' ? { opfsPath: `${f.row.opfsPath}-replaced` }
        : change === 'delete-receipt' ? { deleteReceiptHash: 'd'.repeat(64) }
        : change === 'version' ? {}
        : change === 'width' ? { width: 500, leaseOwner: '055 legal reader', leaseExpiresAt: Date.now() + 60_000 }
        : change === 'height' ? { height: 500, leaseOwner: '055 legal reader', leaseExpiresAt: Date.now() + 60_000 }
        : { contentHash: 'e'.repeat(64) }
      await db.mediaBlobObjects.update(f.row.id!, { ...patch, updatedAt: Date.now() + 1 })
    }
    const current = await db.mediaBlobObjects.get(f.row.id!)
    release()
    await expect(pending).rejects.toThrow()
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(current)
    expect(storage.deletes).toBe(0)
  })

  it('fixes scope and frozen metadata at call time before the first await', async () => {
    const f = await fixture(), other = await createWorkspace({ name: '055 changed request', genres: [], description: '', status: 'drafting', targetWordCount: 10_000 })
    const input = { scope: { ...f.scope }, blobObjectId: f.row.id!, expected: { ...f.expected } }
    const reading = readMediaBlobObjectData(input)
    Object.assign(input.scope, other.scope)
    input.blobObjectId += 1000
    input.expected.contentHash = 'e'.repeat(64)
    expect(await reading).toEqual(f.data)
  })

  it('fixes the lease target and release target before the first await', async () => {
    const first = await fixture(), other = await fixture()
    await db.mediaBlobObjects.update(first.row.id!, { storageState: 'corrupt' })
    const otherBefore = await db.mediaBlobObjects.get(other.row.id!)
    const input = { scope: { ...first.scope }, blobObjectId: first.row.id!, owner: '055 original lease owner' }
    const pending = acquireMediaBlobLease(input)
    Object.assign(input.scope, other.scope)
    input.blobObjectId = other.row.id!
    input.owner = '055 replacement lease owner'
    const lease = await pending
    expect(lease.blobObjectId).toBe(first.row.id)
    expect(lease.owner).toBe('055 original lease owner')
    expect(await db.mediaBlobObjects.get(first.row.id!)).toMatchObject({ storageState: 'ready', leaseOwner: lease.owner })
    expect(await db.mediaBlobObjects.get(other.row.id!)).toEqual(otherBefore)
    await lease.release()
    expect((await db.mediaBlobObjects.get(first.row.id!))!.leaseOwner).toBeNull()
    expect(await db.mediaBlobObjects.get(other.row.id!)).toEqual(otherBefore)
  })

  it('does not mark a replacement row corrupt after a stale physical verification failure', async () => {
    const f = await fixture(), damaged = f.data.slice(0)
    new Uint8Array(damaged)[0] ^= 1
    storage.files.set(`/${f.row.opfsPath}`, damaged)
    storage.beforeRead = async () => { await db.mediaBlobObjects.update(f.row.id!, { contentHash: 'b'.repeat(64), updatedAt: Date.now() + 1 }) }
    await expect(readMediaBlobObjectData({ scope: f.scope, blobObjectId: f.row.id! })).rejects.toThrow('读取期间已变化')
    expect(await db.mediaBlobObjects.get(f.row.id!)).toMatchObject({ storageState: 'ready', contentHash: 'b'.repeat(64) })
    expect(storage.files.get(`/${f.row.opfsPath}`)).toEqual(damaged)
    expect(storage.deletes).toBe(0)
  })

  it.each(['current', 'revoked'] as const)('revalidates a real unique-constraint race only under the %s original commitGuard', async authority => {
    const f = await fixture()
    await db.mediaBlobObjects.delete(f.row.id!)
    const lookup = db.mediaBlobObjects.where('[workId+contentHash]').equals([f.scope.workId, f.row.contentHash])
    const prototype = Object.getPrototypeOf(lookup) as typeof lookup
    const first = prototype.first
    // A real first query misses. Before its result is delivered, a competing
    // native IDB insert commits the legacy object; the following add must hit
    // the actual unique index rather than a synthetic ConstraintError.
    vi.spyOn(prototype, 'first').mockImplementationOnce(function (this: typeof lookup) {
      return first.call(this, found => found).then(async found => {
        expect(found).toBeUndefined()
        await db.mediaBlobObjects.add({ ...f.row, storageState: 'corrupt' })
        return found
      })
    })
    const add = db.mediaBlobObjects.add.bind(db.mediaBlobObjects), constraints: unknown[] = []
    vi.spyOn(db.mediaBlobObjects, 'add').mockImplementation((...args) => add(...args).catch(cause => {
      if (cause instanceof Error && cause.name === 'ConstraintError') constraints.push(cause)
      throw cause
    }))
    const originalGuard = vi.fn(async () => {
      if ((await db.works.get(f.scope.workId))?.title !== '055 isolated media owner') throw new Error('055 race guard revoked')
    })
    const guard: MediaBlobCommitGuardV1 = { transactionTables: [db.works], assertCurrentInTransaction: originalGuard }
    if (authority === 'revoked') storage.beforeRead = async () => { await db.works.update(f.scope.workId, { title: '055 revoked during physical revalidation' }) }
    const saving = putMediaBlobObject({ scope: f.scope, data: f.data, mimeType: f.row.mimeType, backend: 'opfs', commitGuard: guard })
    if (authority === 'revoked') await expect(saving).rejects.toThrow('055 race guard revoked')
    else expect(await saving).toMatchObject({ id: f.row.id, storageState: 'ready' })
    expect(constraints).toHaveLength(1)
    expect(originalGuard).toHaveBeenCalledTimes(2)
    expect((await db.mediaBlobObjects.get(f.row.id!))!.storageState).toBe(authority === 'revoked' ? 'corrupt' : 'ready')
    expect(await db.mediaBlobObjects.count()).toBe(1)
    expect(storage.readCalls).toBe(1)
    expect(storage.files.get(`/${f.row.opfsPath}`)).toEqual(f.data)
    expect(storage.deletes).toBe(0)
  })

  it('does not use physical recovery to bypass the existing put commitGuard', async () => {
    const f = await fixture()
    await db.mediaBlobObjects.update(f.row.id!, { storageState: 'corrupt' })
    await db.works.update(f.scope.workId, { title: '055 revoked author state' })
    const before = await db.mediaBlobObjects.get(f.row.id!)
    const guard: MediaBlobCommitGuardV1 = {
      transactionTables: [db.works],
      async assertCurrentInTransaction() {
        const work = await db.works.get(f.scope.workId)
        if (work?.title !== '055 isolated media owner') throw new Error('055 stale author guard')
      },
    }
    await expect(putMediaBlobObject({ scope: f.scope, data: f.data, mimeType: f.row.mimeType, commitGuard: guard })).rejects.toThrow('055 stale author guard')
    expect(await db.mediaBlobObjects.get(f.row.id!)).toEqual(before)
  })
})
