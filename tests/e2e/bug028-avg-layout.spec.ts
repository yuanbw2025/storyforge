import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { AVG_PAGES, AVG_PRIMARY_NAV, avgPrimaryForPage } from '../../src/components/avg/navigation'

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'BUG028-isolated'))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' || !['GET', 'HEAD'].includes(request.method())) {
      throw new Error(`BUG028 unauthorized network: ${request.method()} ${url.origin}${url.pathname}`)
    }
    await route.continue()
  })
})
async function settled(page: Page) {
  await expect(page.getByTestId('avg-page')).toBeVisible()
  await expect(page.getByText('读取 AVG 作品…', { exact: true })).toBeHidden()
  await expect(page.getByText('打开功能…', { exact: true })).toBeHidden()
}
async function navigate(page: Page, route: string) {
  const primary = AVG_PRIMARY_NAV.find(([id]) => id === avgPrimaryForPage(route))!
  const menu = page.getByRole('navigation', { name: 'AVG 页面导航', exact: true })
  if (!await menu.isVisible()) await page.getByRole('button', { name: 'AVG 目录', exact: true }).click()
  await menu.getByRole('button', { name: primary[1], exact: true }).click()
  if (route !== primary[2]) {
    const contents = page.getByRole('navigation', { name: 'AVG 内容导航', exact: true })
    if (!await contents.isVisible()) await page.getByRole('button', { name: primary[0] === 'player' ? '游玩目录' : '制作目录', exact: true }).click()
    await contents.getByRole('button', { name: AVG_PAGES.find(([id]) => id === route)![1], exact: true }).click()
  }
  await expect(page).toHaveURL(url => url.pathname.endsWith(`/avg/${route}`))
  await settled(page)
}
async function shot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true }); await info.attach(name, { path, contentType: 'image/png' })
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<typeof import('../../src/lib/db/schema')>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { drafts: await db.avgAuthoringDrafts.toArray(), works: await db.works.toArray(), builds: await db.productBuilds.count(), sessions: await db.productRuntimeSessions.count() }
  })
}
for (const width of [1728, 1366, 390]) {
  test(`BUG028 AVG private layouts and linked routes at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto('./avg/library'); await settled(page)
    await expect(page.locator('.avg-library-empty')).toContainText('这里尚无作品')
    const search = page.getByLabel('搜索 AVG', { exact: true })
    expect((await search.boundingBox())!.width).toBeLessThanOrEqual(321)
    const example = page.getByRole('link', { name: '开始体验雾港', exact: true })
    await expect(example).toBeVisible()
    const box = (await example.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(900)
    await shot(page, info, `after-library-empty-${width}`)
    await page.getByRole('button', { name: '新建 AVG', exact: true }).click()
    await expect(page.getByLabel('AVG 作品名称', { exact: true })).toHaveValue('')
    await navigate(page, 'library')
    expect((await snapshot(page)).works).toHaveLength(0)
    await page.getByRole('button', { name: '新建 AVG', exact: true }).click()
    const title = '雾港与最后一封信🌊'.repeat(8)
    await page.getByLabel('AVG 作品名称', { exact: true }).fill(title)
    await page.getByRole('textbox', { name: '开场与核心目标', exact: true }).fill('在灯塔寻找遗失的信，保留作者原文。')
    await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
    await expect(page).toHaveURL(/project=\d+&work=\d+/)
    await page.reload(); await settled(page)
    await expect(page.getByRole('textbox', { name: '开场与核心目标', exact: true })).toHaveValue('在灯塔寻找遗失的信，保留作者原文。')
    const before = await snapshot(page)
    const geometry = []
    for (const [route] of AVG_PAGES) {
      await navigate(page, route)
      const size = await page.locator('.lf-content').evaluate(el => ({ contentTop: el.getBoundingClientRect().top,
        width: el.clientWidth, scrollWidth: el.scrollWidth, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth }))
      geometry.push({ route, ...size })
      expect(size.pageWidth, `${route} document overflow`).toBeLessThanOrEqual(size.viewport)
      expect(size.scrollWidth, `${route} content overflow`).toBeLessThanOrEqual(size.width + 1)
      expect(size.contentTop, `${route} oversized shell`).toBeLessThan(350)
      if (['library', 'source', 'vision', 'routes', 'agent', 'production', 'narrative', 'release', 'play'].includes(route)) await shot(page, info, `after-${route}-${width}`)
    }
    await info.attach(`route-geometry-${width}`, { body: JSON.stringify(geometry), contentType: 'application/json' })
    await navigate(page, 'library')
    await expect(page.locator('.avg-library-card h3')).toHaveText(title)
    await expect(page.locator('.avg-library-card')).toContainText('游玩与存档')
    await expect(page.locator('.avg-library-card')).toContainText('删除')
    await search.fill('没有此作品')
    await expect(page.locator('.avg-library-empty')).toContainText('没有匹配的 AVG')
    await page.getByRole('button', { name: '清除搜索', exact: true }).click()
    await expect(page.locator('.avg-library-card h3')).toHaveText(title)
    expect(await snapshot(page)).toEqual(before)
    // Native authoring uses the same private shell. Do not start a build or
    // any media/model operation: only inspect each existing editing subpage.
    const nativeQuery = new URL(page.url()).searchParams
    nativeQuery.set('assembly', '1')
    const nativeGeometry = []
    for (const route of ['production', 'narrative', 'variables', 'visual', 'audio', 'media-all', 'review', 'release', 'confirm']) {
      if (!nativeGeometry.length) { await page.goto(`./avg/${route}?${nativeQuery}`); await settled(page) }
      else await navigate(page, route)
      const workbench = page.getByRole('region', { name: '系统与效果组装（实验）', exact: true })
      await expect(workbench).toBeVisible()
      const size = await page.locator('.lf-content').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }))
      nativeGeometry.push({ route, ...size })
      expect(size.scrollWidth, `native ${route} overflow`).toBeLessThanOrEqual(size.width + 1)
      if (['production', 'narrative', 'release'].includes(route)) await shot(page, info, `after-native-${route}-${width}`)
    }
    await info.attach(`native-geometry-${width}`, { body: JSON.stringify(nativeGeometry), contentType: 'application/json' })
    expect(await snapshot(page)).toEqual(before)
    expect(errors).toEqual([])
  })
}
