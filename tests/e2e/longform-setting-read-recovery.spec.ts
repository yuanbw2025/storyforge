import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

for (const module of ['世界起源', '自然环境', '人文环境', '故事设计']) {
  test(`${module}: a failed settings read releases loading, protects canonical data and retries visibly`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      return ['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) ? route.continue() : route.abort()
    })
    await createLongform(page, `设定读失败隔离验收·${module}`)
    const id = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
    await openLongformLeaf(page, '世界起源')
    await page.locator('div.cursor-text:visible').first().click()
    const text = page.locator('textarea:visible').first()
    await text.fill('读取失败也不能改写的正式世界来源'); await text.press('Tab'); await expect(text).not.toBeVisible()
    await openLongformLeaf(page, module === '故事设计' ? '自然环境' : '故事设计')
    const original = await page.evaluate(async id => {
      const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
      const row = await db.worldviews.where('projectId').equals(id).first()
      const where = db.worldviews.where.bind(db.worldviews)
      db.worldviews.where = () => { throw new Error('设定读取故障测试') }
      Object.assign(window, { restoreSettingRead: () => { db.worldviews.where = where } })
      return row
    }, id)
    await openLongformLeaf(page, module)
    await expect(page.getByRole('alert').filter({ hasText: '设定读取故障测试' })).toBeVisible()
    const boundary = page.locator('fieldset[aria-label="设定读取保护"]')
    await expect(boundary).toHaveAttribute('disabled', '')
    await expect(boundary).toHaveAttribute('inert', '')
    await expect(page.locator('div.cursor-text:visible').first().click({ timeout: 350 })).rejects.toThrow()
    const state = await page.evaluate(async recordId => {
      const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const [{ db }, { useWorldviewStore }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/stores/worldview.ts')])
      return { loading: useWorldviewStore.getState().loading, row: await db.worldviews.get(recordId) }
    }, original.id)
    expect(state.loading).toBe(false); expect(state.row).toEqual(original); expect(errors).toEqual([])
    await page.evaluate(() => (window as unknown as { restoreSettingRead: () => void }).restoreSettingRead())
    await page.getByRole('button', { name: '重新读取设定', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '设定读取故障测试' })).toHaveCount(0)
    await expect(boundary).not.toHaveAttribute('disabled', '')
    await expect(boundary).not.toHaveAttribute('inert', '')
    await openLongformLeaf(page, '世界起源')
    await expect(page.locator('div.cursor-text:visible').first()).toHaveText('读取失败也不能改写的正式世界来源')
    expect(errors).toEqual([])
  })
}
