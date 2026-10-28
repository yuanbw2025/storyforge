import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, '大纲作者保存故障验收')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expect(page.getByLabel('卷标题', { exact: true })).toHaveValue('第1卷')
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveValue('第1章')
}
async function rows(page: Page) {
  return page.evaluate(async () => {
    const { useOutlineStore } = await (new Function('return import("/storyforge/src/stores/outline.ts")'))()
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const scope = useOutlineStore.getState().loadedScope
    if (!scope) throw new Error('Missing actual outline owner')
    return { scope, rows: (await db.outlineNodes.where('projectId').equals(scope.projectId).toArray()).filter((node: { workId?: number }) => node.workId === scope.workId) }
  })
}
async function failWrites(page: Page) {
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.outlineNodes.update.bind(db.outlineNodes)
    db.outlineNodes.update = async () => { throw new DOMException('大纲配额测试', 'QuotaExceededError') }
    Object.assign(window, { restoreOutlineWrites: () => { db.outlineNodes.update = update } })
  })
}

test('volume and chapter edits survive acknowledgement, clear, navigation and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  const fields = ['卷标题', '卷情节摘要', '章节标题', '章节摘要']
  for (const label of fields) {
    const value = `${label}：先试绳结，再过断桥。`
    await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByLabel(label, { exact: true }).blur()
    await expect.poll(async () => {
      const data = await rows(page)
      const row = data.rows.find((node: { type: string }) => node.type === (label.startsWith('卷') ? 'volume' : 'chapter'))
      return row[label.endsWith('标题') ? 'title' : 'summary']
    }).toBe(value)
  }
  await page.getByLabel('章节摘要', { exact: true }).fill('')
  await page.getByLabel('章节摘要', { exact: true }).blur()
  await expect.poll(async () => (await rows(page)).rows.find((node: { type: string }) => node.type === 'chapter').summary).toBe('')
  await openLongformLeaf(page, '细纲'); await openLongformLeaf(page, '大纲')
  await page.reload()
  await expect(page.getByLabel('卷标题', { exact: true })).toHaveValue('卷标题：先试绳结，再过断桥。')
  await expect(page.getByLabel('卷情节摘要', { exact: true })).toHaveValue('卷情节摘要：先试绳结，再过断桥。')
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveValue('章节标题：先试绳结，再过断桥。')
  await expect(page.getByLabel('章节摘要', { exact: true })).toHaveValue('')
  expect(errors).toEqual([])
})

test('a failed save preserves the same draft and retry persists it once storage recovers', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await setup(page); await failWrites(page)
  await page.getByLabel('章节摘要', { exact: true }).fill('不能因为数据库失败丢掉这一段章纲。')
  await page.getByLabel('章节摘要', { exact: true }).blur()
  await expect(page.getByRole('alert').filter({ hasText: '大纲配额测试' })).toBeVisible()
  expect((await rows(page)).rows.find((node: { type: string }) => node.type === 'chapter').summary).toBe('')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expect(page.getByLabel('章节摘要', { exact: true })).toHaveValue('不能因为数据库失败丢掉这一段章纲。')
  expect((await rows(page)).rows.filter((node: { type: string }) => node.type === 'volume')).toHaveLength(1)
  await page.evaluate(() => (window as unknown as { restoreOutlineWrites: () => void }).restoreOutlineWrites())
  await page.getByRole('button', { name: '重试保存章节摘要', exact: true }).click()
  await expect.poll(async () => (await rows(page)).rows.find((node: { type: string }) => node.type === 'chapter').summary).toBe('不能因为数据库失败丢掉这一段章纲。')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expect(page.getByLabel('卷标题', { exact: true })).toHaveValue('第2卷')
  expect(errors).toEqual([])
})

