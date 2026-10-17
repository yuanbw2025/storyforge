import { test, expect, type Page } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
async function seed(page: Page, prepared = false) {
  await page.goto('./')
  return page.evaluate(async prepared => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-situation-generation.ts')
    const f = await helper.setupSituationGenerationV1(true)
    let preparedRunId: number | null = null
    if (prepared) preparedRunId = (await (await importer('/storyforge/src/lib/ttrpg/open-intent-input.ts')).prepareTtrpgOpenSituationInputV1({ ...f.request, modelIdentity: { provider: 'custom', model: 'situation-desk-native' } })).runId
    else await (await importer('/storyforge/src/lib/ttrpg/open-generated-situation-stop.ts')).finishTtrpgOpenSituationDraftV1(f.input)
    const { useAIConfigStore } = await importer('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'situation-desk-native', apiKey: 'test-only-key', baseUrl: 'https://ttrpg-situation-desk.invalid/v1', maxTokens: 8000, contextWindow: 50000 })
    return { input: f.input, rawInput: helper.SITUATION_GENERATION_INPUT_V1, preparedRunId }
  }, prepared)
}
async function host(page: Page) {
  await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
  await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  return panel(page)
}
async function panel(page: Page) {
  const card = page.getByTestId('ttrpg-open-situation-desk')
  await expect(card).toBeVisible()
  if (!await card.evaluate(e => (e as HTMLDetailsElement).open)) await card.locator('summary').first().click()
  return card
}
test('real GM UI requests, reviews exact disclosure, repairs one commit, ends the draft and separately enables its situation', async ({ page }) => {
  test.setTimeout(240000)
  const f = await seed(page), sends: string[] = []
  await page.route('https://ttrpg-situation-desk.invalid/v1/chat/completions', async route => {
    sends.push(route.request().postData() ?? '')
    const value = await page.evaluate(async input => {
      const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const kernel = await (await importer('/storyforge/src/lib/ttrpg/open-generated-situation-context.ts')).loadTtrpgOpenSituationKernelInputV1({ ...input, actorKey: 'gm' })
      return (await importer('/storyforge/tests/helpers/open-situation-generation.ts')).situationGenerationOutputV1(kernel.basis)
    }, f.input)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'isolated-gm-desk', model: 'situation-desk-native',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } }) })
  })
  await page.goto('./play/session/' + f.input.sessionId)
  let card = await host(page)
  await card.getByLabel('局势拟定要求', { exact: true }).fill(f.rawInput)
  await card.getByRole('button', { name: '请求 AI 拟定局势', exact: true }).click()
  await expect(card.getByRole('region', { name: '主持局势审阅', exact: true })).toBeVisible({ timeout: 60000 })
  const adopt = card.getByRole('button', { name: '确认披露并采用局势', exact: true })
  await expect(adopt).toBeDisabled(); expect(sends).toHaveLength(1)
  await page.reload(); card = await host(page)
  await expect(card.getByRole('button', { name: '确认披露并采用局势', exact: true })).toBeDisabled()
  expect(sends).toHaveLength(1)
  await card.getByLabel('我已审阅本版本的玩家标题、提示、线索正文和披露条件，同意保存此版本。', { exact: true }).check()
  await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'), original = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async () => { db.agentRunEvents.add = original; throw new Error('fixture situation terminal interruption') }
  })
  await card.getByRole('button', { name: '确认披露并采用局势', exact: true }).click()
  await expect(card.getByRole('button', { name: '补齐局势采用回执', exact: true })).toBeVisible()
  await card.getByRole('button', { name: '补齐局势采用回执', exact: true }).click()
  await expect(card.getByRole('button', { name: '补齐局势采用回执', exact: true })).toHaveCount(0)
  const enable = card.getByRole('region', { name: '本局已采用局势', exact: true }).getByRole('button')
  await expect(enable).toBeDisabled()
  await card.getByRole('button', { name: '结束本次局势拟定', exact: true }).click()
  await expect(enable).toBeEnabled(); await enable.click()
  await expect(card.getByText('该局势已启用。', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '主持当前局势', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回身份选择', exact: true })).toBeEnabled()
  expect(sends).toHaveLength(1)
  await page.setViewportSize({ width: 390, height: 844 }); await card.locator('summary').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('situation-desk-mobile-v3.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const final = await page.evaluate(async sessionId => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const run = (await (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId)).ttrpg.openRun
    return { adopted: run.situationReceipts.length, active: run.situations.active.length, turns: run.worldTime.worldTurn, calls: run.coordination.calls.length }
  }, f.input.sessionId)
  expect(final).toMatchObject({ adopted: 1, active: 1, turns: 0, calls: 1 })
})
test('GM UI cancels an unsent request, declines an invalid reply and clears private draft state before a player enters', async ({ page }) => {
  test.setTimeout(180000)
  const f = await seed(page, true), requests: string[] = []
  await page.route('https://ttrpg-situation-desk.invalid/v1/chat/completions', async route => {
    requests.push(route.request().url())
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'isolated-invalid-desk', model: 'situation-desk-native',
      choices: [{ index: 0, message: { role: 'assistant', content: '{"schema":"PRIVATE-INVALID-SITUATION-REPLY"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  await page.goto('./play/session/' + f.input.sessionId)
  const card = await host(page)
  await card.getByRole('button', { name: '取消未发送的局势请求', exact: true }).click()
  await expect(card.getByRole('button', { name: '继续原局势请求', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '取消本次局势拟定', exact: true }).click()
  expect(requests).toEqual([])
  await card.getByLabel('局势拟定要求', { exact: true }).fill(f.rawInput)
  await card.getByRole('button', { name: '请求 AI 拟定局势', exact: true }).click()
  await expect(card.getByText('原回复格式或引用未通过检查，当前不能采用。', { exact: true })).toBeVisible({ timeout: 60000 })
  await expect(card.getByRole('button', { name: '确认披露并采用局势', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '放弃这份局势', exact: true }).click()
  await expect(card.getByText('这份局势已明确放弃，不能再采用。', { exact: true })).toBeVisible()
  await card.getByLabel('局势拟定要求', { exact: true }).fill('UNSAVED-PRIVATE-SITUATION-DRAFT')
  await page.getByRole('button', { name: '返回身份选择', exact: true }).click()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByTestId('ttrpg-open-situation-desk')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('PRIVATE-INVALID-SITUATION-REPLY')
  await expect(page.locator('body')).not.toContainText('UNSAVED-PRIVATE-SITUATION-DRAFT')
  expect(requests).toHaveLength(1)
})
test('explicitly resuming an original prepared request can be stopped durably without a replacement send', async ({ page }) => {
  test.setTimeout(180000)
  const f = await seed(page, true)
  let sends = 0, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('https://ttrpg-situation-desk.invalid/v1/chat/completions', async route => {
    sends++; await held
    try { await route.fulfill({ contentType: 'application/json', body: '{}' }) } catch { /* The explicit browser abort already ended this held fixture request. */ }
  })
  try {
    await page.goto('./play/session/' + f.input.sessionId)
    const card = await host(page)
    await card.getByRole('button', { name: '继续原局势请求', exact: true }).click()
    await expect.poll(() => sends).toBe(1)
    await card.getByRole('button', { name: '停止本次局势请求', exact: true }).click()
    await expect(card.getByText('本次拟定已明确结束，原请求及费用记录保留。', { exact: true })).toBeVisible()
    await card.getByRole('button', { name: '读取局势拟定进度', exact: true }).click()
    expect(sends).toBe(1)
    const result = await page.evaluate(async f => {
      const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const run = (await (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.input.sessionId)).ttrpg.openRun
      const original = await (await importer('/storyforge/src/lib/agent/run/event-store.ts')).readInstanceAgentRunV1(f.input.scope, f.preparedRunId)
      return { activeEpoch: run.coordination.activeEpochKey, callCount: run.coordination.calls.length, status: run.coordination.calls[0].status, runState: original.projection.state }
    }, f)
    expect(result).toEqual({ activeEpoch: null, callCount: 1, status: 'unknown', runState: 'failed' }) // Preserve the actual transport-unknown terminal; Stop cannot rewrite it as cancelled.
  } finally { release() }
})
