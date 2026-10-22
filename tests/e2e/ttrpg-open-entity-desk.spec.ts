import { expect, test, type Page } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
async function enter(page: Page, sessionId: number, viewer = 'viewer.seat.hero') {
  await page.goto('./play/session/' + sessionId)
  await page.getByLabel('我的角色', { exact: true }).selectOption(viewer)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  const panel = page.getByTestId('ttrpg-open-entity-desk')
  await expect(panel).toBeVisible({ timeout: 30000 })
  if (!await panel.evaluate(e => (e as HTMLDetailsElement).open)) await panel.locator('summary').first().click()
  return panel
}
test('actual human UI consults, saves, reviews and creates one frozen NPC, then reloads without another consultation or model send', async ({ page }) => {
  test.setTimeout(180000)
  let sends = 0
  page.on('request', r => { if (r.url().includes('/chat/completions')) sends++ })
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const h = await load('/storyforge/tests/helpers/open-entity-runtime.ts'), desk = await load('/storyforge/src/lib/ttrpg/open-entity-desk.ts')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const s = await h.setupOpenEntityPlanningV1((pkg: any) => { pkg.ttrpg.campaign.characterTemplates.find((c: any) => c.characterKey === 'keeper').gmProfile.secret = 'ENTITY-NATIVE-GM-PRIVATE' })
    const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.seat.hero' }
    await desk.closeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'native.initial.close' })
    return { ...input, oracleKey: s.input.content.rulePack.content.oracles[0].oracleKey, tier: s.input.content.rulePack.content.oracles[0].likelihood?.tiers[0].tierKey,
      world: await db.worldReleases.toArray(), releases: await db.productReleases.toArray(), entities: Object.keys(s.input.state.entities) }
  })
  let card = await enter(page, fixture.sessionId)
  await card.getByRole('button', { name: '开始本次实体咨询', exact: true }).click()
  await expect(card.getByLabel('实体咨询表', { exact: true })).toBeEnabled({ timeout: 30000 })
  await card.getByLabel('实体咨询表', { exact: true }).selectOption(fixture.oracleKey)
  if (fixture.tier) await card.getByLabel('本次可能性', { exact: true }).selectOption(fixture.tier)
  await card.getByLabel('实体咨询问题', { exact: true }).fill('码头是否出现一位新的守灯人？')
  await card.getByRole('button', { name: '明确咨询一次', exact: true }).click()
  await expect(card.getByLabel('本次创建依据', { exact: true })).toBeEnabled({ timeout: 30000 })
  const basis = card.getByLabel('本次创建依据', { exact: true })
  await basis.selectOption({ index: 1 })
  await card.getByLabel('新对象模板', { exact: true }).selectOption('dynamic.npc')
  await card.getByLabel('新对象名称', { exact: true }).fill('本局新守灯人')
  await card.getByLabel('新对象说明', { exact: true }).fill('真人依本次咨询提出的 NPC')
  await card.getByLabel('模板参数 1', { exact: true }).selectOption('quiet')
  await card.getByLabel('初始位置或持有人', { exact: true }).selectOption('harbor')
  await card.getByRole('button', { name: '加入待确认清单', exact: true }).click()
  await card.getByRole('button', { name: '保存待确认提案', exact: true }).click()
  const create = card.getByRole('button', { name: '明确创建已确认对象', exact: true })
  await expect(create).toBeDisabled({ timeout: 30000 })
  const before = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const s = await core.readProductRuntimeState(id), plan = s.ttrpg.openRun.entityOperations[0].plan
    return { exists: Boolean(s.entities[plan.items[0].entityKey]), planHash: plan.planHash }
  }, fixture.sessionId)
  expect(before.exists).toBe(false)
  await expect(page.locator('body')).not.toContainText('ENTITY-NATIVE-GM-PRIVATE')
  await card.getByLabel('我已审阅本版本对相关角色的影响。', { exact: true }).check()
  await card.getByRole('button', { name: /同意为「.*」创建本次对象/, exact: true }).click()
  await expect(create).toBeEnabled({ timeout: 30000 })
  await create.click()
  await expect(card.getByRole('region', { name: '已创建的本局对象' })).toContainText('本局新守灯人', { timeout: 30000 })
  await card.getByRole('button', { name: '结束本次实体咨询', exact: true }).click()
  await page.reload(); card = await enter(page, fixture.sessionId)
  await expect(card.getByRole('region', { name: '已创建的本局对象' })).toContainText('本局新守灯人')
  const after = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const s = await core.readProductRuntimeState(id), run = s.ttrpg.openRun
    return { entities: Object.keys(s.entities), oracleCount: run.oracleReceipts.length, resolutions: run.entityOperations.map((o: any) => o.resolution.kind),
      world: await db.worldReleases.toArray(), releases: await db.productReleases.toArray(), runs: await db.agentRuns.count(), worldTurn: run.worldTime.worldTurn }
  }, fixture.sessionId)
  expect(after.oracleCount).toBe(2); expect(after.resolutions).toEqual(['materialized']); expect(after.entities.length).toBe(fixture.entities.length + 1)
  expect(after.world).toEqual(fixture.world); expect(after.releases).toEqual(fixture.releases); expect(after.worldTurn).toBe(0); expect(after.runs).toBe(0); expect(sends).toBe(0)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('entity-desk-mobile-v1.png'), fullPage: true })
})
test('another human sees only their inventory effect, can refuse it, and explicitly disposes while paused without creating any object', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, h = await load('/storyforge/tests/helpers/open-entity-runtime.ts'), desk = await load('/storyforge/src/lib/ttrpg/open-entity-desk.ts')
    const s = await h.setupOpenEntityPlanningV1((pkg: any) => { pkg.ttrpg.campaign.characterTemplates.find((c: any) => c.characterKey === 'companion.1').controller = 'hybrid' })
    s.proposals[0].name = 'HOST-ONLY-NPC'; s.proposals[0].description = 'ENTITY-PRIVATE-OTHER-PROPOSAL'
    await desk.proposeTtrpgOpenEntityDeskV1({ scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.seat.hero', submissionKey: 'native.other.propose', oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals })
    return { sessionId: s.f.sessionId, entities: Object.keys(s.input.state.entities) }
  })
  let card = await enter(page, fixture.sessionId, 'viewer.seat.companion.1')
  await expect(card.getByRole('region', { name: '待确认实体计划' })).toContainText('与我有关的库存变化')
  await expect(page.locator('body')).not.toContainText('HOST-ONLY-NPC'); await expect(page.locator('body')).not.toContainText('ENTITY-PRIVATE-OTHER-PROPOSAL')
  await expect(card.getByText('冻结物品定义：', { exact: false })).toBeVisible()
  await card.getByLabel('我已审阅本版本对相关角色的影响。', { exact: true }).check()
  await card.getByRole('button', { name: /拒绝为「.*」创建本次对象/, exact: true }).click()
  await expect(card.getByLabel('放弃实体计划原因', { exact: true })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: '暂停冒险', exact: true }).click()
  await expect(page.getByRole('button', { name: '恢复冒险', exact: true })).toBeVisible({ timeout: 30000 })
  await card.getByLabel('放弃实体计划原因', { exact: true }).fill('本人不同意新增库存，明确放弃本计划')
  await card.getByRole('button', { name: '放弃本次实体计划', exact: true }).click()
  await expect(card.getByRole('region', { name: '待确认实体计划' })).toHaveCount(0, { timeout: 30000 })
  await page.reload(); card = await enter(page, fixture.sessionId, 'viewer.seat.hero')
  await expect(card.getByRole('region', { name: '待确认实体计划' })).toHaveCount(0)
  const state = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const state = await core.readProductRuntimeState(id)
    return { entities: Object.keys(state.entities), resolution: state.ttrpg.openRun.entityOperations[0].resolution.kind }
  }, fixture.sessionId)
  expect(state.entities).toEqual(fixture.entities); expect(state.resolution).toBe('declined')
})
test('native IndexedDB F13 keeps committed identities through a branch, parent deletion, reload and full backup import', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('./')
  const original = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, h = await load('/storyforge/tests/helpers/open-entity-runtime.ts'), desk = await load('/storyforge/src/lib/ttrpg/open-entity-desk.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const s = await h.setupOpenEntityPlanningV1(), input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.seat.hero' }
    await desk.proposeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'native.branch.propose', oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals })
    const p = (await desk.readTtrpgOpenEntityDeskV1(input)).pending
    for (const a of p.approvals) await desk.confirmTtrpgOpenEntityDeskV1({ ...input, operationKey: p.operationKey, planHash: p.planHash, actorKey: a.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
    await desk.materializeTtrpgOpenEntityDeskV1({ ...input, operationKey: p.operationKey, planHash: p.planHash, decision: 'create-this-confirmed-plan' })
    const child = await core.branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: (await core.readProductRuntimeState(s.f.sessionId)).lastSequence, title: 'Native F13 child' })
    await core.deleteProductRuntimeSession(s.f.sessionId)
    const state = await core.readProductRuntimeState(child.id)
    return { sessionId: child.id, projectId: s.f.scope.projectId, entities: state.entities, operations: state.ttrpg.openRun.entityOperations }
  })
  await page.reload()
  const restored = await page.evaluate(async original => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const backup = await load('/storyforge/src/lib/export/json-export.ts'), core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const afterReload = await core.readProductRuntimeState(original.sessionId)
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(original.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: any) => s.title === 'Native F13 child')
    const imported = await core.readProductRuntimeState(session.id)
    return { afterReload: { entities: afterReload.entities, operations: afterReload.ttrpg.openRun.entityOperations },
      imported: { entities: imported.entities, operations: imported.ttrpg.openRun.entityOperations }, runs: await db.agentRuns.count() }
  }, original)
  expect(restored.afterReload).toEqual({ entities: original.entities, operations: original.operations })
  expect(restored.imported).toEqual(restored.afterReload); expect(restored.runs).toBe(0)
})
test('actual human GM desk creates its private NPC while the player desk retains no private proposal or instance', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('./')
  const sessionId = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, h = await load('/storyforge/tests/helpers/open-entity-runtime.ts'), desk = await load('/storyforge/src/lib/ttrpg/open-entity-desk.ts')
    const s = await h.setupOpenEntityPlanningV1((pkg: any) => {
      pkg.ttrpg.campaign.gmMode = 'human'; pkg.ttrpg.rulePack.content.oracles[0].audience = 'gm-only'; pkg.ttrpg.campaign.dynamicEntityTemplates[0].audience = 'gm-only'
    }, 'viewer.gm')
    s.proposals[0].name = 'SECRET-GM-ONLY-NPC'
    await desk.proposeTtrpgOpenEntityDeskV1({ scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm', submissionKey: 'native.gm.private', oracleSourceRef: s.input.oracleSourceRef, proposals: [s.proposals[0]] })
    return s.f.sessionId
  })
  await page.goto('./play/session/' + sessionId)
  await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
  await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  const panel = page.getByTestId('ttrpg-open-entity-desk')
  await expect(panel).toBeVisible({ timeout: 30000 }); await panel.locator('summary').first().click()
  await expect(panel).toContainText('SECRET-GM-ONLY-NPC')
  await panel.getByLabel('我已审阅本版本对相关角色的影响。', { exact: true }).check()
  await panel.getByRole('button', { name: '同意为「主持」创建本次对象', exact: true }).click()
  await expect(panel.getByRole('button', { name: '明确创建已确认对象', exact: true })).toBeEnabled({ timeout: 30000 })
  await panel.getByRole('button', { name: '明确创建已确认对象', exact: true }).click()
  await expect(panel.getByRole('region', { name: '已创建的本局对象' })).toContainText('SECRET-GM-ONLY-NPC', { timeout: 30000 })
  await page.getByRole('button', { name: '返回身份选择', exact: true }).click()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-player-table')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('SECRET-GM-ONLY-NPC')
})
