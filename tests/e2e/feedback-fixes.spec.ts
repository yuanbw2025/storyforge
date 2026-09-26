import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
})

test('long outline scrolls during native drag and preserves cross-volume movement after reload', async ({ page }) => {
  await createLongform(page, '章节拖动隔离验收')
  const ids = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { useOutlineStore } = await load('/storyforge/src/stores/outline.ts')
    const project = (await db.projects.toArray())[0]
    const add = useOutlineStore.getState().addNode
    const a = await add({ projectId: project.id, type: 'volume', title: '第一卷', summary: '', parentId: null, order: 0 })
    const b = await add({ projectId: project.id, type: 'volume', title: '第二卷', summary: '', parentId: null, order: 1 })
    const chapters: number[] = []
    for (let i = 0; i < 35; i++) chapters.push(await add({ projectId: project.id, type: 'chapter', title: `测试章节${i + 1}`, summary: '章节摘要', parentId: a, order: i }))
    return { a, b, chapters }
  })
  await openLongformLeaf(page, '大纲')
  await page.locator(`[data-outline-volume-id="${ids.a}"]`).getByText('第一卷', { exact: true }).click()
  const pane = page.locator('[data-testid="outline-drag-scroll"] > div > .overflow-y-auto')
  const handle = page.locator(`[data-outline-chapter-id="${ids.chapters[0]}"]`)
  await handle.scrollIntoViewIfNeeded()
  const box = (await handle.boundingBox())!
  const bounds = (await pane.boundingBox())!
  const before = await pane.evaluate(el => el.scrollTop)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 20, box.y + 30, { steps: 6 })
  await page.mouse.move(bounds.x + bounds.width / 2, Math.min(bounds.y + bounds.height, 720) - 12, { steps: 12 })
  await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBeGreaterThan(before + 80)
  await page.mouse.up()
  // Chromium's native drag scrolling settles after cancellation; our frame
  // cancellation is also asserted directly in the hook regression.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 120)
  await page.waitForTimeout(500)
  const stopped = await pane.evaluate(el => el.scrollTop)
  await page.waitForTimeout(200)
  expect(await pane.evaluate(el => el.scrollTop)).toBe(stopped)
  await handle.scrollIntoViewIfNeeded()
  await handle.dragTo(page.locator(`[data-outline-volume-id="${ids.b}"]`))
  await expect.poll(() => page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.outlineNodes.get(id)).parentId
  }, ids.chapters[0])).toBe(ids.b)
  await page.reload()
  await openLongformLeaf(page, '大纲')
  await page.locator(`[data-outline-volume-id="${ids.b}"]`).getByText('第二卷', { exact: true }).click()
  await expect(handle).toBeVisible()
  const count = await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.outlineNodes.where('type').equals('chapter').count()
  })
  expect(count).toBe(35)
})

test('custom gateway network failure gives actionable guidance and HTTP auth errors remain distinct', async ({ page }) => {
  await createLongform(page, '连接诊断隔离验收')
  await page.evaluate(async () => {
    const { useAIConfigStore } = await (new Function('return import("/storyforge/src/stores/ai-config.ts")'))()
    useAIConfigStore.getState().setConfig({ provider: 'custom', baseUrl: 'https://gateway.invalid/v1', model: 'test-model', apiKey: 'test-only-key' })
  })
  await openLongformLeaf(page, '设置')
  await page.route('https://gateway.invalid/**', route => route.abort('failed'))
  await page.getByRole('button', { name: '测试最小连接', exact: true }).click()
  await expect(page.getByText(/无法据此判断 Key 是否正确/)).toBeVisible()
  await expect(page.getByText(/自定义中转站没有内置通用代理/)).toBeVisible()
  await page.unroute('https://gateway.invalid/**')
  await page.route('https://gateway.invalid/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"Invalid API key"}}' }))
  await page.getByRole('button', { name: '测试最小连接', exact: true }).click()
  await expect(page.getByText(/自定义中转站没有内置通用代理/)).toHaveCount(0)
  await expect(page.getByText(/❌.*Invalid API key/)).toBeVisible()
})

test('document upload stops on malformed output, persists the failure and resumes only on author action', async ({ page }) => {
  await createLongform(page, '解析隔离验收')
  await page.evaluate(async () => {
    const { useAIConfigStore } = await (new Function('return import("/storyforge/src/stores/ai-config.ts")'))()
    useAIConfigStore.getState().setConfig({ provider: 'deepseek', baseUrl: 'https://parse.invalid/v1', model: 'deepseek-v4-flash', apiKey: 'test-only-key' })
  })
  let calls = 0
  let valid = false
  await page.route('https://parse.invalid/**', async route => {
    calls++
    expect(route.request().postDataJSON()).toMatchObject({ response_format: { type: 'json_object' }, thinking: { type: 'disabled' } })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: valid ? '{"outline":[{"type":"volume","title":"海港","children":[{"type":"chapter","title":"归航"}]}]}' : 'not-json' } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) })
  })
  await openLongformLeaf(page, '文档导入')
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'harbor.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 归航\n海港有一座灯塔，夜里引导渔船归来。'.repeat(15)) })
  await page.getByRole('button', { name: '开始解析', exact: true }).click()
  await page.getByRole('button', { name: /导入当前项目（/ }).click()
  await expect(page.getByText(/块 1 已停止，未自动重发/).last()).toBeVisible()
  expect(calls).toBe(1)
  await page.reload()
  await expect(page.getByText(/harbor.txt/).first()).toBeVisible()
  expect(calls).toBe(1)
  valid = true
  // The failed state is durable; restoring the original upload permits an
  // explicit resume and never silently reissues a paid model request.
  const resume = page.getByRole('button', { name: /续跑|继续解析|恢复/ }).first()
  await expect(resume).toBeVisible()
  await resume.click()
  await expect.poll(() => calls).toBe(2)
  await expect.poll(() => page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.importSessions.toArray())[0]?.status
  })).toBe('done')
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await openLongformLeaf(page, '大纲')
  await expect(page.getByText('海港', { exact: true })).toBeVisible()
})
