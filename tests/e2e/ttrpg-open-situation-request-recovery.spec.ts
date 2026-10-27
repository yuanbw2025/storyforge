import { test, expect, type Page } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
async function enter(page: Page) {
  await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
  await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
  await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  const desk = page.getByTestId('ttrpg-open-situation-desk')
  await expect(desk).toBeVisible(); await desk.locator('summary').first().click()
  return desk
}
test('a reload after the persisted dispatch cutpoint offers an explicit unknown close with zero transport or replacement requests', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const f = await (await importer('/storyforge/tests/helpers/open-situation-generation.ts')).setupSituationGenerationV1(true)
    const prepared = await (await importer('/storyforge/src/lib/ttrpg/open-intent-input.ts')).prepareTtrpgOpenSituationInputV1({ ...f.request, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const id = { ...f.input, runId: prepared.runId, requestKey: prepared.requestKey }
    const envelope = await (await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')).openEnvelopeV1(id.sessionId, 'native.persisted.dispatch.cut')
    // Engineering crash cutpoint: actual persisted dispatch, intentionally no transport executor.
    await (await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')).dispatchTtrpgOpenModelCallV1({ ...envelope, ...id })
    return id
  })
  const requests: string[] = []
  page.on('request', request => { if (/\/v1\/(?:chat\/completions|responses)/.test(request.url())) requests.push(request.url()) })
  await page.reload(); await page.goto('./play/session/' + f.sessionId)
  const desk = await enter(page)
  await expect(desk.getByRole('button', { name: '继续原局势请求', exact: true })).toHaveCount(0)
  await desk.getByRole('button', { name: '结束等待，保留未知结果与费用', exact: true }).click()
  await expect(desk.getByText('等待已结束，原请求的结果与费用仍按未知保留，未再次发送。', { exact: true })).toBeVisible()
  await desk.getByRole('button', { name: '读取局势拟定进度', exact: true }).click()
  const result = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const run = (await (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId)).ttrpg.openRun
    return { active: run.coordination.activeEpochKey, calls: run.coordination.calls.length, call: run.coordination.calls[0], turns: run.worldTime.worldTurn }
  }, f)
  expect(result).toMatchObject({ active: null, calls: 1, turns: 0, call: { requestKey: f.requestKey, status: 'unknown',
    usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null } } })
  expect(requests).toEqual([])
})
test('real GM UI restores the original raw reply after its model-event receipt was interrupted without a second endpoint call', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const f = await (await importer('/storyforge/tests/helpers/open-situation-generation.ts')).setupSituationGenerationV1(true)
    await (await importer('/storyforge/src/lib/ttrpg/open-generated-situation-stop.ts')).finishTtrpgOpenSituationDraftV1(f.input)
    const { useAIConfigStore } = await importer('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'custom', model: 'original-reply-repair', apiKey: 'test-only-key', baseUrl: 'https://ttrpg-original-reply.invalid/v1', maxTokens: 8000, contextWindow: 50000 })
    return f.input
  })
  let sends = 0
  await page.route('https://ttrpg-original-reply.invalid/v1/chat/completions', async route => {
    sends++
    const value = await page.evaluate(async f => {
      const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
      const kernel = await (await importer('/storyforge/src/lib/ttrpg/open-generated-situation-context.ts')).loadTtrpgOpenSituationKernelInputV1({ ...f, actorKey: 'gm' })
      return (await importer('/storyforge/tests/helpers/open-situation-generation.ts')).situationGenerationOutputV1(kernel.basis)
    }, f)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'isolated-original-reply', model: 'original-reply-repair',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } }) })
  })
  await page.goto('./play/session/' + f.sessionId)
  let desk = await enter(page)
  await desk.getByLabel('局势拟定要求', { exact: true }).fill('结合港口、守灯人和英雄身份拟定一个新局势')
  await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'), add = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async (row: any) => {
      if (row.type === 'model.responded') { db.agentRunEvents.add = add; throw new Error('fixture browser raw-before-model-event cut') }
      return add(row)
    }
  })
  await desk.getByRole('button', { name: '请求 AI 拟定局势', exact: true }).click()
  await expect(desk.getByRole('button', { name: '恢复原局势回答回执', exact: true })).toBeVisible({ timeout: 60000 })
  await expect(desk.getByRole('button', { name: '结束等待，保留未知结果与费用', exact: true })).toHaveCount(0)
  await desk.getByRole('button', { name: '恢复原局势回答回执', exact: true }).click()
  await expect(desk.getByRole('region', { name: '主持局势审阅', exact: true })).toBeVisible({ timeout: 60000 })
  await expect(desk.getByRole('button', { name: '确认披露并采用局势', exact: true })).toBeDisabled()
  expect(sends).toBe(1)
  await page.reload(); desk = await enter(page)
  await expect(desk.getByRole('region', { name: '主持局势审阅', exact: true })).toBeVisible()
  const result = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const run = (await (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.sessionId)).ttrpg.openRun
    return { calls: run.coordination.calls.length, call: run.coordination.calls[0], turns: run.worldTime.worldTurn }
  }, f)
  expect(result).toMatchObject({ calls: 1, turns: 0, call: { status: 'succeeded', usage: { source: 'estimated', actualCostUsd: null } } }); expect(sends).toBe(1)
})
