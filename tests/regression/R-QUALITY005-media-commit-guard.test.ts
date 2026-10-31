import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  putMediaBlobObject, readMediaBlobObjectData,
  type MediaBlobCommitGuardV1,
} from '../../src/lib/product-production/media-blob-store'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { seedCurrentProject } from '../helpers/current-workspace'
import * as workspaceScope from '../../src/lib/workspace/scope'

const bytes = () => new TextEncoder().encode('isolated author-owned media bytes').buffer
const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')

async function fixture() {
  const now = Date.now()
  const projectId = await seedCurrentProject({ name: '005 media authority', description: '', genres: [],
    status: 'drafting', targetWordCount: 1, createdAt: now, updatedAt: now } as never) as number
  const { scope } = await resolveWorkspaceOwnership(projectId)
  const expected = (await db.works.get(scope.workId))!.updatedAt
  const guard: MediaBlobCommitGuardV1 = {
    transactionTables: [db.works],
    assertCurrentInTransaction: async () => {
      if ((await db.works.get(scope.workId))?.updatedAt !== expected) throw new Error('source authority changed')
    },
  }
  const change = () => db.works.update(scope.workId, { updatedAt: expected + 1 })
  return { scope, guard, change }
}

function storage(input: { estimate?: () => Promise<unknown>; close?: () => Promise<unknown> } = {}) {
  const files = new Map<string, ArrayBuffer>()
  const directory = (prefix: string): FileSystemDirectoryHandle => ({
    async getDirectoryHandle(name: string) { return directory(`${prefix}/${name}`) },
    async getFileHandle(name: string) {
      const path = `${prefix}/${name}`
      return {
        async createWritable() {
          return {
            async write(data: ArrayBuffer) { files.set(path, data.slice(0)) },
            async close() { await input.close?.() },
            async abort() {},
          }
        },
        async getFile() {
          const data = files.get(path)
          if (!data) throw new Error('isolated OPFS file missing')
          return new Blob([data])
        },
      }
    },
    async removeEntry(name: string) { files.delete(`${prefix}/${name}`) },
  }) as unknown as FileSystemDirectoryHandle
  Object.defineProperty(navigator, 'storage', { configurable: true, value: {
    estimate: input.estimate ?? (async () => ({ quota: 1_000_000, usage: 0 })),
    getDirectory: async () => directory(''),
  } })
  return files
}

