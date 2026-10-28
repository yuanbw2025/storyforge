import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function mineral(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  await createLongform(page, '词条手工写入隔离验收')
  const id = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  await openLongformLeaf(page, '自然环境')
  await page.getByRole('button').filter({ hasText: /自然资源$/ }).last().click()
  await page.getByRole('button', { name: '新建词条', exact: true }).click()
  await expect(page.getByPlaceholder('名称', { exact: true })).toHaveValue('新词条')
  return id
}
async function read(page: Page, projectId: number) {
  return page.evaluate(async projectId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.codexEntries.where('projectId').equals(projectId).first()
  }, projectId)
}

test('codex name, summary, description and two structured leaves survive an immediate reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await mineral(page)
  await page.getByPlaceholder('名称', { exact: true }).fill('响盐矿')
  await page.getByPlaceholder('一句话简介', { exact: true }).fill('记录盐桥回声的矿物')
  await page.getByPlaceholder('详细描述', { exact: true }).fill('敲击后才发出旧桥的回声，不能用它直接预知未来。')
  const appearance = page.getByText('外观', { exact: true }).locator('..').locator('textarea')
  const effect = page.getByText('功效作用', { exact: true }).locator('..').locator('textarea')
  await appearance.fill('有蓝色条纹的盐晶'); await effect.fill('记录一次敲击声')
  await openLongformLeaf(page, '故事设计')
  const entry = await read(page, id), fields = JSON.parse(entry.fields)
  expect(entry.name).toBe('响盐矿'); expect(entry.summary).toBe('记录盐桥回声的矿物')
  expect(entry.description).toContain('不能用它直接预知未来')
  expect(fields.appearance).toBe('有蓝色条纹的盐晶'); expect(fields.effect).toBe('记录一次敲击声')
  await page.reload(); expect((await read(page, id)).fields).toBe(entry.fields); expect(errors).toEqual([])
})

test('codex persistence failure retains the typed value and exposes a retry', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await mineral(page)
  await page.getByPlaceholder('一句话简介', { exact: true }).fill('已经保存的旧简介')
  await expect.poll(async () => (await read(page, id)).summary).toBe('已经保存的旧简介')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.codexEntries.update.bind(db.codexEntries)
    db.codexEntries.update = async () => { throw new DOMException('词条配额测试', 'QuotaExceededError') }
    Object.assign(window, { restoreCodexWrite: () => { db.codexEntries.update = update } })
  })
  await page.getByPlaceholder('一句话简介', { exact: true }).fill('失败时也必须保留的新简介')
  await expect(page.getByRole('alert').filter({ hasText: '词条配额测试' })).toBeVisible()
  await expect(page.getByPlaceholder('一句话简介', { exact: true })).toHaveValue('失败时也必须保留的新简介')
  expect((await read(page, id)).summary).toBe('已经保存的旧简介'); expect(errors).toEqual([])
  await page.evaluate(() => (window as unknown as { restoreCodexWrite: () => void }).restoreCodexWrite())
  await page.getByRole('button', { name: '重试保存词条', exact: true }).click()
  await expect.poll(async () => (await read(page, id)).summary).toBe('失败时也必须保留的新简介')
})

test('codex rapid structured edits merge while a prior write is delayed', async ({ page }) => {
  const id = await mineral(page)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const Dexie = db.constructor
    const update = db.codexEntries.update.bind(db.codexEntries)
    let first = true
    db.codexEntries.update = async (...args: unknown[]) => {
      if (first) { first = false; await Dexie.waitFor(new Promise(resolve => setTimeout(resolve, 300))) }
      return update(...args)
    }
  })
  await page.getByText('外观', { exact: true }).locator('..').locator('textarea').fill('蓝色盐晶')
  await page.getByText('功效作用', { exact: true }).locator('..').locator('textarea').fill('只记录一次回声')
  await openLongformLeaf(page, '故事设计')
  await expect(page).toHaveURL(/module=story-design/)
  expect(JSON.parse((await read(page, id)).fields)).toMatchObject({ appearance: '蓝色盐晶', effect: '只记录一次回声' })
})

test('codex malformed reference data remains intact and cannot crash the editor', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await mineral(page)
  const entry = await read(page, id)
  await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    await db.codexEntries.update(id, { refs: '{"craftInto":1}' })
  }, entry.id)
  await page.reload(); await openLongformLeaf(page, '自然环境')
  await page.getByRole('button').filter({ hasText: /自然资源$/ }).last().click()
  await page.getByText('新词条', { exact: true }).first().click()
  await expect(page.getByRole('alert').filter({ hasText: '词条格式异常' })).toBeVisible()
  expect((await read(page, id)).refs).toBe('{"craftInto":1}')
  expect(errors).toEqual([])
})

