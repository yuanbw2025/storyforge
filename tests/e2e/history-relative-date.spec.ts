import { expect, test } from '@playwright/test'

test('061 manual history leaves unknown numeric dates blank, preserves a relative expression after refresh and keeps explicit zero separate', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'relative-date061'))
  await context.route('**/*', route => {
    const r = route.request()
    return new URL(r.url()).origin === origin && ['GET', 'HEAD'].includes(r.method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
  const scope = await page.evaluate(async () => {
    const { seedCurrentWorkspace } = await (new Function('return import("/storyforge/tests/helpers/current-workspace.ts")'))()
    return (await seedCurrentWorkspace('061 架空相对日期')).scope
  })
  await page.goto(`./workspace/${scope.projectId}?module=history`)
  await page.getByRole('button', { name: '添加事件', exact: true }).click()
  await expect(page.getByText('年份未指定', { exact: false }).first()).toBeVisible()
  const read = () => page.evaluate(async projectId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.historicalTimelineEvents.where('projectId').equals(projectId).toArray())[0]
  }, scope.projectId)
  expect(await read()).toMatchObject({ year: null, date: '时间待定', isHistorical: false })
  const date = page.getByPlaceholder('如：开元十三年、公元725年', { exact: true })
  await date.fill('灰潮之前三旬')
  await expect.poll(async () => (await read()).date).toBe('灰潮之前三旬')
  await page.getByText('可留空；负数表示公元前', { exact: true }).click()
  let year = page.getByRole('textbox', { name: '数字化年份', exact: true })
  await year.fill('-221');await year.press('Enter')
  await expect.poll(async () => (await read()).year).toBe(-221)
  await page.locator('div.cursor-text').filter({ hasText: /^-221$/ }).click()
  year = page.getByRole('textbox', { name: '数字化年份', exact: true })
  await year.fill('0');await year.press('Enter')
  await expect.poll(async () => (await read()).year).toBe(0)
  await expect(page.getByText('纪年原点', { exact: false }).first()).toBeVisible()
  await page.locator('div.cursor-text').filter({ hasText: /^0$/ }).click()
  year = page.getByRole('textbox', { name: '数字化年份', exact: true })
  await year.fill('');await year.press('Enter')
  await expect.poll(async () => (await read()).year).toBeNull()
  await page.reload()
  await expect(page.getByText('年份未指定', { exact: false }).first()).toBeVisible()
  expect(await read()).toMatchObject({ year: null, date: '灰潮之前三旬', isHistorical: false })
})
