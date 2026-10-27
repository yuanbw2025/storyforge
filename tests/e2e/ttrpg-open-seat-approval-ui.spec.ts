import { test, expect, type Page } from '@playwright/test'

test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
async function seed(page: Page, existing = false) {
  return page.evaluate(async existing => {
    const load = new Function('p', 'return import(p)')
    const f = await (await load('/storyforge/tests/helpers/open-ttrpg-fresh-authoring.ts')).createFreshOpenDraftFixtureV1(2, true)
    const api = await load('/storyforge/src/lib/ttrpg/authoring-service.ts')
    if (!existing) f.settings.openAuthoring.companionPolicy.approvalBindings = []
    const draft = await api.saveTtrpgDraft(f.scope, f.draft.revision, f.settings, existing ? '保留旧角色的作品' : '正常批准配置作品')
    return { scope: f.scope, revision: draft.revision, settingsJson: draft.settingsJson, settings: f.settings }
  }, existing)
}
const editor = (page: Page) => page.getByTestId('ttrpg-seat-approvals')
const navigation = (page: Page) => page.getByRole('navigation', { name: '跑团内容导航', exact: true })
async function openSeats(page: Page) {
  await navigation(page).getByRole('button', { name: '主持与席位', exact: true }).click()
  await expect(editor(page)).toBeVisible()
}
async function selectNew(page: Page) {
  await editor(page).getByRole('button', { name: '核对角色与批准席位', exact: true }).click()
  await editor(page).getByRole('checkbox', { name: 'companion.1 由 hero 批准', exact: true }).check()
  await editor(page).getByRole('checkbox', { name: 'companion.2 由 hero 批准', exact: true }).check()
  return page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return structuredClone((await load('/storyforge/src/components/ttrpg/open-seat-approval-draft.ts')).readSeatApprovalDraft())
  })
}
async function read(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { drafts: await db.ttrpgAuthoringDrafts.toArray(), worlds: await db.worldReleases.toArray(),
      runs: await db.agentRuns.count(), productions: await db.productProductions.count(), builds: await db.productBuilds.count() }
  })
}

