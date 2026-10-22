import { test, expect, type Page } from '@playwright/test'

test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview'))

/** click() observes dispatch, not completion of the page's async save. Reload
 * only after the actual success receipt and persisted scoped rule selection. */
async function savedRuleBeforeReload(page: Page, id: string) {
  return test.step('observe committed author rule selection before reload', async () => {
    await expect(page.getByRole('status').filter({ hasText: /^制作配置已保存$/ })).toBeVisible()
    const saved = await page.evaluate(async () => {
      const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
      const draft = await db.ttrpgAuthoringDrafts.toCollection().first()
      const settings = (await load('/storyforge/src/lib/ttrpg/authoring-contract.ts')).settingsFromTtrpgDraft(draft)
      const rule = await db.ttrpgRulePacks.get(draft.savedRulePackId)
      return { draft, settings, rule }
    })
    expect(saved.draft.savedRulePackId).toBe(Number(id)); expect(saved.settings.wizard.savedRulePackId).toBe(Number(id))
    expect(saved.rule).toMatchObject({ id: Number(id), projectId: saved.draft.projectId, worldId: saved.draft.worldId, workId: saved.draft.workId })
    return saved
  })
}

test('a saved open rule remains selectable after a normal author reload', async ({ page }, info) => {
  await page.goto('./ttrpg/library')
  await page.getByRole('button', { name: '新建开放跑团（预览）', exact: true }).click()
  await page.getByLabel('战役名称', { exact: true }).fill('开放规则重载验证')
  // Deliberately hold the newly created Work's list projection. Navigation
  // must retain the saved URL identity even before the first row arrives.
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const original = db.works.toArray.bind(db.works)
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
    db.works.toArray = async () => { const rows = await original(); if (rows.some((row: any) => row.kind === 'ttrpg')) await gate; return rows }
    ;(globalThis as any).__releaseAuthorWorkList = () => { db.works.toArray = original; release() }
  })
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page).toHaveURL(/project=/)
  const savedIdentity = new URL(page.url()).searchParams
  await expect(page.getByRole('textbox', { name: '战役名称', exact: true })).toBeDisabled()
  // Even an unverified production locator must be retained, never treated as
  // ownership or substituted with a different/latest record during loading.
  await page.evaluate(() => {
    const url = new URL(location.href); url.searchParams.set('production', '424242')
    history.replaceState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  })
  const content = page.getByRole('navigation', { name: '跑团内容导航', exact: true })
  await content.getByRole('button', { name: '规则与村规', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/rules\?project=/)
  expect(new URL(page.url()).searchParams.get('project')).toBe(savedIdentity.get('project'))
  expect(new URL(page.url()).searchParams.get('work')).toBe(savedIdentity.get('work'))
  expect(new URL(page.url()).searchParams.get('production')).toBe('424242')
  await page.evaluate(() => { (globalThis as any).__releaseAuthorWorkList(); delete (globalThis as any).__releaseAuthorWorkList })
  await expect(page.getByRole('textbox', { name: '战役名称', exact: true })).toBeEnabled()
  const rule = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return JSON.stringify((await load('/storyforge/tests/helpers/ttrpg-open-content.ts')).openRuleFixture())
  })
  await page.getByLabel('开放跑团规则文件', { exact: true }).setInputFiles({ name: 'open-rule.json', mimeType: 'application/json', buffer: Buffer.from(rule) })
  await page.getByRole('button', { name: '确认并使用这份规则', exact: true }).click()
  const select = page.getByRole('combobox', { name: '规则包', exact: true })
  await expect(select).toHaveValue(/^[1-9]\d*$/)
  const id = await select.inputValue()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  const committed = await savedRuleBeforeReload(page, id)
  await info.attach('committed-open-rule-before-reload', { body: JSON.stringify(committed), contentType: 'application/json' })
  await page.reload()
  const persisted = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const row = await db.ttrpgAuthoringDrafts.toCollection().first()
    return { settings: JSON.parse(row.settingsJson), rules: await db.ttrpgRulePacks.toArray(), runs: await db.agentRuns.count() }
  })
  await info.attach('persisted-open-rule', { body: JSON.stringify(persisted), contentType: 'application/json' })
  expect(persisted.rules).toHaveLength(1)
  expect(persisted.runs).toBe(0)
  await expect(select.locator(`option[value="${id}"]`)).toHaveCount(1)
  await expect(select.locator(`option[value="${id}"]`)).toBeEnabled()
  await expect(select.locator(`option[value="${id}"]`)).toContainText('StoryForge 叙事 2d6')
  await expect(select).toHaveValue(id)
  await select.selectOption('')
  await select.selectOption(id)
  await expect(select).toHaveValue(id)
})

/** Built-in world + local author design are isolated engineering inputs. The
 * RulePack itself is prepared with actual product controls, not a test import. */
