import { expect,test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','requires isolated open preview') })
async function enterPlayer(page: import('@playwright/test').Page) {
  await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
}
async function chooseManual(page: import('@playwright/test').Page,input: { scope: any; sessionId: number },discover = false) {
  const selection = await page.evaluate(async input => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/open-table-service.ts'),catalog = await api.readTtrpgOpenManualActionCatalogV1({ ...input,viewerKey: 'viewer.seat.hero' })
    const rule = catalog.rules.find((r: any) => r.available && r.targets.length && r.route === 'existing-action')
    const discovery = catalog.discoveries.find((d: any) => d.route === rule.route && d.ruleKey === rule.ruleKey)
    return { rule: JSON.stringify([rule.route,rule.ruleKey]),target: JSON.stringify(rule.targets[0].key),parameters: rule.parameters.map((p: any) => JSON.stringify(p.options[0]?.key ?? null)),
      discovery: discovery ? { key: discovery.key,parameters: discovery.parameters.map((p: any) => JSON.stringify(p.options[0]?.key ?? null)) } : null }
  },input)
  await page.getByLabel('行动规则',{ exact: true }).selectOption(selection.rule)
  await page.getByLabel('行动对象',{ exact: true }).selectOption(selection.target)
  for (let i = 0; i < selection.parameters.length; i++) await page.getByLabel(`行动后果对象 ${i + 1}`,{ exact: true }).selectOption(selection.parameters[i])
  if (discover && selection.discovery) {
    await page.getByLabel('检查线索',{ exact: true }).selectOption(selection.discovery.key)
    for (let i = 0; i < selection.discovery.parameters.length; i++) await page.getByLabel(`线索后果对象 ${i + 1}`,{ exact: true }).selectOption(selection.discovery.parameters[i])
  }
  await page.getByLabel('人工行动说明',{ exact: true }).fill('我按已确认的规则检查灯塔现场。')
}
async function enterHost(page: import('@playwright/test').Page) {
  await page.getByLabel('我的主持席位',{ exact: true }).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。',{ exact: true }).check()
  await page.getByRole('button',{ name: '确认主持身份并进入',exact: true }).click()
}
test('normal author production and publication supports a real human GM action without AI advice or runtime model calls', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts'),publish = await importer('/storyforge/src/lib/product-production/service.ts'),api = await importer('/storyforge/src/lib/product/runtime-instances.ts')
    const f = await helper.seedOpenBrowserProductionV1({ humanGm: true,runtimeAIEnabled: false })
    await helper.runOpenBrowserProductionV1(f);await helper.runOpenBrowserProductionV1(f,true);await helper.runOpenBrowserProductionV1(f,true)
    const receipt = await publish.publishProductProductionV1(f)
    const session = await api.createProductRuntimeInstanceFromSource({ scope: f.scope,source: { kind: 'release',productReleaseId: receipt.receipt.productReleaseId },title: '真人主持人工行动',seed: 'normal.author.human.manual' })
    return { scope: f.scope,sessionId: session.id,runtimeSourceHash: session.runtimeSourceHash }
  })
  await page.goto(`./play/session/${f.sessionId}`)
  await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero')
  await page.getByLabel('我已了解安全约定和 AI 身份，并确认这是我的角色。',{ exact: true }).check()
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
  await page.getByRole('button',{ name: '返回身份选择',exact: true }).click()
  await enterHost(page)
  await page.getByLabel('我确认以上开团约定。',{ exact: true }).check()
  await page.getByRole('button',{ name: '由真人主持开始冒险',exact: true }).click()
  await expect(page.getByText('世界轮次 0 · 阶段进行中',{ exact: true })).toBeVisible()
  await page.getByRole('button',{ name: '返回身份选择',exact: true }).click();await enterPlayer(page)
  await chooseManual(page,f,true)
  await page.getByRole('button',{ name: '提出行动，查看风险',exact: true }).click()
  await expect(page.getByRole('region',{ name: '当前行动',exact: true })).toBeVisible()
  const pending = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId)
  },f)
  expect(pending.ttrpg.openRun.operations[0].status).toBe('awaiting-approval');expect(pending.ttrpg.openRun.coordination.calls).toEqual([])
  expect(pending.ttrpg.openRun.operations[0].plan.runtimeSourceHash).toBe(f.runtimeSourceHash)
  for (let n = 0; n < 4 && await page.getByRole('button',{ name: '同意以上风险与代价',exact: true }).count(); n++) {
    const buttons = page.getByRole('button',{ name: '同意以上风险与代价',exact: true }),count = await buttons.count();await buttons.first().click();await expect(buttons).toHaveCount(count - 1)
  }
  await page.getByRole('button',{ name: '继续结算已确认的行动',exact: true }).click()
  await page.getByRole('button',{ name: '交接给另一位玩家',exact: true }).click();await enterHost(page)
  await expect(page.getByLabel('主持叙述',{ exact: true })).toBeVisible()
  await page.getByLabel('主持叙述',{ exact: true }).fill('你们核实了现场可见的痕迹，灯塔旁仍有继续调查的方向。')
  await page.getByRole('button',{ name: '确认保存主持叙述',exact: true }).click()
  await expect(page.getByRole('region',{ name: '主持冒险记录',exact: true })).toContainText('核实了现场可见的痕迹')
  await page.getByRole('button',{ name: '返回身份选择',exact: true }).click();await enterPlayer(page)
  await page.getByRole('button',{ name: '继续结算已确认的行动',exact: true }).click()
  await expect(page.getByRole('region',{ name: '当前行动',exact: true })).toHaveCount(0)
  await page.getByRole('button',{ name: '结束本轮主持，准备下一次行动',exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-manual-action')).toBeVisible()
  await page.reload();await enterPlayer(page)
  const final = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId)
  },f)
  expect(final.ttrpg.openRun.operations[0].status).toBe('completed');expect(final.ttrpg.openRun.worldTime.worldTurn).toBeGreaterThan(0)
  expect(final.ttrpg.openRun.coordination.calls).toEqual([]);expect(final.ttrpg.openRun.coordination.epochs).toHaveLength(1)
  expect(final.ttrpg.authorization.seats.find((s: any) => s.actorKey === 'hero').consent.aiAdviceAllowed).toBe(false)
  await expect(page.getByTestId('ttrpg-open-manual-action')).toBeVisible()
  await expect(page.getByRole('button',{ name: '提出行动，查看风险',exact: true })).toBeVisible()
  await page.getByTestId('ttrpg-open-manual-action').scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('p3-manual-action-normal-author.png'),fullPage: true })
})
test('a saved manual authorization recovers after an operation write failure and reload without another epoch', async ({ page }) => {
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const x = await (await importer('/storyforge/tests/helpers/open-ttrpg-manual.ts')).seedManualTableV1()
    return { scope: x.f.scope,sessionId: x.f.sessionId }
  })
  await page.goto(`./play/session/${f.sessionId}`);await enterPlayer(page);await chooseManual(page,f)
  await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>,{ db } = await importer('/storyforge/src/lib/db/schema.ts'),add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    db.productRuntimeEvents.add = async (row: any,...args: any[]) => { if (row.type === 'ttrpg.open.operation.started') { db.productRuntimeEvents.add = add;throw new Error('manual operation interrupted') }return add(row,...args) }
  })
  await page.getByRole('button',{ name: '提出行动，查看风险',exact: true }).click()
  await expect(page.getByRole('button',{ name: '继续提交已授权的人工行动',exact: true })).toBeVisible()
  await page.reload();await enterPlayer(page)
  await page.getByRole('button',{ name: '继续提交已授权的人工行动',exact: true }).click()
  await expect(page.getByRole('region',{ name: '当前行动',exact: true })).toBeVisible()
  const final = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId)
  },f)
  expect(final.ttrpg.openRun.coordination.epochs).toHaveLength(1);expect(final.ttrpg.openRun.operations).toHaveLength(1)
  expect(final.ttrpg.openRun.operations[0].status).toBe('awaiting-approval');expect(final.ttrpg.openRun.coordination.calls).toEqual([])
})