test('fresh UUIDs from normal human approval controls survive save/reload and actual governed System/compile production', async ({ page }, info) => {
  test.setTimeout(150000)
  await page.goto('./ttrpg/library'); const f = await seed(page)
  await page.locator('article').filter({ hasText: '正常批准配置作品' }).getByRole('link', { name: '继续制作', exact: true }).click()
  await openSeats(page); const before = await read(page), pending = await selectNew(page)
  expect(pending.proposal.plan.seats.every((seat: any) => seat.characterKey.startsWith('actor.reserved.'))).toBe(true)
  expect(pending.proposal.policy.approvalBindings.every((binding: any) => !binding.partyResourceApprovalAllowed)).toBe(true)
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('批准配置尚未应用')
  expect(await read(page)).toEqual(before)
  await editor(page).getByRole('button', { name: '应用批准配置到表单', exact: true }).click()
  expect(await read(page)).toEqual(before)
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '制作配置已保存' })).toBeVisible()
  await expect(page.getByTestId('ttrpg-seat-approval-recovery')).toHaveCount(0)
  const saved = await read(page), value = JSON.parse(saved.drafts[0].settingsJson)
  expect(value.authoringSeatPlan).toEqual(pending.proposal.plan)
  expect(value.openAuthoring.companionPolicy).toEqual(pending.proposal.policy)
  expect(saved.runs).toBe(0); expect(saved.productions).toBe(0); expect(saved.worlds).toEqual(before.worlds)
  await page.reload(); await expect(editor(page)).toContainText('已有角色预留')
  expect((await read(page)).drafts[0].settingsJson).toBe(saved.drafts[0].settingsJson)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await editor(page).screenshot({ path: info.outputPath('normal-fresh-seat-approval.png') })
  await page.setViewportSize({ width: 1280, height: 720 })

  // This fixture design already referred to its old hero ID. The author updates
  // that reference through the original design editor before freezing a Brief.
  const human = pending.proposal.plan.seats.find((seat: any) => seat.controller === 'human')
  const design = structuredClone(value.openAuthoring)
  design.effectPlanTemplates[0].parameters[0].allowedRefs = [human.characterKey]
  await navigation(page).getByRole('button', { name: '战役愿景', exact: true }).click()
  const designEditor = page.getByTestId('ttrpg-open-authoring-editor')
  await designEditor.locator('summary').filter({ hasText: '导入或修改完整开放设计' }).click()
  await designEditor.getByLabel('开放设计文件', { exact: true }).setInputFiles({ name: 'explicit-new-hero-reference.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(design)) })
  await designEditor.getByRole('button', { name: '应用到开放设计草稿', exact: true }).click()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '制作配置已保存' })).toBeVisible()
  await navigation(page).getByRole('button', { name: '确认制作方案', exact: true }).click()
  await page.getByRole('button', { name: '生成或更新审查方案', exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-brief-review')).toBeVisible({ timeout: 30000 })
  const proof = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const draft = await (await load('/storyforge/src/lib/ttrpg/authoring-service.ts')).readTtrpgDraft(scope)
    const production = await db.productProductions.get(draft.productionId)
    const row = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id, production.currentBriefRevision]).first()
    const frozenBefore = row.briefJson
    const command = await (await load('/storyforge/src/lib/product-production/commands.ts')).executeProductProductionCommand({ scope, productionId: production.id,
      command: { type: 'authorize-start', commandId: 'normal.fresh.approvals.start', expectedStateRevision: production.stateRevision,
        briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'explicit.engineering.author.start' } })
    if (!command.ok) throw Error(JSON.stringify(command))
    const api = await load('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
    const input = { scope, productionId: production.id, reservedSeatPlan: true }
    const stages = [await api.runOpenBrowserProductionV1(input), await api.runOpenBrowserProductionV1(input, true), await api.runOpenBrowserProductionV1(input, true)]
    const current = await db.productProductions.get(production.id)
    const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, current.currentBuildNumber]).first()
    const resolved = await (await load('/storyforge/src/lib/product-production/preview-source.ts')).resolveProductRuntimeSource({ scope,
      source: { kind: 'build', productBuildId: build.id, expectedPreviewHash: build.previewHash }, ttrpgProtocol: 2 })
    const campaign = resolved.runtimePackage.ttrpg.campaign
    resolved.mediaResolver.dispose()
    const after = await db.productProductionBriefs.get(row.id)
    return { stages, campaign, plan: JSON.parse(build.planJson), frozenUnchanged: after.briefJson === frozenBefore, draft, buildHash: build.previewHash,
      receiptHash: build.rootTerminalReceiptHash, worlds: await db.worldReleases.toArray() }
  }, f.scope)
  expect(proof.stages.slice(0, 2).map((stage: any) => stage.status)).toEqual(['recovery-required', 'recovery-required'])
  expect(proof.stages[2].terminal).toBe(true); expect(proof.stages[2].status).toMatch(/^(preview|release)-ready$/)
  expect(proof.stages[2].modelCalls).toBe(3); expect(proof.frozenUnchanged).toBe(true)
  expect(proof.plan.tasks.find((task: any) => task.taskKey === 'ttrpg.open.media-plan'))
    .toMatchObject({ executionMode: 'deterministic', skillId: null, budgetReservation: { modelCalls: 0 } })
  const actors = proof.campaign.characterTemplates.filter((actor: any) => actor.role === 'player')
  for (const seat of pending.proposal.plan.seats) expect(actors).toContainEqual(expect.objectContaining(seat))
  expect(proof.campaign.companionPolicy).toEqual(pending.proposal.policy)
  expect(proof.campaign.effectPlanTemplates[0].parameters[0].allowedRefs).toEqual([human.characterKey])
  for (const seat of pending.proposal.plan.seats) expect(proof.campaign.entityBindings).toContainEqual(expect.objectContaining({ bindingKey: seat.characterKey, templateKey: seat.characterKey }))
  expect(proof.receiptHash).toMatch(/^[a-f0-9]{64}$/); expect(proof.worlds).toEqual(before.worlds)
  await info.attach('normal-UUID-controls-and-simulated-model-production', { body: JSON.stringify({ pending, saved, proof }), contentType: 'application/json' })
})

