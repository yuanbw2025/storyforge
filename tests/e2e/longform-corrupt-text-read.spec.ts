import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

for (const [module, label, table, field] of [
  ['世界起源', '世界来源', 'worldviews', 'worldOrigin'],
  ['自然环境', '气候环境', 'worldviews', 'climateByRegion'],
  ['人文环境', '种族与民族', 'worldviews', 'races'],
  ['故事设计', '一句话故事', 'storyCores', 'logline'],
]) {
  test(`${field}: a corrupt text object remains readable without crashing or rewriting the original`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      return ['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) ? route.continue() : route.abort()
    })
    await createLongform(page, `坏字段回读隔离验收 ${field}`)
    const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
    const original = { legacy: '必须完整保留的旧字段', nested: ['原始数组成员'] }
    const recordId = await page.evaluate(async ({ projectId, table, field, original }) => {
      const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const [{ db }, { resolveScope, stampNewRecord }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts')])
      const scope = await resolveScope({ projectId })
      // Deliberately corrupt fixture, outside the production writer; never an author database.
      return db[table].add(stampNewRecord(scope, table, { projectId, [field]: original, createdAt: 1, updatedAt: 1 }))
    }, { projectId, table, field, original })
    await openLongformLeaf(page, module)
    if (module === '世界起源') await page.locator('.worldview-origin-nav').getByRole('button', { name: label, exact: true }).click()
    else if (module === '故事设计') await page.getByLabel('故事字段').getByRole('button').filter({ has: page.getByText(label, { exact: true }) }).click()
    else await page.getByRole('button', { name: new RegExp(`${label}$`) }).last().click()
    const warning = page.getByRole('alert').filter({ hasText: '字段内容格式异常' }).first()
    await expect(warning).toBeVisible({ timeout: 15_000 })
    await warning.getByText('查看原始字段内容', { exact: true }).click()
    await expect(warning.locator('pre').first()).toHaveText(JSON.stringify(original, null, 2))
    if (module === '自然环境' || module === '人文环境') {
      await page.getByRole('button', { name: 'AI 从内容拆分词条', exact: true }).click()
      await expect(page.getByText('拆分来源文本格式异常，请先恢复上游字段。', { exact: true })).toBeVisible()
    }
    const preserved = await page.evaluate(async ({ table, recordId, field }) => {
      const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
      return (await db[table].get(recordId))[field]
    }, { table, recordId, field })
    expect(preserved).toEqual(original)
    expect(errors).toEqual([])
  })
}
