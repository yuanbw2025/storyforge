import { expect, test, type Page } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
async function seed(page: Page) {
  await page.goto('./')
  return page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const f = await helper.readyOpenTtrpgSessionV1('Native common desk', (pkg: any) => {
      const c = pkg.ttrpg.campaign; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000; c.runtimePolicy.maximumOutputTokens = 8000
      c.fronts[0].goal = 'NATIVE-COMMON-DESK-PRIVATE-FRONT'; c.characterTemplates.find((t: any) => t.role === 'npc').gmProfile.secret = 'NATIVE-COMMON-DESK-PRIVATE-GM'
    })
    const { useAIConfigStore } = await importer('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'common-desk-native', apiKey: '', baseUrl: location.origin + '/common-desk-native/v1', maxTokens: 8000, contextWindow: 64000 })
    return { scope: f.scope, sessionId: f.sessionId, viewerKey: helper.OPEN_HUMAN_VIEWER }
  })
}
async function enter(page: Page, sessionId: number) {
  await page.goto('./play/session/' + sessionId)
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  const card = page.getByTestId('ttrpg-open-public-situation-desk')
  await expect(card).toBeVisible()
  if (!await card.evaluate(e => (e as HTMLDetailsElement).open)) await card.locator('summary').first().click()
  return card
}
async function body(page: Page, input: { scope: unknown; sessionId: number; viewerKey: string }) {
  return page.evaluate(async input => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const run = (await readProductRuntimeState(input.sessionId)).ttrpg.openRun, epoch = run.coordination.epochs.find((e: any) => e.epochKey === run.coordination.activeEpochKey)
    const { loadTtrpgOpenPublicSituationKernelV1 } = await importer('/storyforge/src/lib/ttrpg/open-public-situation-kernel.ts')
    const kernel = await loadTtrpgOpenPublicSituationKernelV1({ ...input, actorKey: 'gm' }, epoch.publicSituation)
    const { publicSituationOutputV1 } = await importer('/storyforge/tests/helpers/open-public-situation-generation.ts')
    const value = publicSituationOutputV1(kernel); value.template.driverGoal = 'NATIVE-COMMON-DESK-HIDDEN-GOAL'
    value.template.evidence.forEach((e: any) => { e.description = 'NATIVE-COMMON-DESK-HIDDEN-CLUE' })
    return JSON.stringify(value)
  }, input)
}
async function inspect(page: Page, input: { scope: unknown; sessionId: number; viewerKey: string }) {
  return page.evaluate(async input => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts'), { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const run = (await readProductRuntimeState(input.sessionId)).ttrpg.openRun, receipt = run.situationReceipts?.[0]
    return { calls: run.coordination.calls.length, runs: await db.agentRuns.count(), epoch: run.coordination.activeEpochKey,
      receipts: run.situationReceipts?.length ?? 0, active: run.situations.active.filter((i: any) => i.templateKey === receipt?.template.templateKey).length,
      decision: receipt?.disclosure.kind, rawInput: receipt?.disclosure.authorization.basis.sharedRequest.text,
      callStatus: run.coordination.calls[0]?.status, usage: run.coordination.calls[0]?.usage,
      runState: (await db.agentRuns.toArray())[0]?.status }
  }, input)
}
test('player-host explicitly shares and delegates once, saves without admission, then independently enables and reloads with no additional sends', async ({ page }) => {
  test.setTimeout(180000)
  const input = await seed(page), rawInput = '  这一次共同调查 e\u0301。\n'; let sends = 0
  await page.route('**/common-desk-native/v1/chat/completions', async route => {
    sends++; const wire = route.request().postDataJSON()
    expect(JSON.stringify(wire)).not.toContain('NATIVE-COMMON-DESK-PRIVATE-'); expect(wire.max_tokens).toBe(8000)
    expect(JSON.stringify(wire.messages)).toContain('这一次共同调查')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: await body(page, input) } }], usage: { prompt_tokens: 200, completion_tokens: 1000, total_tokens: 1200 } }) })
  })
  let card = await enter(page, input.sessionId)
  await expect(page.getByTestId('ttrpg-open-situation-desk')).toHaveCount(0)
  await card.getByLabel('本次共同局势要求', { exact: true }).fill(rawInput)
  const send = card.getByRole('button', { name: '请求并保存一个共同局势', exact: true })
  await expect(send).toBeDisabled()
  await card.getByLabel('我同意把以上本次输入共享给当前队伍。', { exact: true }).check(); await expect(send).toBeDisabled()
  expect(await inspect(page, input)).toMatchObject({ calls: 0, runs: 0, receipts: 0 }); expect(sends).toBe(0)
  await card.getByLabel('我委托 AI 主持在检查通过后采用本次这一个候选，保存局势定义。', { exact: true }).check()
  await send.click()
  await expect(card.getByText('局势定义已保存，尚未启用时可在下方单独启用。', { exact: true })).toBeVisible({ timeout: 60000 })
  expect(await inspect(page, input)).toMatchObject({ calls: 1, runs: 1, receipts: 1, epoch: null, active: 0, decision: 'ai-host-once-authorized', rawInput, runState: 'completed' })
  expect(sends).toBe(1)
  await expect(page.locator('body')).not.toContainText('NATIVE-COMMON-DESK-HIDDEN-'); await expect(page.locator('body')).not.toContainText('NATIVE-COMMON-DESK-PRIVATE-')
  await page.reload(); card = await enter(page, input.sessionId)
  await card.getByRole('button', { name: '启用「港湾的共同调查」', exact: true }).click()
  await expect(card.getByText('该局势已启用。', { exact: true })).toBeVisible()
  expect(await inspect(page, input)).toMatchObject({ receipts: 1, active: 1, calls: 1, runs: 1 }); expect(sends).toBe(1)
  await expect(card.getByText('港湾的共同调查 · 正在发生', { exact: true })).toBeVisible({ timeout: 30000 })
  await expect(page.locator('body')).not.toContainText('NATIVE-COMMON-DESK-HIDDEN-')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('public-situation-desk-mobile-v2.png'), fullPage: true })
})
test('Stop durably closes one actual in-flight request and preserves unknown cost without adoption or a replacement send', async ({ page }) => {
  test.setTimeout(180000)
  const input = await seed(page); let sends = 0, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/common-desk-native/v1/chat/completions', async route => {
    sends++; await held
    try { await route.fulfill({ contentType: 'application/json', body: '{}' }) } catch { /* The explicit abort ended this isolated request. */ }
  })
  try {
    let card = await enter(page, input.sessionId)
    await card.getByLabel('我同意把以上本次输入共享给当前队伍。', { exact: true }).check()
    await card.getByLabel('我委托 AI 主持在检查通过后采用本次这一个候选，保存局势定义。', { exact: true }).check()
    await card.getByRole('button', { name: '请求并保存一个共同局势', exact: true }).click()
    await expect.poll(() => sends, { timeout: 30000 }).toBe(1)
    await card.getByRole('button', { name: '停止本次共同局势请求', exact: true }).click()
    await expect(card.getByText('本次共同请求已结束，原回答及费用记录保留。', { exact: true })).toBeVisible({ timeout: 30000 })
    expect(await inspect(page, input)).toMatchObject({ calls: 1, runs: 1, receipts: 0, epoch: null, callStatus: 'unknown',
      usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null } })
    await page.reload(); card = await enter(page, input.sessionId)
    await card.getByRole('button', { name: '读取共同局势进度', exact: true }).click()
    expect(sends).toBe(1); expect(await inspect(page, input)).toMatchObject({ receipts: 0, calls: 1, runs: 1, epoch: null })
  } finally { release() }
})