for (const applied of [false, true]) test(`browser Back preserves the original pending choices across another Work and full SPA unmount (applied=${applied})`, async ({ page }, info) => {
  test.setTimeout(90000)
  await page.goto('./ttrpg/library'); const f = await seed(page); await seed(page, true)
  // Establish a real cross-product history entry before any pending edit.
  await page.getByRole('navigation', { name: '产品导航', exact: true }).getByRole('link').filter({ hasText: '短篇' }).click()
  await page.getByRole('navigation', { name: '产品导航', exact: true }).getByRole('link').filter({ hasText: '跑团' }).click()
  await page.locator('article').filter({ hasText: '正常批准配置作品' }).getByRole('link', { name: '继续制作', exact: true }).click()
  await openSeats(page); const before = await read(page), pending = await selectNew(page)
  if (applied) await editor(page).getByRole('button', { name: '应用批准配置到表单', exact: true }).click()
  await page.goBack(); await page.goBack()
  await expect(page).toHaveURL(/\/ttrpg\/?$/)
  await page.locator('article').filter({ hasText: '保留旧角色的作品' }).getByRole('link', { name: '继续制作', exact: true }).click()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('批准配置尚未应用或已离开原作品')
  expect(await read(page)).toEqual(before)
  await page.goBack(); await page.goBack()
  await expect(page).toHaveURL(/\/short/)
  const retained = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const api = await load('/storyforge/src/components/ttrpg/open-seat-approval-draft.ts')
    let rejected = false
    try { await (await load('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')).flushPendingEditsV1() } catch { rejected = true }
    return { pending: api.readSeatApprovalDraft(), rejected }
  })
  expect(retained.pending.proposal).toEqual(pending.proposal); expect(retained.rejected).toBe(true)
  await page.goForward()
  await page.getByRole('button', { name: '恢复核对批准配置', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`work=${f.scope.workId}`))
  await expect(editor(page).getByRole('checkbox', { name: 'companion.1 由 hero 批准', exact: true })).toBeChecked()
  await expect(editor(page).getByRole('button', { name: '应用批准配置到表单', exact: true })).toBeEnabled()
  await editor(page).getByRole('button', { name: '应用批准配置到表单', exact: true }).click()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByTestId('ttrpg-seat-approval-recovery')).toHaveCount(0)
  const after = await read(page)
  const actual = after.drafts.find((draft: any) => draft.workId === f.scope.workId)
  expect(JSON.parse(actual.settingsJson).authoringSeatPlan).toEqual(pending.proposal.plan)
  expect(after.drafts.find((draft: any) => draft.workId !== f.scope.workId)).toEqual(before.drafts.find((draft: any) => draft.workId !== f.scope.workId))
  expect(after.worlds).toEqual(before.worlds); expect(after.runs).toBe(0); expect(after.builds).toBe(0)
  await info.attach('native-SPA-and-owner-preservation', { body: JSON.stringify({ applied, pending, retained, before, after }), contentType: 'application/json' })
})

test('old opaque identities remain untouched until the author explicitly maps all seats', async ({ page }, info) => {
  await page.goto('./ttrpg/library'); await seed(page, true)
  await page.locator('article').filter({ hasText: '保留旧角色的作品' }).getByRole('link', { name: '继续制作', exact: true }).click()
  await openSeats(page); const before = await read(page)
  await editor(page).getByRole('button', { name: '核对角色与批准席位', exact: true }).click()
  await expect(editor(page)).toContainText('不会按姓名或顺序自动分配')
  for (const label of ['hero', 'companion.1', 'companion.2']) await expect(editor(page).getByLabel(`${label} 原角色标识`, { exact: true })).toHaveValue('')
  expect(await read(page)).toEqual(before)
  for (const label of ['hero', 'companion.1', 'companion.2']) await editor(page).getByLabel(`${label} 原角色标识`, { exact: true }).fill(label)
  await expect(editor(page).getByRole('checkbox', { name: 'companion.1 由 hero 批准', exact: true })).toBeChecked()
  await editor(page).getByRole('button', { name: '应用批准配置到表单', exact: true }).click()
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page.getByTestId('ttrpg-seat-approval-recovery')).toHaveCount(0)
  const after = await read(page), old = JSON.parse(before.drafts[0].settingsJson), saved = JSON.parse(after.drafts[0].settingsJson)
  expect(saved.openAuthoring).toEqual(old.openAuthoring); expect(saved.wizard).toEqual(old.wizard)
  expect(saved.authoringSeatPlan.seats.map((seat: any) => seat.characterKey)).toEqual(['hero', 'companion.1', 'companion.2'])
  expect(after.worlds).toEqual(before.worlds); expect(after.runs).toBe(0)
  await info.attach('explicit-old-identity-mapping', { body: JSON.stringify({ before, after }), contentType: 'application/json' })
})
