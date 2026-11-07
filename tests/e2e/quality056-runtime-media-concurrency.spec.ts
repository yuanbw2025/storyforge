import { expect, test, type Page } from '@playwright/test'
import type { ExactRunArtifactIdentityV1 } from '../../src/lib/types'

test('SFQA056 native two-tab media concurrency preserves versions, exact evidence and reload', async ({ page, context, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('The isolated browser base URL is required')
  const origin = new URL(baseURL).origin
  const errors: string[] = []
  let modelRequests = 0
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/chat/completions')) { modelRequests++; return route.abort() }
    return url.origin === origin ? route.continue() : route.abort()
  })
  await context.addInitScript(({ allowedOrigin }) => {
    if (location.origin === allowedOrigin) localStorage.setItem('storyforge_guide_completed', 'sfqa056')
  }, { allowedOrigin: origin })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const worldHelpers = await load<typeof import('../helpers/current-product-world')>('/storyforge/tests/helpers/current-product-world.ts')
    const seededWorld = await worldHelpers.seedCurrentProductWorld('SFQA056 native shared media')
    if (typeof seededWorld.release.id !== 'number') throw new Error('The actual frozen WorldRelease was not created')
    const world = { ...seededWorld, release: { ...seededWorld.release, id: seededWorld.release.id } }
    const catalog = await worldHelpers.loadCurrentProductWorldSourceCatalogV1({ scope: world.scope,
      worldReleaseId: world.release.id, productType: 'avg' })
    const packages = await load<typeof import('../helpers/current-runtime-package')>('/storyforge/tests/helpers/current-runtime-package.ts')
    const runtimePackage = packages.createCurrentRuntimePackageFixture({ productType: 'avg', worldRelease: world.release, sourceCatalog: catalog })
    const builds = await load<typeof import('../helpers/current-product-build')>('/storyforge/tests/helpers/current-product-build.ts')
    const build = await builds.seedCurrentProductBuild({ scope: world.scope, worldRelease: world.release,
      runtimePackage, title: 'SFQA056 native current Build' })
    if (!build.session.id) throw new Error('The actual runtime session was not created')
    const hashes = await load<typeof import('../../src/lib/product-production/hash')>('/storyforge/src/lib/product-production/hash.ts')
    return { scope: world.scope, sessionId: build.session.id, worldReleaseId: world.release.id,
      worldReleaseHash: await hashes.hashProductProductionValueV2(world.release) }
  })
  const other = await context.newPage()
  other.on('pageerror', error => errors.push(error.message))
  await other.goto('./')
  await Promise.all([page, other].map(tab => tab.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    await load<typeof import('../../src/lib/product/runtime-media-library')>('/storyforge/src/lib/product/runtime-media-library.ts')
    await load<typeof import('../helpers/open-audio-runtime')>('/storyforge/tests/helpers/open-audio-runtime.ts')
  })))
  const imported = (tab: Page, key: string, changed = false, forceLatest = false,
    exactArtifactRefs?: readonly ExactRunArtifactIdentityV1[]) => tab.evaluate(async data => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const media = await load<typeof import('../../src/lib/product/runtime-media-library')>('/storyforge/src/lib/product/runtime-media-library.ts')
    const audio = await load<typeof import('../helpers/open-audio-runtime')>('/storyforge/tests/helpers/open-audio-runtime.ts')
    const original = audio.audioWavFixtureV1(), bytes = await original.arrayBuffer()
    if (data.changed) new DataView(bytes).setInt16(bytes.byteLength - 2, 1, true)
    return media.importProductRuntimeMediaAssetV1({ scope: data.fixture.scope,
      productRuntimeSessionId: data.fixture.sessionId, assetKey: data.key, kind: 'voice',
      name: 'Synthetic native WAV; not adopted', blob: new Blob([bytes], { type: 'audio/wav' }),
      source: 'native isolated fixture', license: 'fixture only', durationMs: 250,
      forceLatest: data.forceLatest, ...(data.exactArtifactRefs ? { exactArtifactRefs: data.exactArtifactRefs } : {}) })
  }, { fixture, key, changed, forceLatest, exactArtifactRefs })

  const same = await Promise.all([imported(page, '056.native.same'), imported(other, '056.native.same')])
  expect(same.map(asset => asset.version)).toEqual([1, 1])
  expect(same[0].id).toBe(same[1].id)
  const different = await Promise.all([imported(page, '056.native.different'), imported(other, '056.native.different', true)])
  expect(different.map(asset => asset.version).sort()).toEqual([1, 2])
  expect(different[0].contentHash).not.toBe(different[1].contentHash)
  const old = await imported(page, '056.native.latest')
  await imported(other, '056.native.latest', true)
  const latest = await Promise.all([imported(page, '056.native.latest', false, true), imported(other, '056.native.latest', false, true)])
  expect(latest.map(asset => asset.version)).toEqual([3, 3])
  expect(latest[0].id).toBe(latest[1].id)
  expect((await imported(other, '056.native.latest', false, true)).id).toBe(latest[0].id)
  expect((await imported(page, '056.native.latest')).id).toBe(old.id)

  const ref = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const runs = await load<typeof import('../../src/lib/agent/run/event-store')>('/storyforge/src/lib/agent/run/event-store.ts')
    const artifacts = await load<typeof import('../../src/lib/memory/artifact-store')>('/storyforge/src/lib/memory/artifact-store.ts')
    const run = await runs.createAgentRunV1({ scope, contract: {
      version: 1, objective: 'Synthetic native media evidence', workflowKind: 'read-only-audit', runtimeBindingHash: 'b'.repeat(64),
      scope: { projectId: scope.projectId, worldGroupId: null }, permissions: { contextSourceKeys: ['chapterContent'], writeTargets: [] },
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1000, maxOutputTokens: 100, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'original', kind: 'output-present', required: true }],
      verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'sfqa056-native', criterionIds: ['original'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    } })
    const saved = await artifacts.recordAgentRunArtifactV1({ scope, runId: run.run.id,
      artifactKind: 'raw-response', content: 'Synthetic native original; no generated-media adoption permission.' })
    return { artifactKind: saved.artifact.artifactKind, contentHash: saved.artifact.contentHash }
  }, fixture.scope)
  const exactOld = await imported(page, '056.native.exact', false, false, [ref])
  await imported(page, '056.native.exact', true, false, [ref])
  // Both opt-in imports use the existing same-page evidence coordinator;
  // no cross-page busy rejection is converted into a retry or success.
  const exact = await Promise.all([imported(page, '056.native.exact', false, true, [ref]), imported(page, '056.native.exact', false, true, [ref])])
  expect(exact.map(asset => asset.version)).toEqual([3, 3])
  expect(exact[0].id).toBe(exact[1].id)
  expect(JSON.parse(exact[0].exactArtifactRefsJson ?? 'null')).toEqual([ref])
  expect((await imported(page, '056.native.exact', false, true, [ref])).id).toBe(exact[0].id)
  expect((await imported(page, '056.native.exact', false, false, [ref])).id).toBe(exactOld.id)

  const inspect = (tab: Page) => tab.evaluate(async data => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const blobs = await load<typeof import('../../src/lib/product-production/media-blob-store')>('/storyforge/src/lib/product-production/media-blob-store.ts')
    const hashes = await load<typeof import('../../src/lib/product-production/hash')>('/storyforge/src/lib/product-production/hash.ts')
    const assets = await db.productMediaAssets.where('productRuntimeSessionId').equals(data.sessionId).toArray()
    const bindings = []
    for (const asset of assets) {
      const rows = await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).toArray()
      if (rows.length !== 1) throw new Error('Each native metadata row must have exactly one physical binding')
      const binding = rows[0], object = await db.mediaBlobObjects.get(binding.blobObjectId)
      if (!object || object.projectId !== data.scope.projectId || object.worldId !== data.scope.worldId
        || object.workId !== data.scope.workId || object.contentHash !== asset.contentHash
        || (await blobs.readVerifiedMediaBlobObjectData(object)).byteLength !== asset.byteSize) {
        throw new Error('Native media object bytes/owner do not match the returned version')
      }
      bindings.push(binding)
    }
    return { assets, bindings, worldUnchanged: await hashes.hashProductProductionValueV2(await db.worldReleases.get(data.worldReleaseId)) === data.worldReleaseHash,
      modelEvents: await db.agentRunEvents.where('projectId').equals(data.scope.projectId).filter(row => row.type === 'model.requested').count() }
  }, fixture)
  const beforeReload = await inspect(page)
  expect(beforeReload.assets.map(asset => `${asset.assetKey}:${asset.version}`).sort()).toEqual([
    '056.native.same:1', '056.native.different:1', '056.native.different:2',
    '056.native.latest:1', '056.native.latest:2', '056.native.latest:3',
    '056.native.exact:1', '056.native.exact:2', '056.native.exact:3',
  ].sort())
  expect(beforeReload.worldUnchanged).toBe(true)
  expect(beforeReload.modelEvents).toBe(0)
  await page.reload()
  expect(await inspect(page)).toEqual(beforeReload)
  expect(modelRequests).toBe(0)
  expect(errors).toEqual([])
  await testInfo.attach('native-media-owner-version-proof', { contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ ...beforeReload, modelRequests }, null, 2)) })
  await other.close()
})
