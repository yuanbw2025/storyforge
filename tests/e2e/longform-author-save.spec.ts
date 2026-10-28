import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

// Observe the same failed page without replaying navigation or changing the
// assertion. Distinguish a slow dev module graph from a persistent app failure.
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus || page.isClosed()) return
  const initial = await page.locator('body').innerText().catch(() => '')
  const started = Date.now()
  let lateReady = false
  try { await page.locator('[data-workspace-ready]').waitFor({ state: 'visible', timeout: 20_000 }); lateReady = true } catch { /* Retain the original failure. */ }
  await info.attach('same-page-readiness-observation', {
    body: JSON.stringify({ initialLoadingOnly: initial.trim() === '加载中…', lateReady, observedAfterMs: Date.now() - started,
      resources: await page.evaluate(() => performance.getEntriesByType('resource').length).catch(() => null), driverHeapBytes: process.memoryUsage().heapUsed }),
    contentType: 'application/json',
  })
})

const scalarFields: Array<[string, string, string, 'worldviews' | 'storyCores']> = [
  ['世界起源', '世界来源', 'worldOrigin', 'worldviews'], ['世界起源', '力量体系', 'powerHierarchy', 'worldviews'],
  ['自然环境', '世界结构', 'worldStructure', 'worldviews'], ['自然环境', '疆域尺寸', 'worldDimensions', 'worldviews'],
  ['自然环境', '地貌分布', 'continentLayout', 'worldviews'], ['自然环境', '山川水系', 'mountainsRivers', 'worldviews'],
  ['自然环境', '气候环境', 'climateByRegion', 'worldviews'], ['自然环境', '自然资源', 'naturalResourceOverview', 'worldviews'],
  ['人文环境', '种族与民族', 'races', 'worldviews'], ['人文环境', '势力分布', 'factionLayout', 'worldviews'],
  ['人文环境', '城池重镇', 'regionDimensions', 'worldviews'], ['人文环境', '政治制度', 'politicsOverview', 'worldviews'],
  ['人文环境', '经济制度', 'economyOverview', 'worldviews'], ['人文环境', '文化制度', 'cultureOverview', 'worldviews'],
  ['人文环境', '矛盾冲突', 'internalConflicts', 'worldviews'], ['人文环境', '道具与器物', 'itemDesign', 'worldviews'],
  ['故事设计', '一句话故事', 'logline', 'storyCores'], ['故事设计', '故事概念', 'concept', 'storyCores'],
  ['故事设计', '故事主题', 'theme', 'storyCores'], ['故事设计', '核心冲突', 'centralConflict', 'storyCores'],
  ['故事设计', '故事模式', 'plotPattern', 'storyCores'], ['故事设计', '故事主线意图', 'mainPlot', 'storyCores'],
  ['故事设计', '故事复线意图', 'subPlots', 'storyCores'],
]
async function create(page: Page, title: string) {
  await page.addInitScript(() => { localStorage.setItem('storyforge_guide_completed', 'e2e') })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  await createLongform(page, title)
  return Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
}
async function openField(page: Page, module: string, label: string) {
  await openLongformLeaf(page, module)
  if (module === '世界起源') await page.locator('.worldview-origin-nav').getByRole('button', { name: label, exact: true }).click()
  else if (module === '故事设计') await page.getByLabel('故事字段').getByRole('button').filter({ has: page.getByText(label, { exact: true }) }).click({ timeout: 15_000 })
  else await page.getByRole('button', { name: new RegExp(`${label}$`) }).last().click({ timeout: 15_000 })
}
async function read(page: Page, projectId: number, table: string) {
  return page.evaluate(async ({ projectId, table }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { readOwnedRows, resolveScopeLike } = await importer('/storyforge/src/lib/workspace/scope.ts')
    return (await readOwnedRows(await resolveScopeLike(projectId), table))[0] ?? null
  }, { projectId, table })
}
async function editFirst(page: Page, text: string) {
  await page.locator('div.cursor-text:visible').first().click()
  const editor = page.locator('textarea:visible').first()
  await editor.fill(text)
  await editor.press('Tab')
  await expect(editor).not.toBeVisible()
}

