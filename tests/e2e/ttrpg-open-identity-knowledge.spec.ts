import { expect, test, type Page } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
async function seed(page: Page) {
  await page.goto('./')
  return page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const s = await (await load('/storyforge/tests/helpers/open-identity-knowledge-runtime.ts')).setupIdentityKnowledgeRuntimeV1()
    return { owner: s.owner, rootKey: s.root.knowledgeKey, entityRef: s.entityRef }
  })
}
async function enter(page: Page, id: number, viewerKey = 'viewer.gm') {
  await page.goto('./play/session/' + id)
  if (viewerKey === 'viewer.gm') {
    await page.getByLabel('我的主持席位', { exact: true }).selectOption(viewerKey)
    await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
    await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  } else {
    await page.getByLabel('我的角色', { exact: true }).selectOption(viewerKey)
    await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  }
  const card = page.getByTestId('ttrpg-open-identity-knowledge-panel'); await expect(card).toBeVisible({ timeout: 30000 }); return card
}
async function inspect(page: Page, id: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)
    return { count: state.ttrpg.openRun.knowledge.length, grants: state.ttrpg.openRun.knowledge.filter((r: any) => r.identityGrant).map((r: any) => ({ knowledgeKey: r.knowledgeKey, mode: r.identityGrant.mode, reliability: r.reliability })),
      root: JSON.stringify(state.ttrpg.openRun.knowledge[0]), entities: JSON.stringify(state.entities), time: JSON.stringify(state.ttrpg.openRun.worldTime), calls: state.ttrpg.openRun.coordination.calls.length,
      events: (await db.productRuntimeEvents.where('sessionId').equals(id).toArray()).filter((r: any) => r.type === 'ttrpg.open.knowledge.identity-confirmed').length }
  }, id)
}
test('native identity observation requires exact review, retries actual storage, reloads and stays hidden from another actor', async ({ page }) => {
  test.setTimeout(240000); let sends = 0; page.on('request', request => { if (request.url().includes('/chat/completions')) sends++ })
  const s = await seed(page), before = await inspect(page, s.owner.sessionId), card = await enter(page, s.owner.sessionId)
  await card.getByLabel('原知识', { exact: true }).selectOption(s.rootKey)
  await card.getByRole('checkbox', { name: '新守灯人', exact: true }).check(); await card.getByRole('checkbox', { name: 'hero', exact: true }).check()
  await card.getByRole('button', { name: '核对这次内容与接收者', exact: true }).click()
  const review = card.getByTestId('ttrpg-open-identity-knowledge-review'); await expect(review).toBeVisible()
  expect((await inspect(page, s.owner.sessionId)).count).toBe(1)
  await expect(review.getByRole('button', { name: '明确保存这次知识', exact: true })).toBeDisabled()
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    db.productRuntimeEvents.add = async (row: any, ...args: any[]) => { if (row.type === 'ttrpg.open.knowledge.identity-confirmed') { db.productRuntimeEvents.add = add; throw new Error('NATIVE-IDENTITY-STORAGE-CUT') } return add(row, ...args) }
  })
  await review.getByRole('checkbox').check(); await review.getByRole('button', { name: '明确保存这次知识', exact: true }).click()
  await expect(card.getByRole('alert')).toBeVisible(); expect((await inspect(page, s.owner.sessionId)).count).toBe(1)
  await review.getByRole('button', { name: '明确保存这次知识', exact: true }).click(); await expect(review).toHaveCount(0)
  const after = await inspect(page, s.owner.sessionId)
  expect(after).toMatchObject({ count: 2, events: 1, root: before.root, entities: before.entities, time: before.time, calls: before.calls })
  const hero = await enter(page, s.owner.sessionId, 'viewer.seat.hero'); await expect(hero).toContainText('新守灯人')
  const outsider = await enter(page, s.owner.sessionId, 'viewer.seat.companion.2'); await expect(outsider).not.toContainText('新守灯人')
  expect(sends).toBe(0)
})
test('native explicit identity share remains hearsay after parent deletion and full backup on a narrow viewport', async ({ page }, info) => {
  test.setTimeout(240000)
  const s = await seed(page)
  const rootGrant = await page.evaluate(async s => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, service = await load('/storyforge/src/lib/ttrpg/open-identity-knowledge-service.ts')
    const review = await service.prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, submissionKey: 'native.original.identity', request: { mode: 'observation', actorKey: null,
      sourceKnowledgeKey: s.rootKey, entityRefs: [s.entityRef], audience: 'private', recipientActorKeys: ['hero'] } })
    const result = await service.confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...s.owner, review, decision: 'confirm-these-identities-and-recipients' })
    await (await load('/storyforge/tests/helpers/open-identity-knowledge-runtime.ts')).identityKnowledgeWindowV1(s.owner.sessionId, 'viewer.seat.hero')
    return result
  }, s)
  const card = await enter(page, s.owner.sessionId, 'viewer.seat.hero')
  await card.getByLabel('身份知识操作', { exact: true }).selectOption('share')
  await card.getByLabel('原知识', { exact: true }).selectOption(`${rootGrant.knowledgeKey}:hero`)
  await card.getByRole('checkbox', { name: '新守灯人', exact: true }).check(); await card.getByRole('checkbox', { name: 'companion.2', exact: true }).check()
  await card.getByRole('button', { name: '核对这次内容与接收者', exact: true }).click()
  const review = card.getByTestId('ttrpg-open-identity-knowledge-review'); await expect(review).toContainText('按转述保存')
  await review.getByRole('checkbox').check(); await review.getByRole('button', { name: '明确保存这次知识', exact: true }).click(); await expect(review).toHaveCount(0)
  expect((await inspect(page, s.owner.sessionId)).grants.map(row => row.reliability)).toEqual(['observed', 'hearsay'])
  const imported = await page.evaluate(async owner => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts'), commands = await load('/storyforge/src/lib/ttrpg/runtime-commands.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const child = await core.branchProductRuntimeSession({ parentSessionId: owner.sessionId, throughSequence: (await core.readProductRuntimeState(owner.sessionId)).lastSequence, title: 'identity native child' })
    const state = await core.readProductRuntimeState(child.id), version = await core.readProductRuntimeStateVersion(child.id)
    await commands.completeTtrpgOpenSessionZeroV1({ sessionId: child.id, ...{ baseSequence: version.sequence, baseStateHash: version.stateHash }, commandId: 'native.identity.child.zero', viewerKey: 'viewer.gm',
      acceptedItemKeys: state.ttrpg.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await core.deleteProductRuntimeSession(owner.sessionId)
    const backup = await load('/storyforge/src/lib/export/json-export.ts'), projectId = await backup.importProjectJSON(await backup.exportProjectJSON(owner.scope.projectId))
    return (await db.productRuntimeSessions.where('projectId').equals(projectId).first()).id
  }, s.owner)
  await page.setViewportSize({ width: 390, height: 844 }); const child = await enter(page, imported, 'viewer.seat.companion.2')
  await expect(child).toContainText('新守灯人 · 转述'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await child.screenshot({ path: info.outputPath('identity-child-mobile.png') })
})
test('native existing player UI sends registered reported identity once and retains the candidate through reload', async ({ page }) => {
  test.setTimeout(240000); await page.goto('./')
  const s = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, helper = await load('/storyforge/tests/helpers/open-identity-knowledge-runtime.ts')
    const s = await helper.setupIdentityKnowledgeRuntimeV1(false, true, 'party'), service = await load('/storyforge/src/lib/ttrpg/open-identity-knowledge-service.ts')
    const observation = await service.prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, submissionKey: 'native.model.observer', request: { ...s.request, recipientActorKeys: ['companion.2'] } })
    const recognized = await service.confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...s.owner, review: observation, decision: 'confirm-these-identities-and-recipients' })
    await helper.identityKnowledgeWindowV1(s.owner.sessionId, 'viewer.seat.companion.2')
    const speaker = { ...s.owner, viewerKey: 'viewer.seat.companion.2' }, review = await service.prepareTtrpgOpenIdentityKnowledgeV1({ ...speaker, submissionKey: 'native.model.report', request: {
      ...s.request, mode: 'share', actorKey: 'companion.2', sourceKnowledgeKey: recognized.knowledgeKey, recipientActorKeys: ['hero'] } })
    await service.confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...speaker, review, decision: 'confirm-these-identities-and-recipients' })
    const core = await load('/storyforge/src/lib/product/runtime-core.ts'), commands = await load('/storyforge/src/lib/ttrpg/runtime-commands.ts'), sessionHelper = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const before = await core.readProductRuntimeState(s.owner.sessionId), epoch = before.ttrpg.openRun.coordination.epochs.find((row: any) => row.epochKey === before.ttrpg.openRun.coordination.activeEpochKey)
    await commands.closeTtrpgOpenEpochV1({ ...await sessionHelper.openEnvelopeV1(s.owner.sessionId, 'native.model.close-report'), viewerKey: speaker.viewerKey, epochKey: epoch.epochKey, reason: '报告保存，交还真人' })
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'learned-identity-native', apiKey: '', baseUrl: location.origin + '/learned-identity-native/v1', maxTokens: 1000, contextWindow: 64000 })
    return { owner: s.owner, entityRef: s.entityRef }
  })
  let sends = 0, delivered = ''
  await page.route('**/learned-identity-native/v1/chat/completions', async route => {
    sends++; const wire = route.request().postDataJSON(); delivered = wire.messages.map((row: any) => row.content).join('\n')
    expect(delivered).toContain('storyforge.ttrpg-open-learned-identity'); expect(delivered).toContain('新守灯人')
    expect(delivered).toMatch(/"reliability"\s*:\s*"hearsay"/); expect(delivered).not.toMatch(/gmProfile|害怕洪水/)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ goal: '先澄清这份转述', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: ['只有转述，没有确认本人见到该人物'], requestedOutcome: null }) } }], usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 } }) })
  })
  const before = await inspect(page, s.owner.sessionId), card = await enter(page, s.owner.sessionId, 'viewer.seat.hero')
  await expect(card).toContainText('新守灯人 · 转述')
  await page.getByLabel('行动意图', { exact: true }).fill('请根据刚收到的转述，提出谨慎的下一步。')
  await page.getByLabel('本次模型调用预算预留', { exact: true }).fill('0.1')
  await page.getByRole('button', { name: '请 KP 整理行动意图', exact: true }).click()
  await expect(page.getByRole('heading', { name: '待确认的行动意图', exact: true })).toBeVisible({ timeout: 60000 })
  expect(sends).toBe(1); expect(delivered).toContain(s.entityRef)
  const after = await inspect(page, s.owner.sessionId); expect(after.entities).toBe(before.entities); expect(after.time).toBe(before.time); expect(after.count).toBe(before.count); expect(after.calls).toBe(before.calls + 1)
  await enter(page, s.owner.sessionId, 'viewer.seat.hero')
  await expect(page.getByRole('heading', { name: '待确认的行动意图', exact: true })).toBeVisible({ timeout: 30000 }); expect(sends).toBe(1)
})

