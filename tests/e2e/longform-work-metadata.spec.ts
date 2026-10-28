import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function create(page: Page, title: string) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  await createLongform(page, title)
  await openLongformLeaf(page, '项目概况')
  await expect(page.getByLabel('作品名称', { exact: true })).toHaveValue(title)
  return Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
}
async function read(page: Page, id: number) {
  return page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const project = await db.projects.get(id), work = await db.works.get(project.activeWorkId)
    return { project, work }
  }, id)
}
async function save(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('修改后自动保存', { exact: true })).toBeVisible()
}

test('all four Work info controls save, clear, reload and stay out of the workspace shell', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await create(page, '基本信息逐项隔离验收')
  await page.getByLabel('作品名称', { exact: true }).fill('雾港与盐桥')
  await page.getByLabel('作品简介', { exact: true }).fill('受伤的探路人必须自己判断道路，系统只展示代价。\n第二段保留中文。')
  const option = await page.evaluate(async () => {
    const { GENRE_OPTIONS } = await (new Function('return import("/storyforge/src/lib/types/index.ts")'))()
    return GENRE_OPTIONS.find((option: { value: string }) => option.value !== 'other')
  })
  await page.locator('fieldset div.relative > button').first().click()
  await page.getByRole('button', { name: option.label, exact: true }).click()
  await page.locator('fieldset div.relative > button').first().click()
  await page.getByLabel('目标字数', { exact: true }).press('Home')
  await page.getByLabel('目标字数', { exact: true }).press('ArrowRight')
  await save(page); await page.reload(); await openLongformLeaf(page, '项目概况')
  const current = await read(page, id)
  expect(current.work.title).toBe('雾港与盐桥'); expect(current.work.description).toContain('第二段保留中文')
  expect(current.work.genres).toContain(option.value); expect(current.work.targetWordCount).toBe(200000)
  expect(current.project).not.toHaveProperty('title'); expect(current.project).not.toHaveProperty('description')
  expect(current.project).not.toHaveProperty('genres'); expect(current.project).not.toHaveProperty('targetWordCount')
  await page.getByLabel('作品简介', { exact: true }).fill(''); await save(page); await page.reload(); await openLongformLeaf(page, '项目概况')
  await expect(page.getByLabel('作品简介', { exact: true })).toHaveValue('')
  expect((await read(page, id)).work.description).toBe(''); expect(errors).toEqual([])
})

test('queued info save targets the original Work when the active pointer changes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await create(page, '保存排队的作品 A')
  const fixture = await page.evaluate(async id => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, { createWorldWork }, { coordinatePendingEditV1 }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/works.ts'), imp('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')])
    const a = (await db.projects.get(id)).activeWorkId
    const b = await createWorldWork(id, { title: '活动作品 B', description: 'B 的原简介', kind: 'novel', novelProfile: 'long' })
    void coordinatePendingEditV1({ key: `work-info:${a}`, persist: () => new Promise<void>(resolve => Object.assign(window, { releaseInfoWrite: resolve })) })
    return { a, b: b.id }
  }, id)
  await page.waitForFunction(() => Boolean((window as unknown as { releaseInfoWrite?: unknown }).releaseInfoWrite))
  await page.getByLabel('作品简介', { exact: true }).fill('A 的未保存内容，不许写给 B')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.evaluate(async ({ id, b }) => {
    const { switchActiveWork } = await (new Function('return import("/storyforge/src/lib/workspace/works.ts")'))()
    await switchActiveWork(id, b)
    ;(window as unknown as { releaseInfoWrite: () => void }).releaseInfoWrite()
  }, { id, b: fixture.b })
  await expect.poll(async () => page.evaluate(async a => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.works.get(a)).description
  }, fixture.a)).toBe('A 的未保存内容，不许写给 B')
  const selected = await read(page, id)
  expect(selected.project.activeWorkId).toBe(fixture.b); expect(selected.work.description).toBe('B 的原简介')
  await page.reload(); await openLongformLeaf(page, '项目概况')
  await expect(page.getByLabel('作品名称', { exact: true })).toHaveValue('活动作品 B')
  await expect(page.getByLabel('作品简介', { exact: true })).toHaveValue('B 的原简介')
  expect(errors).toEqual([])
})

