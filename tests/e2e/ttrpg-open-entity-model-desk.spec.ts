import { expect, test, type Page } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))

async function seed(page: Page, audience: 'party' | 'private', closed = false) {
  await page.goto('./')
  return page.evaluate(async ({ audience, closed }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { setupOpenEntityModelV1 } = await load('/storyforge/tests/helpers/open-entity-model.ts')
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    const s = await setupOpenEntityModelV1(audience, (pkg: any) => {
      pkg.ttrpg.campaign.characterTemplates.find((c: any) => c.characterKey === 'companion.1').controller = 'hybrid'
      pkg.ttrpg.campaign.runtimePolicy.maximumOutputTokens = 4000
    })
    const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey }
    if (closed) await (await load('/storyforge/src/lib/ttrpg/open-entity-desk.ts')).closeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'native.ai.initial.close' })
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'entity-model-desk-native', apiKey: '',
      baseUrl: location.origin + '/entity-model-desk-native/v1', maxTokens: 4000, contextWindow: 64000 })
    return { ...input, proposal: { ...s.proposal, templateKey: 'dynamic.npc', name: audience === 'private' ? 'PRIVATE-UI-NPC' : 'AI 候选守灯人',
      description: audience === 'private' ? 'PRIVATE-UI-DESCRIPTION' : '由原咨询资料起草，等待真人逐项确认。' },
    oracleKey: s.input.content.rulePack.content.oracles[0].oracleKey, tier: s.input.content.rulePack.content.oracles[0].likelihood?.tiers[0].tierKey }
  }, { audience, closed })
}
async function enter(page: Page, sessionId: number, viewer = 'viewer.seat.hero') {
  await page.goto('./play/session/' + sessionId)
  await page.getByLabel('我的角色', { exact: true }).selectOption(viewer)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  const card = page.getByTestId('ttrpg-open-entity-desk')
  await expect(card).toBeVisible({ timeout: 30000 })
  if (!await card.evaluate(e => (e as HTMLDetailsElement).open)) await card.locator('summary').first().click()
  return card
}
async function form(page: Page, audience: 'party' | 'private') {
  const card = page.getByTestId('ttrpg-open-entity-desk'), ai = card.getByTestId('ttrpg-open-entity-model-desk')
  await card.getByLabel('本次创建依据', { exact: true }).selectOption({ index: 1 })
  const scope = ai.getByLabel('AI 实体提案范围', { exact: true })
  await expect(scope.locator('option').filter({ hasText: audience === 'party' ? /^本次队伍/ : /^指定接收者/ })).toHaveCount(1, { timeout: 30000 })
  const scopeKey = await scope.locator('option').evaluateAll((rows, prefix) => rows.find(e => e.textContent?.startsWith(prefix))?.getAttribute('value'), audience === 'party' ? '本次队伍' : '指定接收者')
  expect(scopeKey).toBeTruthy(); await scope.selectOption(scopeKey!)
  await ai.getByTestId('entity-ai-template-dynamic.npc').check(); await ai.getByTestId('entity-ai-placement-harbor').check()
  const send = ai.getByRole('button', { name: '按本次选择请求 AI 起草', exact: true })
  await expect(send).toBeDisabled()
  await ai.getByLabel('我同意 AI 仅按以上本次资料和预留上限起草候选。', { exact: true }).check()
  await expect(send).toBeEnabled(); return { card, ai, send }
}
async function inspect(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { readProductRuntimeState } = await load('/storyforge/src/lib/product/runtime-core.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await readProductRuntimeState(id), run = state.ttrpg.openRun
    return { entities: Object.keys(state.entities), entityCount: run.entityOperations?.filter((o: any) => o.resolution?.kind === 'materialized').length ?? 0,
      pending: run.entityOperations?.filter((o: any) => !o.resolution).length ?? 0, calls: run.coordination.calls.length, epoch: run.coordination.activeEpochKey,
      callStatus: run.coordination.calls[0]?.status, usage: run.coordination.calls[0]?.usage, worldTurn: run.worldTime.worldTurn,
      runStates: (await db.agentRuns.where('productRuntimeSessionId').equals(id).toArray()).map((r: any) => r.status) }
  }, sessionId)
}
for (const audience of ['party', 'private'] as const) test(`${audience}: actual UI explicitly selects sources, sends once, reviews, confirms and creates; reload and identity handoff never resend or expose private text`, async ({ page }) => {
  test.setTimeout(180000)
  const f = await seed(page, audience, audience === 'party'); let sends = 0
  await page.route('**/entity-model-desk-native/v1/chat/completions', async route => {
    sends++; const wire = route.request().postDataJSON(), messages = JSON.stringify(wire.messages)
    expect(wire.max_tokens).toBe(4000); expect(wire.model).toBe('entity-model-desk-native')
    for (const forbidden of ['ENTITY-MODEL-GM-TEMPLATE-CANARY', 'ENTITY-MODEL-NPC-SECRET-CANARY', 'ENTITY-MODEL-FRONT-SECRET-CANARY', '明确咨询并审查可实例化对象']) expect(messages).not.toContain(forbidden)
    if (audience === 'party') expect(messages).not.toContain('ENTITY-MODEL-PRIVATE-TEMPLATE-CANARY')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals: [f.proposal] }) } }], usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 } }) })
  })
  let card = await enter(page, f.sessionId)
  if (audience === 'party') {
    await card.getByRole('button', { name: '开始本次实体咨询', exact: true }).click()
    await expect(card.getByLabel('实体咨询表', { exact: true })).toBeEnabled({ timeout: 30000 })
    await card.getByLabel('实体咨询表', { exact: true }).selectOption(f.oracleKey)
    if (f.tier) await card.getByLabel('本次可能性', { exact: true }).selectOption(f.tier)
    await card.getByLabel('实体咨询问题', { exact: true }).fill('码头能出现哪位守灯人？')
    await card.getByRole('button', { name: '明确咨询一次', exact: true }).click()
  }
  const before = await inspect(page, f.sessionId), { ai, send } = await form(page, audience)
  await send.click()
  await expect(ai.getByRole('heading', { name: 'NPC：' + f.proposal.name, exact: true })).toBeVisible({ timeout: 60000 })
  expect(await inspect(page, f.sessionId)).toMatchObject({ entities: before.entities, pending: 0, calls: 1, worldTurn: 0 })
  const adopt = ai.getByRole('button', { name: '采用原模型候选为待确认计划', exact: true }); await expect(adopt).toBeDisabled()
  await page.reload(); card = await enter(page, f.sessionId)
  const reloaded = card.getByTestId('ttrpg-open-entity-model-desk')
  await expect(reloaded.getByRole('heading', { name: 'NPC：' + f.proposal.name, exact: true })).toBeVisible({ timeout: 30000 })
  await expect(reloaded.getByLabel('我已审阅以上原模型候选及本次范围，采用为待确认计划。', { exact: true })).not.toBeChecked()
  await reloaded.getByLabel('我已审阅以上原模型候选及本次范围，采用为待确认计划。', { exact: true }).check()
  await reloaded.getByRole('button', { name: '采用原模型候选为待确认计划', exact: true }).click()
  await expect(card.getByRole('region', { name: '待确认实体计划' })).toContainText('本计划来自 AI 候选', { timeout: 30000 })
  expect(await inspect(page, f.sessionId)).toMatchObject({ entities: before.entities, pending: 1, calls: 1 })
  const create = card.getByRole('button', { name: '明确创建已确认对象', exact: true }); await expect(create).toBeDisabled()
  await card.getByLabel('我已审阅本版本对相关角色的影响。', { exact: true }).check()
  await card.getByRole('button', { name: /同意为「.*」创建本次对象/, exact: true }).click()
  await expect(create).toBeEnabled({ timeout: 30000 }); await create.click()
  await expect(card.getByRole('region', { name: '已创建的本局对象' })).toContainText(f.proposal.name, { timeout: 30000 })
  await card.getByRole('button', { name: '结束本次实体咨询', exact: true }).click()
  await expect.poll(() => inspect(page, f.sessionId), { timeout: 30000 }).toMatchObject({ entityCount: 1, pending: 0, calls: 1, epoch: null, runStates: ['completed'], worldTurn: 0 })
  expect(sends).toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('entity-model-' + audience + '-mobile-v1.png'), fullPage: true })
  if (audience === 'private') {
    await page.getByRole('button', { name: '交接给另一位玩家', exact: true }).click()
    await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.companion.1')
    await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
    await expect(page.getByTestId('ttrpg-open-player-table')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('PRIVATE-UI-')
  }
  await page.reload(); expect(sends).toBe(1)
})
test('in-flight Stop saves unknown cost and closes the original window before abort; refresh never resends', async ({ page }) => {
  test.setTimeout(180000)
  const f = await seed(page, 'party'); let sends = 0, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/entity-model-desk-native/v1/chat/completions', async route => {
    sends++; await held
    try { await route.fulfill({ contentType: 'application/json', body: '{}' }) } catch { /* The explicit local abort already ended the wait. */ }
  })
  try {
    await enter(page, f.sessionId); const before = await inspect(page, f.sessionId), { ai, send } = await form(page, 'party')
    await send.click(); await expect.poll(() => sends, { timeout: 30000 }).toBe(1)
    const stop = ai.getByRole('button', { name: '停止并放弃本次 AI 起草', exact: true }); await expect(stop).toBeEnabled(); await stop.click()
    await expect(ai.getByText('本次 AI 起草已放弃，原咨询已结束；原回答及费用记录保留，没有创建对象。', { exact: true })).toBeVisible({ timeout: 30000 })
    expect(await inspect(page, f.sessionId)).toMatchObject({ entities: before.entities, pending: 0, calls: 1, epoch: null, callStatus: 'unknown',
      usage: { source: 'unknown', actualCostUsd: null, inputTokens: null, outputTokens: null }, runStates: ['cancelled'] })
    await page.reload(); await enter(page, f.sessionId)
    await page.getByRole('button', { name: '读取 AI 实体起草进度', exact: true }).click()
    expect(sends).toBe(1); expect(await inspect(page, f.sessionId)).toMatchObject({ calls: 1, epoch: null, pending: 0 })
  } finally { release() }
})
test('a persisted candidate interrupted before its receipt is repaired after reload without another HTTP request', async ({ page }) => {
  test.setTimeout(180000)
  const f = await seed(page, 'party'); let sends = 0
  await page.route('**/entity-model-desk-native/v1/chat/completions', async route => {
    sends++
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals: [f.proposal] }) } }], usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 } }) })
  })
  await enter(page, f.sessionId)
  await page.evaluate(async () => {
    const { db } = await (new Function('p', 'return import(p)') as (p: string) => Promise<any>)('/storyforge/src/lib/db/schema.ts')
    const add = db.agentRunEvents.add.bind(db.agentRunEvents); let failed = false
    db.agentRunEvents.add = async function(row: any, ...args: any[]) {
      if (!failed && row.type === 'candidate.persisted') { failed = true; throw new Error('ENTITY-NATIVE-CANDIDATE-RECEIPT-CUT') }
      return add(row, ...args)
    }
  })
  const { ai, send } = await form(page, 'party'); await send.click()
  await expect(ai.getByRole('button', { name: '补齐原实体 AI 回执', exact: true })).toBeEnabled({ timeout: 60000 })
  expect(await inspect(page, f.sessionId)).toMatchObject({ calls: 1, pending: 0, callStatus: 'succeeded' })
  await page.reload(); const card = await enter(page, f.sessionId), restored = card.getByTestId('ttrpg-open-entity-model-desk')
  await restored.getByRole('button', { name: '补齐原实体 AI 回执', exact: true }).click()
  await expect(restored.getByRole('heading', { name: 'NPC：' + f.proposal.name, exact: true })).toBeVisible({ timeout: 30000 })
  expect(sends).toBe(1); expect(await inspect(page, f.sessionId)).toMatchObject({ calls: 1, pending: 0, runStates: ['awaiting_confirmation'] })
  await restored.getByRole('button', { name: '结束咨询并放弃未采用的 AI 草稿', exact: true }).click()
  await expect(restored.getByText('本次咨询已结束，未采用的 AI 草稿已放弃，原回答与费用记录保留。', { exact: true })).toBeVisible({ timeout: 30000 })
  expect(await inspect(page, f.sessionId)).toMatchObject({ calls: 1, pending: 0, epoch: null, runStates: ['cancelled'] }); expect(sends).toBe(1)
})
