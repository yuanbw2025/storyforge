import { expect, test, type Locator, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, '卷章结构与生命周期验收')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expect(page.getByLabel('卷标题', { exact: true })).toHaveValue('第1卷')
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(1)
}
async function data(page: Page) {
  return page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const { useOutlineStore } = await (new Function('return import("/storyforge/src/stores/outline.ts")'))()
    const scope = useOutlineStore.getState().loadedScope
    return { scope, nodes: (await db.outlineNodes.where('projectId').equals(scope.projectId).toArray()).filter((row: { workId?: number }) => row.workId === scope.workId), chapters: await db.chapters.where('projectId').equals(scope.projectId).toArray(), details: await db.detailedOutlines.where('projectId').equals(scope.projectId).toArray() }
  })
}
async function seedLinkedDrafts(page: Page) {
  return page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const { useOutlineStore } = await (new Function('return import("/storyforge/src/stores/outline.ts")'))()
    const { useChapterStore } = await (new Function('return import("/storyforge/src/stores/chapter.ts")'))()
    const { useDetailedOutlineStore } = await (new Function('return import("/storyforge/src/stores/detailed-outline.ts")'))()
    const scope = useOutlineStore.getState().loadedScope
    for (const node of await db.outlineNodes.where('projectId').equals(scope.projectId).toArray()) {
      if (node.workId !== scope.workId || node.type !== 'chapter') continue
      await useChapterStore.getState().getOrCreateByOutlineNode(scope.projectId, node.id, { title: node.title, content: '<p>生命周期测试中的作者原稿</p>', wordCount: 14, status: 'draft', order: node.order, notes: '' })
      await useDetailedOutlineStore.getState().getOrCreate(scope, node.id)
    }
  })
}

async function mouseDrag(page: Page, source: Locator, target: Locator) {
  await expect(page.getByTestId('outline-drag-scroll')).toHaveAttribute('aria-busy', 'false')
  await source.scrollIntoViewIfNeeded(); await target.scrollIntoViewIfNeeded()
  const from = await source.boundingBox(), to = await target.boundingBox()
  if (!from || !to) throw new Error('Missing native drag geometry')
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const finish = { x: to.x + 12, y: to.y + 12 }
  await page.mouse.move(start.x, start.y); await page.mouse.down()
  await page.mouse.move(start.x + 20, start.y + 10, { steps: 4 })
  await page.mouse.move(finish.x, finish.y, { steps: 12 }); await page.mouse.up()
}

