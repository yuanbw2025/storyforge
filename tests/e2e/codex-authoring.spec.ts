import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

// Opt-in only: uses an existing local ChatGPT login and consumes plan quota.
// Every browser is isolated. No author workspace, real manuscript, or API key is used.
const live = process.env.STORYFORGE_CODEX_LIVE === '1'
test('Codex story candidate persists before explicit adoption and survives refresh', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION_PREVIEW === '1', 'Live authoring acceptance uses the isolated development server')
  test.setTimeout(180_000)
  await page.addInitScript(({ liveModel }) => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    if (!localStorage.getItem('storyforge-ai-config')) localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'codex', apiKey: '', baseUrl: '/storyforge/local-codex/v1', model: liveModel, temperature: 0, maxTokens: 2048, contextWindow: 32768 }))
  }, { liveModel: live ? process.env.STORYFORGE_CODEX_LIVE_MODEL || 'gpt-6.1-sol' : 'test-model' })
  let calls = 0
  if (!live) await page.route('**/local-codex/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/requests') && route.request().method() === 'POST') { calls++; await route.fulfill({ status: 202, json: { id: 'test' } }); return }
    await route.fulfill({ json: path.endsWith('/status') ? { state: 'ready' } : { status: 'completed', text: JSON.stringify({ field: 'logline', value: '守塔人发现灯光正在泄露船队位置，必须在暴风雨前选择熄灯还是揭穿领航员。' }), dispatched: true, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } } })
  })
  else page.on('request', request => { if (request.url().endsWith('/requests') && request.method() === 'POST') calls++ })
  await createLongform(page, 'Codex 隔离验收作品')
  await page.getByRole('button', { name: '故事设计', exact: true }).click()
  await page.getByRole('textbox', { name: '补充提示（可选）' }).fill('写一个关于守塔人发现灯光泄露船队位置的一句话故事。只写 logline，50 字左右，不增加其他设定。')
  await page.getByRole('button', { name: 'AI 生成', exact: true }).click()
  const adopt = page.getByRole('button', { name: '采纳', exact: true })
  await expect(adopt).toBeEnabled({ timeout: 120_000 })
  await expect(page.getByText('点击填写一句话故事…', { exact: true })).toBeVisible()
  await page.reload()
  await expect(adopt).toBeEnabled()
  await adopt.click()
  await expect(adopt).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('点击填写一句话故事…', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/守塔人/).first()).toBeVisible()
  expect(calls).toBe(1)
})
