import { test, expect } from '@playwright/test'

test('runtime errors survive refresh and remain local until the author opens a reviewed feedback handoff', async ({ page }) => {
  const reports: string[] = []
  await page.route('**/api/feedback', async route => {
    reports.push(route.request().url())
    await route.fulfill({ status: 500, body: 'Local interception: no real submission' })
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'failure-feedback-isolated-check'))
  await page.goto('home/settings')
  await expect(page.getByRole('region', { name: '问题与故障反馈' })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    localStorage.setItem('failure-test-private-config', 'API-PRIVATE-SENTINEL')
    const error = new TypeError('MANUSCRIPT-PRIVATE-SENTINEL')
    error.stack = 'TypeError: MANUSCRIPT-PRIVATE-SENTINEL\n at render (http://localhost/storyforge/assets/example-app.js:40:2)'
    window.dispatchEvent(new ErrorEvent('error', { error }))
  })
  await page.reload()
  const panel = page.getByRole('region', { name: '问题与故障反馈' })
  await panel.getByRole('button', { name: '查看故障摘要并反馈' }).click()
  const preview = panel.getByLabel('故障摘要预览')
  await expect(preview).toContainText('TypeError')
  await expect(preview).not.toContainText('PRIVATE-SENTINEL')
  const link = panel.getByRole('link', { name: '带摘要打开官方反馈表单' })
  const href = await link.getAttribute('href')
  expect(href).toMatch(/^https:\/\/docs\.storyforge-lab\.com\/feedback\/bug#storyforge-report=/)
  expect(reports).toEqual([])
  await panel.getByRole('button', { name: '清空本地错误记录' }).click()
  await expect(preview).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('failure-test-private-config'))).toBe('API-PRIVATE-SENTINEL')
  expect(reports).toEqual([])
})

test('an application module loading failure still offers a database-independent local feedback preview', async ({ page }) => {
  await page.route('**/src/main.tsx*', route => route.abort())
  await page.goto('home/settings')
  const button = page.getByRole('button', { name: '查看故障摘要并反馈' })
  await expect(button).toBeVisible()
  await button.click()
  await expect(page.locator('#root pre')).toContainText('bootstrap')
  await expect(page.getByRole('link', { name: '带摘要打开官方反馈表单（不会自动提交）' })).toHaveAttribute('href', /#storyforge-report=/)
})
