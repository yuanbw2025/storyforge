import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { cloneProductRuntimeMediaBindingV1, importProductRuntimeMediaAssetV1,
  prepareTextOpenWorldRuntimeMediaCloneV1, type PreparedTextOpenWorldRuntimeMediaCloneV1 } from '../../src/lib/product/runtime-media-library'
import * as blobStore from '../../src/lib/product-production/media-blob-store'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'
import { seedQuality005LegacyNovelV1, snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'
import { seedQuality005LegacyHybridV1 } from '../helpers/quality005-legacy-hybrid'
import { seedQuality005LegacyMediaBranchV1, seedQuality005LegacyMediaCloneV1 } from '../helpers/quality005-legacy-media-branch'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { branchProductRuntimeSession, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import * as previewSource from '../../src/lib/product-production/preview-source'
import * as workspaceScope from '../../src/lib/workspace/scope'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0))
const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')
const SOURCE_REQUIRED = /WorldRelease|世界.*封存|派生.*世界|来源.*只读/

async function worldSession() {
  const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
  const releaseId = await db.productReleases.add({
    projectId: f.scope.projectId, worldId: f.scope.worldId, workId: f.scope.workId,
    productionKey: f.creator.productionKey, productType: 'text-open-world', worldReleaseId: null,
    version: 1, label: 'Portable real World source', manifestJson: JSON.stringify(f.manifest),
    contentHash: await hashProductProductionValueV2(f.manifest), createdAt: Date.now(),
  }) as number
  const session = await createTextOpenWorldInstance({ scope: f.scope, productReleaseId: releaseId,
    title: 'World runtime media', seed: 'quality005-runtime-media' })
  return { ...f, releaseId, session }
}

async function worldBranch() {
  const f = await worldSession()
  const asset = await importProductRuntimeMediaAssetV1({ scope: f.scope, productRuntimeSessionId: f.session.id!,
    assetKey: '005.world-branch-media', kind: 'background', name: 'Original World image', blob: new Blob([PNG], { type: 'image/png' }) })
  const binding = (await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).first())!
  const base = await readProductRuntimeStateVersion(f.session.id!)
  const child = await branchProductRuntimeSession({ parentSessionId: f.session.id!, throughSequence: base.sequence,
    title: 'Normal World media branch', seed: '005-world-media-child' })
  return { ...f, base, child, input: { asset, binding, targetSessionId: child.id! } }
}

async function cloneWorld(f: Awaited<ReturnType<typeof worldBranch>>, preparedSource: PreparedTextOpenWorldRuntimeMediaCloneV1,
  input = f.input) {
  return db.transaction('rw', scopeTransactionTables(db.productRuntimeSessions, db.productMediaAssets,
    db.productMediaBlobs, db.mediaBlobObjects, ...preparedSource.transactionTables),
  () => cloneProductRuntimeMediaBindingV1({ ...input, preparedSource }))
}