test('codex field management stays open after a failed write and retries the same definition', async ({ page }) => {
  const id = await mineral(page)
  const entry = await read(page, id)
  await page.getByRole('button', { name: '管理字段', exact: true }).click()
  const modal = page.getByRole('heading', { name: /的专属字段$/ }).locator('..').locator('..')
  await modal.getByPlaceholder('字段名(如:品级)', { exact: true }).first().fill('可辨识外观')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.codexCategories.update.bind(db.codexCategories)
    db.codexCategories.update = async () => { throw new DOMException('分类配额测试', 'QuotaExceededError') }
    Object.assign(window, { restoreCodexCategory: () => { db.codexCategories.update = update } })
  })
  await modal.getByRole('button', { name: '保存', exact: true }).click()
  await expect(modal.getByRole('alert')).toContainText('分类配额测试')
  await expect(modal.getByPlaceholder('字段名(如:品级)').first()).toHaveValue('可辨识外观')
  await page.evaluate(() => (window as unknown as { restoreCodexCategory: () => void }).restoreCodexCategory())
  await modal.getByRole('button', { name: '保存', exact: true }).click()
  await expect(modal).toHaveCount(0)
  const schema = await page.evaluate(async categoryId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.codexCategories.get(categoryId)).fieldSchema
  }, entry.categoryId)
  expect(JSON.parse(schema)[0].label).toBe('可辨识外观')
})

test('codex read failure preserves data and blocks editing until a visible retry succeeds', async ({ page }) => {
  const id = await mineral(page)
  const before = await read(page, id)
  await page.evaluate(async projectId => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { useCodexStore } = await imp('/storyforge/src/stores/codex.ts')
    const where = db.codexEntries.where.bind(db.codexEntries)
    db.codexEntries.where = () => { throw new Error('词条读取测试') }
    Object.assign(window, { restoreCodexRead: () => { db.codexEntries.where = where } })
    await useCodexStore.getState().loadAll(projectId)
  }, id)
  await expect(page.getByRole('alert').filter({ hasText: '词条读取测试' }).first()).toBeVisible()
  expect(await page.getByPlaceholder('名称', { exact: true }).evaluate(input => Boolean(input.closest('[inert]')))).toBe(true)
  await page.evaluate(() => (window as unknown as { restoreCodexRead: () => void }).restoreCodexRead())
  await page.getByRole('button', { name: '重新读取词条', exact: true }).first().click()
  await expect(page.getByRole('alert').filter({ hasText: '词条读取测试' })).toHaveCount(0)
  expect(await read(page, id)).toEqual(before)
})

test('codex composition blocks navigation and saves the completed Chinese input', async ({ page }) => {
  const id = await mineral(page)
  const input = page.getByPlaceholder('一句话简介', { exact: true })
  await input.dispatchEvent('compositionstart', { data: '盐' })
  await input.fill('盐镇探路的新简介')
  await page.getByRole('navigation', { name: '长篇工作台二级导航' }).getByRole('button', { name: '故事设计', exact: true }).click()
  await expect(page.getByText(/输入法仍在组合文字/).first()).toBeVisible()
  await expect(page).toHaveURL(/module=worldview-natural/)
  expect((await read(page, id)).summary).toBe('')
  await input.dispatchEvent('compositionend', { data: '盐镇探路的新简介' })
  await openLongformLeaf(page, '故事设计'); await expect(page).toHaveURL(/module=story-design/)
  expect((await read(page, id)).summary).toBe('盐镇探路的新简介')
})

test('codex incoming data during composition cannot erase the input or overwrite another author edit', async ({ page }) => {
  const id = await mineral(page), entry = await read(page, id)
  const input = page.getByPlaceholder('一句话简介', { exact: true })
  await input.dispatchEvent('compositionstart', { data: '盐' }); await input.fill('当前页面仍在组合的文字')
  await page.evaluate(async ({ projectId, entryId }) => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { useCodexStore } = await imp('/storyforge/src/stores/codex.ts')
    await db.codexEntries.update(entryId, { summary: '另一页面已经保存的简介' })
    await useCodexStore.getState().loadExisting(projectId)
  }, { projectId: id, entryId: entry.id })
  await expect(input).toHaveValue('当前页面仍在组合的文字')
  await input.dispatchEvent('compositionend', { data: '当前页面仍在组合的文字' })
  await expect(page.getByRole('alert').filter({ hasText: '其他页面修改' })).toBeVisible()
  await expect(input).toHaveValue('当前页面仍在组合的文字')
  expect((await read(page, id)).summary).toBe('另一页面已经保存的简介')
})
