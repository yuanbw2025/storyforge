import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import {
  createMistHarborBrief,
  mistHarborAdventure,
  mistHarborAvg,
} from '../../src/lib/mist-harbor/production'
import { compileMistHarbor } from '../../src/lib/mist-harbor/compiler'
import { parseAnyProductReleaseManifest } from '../../src/lib/product/releases'

beforeEach(async () => {
  await db.delete()
  await db.open()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete()
})
it('installs the original authored world atomically and reuses it without replacing edits', async () => {
  const first = await createMistHarborWorld()
  expect(await db.characters.count()).toBe(5)
  expect(await db.chapters.count()).toBe(10)
  expect(await db.detailedOutlines.count()).toBe(10)
  expect(await db.characterRelations.count()).toBe(4)
  const repeated = await createMistHarborWorld()
  expect(repeated).toEqual(first)
  expect(await db.worldReleases.count()).toBe(1)
  const brief = await createMistHarborBrief(first.scope, first.worldReleaseId, 'adventure')
  const pkg = compileMistHarbor('adventure', brief)
  expect(pkg.narrative.nodes).toHaveLength(18)
  expect(pkg.narrative.beats).toHaveLength(158)
  expect(() => compileMistHarbor('avg', brief)).toThrow('身份不匹配')
}, 60000)
it('publishes both products with real source evidence and all 17 portable images, no sessions', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    const filename = url.split('/').at(-1)!
    const bytes = readFileSync(`public/demo-assets/mist-harbor/${filename}`)
    return new Response(bytes, { status: 200, headers: { 'content-type': 'image/webp' } })
  })
  const [adventure, duplicate, avg] = await Promise.all([
    mistHarborAdventure.install(),
    mistHarborAdventure.install(),
    mistHarborAvg.install(),
  ])
  expect(duplicate).toEqual(adventure)
  expect(avg.scope).toEqual(adventure.scope)
  const releases = await db.productReleases.toArray()
  expect(releases).toHaveLength(2)
  const pkg = parseAnyProductReleaseManifest(releases.find((row) => row.id === avg.releaseId)!.manifestJson)
  expect(pkg.presentation?.assets).toHaveLength(17)
  expect(await db.productMediaAssets.count()).toBe(17)
  expect(await db.productRuntimeSessions.count()).toBe(0)
  expect(await mistHarborAvg.install()).toEqual(avg)
  expect(await db.productReleases.count()).toBe(2)
  const { exportProjectJSON, importProjectJSON } = await import('../../src/lib/export/json-export')
  const { deleteWorkspace } = await import('../../src/lib/workspace/lifecycle')
  const { readVerifiedMediaBlobObjectData } = await import(
    '../../src/lib/product-production/media-blob-store'
  )
  const backup = await exportProjectJSON(avg.scope.projectId)
  await deleteWorkspace(avg.scope.projectId)
  await importProjectJSON(backup)
  vi.stubGlobal('fetch', () => {
    throw new Error('network unavailable')
  })
  expect(await mistHarborAvg.install()).toEqual(await mistHarborAvg.findInstalled())
  expect(await db.productMediaAssets.count()).toBe(17)
  for (const asset of await db.productMediaAssets.toArray()) {
    const binding = await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).first()
    const blob = await db.mediaBlobObjects.get(binding!.blobObjectId)
    expect((await readVerifiedMediaBlobObjectData(blob!)).byteLength).toBe(asset.byteSize)
  }
}, 120000)

it('plays every adventure ending, enforces evidence gates and restores a portable saved release', async () => {
  const { createTextAdventureInstance } = await import('../../src/lib/product/runtime-instances')
  const {
    commitAdventureAction,
    commitAdventureNarrativeChoice,
    readProductRuntimeState,
    readProductRuntimeStateVersion,
    createProductRuntimeCheckpoint,
  } = await import('../../src/lib/adventure/runtime-api')
  const { exportProjectJSON, importProjectJSON } = await import('../../src/lib/export/json-export')
  const { deleteWorkspace } = await import('../../src/lib/workspace/lifecycle')
  const installed = await mistHarborAdventure.install()
  const release = await db.productReleases.get(installed.releaseId)
  const pkg = parseAnyProductReleaseManifest(release!.manifestJson)
  for (const ending of ['truth', 'home', 'sea']) {
    const session = await createTextAdventureInstance({
      scope: installed.scope,
      productReleaseId: installed.releaseId,
      title: ending,
    })
    const take = async (key: string) => {
      const version = await readProductRuntimeStateVersion(session.id!)
      await commitAdventureAction({
        sessionId: session.id!,
        actionKey: key,
        commandId: `${ending}.${key}`,
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
      })
    }
    for (let i = 0; i < 20; i++) {
      const state = await readProductRuntimeState(session.id!)
      const node = state.narrative!.currentNodeKey!
      if (['truth', 'home', 'sea'].includes(node)) {
        expect(node).toBe(ending)
        break
      }
      const target =
        ending === 'truth' ? 'public-square' : ending === 'home' ? 'sealed-engine' : 'outbound-dock'
      const choice = pkg.narrative.choices
        .filter((item) => item.sourceNodeKey === node)
        .find((item, index) => (node === 'bell' ? item.targetNodeKey === target : index === 0))!
      const clue =
        node === 'vault' ? 'calibration' : node === 'patrol' ? 'witness' : node === 'bell' ? 'seal' : null
      if (clue) {
        const before = await readProductRuntimeStateVersion(session.id!)
        await expect(
          commitAdventureNarrativeChoice({ sessionId: session.id!, choiceKey: choice.choiceKey }),
        ).rejects.toThrow()
        expect(await readProductRuntimeStateVersion(session.id!)).toEqual(before)
        await take(`take.${clue}`)
      }
      await commitAdventureNarrativeChoice({ sessionId: session.id!, choiceKey: choice.choiceKey })
    }
    expect((await readProductRuntimeState(session.id!)).narrative?.currentNodeKey).toBe(ending)
    await createProductRuntimeCheckpoint({ sessionId: session.id!, name: ending })
  }
  const backup = await exportProjectJSON(installed.scope.projectId)
  await deleteWorkspace(installed.scope.projectId)
  const restoredId = await importProjectJSON(backup)
  const restored = await mistHarborAdventure.findInstalled()
  expect(restored?.scope.projectId).toBe(restoredId)
  expect(await mistHarborAdventure.install()).toEqual(restored)
  expect(await db.productReleases.count()).toBe(1)
  expect(await db.productRuntimeSessions.count()).toBe(3)
  for (const session of await db.productRuntimeSessions.toArray())
    expect((await readProductRuntimeState(session.id!)).narrative?.currentNodeKey).toBe(session.title)
}, 120000)

it('rejects damaged bundled art and keeps an existing adventure safe for retry', async () => {
  const installed = await mistHarborAdventure.install()
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
  await expect(mistHarborAvg.install()).rejects.toThrow('哈希')
  expect(await db.productReleases.count()).toBe(1)
  expect(await mistHarborAdventure.findInstalled()).toEqual(installed)
  vi.stubGlobal(
    'fetch',
    async (url: string) =>
      new Response(readFileSync(`public/demo-assets/mist-harbor/${url.split('/').at(-1)!}`)),
  )
  await mistHarborAvg.install()
  expect(await db.productReleases.count()).toBe(2)
  expect(await db.worldReleases.count()).toBe(1)
}, 120000)
