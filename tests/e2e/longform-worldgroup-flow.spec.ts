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
  return Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
}
async function backupAndContinue(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: '继续', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('dialog').getByRole('button', { name: '立即备份', exact: true }).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.json$/)
}
async function origin(page: Page, value?: string) {
  await openLongformLeaf(page, '世界起源')
  await page.locator('.worldview-origin-nav').getByRole('button', { name: '世界来源', exact: true }).click()
  if (value !== undefined) {
    await page.locator('div.cursor-text:visible').first().click()
    const input = page.locator('textarea:visible').first()
    await input.fill(value); await input.press('Tab'); await expect(input).not.toBeVisible()
  }
  return page.locator('div.cursor-text:visible').first()
}
async function read(page: Page, id: number) {
  return page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { project: await db.projects.get(id), groups: await db.worldGroups.where('projectId').equals(id).toArray(), worldviews: await db.worldviews.where('projectId').equals(id).toArray() }
  }, id)
}

test('multiworld enable, primary editing, disable and reenable retain the same author record', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await create(page, '多世界开关往返隔离验收')
  await origin(page, '开关前保留的盐镇来历')
  const originalId = (await read(page, id)).worldviews[0].id
  await openLongformLeaf(page, '项目概况')
  await page.getByRole('button', { name: '多世界模式', exact: true }).click(); await backupAndContinue(page)
  await expect(page.getByRole('button', { name: '多世界模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(await origin(page)).toHaveText('开关前保留的盐镇来历')
  await origin(page, '主世界保存后的盐镇来历')
  await openLongformLeaf(page, '项目概况'); await page.getByRole('button', { name: '多世界模式', exact: true }).click()
  await expect(page.getByRole('button', { name: '多世界模式', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.reload(); await expect(await origin(page)).toHaveText('主世界保存后的盐镇来历')
  await origin(page, '关闭多世界后仍可接着修改')
  await openLongformLeaf(page, '项目概况'); await page.getByRole('button', { name: '多世界模式', exact: true }).click(); await backupAndContinue(page)
  await expect(await origin(page)).toHaveText('关闭多世界后仍可接着修改')
  const state = await read(page, id)
  expect(state.worldviews).toHaveLength(1); expect(state.worldviews[0].id).toBe(originalId)
  expect(errors).toEqual([])
})

test('a failed multiworld flag write rolls back reassignment and offers an explicit retry', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await create(page, '多世界失败回滚隔离验收')
  await origin(page, '失败前的正式世界来源')
  const before = await read(page, id)
  await openLongformLeaf(page, '项目概况')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.projects.update.bind(db.projects)
    db.projects.update = async (key: number, patch: Record<string, unknown>) => {
      if ('enableMultiWorld' in patch) throw new DOMException('多世界开关写入失败', 'QuotaExceededError')
      return update(key, patch)
    }
    Object.assign(window, { restoreMultiworldWrite: () => { db.projects.update = update } })
  })
  await page.getByRole('button', { name: '多世界模式', exact: true }).click(); await backupAndContinue(page)
  await expect(page.getByRole('alert').filter({ hasText: '多世界开关写入失败' })).toBeVisible()
  const after = await read(page, id)
  expect(after.project.enableMultiWorld).toBe(before.project.enableMultiWorld)
  expect(Boolean(after.project.enableMultiWorld)).toBe(false)
  expect(after.worldviews).toEqual(before.worldviews); expect(after.groups).toEqual(before.groups)
  expect(errors).toEqual([])
  await page.evaluate(() => (window as unknown as { restoreMultiworldWrite: () => void }).restoreMultiworldWrite())
  await page.getByRole('button', { name: '多世界模式', exact: true }).click(); await backupAndContinue(page)
  await expect(page.getByRole('button', { name: '多世界模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload(); await expect(await origin(page)).toHaveText('失败前的正式世界来源')
})

test('world group persistence failure keeps all inputs and the save button usable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await create(page, '世界详情失败恢复隔离验收')
  await openLongformLeaf(page, '项目概况'); await page.getByRole('button', { name: '多世界模式', exact: true }).click(); await backupAndContinue(page)
  await openLongformLeaf(page, '世界总览'); await page.getByRole('button', { name: '添加世界', exact: true }).click()
  const name = page.getByText('世界名称', { exact: true }).locator('..').locator('input')
  await name.fill('断桥小界')
  await page.getByText('世界描述', { exact: true }).locator('..').locator('textarea').fill('作者手改的世界描述必须保留')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.worldGroups.update.bind(db.worldGroups)
    db.worldGroups.update = async () => { throw new DOMException('世界详情配额测试', 'QuotaExceededError') }
    Object.assign(window, { restoreWorldGroupWrite: () => { db.worldGroups.update = update } })
  })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '世界详情配额测试' })).toBeVisible()
  await expect(name).toHaveValue('断桥小界')
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
  expect(errors).toEqual([])
  await page.evaluate(() => (window as unknown as { restoreWorldGroupWrite: () => void }).restoreWorldGroupWrite())
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await read(page, id)).groups.some((group: { name: string }) => group.name === '断桥小界')).toBe(true)
  await page.reload(); await openLongformLeaf(page, '世界总览'); await expect(page.getByText('断桥小界', { exact: true }).first()).toBeVisible()
})

