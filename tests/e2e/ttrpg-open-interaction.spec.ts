import { expect,test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','requires isolated open preview') })
for (const kind of ['move','retreat'] as const) test(`explicit ${kind} binding pays actual frozen time and location once without dice`,async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('./')
  const f = await page.evaluate(async kind => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const x = await (await importer('/storyforge/tests/helpers/open-ttrpg-interaction.ts')).seedOpenInteractionV1(kind)
    return { sessionId: x.f.sessionId,rule: JSON.stringify(['existing-action',x.rule.ruleKey,x.rule.interactionKey]),target: JSON.stringify(x.rule.targets[0].key),parameters: x.rule.parameters.map((p: any) => JSON.stringify(p.options[0].key)) }
  },kind)
  await page.goto(`./play/session/${f.sessionId}`)
  await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
  const card = page.getByTestId('ttrpg-open-manual-action')
  await card.getByLabel('行动规则',{ exact: true }).selectOption(f.rule)
  await card.getByLabel('行动对象',{ exact: true }).selectOption(f.target)
  for (let i = 0;i < f.parameters.length;i++) await card.getByLabel(`行动后果对象 ${i + 1}`,{ exact: true }).selectOption(f.parameters[i])
  await card.getByLabel('人工行动说明',{ exact: true }).fill(kind === 'move' ? '我明确前往集市。' : '我明确撤退到集市。')
  await card.getByRole('button',{ name: '提出行动，查看风险',exact: true }).click()
  await expect(page.getByRole('region',{ name: '当前行动',exact: true })).toContainText(`明确的${kind}互动`)
  if (kind === 'retreat') await expect(page.getByRole('region',{ name: '当前行动',exact: true })).toContainText('撤退会使混乱值增加')
  await expect(page.getByRole('region',{ name: '当前行动',exact: true })).not.toContainText('保密裁定')
  for (let i = 0;i < 3 && await page.getByRole('button',{ name: '同意以上风险与代价',exact: true }).count();i++) {
    const buttons = page.getByRole('button',{ name: '同意以上风险与代价',exact: true }),n = await buttons.count();await buttons.first().click();await expect(buttons).toHaveCount(n - 1)
  }
  await page.getByRole('button',{ name: '继续结算已确认的行动',exact: true }).click()
  await expect(page.getByText(`hero · 世界轮次 ${kind === 'move' ? 2 : 1}`,{ exact: true })).toBeVisible()
  await page.reload()
  await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero');await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
  const final = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId)
  },f)
  expect(final.entities.hero.locationKey).toBe('market');expect(final.ttrpg.openRun.ruleReceipts).toHaveLength(1)
  expect(final.ttrpg.openRun.ruleReceipts[0].result).toMatchObject({ outcome: 'automatic',check: null })
  expect(final.ttrpg.openRun.coordination.calls).toEqual([])
})

test('author imports a versioned interaction rule through normal UI and produces a real frozen Build',async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const f = await (await importer('/storyforge/tests/helpers/open-ttrpg-fresh-authoring.ts')).createFreshOpenDraftFixtureV1(2,true)
    const rule = (await importer('/storyforge/tests/helpers/ttrpg-open-content.ts')).openRuleFixture()
    rule.ruleSystemVersion += '.interaction';rule.title = '作者确认的无检定对话规则'
    const action = rule.actions[0];action.effects = [];action.target = 'self';action.costAmount = 0;action.costResourceKey = null
    action.usage = { mode: 'unlimited',maximum: null,resourceKey: null,cost: null,sharedPoolKey: null,cooldownRounds: null,reset: [] }
    rule.interactionBindings = [{ interactionKey: 'interaction.dialogue',kind: 'dialogue',title: '普通对话',actionKey: action.key,
      effectPlanRef: null,preconditions: [],timeCostWorldTurns: 0 }]
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return { scope: f.scope,original: await db.ttrpgRulePacks.get(f.settings.wizard.savedRulePackId),rule }
  })
  await page.goto(`./ttrpg/rules?project=${f.scope.projectId}&work=${f.scope.workId}`)
  const card = page.getByTestId('ttrpg-open-rule-import')
  const collision = { ...f.rule,ruleSystemVersion: f.original.ruleSystemVersion }
  await card.getByLabel('开放跑团规则文件',{ exact: true }).setInputFiles({ name: 'existing-version.json',mimeType: 'application/json',buffer: Buffer.from(JSON.stringify(collision)) })
  await card.getByRole('button',{ name: '确认并使用这份规则',exact: true }).click()
  await expect(card.getByRole('alert')).toContainText('validated 规则不可修改，请创建新规则版本')
  await card.getByLabel('开放跑团规则文件',{ exact: true }).setInputFiles({ name: 'interaction-rule.json',mimeType: 'application/json',buffer: Buffer.from(JSON.stringify(f.rule)) })
  await expect(card).toContainText('作者确认的无检定对话规则');await expect(card).toContainText('普通对话 · 耗时 0 个世界回合')
  await card.getByRole('button',{ name: '确认并使用这份规则',exact: true }).click()
  await expect(page.getByRole('combobox',{ name: '规则包',exact: true })).toContainText('作者确认的无检定对话规则')
  await page.getByRole('button',{ name: '保存制作方案',exact: true }).click()
  await expect(page.getByText('制作配置已保存',{ exact: true })).toBeVisible()
  await page.goto(`./ttrpg/confirm?project=${f.scope.projectId}&work=${f.scope.workId}`)
  await page.getByRole('button',{ name: '生成或更新审查方案',exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-brief-review')).toContainText('普通对话')
  const build = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'),helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
    const production = await db.productProductions.where('workId').equals(f.scope.workId).first()
    const fixture = { scope: f.scope,productionId: production.id },row = await db.productProductionBriefs.where('productionId').equals(production.id).first()
    const result = await (await importer('/storyforge/src/lib/product-production/commands.ts')).executeProductProductionCommand({ ...fixture,command: {
      type: 'authorize-start',commandId: 'interaction.author.start',expectedStateRevision: production.stateRevision,briefRevision: row.revision,
      briefHash: row.briefHash,authorizationNonce: 'interaction.author.confirmed' } })
    if (!result.ok) throw new Error(JSON.stringify(result))
    await helper.runOpenBrowserProductionV1(fixture);await helper.runOpenBrowserProductionV1(fixture,true)
    const completed = await helper.runOpenBrowserProductionV1(fixture,true)
    if (!completed.previewHash) throw new Error(JSON.stringify({ completed,failure: (await db.productBuilds.get(completed.buildId)).failureJson }))
    const preview = await (await importer('/storyforge/src/lib/product-production/preview-manifest.ts')).verifyProductBuildPreviewManifestV1(JSON.parse((await db.productBuilds.get(completed.buildId)).previewManifestJson),{ ttrpgProtocol: 2 })
    return { completed,rule: preview.runtimePackage.ttrpg.rulePack.content,original: await db.ttrpgRulePacks.get(f.original.id),calls: await db.productRuntimeSessions.count() }
  },f)
  expect(build.completed.terminal).toBe(true);expect(build.rule.interactionBindings).toEqual(f.rule.interactionBindings)
  expect(build.original).toEqual(f.original);expect(build.calls).toBe(0)
})