test('a blank author previews and explicitly saves first-party open rules, reloads and freezes the original Brief', async ({ page }, info) => {
  test.setTimeout(150000)
  await page.goto('./ttrpg/library')
  await page.getByRole('button', { name: '新建开放跑团（预览）', exact: true }).click()
  await page.getByLabel('战役名称', { exact: true }).fill('内置开放规则的作者流程')
  await page.getByLabel('开场与核心目标', { exact: true }).fill('暴雨来临前找回灯塔钥匙，决定如何保护港口。')
  await page.getByLabel('玩家身份', { exact: true }).fill('自愿合作的港口调查队')
  const editor = page.getByTestId('ttrpg-open-authoring-editor')
  const authorDesign = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), c = (await load('/storyforge/tests/helpers/ttrpg-open-content.ts')).openCampaignFixture()
    return JSON.stringify({ factPolicy: [], situationTemplates: c.situationTemplates, openingSituationKeys: c.openingSituationKeys,
      effectPlanTemplates: c.effectPlanTemplates, pressure: { clocks: c.clocks, fronts: c.fronts },
      companionPolicy: { ...c.companionPolicy, approvalBindings: c.companionPolicy.approvalBindings.map((binding: any) => ({ ...binding, approverSeatKeys: ['player.1'] })) },
      stageClosurePolicy: c.stageClosurePolicy, dynamicEntityTemplates: [], runtimePolicy: c.runtimePolicy })
  })
  await editor.locator('summary').filter({ hasText: '导入或修改完整开放设计' }).click()
  await editor.getByLabel('开放设计文件', { exact: true }).setInputFiles({ name: 'author-design.json', mimeType: 'application/json', buffer: Buffer.from(authorDesign) })
  await editor.getByRole('button', { name: '应用到开放设计草稿', exact: true }).click()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page).toHaveURL(/project=/)
  const content = page.getByRole('navigation', { name: '跑团内容导航', exact: true })
  await content.getByRole('button', { name: '规则与村规', exact: true }).click()
  const counts = () => page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { rules: await db.ttrpgRulePacks.count(), runs: await db.agentRuns.count(), builds: await db.productBuilds.count() }
  })
  expect(await counts()).toEqual({ rules: 0, runs: 0, builds: 0 })
  await page.getByRole('button', { name: '预览内置开放 2d6 规则', exact: true }).click()
  const candidate = page.getByTestId('ttrpg-open-rule-candidate')
  await expect(candidate).toContainText('StoryForge 开放叙事 2d6'); await expect(candidate).toContainText('3.0.0')
  await candidate.getByText('查看规则说明', { exact: true }).click()
  await expect(candidate).toContainText('不能创造新实体')
  expect(await counts()).toEqual({ rules: 0, runs: 0, builds: 0 })
  await candidate.getByRole('button', { name: '确认并使用这份规则', exact: true }).click()
  const select = page.getByRole('combobox', { name: '规则包', exact: true })
  await expect(select).toHaveValue(/^[1-9]\d*$/); const id = await select.inputValue()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  const committed = await savedRuleBeforeReload(page, id)
  await info.attach('committed-first-party-rule-before-reload', { body: JSON.stringify(committed), contentType: 'application/json' })
  await page.reload()
  await expect(select).toHaveValue(id); await expect(select.locator(`option[value="${id}"]`)).toBeEnabled()
  await expect(page.getByRole('combobox', { name: '基础规则', exact: true }).locator('option[value^="builtin-"]')).toHaveCount(0)
  // Repeating the explicit preparation cannot rewrite a validated identity.
  const original = await page.evaluate(async id => { const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/lib/db/schema.ts')).db.ttrpgRulePacks.get(Number(id)) }, id)
  await page.getByRole('button', { name: '预览内置开放 2d6 规则', exact: true }).click()
  await page.getByRole('button', { name: '确认并使用这份规则', exact: true }).click(); await expect(candidate).toHaveCount(0)
  expect(await counts()).toEqual({ rules: 1, runs: 0, builds: 0 })
  expect(await page.evaluate(async id => { const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/lib/db/schema.ts')).db.ttrpgRulePacks.get(Number(id)) }, id)).toEqual(original)
  await page.evaluate(async () => { const load = new Function('p', 'return import(p)'); await (await load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts')).createMistHarborWorld() })
  const nav = page.getByRole('navigation', { name: '跑团页面导航', exact: true })
  await nav.getByRole('button', { name: '世界引擎', exact: true }).click()
  await page.getByRole('button', { name: '选择此版本', exact: true }).first().click()
  await page.getByRole('button', { name: '保存出口范围', exact: true }).click()
  if (!await content.count()) await nav.getByRole('button', { name: '制作台', exact: true }).click()
  await content.getByRole('button', { name: '确认制作方案', exact: true }).click()
  await page.getByTestId('ttrpg-production-wizard').getByRole('checkbox', { name: /^确认世界边界、数值映射、规则授权、AI 参与和媒资权利/ }).check()
  await page.getByRole('button', { name: '生成或更新审查方案', exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-brief-review')).toBeVisible({ timeout: 30000 })
  const proof = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const draft = await db.ttrpgAuthoringDrafts.toCollection().first(), row = await db.productProductionBriefs.where('productionId').equals(draft.productionId).first()
    const brief = (await load('/storyforge/src/lib/product-production/contracts.ts')).parseProductProductionBriefV3(row.briefJson)
    return { brief, rules: await db.ttrpgRulePacks.toArray(), runs: await db.agentRuns.count(), builds: await db.productBuilds.count() }
  })
  expect(proof.brief.ttrpgOpen.rulePack.ruleSystemVersion).toBe('3.0.0')
  expect(proof.brief.ttrpgOpen.rulePack.genericChecks).toHaveLength(3)
  expect(proof.brief.ttrpgOpen.sourcePlan.worldReference.referenceHash).toBe(proof.brief.ttrpgOpen.worldReference.referenceHash)
  expect(proof.rules).toEqual([original]); expect(proof.runs).toBe(0); expect(proof.builds).toBe(0)
  await info.attach('first-party-open-brief', { body: JSON.stringify(proof), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('first-party-open-brief.png') })
})