test('typing during a delayed write keeps the later text and acknowledges both saves in order', async ({ page }) => {
  await setup(page)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.outlineNodes.update.bind(db.outlineNodes)
    let first = true
    db.outlineNodes.update = async (...args: unknown[]) => {
      if (first) { first = false; await db.constructor.waitFor(new Promise(resolve => setTimeout(resolve, 900))) }
      return update(...args)
    }
  })
  const field = page.getByLabel('卷情节摘要', { exact: true })
  await field.fill('第一份输入'); await field.blur()
  await expect(page.getByRole('status').filter({ hasText: '正在保存' })).toBeVisible()
  await field.fill('第二份输入，必须等上一笔确认后继续保存。')
  await expect(field).toHaveValue('第二份输入，必须等上一笔确认后继续保存。')
  await expect.poll(async () => (await rows(page)).rows.find((node: { type: string }) => node.type === 'volume').summary).toBe('第二份输入，必须等上一笔确认后继续保存。')
  await field.blur(); await page.reload()
  await expect(field).toHaveValue('第二份输入，必须等上一笔确认后继续保存。')
})

test('a concurrent canonical edit is not overwritten by a stale outline draft', async ({ page }) => {
  await setup(page)
  const field = page.getByLabel('章节标题', { exact: true })
  const chapter = (await rows(page)).rows.find((node: { type: string }) => node.type === 'chapter')
  await field.fill('作者尚未保存的章名')
  await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    await db.outlineNodes.update(id, { title: '另一个页面刚保存的章名' })
  }, chapter.id)
  await field.blur()
  await expect(page.getByRole('alert').filter({ hasText: '其他页面修改' })).toBeVisible()
  await expect(field).toHaveValue('作者尚未保存的章名')
  expect((await rows(page)).rows.find((node: { id: number }) => node.id === chapter.id).title).toBe('另一个页面刚保存的章名')
})

test('invalid stored outline text produces a recoverable read error without modifying the original', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  const volume = (await rows(page)).rows.find((node: { type: string }) => node.type === 'volume')
  await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    await db.outlineNodes.update(id, { summary: ['保留这份异常原文'] })
  }, volume.id)
  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: '当前大纲节点缺少 summary' })).toBeVisible()
  expect(await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.outlineNodes.get(id)).summary
  }, volume.id)).toEqual(['保留这份异常原文'])
  await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    await db.outlineNodes.update(id, { summary: '从原始备份恢复的合法摘要' })
  }, volume.id)
  await page.getByRole('button', { name: '重试读取大纲', exact: true }).click()
  await expect(page.getByLabel('卷情节摘要', { exact: true })).toHaveValue('从原始备份恢复的合法摘要')
  expect(errors).toEqual([])
})

test('a native chapter-title failure rolls back the outline title and retries both together', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  const chapter = (await rows(page)).rows.find((node: { type: string }) => node.type === 'chapter')
  await page.getByTitle('编辑章节', { exact: true }).click()
  await expect.poll(async () => page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.chapters.where('outlineNodeId').equals(id).count()
  }, chapter.id)).toBe(1)
  await openLongformLeaf(page, '大纲')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const write = db.chapters.bulkUpdate.bind(db.chapters)
    db.chapters.bulkUpdate = async () => { throw new DOMException('关联正文标题配额测试', 'QuotaExceededError') }
    Object.assign(window, { restoreChapterTitleWrite: () => { db.chapters.bulkUpdate = write } })
  })
  await page.getByLabel('章节标题', { exact: true }).fill('探路前先试绳结')
  await page.getByLabel('章节标题', { exact: true }).blur()
  await expect(page.getByRole('alert').filter({ hasText: '关联正文标题配额测试' })).toBeVisible()
  expect((await rows(page)).rows.find((node: { id: number }) => node.id === chapter.id).title).toBe('第1章')
  expect(await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.chapters.where('outlineNodeId').equals(id).first()).title
  }, chapter.id)).toBe('第1章')
  await page.evaluate(() => (window as unknown as { restoreChapterTitleWrite: () => void }).restoreChapterTitleWrite())
  await page.getByRole('button', { name: '重试保存章节标题', exact: true }).click()
  await expect.poll(async () => page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return [(await db.outlineNodes.get(id)).title, (await db.chapters.where('outlineNodeId').equals(id).first()).title]
  }, chapter.id)).toEqual(['探路前先试绳结', '探路前先试绳结'])
  expect(errors).toEqual([])
})
