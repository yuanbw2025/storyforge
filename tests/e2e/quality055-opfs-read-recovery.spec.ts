import { expect, test } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

/** A private browser context and real OPFS. Fixture setup moves its own seeded
 * bytes to OPFS; recovery uses the unmodified public store and preview resolver. */
test('restored OPFS bytes recover through a fresh Build resolver without changing owners or frozen references', async ({ page, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin
  let modelRequests = 0
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) {
      modelRequests += 1
      return route.abort()
    }
    return url.origin === origin ? route.continue() : route.abort()
  })
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'sfqa055-isolated')
    localStorage.setItem('storyforge:experimental-products', 'enabled')
  })
  await page.goto('./')
  await page.getByRole('navigation', { name: '产品导航', exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
  const proof = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const [store, schema, native, inventory, system, resolvers, workspaces] = await Promise.all([
      load('/storyforge/src/lib/product-production/media-blob-store.ts'),
      load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/tests/helpers/avg-native-fixture.ts'),
      load('/storyforge/tests/helpers/avg-inventory-media-fixture.ts'),
      load('/storyforge/tests/helpers/avg-system-fixture.ts'),
      load('/storyforge/src/lib/product-production/media-resolver.ts'),
      load('/storyforge/src/lib/workspace/create-workspace.ts'),
    ]) as [
      typeof import('../../src/lib/product-production/media-blob-store'),
      typeof import('../../src/lib/db/schema'),
      typeof import('../helpers/avg-native-fixture'),
      typeof import('../helpers/avg-inventory-media-fixture'),
      typeof import('../helpers/avg-system-fixture'),
      typeof import('../../src/lib/product-production/media-resolver'),
      typeof import('../../src/lib/workspace/create-workspace'),
    ]
    const { db } = schema
    const media = await inventory.avgInventoryMediaFixture()
    const owner = await native.seedAvgNativePreview(system.avgSystemFixture(), media)
    const selected = media[0]
    const artifact = await db.productBuildArtifacts.where('buildId').equals(owner.buildId)
      .filter(row => row.contentHash === selected.asset.contentHash).first()
    if (artifact?.blobObjectId == null) throw new Error('055 native fixture has no accepted media binding')
    const seeded = await db.mediaBlobObjects.get(artifact.blobObjectId)
    if (!seeded?.id) throw new Error('055 native fixture has no physical object')
    const objectId = seeded.id
    const opfsPath = `storyforge/media/v1/work-${owner.scope.workId}/${seeded.contentHash}`
    const segments = opfsPath.split('/')
    let directory = await navigator.storage.getDirectory()
    for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment, { create: true })
    const file = await directory.getFileHandle(segments[segments.length - 1], { create: true })
    const writePhysical = async (data: ArrayBuffer) => {
      const writable = await file.createWritable()
      try { await writable.write(data); await writable.close() }
      catch (cause) { await writable.abort().catch(() => undefined); throw cause }
    }
    await writePhysical(selected.data)
    await db.mediaBlobObjects.update(objectId, { backend: 'opfs', data: null, opfsPath, storageState: 'ready' })
    const original = (await db.mediaBlobObjects.get(objectId))!
    const stableBlob = (row: typeof original) => {
      const { storageState: _health, lastVerifiedAt: _verified, updatedAt: _clock,
        leaseOwner: _reader, leaseExpiresAt: _expiry, ...stable } = row
      return JSON.stringify(stable)
    }
    const sourceSnapshot = async () => JSON.stringify({
      project: await db.projects.get(owner.scope.projectId),
      world: await db.worlds.get(owner.scope.worldId),
      work: await db.works.get(owner.scope.workId),
      production: await db.productProductions.get(owner.productionId),
      brief: await db.productProductionBriefs.where('productionId').equals(owner.productionId).toArray(),
      build: await db.productBuilds.get(owner.buildId),
      artifacts: await db.productBuildArtifacts.where('buildId').equals(owner.buildId).toArray(),
    })
    const sourcesBefore = await sourceSnapshot()
    const waitForRelease = async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await db.mediaBlobObjects.get(objectId))?.leaseOwner == null) return
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      throw new Error('055 native preview lease did not release')
    }
    const readFresh = async () => {
      const resolver = await resolvers.createBuildProductMediaResolver({ scope: owner.scope, productBuildId: owner.buildId, preview: owner.preview })
      try {
        const data = await (await resolver.read(selected.asset.assetKey)).arrayBuffer()
        return { hash: await store.sha256MediaData(data), byteSize: data.byteLength }
      } finally { resolver.dispose(); await waitForRelease() }
    }
    const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)
    const healthy = await readFresh()
    const damaged = selected.data.slice(0)
    new Uint8Array(damaged)[0] ^= 1
    await writePhysical(damaged)
    const corruptionError = await readFresh().then(() => '', errorText)
    const corrupt = (await db.mediaBlobObjects.get(objectId))!
    const badPhysicalHash = await store.sha256MediaData(await (await file.getFile()).arrayBuffer())
    const corruptWire = JSON.stringify(corrupt)
    const pureError = await store.readVerifiedMediaBlobObjectData(corrupt).then(() => '', errorText)
    const pureUnchanged = JSON.stringify(await db.mediaBlobObjects.get(objectId)) === corruptWire
    await writePhysical(selected.data)
    const restored = await readFresh()
    const after = (await db.mediaBlobObjects.get(objectId))!
    const foreign = await workspaces.createWorkspace({ name: '055 native unrelated owner', description: '', genres: [], status: 'drafting', targetWordCount: 10_000 })
    const foreignError = await store.readMediaBlobObjectData({ scope: foreign.scope, blobObjectId: objectId }).then(() => '', errorText)
    return {
      backend: after.backend, objectId: after.id, originalObjectId: original.id,
      healthy, restored, expectedHash: selected.asset.contentHash, expectedSize: selected.data.byteLength,
      corruptionError, corruptedState: corrupt.storageState, badPhysicalHash,
      pureError, pureUnchanged, finalState: after.storageState,
      stableBlobUnchanged: stableBlob(original) === stableBlob(after),
      ownersAndReferencesUnchanged: sourcesBefore === await sourceSnapshot(),
      finalPhysicalHash: await store.sha256MediaData(await (await file.getFile()).arrayBuffer()),
      foreignError, leaseReleased: after.leaseOwner === null && after.leaseExpiresAt === null,
    }
  })
  expect(proof.backend).toBe('opfs')
  expect(proof.objectId).toBe(proof.originalObjectId)
  expect(proof.healthy).toEqual({ hash: proof.expectedHash, byteSize: proof.expectedSize })
  expect(proof.corruptionError).toContain('哈希不匹配')
  expect(proof.corruptedState).toBe('corrupt')
  expect(proof.badPhysicalHash).not.toBe(proof.expectedHash)
  expect(proof.pureError).toContain('ready')
  expect(proof.pureUnchanged).toBe(true)
  expect(proof.restored).toEqual(proof.healthy)
  expect(proof.finalState).toBe('ready')
  expect(proof.stableBlobUnchanged).toBe(true)
  expect(proof.ownersAndReferencesUnchanged).toBe(true)
  expect(proof.finalPhysicalHash).toBe(proof.expectedHash)
  expect(proof.foreignError).toContain('跨 Work')
  expect(proof.leaseReleased).toBe(true)
  expect(modelRequests).toBe(0)
  await testInfo.attach('055-real-opfs-proof', { body: JSON.stringify({ ...proof, modelRequests }, null, 2), contentType: 'application/json' })
})
