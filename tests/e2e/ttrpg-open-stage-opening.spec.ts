import { expect, test } from '@playwright/test'

test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
test('the actual table reviews and confirms the next stage once, retaining progress after reload', async ({ page }, info) => {
  test.setTimeout(120000)
  const posts: string[] = []
  await page.route('**/*', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    posts.push(route.request().url()); return route.abort('failed')
  })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { setupClosedStageOpeningV1 } = await load('/storyforge/tests/helpers/open-ttrpg-stage-opening.ts')
    const { f, input } = await setupClosedStageOpeningV1()
    return { sessionId: f.command.sessionId, templateKey: input.templateKeys[0], before: input.state }
  })
  await page.goto('./play/session/' + f.sessionId)
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  const panel = page.getByRole('group', { name: '下一阶段开局', exact: true })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '检查下一阶段开局', exact: true }).click()
  await expect(panel.getByText(/开局检查通过/)).toBeVisible()
  const begin = panel.getByRole('button', { name: '确认开始下一阶段', exact: true })
  await expect(begin).toBeDisabled()
  await panel.getByLabel('我确认沿当前团局进入下一阶段。', { exact: true }).check()
  await begin.click()
  await expect(panel).toHaveCount(0)
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  const after = await page.evaluate(async sessionId => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { state: await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId),
      events: await db.productRuntimeEvents.where('sessionId').equals(sessionId).filter((e: any) => e.type === 'ttrpg.open.stage.opened').toArray() }
  }, f.sessionId)
  expect(after.events).toHaveLength(1)
  expect(after.state.ttrpg.openRun.stage).toEqual({ status: 'open', openedAtWorldTurn: f.before.ttrpg.openRun.worldTime.worldTurn, closedAtWorldTurn: null })
  for (const field of ['worldTime', 'chaos', 'clocks', 'fronts', 'knowledge', 'factLedger', 'operations', 'coordination', 'stageClosures']) {
    expect(after.state.ttrpg.openRun[field]).toEqual(f.before.ttrpg.openRun[field])
  }
  expect(after.state.entities).toEqual(f.before.entities)
  expect(after.state.ttrpg.openRun.stageOpenings).toHaveLength(1)
  expect(posts).toEqual([])
  await page.screenshot({ path: info.outputPath('stage-opened.png'), fullPage: true })
})
