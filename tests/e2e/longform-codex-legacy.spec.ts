import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

const fixtures = [['humEra', '盐镇旧纪元'], ['humEvent', '盐镇旧事件'], ['humSociety', '盐镇旧社会'], ['humPolitics', '盐镇现行政体']] as const
async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, '旧词条兼容维护隔离验收')
  const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  await openLongformLeaf(page, '人文环境'); await expect(page).toHaveURL(/module=worldview-humanity/)
  const entries = await page.evaluate(async ({ projectId, fixtures }) => {
    const imp = new Function('p', 'return import(p)')
    const { useCodexStore } = await imp('/storyforge/src/stores/codex.ts')
    await useCodexStore.getState().loadAll(projectId)
    const result: Array<{ key: string; name: string; id: number; categoryId: number }> = []
    for (const [key, name] of fixtures) {
      const category = useCodexStore.getState().categories.find((row: { builtInKey: string }) => row.builtInKey === key)
      const id = await useCodexStore.getState().addEntry({ projectId, categoryId: category.id, name, summary: '旧记录原简介', description: '应当可以查看、修改和保留的旧版作者数据', fields: '{}', refs: '{}', order: 0 })
      result.push({ key, name, id, categoryId: category.id })
    }
    return result
  }, { projectId, fixtures })
  return { projectId, entries }
}
async function jump(page: Page, name: string) {
  await page.getByPlaceholder('搜索词条', { exact: true }).fill(name)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByText(name, { exact: true }).filter({ visible: true }).click()
  await expect(page.locator('input[placeholder="名称"]:visible')).toHaveValue(name)
}

async function readHistoryRows(page: Page, entries: Array<{ key: string; id: number; categoryId: number }>) {
  const history = entries.filter(entry => entry.key === 'humEra' || entry.key === 'humEvent')
  return page.evaluate(async ids => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return {
      categories: await db.codexCategories.bulkGet(ids.categories),
      entries: await db.codexEntries.bulkGet(ids.entries),
    }
  }, { categories: history.map(entry => entry.categoryId), entries: history.map(entry => entry.id) })
}

test('humanity opens a real field, removes duplicate history navigation and preserves original legacy rows', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const { entries } = await setup(page)
  const original = await readHistoryRows(page, entries)
  const panel = page.locator('.lf-world-panel')
  await expect(panel.locator('.lf-world-toolbar h3')).toHaveText('🧬 种族与民族')
  await expect(panel.getByRole('button', { name: /历史年表/ })).toHaveCount(0)
  await expect(panel.getByRole('region', { name: '旧版历史词条' })).toHaveCount(0)
  for (const entry of entries.filter(entry => entry.key === 'humEra' || entry.key === 'humEvent')) {
    await page.getByPlaceholder('搜索词条', { exact: true }).fill(entry.name)
    await expect(panel.getByRole('button', { name: new RegExp(entry.name) })).toHaveCount(0)
  }
  const society = entries.find(entry => entry.key === 'humSociety')!
  await jump(page, society.name)
  const region = page.getByRole('region', { name: '旧版政经文化词条' })
  await expect(region.getByRole('button', { name: '新建词条', exact: true })).toHaveCount(0)
  await expect(region.getByRole('button', { name: /AI .*词条/ })).toHaveCount(0)
  await region.getByPlaceholder('一句话简介', { exact: true }).fill(`${society.name}的修订简介`)
  await openLongformLeaf(page, '故事设计'); await expect(page).toHaveURL(/module=story-design/)
  await page.reload(); await openLongformLeaf(page, '人文环境'); await expect(page).toHaveURL(/module=worldview-humanity/)
  await jump(page, society.name)
  await expect(page.locator('input[placeholder="一句话简介"]:visible')).toHaveValue(`${society.name}的修订简介`)
  await openLongformLeaf(page, '历史年表'); await expect(page).toHaveURL(/module=history(?:&|$)/)
  expect(await readHistoryRows(page, entries)).toEqual(original)
  expect(errors).toEqual([])
})

test('search cannot replace a legacy editor while its author draft failed to save', async ({ page }) => {
  const { entries } = await setup(page)
  const society = entries.find(entry => entry.key === 'humSociety')!
  const politics = entries.find(entry => entry.key === 'humPolitics')!
  await jump(page, society.name)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.codexEntries.update.bind(db.codexEntries)
    db.codexEntries.update = async () => { throw new DOMException('旧词条写入故障', 'QuotaExceededError') }
    Object.assign(window, { restoreLegacyWrite: () => { db.codexEntries.update = update } })
  })
  await page.locator('input[placeholder="一句话简介"]:visible').fill('仍须保留的旧社会修改')
  await expect(page.getByRole('alert').filter({ hasText: '旧词条写入故障' }).first()).toBeVisible()
  await page.getByPlaceholder('搜索词条', { exact: true }).fill(politics.name)
  await page.getByRole('button', { name: new RegExp(politics.name) }).click()
  await expect(page.getByRole('alert').filter({ hasText: '作者编辑保存失败' }).first()).toBeVisible()
  await expect(page.locator('input[placeholder="名称"]:visible')).toHaveValue(society.name)
  await expect(page.locator('input[placeholder="一句话简介"]:visible')).toHaveValue('仍须保留的旧社会修改')
  await page.evaluate(() => (window as unknown as { restoreLegacyWrite: () => void }).restoreLegacyWrite())
  await page.getByRole('button', { name: '重试保存词条', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '输入已保留' })).toHaveCount(0)
  await page.getByRole('button', { name: new RegExp(politics.name) }).click()
  await page.getByText(politics.name, { exact: true }).filter({ visible: true }).click()
  await expect(page.locator('input[placeholder="名称"]:visible')).toHaveValue(politics.name)
})
