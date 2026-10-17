import { expect,test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','requires isolated open preview') })
async function enterHost(page: import('@playwright/test').Page) {
  await page.getByLabel('我的主持席位',{ exact: true }).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。',{ exact: true }).check()
  await page.getByRole('button',{ name: '确认主持身份并进入',exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-host-table')).toBeVisible()
}
test('a human GM claims a separate seat, waits for the player, and starts without AI consent or a player actor', async ({ page }) => {
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const f = await helper.seedOpenTtrpgSessionV1('真人主持开团', (p: any) => { p.ttrpg.campaign.gmMode = 'human';p.ttrpg.campaign.runtimePolicy.enabled = false })
    return { scope: f.scope,sessionId: f.sessionId }
  })
  await page.goto(`./play/session/${f.sessionId}`)
  await enterHost(page)
  await page.getByLabel('我确认以上开团约定。',{ exact: true }).check()
  await page.getByRole('button',{ name: '由真人主持开始冒险',exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('分别确认')
  await page.getByRole('button',{ name: '返回身份选择',exact: true }).click()
  await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero')
  await page.getByLabel('我已了解安全约定和 AI 身份，并确认这是我的角色。',{ exact: true }).check()
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
  await page.getByRole('button',{ name: '返回身份选择',exact: true }).click()
  await enterHost(page)
  await page.getByLabel('我确认以上开团约定。',{ exact: true }).check()
  await page.getByRole('button',{ name: '由真人主持开始冒险',exact: true }).click()
  await expect(page.getByText('世界轮次 0 · 阶段进行中',{ exact: true })).toBeVisible()
  const proof = await page.evaluate(async sessionId => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const state = await (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId)
    return { gm: state.ttrpg.authorization.seats.find((s: any) => s.role === 'gm'),calls: state.ttrpg.openRun.coordination.calls }
  },f.sessionId)
  expect(proof.gm).toMatchObject({ actorKey: null,controller: 'human',consent: { aiAdviceAllowed: false } });expect(proof.calls).toEqual([])
  await page.reload();await enterHost(page)
  await expect(page.getByText('世界轮次 0 · 阶段进行中',{ exact: true })).toBeVisible()
})
test('a human GM narrates another player’s real operation then hands the desk back without impersonating that player', async ({ page }) => {
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-checks.ts')
    const f = await helper.setupChecksFixtureV1({ humanGm: true },(p: any) => { p.ttrpg.campaign.characterTemplates[0].playerProfile.secret = 'PRIVATE-HUMAN-PROFILE' })
    await (await importer('/storyforge/src/lib/ttrpg/open-play-coordinator.ts')).resumeTtrpgOpenPlayV1(f.command)
    return { scope: f.f.scope,sessionId: f.command.sessionId,operationKey: f.command.operationKey }
  })
  await page.goto(`./play/session/${f.sessionId}`)
  await enterHost(page)
  await expect(page.getByText('PRIVATE-HUMAN-PROFILE',{ exact: true })).toHaveCount(0)
  await expect(page.getByLabel('主持叙述',{ exact: true })).toBeVisible()
  await page.getByLabel('主持叙述',{ exact: true }).fill('你们在灯塔里找到了安全的落脚点，可以继续核实刚才的线索。')
  await page.getByRole('button',{ name: '确认保存主持叙述',exact: true }).click()
  await expect(page.getByRole('region',{ name: '主持冒险记录',exact: true })).toContainText('安全的落脚点')
  await page.reload();await enterHost(page)
  await expect(page.getByRole('region',{ name: '主持冒险记录',exact: true })).toContainText('安全的落脚点')
  await page.screenshot({ path: test.info().outputPath('p3-human-gm-browser.png'),fullPage: true })
  await page.getByRole('button',{ name: '返回身份选择',exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-host-table')).toHaveCount(0)
  await expect(page.getByText('安全的落脚点',{ exact: false })).toHaveCount(0)
  await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
  await page.getByRole('button',{ name: '继续结算已确认的行动',exact: true }).click()
  await expect(page.getByRole('region',{ name: '当前行动',exact: true })).toHaveCount(0)
  const saved = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const state = await (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId)
    return { operation: state.ttrpg.openRun.operations.find((o: any) => o.operationKey === f.operationKey),narrations: state.ttrpg.openRun.narrations,calls: state.ttrpg.openRun.coordination.calls }
  },f)
  expect(saved.operation.status).toBe('completed');expect(saved.narrations).toHaveLength(1);expect(saved.narrations[0].binding.viewerKey).toBe('viewer.gm');expect(saved.calls).toEqual([])
})
