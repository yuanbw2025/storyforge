import { expect, test } from '@playwright/test'

test('new campaign play page remains usable with no sessions across reload and page navigation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'synthetic'))
  await page.route(/^https?:\/\//, route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { createTtrpgDraft } = await importer('/storyforge/src/lib/ttrpg/authoring-service.ts')
    const created = await createTtrpgDraft('空存档隔离回归')
    return { projectId: created.project.id, workId: created.work.id }
  })
  const route = `./ttrpg/play?project=${f.projectId}&work=${f.workId}`
  await page.goto(route)
  await expect(page.getByText('还没有跑团产品存档，请先完成制作或启动可玩预览。', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  await page.reload()
  await expect(page.getByTestId('ttrpg-runtime-panel')).toBeVisible()
  expect(errors).toEqual([])
  await page.goto(`./ttrpg/library?project=${f.projectId}&work=${f.workId}`)
  await page.goto(route)
  await expect(page.getByTestId('ttrpg-runtime-panel')).toBeVisible()
  expect(errors).toEqual([])
})
