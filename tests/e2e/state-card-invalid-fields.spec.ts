import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

test('invalid state fields remain stored while prose and state views survive refresh without AI calls', async ({ page }) => {
  const pageErrors: string[] = []
  let modelCalls = 0
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route(/\/(?:chat\/completions|responses|messages|embeddings)(?:\?.*)?$/, async route => { modelCalls++; await route.abort() })
  await createLongform(page, '状态卡读取隔离回归')
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByRole('button', { name: /^1 仅大纲 第1章/ }).click()
  await expect(page.locator('.tiptap-editor')).toBeVisible()
  const seeded = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, { resolveScope, stampNewRecord }, { useStateCardStore }] = await Promise.all([
      imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'), imp('/storyforge/src/stores/state-card.ts'),
    ])
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    const fields = '[null,{"key":"位置","value":"山门旅店"}]'
    const now = Date.now()
    await db.characters.add(stampNewRecord(scope, 'characters', {
      projectId: scope.projectId, name: '店主', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: '隔离状态卡持有人', isCrossWorld: false, createdAt: now, updatedAt: now,
    }, { owner: 'world' }))
    const id = await db.stateCards.add(stampNewRecord(scope, 'stateCards', {
      projectId: scope.projectId, category: 'character', entityName: '店主', fields, createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    await useStateCardStore.getState().loadAll(scope)
    return { id, fields }
  })
  const draft = '作者原文：山门旅店的灯仍亮着。'
  await page.locator('.tiptap-editor').fill(draft)
  await expect.poll(async () => page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return (await db.chapters.toCollection().first())?.content ?? ''
  })).toContain(draft)
  await page.getByRole('button', { name: '状态与物品', exact: true }).click()
  await expect(page.getByRole('heading', { name: '角色状态卡' })).toBeVisible()
  await expect(page.getByText('山门旅店', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '字段格式异常' })).toBeVisible()
  await expect(page.getByRole('button', { name: '编辑状态', exact: true })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('heading', { name: '角色状态卡' })).toBeVisible()
  await expect(page.getByRole('button', { name: '编辑状态', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByRole('button', { name: /^1 .*第1章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText(draft)
  const raw = await page.evaluate(async id => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return (await db.stateCards.get(id)).fields
  }, seeded.id)
  expect(raw).toBe(seeded.fields)
  expect(pageErrors).toEqual([])
  expect(modelCalls).toBe(0)
})
