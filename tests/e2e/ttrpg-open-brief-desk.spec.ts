import { expect, test, type Page } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
async function seed(page: Page, humanGm = false, prepared = false) {
  await page.goto('./')
  return page.evaluate(async ({ humanGm, prepared }) => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { seedTtrpgOpenBriefDeskV1 } = await importer('/storyforge/tests/helpers/open-ttrpg-brief-desk.ts')
    const { f, host } = await seedTtrpgOpenBriefDeskV1(humanGm)
    const { useAIConfigStore } = await importer('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'brief-test-model', apiKey: 'test-only-key', baseUrl: 'https://ttrpg-brief.invalid/v1', maxTokens: 800, contextWindow: 50000 })
    if (prepared) {
      const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
      const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
      const inputs = await importer('/storyforge/src/lib/ttrpg/open-intent-input.ts')
      const rawInput = '原来尚未发送的复盘'
      await commands.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(f.sessionId, 'ui.prepared.epoch'), viewerKey: host.viewerKey, triggerKind: 'request-brief', rawInput })
      await inputs.prepareTtrpgOpenBriefInputV1({ ...host, ...await helper.openEnvelopeV1(f.sessionId, 'ui.prepared.input'), rawInput,
        modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    }
    return { host, sessionId: f.sessionId, heroName: f.campaign.characterTemplates[0].name }
  }, { humanGm, prepared })
}
async function player(page: Page, viewer = 'viewer.seat.hero') {
  await expect(page.getByLabel('我的角色', { exact: true })).toBeVisible({ timeout: 15000 })
  await page.getByLabel('我的角色', { exact: true }).selectOption(viewer)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
}
async function panel(page: Page) {
  const card = page.getByTestId('ttrpg-open-brief')
  await expect(card).toBeVisible()
  if (!await card.evaluate(element => (element as HTMLDetailsElement).open)) await card.locator('summary').first().click()
  return card
}
test('actual host UI requests once, reviews source reliability, repairs an interrupted save and clears drafts at identity handoff', async ({ page }) => {
  test.setTimeout(120000)
  const sent: string[] = []
  await page.route('https://ttrpg-brief.invalid/v1/chat/completions', async route => {
    sent.push(route.request().postData() ?? '')
    const content = JSON.stringify({ paragraphs: [{ text: '英雄对旧港船只的怀疑仍未确认。', sourceKeys: ['memory.brief-desk.shared'] }] })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'isolated-brief-response', model: 'brief-test-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 60, total_tokens: 160 } }) })
  })
  const f = await seed(page)
  await page.goto(`./play/session/${f.sessionId}`); await player(page)
  let card = await panel(page)
  expect(sent).toEqual([])
  await card.getByLabel('复盘要求', { exact: true }).fill('复盘旧港，区分个人推测。')
  await card.getByRole('button', { name: '请求 AI 阶段复盘', exact: true }).click()
  await expect(card.getByRole('region', { name: '待审阅的阶段复盘' })).toContainText('英雄对旧港船只的怀疑仍未确认。')
  await card.getByText('查看这一段的依据', { exact: true }).click()
  await expect(card).toContainText(`${f.heroName} · 个人推测`)
  expect(sent).toHaveLength(1); expect(sent[0]).not.toContain('GM-PRIVATE-BRIEF-DESK-EXCLUDED')
  await page.reload(); await player(page); card = await panel(page)
  await expect(card.getByRole('button', { name: '确认保存这份复盘记忆', exact: true })).toBeVisible()
  expect(sent).toHaveLength(1)
  await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'), add = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
    db.agentRunArtifacts.add = async () => { db.agentRunArtifacts.add = add; throw new Error('fixture recap terminal interruption') }
  })
  await card.getByRole('button', { name: '确认保存这份复盘记忆', exact: true }).click()
  await expect(card.getByRole('button', { name: '补齐复盘保存回执', exact: true })).toBeVisible()
  await card.getByRole('button', { name: '补齐复盘保存回执', exact: true }).click()
  await expect(card.getByText('本份复盘已保存为本局记忆，来源标记保留。', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: '补齐复盘保存回执', exact: true })).toHaveCount(0)
  expect(sent).toHaveLength(1)
  const memory = page.getByTestId('ttrpg-open-memory')
  await memory.locator('summary').first().click()
  await expect(memory).toContainText('AI复盘，经主持确认')
  await card.getByRole('button', { name: '结束本次复盘', exact: true }).click()
  await expect(card.getByRole('button', { name: '请求 AI 阶段复盘', exact: true })).toBeVisible()
  await card.getByLabel('复盘要求', { exact: true }).fill('UNSAVED-HOST-BRIEF-DRAFT')
  await page.getByRole('button', { name: '交接给另一位玩家', exact: true }).click(); await player(page, 'viewer.seat.companion.1')
  await expect(page.getByTestId('ttrpg-open-brief')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('UNSAVED-HOST-BRIEF-DRAFT')
  await page.getByRole('button', { name: '交接给另一位玩家', exact: true }).click(); await player(page)
  card = await panel(page); await expect(card.getByLabel('复盘要求', { exact: true })).not.toHaveValue('UNSAVED-HOST-BRIEF-DRAFT')
  await page.setViewportSize({ width: 390, height: 844 }); await card.scrollIntoViewIfNeeded()
  await card.screenshot({ path: test.info().outputPath('p8-model-recap-desk-mobile.png') })
  const result = await page.evaluate(async sessionId => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const state = await (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId)
    return { turns: state.ttrpg.openRun.worldTime.worldTurn, calls: state.ttrpg.openRun.coordination.calls.length,
      memories: state.ttrpg.openRun.memoryReceipts.filter((r: any) => r.version === 2).length }
  }, f.sessionId)
  expect(result).toEqual({ turns: 0, calls: 1, memories: 1 })
})
test('human GM UI cancels an original unsent request, then declines an invalid retained recap without any provider call', async ({ page }) => {
  test.setTimeout(120000)
  const requests: string[] = []
  page.on('request', request => { if (/\/v1\/(?:chat\/completions|responses)/.test(request.url())) requests.push(request.url()) })
  const f = await seed(page, true, true)
  await page.goto(`./play/session/${f.sessionId}`)
  await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
  await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  const card = await panel(page)
  await card.getByRole('button', { name: '取消未发送的复盘', exact: true }).click()
  await expect(card.getByRole('button', { name: '继续原复盘请求', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '结束本次复盘', exact: true }).click()
  await expect(card.getByRole('button', { name: '请求 AI 阶段复盘', exact: true })).toBeEnabled()
  await page.evaluate(async host => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const service = await importer('/storyforge/src/lib/ttrpg/open-brief-service.ts')
    await service.requestTtrpgOpenBriefDeskV1({ ...host, submissionKey: 'invalid.reply', rawInput: '为当前共同资料复盘', maximumCostUsd: 0.1,
      runAI: async () => JSON.stringify({ paragraphs: [{ text: '未交付的隐藏结论', sourceKeys: ['gm.private.truth'] }] }) })
  }, f.host)
  await card.getByRole('button', { name: '读取复盘进度', exact: true }).click()
  await expect(card.getByText('本次回复的格式或引用需要修订，不能直接保存。', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: '确认保存这份复盘记忆', exact: true })).toHaveCount(0)
  await card.getByRole('button', { name: '放弃这份复盘', exact: true }).click()
  await expect(card.getByText('这份复盘已放弃，不能保存为记忆。', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: '结束本次复盘', exact: true }).click()
  expect(requests).toEqual([])
})