test('current visible direction numbers match the rule selector and a legacy broken path cannot be selected', async ({ page }) => {
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p','return import(p)') as (p: string) => Promise<any>
    const x = await (await load('/storyforge/tests/helpers/open-ttrpg-manual.ts')).seedManualDiscoveryDirectionsV1()
    const paths = x.catalog.discoveries.filter((d: any) => d.route === 'generic-check')
    const rule = x.catalog.rules.find((r: any) => r.route === 'generic-check' && r.ruleKey === paths[1].ruleKey)
    return { scope: x.f.scope,sessionId: x.f.sessionId,rule: JSON.stringify([rule.route,rule.ruleKey]),target: JSON.stringify(rule.targets[0].key),parameters: rule.parameters.map((p: any) => JSON.stringify(p.options[0]?.key ?? null)),discoveryParameters: paths[1].parameters.map((p: any) => JSON.stringify(p.options[0]?.key ?? null)),old: paths[0].key,current: paths[1].key }
  })
  let modelPosts = 0
  await page.route('**/local-codex/v1/requests',route => { if (route.request().method() === 'POST') { modelPosts++;return route.abort() }return route.continue() })
  await page.goto('./play/session/'+f.sessionId);await enterPlayer(page)
  await page.getByLabel('行动规则',{ exact: true }).selectOption(f.rule)
  await page.getByLabel('行动对象',{ exact: true }).selectOption(f.target)
  for (let i = 0; i < f.parameters.length; i++) await page.getByLabel(`行动后果对象 ${i + 1}`,{ exact: true }).selectOption(f.parameters[i])
  const choices = page.getByLabel('检查线索',{ exact: true })
  await expect(choices.locator('option').filter({ hasText: '方向 1' })).toHaveJSProperty('disabled',true)
  await expect(choices.locator('option').filter({ hasText: '方向 2' })).toHaveJSProperty('disabled',false)
  await expect(page.getByRole('region',{ name: '当前可知线索与方向',exact: true })).toContainText('方向 1')
  await expect(page.getByRole('region',{ name: '当前可知线索与方向',exact: true })).toContainText('方向 2')
  await expect(page.locator('body')).not.toContainText('PRIVATE_')
  await choices.selectOption(f.current)
  await expect(choices).toHaveValue(f.current)
  for (let i = 0; i < f.discoveryParameters.length; i++) await page.getByLabel(`线索后果对象 ${i + 1}`,{ exact: true }).selectOption(f.discoveryParameters[i])
  await page.getByLabel('人工行动说明',{ exact: true }).fill('按公开方向审阅风险，不读取尚未发现的线索。')
  await page.getByRole('button',{ name: '提出行动，查看风险',exact: true }).click()
  await expect(page.getByRole('region',{ name: '当前行动',exact: true })).toBeVisible()
  expect(modelPosts).toBe(0)
})
