import { expect, test } from '@playwright/test'

const production = process.env.PLAYWRIGHT_PRODUCTION_PREVIEW === '1'

test('settings select environment-appropriate proxies and preserve explicit endpoints after refresh', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./home/settings')
  await page.locator('label:has-text("提供商") + select').selectOption('deepseek')
  const chatBase = page.locator('label:has-text("Base URL") + input').first()
  await chatBase.fill('https://api.deepseek.com/v1')
  const proxy = page.getByRole('button', { name: '🔄 切换到本地代理', exact: true })
  if (production) {
    await expect(proxy).toHaveCount(0)
    await expect(page.getByText('线上部署不自带本地代理。', { exact: false })).toBeVisible()
  } else {
    await proxy.click()
    await expect(chatBase).toHaveValue('/deepseek-proxy/v1')
  }
  // An explicitly configured reverse proxy is never overwritten merely by opening settings.
  await chatBase.fill('/deepseek-proxy/v1')
  await page.reload()
  await expect(chatBase).toHaveValue('/deepseek-proxy/v1')
  await page.getByRole('button', { name: '🔗 恢复直连', exact: true }).click()
  await expect(chatBase).toHaveValue('https://api.deepseek.com/v1')

  const embedding = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '独立语义检索服务' }) })
  await embedding.locator('summary').click()
  await embedding.getByRole('checkbox').check()
  await embedding.getByRole('button', { name: /硅基流动 · bge-m3/ }).click()
  const embeddingBase = embedding.locator('label:has-text("Base URL") + input')
  const expected = production ? 'https://api.siliconflow.cn/v1' : '/siliconflow-proxy/v1'
  await expect(embeddingBase).toHaveValue(expected)
  await page.reload()
  await embedding.locator('summary').click()
  await expect(embeddingBase).toHaveValue(expected)
  if (production) await expect(page.getByRole('button', { name: /切换到本地代理/ })).toHaveCount(0)
  await embeddingBase.fill('/glm-proxy/api/paas/v4')
  await page.reload()
  await embedding.locator('summary').click()
  await expect(embeddingBase).toHaveValue('/glm-proxy/api/paas/v4')
  await embedding.getByRole('button', { name: /切换到直连/ }).click()
  await expect(embeddingBase).toHaveValue('https://open.bigmodel.cn/api/paas/v4')
})
