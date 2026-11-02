import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('malformed embedding batch stays uncached, reports failure and resumes through the real indexing UI', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  let rejectBatch = true
  let calls = 0
  let lastInputs: string[] = []
  await page.route('**/sfqa078-mock/v1/embeddings', async route => {
    calls += 1
    const body = route.request().postDataJSON() as { input: string[] }
    lastInputs = body.input
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      data: body.input.map((_text, index) => ({ index: rejectBatch ? 0 : index, embedding: [index + 1, 1] })).reverse(),
    }) })
  })
  await createLongform(page, 'SFQA078 isolated retrieval')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expect.poll(() => page.locator('input').evaluateAll(inputs => inputs.some(input => input instanceof HTMLInputElement && input.value === '第1卷'))).toBe(true)
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByTitle('编辑章节').click()
  const editor = page.locator('.tiptap-editor')
  await editor.fill('青灯旧事。'.repeat(200))
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()
  const before = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return db.chapters.toArray()
  })
  await openLongformLeaf(page, '设置')
  const card = page.locator('div.bg-bg-surface').filter({ has: page.getByRole('heading', { name: /语义检索/ }) })
  await card.getByRole('checkbox').check()
  await card.getByRole('button', { name: /本地 Ollama/ }).click()
  await card.locator('label:has-text("Base URL") + input').fill('/sfqa078-mock/v1')
  const build = card.getByRole('button', { name: '为当前项目历史章节建立检索索引', exact: true })
  await build.click()
  await expect(card.getByText(/建立索引失败:embedding index/)).toBeVisible()
  await expect(build).toBeEnabled()
  expect(lastInputs.length).toBeGreaterThan(1)
  expect(calls).toBe(1)
  const failed = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return db.retrievalChunks.toArray()
  })
  expect(failed).toHaveLength(lastInputs.length)
  expect(failed.every(row => row.embedding == null && row.embeddingModel == null)).toBe(true)
  rejectBatch = false
  await build.click()
  await expect(card.getByText(/本次嵌入 \d+ 块/)).toBeVisible()
  expect(calls).toBe(2)
  await page.reload()
  await expect(card.getByRole('checkbox')).toBeChecked()
  await build.click()
  await expect(card.getByText(/语义向量已全部就绪/)).toBeVisible()
  expect(calls).toBe(2)
  const after = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return { chapters: await db.chapters.toArray(), chunks: await db.retrievalChunks.toArray() }
  })
  expect(after.chapters).toEqual(before)
  expect(after.chunks.map(row => row.embedding)).toEqual(lastInputs.map((_text, index) => [index + 1, 1]))
})
