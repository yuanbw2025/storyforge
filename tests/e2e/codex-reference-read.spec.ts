import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('invalid Codex names do not block chapter entry, save or reload and remain unchanged in storage', async ({ page }) => {
  const errors: string[] = []
  const modelRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (/\/(chat\/completions|responses|messages|[^/]+:generateContent)(?:\?|$)/.test(request.url())) modelRequests.push(request.method())
  })
  await createLongform(page, '百科异常名称隔离回归')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  const before = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, { resolveScope, stampNewRecord }] = await Promise.all([
      imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'),
    ])
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    const categoryId = await db.codexCategories.add(stampNewRecord(scope, 'codexCategories', {
      name: '隔离势力', domain: 'humanity', parentId: null, fieldSchema: '[]', order: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    for (const name of [null, 42, '玄门']) {
      await db.codexEntries.add(stampNewRecord(scope, 'codexEntries', {
        categoryId, name, summary: '保留百科原始内容', description: '', fields: '{}', order: 0,
        origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '', producerRunId: null,
        producerCandidateHash: null, worldGroupId: null, createdAt: 1, updatedAt: 1,
      }, { owner: 'world' }))
    }
    return db.codexEntries.where('categoryId').equals(categoryId).toArray()
  })
  await page.getByTitle('编辑章节').click()
  const editor = page.locator('.tiptap-editor')
  await expect(editor).toBeVisible()
  await editor.fill('玄门守住旧城。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()
  await expect(editor.locator('[data-entity-id^="codex:"]')).toHaveText('玄门')
  await page.reload()
  await openLongformLeaf(page, '章节')
  await expect(editor).toContainText('玄门守住旧城。')
  const after = await page.evaluate(async categoryId => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return db.codexEntries.where('categoryId').equals(categoryId).toArray()
  }, before[0].categoryId)
  expect(after).toEqual(before)
  expect(errors).toEqual([])
  expect(modelRequests).toEqual([])
})
