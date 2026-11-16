import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { importProductRuntimeMediaAssetV1 } from '../../src/lib/product/runtime-media-library'
import * as blobs from '../../src/lib/product-production/media-blob-store'
import * as mediaHashes from '../../src/lib/media/blob-store'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from '../helpers/current-product-world'
import { createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { audioWavFixtureV1 } from '../helpers/open-audio-runtime'

type ImportInput = Parameters<typeof importProductRuntimeMediaAssetV1>[0]

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function fixture() {
  const seededWorld = await seedCurrentProductWorld('SFQA056 isolated runtime media')
  if (typeof seededWorld.release.id !== 'number') throw new Error('The actual frozen WorldRelease was not created')
  const world = { ...seededWorld, release: { ...seededWorld.release, id: seededWorld.release.id } }
  const catalog = await loadCurrentProductWorldSourceCatalogV1({ scope: world.scope,
    worldReleaseId: world.release.id, productType: 'avg' })
  const runtimePackage = createCurrentRuntimePackageFixture({ productType: 'avg', worldRelease: world.release, sourceCatalog: catalog })
  const build = await seedCurrentProductBuild({ scope: world.scope, worldRelease: world.release,
    runtimePackage, title: 'SFQA056 current Build media' })
  const input: ImportInput = { scope: world.scope, productRuntimeSessionId: build.session.id!,
    assetKey: 'sfqa056.original', kind: 'voice', name: 'Synthetic WAV; not adopted',
    blob: audioWavFixtureV1(), durationMs: 250, source: 'synthetic current-runtime fixture', license: 'fixture only' }
  return { world, build, input }
}

async function changedWav(blob: Blob) {
  const bytes = await blob.arrayBuffer()
  new DataView(bytes).setInt16(bytes.byteLength - 2, 1, true)
  return new Blob([bytes], { type: blob.type })
}

function holdBothPreparedObjects() {
  const put = blobs.putMediaBlobObject
  let count = 0, release!: () => void, prepared!: () => void, failed!: (cause: unknown) => void
  const released = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>((resolve, reject) => { prepared = resolve; failed = reject })
  vi.spyOn(blobs, 'putMediaBlobObject').mockImplementation(async (...args: Parameters<typeof put>) => {
    try {
      // The actual public physical writer has completed before its return is
      // held. No IndexedDB add/transaction is suspended across another writer.
      const object = await put(...args)
      if (++count === 2) prepared()
      await released
      return object
    } catch (cause) { failed(cause); release(); throw cause }
  })
  return { ready, release }
}

it.each(['same', 'different'] as const)('no refs: concurrent %s bytes commit valid unique versions through the public writer', async mode => {
  const f = await fixture(), other = mode === 'same' ? f.input.blob : await changedWav(f.input.blob)
  const barrier = holdBothPreparedObjects()
  const pending = Promise.allSettled([importProductRuntimeMediaAssetV1(f.input),
    importProductRuntimeMediaAssetV1({ ...f.input, blob: other })])
  try { await barrier.ready } finally { barrier.release() }
  const results = await pending
  const rows = await db.productMediaAssets.where('productRuntimeSessionId').equals(f.input.productRuntimeSessionId).toArray()
  console.info('SFQA056_PUBLIC_CONCURRENCY', JSON.stringify({ mode,
    statuses: results.map(result => result.status),
    failures: results.flatMap(result => result.status === 'rejected' ? [{ name: result.reason?.name, message: result.reason?.message }] : []),
    versions: rows.map(row => row.version), assetCount: rows.length }))
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
  const assets = results.map(result => { if (result.status !== 'fulfilled') throw result.reason; return result.value })
  expect(assets.map(asset => asset.version).sort()).toEqual(mode === 'same' ? [1, 1] : [1, 2])
  expect(rows).toHaveLength(mode === 'same' ? 1 : 2)
  if (mode === 'same') expect(assets[0].id).toBe(assets[1].id)
  for (const row of rows) {
    const bindings = await db.productMediaBlobs.where('mediaAssetId').equals(row.id!).toArray()
    expect(bindings).toHaveLength(1)
    const object = await db.mediaBlobObjects.get(bindings[0].blobObjectId)
    if (!object) throw new Error('Actual imported object is missing')
    expect([object.projectId, object.worldId, object.workId, object.contentHash])
      .toEqual([f.input.scope.projectId, f.input.scope.worldId, f.input.scope.workId, row.contentHash])
    expect((await blobs.readVerifiedMediaBlobObjectData(object)).byteLength).toBe(row.byteSize)
  }
})

async function withEvidence(f: Awaited<ReturnType<typeof fixture>>, enabled: boolean): Promise<ImportInput> {
  if (!enabled) return f.input
  const run = await createAgentRunV1({ scope: f.input.scope, contract: {
    version: 1, objective: 'Synthetic runtime media concurrency evidence', workflowKind: 'read-only-audit',
    runtimeBindingHash: 'b'.repeat(64), scope: { projectId: f.input.scope.projectId, worldGroupId: null },
    permissions: { contextSourceKeys: ['chapterContent'], writeTargets: [] },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1000, maxOutputTokens: 100, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'original', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'sfqa056-fixture', criterionIds: ['original'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  const saved = await recordAgentRunArtifactV1({ scope: f.input.scope, runId: run.run.id,
    artifactKind: 'raw-response', content: 'Synthetic immutable source; not a generated-media or adoption grant.' })
  return { ...f.input, exactArtifactRefs: [{ artifactKind: saved.artifact.artifactKind, contentHash: saved.artifact.contentHash }] }
}

it.each(['same', 'different'] as const)('exact refs: concurrent %s bytes preserve the same immutable evidence', async mode => {
  const f = await fixture(), input = await withEvidence(f, true)
  const other = mode === 'same' ? input.blob : await changedWav(input.blob)
  const assets = await Promise.all([importProductRuntimeMediaAssetV1(input),
    importProductRuntimeMediaAssetV1({ ...input, blob: other })])
  expect(assets.map(asset => asset.version).sort()).toEqual(mode === 'same' ? [1, 1] : [1, 2])
  if (mode === 'same') expect(assets[0].id).toBe(assets[1].id)
  for (const asset of assets) expect(JSON.parse(asset.exactArtifactRefsJson ?? 'null')).toEqual(input.exactArtifactRefs)
  expect(await db.productMediaAssets.where('productRuntimeSessionId').equals(input.productRuntimeSessionId).count())
    .toBe(mode === 'same' ? 1 : 2)
})

it.each([false, true])('forceLatest reuses the actual matching latest version; exact refs=%s', async exact => {
  const f = await fixture(), input = await withEvidence(f, exact)
  const first = await importProductRuntimeMediaAssetV1(input)
  const second = await importProductRuntimeMediaAssetV1({ ...input, blob: await changedWav(input.blob) })
  expect([first.version, second.version]).toEqual([1, 2])
  const latestInput = { ...input, forceLatest: true }
  const barrier = exact ? null : holdBothPreparedObjects()
  const pending = Promise.all([importProductRuntimeMediaAssetV1(latestInput), importProductRuntimeMediaAssetV1(latestInput)])
  if (barrier) { try { await barrier.ready } finally { barrier.release() } }
  const [latest, concurrent] = await pending
  expect([latest.version, concurrent.version]).toEqual([3, 3])
  expect(concurrent.id).toBe(latest.id)
  expect((await importProductRuntimeMediaAssetV1(latestInput)).id).toBe(latest.id)
  // An ordinary import still reuses its historical version rather than
  // changing an existing caller into a request to replace the latest one.
  expect((await importProductRuntimeMediaAssetV1(input)).id).toBe(first.id)
  expect((await db.productMediaAssets.where('productRuntimeSessionId').equals(input.productRuntimeSessionId).toArray())
    .map(asset => asset.version)).toEqual([1, 2, 3])
})

it.each([false, true])('rechecks archive before acknowledging an existing duplicate; exact refs=%s', async exact => {
  const f = await fixture(), input = await withEvidence(f, exact)
  await importProductRuntimeMediaAssetV1(input)
  const assets = await db.productMediaAssets.toArray(), bindings = await db.productMediaBlobs.toArray()
  const hash = mediaHashes.sha256BinaryV1
  let archived = 0
  vi.spyOn(mediaHashes, 'sha256BinaryV1').mockImplementationOnce(async (...args) => {
    const result = await hash(...args)
    // Real persisted independent actor after the writer captured its active
    // session, while only external hash preparation is outstanding.
    archived = await db.productRuntimeSessions.update(input.productRuntimeSessionId, { status: 'archived' })
    return result
  })
  await expect(importProductRuntimeMediaAssetV1(input)).rejects.toThrow(/失效|归档/)
  expect(archived).toBe(1)
  expect((await db.productRuntimeSessions.get(input.productRuntimeSessionId))?.status).toBe('archived')
  expect(await db.productMediaAssets.toArray()).toEqual(assets)
  expect(await db.productMediaBlobs.toArray()).toEqual(bindings)
})

it('mixed refs and no-refs concurrent imports use the same actual native version sequence', async () => {
  const f = await fixture(), exact = await withEvidence(f, true)
  const barrier = holdBothPreparedObjects()
  const pending = Promise.all([importProductRuntimeMediaAssetV1(exact),
    importProductRuntimeMediaAssetV1({ ...f.input, blob: await changedWav(f.input.blob) })])
  try { await barrier.ready } finally { barrier.release() }
  const [original, manual] = await pending
  expect([original.version, manual.version].sort()).toEqual([1, 2])
  expect(JSON.parse(original.exactArtifactRefsJson ?? 'null')).toEqual(exact.exactArtifactRefs)
  expect(manual).not.toHaveProperty('exactArtifactRefsJson')
  expect(await db.productMediaAssets.count()).toBe(2)
  expect(await db.productMediaBlobs.count()).toBe(2)
})

it('same key and bytes in distinct real runtime sessions keep distinct owners and bindings', async () => {
  const f = await fixture()
  const runtimePackage = createCurrentRuntimePackageFixture({ productType: 'avg', worldRelease: f.world.release,
    sourceCatalog: await loadCurrentProductWorldSourceCatalogV1({ scope: f.world.scope,
      worldReleaseId: f.world.release.id, productType: 'avg' }) })
  const other = await seedCurrentProductBuild({ scope: f.world.scope, worldRelease: f.world.release,
    runtimePackage, title: 'SFQA056 separate runtime owner' })
  const [left, right] = await Promise.all([importProductRuntimeMediaAssetV1(f.input),
    importProductRuntimeMediaAssetV1({ ...f.input, productRuntimeSessionId: other.session.id! })])
  expect(left.id).not.toBe(right.id)
  expect([left.version, right.version]).toEqual([1, 1])
  expect([left.productRuntimeSessionId, right.productRuntimeSessionId])
    .toEqual([f.input.productRuntimeSessionId, other.session.id])
  expect((await db.productMediaBlobs.where('mediaAssetId').equals(left.id!).toArray())).toHaveLength(1)
  expect((await db.productMediaBlobs.where('mediaAssetId').equals(right.id!).toArray())).toHaveLength(1)
})

it('a real binding failure rolls back the metadata and never acknowledges adoption success', async () => {
  const f = await fixture(), events = await db.agentRunEvents.toArray()
  const failure = new Error('SFQA056 actual binding failure')
  vi.spyOn(db.productMediaBlobs, 'add').mockImplementationOnce(() => Dexie.Promise.reject(failure))
  await expect(importProductRuntimeMediaAssetV1(f.input)).rejects.toBe(failure)
  expect(await db.productMediaAssets.count()).toBe(0)
  expect(await db.productMediaBlobs.count()).toBe(0)
  expect(await db.agentRunEvents.toArray()).toEqual(events)

  // The shared content-addressed object survives failure until its own GC.
  // A retry must reuse it without skipping a version or deleting shared bytes.
  const staged = await db.mediaBlobObjects.where('workId').equals(f.input.scope.workId).toArray()
  expect(staged).toHaveLength(1)
  const retry = await importProductRuntimeMediaAssetV1(f.input)
  expect(retry.version).toBe(1)
  expect((await db.productMediaBlobs.where('mediaAssetId').equals(retry.id!).first())?.blobObjectId).toBe(staged[0].id)
  expect(await blobs.collectUnreferencedMediaBlobObjects({ scope: f.input.scope })).toMatchObject({
    deleted: [], retained: [staged[0].id],
  })
})

it('rejects a duplicate whose original physical binding is missing', async () => {
  const { input } = await fixture()
  const original = await importProductRuntimeMediaAssetV1(input)
  await db.productMediaBlobs.where('mediaAssetId').equals(original.id!).delete()
  await expect(importProductRuntimeMediaAssetV1(input)).rejects.toThrow(/绑定/)
  expect(await db.productMediaAssets.toArray()).toEqual([original])
  expect(await db.productMediaBlobs.count()).toBe(0)
})

it('refuses to bind an object whose world owner changed after physical preparation', async () => {
  const { input } = await fixture()
  const put = blobs.putMediaBlobObject
  vi.spyOn(blobs, 'putMediaBlobObject').mockImplementationOnce(async args => {
    const object = await put(args)
    await db.mediaBlobObjects.update(object.id!, { worldId: object.worldId + 1 })
    return object
  })
  await expect(importProductRuntimeMediaAssetV1(input)).rejects.toThrow(/绑定/)
  expect(await db.productMediaAssets.count()).toBe(0)
  expect(await db.productMediaBlobs.count()).toBe(0)
})

it('reuses a historical MIME spelling and records the physical MIME on new versions', async () => {
  const { input } = await fixture()
  const blob = new Blob([input.blob], { type: 'audio/wav ' })
  const first = await importProductRuntimeMediaAssetV1({ ...input, blob })
  expect(first.mimeType).toBe('audio/wav')
  // Older writers stored Blob.type literally, even when the physical writer trimmed it.
  await db.productMediaAssets.update(first.id!, { mimeType: blob.type })
  const duplicate = await importProductRuntimeMediaAssetV1({ ...input, blob })
  expect(duplicate).toMatchObject({ id: first.id, version: 1, mimeType: 'audio/wav ' })
})
