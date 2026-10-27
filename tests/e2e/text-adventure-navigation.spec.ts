import { expect, test } from '@playwright/test'

test('文字冒险顶部入口、制作页和其他产品往返保留工作区，刷新及存档恢复稳定', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { localStorage.setItem('storyforge_guide_completed', 'adventure-navigation-e2e') })
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [world, build, foundation] = await Promise.all([
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/tests/helpers/current-product-build.ts'),
      importer('/storyforge/tests/helpers/text-adventure-v2-foundation.ts'),
    ])
    const owned = await world.seedCurrentProductWorld('导航回归隔离工作区')
    const catalog = await world.loadCurrentProductWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: owned.release.id, productType: 'text-adventure' })
    const runtimePackage = foundation.createTextAdventureFoundationRuntimePackageV2({ worldRelease: owned.release, sourceCatalog: catalog })
    const seeded = await build.seedCurrentProductBuild({ scope: owned.scope, worldRelease: owned.release, runtimePackage, title: '导航回归游戏' })
    return { scope: owned.scope, sessionId: seeded.session.id }
  })
  const query = `project=${fixture.scope.projectId}&work=${fixture.scope.workId}`
  await page.goto(`./adventure/review?${query}`)
  const productNav = page.getByRole('navigation', { name: '产品导航', exact: true })
  const adventureNav = page.getByRole('navigation', { name: '文字冒险导航', exact: true })
  const workspace = page.getByRole('combobox', { name: '创作工作区', exact: true })
  await expect(workspace).toHaveValue(String(fixture.scope.projectId))
  await expect(adventureNav.getByRole('link', { name: '创作工作台', exact: true })).toHaveAttribute('aria-current', 'page')
  await productNav.getByRole('link', { name: '文字冒险', exact: true }).click()
  await expect(page.getByTestId('adventure-game-player')).toBeVisible()
  await expect(workspace).toHaveValue(String(fixture.scope.projectId))
  await expect(page).toHaveURL(new RegExp(`adventure/library\\?${query.replace('?', '\\?')}$`))

  for (const name of ['产品定向', '质量与素材', '发布与导出']) {
    await adventureNav.getByRole('link', { name: '创作工作台', exact: true }).click()
    await page.getByRole('navigation', { name: '文字冒险制作导航' }).getByRole('link', { name, exact: true }).click()
    await expect(adventureNav.getByRole('link', { name: '创作工作台', exact: true })).toHaveAttribute('aria-current', 'page')
    await productNav.getByRole('link', { name: '文字冒险', exact: true }).click()
    await expect(page.getByTestId('adventure-game-player')).toBeVisible()
    await expect(workspace).toHaveValue(String(fixture.scope.projectId))
  }
  await productNav.getByRole('link', { name: '首页', exact: true }).click()
  await productNav.getByRole('link', { name: '文字冒险', exact: true }).click()
  await expect(workspace).toHaveValue(String(fixture.scope.projectId))
  await page.reload()
  await expect(page.getByTestId('adventure-game-player')).toBeVisible()
  await expect(workspace).toHaveValue(String(fixture.scope.projectId))

  await page.locator('summary').filter({ hasText: '冒险存档' }).click()
  await page.getByRole('button', { name: /^导航回归游戏 .*可继续/ }).click()
  await expect(page).toHaveURL(new RegExp(`adventure/play\\?[^#]*[?&]session=${fixture.sessionId}(?:&|$)`))
  await expect(page.getByRole('button', { name: '退出游戏', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '退出游戏', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '退出游戏', exact: true }).click()
  await expect(page.getByRole('heading', { name: '下一段故事，由你选择。' })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await adventureNav.getByRole('link', { name: '创作工作台', exact: true }).click()
  await expect(workspace).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  // A stale/mismatched work must not silently load a different work or expose its player.
  await page.goto(`./adventure/library?project=${fixture.scope.projectId}&work=999999`)
  await expect(page.getByTestId('adventure-game-player')).toHaveCount(0)
  expect(errors).toEqual([])
})
