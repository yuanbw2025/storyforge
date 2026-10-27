import { expect, test } from '@playwright/test'

test('ordinary build can explicitly enable open TTRPG without creating a game or calling a model', async ({ page }) => {
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW === '1', 'Preview builds deliberately force the existing flag')
  await page.goto('./ttrpg/library')
  await expect(page.getByTestId('ttrpg-author-page')).toBeVisible({ timeout: 30000 })
  const toggle = page.getByRole('checkbox', { name: '启用开放跑团试用', exact: true })
  const create = page.getByRole('button', { name: '新建开放跑团（预览）', exact: true })
  await expect(toggle).not.toBeChecked(); await expect(create).toHaveCount(0)
  await toggle.check(); await expect(create).toBeVisible()
  await page.reload(); await expect(toggle).toBeChecked(); await expect(create).toBeVisible()
  await toggle.uncheck(); await expect(create).toHaveCount(0)
  const counts = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { productions: await db.productProductions.count(), sessions: await db.productRuntimeSessions.count(), runs: await db.agentRuns.count() }
  })
  expect(counts).toEqual({ productions: 0, sessions: 0, runs: 0 })
})
