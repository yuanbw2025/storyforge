import { expect, test, type Page } from '@playwright/test'
import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'

const officialGemini = 'https://generativelanguage.googleapis.com/v1beta/openai'

async function seedConfig(page: Page, model: string, baseUrl = officialGemini) {
  registerBrowserFixtureAIConfigV1(page, { provider: 'gemini', model, baseUrl, apiKey: 'synthetic-session-only', temperature: 0.3, maxTokens: 1024 }, { once: true })
  await page.addInitScript(() => {
    if (localStorage.getItem('issue214-seeded')) return
    localStorage.setItem('issue214-seeded', 'true')
    localStorage.setItem('storyforge_guide_completed', 'issue214-synthetic')
  })
}

async function mockTransport(page: Page) {
  const calls = { models: 0, generation: 0 }
  await page.route(/\/models(?:\?.*)?$/, async route => {
    calls.models += 1
    await route.fulfill({ json: { data: [{ id: 'gemini-3.6-flash' }, { id: 'gemini-2.0-flash' }] } })
  })
  await page.route(/\/(?:chat\/completions|responses|messages|embeddings)(?:\?.*)?$/, async route => {
    calls.generation += 1
    await route.fulfill({ status: 500, json: { error: { message: 'unexpected synthetic generation' } } })
  })
  return calls
}

test('手动型号在模型列表刷新和页面刷新后保留，只有显式选择才切换', async ({ page }) => {
  await seedConfig(page, 'gemini-3.5-flash')
  const calls = await mockTransport(page)
  await gotoWithBrowserFixtureAIConfigV1(page, './home/settings')
  const manual = page.getByPlaceholder('或手动输入模型名（列表中没有的型号）')
  await manual.fill('gemini-author-fixture-next')
  await page.locator('button[title="从当前服务刷新模型列表"]').click()
  const models = page.getByRole('combobox', { name: '服务返回的模型列表' })
  await expect(models).toBeVisible()
  await expect(manual).toHaveValue('gemini-author-fixture-next')
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(manual).toHaveValue('gemini-author-fixture-next')
  await page.getByRole('combobox', { name: '模型', exact: true }).selectOption('gemini-3.6-flash')
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(manual).toHaveValue('gemini-3.6-flash')
  expect(calls.models).toBe(1)
  expect(calls.generation).toBe(0)
})

for (const [baseUrl, retired] of [[officialGemini, true], ['https://example.invalid/private-gateway/v1', false]] as const) {
  test(`历史型号保持原值，官方退役提示按实际目标显示：${retired ? '官方' : '私有'}`, async ({ page }) => {
    await seedConfig(page, 'gemini-2.0-flash', baseUrl)
    const calls = await mockTransport(page)
    await gotoWithBrowserFixtureAIConfigV1(page, './home/settings')
    await expect(page.getByRole('combobox', { name: '模型', exact: true })).toHaveValue('gemini-2.0-flash')
    const notice = page.getByRole('alert').filter({ hasText: '2026-06-01' })
    if (retired) await expect(notice).toBeVisible()
    else await expect(notice).toHaveCount(0)
    const option = page.getByRole('option', { name: /gemini-2\.0-flash/ })
    if (retired) await expect(option).toBeDisabled()
    else await expect(option).toBeEnabled()
    await reloadWithBrowserFixtureAIConfigV1(page)
    await expect(page.getByPlaceholder('或手动输入模型名（列表中没有的型号）')).toHaveValue('gemini-2.0-flash')
    expect(calls.generation).toBe(0)
    expect(calls.models).toBe(0)
  })
}

test('新建 Claude 使用可用预设，新采样限制保留作者参数值', async ({ page }) => {
  await seedConfig(page, 'gemini-3.5-flash')
  const calls = await mockTransport(page)
  await gotoWithBrowserFixtureAIConfigV1(page, './home/settings')
  await page.locator('label:has-text("提供商") + select').selectOption('claude')
  const manual = page.getByPlaceholder('手动输入模型名', { exact: true })
  await expect(manual).toHaveValue('claude-sonnet-4-6')
  const temperature = page.getByRole('slider', { name: 'Temperature', exact: true })
  const before = await temperature.inputValue()
  await manual.fill('claude-sonnet-5-5')
  await expect(temperature).toBeDisabled()
  await expect(temperature).toHaveValue(before)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(manual).toHaveValue('claude-sonnet-5-5')
  await expect(temperature).toHaveValue(before)
  expect(calls.generation).toBe(0)
})
