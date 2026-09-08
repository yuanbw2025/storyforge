import { expect, test, type Page } from '@playwright/test'

async function openFormalSession(page: Page, title: string) {
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '文字开放世界', exact: true }).click()
  await page.getByRole('button', { name: '玩家', exact: true }).click()
  const formalSaves = page.getByRole('region', { name: '正式存档' })
  await expect(formalSaves.getByText(title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await formalSaves.locator('.open-world-save-open').filter({ hasText: title }).click()
  await expect(page.getByTestId('text-open-world-shell')).toBeVisible({ timeout: 20_000 })
}

async function openSaveSettings(page: Page) {
  const navigation = page.viewportSize()!.width <= 390
    ? page.getByTestId('text-open-world-mobile-navigation')
    : page.getByTestId('text-open-world-navigation-rail')
  await navigation.getByRole('button', { name: '更多', exact: true }).click()
  await expect(page.getByTestId('text-open-world-main-view')).toHaveAttribute('data-open-world-view', 'more')
  const panel = page.getByTestId('text-open-world-save-settings')
  await panel.scrollIntoViewIfNeeded()
  await expect(panel).toBeVisible({ timeout: 20_000 })
  return panel
}

async function expectNoHorizontalOverflow(page: Page, viewportWidth: number) {
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))
  expect(geometry.viewportWidth).toBe(viewportWidth)
  expect(geometry.documentWidth).toBeLessThanOrEqual(viewportWidth)
}

