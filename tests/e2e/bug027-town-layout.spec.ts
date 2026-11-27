import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { TOWN_PAGES, TOWN_PRIMARY, townPrimary } from '../../src/components/ai-town/author-navigation'

// Fresh Playwright contexts only: no existing Chrome profile, credentials,
// models, remote APIs or author manuscripts participate in these UI checks.
test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'BUG027-isolated'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' || !['GET', 'HEAD'].includes(request.method())) {
      throw new Error(`BUG027 unexpected network request: ${request.method()} ${url.origin}${url.pathname}`)
    }
    await route.continue()
  })
})
async function settled(page: Page) {
  await expect(page.getByTestId('town-author-page')).toBeVisible()
  await expect(page.getByText('读取AI 小镇作品…', { exact: true })).toBeHidden()
}
async function geometry(page: Page) {
  return page.locator('.lf-content').evaluate(el => ({
    clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
    contentTop: el.getBoundingClientRect().top,
    viewportWidth: document.documentElement.clientWidth, pageWidth: document.documentElement.scrollWidth,
  }))
}
async function shot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await info.attach(name, { path, contentType: 'image/png' })
}
for (const width of [1728, 1366, 390]) {
  test(`BUG027 library and every town route remain reachable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('./town/library'); await settled(page)
    await expect(page.locator('.town-library-empty')).toContainText('还没有自己的小镇')
    const search = page.getByLabel('搜索小镇', { exact: true })
    expect((await search.boundingBox())!.width).toBeLessThanOrEqual(321)
    const gallery = page.getByTestId('community-prototype-gallery')
    const install = gallery.getByRole('button', { name: '导入原型并准备游玩', exact: true }).first()
    await expect(install).toBeVisible()
    // Even on narrow screens the example's action should fit the first viewport.
    expect((await install.boundingBox())!.y + (await install.boundingBox())!.height).toBeLessThanOrEqual(900)
    await shot(page, info, `after-library-empty-${width}`)
    await page.getByRole('button', { name: '新建小镇', exact: true }).click()
    await expect(page.getByLabel('小镇名称', { exact: true })).toBeVisible()
    const longTitle = '潮声里的公共书屋与邻居们🌊'.repeat(8)
    await page.getByLabel('小镇名称', { exact: true }).fill(longTitle)
    await page.getByLabel('生活愿景与开场目标').fill('保留自己的生活愿景。一起修复茶屋，不自动开始制作。')
    await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
    await expect(page).toHaveURL(/project=\d+&work=\d+/)
    const query = new URL(page.url()).search
    const baseline = await page.evaluate(async () => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<typeof import('../../src/lib/db/schema')>
      const { db } = await load('/storyforge/src/lib/db/schema.ts')
      return { drafts: await db.aiTownAuthoringDrafts.toArray(), builds: await db.productBuilds.count(), sessions: await db.productRuntimeSessions.count() }
    })
    const coverage: Array<{ route: string; clientWidth: number; scrollWidth: number; contentTop: number }> = []
    // Traverse the real SPA menus instead of reloading the entire application
    // for every route inside one test. Save, scope and route behavior stay active.
    for (const [route, label] of TOWN_PAGES) {
      const primary = TOWN_PRIMARY.find(([id]) => id === townPrimary(route))!
      const menu = page.getByRole('navigation', { name: 'AI 小镇页面导航', exact: true })
      if (!await menu.isVisible()) await page.getByRole('button', { name: 'AI 小镇目录', exact: true }).click()
      await menu.getByRole('button', { name: primary[1], exact: true }).click()
      if (route !== primary[2]) {
        const contents = page.getByRole('navigation', { name: 'AI 小镇内容导航', exact: true })
        if (!await contents.isVisible()) await page.getByRole('button', { name: '内容目录', exact: true }).click()
        await contents.getByRole('button', { name: label, exact: true }).click()
      }
      await expect(page).toHaveURL(url => url.pathname.endsWith(`/town/${route}`))
      await settled(page)
      if (route === 'vision') await expect(page.getByLabel('小镇名称', { exact: true })).toHaveValue(longTitle)
      if (route === 'community' || route === 'library') await expect(gallery.locator('article').first()).toBeVisible()
      const size = await geometry(page)
      coverage.push({ route, ...size })
      expect(size.pageWidth, `${route}: document overflow`).toBeLessThanOrEqual(size.viewportWidth + 1)
      expect(size.scrollWidth, `${route}: content overflow`).toBeLessThanOrEqual(size.clientWidth + 1)
      expect(size.contentTop, `${route}: oversized header`).toBeLessThan(350)
      if (['library', 'vision', 'rhythm', 'source', 'agent', 'production', 'characters', 'play', 'release', 'community'].includes(route)) {
        await shot(page, info, `after-${route}-${width}`)
      }
    }
    await info.attach(`route-geometry-${width}`, { body: JSON.stringify(coverage, null, 2), contentType: 'application/json' })
    await page.goto(`./town/library${query}`); await settled(page)
    await expect(page.locator('.town-library-card h3')).toHaveText(longTitle)
    await search.fill('没有这个小镇')
    await expect(page.getByRole('status')).toContainText('没有匹配的小镇')
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await expect(page.locator('.town-library-card h3')).toHaveText(longTitle)
    const after = await page.evaluate(async () => {
      const load = new Function('p', 'return import(p)') as (p: string) => Promise<typeof import('../../src/lib/db/schema')>
      const { db } = await load('/storyforge/src/lib/db/schema.ts')
      return { drafts: await db.aiTownAuthoringDrafts.toArray(), builds: await db.productBuilds.count(), sessions: await db.productRuntimeSessions.count() }
    })
    expect(after).toEqual(baseline)
    expect(errors).toEqual([])
  })
}

test('BUG027 catalog failure stays visible without hiding new-town or search controls', async ({ page }, info) => {
  await page.route('**/prototypes/catalog.json', route => route.abort('failed'))
  await page.goto('./town/library'); await settled(page)
  await expect(page.getByRole('button', { name: '新建小镇', exact: true })).toBeEnabled()
  await expect(page.getByLabel('搜索小镇', { exact: true })).toBeVisible()
  await expect(page.getByTestId('community-prototype-gallery').getByRole('alert')).toBeVisible()
  await shot(page, info, 'after-gallery-failure')
})
