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
  const handle = page.locator(`[data-outline-chapter-id="${ids.chapters[0]}"]`)
  const pane = page.getByTestId('outline-drag-scroll').locator('.overflow-y-auto').filter({ has: handle })
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

for (const failure of ['malformed', 'http-503'] as const) test(`document upload keeps ${failure} evidence and only a new import sends again`, async ({ page }) => {
  await createLongform(page, '解析隔离验收')
  const configureProvider = () => page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({
      provider: 'deepseek', baseUrl: 'https://parse.invalid/v1', model: 'deepseek-v4-flash', apiKey: 'test-only-key',
    })
  })
  await configureProvider()
  let calls = 0
  let valid = false
  await page.route('https://parse.invalid/v1/chat/completions', async route => {
    expect(route.request().method()).toBe('POST')
    calls++
    expect(route.request().postDataJSON()).toMatchObject({ response_format: { type: 'json_object' }, thinking: { type: 'disabled' } })
    if (!valid && failure === 'http-503') {
      await route.fulfill({ status: 503, body: 'Service unavailable' })
      return
    }
    const content = valid
      ? JSON.stringify({ outline: [{ type: 'volume', title: '海港', children: [{ type: 'chapter', title: '归航' }] }] })
      : 'not-json'
    await route.fulfill({ status: 200, json: {
      choices: [{ finish_reason: 'stop', message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    } })
  })
  const startImport = async () => {
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'harbor.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 归航\n海港有一座灯塔，夜里引导渔船归来。'.repeat(15)),
    })
    await page.getByRole('button', { name: '开始解析', exact: true }).click()
    await page.getByRole('button', { name: /导入当前项目（/ }).click()
  }
  const expectStoppedEvidence = async () => {
    await expect(page.getByText('本块有保留的尝试记录。打开或继续本任务不会重新发送请求。')).toBeVisible()
    if (failure === 'malformed') {
      await page.getByText('查看已保留的模型原答', { exact: true }).click()
      await expect(page.getByText('not-json', { exact: true })).toBeVisible()
      await expect(page.getByText('已记录用量：输入 10，输出 10，合计 20 tokens。')).toBeVisible()
    } else {
      await expect(page.getByText('服务返回 HTTP 503。')).toBeVisible()
    }
    expect(calls).toBe(1)
  }
  await openLongformLeaf(page, '文档导入')
  await startImport()
  await expectStoppedEvidence()
  await expect(page.getByRole('dialog', { name: '审查导入候选' })).toHaveCount(0)

  await page.reload()
  await openLongformLeaf(page, '文档导入')
  await expect(page.getByText('已从本地存档恢复原文')).toBeVisible()
  expect(calls).toBe(1)
  await page.getByRole('button', { name: '继续处理', exact: true }).click()
  await expectStoppedEvidence()

  // A fresh author-confirmed import gets a new attempt; the old evidence remains.
  await page.reload()
  await openLongformLeaf(page, '文档导入')
  await configureProvider()
  valid = true
  await startImport()
  const review = page.getByRole('dialog', { name: '审查导入候选' })
  await expect(review.getByRole('heading', { name: '审查第 1 块' })).toBeVisible()
  expect(calls).toBe(2)
  await review.getByRole('button', { name: '确认保存本块' }).click()
  await expect(page.getByRole('heading', { name: '✓ 全部导入完成' })).toBeVisible()
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await openLongformLeaf(page, '大纲')
  await expect(page.getByText('海港', { exact: true })).toBeVisible()
  expect(calls).toBe(2)
})
