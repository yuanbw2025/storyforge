import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('工坊可搜索并指定到节点，刷新后仍使用指定模板与作者要求', async ({ page }) => {
  const requests: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama', apiKey: '', model: 'craft-library-e2e',
      baseUrl: 'http://localhost:1234/v1', temperature: 0, maxTokens: 0, contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const payload = route.request().postDataJSON() as { messages: Array<{ content: string }> }
    requests.push(payload.messages.map(message => message.content).join('\n'))
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      `data: ${JSON.stringify({ choices: [{ delta: { content: '沈宁没有签字。三张船票压在账本下。' } }] })}\n\ndata: [DONE]\n\n`,
    })
  })
  await createLongform(page, '工坊隔离验收')
  await openLongformLeaf(page, '提示词库')
  await page.getByRole('combobox').filter({ has: page.locator('option[value="craft"]') }).selectOption('craft')
  await expect(page.getByText('共 28 条')).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索提示词' }).fill('去ai味 保真')
  await expect(page.getByText('共 1 条')).toBeVisible()
  await page.getByRole('button', { name: /熔炉工坊｜去 AI 味·保真轻修/ }).click()
  await expect(page.locator('textarea').filter({ hasText: '对正文做最小必要修改' })).toBeVisible()
  await page.getByRole('searchbox').fill('不存在的模板关键词')
  await expect(page.getByText('当前筛选下没有模板')).toBeVisible()
  await page.getByRole('button', { name: '工作流', exact: true }).click()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: '添加节点', exact: true }).click()
  await page.getByLabel('Prompt 模块', { exact: true }).selectOption('chapter.de-ai')
  await page.getByLabel('本节点模板').selectOption({ label: '熔炉工坊｜去 AI 味·保真轻修' })
  await page.getByLabel('待轻修的正文').fill('沈宁没有签字。三张船票压在账本下。她用不签字表示了拒绝。')
  await page.getByLabel('给 AI 的提示', { exact: true }).fill('必须保留三张与没有签字，禁止加下雨。')
  await page.getByRole('button', { name: /^保存/ }).click()
  await expect(page.getByText('节点模式已保存', { exact: true })).toBeVisible()
  await page.reload()
  await openLongformLeaf(page, '提示词库')
  await page.getByRole('button', { name: '工作流', exact: true }).click()
  await page.getByRole('button', { name: '运行工作流 新建工作流', exact: true }).click()
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await expect(page.getByText('✓ 工作流完成')).toBeVisible({ timeout: 30_000 })
  expect(requests).toHaveLength(1)
  expect(requests[0]).toContain('对正文做最小必要修改')
  expect(requests[0]).toContain('三张船票压在账本下')
  expect(requests[0]).toContain('禁止加下雨')
  expect(requests[0]).not.toContain('{{')
  await expect(page.getByRole('textbox').filter({ hasText: '沈宁没有签字。三张船票压在账本下。' })).toBeVisible()
})
