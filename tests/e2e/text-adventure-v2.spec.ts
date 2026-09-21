import { expect, test } from '@playwright/test'

test('文字冒险 V2 在浏览器中加载冻结插图、系统面板并在刷新后恢复事件状态', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-adventure-v2-e2e')
  })
  await page.goto('./')
  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 },
      { createTextAdventureFoundationRuntimePackageV2 },
      { seedCurrentProductBuild },
      { putMediaBlobObject },
      { acceptProductBuildArtifact },
      { parseProductRuntimePackageV1 },
    ] = await Promise.all([
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/tests/helpers/text-adventure-v2-foundation.ts'),
      importer('/storyforge/tests/helpers/current-product-build.ts'),
      importer('/storyforge/src/lib/product-production/media-blob-store.ts'),
      importer('/storyforge/src/lib/product-production/artifact-store.ts'),
      importer('/storyforge/src/lib/product-production/runtime-package.ts'),
    ])
    const owned = await seedCurrentProductWorld('文字冒险 V2 浏览器纵切面')
    const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
      scope: owned.scope, worldReleaseId: owned.release.id, productType: 'text-adventure',
    })
    const original = createTextAdventureFoundationRuntimePackageV2({
      worldRelease: owned.release, sourceCatalog,
    })
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#10202b"/><circle cx="850" cy="170" r="110" fill="#d8b26e"/><path d="M0 570L260 330l160 150 210-270 190 220 180-150 200 290z" fill="#081116"/><text x="70" y="110" fill="#f4ead8" font-size="54">雾潮灯塔</text></svg>').buffer
    const blob = await putMediaBlobObject({
      scope: owned.scope, data: svg, mimeType: 'image/svg+xml', backend: 'indexeddb', sanitizedSvg: true,
    })
    const assetKey = 'asset.text-adventure.opening'
    const artifactKey = 'media.visual.001'
    const runtimePackage = parseProductRuntimePackageV1({
      ...original,
      definition: {
        ...original.definition,
        enabledCapabilities: [...original.definition.enabledCapabilities, 'presentation'],
      },
      presentation: {
        version: 1,
        assets: [{
          assetKey, version: 1, kind: 'background', name: '雾潮灯塔开场插图',
          mimeType: blob.mimeType, byteSize: blob.byteSize, width: 1200, height: 675, durationMs: null,
          contentHash: blob.contentHash, blobContentHash: blob.contentHash,
          source: 'storyforge-e2e-original-svg', license: 'CC0-1.0',
          altText: '金色月光下的雾潮灯塔剪影。', characterTag: '', sceneTag: 'opening',
        }],
        cues: [{
          cueKey: 'cue.text-adventure.opening', beatKey: 'beat.opening.1', phase: 'before',
          type: 'set-background', assetKey, durationMs: 300, easing: 'ease-in-out', order: 0,
        }],
      },
      adventure: {
        ...original.adventure,
        media: { mode: 'key-illustrations', fallback: 'text-only', assetKeys: [assetKey] },
      },
    })
    const built = await seedCurrentProductBuild({
      scope: owned.scope, worldRelease: owned.release, runtimePackage,
      title: '雾潮灯塔 V2 浏览器版', seed: 'text-adventure-browser-v2',
      mediaBindings: [{ assetKey, artifactKey, blobContentHash: blob.contentHash }],
    })
    await acceptProductBuildArtifact({
      scope: owned.scope, buildId: built.buildId, controlEpoch: 0,
      artifactKey, requirementKey: 'media.visual', kind: 'image', mediaKind: 'background',
      payload: { assetKey }, metadata: { altText: '金色月光下的雾潮灯塔剪影。' },
      quality: { dimensionsVerified: true }, rights: { license: 'CC0-1.0' },
      contentHash: blob.contentHash, blobObjectId: blob.id, mimeType: blob.mimeType, byteSize: blob.byteSize,
      inputHash: 'a'.repeat(64),
    })
    return { sessionId: built.session.id, blobObjectId: blob.id }
  })

  await page.reload()
  await page.getByTestId('product-tab-text-games').click()
  const player = page.getByTestId('adventure-game-player')
  await expect(player).toBeVisible({ timeout: 15_000 })
  await player.getByRole('button', { name: /雾潮灯塔 V2 浏览器版/ }).click()
  await expect(player.getByRole('img', { name: '金色月光下的雾潮灯塔剪影。' })).toBeVisible()
  await expect(player).toContainText('雾港 · 内港区')
  await player.getByRole('button', { name: '角色', exact: true }).first().click()
  await expect(page.getByRole('region', { name: '角色状态' })).toContainText('生命')
  await page.getByRole('button', { name: '关闭面板' }).click()

  const search = player.getByRole('button', { name: /寻找隐藏补给/ })
  await expect(search).toBeVisible()
  await search.click()
  const narrativeButton = player.locator('.adventure-narrative-continue')
  if (await narrativeButton.count()) {
    await narrativeButton.click()
    if (await narrativeButton.count()) await narrativeButton.click()
  }
  await expect(player.getByRole('log', { name: '冒险文字记录' })).toContainText('寻找隐藏补给')

  // Simulate a locally unavailable frozen image after it has already rendered.
  // The next real browser reload must keep deterministic play available and
  // surface the explicit text-only fallback instead of a broken image.
  await page.evaluate(async blobObjectId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    await db.mediaBlobObjects.delete(blobObjectId)
  }, seeded.blobObjectId)

  await page.reload()
  await page.getByTestId('product-tab-text-games').click()
  const restoredPlayer = page.getByTestId('adventure-game-player')
  const restoredLog = restoredPlayer.getByRole('log', { name: '冒险文字记录' })
  const continueButton = restoredPlayer.getByRole('button', { name: /雾潮灯塔 V2 浏览器版/ })
  await expect.poll(async () => await restoredLog.count() + await continueButton.count()).toBeGreaterThan(0)
  if (await continueButton.count()) {
    await continueButton.click()
  }
  await expect(restoredPlayer.locator('.adventure-media-fallback')).toContainText('插图已降级为纯文字')
  await expect(restoredPlayer).toContainText('离线确定性模式')
  await expect(restoredLog).toContainText('寻找隐藏补给')
  const restored = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-api.ts')
    const state = await readProductRuntimeState(sessionId)
    return { actions: state.adventure?.actionHistory.length, version: state.adventure?.version }
  }, seeded.sessionId)
  expect(restored).toMatchObject({ actions: 1, version: 2 })
})
