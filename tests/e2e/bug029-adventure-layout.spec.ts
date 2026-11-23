import { expect, test, type Page, type TestInfo } from '@playwright/test'
const routes = ['library', 'vision', 'systems', 'production', 'map', 'actions', 'quests', 'review', 'media-all', 'release', 'play', 'playmap', 'history', 'runtime']
const primary: Record<string, string> = { library: '作品与试玩', vision: '产品定向', production: '自动制作', review: '质量与素材', release: '发布与导出', play: '开始冒险' }
test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'BUG029-isolated'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' || !['GET', 'HEAD'].includes(request.method())) throw new Error(`BUG029 unauthorized network: ${request.method()} ${url.origin}${url.pathname}`)
    await route.continue()
  })
})
async function shot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`); await page.screenshot({ path, fullPage: true }); await info.attach(name, { path, contentType: 'image/png' })
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<typeof import('../../src/lib/db/schema')>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { worlds: await db.worldReleases.toArray(), builds: await db.productBuilds.toArray(), sessions: await db.productRuntimeSessions.toArray(), events: await db.productRuntimeEvents.count() }
  })
}
for (const width of [1728, 1366, 390]) {
  test(`BUG029 adventure library and complete private route shell at ${width}px`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 }); await page.goto('./adventure/library')
    const workspace = page.getByRole('combobox', { name: '创作工作区', exact: true })
    await expect(workspace).toBeVisible()
    await expect(page.locator('.adventure-page-empty')).toBeVisible()
    expect((await workspace.boundingBox())!.width).toBeLessThanOrEqual(width === 390 ? 390 : 261)
    await shot(page, info, `after-empty-${width}`)
    const scope = await page.evaluate(async () => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<unknown>
      const w = await load('/storyforge/tests/helpers/current-product-world.ts') as typeof import('../helpers/current-product-world')
      const b = await load('/storyforge/tests/helpers/current-product-build.ts') as typeof import('../helpers/current-product-build')
      const f = await load('/storyforge/tests/helpers/text-adventure-v2-foundation.ts') as typeof import('../helpers/text-adventure-v2-foundation')
      const owned = await w.seedCurrentProductWorld('029长标题工作区：潮钟群岛的原文与存档🌊'.repeat(3))
      const catalog = await w.loadCurrentProductWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: owned.release.id!, productType: 'text-adventure' })
      const runtimePackage = f.createTextAdventureFoundationRuntimePackageV2({ worldRelease: owned.release, sourceCatalog: catalog })
      runtimePackage.definition.title = '潮钟群岛与最后一封信🌊'.repeat(2)
      await b.seedCurrentProductBuild({ scope: owned.scope, worldRelease: owned.release, runtimePackage, title: runtimePackage.definition.title })
      return owned.scope
    })
    await workspace.selectOption(String(scope.projectId))
    await expect(page.getByTestId('adventure-game-player')).toBeVisible()
    await expect(page.getByRole('region', { name: '推荐冒险', exact: true })).toBeVisible()
    const search = page.getByRole('textbox', { name: '搜索文字冒险', exact: true })
    expect((await search.boundingBox())!.width).toBeLessThanOrEqual(321)
    await search.fill('没有这部作品')
    await expect(page.getByRole('status')).toContainText('没有匹配的作品')
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await expect(page.getByRole('region', { name: '推荐冒险', exact: true })).toContainText('潮钟群岛与最后一封信🌊'.repeat(2))
    await shot(page, info, `after-library-${width}`)
    const before = await snapshot(page), geometry = []
    const query = `project=${scope.projectId}&work=${scope.workId}`
    for (const route of routes) {
      if (primary[route]) {
        const nav = page.getByRole('navigation', { name: '文字冒险制作导航', exact: true })
        if (!await nav.isVisible()) await page.getByRole('button', { name: '页面目录', exact: true }).click()
        await nav.getByRole('link', { name: primary[route], exact: true }).click()
      } else await page.goto(`./adventure/${route}?${query}`)
      await expect(page).toHaveURL(url => url.pathname.endsWith(`/adventure/${route}`))
      await expect(workspace).toHaveValue(String(scope.projectId))
      await expect(page.locator('.adventure-product-page .lf-heading h2')).toBeVisible()
      await expect(page.getByText('正在读取…', { exact: true })).toBeHidden()
      if (['library', 'play', 'playmap', 'history', 'runtime'].includes(route)) await expect(page.getByTestId('adventure-game-player')).toBeVisible()
      const size = await page.locator('.product-frame-content').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, contentTop: el.getBoundingClientRect().top, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth }))
      geometry.push({ route, ...size })
      expect(size.scrollWidth, `${route} content overflow`).toBeLessThanOrEqual(size.width + 1)
      expect(size.pageWidth, `${route} document overflow`).toBeLessThanOrEqual(size.viewport + 1)
      expect(size.contentTop, `${route} oversized header`).toBeLessThan(240)
      if (['vision', 'production', 'map', 'review', 'release', 'history'].includes(route)) await shot(page, info, `after-${route}-${width}`)
    }
    await info.attach(`route-geometry-${width}`, { body: JSON.stringify(geometry), contentType: 'application/json' })
    expect(await snapshot(page)).toEqual(before)
    expect(errors).toEqual([])
  })
}

test('BUG029 enabled author configuration retains source and start boundaries at all widths', async ({ page }, info) => {
  await page.goto('./adventure/vision')
  const scope = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<unknown>
    const w = await load('/storyforge/tests/helpers/current-product-world.ts') as typeof import('../helpers/current-product-world')
    return (await w.seedCurrentProductWorld('029仅配置不生产')).scope
  })
  await page.getByRole('combobox', { name: '创作工作区', exact: true }).selectOption(String(scope.projectId))
  await page.getByRole('button', { name: '为当前项目显式启用', exact: true }).click()
  const studio = page.getByTestId('product-production-studio')
  await expect(studio).toBeVisible()
  await expect(page.getByRole('combobox', { name: '冻结 WorldRelease', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '产品形态', exact: true })).toHaveValue('text-adventure')
  const before = await snapshot(page), geometry = []
  for (const width of [1728, 1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const size = await page.locator('.product-frame-content').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }))
    geometry.push({ viewport: width, ...size })
    expect(size.scrollWidth).toBeLessThanOrEqual(size.width + 1)
    await expect(page.getByRole('combobox', { name: '游戏规模', exact: true })).toBeVisible()
    await shot(page, info, `after-enabled-vision-${width}`)
  }
  await info.attach('enabled-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
  expect(await snapshot(page)).toEqual(before)
})
