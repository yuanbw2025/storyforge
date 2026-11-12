import { expect, test } from '@playwright/test'
import { openTextAdventurePage } from './helpers/text-adventure-entry'

test.use({ serviceWorkers: 'block' })

test('new dice admission rejects bad content while a frozen historical Release stays readable and playable', async ({ page, context }, info) => {
  const baseURL = info.project.use.baseURL
  if (!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('isolated loopback app required')
  const origin = new URL(baseURL).origin, blocked: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort()
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality109-isolated'))
  await page.goto('./')
  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const world = await importer('/storyforge/tests/helpers/current-product-world.ts') as typeof import('../helpers/current-product-world')
    const foundation = await importer('/storyforge/tests/helpers/text-adventure-v2-foundation.ts') as typeof import('../helpers/text-adventure-v2-foundation')
    const releaseFixture = await importer('/storyforge/tests/helpers/product-release-v1.ts') as typeof import('../helpers/product-release-v1')
    const packages = await importer('/storyforge/src/lib/product-production/runtime-package.ts') as typeof import('../../src/lib/product-production/runtime-package')
    const previews = await importer('/storyforge/src/lib/product-production/preview-manifest.ts') as typeof import('../../src/lib/product-production/preview-manifest')
    const contracts = await importer('/storyforge/src/lib/product/source-contracts.ts') as typeof import('../../src/lib/product/source-contracts')
    const hashes = await importer('/storyforge/src/lib/product-production/hash.ts') as typeof import('../../src/lib/product-production/hash')
    const { hashCanonicalValue } = await importer('/storyforge/src/lib/agent/run/hash.ts') as typeof import('../../src/lib/agent/run/hash')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { createProductRuntimeInstanceFromSource } = await importer('/storyforge/src/lib/product/runtime-instances.ts') as typeof import('../../src/lib/product/runtime-instances')
    const owned = await world.seedCurrentProductWorld('SFQA-109 browser isolated')
    const catalog = await world.loadCurrentProductWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: owned.release.id!, productType: 'text-adventure' })
    const runtimePackage = foundation.createTextAdventureFoundationRuntimePackageV2({ worldRelease: { ...owned.release, id: owned.release.id! }, sourceCatalog: catalog })
    const release = await releaseFixture.createFixtureProductReleaseManifestV1({ runtimePackage, productionKey: 'sfqa109-browser-history' })
    const action = release.runtimePackage.adventure!.actions.find(action => action.key === 'action.search.cache')!
    if (action.rule.kind !== 'random') throw new Error('Expected random fixture')
    action.rule.expression = '1d101'
    const rawCandidate = JSON.stringify(release.runtimePackage)
    let admissionError = ''
    try {
      await previews.createProductBuildPreviewManifestV1({ productionKey: 'sfqa109-browser-new', buildNumber: 1,
        buildManifestHash: 'a'.repeat(64), runtimePackage: release.runtimePackage })
    } catch (error) { admissionError = error instanceof Error ? error.message : String(error) }
    // Historical fixture only: reconstruct the old immutable identity without
    // calling new admission, then verify the complete production source chain.
    release.packageHash = await hashes.hashProductProductionValueV2(release.runtimePackage)
    const { releaseIdentityHash: _identity, lineage: prior, ...body } = release
    if (prior.schema !== 'storyforge.product-release-lineage') throw new Error('Shared lineage required')
    release.releaseIdentityHash = await packages.productReleaseIdentityHashV1(body)
    const { lineageHash: _hash, ...lineageBody } = prior
    const lineage = { ...lineageBody, releaseHash: release.releaseIdentityHash,
      releaseUid: contracts.productReleaseUidV1({ productType: release.productType, productInstanceKey: prior.productInstanceKey,
        releaseVersion: prior.releaseVersion, releaseHash: release.releaseIdentityHash }) }
    release.lineage = { ...lineage, lineageHash: await hashCanonicalValue(lineage) }
    await packages.verifyProductReleaseManifestV1(release)
    const manifestJson = JSON.stringify(release), contentHash = await hashes.hashProductProductionValueV2(release)
    const releaseId = await db.productReleases.add({ ...owned.scope, productionKey: release.productionProvenance.productionKey,
      productType: 'text-adventure', worldReleaseId: owned.release.id!, version: 1, label: 'Historical dice compatibility',
      manifestJson, contentHash, createdAt: Date.now() }) as number
    const session = await createProductRuntimeInstanceFromSource({ scope: owned.scope,
      source: { kind: 'release', productReleaseId: releaseId }, title: 'SFQA109 旧发行兼容', seed: 'sfqa109-native-history' })
    return { scope: owned.scope, releaseId, sessionId: session.id!, admissionError,
      candidateUnchanged: JSON.stringify(release.runtimePackage) === rawCandidate,
      manifestJson, contentHash, initialEvents: await db.productRuntimeEvents.where('sessionId').equals(session.id!).count() }
  })
  expect(seeded.admissionError).toContain('action.search.cache')
  expect(seeded.admissionError).toContain('1d101')
  expect(seeded.candidateUnchanged).toBe(true)
  await openTextAdventurePage(page, seeded.scope, 'play')
  const player = page.getByTestId('adventure-game-player')
  await expect(player).toBeVisible()
  await player.locator('.adventure-saved-journeys summary').click()
  await player.getByRole('button', { name: /SFQA109 旧发行兼容/ }).click()
  const command = player.getByRole('textbox', { name: '输入冒险指令' })
  await expect(command).toBeEnabled()
  await command.fill('寻找隐藏补给')
  await command.press('Enter')
  await expect(player.locator('.adventure-system-response')).toContainText('1d101')
  await expect(player.locator('.adventure-system-response')).toContainText('不受')
  const unchanged = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return db.productRuntimeEvents.where('sessionId').equals(sessionId).count()
  }, seeded.sessionId)
  expect(unchanged).toBe(seeded.initialEvents)
  await command.fill('观察仓房')
  await command.press('Enter')
  await expect(player.getByRole('log', { name: '冒险文字记录' })).toContainText('观察仓房')
  const expand = player.getByRole('button', { name: '展开本场全文', exact: true })
  if (await expand.isVisible()) await expand.click()
  await expect(player.getByRole('log', { name: '冒险文字记录' })).toContainText('潮汐图显示')
  await page.reload()
  await expect(player.getByRole('log', { name: '冒险文字记录' })).toContainText('潮汐图显示')
  const result = await page.evaluate(async seeded => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const runtime = await importer('/storyforge/src/lib/adventure/runtime-api.ts') as typeof import('../../src/lib/adventure/runtime-api')
    const { verifyProductReleaseManifestV1 } = await importer('/storyforge/src/lib/product-production/runtime-package.ts') as typeof import('../../src/lib/product-production/runtime-package')
    const row = await db.productReleases.get(seeded.releaseId)
    const state = await runtime.readProductRuntimeState(seeded.sessionId)
    const raw = JSON.parse(row!.manifestJson) as import('../../src/lib/types').ProductReleaseManifestV1
    let tamperedRejected = false
    try { await verifyProductReleaseManifestV1({ ...raw, lineage: { ...raw.lineage, lineageHash: '0'.repeat(64) } }) }
    catch { tamperedRejected = true }
    return { frozenUnchanged: row?.manifestJson === seeded.manifestJson && row.contentHash === seeded.contentHash,
      lastAction: state.adventure?.actionHistory.slice(-1)[0]?.actionKey, checks: state.adventure?.checks.length, tamperedRejected }
  }, seeded)
  expect(result).toEqual({ frozenUnchanged: true, lastAction: 'action.look.harbor', checks: 0, tamperedRejected: true })
  await page.screenshot({ path: info.outputPath('historical-release-good-action.png') })
  await info.attach('dice-admission-and-history', { contentType: 'application/json', body: JSON.stringify({ result, admissionError: seeded.admissionError, blocked, errors }) })
  expect(blocked).toEqual([])
  expect(errors).toEqual([])
})
