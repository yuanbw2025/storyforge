import { expect, test } from '@playwright/test'

test('Codex reuses login, saves a keyless preset and survives reload without account logout', async ({ page }) => {
  const calls: string[] = []
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/local-codex/v1/**', async route => {
    const path = new URL(route.request().url()).pathname; calls.push(path)
    const json = path.endsWith('/status') ? { state: 'ready', label: 'te***@example.com', plan: 'pro', version: 'Codex fixture' }
      : path.endsWith('/models') ? { models: [{ id: 'test-model', label: 'Test', isDefault: true }] }
        : path.endsWith('/requests') ? { records: [] } : { disconnected: true }
    await route.fulfill({ json })
  })
  await page.goto('./home/settings')
  await page.locator('label:has-text("提供商") + select').selectOption('codex')
  const card = page.getByRole('region', { name: 'Codex 本机连接' })
  await expect(card.getByRole('status')).toContainText('已登录')
  await expect(card.getByRole('button', { name: '使用 ChatGPT 登录' })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Codex 模型', exact: true }).selectOption('test-model')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Codex 模型', exact: true })).toHaveValue('test-model')
  await expect(card.getByRole('status')).toContainText('已登录')
  await card.getByRole('button', { name: '停止连接' }).click()
  await expect(card.getByRole('status')).toContainText('账号仍保持登录')
  expect(calls.some(path => path.endsWith('/login') || path.includes('logout'))).toBe(false)
  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('storyforge-ai-config')!))
  expect(cfg.apiKey).toBe(''); expect(cfg.provider).toBe('codex')
})

test('Codex wrong-auth and missing local bridge give actionable errors', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/local-codex/v1/**', route => route.fulfill({ json: route.request().url().endsWith('/status') ? { state: 'wrong-auth', message: '当前 Codex 使用 API Key；不会代替订阅。' } : { records: [] } }))
  await page.goto('./home/settings')
  await page.locator('label:has-text("提供商") + select').selectOption('codex')
  const card = page.getByRole('region', { name: 'Codex 本机连接' })
  await expect(card.getByRole('status')).toContainText('不会代替订阅')
  await expect(card.getByRole('button', { name: '使用 ChatGPT 登录' })).toBeVisible()
  await page.route('**/local-codex/v1/**', route => route.fulfill({ contentType: 'text/html', body: '<html>static site</html>' }))
  await card.getByRole('button', { name: '检测连接 / 刷新模型与记录' }).click()
  await expect(card.getByRole('alert')).toContainText('本机连接服务不可用')
})
