import { expect, test, type Page, type Locator } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
async function seed(page: Page, audience: 'party' | 'public' = 'party') {
  await page.goto('./')
  return page.evaluate(async audience => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const s = await (await load('/storyforge/tests/helpers/open-common-oracle-desk.ts')).setupCommonOracleDeskV1(audience)
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'common-fact-desk-native', apiKey: '', baseUrl: location.origin + '/common-fact-desk-native/v1', maxTokens: 4000, contextWindow: 64000 })
    return { owner: s.owner, selected: s.selected, fact: s.fact, npc: s.npc, privatePlace: s.privatePlace,
      entities: JSON.stringify(s.before.entities), product: JSON.stringify(s.before.ttrpg.product),
      output: JSON.stringify({ interpretation: '原共同咨询的完整解释。', facts: [s.fact, { ...s.fact, canonicalValue: false, detail: '相反的共同提案，须逐条明确弃用。' }] }) }
  }, audience)
}
async function enter(page: Page, sessionId: number, viewerKey: string) {
  await page.goto('./play/session/' + sessionId)
  await page.getByLabel('我的角色', { exact: true }).selectOption(viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  const card = page.getByTestId('ttrpg-open-common-oracle-desk')
  await expect(card).toBeVisible({ timeout: 30000 }); await card.locator('summary').first().click(); return card
}
async function form(card: Locator, selected: { oracleSourceRef: { sessionKey: string; sequence: number } }) {
  await card.getByLabel('共同事实的原咨询', { exact: true }).selectOption(`${selected.oracleSourceRef.sessionKey}:${selected.oracleSourceRef.sequence}`)
  await expect(card.getByRole('region', { name: '本次共同事实资料', exact: true })).toContainText('原结果：')
  const send = card.getByRole('button', { name: '请求本次共同事实候选', exact: true })
  await expect(send).toBeDisabled()
  await card.getByLabel('我同意 AI 按以上原咨询、共同资料、接收者和预留上限请求一次候选。', { exact: true }).check()
  await expect(send).toBeEnabled(); return send
}
const response = (output: string) => JSON.stringify({ id: 'common-fact-desk-original', model: 'common-fact-desk-native',
  choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300 } })