describe('SFQA-005 · shared runtime media cannot authorize legacy novel work', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => {
    vi.restoreAllMocks()
    if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage)
    else delete (navigator as { storage?: unknown }).storage
  })
  afterAll(() => db.close())

  it('rejects a direct new Blob/Asset import for the actual old novel Session before writing bytes', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    await expect(importProductRuntimeMediaAssetV1({ scope: f.scope, productRuntimeSessionId: f.emptySessionId,
      assetKey: '005.new-runtime-image', kind: 'background', name: 'New legacy image', blob: new Blob([PNG], { type: 'image/png' }) }))
      .rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('imports a true World image and reads its exact existing Asset without creating another version', async () => {
    const f = await worldSession()
    const input = { scope: f.scope, productRuntimeSessionId: f.session.id!, assetKey: '005.world-runtime-image',
      kind: 'background' as const, name: 'World image', blob: new Blob([PNG], { type: 'image/png' }) }
    const first = await importProductRuntimeMediaAssetV1(input)
    const before = await snapshotQuality005RowsV1()
    expect(await importProductRuntimeMediaAssetV1(input)).toEqual(first)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  }, 30_000)

  it.each([false, true])('returns the fully exact native pre-policy Asset without new authority, missingRelease=%s', async missingRelease => {
    const f = await seedQuality005LegacyHybridV1(), old = f.cases.find(row => row.mode === 'media')!
    const asset = old.asset!, input = { scope: f.scope, productRuntimeSessionId: asset.productRuntimeSessionId!,
      assetKey: asset.assetKey, kind: asset.kind, name: asset.name, blob: new Blob([PNG], { type: asset.mimeType }),
      altText: asset.altText, source: asset.source, license: asset.license, width: asset.width, height: asset.height,
      durationMs: asset.durationMs, characterTag: asset.characterTag, sceneTag: asset.sceneTag }
    if (missingRelease) await db.productReleases.delete(f.releaseId)
    const before = await snapshotQuality005RowsV1()
    expect(await importProductRuntimeMediaAssetV1(input)).toEqual(asset)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await expect(importProductRuntimeMediaAssetV1({ ...input, blob: new Blob(['different new bytes'], { type: 'image/png' }) }))
      .rejects.toThrow(missingRelease ? /Product Release 已不存在/ : SOURCE_REQUIRED)
    await expect(importProductRuntimeMediaAssetV1({ ...input, name: 'Different metadata must not gain a new import permission' }))
      .rejects.toThrow(missingRelease ? /Product Release 已不存在/ : SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it.each(['foreign-scope', 'binding-owner', 'physical-bytes'] as const)('does not turn %s into a historical media read permission', async mutation => {
    const f = await seedQuality005LegacyHybridV1(), asset = f.cases.find(row => row.mode === 'media')!.asset!
    const input = { scope: { ...f.scope }, productRuntimeSessionId: asset.productRuntimeSessionId!, assetKey: asset.assetKey,
      kind: asset.kind, name: asset.name, blob: new Blob([PNG], { type: asset.mimeType }), altText: asset.altText,
      source: asset.source, license: asset.license, width: asset.width, height: asset.height, durationMs: asset.durationMs,
      characterTag: asset.characterTag, sceneTag: asset.sceneTag }
    await db.productReleases.delete(f.releaseId)
    const binding = (await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).first())!
    if (mutation === 'foreign-scope') input.scope.workId += 1000
    else if (mutation === 'binding-owner') await db.productMediaBlobs.update(binding.id!, { workId: f.scope.workId + 1000 })
    else await db.mediaBlobObjects.update(binding.blobObjectId, { data: new Uint8Array(PNG.length).buffer })
    const before = await snapshotQuality005RowsV1()
    await expect(importProductRuntimeMediaAssetV1(input)).rejects.toThrow()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects a new cloned Asset/Binding even for an actually valid old native novel child Session', async () => {
    const f = await seedQuality005LegacyMediaBranchV1()
    const asset = (await db.productMediaAssets.get(f.assetId))!
    const binding = (await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).first())!
    const before = await snapshotQuality005RowsV1()
    await expect(db.transaction('rw', scopeTransactionTables(db.productRuntimeSessions, db.productMediaAssets,
      db.productMediaBlobs, db.mediaBlobObjects, db.productReleases, db.productBuilds, db.productProductions, db.productProductionBriefs),
    () => cloneProductRuntimeMediaBindingV1({ asset, binding, targetSessionId: f.child.id }))).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await expect(prepareTextOpenWorldRuntimeMediaCloneV1({ asset, binding, targetSessionId: f.child.id }))
      .rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('keeps a real World branch able to copy its original scoped immutable media binding', async () => {
    const f = await worldBranch(), prepared = await prepareTextOpenWorldRuntimeMediaCloneV1(f.input)
    const physicalCount = await db.mediaBlobObjects.count()
    await cloneWorld(f, prepared)
    const cloned = (await db.productMediaAssets.where('productRuntimeSessionId').equals(f.child.id!).first())!
    expect(cloned.contentHash).toBe(f.input.asset.contentHash)
    expect((await db.productMediaBlobs.where('mediaAssetId').equals(cloned.id!).first())?.blobObjectId).toBe(f.input.binding.blobObjectId)
    expect(await db.mediaBlobObjects.count()).toBe(physicalCount)
    const before = await snapshotQuality005RowsV1()
    await cloneWorld(f, prepared)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    // Already committed exact rows are evidence reads, even if their Release
    // has disappeared. They do not reconstruct it or grant a new media slot.
    await db.productReleases.delete(f.releaseId)
    const withoutRelease = await snapshotQuality005RowsV1()
    await db.transaction('rw', scopeTransactionTables(db.productRuntimeSessions, db.productMediaAssets,
      db.productMediaBlobs, db.mediaBlobObjects), () => cloneProductRuntimeMediaBindingV1(f.input))
    expect(await snapshotQuality005RowsV1()).toEqual(withoutRelease)
  }, 30_000)

  it('returns an exact actually cloned pre-policy legacy slot without requiring or minting new source permission', async () => {
    const f = await seedQuality005LegacyMediaCloneV1()
    const asset = (await db.productMediaAssets.get(f.assetId))!
    const binding = (await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).first())!
    const before = await snapshotQuality005RowsV1()
    await db.transaction('rw', scopeTransactionTables(db.productRuntimeSessions, db.productMediaAssets,
      db.productMediaBlobs, db.mediaBlobObjects), () => cloneProductRuntimeMediaBindingV1({ asset, binding, targetSessionId: f.child.id }))
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    expect((await db.productMediaAssets.get(f.clonedAssets[0].id!))!).toEqual(f.clonedAssets[0])
  })

  it('does not treat a public table declaration or an equal replacement object as source permission', async () => {
    const f = await worldBranch(), prepared = await prepareTextOpenWorldRuntimeMediaCloneV1(f.input)
    const before = await snapshotQuality005RowsV1()
    const forged = { transactionTables: prepared.transactionTables } as PreparedTextOpenWorldRuntimeMediaCloneV1
    await expect(cloneWorld(f, forged)).rejects.toThrow(SOURCE_REQUIRED)
    await expect(cloneWorld(f, prepared, { ...f.input, binding: structuredClone(f.input.binding) })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  }, 30_000)

  it.each(['asset-owner', 'binding-bytes'] as const)('never writes caller %s mutations observed after the real scope check resolved', async mutation => {
    const f = await worldBranch(), prepared = await prepareTextOpenWorldRuntimeMediaCloneV1(f.input)
    const assetBefore = structuredClone(f.input.asset), bindingBefore = structuredClone(f.input.binding)
    const actualResolve = workspaceScope.resolveScope
    let injected = 0
    vi.spyOn(workspaceScope, 'resolveScope').mockImplementation(input => {
      const actual = actualResolve(input)
      // Return the exact original Dexie-aware Promise. This observer changes
      // only caller memory, adding no transaction or premature-commit shim.
      void actual.then(() => {
        if (!injected) {
          if (mutation === 'asset-owner') f.input.asset.workId = f.scope.workId + 1000
          else Object.assign(f.input.binding, { data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer })
          injected += 1
        }
      })
      return actual
    })
    await cloneWorld(f, prepared)
    expect(injected).toBe(1)
    const cloned = (await db.productMediaAssets.where('productRuntimeSessionId').equals(f.child.id!).first())!
    const binding = (await db.productMediaBlobs.where('mediaAssetId').equals(cloned.id!).first())!
    expect(cloned.workId).toBe(assetBefore.workId)
    expect(binding.data).toEqual(bindingBefore.data)
    expect(binding.blobObjectId).toBe(bindingBefore.blobObjectId)
    expect(await db.productMediaAssets.get(assetBefore.id!)).toEqual(assetBefore)
    expect(await db.productMediaBlobs.get(bindingBefore.id!)).toEqual(bindingBefore)
  }, 30_000)

  it('cannot reuse preparation after mutating the captured Asset or to another valid child Session', async () => {
    const f = await worldBranch(), prepared = await prepareTextOpenWorldRuntimeMediaCloneV1(f.input)
    const otherChild = await branchProductRuntimeSession({ parentSessionId: f.session.id!, throughSequence: f.base.sequence,
      title: 'Other valid World child', seed: '005-other-media-child' })
    const before = await snapshotQuality005RowsV1()
    await expect(cloneWorld(f, prepared, { ...f.input, targetSessionId: otherChild.id! })).rejects.toThrow(SOURCE_REQUIRED)
    f.input.asset.name = 'Changed after source preparation'
    await expect(cloneWorld(f, prepared)).rejects.toThrow(/原版本|原绑定|owner/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  }, 30_000)

  it('requires the actual native source stores and performs the final immutable Release CAS before adding media', async () => {
    const f = await worldBranch(), prepared = await prepareTextOpenWorldRuntimeMediaCloneV1(f.input)
    const before = await snapshotQuality005RowsV1()
    await expect(db.transaction('rw', scopeTransactionTables(db.productRuntimeSessions, db.productMediaAssets,
      db.productMediaBlobs, db.mediaBlobObjects), () => cloneProductRuntimeMediaBindingV1({ ...f.input, preparedSource: prepared })))
      .rejects.toThrow(/not part|not.*transaction|NotFoundError/i)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await db.productReleases.update(f.releaseId, { contentHash: '0'.repeat(64) })
    const changed = await snapshotQuality005RowsV1()
    await expect(cloneWorld(f, prepared)).rejects.toThrow(/Release.*变化/)
    expect(await snapshotQuality005RowsV1()).toEqual(changed)
  }, 30_000)

  it('does not prepare new clone permission from a different Release row captured after the real verifier returned', async () => {
    const f = await worldBranch(), actualSource = previewSource.verifyProductRuntimeSessionSourceV1
    const beforeAssets = await db.productMediaAssets.toArray(), beforeBindings = await db.productMediaBlobs.toArray()
    let injected = 0
    vi.spyOn(previewSource, 'verifyProductRuntimeSessionSourceV1').mockImplementation(async input => {
      const result = await actualSource(input)
      if (!injected) { await db.productReleases.update(f.releaseId, { manifestJson: '{}' }); injected += 1 }
      return result
    })
    const outcome = await prepareTextOpenWorldRuntimeMediaCloneV1(f.input)
      .then(() => ({ ok: true, error: '' }), (error: unknown) => ({ ok: false, error: String(error) }))
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/Release.*变化/)
    expect(injected).toBe(1)
    expect(await db.productMediaAssets.toArray()).toEqual(beforeAssets)
    expect(await db.productMediaBlobs.toArray()).toEqual(beforeBindings)
    expect((await db.productReleases.get(f.releaseId))!.manifestJson).toBe('{}')
  }, 30_000)

  it('keeps the Asset and Binding atomic with the caller transaction and forbids preparing inside it', async () => {
    const f = await worldBranch(), prepared = await prepareTextOpenWorldRuntimeMediaCloneV1(f.input)
    const before = await snapshotQuality005RowsV1()
    await expect(db.transaction('rw', scopeTransactionTables(db.productRuntimeSessions, db.productMediaAssets,
      db.productMediaBlobs, db.mediaBlobObjects, ...prepared.transactionTables), async () => {
      await cloneProductRuntimeMediaBindingV1({ ...f.input, preparedSource: prepared })
      throw new Error('005 rollback after both original clone writes')
    })).rejects.toThrow('005 rollback')
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await expect(db.transaction('rw', scopeTransactionTables(db.productRuntimeSessions),
      () => prepareTextOpenWorldRuntimeMediaCloneV1(f.input))).rejects.toThrow(/事务外/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await cloneWorld(f, prepared)
    expect(await db.productMediaAssets.where('productRuntimeSessionId').equals(f.child.id!).count()).toBe(1)
  }, 30_000)

  it('checks the captured real Release again at the Blob transaction after asynchronous preparation', async () => {
    const f = await worldSession()
    const release = (await db.productReleases.get(f.releaseId))!
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => {
      await db.productReleases.update(release.id!, { contentHash: '0'.repeat(64) })
      return { quota: 1_000_000, usage: 0 }
    } } })
    const beforeBlobs = await db.mediaBlobObjects.count()
    const beforeAssets = await db.productMediaAssets.count()
    await expect(importProductRuntimeMediaAssetV1({ scope: f.scope, productRuntimeSessionId: f.session.id!,
      assetKey: '005.stale-runtime-image', kind: 'background', name: 'Must not bind stale source', blob: new Blob([PNG], { type: 'image/png' }) }))
      .rejects.toThrow(/变化|不一致|失效/)
    expect(await db.mediaBlobObjects.count()).toBe(beforeBlobs)
    expect(await db.productMediaAssets.count()).toBe(beforeAssets)
    expect((await db.productReleases.get(release.id!))!.contentHash).toBe('0'.repeat(64))
  }, 30_000)

  it('does not bind an Asset if authority changes after bytes were retained by the original Blob writer', async () => {
    const f = await worldSession()
    const originalPut = blobStore.putMediaBlobObject
    vi.spyOn(blobStore, 'putMediaBlobObject').mockImplementation(async input => {
      const result = await originalPut(input)
      await db.productReleases.update(f.releaseId, { contentHash: '0'.repeat(64) })
      return result
    })
    const beforeAssets = await db.productMediaAssets.count()
    const beforeBlobs = await db.mediaBlobObjects.count()
    await expect(importProductRuntimeMediaAssetV1({ scope: f.scope, productRuntimeSessionId: f.session.id!,
      assetKey: '005.late-stale-runtime-image', kind: 'background', name: 'Retain bytes without formal binding',
      blob: new Blob([PNG], { type: 'image/png' }) })).rejects.toThrow(/变化|不一致|失效/)
    expect(await db.productMediaAssets.count()).toBe(beforeAssets)
    expect(await db.mediaBlobObjects.count()).toBe(beforeBlobs + 1)
    const stored = await db.mediaBlobObjects.toArray()
    const retained = stored[stored.length - 1]!
    expect(await blobStore.readMediaBlobObjectData({ scope: f.scope, blobObjectId: retained.id! })).toEqual(PNG.buffer)
    // This proves retention at this write boundary, not immunity from the
    // existing collector for subsequently unreferenced physical objects.
  }, 30_000)
})