test('failed Work persistence keeps author input and explicit retry survives reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await create(page, '基本信息失败恢复隔离验收')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const original = db.works.update.bind(db.works)
    db.works.update = async () => { throw new DOMException('隔离元数据配额不足', 'QuotaExceededError') }
    Object.assign(window, { restoreMetadataWrite: () => { db.works.update = original } })
  })
  await page.getByLabel('作品简介', { exact: true }).fill('保存失败仍应保留这份简介')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '隔离元数据配额不足' })).toBeVisible()
  await expect(page.getByLabel('作品简介', { exact: true })).toHaveValue('保存失败仍应保留这份简介')
  expect((await read(page, id)).work.description).toBe('')
  await page.evaluate(() => { (window as unknown as { restoreMetadataWrite: () => void }).restoreMetadataWrite() })
  await save(page); await page.reload(); await openLongformLeaf(page, '项目概况')
  await expect(page.getByLabel('作品简介', { exact: true })).toHaveValue('保存失败仍应保留这份简介')
  expect(errors).toEqual([])
})

test('library rename and search preserve the selected Work across reopening', async ({ page }) => {
  const id = await create(page, '待重命名作品')
  const primary = page.getByRole('navigation', { name: '长篇一级导航' })
  await primary.getByRole('button', { name: '作品库', exact: true }).click()
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('改名后的探路人')
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload(); await page.getByLabel('搜索长篇', { exact: true }).fill('改名后的')
  await expect(page.getByRole('heading', { name: '改名后的探路人', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '进入长篇工作台', exact: true }).click()
  await openLongformLeaf(page, '项目概况')
  await expect(page.getByLabel('作品名称', { exact: true })).toHaveValue('改名后的探路人')
  expect((await read(page, id)).work.title).toBe('改名后的探路人')
})


test('library rename failure keeps its dialog and name until an acknowledged retry', async ({ page }) => {
  const id = await create(page, '改名失败原作')
  await page.getByRole('navigation', { name: '长篇一级导航' }).getByRole('button', { name: '作品库', exact: true }).click()
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const original = db.works.update.bind(db.works)
    db.works.update = async () => { throw new DOMException('改名写入失败', 'QuotaExceededError') }
    Object.assign(window, { restoreRenameWrite: () => { db.works.update = original } })
  })
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('必须保留的改名')
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('改名写入失败')
  await expect(dialog.getByRole('textbox')).toHaveValue('必须保留的改名')
  expect((await read(page, id)).work.title).toBe('改名失败原作')
  await page.evaluate(() => { (window as unknown as { restoreRenameWrite: () => void }).restoreRenameWrite() })
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(dialog).not.toBeVisible(); await page.reload()
  await expect(page.getByRole('heading', { name: '必须保留的改名', exact: true })).toBeVisible()
})

test('renaming an inactive sibling Work never changes the active Work pointer', async ({ page }) => {
  const id = await create(page, '活动原作 A')
  const fixture = await page.evaluate(async id => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, { createWorldWork }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/works.ts')])
    const a = (await db.projects.get(id)).activeWorkId
    const b = await createWorldWork(id, { title: '待改名作品 B', kind: 'novel', novelProfile: 'long' })
    return { a, b: b.id }
  }, id)
  await page.getByRole('navigation', { name: '长篇一级导航' }).getByRole('button', { name: '作品库', exact: true }).click()
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '待改名作品 B', exact: true }) })
  await card.getByRole('button', { name: '重命名', exact: true }).click()
  const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox').fill('独立改名作品 B')
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click(); await expect(dialog).not.toBeVisible()
  expect((await read(page, id)).project.activeWorkId).toBe(fixture.a)
  const b = await page.evaluate(async b => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.works.get(b)
  }, fixture.b)
  expect(b.title).toBe('独立改名作品 B')
  expect((await read(page, id)).work.title).toBe('活动原作 A')
})
