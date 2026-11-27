import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { COMIC_PAGES } from '../../src/components/comic/navigation'

const evidence = resolve(process.env.BUG023_ARTIFACT_DIR ?? 'test-results/comic-layout-023')
const title = '暴雨旧站与黎明前的抉择——保留作者完整长标题的漫画布局隔离验收'
const planning = new Set(['facts', 'causal', 'brief', 'decisions', 'script', 'rhythm', 'visual'])
const planningNames: Record<string, string> = { facts: '原作事实', causal: '因果关系', decisions: '删改决定', script: '漫画脚本', rhythm: '分页节奏' }

for (const width of [1728, 1366, 390]) test(`023 comic routes keep usable work areas at ${width}px`, async ({ page }) => {
  test.setTimeout(180000)
  await mkdir(evidence, { recursive: true })
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '023-isolated'))
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('./comic/library', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '新建漫画改编', exact: true }).click()
  await page.getByRole('button', { name: '冻结来源并创建漫画', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('请填写漫画名称')
  await page.getByLabel('来源方式', { exact: true }).selectOption('import')
  await page.getByLabel('漫画名称', { exact: true }).fill(title)
  await page.getByLabel('导入原作内容').fill('这是隔离预览，不提交真实作品。')
  await page.screenshot({ path: resolve(evidence, `${width}-create.png`), fullPage: true })
  const fixture = await page.evaluate(async title => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const fixtures = await load('/storyforge/tests/helpers/sfqa043-comic.ts')
    const f = await fixtures.createSfqa043ComicFixtureV1()
    await fixtures.addSfqa043MediaAndPageV1(f)
    const { switchActiveWork, updateActiveWork } = await load('/storyforge/src/lib/workspace/works.ts')
    await switchActiveWork(f.scope.projectId, f.scope.workId)
    await updateActiveWork(f.scope.projectId, { title })
    const { listActiveSourceUnits } = await load('/storyforge/src/lib/adaptation/source-manifest.ts')
    const units = await listActiveSourceUnits(f.adaptation.id)
    return { workId: f.scope.workId as number, sourceIndex: units.findIndex((unit: any) => unit.sourceUnitKey === f.unit.sourceUnitKey) }
  }, title)
  const workId = fixture.workId
  expect(fixture.sourceIndex).toBeGreaterThanOrEqual(0)
  const geometry: unknown[] = []
  for (const [id] of COMIC_PAGES) {
    await page.goto(`./comic/${id}?work=${workId}`)
    await expect(page.locator('.lf-heading h2')).toBeVisible()
    if (id === 'library') {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await page.getByLabel('搜索漫画').fill('不存在的漫画')
      await expect(page.locator('.cp-books article')).toHaveCount(0)
    } else if (id === 'settings') await expect(page.getByText('示例作品库', { exact: true })).toBeAttached()
    else {
      await expect(page.locator('.cp-source-status')).toBeVisible()
      if (planning.has(id)) {
        await expect(page.locator('.cp-planning fieldset')).toBeVisible()
        if (planningNames[id] && await page.locator('.cp-planning .cp-record').count() === 0)
          await page.getByRole('button', { name: `添加${planningNames[id]}`, exact: true }).click()
      }
      if (id === 'source') {
        await page.getByRole('navigation', { name: '原作来源单元' }).getByRole('button').nth(fixture.sourceIndex).click()
        await expect(page.getByRole('article', { name: '原作内容' })).toContainText('林岚')
      }
      if (id === 'layout' || id === 'lettering' || id === 'media') await expect(page.locator('.comic-page-board')).toBeVisible()
      if (id === 'references') await expect(page.locator('.comic-visual-layout')).toBeVisible()
      if (id === 'preview') await expect(page.locator('.cp-reading-page>svg')).toBeVisible()
      if (id === 'review' || id === 'versions') await expect(page.locator('.comic-qa')).toBeVisible()
    }
    const box = await page.evaluate(() => {
      const main = document.querySelector('.lf-main')!
      const view = document.querySelector('.comic-layout, .cp-planning, .cp-source, .comic-visual-layout, .cp-reader, .comic-qa')
      return { documentWidth: document.documentElement.scrollWidth, mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth, workTop: view?.getBoundingClientRect().top ?? null }
    })
    geometry.push({ id, ...box })
    expect(box.documentWidth).toBeLessThanOrEqual(width)
    expect(box.mainScrollWidth).toBeLessThanOrEqual(box.mainWidth + 1)
    if (box.workTop !== null) expect(box.workTop).toBeLessThan(width === 390 ? 540 : 420)
    await page.screenshot({ path: resolve(evidence, `${width}-${id}.png`), fullPage: true })
  }
  await writeFile(resolve(evidence, `${width}-routes.json`), JSON.stringify(geometry, null, 2))
  await page.goto('./comic/layout')
  await expect(page.locator('.cp-empty')).toBeVisible()
  await page.screenshot({ path: resolve(evidence, `${width}-no-work.png`), fullPage: true })
})

test('023 narrow canvas still enlarges from 100 to 120 percent inside its own scroller', async ({ page }) => {
  await mkdir(evidence, { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '023-zoom'))
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('./comic/library', { waitUntil: 'networkidle' })
  const workId = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const fixtures = await load('/storyforge/tests/helpers/sfqa043-comic.ts')
    const f = await fixtures.createSfqa043ComicFixtureV1()
    await fixtures.addSfqa043MediaAndPageV1(f)
    return f.scope.workId as number
  })
  await page.goto(`./comic/layout?work=${workId}`)
  const zoom = page.getByLabel('画布缩放')
  await expect(zoom).toHaveValue('85')
  await zoom.press('End')
  await expect(zoom).toHaveValue('120')
  await page.locator('.comic-page-board').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  const width120 = await page.locator('.comic-page-board').evaluate(element => element.getBoundingClientRect().width)
  for (let i = 0; i < 4; i++) await zoom.press('ArrowLeft')
  await expect(zoom).toHaveValue('100')
  await page.locator('.comic-page-board').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  const width100 = await page.locator('.comic-page-board').evaluate(element => element.getBoundingClientRect().width)
  expect(width120).toBeGreaterThan(width100 + 1)
  expect(width120 / width100).toBeCloseTo(1.2, 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await writeFile(resolve(evidence, '390-zoom.json'), JSON.stringify({ width100, width120 }, null, 2))
  await page.screenshot({ path: resolve(evidence, '390-zoom.png'), fullPage: true })
})
