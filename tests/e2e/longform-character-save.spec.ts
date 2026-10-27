import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function createCharacter(page: Page, weight = '主要') {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, '角色写入与归属隔离验收')
  const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  await openLongformLeaf(page, '角色生成'); await expect(page).toHaveURL(/module=characters/)
  await page.getByRole('button', { name: /^新建角色/ }).click()
  await page.getByRole('button', { name: weight, exact: true }).click()
  await page.getByRole('button', { name: '守序善良', exact: true }).click()
  await page.getByRole('button', { name: '创建并分流', exact: true }).click()
  await expect(page.getByPlaceholder('背景故事…', { exact: true })).toBeVisible()
  return projectId
}
async function row(page: Page, projectId: number) {
  return page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.characters.where('projectId').equals(id).first()
  }, projectId)
}
async function refuse(page: Page) {
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.characters.update.bind(db.characters)
    db.characters.update = async () => { throw new DOMException('角色配额测试', 'QuotaExceededError') }
    Object.assign(window, { restoreCharacterWrite: () => { db.characters.update = update } })
  })
}

test('a failed character dimension keeps the draft visible and can retry the same text', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await createCharacter(page)
  const before = await row(page, id)
  await refuse(page)
  await page.getByPlaceholder('背景故事…', { exact: true }).fill('断桥塌陷前曾独自探路，右手受伤后学会先测绳结。')
  await page.getByPlaceholder('背景故事…', { exact: true }).blur()
  await expect(page.getByRole('alert').filter({ hasText: '角色配额测试' })).toBeVisible()
  await expect(page.getByPlaceholder('背景故事…', { exact: true })).toHaveValue('断桥塌陷前曾独自探路，右手受伤后学会先测绳结。')
  expect((await row(page, id)).background).toBe(before.background); expect(errors).toEqual([])
  await page.evaluate(() => (window as unknown as { restoreCharacterWrite: () => void }).restoreCharacterWrite())
  await page.getByRole('button', { name: '重试保存背景故事', exact: true }).click()
  await expect.poll(async () => (await row(page, id)).background).toBe('断桥塌陷前曾独自探路，右手受伤后学会先测绳结。')
})

test('a failed character name stays open and never reports a save before acknowledgement', async ({ page }) => {
  const id = await createCharacter(page)
  await refuse(page)
  await page.getByText('新角色', { exact: true }).last().click()
  const input = page.locator('input.text-2xl')
  await input.fill('林照'); await input.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: '角色配额测试' })).toBeVisible()
  await expect(input).toHaveValue('林照'); expect((await row(page, id)).name).toBe('新角色')
})

