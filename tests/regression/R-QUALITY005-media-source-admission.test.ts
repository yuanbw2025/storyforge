import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { importTextOpenWorldCreatorMediaBlobV1, previewTextOpenWorldCreatorMediaV1 } from '../../src/lib/product-production/service'
import { readMediaBlobObjectData } from '../../src/lib/product-production/media-blob-store'
import * as transport from '../../src/lib/product-production/media-transport'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'
import { seedQuality005LegacyNovelV1, snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0)).buffer
const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')
const SOURCE_REQUIRED = /WorldRelease|世界.*封存|派生.*世界|来源.*只读/

describe('SFQA-005 · real Creator media service admission and final authority CAS', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => {
    vi.restoreAllMocks()
    if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage)
    else delete (navigator as { storage?: unknown }).storage
  })
  afterAll(() => db.close())

  it('rejects a new upload for an actual legacy novel before adding Blob bytes', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    await expect(importTextOpenWorldCreatorMediaBlobV1({ scope: f.scope, productionId: f.creator.productionId,
      buildId: f.creator.buildId, data: PNG })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects provider planning before resolving a Provider or dispatching a request', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const agnes = vi.spyOn(transport, 'resolveConfiguredAgnesImageCapabilityV1')
    const relay = vi.spyOn(transport, 'resolveTrustedRelayMediaCapabilityV1')
    const before = await snapshotQuality005RowsV1()
    await expect(previewTextOpenWorldCreatorMediaV1({ scope: f.scope, productionId: f.creator.productionId,
      buildId: f.creator.buildId, mode: 'provider-generate' })).rejects.toThrow(SOURCE_REQUIRED)
    expect(agnes).not.toHaveBeenCalled(); expect(relay).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('imports and deduplicates the exact same image for a current true World Build', async () => {
    const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const input = { scope: f.scope, productionId: f.creator.productionId, buildId: f.creator.buildId, data: PNG }
    const first = await importTextOpenWorldCreatorMediaBlobV1(input)
    const repeated = await importTextOpenWorldCreatorMediaBlobV1(input)
    expect(repeated).toEqual(first)
    expect(first).toMatchObject({ mimeType: 'image/png', width: 1, height: 1, byteSize: PNG.byteLength })
    expect(await readMediaBlobObjectData({ scope: f.scope, blobObjectId: first.blobObjectId })).toEqual(PNG)
  }, 30_000)

  it('rejects a wrong Production id or foreign Work, without creating a Blob', async () => {
    const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const before = await snapshotQuality005RowsV1()
    await expect(importTextOpenWorldCreatorMediaBlobV1({ scope: f.scope, productionId: f.creator.productionId + 1000,
      buildId: f.creator.buildId, data: PNG })).rejects.toThrow(/当前仍有效|绑定/)
    await expect(importTextOpenWorldCreatorMediaBlobV1({ scope: { ...f.scope, workId: f.scope.workId + 1000 },
      productionId: f.creator.productionId, buildId: f.creator.buildId, data: PNG })).rejects.toThrow()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  }, 30_000)

  it('rejects an authority change during quota/hash preparation at the actual Blob write', async () => {
    const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const production = (await db.productProductions.get(f.creator.productionId))!
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => {
      await db.productProductions.update(production.id!, { stateRevision: production.stateRevision + 1 })
      return { quota: 1_000_000, usage: 0 }
    } } })
    const blobCount = await db.mediaBlobObjects.count()
    await expect(importTextOpenWorldCreatorMediaBlobV1({ scope: f.scope, productionId: f.creator.productionId,
      buildId: f.creator.buildId, data: PNG })).rejects.toThrow(/写入前.*变化/)
    expect(await db.mediaBlobObjects.count()).toBe(blobCount)
    expect((await db.productProductions.get(production.id!))?.stateRevision).toBe(production.stateRevision + 1)
  }, 30_000)
})
