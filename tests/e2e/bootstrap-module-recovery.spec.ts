import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const mainModule = /\/src\/main\.tsx(?:\?.*)?$/u
function observe(page: Page) {
  let requests = 0, modelRequests = 0
  page.on('request', request => { if (/\/(chat\/completions|responses)(?:\?|$)/u.test(request.url())) modelRequests++ })
  return { requested: () => { requests++ }, count: () => requests, modelCount: () => modelRequests }
}

test('one interrupted startup import reloads once, preserves a manuscript, and starts no model task', async ({ page }) => {
  await createLongform(page, '启动中断恢复')
  const saved = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const [{ db }, { resolveScope, stampNewRecord }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts')])
    const project = await db.projects.toCollection().first(), scope = await resolveScope({ projectId: project.id })
    const base = { projectId: project.id, createdAt: 1, updatedAt: 1 }
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...base, parentId: null, type: 'chapter', title: '原手稿', summary: '', order: 0 }, { owner: 'work' }))
    const id = await db.chapters.add(stampNewRecord(scope, 'chapters', { ...base, outlineNodeId, title: '原手稿', content: '<p>林舟把信藏进衣襟。</p>', wordCount: 9, order: 0, status: 'draft', notes: '保留原备注' }, { owner: 'work' }))
    return await db.chapters.get(id)
  })
  const flow = observe(page)
  await page.route(mainModule, async route => {
    flow.requested()
    if (flow.count() === 1) await route.abort('internetdisconnected'); else await route.continue()
  })
  await page.reload()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  expect(flow.count()).toBe(2)
  const restored = await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.chapters.get(id)
  }, saved.id)
  expect(restored).toEqual(saved)
  expect(flow.modelCount()).toBe(0)
})

test('persistent startup failure stops after one automatic reload and allows an explicit retry', async ({ page }) => {
  await createLongform(page, '启动持续中断')
  const flow = observe(page); let broken = true
  await page.route(mainModule, async route => { flow.requested(); if (broken) await route.abort('internetdisconnected'); else await route.continue() })
  await page.reload()
  await expect(page.getByText('StoryForge 加载失败，请刷新页面。作品数据没有被清理。', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新加载应用', exact: true })).toBeVisible()
  expect(flow.count()).toBe(2)
  broken = false
  await page.getByRole('button', { name: '重新加载应用', exact: true }).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  expect(flow.count()).toBe(3)
  expect(flow.modelCount()).toBe(0)
})

test('an ordinary startup exception is reported without automatic replay', async ({ page }) => {
  await createLongform(page, '普通启动故障')
  const flow = observe(page)
  await page.route(mainModule, async route => { flow.requested(); await route.fulfill({ contentType: 'application/javascript', body: 'throw new Error("synthetic ordinary startup fault")' }) })
  await page.reload()
  await expect(page.getByRole('button', { name: '重新加载应用', exact: true })).toBeVisible()
  expect(flow.count()).toBe(1)
  expect(flow.modelCount()).toBe(0)
})
