import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('系统文元素保留原文风；原生候选刷新恢复、编辑确认后才写入，同一 Work 可回读', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://system-elements.invalid/v1', model: 'elements-test', maxTokens: 4000, temperature: 0 })))
  let calls = 0
  const value = { version: 1, enabled: false, protagonistIntent: '保住小店', systemMechanism: '每日签到免费领礼物', rewardGrowth: '计划增加手艺，不当作已有余额', limitsCosts: '无惩罚', oppositionRelations: '邻居有不同诉求' }
  await page.route('https://system-elements.invalid/**', async route => {
    calls++
    expect(route.request().postDataJSON().messages.map((row: { content: string }) => row.content).join('\n')).toContain('目标字段是 systemFictionElements')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ field: 'systemFictionElements', value }) }, finish_reason: 'stop' }] }) })
  })
  await createLongform(page, '系统文元素隔离验收')
  await openLongformLeaf(page, '创作规则')
  await page.getByPlaceholder('描述期望的写作风格', { exact: false }).fill('作者自己的轻松文风')
  await page.getByLabel('系统文元素 · 系统机制', { exact: true }).fill('人工设定：一次免费签到')
  await page.getByRole('button', { name: '保存元素', exact: true }).click()
  await expect(page.getByText('元素已保存', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('系统文元素 · 系统机制', { exact: true })).toHaveValue('人工设定：一次免费签到')
  await expect(page.getByPlaceholder('描述期望的写作风格', { exact: false })).toHaveValue('作者自己的轻松文风')
  const section = page.getByRole('region', { name: '系统文元素配置', exact: true })
  await section.getByRole('button', { name: 'AI 建议', exact: true }).click()
  const draft = page.getByLabel('系统文元素候选 · 系统机制', { exact: true })
  await expect(draft).toHaveValue(value.systemMechanism)
  await expect(page.getByLabel('系统文元素 · 系统机制', { exact: true })).toHaveValue('人工设定：一次免费签到')
  await page.reload()
  await expect(draft).toHaveValue(value.systemMechanism)
  await draft.fill('作者修订：每天首次签到才免费')
  await page.getByRole('button', { name: '确认写入', exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect(page.getByLabel('系统文元素 · 系统机制', { exact: true })).toHaveValue('作者修订：每天首次签到才免费')
  await page.reload()
  await expect(page.getByLabel('系统文元素 · 系统机制', { exact: true })).toHaveValue('作者修订：每天首次签到才免费')
  await expect(page.getByPlaceholder('描述期望的写作风格', { exact: false })).toHaveValue('作者自己的轻松文风')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(calls).toBe(1)
})
