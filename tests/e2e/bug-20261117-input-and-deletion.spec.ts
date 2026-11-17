import { test, expect } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

for (const product of ['avg', 'ttrpg'] as const) test(`${product} library confirms deletion and preserves another Work`, async ({ page }) => {
  await page.goto('./')
  await page.evaluate(async product => {
    const imp = new Function('p', 'return import(p)')
    const m = await imp(product === 'avg' ? '/storyforge/src/lib/avg/draft-service.ts' : '/storyforge/src/lib/ttrpg/authoring-service.ts')
    const create = product === 'avg' ? m.createAvgDraftV1 : m.createTtrpgDraft
    await create('删除测试草稿'); await create('保留测试草稿')
  }, product)
  await page.goto(`./${product}/library`)
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '删除测试草稿', exact: true }) })
  await card.getByRole('button', { name: '删除作品', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '删除作品', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除作品', exact: true }).click()
  await expect(card).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '保留测试草稿', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '删除测试草稿', exact: true })).toHaveCount(0)
})

test('geography buffers IME preedit, blocks navigation and persists only completed location text', async ({ page }) => {
  await createLongform(page, '地理中文输入隔离验收')
  const id = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  await page.goto(`./workspace/${id}?module=geography`)
  await page.getByRole('button', { name: '列表', exact: true }).click()
  await page.getByRole('button', { name: '添加地点', exact: true }).click()
  const input = page.locator('label').filter({ hasText: /^名称$/ }).locator('..').locator('input')
  await expect(input).toHaveValue('新地点')
  const read = () => page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const row = await db.geographies.where('projectId').equals(id).first()
    return row ? JSON.parse(row.locations)[0]?.name : null
  }, id)
  await expect.poll(read).toBe('新地点')
  await input.dispatchEvent('compositionstart', { data: 'bei' })
  await input.fill('beijing')
  expect(await read()).toBe('新地点')
  await page.getByRole('navigation', { name: '长篇工作台二级导航' }).getByRole('button', { name: '故事设计', exact: true }).click()
  await expect(page.getByText(/输入法仍在组合文字/).first()).toBeVisible()
  await expect(page).toHaveURL(/module=geography/)
  await input.fill('北京')
  await input.dispatchEvent('compositionend', { data: '北京' })
  await openLongformLeaf(page, '故事设计')
  await expect.poll(read).toBe('北京')
  await page.reload()
  expect(await read()).toBe('北京')
})

test('adventure draft deletion preserves the host novel', async ({ page }) => {
  await createLongform(page, '冒险草稿的原小说')
  const id = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  const workId = await page.evaluate(async projectId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const project = await db.projects.get(projectId)
    await db.productProductions.add({projectId, worldId:project.activeWorldId, workId:project.activeWorkId,
      productionKey:'deletion.browser.fixture', productType:'text-adventure', title:'删除冒险空草稿',
      status:'consulting', stateRevision:0, controlEpoch:0, currentBriefRevision:null, currentBuildNumber:null,
      currentProductReleaseId:null, lastErrorJson:'{}', createdAt:1, updatedAt:1})
    return project.activeWorkId
  }, id)
  await page.goto(`./adventure/production?project=${id}`)
  await page.getByRole('button', {name:'为当前项目显式启用',exact:true}).click()
  await page.getByRole('button', {name:'删除草稿',exact:true}).click()
  await page.getByRole('dialog').getByRole('button', {name:'删除草稿',exact:true}).click()
  await expect(page.getByRole('button', {name:'删除草稿',exact:true})).toHaveCount(0)
  const result = await page.evaluate(async workId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return {work:await db.works.get(workId), remaining:await db.productProductions.where('workId').equals(workId).count()}
  }, workId)
  expect(result.work.title).toBe('冒险草稿的原小说')
  expect(result.remaining).toBe(0)
})
