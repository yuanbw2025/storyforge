import { expect, test } from '@playwright/test'

test.use({ actionTimeout: 15000 })
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
test('the normal table creates a continued release, renews consent and preserves the original after reload', async ({ page }, info) => {
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
    const { seedOpenFixtureReleaseV1 } = await load('/storyforge/tests/helpers/open-ttrpg-release.ts')
    const f = await setupClosedStageOpeningV1(true), pkg = structuredClone(f.f.f.runtimePackage)
    pkg.ttrpg.campaign.stageClosurePolicy.triggers[0].summaryPrompt = '续团的新阶段说明。'
    const target = await seedOpenFixtureReleaseV1(f.f.f.scope, pkg, f.f.f.published)
    return { sessionId: f.f.command.sessionId, targetId: target.id, before: f.input.state }
  })
  await page.goto('./play/session/' + f.sessionId)
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await page.getByText('使用新发布续团', { exact: true }).click()
  const panel = page.getByRole('group', { name: '新发布续团', exact: true })
  await panel.getByLabel('续团发布', { exact: true }).selectOption(String(f.targetId))
  await panel.getByLabel('本次续团说明', { exact: true }).fill('承接新版阶段安排，保留当前冒险。')
  await panel.getByRole('button', { name: '检查续团方案', exact: true }).click()
  await expect(panel.getByText(/续团检查通过/)).toBeVisible()
  const confirm = panel.getByRole('button', { name: '确认创建续团存档', exact: true })
  await expect(confirm).toBeDisabled()
  await panel.getByLabel('我确认以上承接与中断安排，创建续团存档。', { exact: true }).check()
  await confirm.click()
  await page.getByRole('link', { name: '进入续团，确认席位与开局', exact: true }).click()
  await expect(page).toHaveURL(/play\/session\/\d+$/)
  const childId = Number(new URL(page.url()).pathname.split('/').pop())
  expect(childId).not.toBe(f.sessionId)
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByLabel('我已了解安全约定和 AI 身份，并确认这是我的角色。', { exact: true }).check()
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  const opening = page.getByRole('group', { name: '确认续团开局', exact: true })
  await expect(opening).toBeVisible()
  await opening.getByLabel('我确认以上约定，开始这场冒险。', { exact: true }).check()
  await opening.getByRole('button', { name: '确认续团开局', exact: true }).click()
  await expect(opening).toHaveCount(0)
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  const after = await page.evaluate(async ({ parentId, childId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { readProductRuntimeState } = await load('/storyforge/src/lib/product/runtime-core.ts')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { parent: await readProductRuntimeState(parentId), child: await readProductRuntimeState(childId),
      row: await db.productRuntimeSessions.get(childId), children: await db.productRuntimeSessions.where('parentSessionId').equals(parentId).count() }
  }, { parentId: f.sessionId, childId })
  expect(after.parent).toEqual(f.before)
  expect(after.children).toBe(1)
  expect(after.row.productReleaseId).toBe(f.targetId)
  expect(after.child.entities).toEqual(f.before.entities)
  expect(after.child.ttrpg.openRun.worldTime.worldTurn).toBe(f.before.ttrpg.openRun.worldTime.worldTurn)
  expect(after.child.ttrpg.openRun.releaseContinuation.confirmedRef).toBeTruthy()
  expect(after.child.ttrpg.openRun.stage.status).toBe('open')
  expect(posts).toEqual([])
  await page.screenshot({ path: info.outputPath('continued-release.png'), fullPage: true })
})
