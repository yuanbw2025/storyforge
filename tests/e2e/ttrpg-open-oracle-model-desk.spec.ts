import { expect, test, type Page, type Locator } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
async function seed(page: Page, audience: 'party' | 'gm-only') {
  await page.goto('./')
  return page.evaluate(async audience => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const s = await (await load('/storyforge/tests/helpers/open-oracle-runtime-model.ts')).setupOracleRuntimeDeskV1(audience)
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'oracle-model-desk-native', apiKey: '',
      baseUrl: location.origin + '/oracle-model-desk-native/v1', maxTokens: 1000, contextWindow: 64000 })
    return { owner: s.owner, oracle: s.input.oracle.sourceRef, npc: s.npc, place: s.place, fact: s.fact,
      originalEntities: JSON.stringify(s.state.entities), originalProduct: JSON.stringify(s.state.ttrpg.product) }
  }, audience)
}
async function enter(page: Page, sessionId: number) {
  await page.goto('./play/session/' + sessionId)
  await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
  await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  const card = page.getByTestId('ttrpg-open-oracle-model-desk')
  await expect(card).toBeVisible({ timeout: 30000 }); await card.locator('summary').first().click(); return card
}
async function form(card: Locator, oracle: { sessionKey: string; sequence: number }) {
  const select = card.getByLabel('用于模型事实的原咨询', { exact: true }), value = `${oracle.sessionKey}:${oracle.sequence}`
  await expect(select.locator(`option[value="${value}"]`)).toHaveCount(1, { timeout: 30000 })
  await select.selectOption(value)
  await expect(card.getByRole('region', { name: '本次模型可读对象', exact: true })).toContainText('新守灯人')
  const send = card.getByRole('button', { name: '按本次选择请求事实候选', exact: true })
  await expect(send).toBeDisabled()
  await card.getByLabel('我同意 AI 按以上原咨询、可读对象和预留上限请求一次候选。', { exact: true }).check()
  await expect(send).toBeEnabled(); return send
}
async function inspect(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await core.readProductRuntimeState(id), run = state.ttrpg.openRun
    return { facts: run.factLedger?.entries.length ?? 0, calls: run.coordination.calls.length, epoch: run.coordination.activeEpochKey,
      callStatus: run.coordination.calls[0]?.status, usage: run.coordination.calls[0]?.usage,
      runCount: await db.agentRuns.where('productRuntimeSessionId').equals(id).count(), worldTurn: run.worldTime.worldTurn }
  }, sessionId)
}
for (const audience of ['party', 'gm-only'] as const) test(`${audience}: actual Oracle model UI selects sources, sends once, reloads an unconfirmed candidate and retries exact human review after a real storage rollback`, async ({ page }) => {
  test.setTimeout(240000)
  const f = await seed(page, audience), wires: string[] = []
  const output = JSON.stringify({ interpretation: audience === 'gm-only' ? 'PRIVATE-NATIVE-ORACLE-INTERPRETATION' : '全队资料中的原咨询解释。',
    facts: [f.fact, { ...f.fact, canonicalValue: false, detail: '相反的判断，只能由真人逐项弃用。' }] })
  await page.route('**/oracle-model-desk-native/v1/chat/completions', async route => {
    const wire = route.request().postDataJSON(), text = JSON.stringify(wire.messages); wires.push(text)
    expect(wire.model).toBe('oracle-model-desk-native'); expect(wire.max_tokens).toBe(1000)
    expect(text).toContain(f.npc); expect(text).not.toMatch(/ORACLE-POLICY-PRIVATE-PROFILE|dynamicTemplateKey|operationKey/)
    if (audience === 'party') { expect(text).not.toContain(f.place); expect(text).not.toContain('.equipment.0') }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'native-oracle-desk', model: wire.model,
      choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300 } }) })
  })
  let card = await enter(page, f.owner.sessionId)
  await (await form(card, f.oracle)).click()
  await expect(card.getByRole('region', { name: '本版本模型事实候选', exact: true })).toContainText('相反的判断')
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ facts: 0, calls: 1, runCount: 1, callStatus: 'succeeded' })
  expect(wires).toHaveLength(1)
  await page.reload(); card = await enter(page, f.owner.sessionId)
  await expect(card.getByRole('region', { name: '本版本模型事实候选', exact: true })).toContainText('相反的判断')
  await expect(card.getByLabel('原解释决定', { exact: true })).toHaveValue('')
  await expect(card.getByRole('button', { name: '确认本版本模型事实审阅', exact: true })).toBeDisabled()
  await card.getByLabel('事实提案 1 决定', { exact: true }).selectOption('adopt')
  await card.getByLabel('事实提案 2 决定', { exact: true }).selectOption('discard')
  await card.getByLabel('事实提案 2 弃用原因', { exact: true }).fill('与第一条冲突，本次明确弃用。')
  await card.getByLabel('原解释决定', { exact: true }).selectOption('accept')
  await card.getByLabel('我已核对本版本全文、原依据及每条提案的决定和范围。', { exact: true }).check()
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), original = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    db.productRuntimeEvents.add = async (row: any, ...args: any[]) => {
      if (row.type === 'ttrpg.open.oracle.reviewed') { db.productRuntimeEvents.add = original; throw new Error('NATIVE-ORACLE-REVIEW-STORAGE-CUT') }
      return original(row, ...args)
    }
  })
  await card.getByRole('button', { name: '确认本版本模型事实审阅', exact: true }).click()
  const retry = card.getByRole('button', { name: '核对并重试原候选审阅', exact: true })
  await expect(retry).toBeEnabled(); expect((await inspect(page, f.owner.sessionId)).facts).toBe(0)
  await retry.click(); await expect(card).toContainText('原审阅确认已核对完成')
  await expect.poll(async () => (await inspect(page, f.owner.sessionId)).facts).toBe(1)
  await expect(card.getByRole('button', { name: '放弃本次事实候选并结束窗口', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '结束本次模型事实窗口', exact: true }).click()
  await expect.poll(async () => (await inspect(page, f.owner.sessionId)).epoch).toBeNull()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: test.info().outputPath(`oracle-model-desk-${audience}-mobile.png`), fullPage: true })
  const backup = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const io = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await core.readProductRuntimeState(f.owner.sessionId), run = state.ttrpg.openRun
    const projectId = await io.importProjectJSON(await io.exportProjectJSON(f.owner.scope.projectId)), restoredSession = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const restored = await core.readProductRuntimeState(restoredSession.id)
    return { sameFacts: JSON.stringify(run.factLedger) === JSON.stringify(restored.ttrpg.openRun.factLedger),
      sameReviews: JSON.stringify(run.oracleReviews) === JSON.stringify(restored.ttrpg.openRun.oracleReviews),
      sameEntities: JSON.stringify(state.entities) === f.originalEntities, sameProduct: JSON.stringify(state.ttrpg.product) === f.originalProduct,
      chosen: run.oracleReviews[0].choices.map((row: any) => row.decision) }
  }, f)
  expect(backup).toEqual({ sameFacts: true, sameReviews: true, sameEntities: true, sameProduct: true, chosen: ['adopt', 'discard'] })
  await page.getByRole('button', { name: '返回身份选择', exact: true }).click()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero'); await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-oracle-model-desk')).toHaveCount(0)
  if (audience === 'gm-only') await expect(page.locator('body')).not.toContainText('PRIVATE-NATIVE-ORACLE-INTERPRETATION')
  expect(wires).toHaveLength(1)
})
test('actual Oracle model UI Stop saves unknown, closes the original wait and never confirms a late reply', async ({ page }) => {
  test.setTimeout(240000)
  const f = await seed(page, 'gm-only'); let sends = 0, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/oracle-model-desk-native/v1/chat/completions', async route => {
    sends++; await held
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ interpretation: 'LATE-NATIVE-ORACLE-REPLY', facts: [f.fact] }) }, finish_reason: 'stop' }] }) }) } catch { /* The saved Stop may have already aborted this original browser request. */ }
  })
  try {
    const card = await enter(page, f.owner.sessionId)
    await (await form(card, f.oracle)).click()
    await expect.poll(() => sends).toBe(1)
    await card.getByRole('button', { name: '停止本次事实候选请求', exact: true }).click()
    await expect(card).toContainText('原请求已停止并结束窗口')
    await expect.poll(async () => (await inspect(page, f.owner.sessionId)).callStatus).toBe('unknown')
    expect(await inspect(page, f.owner.sessionId)).toMatchObject({ facts: 0, epoch: null, calls: 1, runCount: 1, usage: { source: 'unknown', actualCostUsd: null } })
    release()
    await page.reload(); await enter(page, f.owner.sessionId)
    expect(await inspect(page, f.owner.sessionId)).toMatchObject({ facts: 0, epoch: null, calls: 1, runCount: 1, callStatus: 'unknown' })
    await expect(page.locator('body')).not.toContainText('LATE-NATIVE-ORACLE-REPLY'); expect(sends).toBe(1)
  } finally { release() }
})
test('actual prepared Oracle UI survives dispatch storage failure and reload, rejects a changed model and resumes that request exactly once', async ({ page }) => {
  test.setTimeout(240000)
  const f = await seed(page, 'party'); let sends = 0
  await page.route('**/oracle-model-desk-native/v1/chat/completions', async route => {
    sends++
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'native-oracle-original-resume', model: 'oracle-model-desk-native',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ interpretation: '原请求仅此一次返回，候选尚未确认。', facts: [f.fact] }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 150, total_tokens: 1150 } }) })
  })
  let card = await enter(page, f.owner.sessionId)
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), original = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    db.productRuntimeEvents.add = async (row: any, ...args: any[]) => {
      if (row.type === 'ttrpg.open.call.dispatched') { db.productRuntimeEvents.add = original; throw new Error('NATIVE-ORACLE-DISPATCH-STORAGE-CUT') }
      return original(row, ...args)
    }
  })
  await (await form(card, f.oracle)).click()
  await expect(card.getByRole('button', { name: '继续原模型事实请求', exact: true })).toBeEnabled()
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ callStatus: 'prepared', runCount: 1, calls: 1, facts: 0 }); expect(sends).toBe(0)
  await page.reload(); card = await enter(page, f.owner.sessionId)
  await expect(card.getByRole('button', { name: '继续原模型事实请求', exact: true })).toBeEnabled(); expect(sends).toBe(0)
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ ...useAIConfigStore.getState().config, model: 'different-oracle-model' })
  })
  await card.getByRole('button', { name: '继续原模型事实请求', exact: true }).click()
  await expect(card.getByRole('alert')).toContainText('模型配置与冻结请求不一致')
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ callStatus: 'prepared', runCount: 1, calls: 1 }); expect(sends).toBe(0)
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ ...useAIConfigStore.getState().config, model: 'oracle-model-desk-native' })
  })
  await card.getByRole('button', { name: '继续原模型事实请求', exact: true }).click()
  await expect(card.getByRole('region', { name: '本版本模型事实候选', exact: true })).toContainText('原请求仅此一次返回')
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ callStatus: 'succeeded', runCount: 1, calls: 1, facts: 0 }); expect(sends).toBe(1)
  await card.getByRole('button', { name: '放弃本次事实候选并结束窗口', exact: true }).click()
  await expect.poll(async () => (await inspect(page, f.owner.sessionId)).epoch).toBeNull()
  await page.reload(); await enter(page, f.owner.sessionId)
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ callStatus: 'succeeded', runCount: 1, calls: 1, facts: 0, epoch: null }); expect(sends).toBe(1)
})