test('insert, reorder, cross-volume drag and delete cancellation preserve the actual node identities', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await setup(page)
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  const initial = await data(page)
  const firstVolume = initial.nodes.find((node: { type: string }) => node.type === 'volume')
  const original = initial.nodes.filter((node: { type: string }) => node.type === 'chapter').sort((a: { order: number }, b: { order: number }) => a.order - b.order)
  await page.getByTitle('在此章下方插入一章', { exact: true }).first().click()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(3)
  const inserted = (await data(page)).nodes.find((node: { title: string }) => node.title === '新章节')
  expect((await data(page)).nodes.filter((node: { type: string }) => node.type === 'chapter').sort((a: { order: number }, b: { order: number }) => a.order - b.order).map((node: { id: number }) => node.id)).toEqual([original[0].id, inserted.id, original[1].id])
  await expect(page.getByTestId('outline-drag-scroll')).toHaveAttribute('aria-busy', 'false')
  await page.evaluate(() => {
    const events: unknown[] = []; Object.assign(window, { nativeOutlineDragEvents: events })
    for (const capture of [true, false]) for (const name of ['dragstart', 'dragover', 'drop', 'dragend']) document.addEventListener(name, event => {
      const e = event as DragEvent, target = e.target as Element
      if (events.length < 120) events.push({ type: e.type, capture, prevented: e.defaultPrevented, target: target.tagName, source: target.closest('[data-outline-chapter-id]')?.getAttribute('data-outline-chapter-id'), row: target.closest('[data-outline-chapter-row]')?.getAttribute('data-outline-chapter-row'), types: Array.from(e.dataTransfer?.types ?? []), text: e.dataTransfer?.getData('text/plain') })
    }, capture)
  })
  await mouseDrag(page, page.locator(`[data-outline-chapter-id="${original[0].id}"]`), page.locator(`[data-outline-chapter-row="${original[1].id}"]`))
  const dragEvents = JSON.stringify(await page.evaluate(() => (window as unknown as { nativeOutlineDragEvents: unknown[] }).nativeOutlineDragEvents), null, 2)
  const { writeFile } = await import('node:fs/promises')
  const eventPath = test.info().outputPath('native-drag-events.json')
  await writeFile(eventPath, dragEvents)
  await test.info().attach('native-drag-events', { path: eventPath, contentType: 'application/json' })
  await expect.poll(async () => (await data(page)).nodes.filter((node: { type: string }) => node.type === 'chapter').sort((a: { order: number }, b: { order: number }) => a.order - b.order).map((node: { id: number }) => node.id)).toEqual([inserted.id, original[1].id, original[0].id])
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expect(page.getByLabel('卷标题', { exact: true })).toHaveValue('第2卷')
  const secondVolume = (await data(page)).nodes.find((node: { title: string }) => node.title === '第2卷')
  await page.locator(`[data-outline-volume-id="${firstVolume.id}"] button`).click()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(3)
  await page.locator(`[data-outline-chapter-id="${original[0].id}"]`).dragTo(page.locator(`[data-outline-volume-id="${secondVolume.id}"]`))
  await expect.poll(async () => (await data(page)).nodes.find((node: { id: number }) => node.id === original[0].id).parentId).toBe(secondVolume.id)
  await page.getByTitle('删除章节', { exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  expect((await data(page)).nodes.filter((node: { type: string }) => node.type === 'chapter')).toHaveLength(3)
  await page.getByTitle('删除章节', { exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect.poll(async () => (await data(page)).nodes.filter((node: { type: string }) => node.type === 'chapter').length).toBe(2)
  await mouseDrag(page, page.locator(`[data-outline-volume-id="${firstVolume.id}"]`).getByTitle('拖动调整卷顺序', { exact: true }), page.locator(`[data-outline-volume-id="${secondVolume.id}"]`))
  await expect.poll(async () => (await data(page)).nodes.filter((node: { type: string }) => node.type === 'volume').sort((a: { order: number }, b: { order: number }) => a.order - b.order).map((node: { id: number }) => node.id)).toEqual([secondVolume.id, firstVolume.id])
  await page.reload()
  await expect(page.getByLabel('卷标题', { exact: true })).toBeVisible()
  expect((await data(page)).nodes.find((node: { id: number }) => node.id === original[0].id)).toMatchObject({ parentId: secondVolume.id, order: 0, workId: initial.scope.workId })
  expect(errors).toEqual([])
})

test('clear includes story-block chapters and deletes linked prose and scenes atomically while retaining the structure', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '添加故事结构', exact: true }).click()
  await page.getByRole('button', { name: /自定义/ }).click()
  const block = page.locator('[data-outline-block-id]').first()
  await block.getByTitle('添加章节', { exact: true }).click()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'AI 审校', exact: true })).toBeVisible()
  await seedLinkedDrafts(page)
  const before = await data(page)
  expect(before.chapters).toHaveLength(2); expect(before.details).toHaveLength(2)
  await page.getByRole('button', { name: /清空章节/, exact: false }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  expect((await data(page)).chapters).toHaveLength(2)
  await page.getByRole('button', { name: /清空章节/, exact: false }).click()
  await page.getByRole('dialog').getByRole('button', { name: '清空', exact: true }).click()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(0)
  const after = await data(page)
  expect(after.chapters).toEqual([]); expect(after.details).toEqual([])
  expect(after.nodes.map((node: { type: string }) => node.type).sort()).toEqual(['storyBlock', 'volume'])
  await page.reload(); await expect(page.getByLabel('卷标题', { exact: true })).toBeVisible(); expect((await data(page)).nodes).toHaveLength(2)
  await page.getByTitle('删除故事块', { exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  expect((await data(page)).nodes.filter((node: { type: string }) => node.type === 'storyBlock')).toHaveLength(1)
  await page.getByTitle('删除故事块', { exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByLabel('故事块标题', { exact: true })).toHaveCount(0)
  expect((await data(page)).nodes.map((node: { type: string }) => node.type)).toEqual(['volume'])
})

test('a failed root deletion preserves native descendants and manuscripts, and the same UI command can be retried', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await setup(page); await seedLinkedDrafts(page)
  const before = await data(page)
  const root = before.nodes.find((node: { type: string }) => node.type === 'volume')
  await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const remove = db.outlineNodes.delete.bind(db.outlineNodes)
    db.outlineNodes.delete = async (key: number) => { if (key === id) throw new DOMException('根卷删除配额测试', 'QuotaExceededError'); return remove(key) }
    Object.assign(window, { restoreTreeDeletion: () => { db.outlineNodes.delete = remove } })
  }, root.id)
  await page.getByTitle('删除当前卷', { exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '根卷删除配额测试' })).toBeVisible()
  const failed = await data(page)
  expect(failed.nodes).toEqual(before.nodes); expect(failed.chapters).toEqual(before.chapters); expect(failed.details).toEqual(before.details)
  await page.evaluate(() => (window as unknown as { restoreTreeDeletion: () => void }).restoreTreeDeletion())
  await page.getByTitle('删除当前卷', { exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByLabel('卷标题', { exact: true })).toHaveCount(0)
  const after = await data(page)
  expect(after.nodes).toEqual([]); expect(after.chapters).toEqual([]); expect(after.details).toEqual([])
  expect(errors).toEqual([])
})

test('a failed insertion leaves no partial node and a new click retries without a sticky failure barrier', async ({ page }) => {
  await setup(page); const before = await data(page)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const write = db.outlineNodes.update.bind(db.outlineNodes)
    db.outlineNodes.update = async () => { throw new DOMException('插入排序配额测试', 'QuotaExceededError') }
    Object.assign(window, { restoreTreeOrdering: () => { db.outlineNodes.update = write } })
  })
  await page.getByTitle('在此章下方插入一章', { exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '插入排序配额测试' })).toBeVisible()
  expect((await data(page)).nodes).toEqual(before.nodes)
  await page.evaluate(() => (window as unknown as { restoreTreeOrdering: () => void }).restoreTreeOrdering())
  await page.getByTitle('在此章下方插入一章', { exact: true }).click()
  await expect(page.getByLabel('章节标题', { exact: true })).toHaveCount(2)
  expect((await data(page)).nodes.filter((node: { type: string }) => node.type === 'chapter').map((node: { order: number }) => node.order).sort()).toEqual([0, 1])
})