async function inspect(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id), run = state.ttrpg.openRun
    return { facts: run.factLedger?.entries.length ?? 0, calls: run.coordination.calls.length, active: run.coordination.activeEpochKey,
      call: run.coordination.calls[0], runs: await db.agentRuns.where('productRuntimeSessionId').equals(id).count(),
      entities: JSON.stringify(state.entities), product: JSON.stringify(state.ttrpg.product), archived: Boolean(run.coordination.epochs.at(-1)?.commonOracleArchive) }
  }, sessionId)
}
for (const audience of ['party', 'public'] as const) test(`${audience}: common fact UI sends once, reloads pending decisions, retries original review after storage failure and preserves the backup`, async ({ page }) => {
  test.setTimeout(240000)
  const f = await seed(page, audience), wires: string[] = []
  await page.route('**/common-fact-desk-native/v1/chat/completions', async route => {
    const wire = route.request().postDataJSON(), text = JSON.stringify(wire.messages); wires.push(text)
    expect(wire.model).toBe('common-fact-desk-native')
    for (const secret of ['COMMON-ORACLE-GM-', 'COMMON-ORACLE-PRIVATE-', 'COMMON-ORACLE-FULL-', f.privatePlace, 'operationKey', 'characterSheet', '.equipment.0']) expect(text).not.toContain(secret)
    if (audience === 'public') expect(text).not.toContain(f.npc)
    await route.fulfill({ contentType: 'application/json', body: response(f.output) })
  })
  let card = await enter(page, f.owner.sessionId, f.owner.viewerKey)
  await (await form(card, f.selected)).click()
  await expect(card.getByRole('region', { name: '本版本共同事实候选', exact: true })).toContainText('相反的共同提案', { timeout: 60000 })
  expect((await inspect(page, f.owner.sessionId)).facts).toBe(0); expect(wires).toHaveLength(1)
  await page.reload(); card = await enter(page, f.owner.sessionId, f.owner.viewerKey)
  await expect(card.getByLabel('原共同解释决定', { exact: true })).toHaveValue('')
  await expect(card.getByRole('region', { name: '原请求实际交付的共同资料', exact: true })).toBeVisible()
  const confirm = card.getByRole('button', { name: '确认本版本共同事实审阅', exact: true }); await expect(confirm).toBeDisabled()
  await card.getByLabel('共同事实提案 1 决定', { exact: true }).selectOption('adopt')
  await card.getByLabel('共同事实提案 2 决定', { exact: true }).selectOption('discard')
  await card.getByLabel('共同事实提案 2 弃用原因', { exact: true }).fill('相反结论，明确弃用。')
  await card.getByLabel('原共同解释决定', { exact: true }).selectOption('accept')
  await card.getByLabel('我已核对本版本共同解释、原依据及每条提案的决定和范围。', { exact: true }).check()
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'), add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    db.productRuntimeEvents.add = async (value: any, ...args: any[]) => {
      if (value.type === 'ttrpg.open.oracle.reviewed') { db.productRuntimeEvents.add = add; throw new Error('COMMON-NATIVE-REVIEW-STORAGE-CUT') }
      return add(value, ...args)
    }
  })
  await confirm.click()
  const retry = card.getByRole('button', { name: '核对并重试原共同审阅', exact: true }); await expect(retry).toBeEnabled({ timeout: 30000 })
  expect((await inspect(page, f.owner.sessionId)).facts).toBe(0)
  await retry.click(); await expect(card).toContainText('原共同审阅已核对完成', { timeout: 30000 })
  await card.getByRole('button', { name: '结束本次已审阅共同事实窗口', exact: true }).click()
  await expect(card).toContainText('原共同事实窗口已结束', { timeout: 30000 }); await expect(card).toContainText('已保存决定：弃用')
  const final = await inspect(page, f.owner.sessionId)
  expect(final).toMatchObject({ facts: 1, calls: 1, active: null, runs: 1, entities: f.entities, product: f.product }); expect(wires).toHaveLength(1)
  const backupEqual = await page.evaluate(async owner => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts'), core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const original = await core.readProductRuntimeState(owner.sessionId), projectId = await backup.importProjectJSON(await backup.exportProjectJSON(owner.scope.projectId)), copy = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    return JSON.stringify((await core.readProductRuntimeState(copy.id)).ttrpg.openRun) === JSON.stringify(original.ttrpg.openRun)
  }, f.owner)
  expect(backupEqual).toBe(true)
})
test('mobile common fact UI retains the candidate without automatic confirmation and fits the viewport', async ({ page }, testInfo) => {
  test.setTimeout(240000); await page.setViewportSize({ width: 390, height: 844 })
  const f = await seed(page); let sends = 0
  await page.route('**/common-fact-desk-native/v1/chat/completions', async route => { sends++; await route.fulfill({ contentType: 'application/json', body: response(f.output) }) })
  const card = await enter(page, f.owner.sessionId, f.owner.viewerKey); await (await form(card, f.selected)).click()
  await expect(card.getByRole('region', { name: '本版本共同事实候选', exact: true })).toContainText('相反的共同提案', { timeout: 60000 })
  await expect(card.getByRole('button', { name: '确认本版本共同事实审阅', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await card.screenshot({ path: testInfo.outputPath('common-fact-mobile-unconfirmed.png') })
  await card.getByRole('button', { name: '放弃本次共同候选并结束窗口', exact: true }).click()
  await expect(card).toContainText('原共同候选已明确放弃', { timeout: 30000 }); expect(sends).toBe(1)
  expect(await inspect(page, f.owner.sessionId)).toMatchObject({ facts: 0, active: null, call: { status: 'succeeded' } })
})
test('common UI stopping saves unknown cost before abort, and a late HTTP answer cannot replace the terminal record', async ({ page }) => {
  test.setTimeout(240000)
  const f = await seed(page); let release!: () => void, started!: () => void, finished!: () => void, sends = 0
  const gate = new Promise<void>(resolve => { release = resolve }), sending = new Promise<void>(resolve => { started = resolve }), done = new Promise<void>(resolve => { finished = resolve })
  await page.route('**/common-fact-desk-native/v1/chat/completions', async route => {
    sends++; started(); await gate
    try { await route.fulfill({ contentType: 'application/json', body: response(JSON.stringify({ interpretation: 'COMMON-NATIVE-LATE-ANSWER', facts: [] })) }) } catch { /* The saved stop may already have aborted the HTTP request. */ }
    finally { finished() }
  })
  const card = await enter(page, f.owner.sessionId, f.owner.viewerKey); await (await form(card, f.selected)).click(); await sending
  await card.getByRole('button', { name: '停止本次共同事实请求', exact: true }).click()
  await expect(card).toContainText('原共同请求已明确停止', { timeout: 30000 })
  const saved = await inspect(page, f.owner.sessionId)
  expect(saved).toMatchObject({ facts: 0, active: null, call: { status: 'unknown', usage: { actualCostUsd: null } } })
  release(); await done; expect(await inspect(page, f.owner.sessionId)).toEqual(saved); expect(sends).toBe(1)
  await expect(card).not.toContainText('COMMON-NATIVE-LATE-ANSWER')
})
test('imported candidate UI offers explicit archival, preserves source Runs and does not restore a send or confirmation button', async ({ page }) => {
  test.setTimeout(240000)
  const f = await seed(page)
  await page.route('**/common-fact-desk-native/v1/chat/completions', async route => { await route.fulfill({ contentType: 'application/json', body: response(f.output) }) })
  let card = await enter(page, f.owner.sessionId, f.owner.viewerKey); await (await form(card, f.selected)).click()
  await expect(card.getByRole('region', { name: '本版本共同事实候选', exact: true })).toContainText('相反的共同提案', { timeout: 60000 })
  const imported = await page.evaluate(async owner => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const before = JSON.stringify(await db.agentRuns.toArray()), events = JSON.stringify(await db.agentRunEvents.toArray())
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(owner.scope.projectId)), copy = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    return { projectId, sessionId: copy.id, before, events }
  }, f.owner)
  await page.setViewportSize({ width: 390, height: 844 })
  card = await enter(page, imported.sessionId, f.owner.viewerKey)
  await expect(card.getByRole('button', { name: '归档原共同请求并结束本桌窗口', exact: true })).toBeEnabled({ timeout: 30000 })
  await card.getByText('查看原共同回答（只读）', { exact: true }).click()
  await expect(card.getByLabel('原共同回答只读记录', { exact: true })).toContainText('原共同咨询的完整解释。')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await expect(card.getByRole('button', { name: '继续原共同事实请求', exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: '确认本版本共同事实审阅', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '归档原共同请求并结束本桌窗口', exact: true }).click()
  await expect(card).toContainText('原共同请求已明确归档', { timeout: 30000 })
  expect(await inspect(page, imported.sessionId)).toMatchObject({ facts: 0, active: null, archived: true, call: { status: 'succeeded' } })
  const unchanged = await page.evaluate(async ({ f, imported }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const rows = await db.agentRuns.where('projectId').equals(f.owner.scope.projectId).toArray(), ids = new Set(rows.map((row: any) => row.id))
    return JSON.stringify(rows) === imported.before && JSON.stringify((await db.agentRunEvents.toArray()).filter((row: any) => ids.has(row.runId))) === imported.events
  }, { f, imported })
  expect(unchanged).toBe(true)
})