test('正式开放世界存档中心保留分支与旧Release，并持久化本机阅读设置', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-save-settings-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')

  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { hashProductProductionValueV2 },
      { createFixtureProductReleaseManifestV1 },
      { createGovernedTextOpenWorldSessionFixtureV1 },
      { createTextOpenWorldVNextFixture },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/product-production/hash.ts'),
      importer('/storyforge/tests/helpers/product-release-v1.ts'),
      importer('/storyforge/tests/helpers/text-open-world-product-session.ts'),
      importer('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts'),
    ])
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: '浏览器开放世界存档验收',
      textOpenWorldVNext: createTextOpenWorldVNextFixture(),
      runtimeShape: 'vnext-only',
      title: '盐脊旧版旅程',
      seed: 'browser-open-world-save-settings',
    })
    const nextManifest = await createFixtureProductReleaseManifestV1({
      runtimePackage: created.runtimePackage,
      productionKey: created.release.productionKey,
      releaseVersion: 2,
      parentRelease: {
        releaseUid: created.manifest.lineage.releaseUid,
        releaseHash: created.manifest.releaseIdentityHash,
      },
    })
    await db.productReleases.add({
      ...created.scope,
      productionKey: created.release.productionKey,
      productType: 'text-open-world',
      worldReleaseId: null,
      version: 2,
      label: '盐脊修订版 v2',
      manifestJson: JSON.stringify(nextManifest),
      contentHash: await hashProductProductionValueV2(nextManifest),
      createdAt: created.release.createdAt + 1_000,
    })
    return {
      parentSessionId: created.session.id as number,
      parentTitle: created.session.title,
      pinnedReleaseLabel: created.release.label,
    }
  })

  await page.reload()
  await openFormalSession(page, seeded.parentTitle)
  await expect(page.getByTestId('text-open-world-runtime-source'))
    .toContainText('PRODUCT RELEASE v1 · 已固定')

  let panel = await openSaveSettings(page)
  const tabs = panel.getByRole('navigation', { name: '存档与设置分类' })
  await expect(tabs.getByRole('button')).toHaveText(['存档0', '分支1', '版本', '设置'])

  await panel.getByLabel('为当前进度命名').fill('进入盐渠前')
  await panel.getByRole('button', { name: '保存当前进度', exact: true }).click()
  const manualSave = panel.locator('article').filter({ hasText: '进入盐渠前' })
  await expect(manualSave).toBeVisible()
  await expect(panel.locator('[data-save-purpose="manual"]')).toContainText('手动存档')
  await expect(panel).toContainText('1/20 个手动档')

  await manualSave.getByRole('button', { name: '从此处继续', exact: true }).click()
  const confirmation = panel.getByRole('alertdialog')
  await expect(confirmation).toContainText('当前时间线和之后发生的事件都会保留')
  await confirmation.getByRole('button', { name: '建立分支并继续', exact: true }).click()

  const childTitle = `${seeded.parentTitle} · 进入盐渠前`
  await expect(page.getByTestId('text-open-world-shell')).toBeVisible()
  await expect(page.getByTestId('text-open-world-runtime-source'))
    .toContainText('PRODUCT RELEASE v1 · 已固定')
  await expect(page.getByTestId('text-open-world-main-view'))
    .toHaveAttribute('data-open-world-view', 'scene')
  panel = await openSaveSettings(page)
  await panel.getByRole('navigation', { name: '存档与设置分类' })
    .getByRole('button', { name: /^分支/ })
    .click()
  const branches = panel.getByTestId('text-open-world-branch-list')
  await expect(branches).toContainText('2 条时间线')
  const parentBranch = branches.locator('article').filter({ hasText: seeded.parentTitle }).filter({
    hasNotText: childTitle,
  })
  const childBranch = branches.locator('article').filter({ hasText: childTitle })
  await expect(parentBranch).toBeVisible()
  await expect(parentBranch).toContainText('1/20 个手动档')
  await expect(childBranch).toBeVisible()
  await expect(childBranch).toContainText('当前时间线')

  await panel.getByRole('navigation', { name: '存档与设置分类' })
    .getByRole('button', { name: '版本', exact: true })
    .click()
  const versions = panel.getByTestId('text-open-world-version-list')
  await expect(versions).toContainText(`${seeded.pinnedReleaseLabel} · v1`)
  await expect(versions).toContainText('盐脊修订版 v2 · v2')
  await expect(versions).toContainText('旧存档会继续使用自己的不可变 Release')
  await expect(versions).toContainText('当前不能迁移此存档')
  await expect(versions.getByRole('button', { name: /迁移/ })).toHaveCount(0)

  await panel.getByRole('navigation', { name: '存档与设置分类' })
    .getByRole('button', { name: '设置', exact: true })
    .click()
  const preferences = panel.getByTestId('text-open-world-player-preferences')
  await preferences.getByLabel('高对比度', { exact: true }).check()
  await preferences.locator('input[type="range"]').first().fill('24')
  const shell = page.getByTestId('text-open-world-shell')
  await expect(shell).toHaveAttribute('data-high-contrast', 'true')
  await expect.poll(() => shell.evaluate(element => (
    getComputedStyle(element).getPropertyValue('--open-world-reader-font-size').trim()
  ))).toBe('24px')
  await expectNoHorizontalOverflow(page, 1440)

  await page.setViewportSize({ width: 390, height: 844 })
  await panel.scrollIntoViewIfNeeded()
  await expect(panel).toBeVisible()
  await expectNoHorizontalOverflow(page, 390)

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await openFormalSession(page, childTitle)
  const restoredShell = page.getByTestId('text-open-world-shell')
  await expect(restoredShell).toHaveAttribute('data-high-contrast', 'true')
  await expect.poll(() => restoredShell.evaluate(element => (
    getComputedStyle(element).getPropertyValue('--open-world-reader-font-size').trim()
  ))).toBe('24px')
  await page.setViewportSize({ width: 390, height: 844 })
  panel = await openSaveSettings(page)
  await panel.getByRole('navigation', { name: '存档与设置分类' })
    .getByRole('button', { name: '设置', exact: true })
    .click()
  await expect(panel.getByLabel('高对比度', { exact: true })).toBeChecked()
  await expect(panel.locator('input[type="range"]').first()).toHaveValue('24')
  await expectNoHorizontalOverflow(page, 390)

  const durable = await page.evaluate(async ({ parentSessionId, currentTitle }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const sessions = await db.productRuntimeSessions.toArray()
    const parent = sessions.find((session: { id?: number }) => session.id === parentSessionId)
    const child = sessions.find((session: { title: string }) => session.title === currentTitle)
    return {
      parentExists: Boolean(parent),
      childParentId: child?.parentSessionId ?? null,
      sameRelease: parent?.productReleaseId === child?.productReleaseId,
      parentCheckpointNames: (await db.productRuntimeCheckpoints
        .where('sessionId').equals(parentSessionId).toArray())
        .map((checkpoint: { name: string }) => checkpoint.name),
    }
  }, { parentSessionId: seeded.parentSessionId, currentTitle: childTitle })
  expect(durable).toEqual({
    parentExists: true,
    childParentId: seeded.parentSessionId,
    sameRelease: true,
    parentCheckpointNames: ['进入盐渠前'],
  })
})
