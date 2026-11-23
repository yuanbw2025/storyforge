import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MOTION_PAGES } from '../../src/components/motion-drama/navigation'

const evidence = resolve(process.env.BUG024_ARTIFACT_DIR ?? 'test-results/motion-layout-024')
const title = '末班车与未完成的告别——保留作者长标题及全部前期生产边界的漫剧素材'

for (const width of [1728, 1366, 390]) test(`024 all motion-material routes stay usable at ${width}px`, async ({ page }) => {
  test.setTimeout(180000)
  await mkdir(evidence, { recursive: true })
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '024-isolated'))
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('./motion/library', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '新建素材项目', exact: true }).click()
  await page.getByRole('button', { name: '创建漫剧素材', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('请填写漫剧素材名称')
  await page.getByLabel('漫剧素材名称', { exact: true }).fill(title)
  await page.getByLabel('来源方式', { exact: true }).selectOption('premise')
  await page.getByLabel('一句话故事', { exact: true }).fill('检票员从旧车票听见一场未完成的告别。')
  await page.screenshot({ path: resolve(evidence, `${width}-create.png`), fullPage: true })
  const workId = await page.evaluate(async title => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const fixtures = await load('/storyforge/tests/helpers/motion-drama-reference-release.ts')
    const f = await fixtures.createMotionDramaReferenceReleaseFixtureV1({ unusedVoice: true })
    const { switchActiveWork, updateActiveWork } = await load('/storyforge/src/lib/workspace/works.ts')
    await switchActiveWork(f.scope.projectId, f.scope.workId)
    await updateActiveWork(f.scope.projectId, { title })
    return f.scope.workId as number
  }, title)
  const measurements: unknown[] = []
  for (const [id] of MOTION_PAGES) {
    await page.goto(`./motion/${id}?work=${workId}`)
    await expect(page.locator('.lf-heading h2')).toBeVisible()
    if (id === 'library') {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await page.getByLabel('搜索漫剧素材').fill('不存在的素材项目')
      await expect(page.locator('.mm-books article')).toHaveCount(0)
    } else if (id === 'settings') await expect(page.getByText('示例作品库', { exact: true })).toBeAttached()
    else {
      await expect(page.getByTestId('motion-drama-studio')).toBeVisible()
      await expect(page.getByLabel('当前漫剧集数')).toHaveValue('1')
      if (id === 'source') await expect(page.locator('.motion-source-summary')).toContainText('完整正文')
      if (id === 'assets') {
        await page.getByLabel('搜索物料').fill('不存在的物料')
        await expect(page.locator('.motion-assets article')).toHaveCount(0)
        await page.getByLabel('搜索物料').clear()
        await expect(page.locator('.motion-assets article')).toHaveCount(2)
      }
    }
    const geometry = await page.evaluate(() => {
      const main = document.querySelector('.lf-main')!
      const stage = document.querySelector('.motion-stage-head')
      return { documentWidth: document.documentElement.scrollWidth, mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth, stageTop: stage?.getBoundingClientRect().top ?? null }
    })
    measurements.push({ id, ...geometry })
    expect(geometry.documentWidth).toBeLessThanOrEqual(width)
    expect(geometry.mainScrollWidth).toBeLessThanOrEqual(geometry.mainWidth + 1)
    if (geometry.stageTop !== null) expect(geometry.stageTop).toBeLessThan(width === 390 ? 580 : 400)
    await page.screenshot({ path: resolve(evidence, `${width}-${id}.png`), fullPage: true })
    if (id === 'series' && width === 390) {
      await page.getByRole('button', { name: '编辑本页内容', exact: true }).click()
      const candidate = page.locator('.motion-candidate')
      await expect(candidate).toBeVisible()
      const box = await candidate.boundingBox()
      expect(box!.width).toBeLessThanOrEqual(width)
      await candidate.getByText('高级 JSON', { exact: true }).click()
      const json = candidate.getByLabel('候选 JSON', { exact: true })
      const original = await json.inputValue()
      await json.fill('{')
      await candidate.getByRole('button', { name: '确认写入', exact: true }).click()
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(candidate).toBeVisible()
      await expect(json).toHaveValue('{')
      await page.screenshot({ path: resolve(evidence, '390-candidate-save-failure.png'), fullPage: true })
      await json.fill(original)
      await page.getByRole('alert').getByRole('button').click()
      await candidate.getByLabel('内容 · 核心主题', { exact: true }).fill('024 作者布局草稿')
      await expect(candidate.getByRole('status')).toContainText('编辑草稿已保存')
      await candidate.getByRole('button', { name: '关闭候选', exact: true }).click()
      await page.reload()
      await page.getByRole('button', { name: '编辑本页内容', exact: true }).click()
      await expect(candidate.getByLabel('内容 · 核心主题', { exact: true })).toHaveValue('024 作者布局草稿')
      await page.screenshot({ path: resolve(evidence, '390-candidate-restored.png'), fullPage: true })
      await candidate.getByRole('button', { name: '关闭候选', exact: true }).click()
    }
    if (id === 'prompts') {
      await page.getByRole('button', { name: '打开提示词设置', exact: true }).click()
      const library = page.locator('.motion-prompt-library')
      await expect(library).toBeVisible()
      expect((await library.boundingBox())!.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: resolve(evidence, `${width}-prompt-library.png`), fullPage: true })
      await library.locator('header>button').click()
    }
  }
  await writeFile(resolve(evidence, `${width}-routes.json`), JSON.stringify(measurements, null, 2))
  await page.goto('./motion/source')
  await expect(page.locator('.mm-empty')).toBeVisible()
  await page.screenshot({ path: resolve(evidence, `${width}-no-work.png`), fullPage: true })
})

test('024 narrow execution-pack descriptions keep their readable column', async ({ page }) => {
  await mkdir(evidence, { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '024-pack-isolated'))
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('./motion/library', { waitUntil: 'networkidle' })
  const workId = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const fixtures = await load('/storyforge/tests/helpers/motion-drama-reference-release.ts')
    const f = await fixtures.createMotionDramaReferenceReleaseFixtureV1()
    return f.scope.workId as number
  })
  await page.goto(`./motion/pack?work=${workId}`)
  const purpose = page.locator('.motion-slot-map>div>p')
  await expect(purpose.first()).toBeAttached()
  const widths = await purpose.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))
  expect(Math.min(...widths)).toBeGreaterThan(100)
  const columns = await page.locator('.motion-execution-shots>article>header>em').evaluateAll(elements => elements.map(element => getComputedStyle(element).gridColumnStart))
  expect(columns.length).toBeGreaterThan(0)
  expect(columns.every(column => column === '1')).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await purpose.first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(evidence, '390-pack-purpose.png'), fullPage: true })
  await writeFile(resolve(evidence, '390-pack-columns.json'), JSON.stringify({ widths, columns }, null, 2))
})
