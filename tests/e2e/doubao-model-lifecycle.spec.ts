import { expect, test, type Page } from '@playwright/test'
const official = 'https://ark.cn-beijing.volces.com/api/v3'
const retired = 'doubao-1-5-pro-32k-250115'
const active = 'doubao-seed-2-0-lite-260428'
async function setup(page: Page, provider: string, model: string, baseUrl: string) {
  await page.addInitScript(config => {
    if (localStorage.getItem('issue243-seeded')) return
    localStorage.setItem('issue243-seeded', 'true')
    localStorage.setItem('storyforge_guide_completed', 'synthetic')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ ...config, apiKey: '', temperature: 0.2, maxTokens: 1000 }))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'synthetic-only')
  }, { provider, model, baseUrl })
  let modelCalls = 0
  await page.route(/^https?:\/\//, async route => {
    if (/\/(chat\/completions|responses|messages|embeddings|models)(?:\?.*)?$/.test(route.request().url())) { modelCalls++; return route.abort() }
    return ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()
  })
  await page.goto('./home/settings')
  return () => modelCalls
}
test('new Doubao configuration selects current LTS without sending a model request', async ({ page }) => {
  const calls = await setup(page, 'gemini', 'gemini-author-fixture', 'https://generativelanguage.googleapis.com/v1beta/openai')
  await page.locator('label:has-text("提供商") + select').selectOption('doubao')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(active)
  await page.reload()
  await expect(page.getByPlaceholder('或手动输入模型名（列表中没有的型号）')).toHaveValue(active)
  expect(calls()).toBe(0)
})
for (const [model, date] of [[retired, '2026-09-21'], ['deepseek-v4-pro-260425', '2026-11-24']] as const) {
  for (const [baseUrl, showNotice] of [[official, true], ['https://example.invalid/private/v1', false]] as const) {
    test(`saved old ID remains unchanged on ${showNotice ? 'official' : 'private'} target: ${model}`, async ({ page }) => {
      const calls = await setup(page, 'doubao', model, baseUrl)
      await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue(model)
      const notice = page.getByRole('alert').filter({ hasText: date })
      if (showNotice) await expect(notice).toBeVisible()
      else await expect(notice).toHaveCount(0)
      const option = page.getByRole('option', { name: new RegExp(model) })
      if (showNotice) await expect(option).toBeDisabled()
      else await expect(option).toBeEnabled()
      await page.reload()
      await expect(page.getByPlaceholder('或手动输入模型名（列表中没有的型号）')).toHaveValue(model)
      expect(calls()).toBe(0)
    })
  }
}
