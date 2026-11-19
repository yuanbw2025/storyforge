import { test, expect, type Page } from '@playwright/test'
import { TTRPG_PAGES } from '../../src/components/ttrpg/author-navigation'
import { seedCurrentTtrpgProduct } from './helpers/current-products'

const sizes = [{ width: 1728, height: 997 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.lf-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
}

test('战役工具、空库、长标题和搜索在桌面与窄屏可用', async ({ page }, info) => {
  for (const size of sizes) {
    await page.setViewportSize(size)
    await page.goto('./ttrpg/library')
    await expect(page.getByRole('button', { name: '新建战役', exact: true })).toBeVisible()
    await expect(page.locator('.sf-community-game').first()).toBeVisible()
    if (size.width > 700) {
      expect((await page.getByRole('region', { name: '战役工具' }).boundingBox())!.height).toBeLessThanOrEqual(160)
      const start = (await page.getByRole('button', { name: '开始一场新冒险' }).first().boundingBox())!
      expect(start.y + start.height).toBeLessThan(size.height)
    }
    await fits(page)
    await page.screenshot({ path: info.outputPath(`empty-${size.width}.png`) })
  }
  await page.getByLabel('启用开放跑团试用', { exact: true }).check()
  await expect(page.getByRole('button', { name: '新建开放跑团（预览）', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('启用开放跑团试用', { exact: true })).toBeChecked()
  await page.getByLabel('启用开放跑团试用', { exact: true }).uncheck()
  await page.getByRole('button', { name: '新建战役', exact: true }).click()
  // Leaving an untouched new form must not create a work.
  await page.getByRole('button', { name: '跑团目录', exact: true }).click()
  await page.getByRole('navigation', { name: '跑团页面导航', exact: true }).getByRole('button', { name: '作品库', exact: true }).click()
  await expect(page.locator('.lf-library-grid article')).toHaveCount(0)
  await page.getByRole('button', { name: '新建战役', exact: true }).click()
  const title = '长标题战役'.repeat(30)
  await page.getByLabel('战役名称', { exact: true }).fill(title)
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page).toHaveURL(/project=/)
  await page.goto('./ttrpg/library')
  for (const size of sizes) {
    await page.setViewportSize(size)
    await expect(page.locator('.lf-library-grid h3')).toHaveText(title)
    await fits(page)
    await page.screenshot({ path: info.outputPath(`long-title-${size.width}.png`) })
    await page.getByLabel('搜索战役').fill('不匹配的搜索')
    await expect(page.getByRole('status').filter({ hasText: '没有找到匹配的战役' })).toBeVisible()
    await expect(page.locator('.lf-library-grid article')).toHaveCount(0)
    await fits(page)
    await page.screenshot({ path: info.outputPath(`no-results-${size.width}.png`) })
    await page.getByLabel('搜索战役').fill('')
  }
  await page.getByRole('button', { name: '删除作品', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.lf-library-grid article')).toHaveCount(1)
  await page.getByRole('button', { name: '删除作品', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除作品', exact: true }).click()
  await expect(page.locator('.lf-library-grid article')).toHaveCount(0)
})

// Keep every page/viewport pair independently bounded. A single 75-navigation
// case exhausted its total deadline before the last page on shared CI runners.
for (const size of sizes) {
  for (const [id, title] of TTRPG_PAGES) {
    test(`跑团 ${title}（${id}）在 ${size.width}px 保持可达和自然宽度`, async ({ page }, info) => {
      await page.setViewportSize(size)
      const seed = await seedCurrentTtrpgProduct(page, { title: '布局检查战役', gmMode: 'human', playerController: 'human' })
      await page.goto(`./ttrpg/${id}?project=${seed.projectId}&production=${seed.productionId}&session=${seed.sessionId}`)
      await expect(page.getByTestId('ttrpg-author-page')).toBeVisible()
      await expect(page.locator('.lf-content')).not.toContainText('打开功能…')
      await expect(page.locator('.lf-content')).not.toContainText('读取跑团作品…')
      await fits(page)
      await page.screenshot({ path: info.outputPath(`${id}-${size.width}.png`) })
    })
  }
}
