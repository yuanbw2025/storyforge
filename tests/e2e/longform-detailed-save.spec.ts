import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function setup(page: Page, addScene = true) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, '场景编辑与细纲恢复验收')
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByLabel('章节摘要', { exact: true }).fill('先试绳再救人，代价是错过渡船。')
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByTitle('编辑本章细纲', { exact: true }).first().click()
  await expect(page.getByRole('heading', { name: '📝 第1章', exact: true })).toBeVisible()
  if (addScene) {
    await page.getByRole('button', { name: '添加场景', exact: true }).click()
    await expect(page.getByLabel('场景1 · 标题', { exact: true })).toHaveValue('新场景')
  }
}
async function details(page: Page) {
  return page.evaluate(async () => {
    const { useDetailedOutlineStore } = await (new Function('return import("/storyforge/src/stores/detailed-outline.ts")'))()
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const scope = useDetailedOutlineStore.getState().loadedScope
    if (!scope) throw new Error('Missing actual detail Work')
    return (await db.detailedOutlines.where('projectId').equals(scope.projectId).toArray()).filter((row: { workId: number }) => row.workId === scope.workId)
  })
}

test('rapid first scene additions use one persisted detail row and keep every scene after reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await setup(page, false)
  await page.getByRole('button', { name: '添加场景', exact: true }).dblclick()
  await expect(page.getByPlaceholder('场景标题...', { exact: true })).toHaveCount(2)
  await expect.poll(async () => (await details(page))[0]?.scenes.length).toBe(2)
  const rows = await details(page)
  expect(rows).toHaveLength(1); expect(new Set(rows[0].scenes.map((scene: { sceneId: string }) => scene.sceneId)).size).toBe(2)
  await page.reload()
  await expect(page.getByPlaceholder('场景标题...', { exact: true })).toHaveCount(2)
  expect(await details(page)).toEqual(rows); expect(errors).toEqual([])
})

test('all scene fields wait for acknowledgement before chapter navigation and survive narrow-screen reload', async ({ page }) => {
  await setup(page)
  await page.getByLabel('场景1 · 标题', { exact: true }).fill('巡桥试绳')
  await page.getByLabel('场景1 · 概要', { exact: true }).fill('先用石块试绳，确认承重后救人。')
  await page.getByLabel('场景节奏', { exact: true }).selectOption('fast')
  await page.getByLabel('场景1 · 估算字数', { exact: true }).fill('1234')
  await page.getByLabel('场景1 · 地点', { exact: true }).fill('望津桥')
  await page.getByLabel('场景1 · 核心冲突', { exact: true }).fill('救人与赶船只能择一')
  await page.getByLabel('场景1 · 备注', { exact: true }).fill('别让系统预知未来')
  await page.getByText('场景任务（可选，可留白）', { exact: true }).click()
  const tasks = { '进入状态': '站在桥头', '本场目标': '救下旅客', '关键选择': '先试绳', '行动后果': '错过渡船', '退出状态': '旅客脱险但本人滞留', '场景功能与读者期待': '兑现自救能力并留下渡船疑点' }
  for (const [label, value] of Object.entries(tasks)) await page.getByLabel(`场景1 · ${label}`, { exact: true }).fill(value)
  await page.getByRole('button', { name: '第2章', exact: true }).click()
  await expect(page.getByRole('heading', { name: '📝 第2章', exact: true })).toBeVisible()
  const saved = await details(page)
  expect(saved[0].scenes[0]).toMatchObject({ title: '巡桥试绳', summary: '先用石块试绳，确认承重后救人。', pace: 'fast', estimatedWords: 1234, location: '望津桥', conflict: '救人与赶船只能择一', notes: '别让系统预知未来', entryState: tasks['进入状态'], goal: tasks['本场目标'], keyChoice: tasks['关键选择'], outcome: tasks['行动后果'], exitState: tasks['退出状态'], sceneFunction: tasks['场景功能与读者期待'] })
  await page.setViewportSize({ width: 320, height: 740 }); await page.reload()
  await expect(page.getByLabel('场景1 · 标题', { exact: true })).toHaveValue('巡桥试绳')
  expect(await details(page)).toEqual(saved)
})

