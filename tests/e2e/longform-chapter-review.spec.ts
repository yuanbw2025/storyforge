import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

const original = '保留开头。\n带走旧信。\n保留结尾。'
const issue = { id: 'issue-1', issueType: 'logic', severity: 'high', description: '信应当留下', affectedChapters: [0], suggestion: '留下旧信' }
const report = JSON.stringify({ summary: '核对旧信', issues: [issue] })
const rewritten = JSON.stringify({ originalSummary: original, revisedSummary: '模型漏句不作为最终摘要', summary: '建议两处修改', changes: [
  { id: 'change-1', chapterIndex: 0, before: '带走旧信。', after: '留下旧信。\n交给林。', reason: '保留线索' },
  { id: 'change-2', chapterIndex: 0, before: '保留结尾。', after: '改变结尾。', reason: '另一处建议' },
] })

async function setup(page: Page, responses: string[]) {
  let calls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://chapter-review-test.invalid/v1', model: 'chapter-review-e2e', temperature: 0.2, maxTokens: 4000 }))
  })
  await page.route('https://chapter-review-test.invalid/**', async route => {
    const content = responses[calls++]
    if (content === undefined) throw new Error('Unexpected extra model request')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 120, total_tokens: 220 } }) })
  })
  await createLongform(page, 'SFQA098099章纲审校隔离验收')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByLabel('章节摘要', { exact: true }).fill(original)
  await page.getByLabel('章节摘要', { exact: true }).blur()
  await page.getByRole('button', { name: 'AI 审校', exact: true }).click()
  return () => calls
}

test('SFQA098: invalid diagnosis is a visible failure; explicit retry preserves the failed raw response', async ({ page }) => {
  const calls = await setup(page, ['invalid-json-evidence', '{"summary":"本次未定位到问题","issues":[]}'])
  await page.getByRole('button', { name: '开始诊断', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '诊断失败' })).toBeVisible()
  await expect(page.getByText('诊断完成 ✓', { exact: false })).toHaveCount(0)
  await expect(page.getByText('匹配良好', { exact: false })).toHaveCount(0)
  expect(calls()).toBe(1)
  await page.getByText('查看本次原始响应', { exact: true }).click()
  await expect(page.locator('pre').filter({ hasText: 'invalid-json-evidence' })).toBeVisible()
  await page.getByRole('button', { name: '开始诊断', exact: true }).click()
  await expect(page.getByText('本次诊断未定位到问题，请继续核对原稿。', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: '诊断失败' })).toBeVisible()
  expect(calls()).toBe(2)
})

test('SFQA099: selected preview and persisted summary preserve all unselected text after reload', async ({ page }) => {
  const calls = await setup(page, [report, rewritten])
  await page.getByRole('button', { name: '开始诊断', exact: true }).click()
  await page.getByRole('button', { name: 'AI 智能修复', exact: true }).click()
  await page.getByRole('checkbox', { name: '第 2 处修改', exact: true }).click()
  const expected = '保留开头。\n留下旧信。\n交给林。\n保留结尾。'
  expect(await page.getByTestId('chapter-review-preview').textContent()).toBe(expected)
  await page.getByRole('button', { name: '应用选中修改', exact: true }).click()
  await expect(page.getByText('已应用到：', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByLabel('章节摘要', { exact: true })).toHaveValue(expected)
  await page.reload()
  await expect(page.getByLabel('章节摘要', { exact: true })).toHaveValue(expected)
  expect(calls()).toBe(2)
})

test('SFQA099: omitted model original is rejected visibly without changing the saved summary', async ({ page }) => {
  const raw = rewritten.replace('保留开头。', '伪造开头。')
  const calls = await setup(page, [report, raw])
  await page.getByRole('button', { name: '开始诊断', exact: true }).click()
  await page.getByRole('button', { name: 'AI 智能修复', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '原摘要' })).toBeVisible()
  await expect(page.getByRole('button', { name: '应用选中修改', exact: true })).toHaveCount(0)
  await page.getByText('查看本次原始响应', { exact: true }).click()
  await expect(page.locator('pre').filter({ hasText: '伪造开头。' })).toHaveText(raw)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByLabel('章节摘要', { exact: true })).toHaveValue(original)
  expect(calls()).toBe(2)
})