describe('SFQA-005 · shared Blob commit guard is an in-memory atomic seam', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => {
    vi.restoreAllMocks()
    if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage)
    else delete (navigator as { storage?: unknown }).storage
  })
  afterAll(() => db.close())

  it.each(['indexeddb', 'opfs'] as const)('rejects an authority change before %s add with no new object or file', async backend => {
    const f = await fixture()
    const files = storage({ estimate: async () => { await f.change(); return { quota: 1_000_000, usage: 0 } } })
    await expect(putMediaBlobObject({ scope: f.scope, data: bytes(), mimeType: 'audio/ogg', backend,
      commitGuard: f.guard })).rejects.toThrow('source authority changed')
    expect(await db.mediaBlobObjects.count()).toBe(0)
    expect(files.size).toBe(0)
  })

  it('keeps the OPFS journal and exact bytes when authority changes before ready, without accepting an Artifact', async () => {
    const f = await fixture()
    const files = storage({ close: f.change })
    await expect(putMediaBlobObject({ scope: f.scope, data: bytes(), mimeType: 'audio/ogg', backend: 'opfs',
      commitGuard: f.guard })).rejects.toThrow('source authority changed')
    const row = (await db.mediaBlobObjects.toArray())[0]
    expect(row).toMatchObject({ backend: 'opfs', storageState: 'corrupt', data: null })
    expect(files.get(`/${row.opfsPath}`)).toEqual(bytes())
    expect(await db.productBuildArtifacts.count()).toBe(0)
  })

  it.each(['indexeddb', 'opfs'] as const)('retains same-scope %s storage and dedup under a current guard', async backend => {
    const f = await fixture(); storage()
    const row = await putMediaBlobObject({ scope: f.scope, data: bytes(), mimeType: 'audio/ogg', backend, commitGuard: f.guard })
    const repeated = await putMediaBlobObject({ scope: f.scope, data: bytes(), mimeType: 'audio/ogg', backend, commitGuard: f.guard })
    expect(repeated.id).toBe(row.id)
    expect(await db.mediaBlobObjects.count()).toBe(1)
    expect(await readMediaBlobObjectData({ scope: f.scope, blobObjectId: row.id! })).toEqual(bytes())
  })

  it('does not convert a guard ConstraintError to dedup success or change an existing shared object', async () => {
    const f = await fixture(); storage()
    const row = await putMediaBlobObject({ scope: f.scope, data: bytes(), mimeType: 'audio/ogg' })
    const before = await db.mediaBlobObjects.toArray()
    const denied: MediaBlobCommitGuardV1 = { transactionTables: [db.works], assertCurrentInTransaction: async () => {
      throw new DOMException('explicit guard rejection', 'ConstraintError')
    } }
    await expect(putMediaBlobObject({ scope: f.scope, data: bytes(), mimeType: 'audio/ogg', commitGuard: denied }))
      .rejects.toThrow('explicit guard rejection')
    await expect(putMediaBlobObject({ scope: f.scope, data: new TextEncoder().encode('new bytes').buffer,
      mimeType: 'audio/ogg', commitGuard: denied })).rejects.toThrow('explicit guard rejection')
    expect(await db.mediaBlobObjects.toArray()).toEqual(before)
    expect(await readMediaBlobObjectData({ scope: f.scope, blobObjectId: row.id! })).toEqual(bytes())
  })

  it('preserves a real unique-key race as exact dedup under the current guard', async () => {
    const f = await fixture(); storage()
    const rows = await Promise.all([1, 2].map(() => putMediaBlobObject({ scope: f.scope, data: bytes(),
      mimeType: 'audio/ogg', backend: 'indexeddb', commitGuard: f.guard })))
    expect(rows[0].id).toBe(rows[1].id)
    expect(await db.mediaBlobObjects.count()).toBe(1)
  })

  it('leaves a generic no-guard caller independent of the OW admission rule', async () => {
    const f = await fixture(); storage(); await f.change()
    const row = await putMediaBlobObject({ scope: f.scope, data: bytes(), mimeType: 'audio/ogg' })
    expect(row.storageState).toBe('ready')
    expect(await readMediaBlobObjectData({ scope: f.scope, blobObjectId: row.id! })).toEqual(bytes())
  })

  it.each(['indexeddb', 'opfs'] as const)('fixes the call-time %s scope, bytes and original guard callback before resolveScope yields', async backend => {
    const f = await fixture(), other = await fixture(); storage()
    const expectedScope = structuredClone(f.scope), expectedData = bytes()
    const originalGuard = vi.fn(f.guard.assertCurrentInTransaction)
    const replacementGuard = vi.fn(() => db.works.get(other.scope.workId).then(() => undefined))
    f.guard.assertCurrentInTransaction = originalGuard
    const input = { scope: { ...f.scope }, data: expectedData.slice(0), mimeType: 'audio/ogg', backend,
      commitGuard: f.guard }
    const actualResolve = workspaceScope.resolveScope
    let injected = 0
    vi.spyOn(workspaceScope, 'resolveScope').mockImplementation(request => {
      const actual = actualResolve(request)
      void actual.then(() => {
        if (!injected) {
          Object.assign(input.scope, other.scope)
          input.data = new TextEncoder().encode('changed after the call-time source check').buffer
          input.commitGuard.assertCurrentInTransaction = replacementGuard
          injected += 1
        }
      })
      return actual
    })
    const row = await putMediaBlobObject(input)
    expect(injected).toBe(1)
    expect({ projectId: row.projectId, worldId: row.worldId, workId: row.workId }).toEqual(expectedScope)
    expect(await readMediaBlobObjectData({ scope: expectedScope, blobObjectId: row.id! })).toEqual(expectedData)
    expect(originalGuard).toHaveBeenCalledTimes(backend === 'opfs' ? 2 : 1)
    expect(replacementGuard).not.toHaveBeenCalled()
    expect(await db.productBuildArtifacts.count()).toBe(0)
  })
})
