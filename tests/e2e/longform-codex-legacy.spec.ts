import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

const legacy = [['humEra', '盐镇旧纪元'], ['humEvent', '盐镇旧事件'], ['humSociety', '盐镇旧社会']] as const
async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, '旧词条兼容维护隔离验收')
  const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  await openLongformLeaf(page, '人文环境'); await expect(page).toHaveURL(/module=worldview-humanity/)
  const entries = await page.evaluate(async ({ projectId, legacy }) => {
    const imp = new Function('p', 'return import(p)')
    const { useCodexStore } = await imp('/storyforge/src/stores/codex.ts')
    await useCodexStore.getState().loadAll(projectId)
    const result: Array<{ key: string; name: string; id: number }> = []
    for (const [key, name] of legacy) {
      const category = useCodexStore.getState().categories.find((row: { builtInKey: string }) => row.builtInKey === key)
      const id = await useCodexStore.getState().addEntry({ projectId, categoryId: category.id, name, summary: '旧记录原简介', description: '应当可以查看、修改和保留的旧版作者数据', fields: '{}', refs: '{}', order: 0 })
      result.push({ key, name, id })
    }
    return result
  }, { projectId, legacy })
  return { projectId, entries }
}
async function jump(page: Page, name: string) {
  await page.getByPlaceholder('搜索本面板词条（支持全字匹配 / 单字模糊定位）').fill(name)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByText(name, { exact: true }).filter({ visible: true }).click()
  await expect(page.locator('input[placeholder="名称"]:visible')).toHaveValue(name)
}

test('all three legacy categories remain searchable, editable and reloadable without creating another history producer', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const { entries } = await setup(page)
  for (const entry of entries) {
    await jump(page, entry.name)
    const region = page.getByRole('region', { name: entry.key === 'humSociety' ? '旧版政经文化词条' : '旧版历史词条' })
    await expect(region.getByRole('button', { name: '新建词条', exact: true })).toHaveCount(0)
    await expect(region.getByRole('button', { name: /AI .*词条/ })).toHaveCount(0)
    await region.getByPlaceholder('一句话简介', { exact: true }).fill(`${entry.name}的修订简介`)
    await openLongformLeaf(page, '故事设计'); await expect(page).toHaveURL(/module=story-design/)
    await page.reload(); await openLongformLeaf(page, '人文环境'); await expect(page).toHaveURL(/module=worldview-humanity/)
    await jump(page, entry.name)
    await expect(page.locator('input[placeholder="一句话简介"]:visible')).toHaveValue(`${entry.name}的修订简介`)
    const row = await page.evaluate(async id => {
      const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
      return db.codexEntries.get(id)
    }, entry.id)
    expect(row.id).toBe(entry.id); expect(row.origin).toBe('manual')
  }
  expect(errors).toEqual([])
})

test('search cannot replace a legacy editor while its author draft failed to save', async ({ page }) => {
  const { entries } = await setup(page)
  await jump(page, entries[0].name)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.codexEntries.update.bind(db.codexEntries)
    db.codexEntries.update = async () => { throw new DOMException('旧词条写入故障', 'QuotaExceededError') }
    Object.assign(window, { restoreLegacyWrite: () => { db.codexEntries.update = update } })
  })
  await page.locator('input[placeholder="一句话简介"]:visible').fill('仍须保留的旧纪元修改')
  await expect(page.getByRole('alert').filter({ hasText: '旧词条写入故障' }).first()).toBeVisible()
  await page.getByPlaceholder('搜索本面板词条（支持全字匹配 / 单字模糊定位）').fill(entries[1].name)
  await page.getByRole('button', { name: new RegExp(entries[1].name) }).click()
  await expect(page.getByRole('alert').filter({ hasText: '作者编辑保存失败' }).first()).toBeVisible()
  await expect(page.locator('input[placeholder="名称"]:visible')).toHaveValue(entries[0].name)
  await expect(page.locator('input[placeholder="一句话简介"]:visible')).toHaveValue('仍须保留的旧纪元修改')
  await page.evaluate(() => (window as unknown as { restoreLegacyWrite: () => void }).restoreLegacyWrite())
  await page.getByRole('button', { name: '重试保存词条', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '输入已保留' })).toHaveCount(0)
  await page.getByRole('button', { name: new RegExp(entries[1].name) }).click()
  await page.getByText(entries[1].name, { exact: true }).filter({ visible: true }).click()
  await expect(page.locator('input[placeholder="名称"]:visible')).toHaveValue(entries[1].name)
})