test('native host recap uses only actually common reported identity and preserves its attribution after refresh and explicit save', async ({ page }, info) => {
  test.setTimeout(240000); await page.goto('./')
  const s = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, helper = await load('/storyforge/tests/helpers/open-identity-knowledge-runtime.ts')
    const s = await helper.setupIdentityKnowledgeRuntimeV1(false, true, 'party'), service = await load('/storyforge/src/lib/ttrpg/open-identity-knowledge-service.ts')
    const review = await service.prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, submissionKey: 'native.common.observation', request: s.request })
    const original = await service.confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...s.owner, review, decision: 'confirm-these-identities-and-recipients' })
    await helper.identityKnowledgeWindowV1(s.owner.sessionId, 'viewer.seat.hero')
    const speaker = { ...s.owner, viewerKey: 'viewer.seat.hero' }, report = await service.prepareTtrpgOpenIdentityKnowledgeV1({ ...speaker, submissionKey: 'native.common.report', request: {
      ...s.request, mode: 'share', actorKey: 'hero', sourceKnowledgeKey: original.knowledgeKey, recipientActorKeys: ['companion.1', 'companion.2'] } })
    await service.confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...speaker, review: report, decision: 'confirm-these-identities-and-recipients' })
    const core = await load('/storyforge/src/lib/product/runtime-core.ts'), commands = await load('/storyforge/src/lib/ttrpg/runtime-commands.ts'), envelopes = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const state = await core.readProductRuntimeState(s.owner.sessionId), epoch = state.ttrpg.openRun.coordination.epochs.find((row: any) => row.epochKey === state.ttrpg.openRun.coordination.activeEpochKey)
    await commands.closeTtrpgOpenEpochV1({ ...await envelopes.openEnvelopeV1(s.owner.sessionId, 'native.common.close'), viewerKey: speaker.viewerKey, epochKey: epoch.epochKey, reason: '传播完成，交给主持复盘' })
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'common-identity-native', apiKey: '', baseUrl: location.origin + '/common-identity-native/v1', maxTokens: 1000, contextWindow: 64000 })
    return { owner: s.owner, entityRef: s.entityRef }
  })
  let sends = 0
  await page.route('**/common-identity-native/v1/chat/completions', async route => {
    sends++; const wire = route.request().postDataJSON(), text = wire.messages.map((row: any) => row.content).join('\n')
    expect(text).toContain('storyforge.ttrpg-open-common-identity'); expect(text).toContain('新守灯人')
    expect(text).toMatch(/"reliability"\s*:\s*"hearsay"/); expect(text).not.toMatch(/gmProfile|害怕洪水|storyforge.ttrpg-open-learned-identity/)
    const content = JSON.stringify({ paragraphs: [{ text: '大家听说此人名为新守灯人，这份身份转述尚需核实。', sourceKeys: [`identity.${s.entityRef}`] }] })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 } }) })
  })
  const before = await inspect(page, s.owner.sessionId)
  await enter(page, s.owner.sessionId)
  let card = page.getByTestId('ttrpg-open-brief')
  await expect(card).toBeVisible(); if (!await card.evaluate(element => (element as HTMLDetailsElement).open)) await card.locator('summary').first().click()
  await card.getByLabel('复盘要求', { exact: true }).fill('复盘新守灯人的身份，保留原可靠性。')
  await card.getByRole('button', { name: '请求 AI 阶段复盘', exact: true }).click()
  await expect(card.getByRole('region', { name: '待审阅的阶段复盘' })).toContainText('大家听说此人名为新守灯人', { timeout: 60000 })
  await card.getByText('查看这一段的依据', { exact: true }).click(); await expect(card).toContainText('全队共同身份 · 转述')
  expect(sends).toBe(1)
  await enter(page, s.owner.sessionId)
  card = page.getByTestId('ttrpg-open-brief'); if (!await card.evaluate(element => (element as HTMLDetailsElement).open)) await card.locator('summary').first().click()
  await card.getByRole('button', { name: '确认保存这份复盘记忆', exact: true }).click()
  await expect(card.getByText('本份复盘已保存为本局记忆，来源标记保留。', { exact: true })).toBeVisible({ timeout: 60000 })
  expect(sends).toBe(1)
  const after = await inspect(page, s.owner.sessionId)
  expect(after.entities).toBe(before.entities); expect(after.time).toBe(before.time); expect(after.count).toBe(before.count)
  await page.setViewportSize({ width: 390, height: 844 }); await card.screenshot({ path: info.outputPath('common-identity-recap-mobile.png') })
})