test('all visible group controls flush on back, clear, reload and keep A/B settings separate', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await create(page, '世界组完整手改隔离验收')
  await origin(page, '主世界独立保存的来历')
  await openLongformLeaf(page, '项目概况'); await page.getByRole('button', { name: '多世界模式', exact: true }).click(); await backupAndContinue(page)
  await openLongformLeaf(page, '世界总览'); await page.getByRole('button', { name: '添加世界', exact: true }).click()
  const control = (label: string) => page.getByText(label, { exact: true }).locator('..').locator('input,textarea,select').first()
  await control('世界名称').fill('断桥小界')
  await control('世界描述').fill('必须通过断桥探路后才能判断去向。')
  await control('世界类型').selectOption('instance')
  await page.getByRole('button', { name: '🌙', exact: true }).click()
  await control('预计章节数').fill('12')
  for (const label of ['进入条件', '能力限制', '可带走的能力/物品', '离开条件']) await control(label).fill(`作者确认·${label}·不能自动解决冲突`)
  await page.getByRole('button', { name: '返回世界总览', exact: true }).click()
  const side = (await read(page, id)).groups.find((group: { name: string }) => group.name === '断桥小界')
  expect(side).toMatchObject({ type: 'instance', icon: '🌙', plannedChapterCount: 12, description: '必须通过断桥探路后才能判断去向。', entryCondition: '作者确认·进入条件·不能自动解决冲突', exitCondition: '作者确认·离开条件·不能自动解决冲突', powerRestriction: '作者确认·能力限制·不能自动解决冲突', takeawayRules: '作者确认·可带走的能力/物品·不能自动解决冲突' })
  await page.reload(); await openLongformLeaf(page, '世界总览')
  const row = () => page.getByText('断桥小界', { exact: true }).first().locator('..').locator('..').locator('..')
  await row().getByRole('button', { name: '编辑', exact: true }).click()
  for (const label of ['世界描述', '进入条件', '能力限制', '可带走的能力/物品', '离开条件']) await control(label).fill('')
  await control('预计章节数').fill('0')
  await page.getByRole('button', { name: '返回世界总览', exact: true }).click()
  await origin(page)
  await page.getByRole('button').filter({ hasText: /主世界$/ }).last().click()
  await page.getByRole('button').filter({ hasText: '断桥小界' }).last().click()
  await expect(await origin(page)).not.toHaveText('主世界独立保存的来历')
  await origin(page, '小界独立保存的来历')
  await page.getByRole('button').filter({ hasText: /断桥小界$/ }).last().click()
  await page.getByRole('button').filter({ hasText: /主世界/ }).last().click()
  await expect(await origin(page)).toHaveText('主世界独立保存的来历')
  const state = await read(page, id), saved = state.groups.find((group: { id: number }) => group.id === side.id)
  expect(saved.description).toBe(''); expect(saved.entryCondition ?? '').toBe(''); expect(saved.exitCondition ?? '').toBe('')
  expect(saved.powerRestriction ?? '').toBe(''); expect(saved.takeawayRules ?? '').toBe(''); expect(saved.plannedChapterCount ?? 0).toBe(0)
  expect(state.worldviews.find((world: { worldGroupId: number }) => world.worldGroupId === side.id).worldOrigin).toBe('小界独立保存的来历')
  await openLongformLeaf(page, '世界总览')
  await row().getByRole('button', { name: '删除世界', exact: true }).click()
  await row().getByRole('button', { name: '取消', exact: true }).click()
  expect((await read(page, id)).groups.some((group: { id: number }) => group.id === side.id)).toBe(true)
  await row().getByRole('button', { name: '删除世界', exact: true }).click(); await row().getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  expect((await read(page, id)).worldviews.some((world: { worldGroupId: number }) => world.worldGroupId === side.id)).toBe(true)
  await row().getByRole('button', { name: '删除世界', exact: true }).click(); await row().getByRole('button', { name: '确认删除', exact: true }).click(); await backupAndContinue(page)
  await expect.poll(async () => (await read(page, id)).groups.some((group: { id: number }) => group.id === side.id)).toBe(false)
  const deleted = await read(page, id)
  expect(deleted.worldviews.some((world: { worldGroupId: number }) => world.worldGroupId === side.id)).toBe(false)
  expect(deleted.worldviews[0].worldOrigin).toBe('主世界独立保存的来历')
  await page.reload(); expect(errors).toEqual([])
})

test('a 320px group editor keeps its save controls inside the screen', async ({ page }) => {
  await create(page, '手机世界编辑隔离验收')
  await openLongformLeaf(page, '项目概况'); await page.getByRole('button', { name: '多世界模式', exact: true }).click(); await backupAndContinue(page)
  await openLongformLeaf(page, '世界总览'); await page.getByRole('button', { name: '添加世界', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 740 })
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }))).toEqual({ width: 320, viewport: 320 })
  const save = await page.getByRole('button', { name: '保存', exact: true }).boundingBox()
  expect(save).not.toBeNull(); expect(save!.x).toBeGreaterThanOrEqual(0); expect(save!.x + save!.width).toBeLessThanOrEqual(320)
})