test('storage failure keeps the scene draft and blocks navigation until explicit retry succeeds', async ({ page }) => {
  await setup(page)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.detailedOutlines.update.bind(db.detailedOutlines)
    db.detailedOutlines.update = () => Promise.reject(new DOMException('细纲配额故障测试', 'QuotaExceededError'))
    Object.assign(window, { restoreDetailWrites: () => { db.detailedOutlines.update = update } })
  })
  await page.getByLabel('场景1 · 标题', { exact: true }).fill('不能丢的标题')
  await page.getByLabel('场景1 · 标题', { exact: true }).blur()
  await expect(page.getByRole('alert').filter({ hasText: '细纲配额故障测试' }).first()).toBeVisible()
  expect((await details(page))[0].scenes[0].title).toBe('新场景')
  await page.getByRole('button', { name: '第2章', exact: true }).click()
  await expect(page.getByRole('heading', { name: '📝 第1章', exact: true })).toBeVisible()
  await expect(page.getByLabel('场景1 · 标题', { exact: true })).toHaveValue('不能丢的标题')
  await page.evaluate(() => (window as unknown as { restoreDetailWrites: () => void }).restoreDetailWrites())
  await page.getByRole('button', { name: '重试保存场景1 · 标题', exact: true }).click()
  await expect.poll(async () => (await details(page))[0].scenes[0].title).toBe('不能丢的标题')
  await page.getByRole('button', { name: '第2章', exact: true }).click()
  await expect(page.getByRole('heading', { name: '📝 第2章', exact: true })).toBeVisible()
})

test('another page change is preserved and the stale scene field remains editable with its conflict', async ({ page }) => {
  await setup(page)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const row = (await db.detailedOutlines.toArray())[0]
    await db.detailedOutlines.update(row.id, { scenes: [{ ...row.scenes[0], summary: '另一页面已经确认的概要' }] })
  })
  await page.getByLabel('场景1 · 概要', { exact: true }).fill('本页尚未保存的概要')
  await page.getByLabel('场景1 · 概要', { exact: true }).blur()
  await expect(page.getByRole('alert').filter({ hasText: '其他页面修改' }).first()).toBeVisible()
  expect((await details(page))[0].scenes[0].summary).toBe('另一页面已经确认的概要')
  await expect(page.getByLabel('场景1 · 概要', { exact: true })).toHaveValue('本页尚未保存的概要')
})

test('malformed stored scenes show a local recovery error and reread only after explicit data recovery', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await setup(page); const saved = (await details(page))[0]
  await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    await db.detailedOutlines.update(id, { scenes: '保留损坏原文，不自动改写' })
  }, saved.id)
  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: '细纲 scenes 格式异常。' })).toBeVisible()
  await expect(page.getByLabel('场景1 · 标题', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.detailedOutlines.get(id)).scenes
  }, saved.id)).toBe('保留损坏原文，不自动改写')
  await page.evaluate(async row => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    await db.detailedOutlines.update(row.id, { scenes: row.scenes })
  }, saved)
  await page.getByRole('button', { name: '重新读取细纲', exact: true }).click()
  await expect(page.getByLabel('场景1 · 标题', { exact: true })).toHaveValue('新场景')
  expect(errors).toEqual([])
})

test('a native click immediately after editing an upper field still opens scene tasks during blur acknowledgement', async ({ page }) => {
  await setup(page)
  await page.getByLabel('场景1 · 概要', { exact: true }).fill('先试绳再救人。')
  await page.getByText('场景任务（可选，可留白）', { exact: true }).click()
  await expect(page.getByLabel('场景1 · 关键选择', { exact: true })).toBeVisible()
  await expect.poll(async () => (await details(page))[0].scenes[0].summary).toBe('先试绳再救人。')
})