test('23 scalar author fields save edits and clearing through their real UI and survive reload', async ({ page }) => {
  test.setTimeout(360_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const projectId = await create(page, '逐字段作者保存隔离验收')
  for (const [module, label, field, table] of scalarFields) {
    await test.step(`${module} / ${label}: write, reload, clear, reload`, async () => {
      console.log(`author field ${field}`)
      await openField(page, module, label)
      const text = `作者手改·${field}：先建立因果，再推进冲突。\n第二行保持中文内容。`
      await editFirst(page, text)
      await expect.poll(async () => (await read(page, projectId, table))?.[field]).toBe(text)
      await page.reload(); await openField(page, module, label)
      await expect(page.locator('div.cursor-text:visible').first()).toHaveText(text)
      await editFirst(page, '')
      await page.reload(); await openField(page, module, label)
      expect((await read(page, projectId, table))?.[field]).toBe('')
    })
  }
  expect(errors).toEqual([])
})

for (const [module, label, field, table] of [scalarFields[0], scalarFields[6], scalarFields[8], scalarFields[18]]) {
test(`rejected ${field} write keeps the draft and retries without a page crash`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const projectId = await create(page, '作者保存失败恢复隔离验收')
  await openField(page, module, label)
  await editFirst(page, '已保存的世界来源')
  await page.evaluate(async table => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const original = db[table].update.bind(db[table])
    db[table].update = async () => { throw new DOMException('隔离配额耗尽', 'QuotaExceededError') }
    Object.assign(window, { restoreAuthorWrite: () => { db[table].update = original } })
  }, table)
  await page.locator('div.cursor-text:visible').first().click()
  const editor = page.locator('textarea:visible').first()
  await editor.fill('写入失败但必须保留的中文草稿'); await editor.press('Tab')
  await expect(page.getByRole('alert').filter({ hasText: '隔离配额耗尽' })).toBeVisible()
  await expect(editor).toHaveValue('写入失败但必须保留的中文草稿')
  expect((await read(page, projectId, table))?.[field]).toBe('已保存的世界来源')
  await page.evaluate(() => { (window as unknown as { restoreAuthorWrite: () => void }).restoreAuthorWrite() })
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await page.reload(); await openField(page, module, label)
  expect((await read(page, projectId, table))?.[field]).toBe('写入失败但必须保留的中文草稿')
  expect(errors).toEqual([])
})

}

test('structured resource and divinity leaves retain siblings, support clearing, and survive hiding and reload', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const projectId = await create(page, '结构化子项作者保存隔离验收')
  const editAt = async (index: number, value: string) => {
    await page.locator('div.cursor-text:visible').nth(index).click()
    const editor = page.locator('textarea:visible').first()
    await editor.fill(value); await editor.press('Tab'); await expect(editor).not.toBeVisible()
  }
  await openField(page, '自然环境', '自然资源')
  await page.getByText('自然资源分类明细（原生结构）', { exact: true }).click()
  const resources = { rareCreatures: '鹤与驮兽', herbs: '救命草', minerals: '寒铁', others: '盐茶' }
  for (const [index, value] of Object.values(resources).entries()) await editAt(index + 1, value)
  await page.reload(); await openField(page, '自然环境', '自然资源')
  expect((await read(page, projectId, 'worldviews'))?.naturalResources).toEqual(resources)
  await page.getByText('自然资源分类明细（原生结构）', { exact: true }).click()
  for (let index = 0; index < 4; index++) await editAt(index + 1, '')
  await page.reload(); await openField(page, '自然环境', '自然资源')
  expect((await read(page, projectId, 'worldviews'))?.naturalResources).toEqual({ rareCreatures: '', herbs: '', minerals: '', others: '' })
  await openField(page, '世界起源', '神明与信仰')
  const toggle = page.getByRole('checkbox', { name: '存在神明或宗教信仰' })
  await toggle.check()
  const divinity = { hasDivinity: true, divineRank: '凡俗与山神', divineNames: '守桥神', divineRules: '不得代替凡人选择' }
  for (const [index, value] of [divinity.divineRank, divinity.divineNames, divinity.divineRules].entries()) await editAt(index, value)
  await toggle.uncheck()
  await expect.poll(async () => (await read(page, projectId, 'worldviews'))?.divineDesign?.hasDivinity).toBe(false)
  await page.reload(); await openField(page, '世界起源', '神明与信仰')
  await expect(toggle).not.toBeChecked()
  expect((await read(page, projectId, 'worldviews'))?.divineDesign).toEqual({ ...divinity, hasDivinity: false })
  await toggle.check()
  for (let index = 0; index < 3; index++) await editAt(index, '')
  await page.reload(); await openField(page, '世界起源', '神明与信仰')
  expect((await read(page, projectId, 'worldviews'))?.divineDesign).toEqual({ hasDivinity: true, divineRank: '', divineNames: '', divineRules: '' })
  expect(errors).toEqual([])
})
