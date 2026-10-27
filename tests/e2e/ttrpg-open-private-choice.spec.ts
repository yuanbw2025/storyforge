import { expect,test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','requires isolated preview') })
async function enterPlayer(page: import('@playwright/test').Page) {
  await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
}
for (const humanGm of [true,false]) test(`private cost disclosure, personal choice and recovery (${humanGm ? 'human GM' : 'AI GM fallback'})`, async ({ page }) => {
  await page.goto('./')
  const f = await page.evaluate(async humanGm => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-private-choice.ts'),api = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const x = await helper.seedPrivateChoiceFixtureV1({ humanGm }),state = await api.readProductRuntimeState(x.f.sessionId)
    const resource = x.f.runtimePackage.ttrpg.rulePack.content.resources[0]
    return { sessionId: x.f.sessionId,scope: x.f.scope,resourceKey: resource.key,resourceName: resource.name,initial: Number(state.entities.hero.attributes[`resource.${resource.key}`]),
      entities: state.entities,receipts: state.ttrpg.openRun.ruleReceipts,worldTime: state.ttrpg.openRun.worldTime }
  },humanGm)
  await page.goto(`./play/session/${f.sessionId}`);await enterPlayer(page)
  await expect(page.getByRole('button',{ name: '选择「选项 2」',exact: true })).toHaveCount(0)
  if (humanGm) {
    await expect(page.getByRole('region',{ name: '保密后果主持告知',exact: true })).toHaveCount(0)
    await page.getByRole('button',{ name: '交接给另一位玩家',exact: true }).click()
    await page.getByLabel('我的主持席位',{ exact: true }).selectOption('viewer.gm')
    await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。',{ exact: true }).check()
    await page.getByRole('button',{ name: '确认主持身份并进入',exact: true }).click()
  }
  const panel = page.getByRole('region',{ name: '保密后果主持告知',exact: true })
  await expect(panel.getByRole('button',{ name: '读取需要告知的后果',exact: true })).toBeDisabled()
  await panel.getByLabel('我以主持身份查看本次保密后果。',{ exact: true }).check()
  await panel.getByRole('button',{ name: '读取需要告知的后果',exact: true }).click()
  await panel.getByRole('button',{ name: '核对将向玩家告知的代价',exact: true }).click()
  await expect(panel).toContainText('消耗 1');await expect(panel).toContainText('消耗 2')
  await panel.getByRole('button',{ name: '确认告知，交由本人选择',exact: true }).click()
  if (humanGm) await expect(page.getByText('必要后果告知已保存，等待有权确认的人亲自选择。',{ exact: true })).toBeVisible()
  else await expect(page.getByRole('button',{ name: '选择「选项 2」',exact: true })).toBeEnabled()
  const disclosed = await page.evaluate(async sessionId => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId)
  },f.sessionId)
  expect(disclosed.entities).toEqual(f.entities);expect(disclosed.ttrpg.openRun.ruleReceipts).toEqual(f.receipts);expect(disclosed.ttrpg.openRun.worldTime).toEqual(f.worldTime)
  await page.reload();await enterPlayer(page)
  await expect(page.getByRole('button',{ name: '选择「选项 2」',exact: true })).toBeEnabled()
  await expect(page.getByTestId('ttrpg-open-host-table')).toHaveCount(0)
  await expect(page.getByLabel('主持查看已保存裁定',{ exact: true })).toHaveCount(0)
  await expect(page.getByText('OTHER-PRIVATE-PROFILE',{ exact: true })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath(`p4-private-choice-${humanGm ? 'human' : 'fallback'}-player.png`),fullPage: true })
  await page.getByRole('button',{ name: '选择「选项 2」',exact: true }).click()
  await expect(page.getByRole('button',{ name: '选择「选项 2」',exact: true })).toHaveCount(0)
  await page.getByRole('button',{ name: '继续结算已确认的行动',exact: true }).click()
  await expect(page.getByRole('region',{ name: '我的当前状态',exact: true })).toContainText(`${f.resourceName}：${f.initial - 2}`)
  await page.reload();await enterPlayer(page)
  await expect(page.getByRole('region',{ name: '我的当前状态',exact: true })).toContainText(`${f.resourceName}：${f.initial - 2}`)
})
