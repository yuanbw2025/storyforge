import { test, expect } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview'))

/** Real normal author controls and storage. Local design/rule files and the
 * built-in world are engineering fixtures; no model or human acceptance claim. */
test('a blank author creates open through the normal library, reviews design/rules, reloads and freezes its real Brief without a preseeded draft or model call', async ({ page }, info) => {
  test.setTimeout(150000)
  await page.goto('./ttrpg/library')
  await page.getByRole('button', { name: '新建开放跑团（预览）', exact: true }).click()
  await page.getByLabel('战役名称', { exact: true }).fill('从空白开始的开放战役')
  await page.getByLabel('开场与核心目标', { exact: true }).fill('暴雨来临前找回灯塔钥匙，决定如何保护港口。')
  await page.getByLabel('玩家身份', { exact: true }).fill('自愿合作的港口调查队')
  const editor = page.getByTestId('ttrpg-open-authoring-editor')
  await expect(editor).toBeVisible()
  const files = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), fixture = await load('/storyforge/tests/helpers/ttrpg-open-content.ts')
    const c = fixture.openCampaignFixture()
    const authoring = { factPolicy: [], situationTemplates: c.situationTemplates, openingSituationKeys: c.openingSituationKeys,
      effectPlanTemplates: c.effectPlanTemplates, pressure: { clocks: c.clocks, fronts: c.fronts },
      companionPolicy: { ...c.companionPolicy, approvalBindings: c.companionPolicy.approvalBindings.map((binding: any) => ({ ...binding, approverSeatKeys: ['player.1'] })) },
      stageClosurePolicy: c.stageClosurePolicy, dynamicEntityTemplates: c.dynamicEntityTemplates ?? [], runtimePolicy: c.runtimePolicy }
    return { authoring: JSON.stringify(authoring), rule: JSON.stringify(fixture.openRuleFixture()) }
  })
  await editor.locator('summary').filter({ hasText: '导入或修改完整开放设计' }).click()
  await editor.getByLabel('开放设计文件', { exact: true }).setInputFiles({ name: 'author-design.json', mimeType: 'application/json', buffer: Buffer.from(files.authoring) })
  await expect(editor.getByTestId('ttrpg-open-authoring-candidate')).toBeVisible()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('应用或放弃')
  expect(await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/lib/db/schema.ts')).db.ttrpgAuthoringDrafts.count()
  })).toBe(0)
  await editor.getByRole('button', { name: '应用到开放设计草稿', exact: true }).click()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page).toHaveURL(/project=/)
  await page.reload()
  await expect(page.getByLabel('战役名称', { exact: true })).toHaveValue('从空白开始的开放战役')
  await expect(page.getByTestId('ttrpg-open-authoring-editor')).toContainText('已有 1 个局势')
  await page.screenshot({ path: info.outputPath('normal-open-author-editor.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })
  const initial = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const row = await db.ttrpgAuthoringDrafts.toCollection().first(), settings = (await load('/storyforge/src/lib/ttrpg/authoring-contract.ts')).settingsFromTtrpgDraft(row)
    return { row, settings, builds: await db.productBuilds.count(), runs: await db.agentRuns.count() }
  })
  expect(initial.settings.runFormat).toBe('open'); expect(initial.settings.wizard.seats.filter((seat: any) => seat.controller === 'ai')).toHaveLength(2)
  expect(initial.settings.openAuthoring).toEqual(JSON.parse(files.authoring)); expect(initial.builds).toBe(0); expect(initial.runs).toBe(0)
  await page.evaluate(async () => { const load = new Function('p', 'return import(p)'); await (await load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts')).createMistHarborWorld() })
  await page.getByRole('navigation', { name: '跑团页面导航', exact: true }).getByRole('button', { name: '世界引擎', exact: true }).click()
  await page.getByRole('button', { name: '选择此版本', exact: true }).first().click()
  await page.getByRole('button', { name: '保存出口范围', exact: true }).click()
  const content = page.getByRole('navigation', { name: '跑团内容导航', exact: true })
  if (!await content.count()) await page.getByRole('navigation', { name: '跑团页面导航', exact: true }).getByRole('button', { name: '制作台', exact: true }).click()
  await content.getByRole('button', { name: '规则与村规', exact: true }).click()
  await page.getByLabel('开放跑团规则文件', { exact: true }).setInputFiles({ name: 'author-rule.json', mimeType: 'application/json', buffer: Buffer.from(files.rule) })
  await page.getByRole('button', { name: '确认并使用这份规则', exact: true }).click()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await content.getByRole('button', { name: '剧情结构', exact: true }).click()
  await expect(page.getByLabel('目标场景数', { exact: true })).toHaveValue('0'); await expect(page.getByLabel('目标结局数', { exact: true })).toHaveValue('0')
  await expect(page.getByLabel('目标结局数', { exact: true })).toHaveAttribute('min', '0')
  await expect(page.locator('fieldset.avg-form')).toBeEnabled()
  await content.getByRole('button', { name: '确认制作方案', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/confirm\?/)
  await page.getByTestId('ttrpg-production-wizard').getByRole('checkbox', { name: /^确认世界边界、数值映射、规则授权、AI 参与和媒资权利/ }).check()
  await page.getByRole('button', { name: '生成或更新审查方案', exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-brief-review')).toBeVisible({ timeout: 30000 })
  const proof = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const row = await db.ttrpgAuthoringDrafts.toCollection().first(), production = await db.productProductions.get(row.productionId)
    const saved = await db.productProductionBriefs.where('productionId').equals(production.id).first(), brief = (await load('/storyforge/src/lib/product-production/contracts.ts')).parseProductProductionBriefV3(saved.briefJson)
    return { row, production, brief, builds: await db.productBuilds.count(), runs: await db.agentRuns.count() }
  })
  expect(proof.brief.ttrpgOpen.settings.openAuthoring).toEqual(JSON.parse(files.authoring)); expect(proof.brief.ttrpg).toBeUndefined()
  expect(proof.brief.ttrpgOpen.sourcePlan.worldReference.referenceHash).toBe(proof.brief.ttrpgOpen.worldReference.referenceHash)
  expect(proof.builds).toBe(0); expect(proof.runs).toBe(0)
  await info.attach('normal-open-author-frozen-brief', { body: JSON.stringify(proof), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('normal-open-author-brief.png') })
  const originalJson = proof.row.settingsJson
  await page.getByRole('navigation', { name: '跑团页面导航', exact: true }).getByRole('button', { name: '作品库', exact: true }).click()
  await page.getByRole('button', { name: '新建战役', exact: true }).click(); await page.getByLabel('战役名称', { exact: true }).fill('保留闭合格式的作品')
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  const legacy = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts'); return db.ttrpgAuthoringDrafts.orderBy('id').last()
  })
  await page.goto(`./ttrpg/vision?project=${legacy.projectId}&work=${legacy.workId}&format=open`)
  await expect(page.getByLabel('战役名称', { exact: true })).toHaveValue('保留闭合格式的作品')
  await expect(page.getByTestId('ttrpg-open-authoring-editor')).toHaveCount(0)
  expect(await page.evaluate(async ({ id }) => { const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts'); return (await db.ttrpgAuthoringDrafts.get(id)).settingsJson }, { id: proof.row.id })).toBe(originalJson)
})