test('stopping a dispatched UI recap retains an unknown result and never offers a resend', async ({ page }) => {
  test.setTimeout(120000)
  let sends = 0, release: () => void = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('https://ttrpg-brief.invalid/v1/chat/completions', async route => {
    sends += 1
    await held
    try { await route.abort('aborted') } catch { /* Original browser request has already been aborted. */ }
  })
  try {
    const f = await seed(page)
    await page.goto(`./play/session/${f.sessionId}`); await player(page)
    let card = await panel(page)
    await card.getByRole('button', { name: '请求 AI 阶段复盘', exact: true }).click()
    await expect.poll(() => sends).toBe(1)
    await page.getByRole('button', { name: '停止等待', exact: true }).click()
    await expect(card.getByText('原请求的结果和费用待核对。系统不会再次发送；可明确结束本次复盘，保留原记录。', { exact: true })).toBeVisible()
    release()
    await expect(card.getByRole('button', { name: '继续原复盘请求', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '结束本轮主持，准备下一次行动', exact: true })).toHaveCount(0)
    await card.getByRole('button', { name: '结束本次复盘', exact: true }).click()
    await expect(card.getByRole('button', { name: '请求 AI 阶段复盘', exact: true })).toBeEnabled()
    await page.reload(); await player(page); card = await panel(page)
    await expect(card.getByText('原请求的结果和费用待核对。系统不会再次发送；可明确结束本次复盘，保留原记录。', { exact: true })).toBeVisible()
    expect(sends).toBe(1)
  } finally { release() }
})
