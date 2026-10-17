import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','requires isolated preview') })
for (const mode of ['hint','unavailable','private-to-one-human'] as const) test(`bounded recovery through the real player desk: ${mode}`, async ({ page }) => {
  await page.goto('./')
  const f = await page.evaluate(async mode => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-gate-recovery.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const f = await helper.setupGateHintFixtureV1({ unavailable: mode === 'unavailable',multiHuman: mode === 'private-to-one-human' })
    await api.resumeTtrpgOpenChecksV1(f.command)
    return { sessionId: f.command.sessionId,viewerKey: f.command.viewerKey,before: await api.readProductRuntimeState(f.command.sessionId) }
  },mode)
  await page.goto(`./play/session/${f.sessionId}`)
  await page.getByLabel('我的角色',{ exact: true }).selectOption(f.viewerKey)
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
  await expect(page.locator('body')).not.toContainText('RECOVERY-PRIVATE-OBSERVATION')
  await page.getByRole('button',{ name: '尝试一次有限修复',exact: true }).click()
  if (mode === 'hint') {
    await expect(page.getByRole('region',{ name: '当前可知线索与方向',exact: true })).toContainText('RECOVERY-PRIVATE-OBSERVATION')
    await expect(page.getByText('改由真人主持补写叙述',{ exact: true })).toBeVisible()
  } else await expect(page.getByRole('region',{ name: '冒险继续条件',exact: true })).toContainText('本轮主持已停止')
  await expect(page.getByRole('button',{ name: '尝试一次有限修复',exact: true })).toHaveCount(0)
  const state = await page.evaluate(async sessionId => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(sessionId)
  },f.sessionId)
  expect(state.entities).toEqual(f.before.entities)
  expect(state.ttrpg.openRun.worldTime).toEqual(f.before.ttrpg.openRun.worldTime)
  expect(state.ttrpg.openRun.coordination.calls).toEqual([])
  expect(state.ttrpg.openRun.gateRecoveries).toHaveLength(1)
  expect(state.ttrpg.openRun.knowledge).toHaveLength(mode === 'unavailable' ? 0 : 1)
  if (mode !== 'hint') expect(state.ttrpg.openRun.coordination.activeEpochKey).toBeNull()
  await page.reload()
  await page.getByLabel('我的角色',{ exact: true }).selectOption(mode === 'private-to-one-human' ? 'viewer.seat.companion.1' : f.viewerKey)
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
  if (mode === 'hint') await expect(page.locator('body')).toContainText('RECOVERY-PRIVATE-OBSERVATION')
  else {
    await expect(page.locator('body')).not.toContainText('RECOVERY-PRIVATE-OBSERVATION')
    await expect(page.getByRole('region',{ name: '冒险继续条件',exact: true })).toContainText('本轮主持已停止')
    await expect(page.getByRole('button',{ name: '继续结算已确认的行动',exact: true })).toHaveCount(0)
  }
  const again = await page.evaluate(async sessionId => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(sessionId)
  },f.sessionId)
  expect(again).toEqual(state)
})
