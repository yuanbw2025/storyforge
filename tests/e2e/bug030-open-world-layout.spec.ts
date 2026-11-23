import { expect, test, type Page, type TestInfo } from '@playwright/test'
const routes = ['library', 'vision', 'systems', 'production', 'map', 'actions', 'quests', 'review', 'media-all', 'release', 'play', 'playmap', 'history', 'runtime']
const playerRoutes = ['library', 'play', 'playmap', 'history', 'runtime']
test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'BUG030-isolated'))
  await context.route('**/*', async route => {
    const r = route.request(), url = new URL(r.url())
    if (url.hostname !== '127.0.0.1' || !['GET', 'HEAD'].includes(r.method())) throw new Error(`BUG030 unauthorized network: ${r.method()} ${url.origin}${url.pathname}`)
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
    return { worlds: await db.worldReleases.toArray(), releases: await db.productReleases.toArray(), builds: await db.productBuilds.count(), sessions: await db.productRuntimeSessions.count(), events: await db.productRuntimeEvents.count() }
  })
}
for (const width of [1728, 1366, 390]) {
  test(`BUG030 private open-world routes, sources and immutable saves at ${width}px`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 }); await page.goto('./openworld/runtime')
    const workspace = page.getByRole('combobox', { name: '创作工作区', exact: true })
    await expect(workspace).toBeVisible(); await expect(page.locator('.open-world-product-page')).toBeVisible()
    await expect(page.getByRole('link', { name: '游玩内置短篇：潮痕，两声之间', exact: true })).toBeVisible()
    await shot(page, info, `after-empty-${width}`)
    const seed = await page.evaluate(async () => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<unknown>
      const a = await load('/storyforge/tests/helpers/text-open-world-product-session.ts') as typeof import('../helpers/text-open-world-product-session')
      const f = await load('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts') as typeof import('../helpers/text-open-world-vnext-fixture')
      const w = await load('/storyforge/tests/helpers/current-product-world.ts') as typeof import('../helpers/current-product-world')
      const s = await a.createGovernedTextOpenWorldSessionFixtureV1({ name: '030长标题与原版本存档🌊'.repeat(5), textOpenWorldVNext: f.createTextOpenWorldVNextFixture(), runtimeShape: 'vnext-only', title: '030旧存档不升级', seed: '030-owned' })
      const source = await w.seedCurrentProductWorld('030冻结世界与长标题来源🌊'.repeat(4))
      return { scope: s.scope, sessionId: s.session.id!, creatorScope: source.scope }
    })
    await workspace.selectOption(String(seed.scope.projectId))
    const player = page.getByTestId('text-open-world-player')
    await expect(player).toBeVisible()
    const search = page.getByRole('textbox', { name: '搜索文字开放世界', exact: true })
    await expect(search).toBeVisible(); expect((await search.boundingBox())!.width).toBeLessThanOrEqual(321)
    const before = await snapshot(page)
    await search.fill('不存在的开放世界')
    await expect(page.getByRole('status')).toContainText('没有匹配的作品')
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    const release = page.locator('.textgame-catalog-list article button').first()
    await expect(release).toBeVisible(); await release.click()
    await expect(page.getByRole('region', { name: '文字开放世界游戏详情', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '新旅程', exact: true })).toBeEnabled()
    await shot(page, info, `after-detail-${width}`)
    await page.getByRole('button', { name: '返回全部游戏', exact: true }).click()
    expect(await snapshot(page)).toEqual(before)
    await shot(page, info, `after-library-${width}`)
    const geometry = []
    for (const route of routes) {
      const scope = playerRoutes.includes(route) ? seed.scope : seed.creatorScope
      await page.goto(`./openworld/${route}?project=${scope.projectId}&work=${scope.workId}`)
      await expect(workspace).toHaveValue(String(scope.projectId))
      await expect(page.locator('.open-world-product-page .lf-heading h2')).toBeVisible()
      if (playerRoutes.includes(route)) await expect(page.getByTestId('text-open-world-player')).toBeVisible()
      else await expect(page.getByTestId('text-open-world-creator-studio')).toBeVisible()
      const size = await page.locator('.product-frame-content').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, top: el.getBoundingClientRect().top, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth }))
      geometry.push({ route, ...size }); expect(size.scrollWidth, route).toBeLessThanOrEqual(size.width + 1); expect(size.pageWidth, route).toBeLessThanOrEqual(size.viewport + 1)
      expect(size.top).toBeLessThan(220)
      if (['vision', 'production', 'review', 'release'].includes(route)) await shot(page, info, `after-${route}-${width}`)
    }
    await info.attach(`route-geometry-${width}`, { body: JSON.stringify(geometry), contentType: 'application/json' })
    expect(await snapshot(page)).toEqual(before)
    // Restore the exact existing formal save. No new start, action or production.
    await page.goto(`./openworld/runtime?project=${seed.scope.projectId}&work=${seed.scope.workId}&session=${seed.sessionId}`)
    const shell = page.getByTestId('text-open-world-shell')
    await expect(shell).toBeVisible(); await expect(page.getByTestId('text-open-world-main-view')).toBeVisible()
    await page.reload(); await expect(shell).toBeVisible()
    await shot(page, info, `after-runtime-${width}`)
    expect(await snapshot(page)).toEqual(before)
    // The other branch must not acquire this product's styling opt-in.
    await page.goto('./adventure/library')
    await expect(page.locator('.adventure-compact-ui')).toBeVisible(); await expect(page.locator('.open-world-product-page')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('BUG030 prioritizes the selected library over independent examples without hiding either', async ({ page }, info) => {
  await page.goto('./openworld/runtime')
  const seed = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<unknown>
    const a = await load('/storyforge/tests/helpers/text-open-world-product-session.ts') as typeof import('../helpers/text-open-world-product-session')
    const f = await load('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts') as typeof import('../helpers/text-open-world-vnext-fixture')
    const s = await a.createGovernedTextOpenWorldSessionFixtureV1({ name: '030有效操作优先', textOpenWorldVNext: f.createTextOpenWorldVNextFixture(), runtimeShape: 'vnext-only', title: '030保持原存档', seed: '030-priority' })
    return { scope: s.scope, sessionId: s.session.id! }
  })
  await page.getByRole('combobox', { name: '创作工作区', exact: true }).selectOption(String(seed.scope.projectId))
  const before = await snapshot(page), geometry = []
  for (const width of [1728, 1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const player = page.getByTestId('text-open-world-player')
    await expect(player).toBeVisible()
    const library = page.locator('.product-frame-content>.lf-paper').filter({ has: player })
    const examples = page.locator('.builtin-game-shelf')
    expect((await library.boundingBox())!.y).toBeLessThan((await examples.boundingBox())!.y)
    await expect(examples).toBeVisible()
    const size = await page.locator('.product-frame-content').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }))
    geometry.push({ viewport: width, surface: 'library', ...size }); expect(size.scrollWidth).toBeLessThanOrEqual(size.width + 1)
    await page.locator('.product-frame-content').evaluate(el => { el.scrollTop = 0 })
    await shot(page, info, `after-priority-library-${width}`)
  }
  await page.goto(`./openworld/runtime?project=${seed.scope.projectId}&work=${seed.scope.workId}&session=${seed.sessionId}`)
  await expect(page.getByTestId('text-open-world-shell')).toBeVisible()
  for (const width of [1728, 1366, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const size = await page.locator('.product-frame-content').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }))
    geometry.push({ viewport: width, surface: 'runtime', ...size }); expect(size.scrollWidth).toBeLessThanOrEqual(size.width + 1)
    await expect(page.getByTestId('text-open-world-main-view')).toBeVisible()
    await shot(page, info, `after-priority-runtime-${width}`)
  }
  expect(await snapshot(page)).toEqual(before)
  await info.attach('priority-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
})
