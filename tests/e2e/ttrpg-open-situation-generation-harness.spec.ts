import { test, expect } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
test('native formal entry preserves a private original candidate across reload and exposes only the fallback summary', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { setupSituationGenerationV1 } = await importer('/storyforge/tests/helpers/open-situation-generation.ts')
    const f = await setupSituationGenerationV1()
    return { request: f.request, value: f.value, input: f.input, assignedTemplateKey: f.kernel.basis.assignedTemplateKey, worldTurn: f.kernel.context.frame.worldTurn }
  })
  const sends: string[] = []
  await page.route('https://ttrpg-situation.invalid/v1/chat/completions', async route => {
    sends.push(route.request().postData() ?? '')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'isolated-situation-response', model: 'situation-browser',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(f.value) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } }) })
  })
  const result = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { generateTtrpgOpenSituationCandidateV1 } = await importer('/storyforge/src/lib/ttrpg/open-intent-harness.ts')
    return generateTtrpgOpenSituationCandidateV1({ ...f.request, aiConfig: { provider: 'custom', model: 'situation-browser', apiKey: 'test-only-key',
      baseUrl: 'https://ttrpg-situation.invalid/v1', maxTokens: 4000, contextWindow: 50000 } })
  }, f)
  expect(result.status).toBe('candidate')
  if (result.status !== 'candidate') throw new Error('candidate required')
  expect(result.summary.status).toBe('usable-with-warnings'); expect(JSON.stringify(result)).not.toContain('PRIVATE-')
  expect(sends).toHaveLength(1); expect(sends[0]).toContain('PRIVATE-GM-SITUATION-SOURCE'); expect(sends[0]).toContain('outputJsonSchema')
  await page.reload()
  const restored = await page.evaluate(async ({ input, summary }) => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const read = { ...input, runId: summary.runId, requestKey: summary.requestKey }
    const recovered = await api.recoverTtrpgOpenSituationCandidateV1(read)
    let privateDenied = false
    try { await api.readTtrpgOpenSituationCandidateV1(read) } catch { privateDenied = true }
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const state = await readProductRuntimeState(input.sessionId)
    return { recovered, privateDenied, calls: state.ttrpg.openRun.coordination.calls.length, worldTurn: state.ttrpg.openRun.worldTime.worldTurn,
      activeTemplates: state.ttrpg.openRun.situations.active.map((s: any) => s.templateKey) }
  }, { input: f.input, summary: result.summary })
  expect(restored.recovered).toEqual(result.summary); expect(restored.privateDenied).toBe(true); expect(restored.calls).toBe(1)
  expect(restored.activeTemplates).not.toContain(f.assignedTemplateKey); expect(restored.worldTurn).toBe(f.worldTurn)
  expect(sends).toHaveLength(1)
  await page.goto('./play/session/' + f.input.sessionId)
  await expect(page.getByLabel('我的角色', { exact: true })).toBeVisible()
  await page.getByLabel('我的角色', { exact: true }).selectOption(f.input.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByText('当前正在拟定新局势', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('PRIVATE-GM-SITUATION-SOURCE')
  await expect(page.locator('body')).not.toContainText('PRIVATE-GENERATED-SITUATION-GOAL')
  const desk = page.getByTestId('ttrpg-open-situation-desk')
  await desk.locator('summary').first().click()
  await expect(desk).not.toContainText('PRIVATE-GENERATED-SITUATION-GOAL')
  await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'), add = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async () => { db.agentRunEvents.add = add; throw new Error('fixture situation stop cleanup interruption') }
  })
  await desk.getByRole('button', { name: '取消本次局势拟定', exact: true }).click()
  await expect(desk.getByRole('button', { name: '补齐局势拟定结束记录', exact: true })).toBeVisible()
  await desk.getByRole('button', { name: '补齐局势拟定结束记录', exact: true }).click()
  await expect(desk.getByText('局势拟定的结束记录已补齐。', { exact: true })).toBeVisible()
  const stopped = await page.evaluate(async ({ input, summary }) => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { readTtrpgOpenSituationCandidateSummaryV1 } = await importer('/storyforge/src/lib/ttrpg/open-generated-situation-candidate.ts')
    const { readInstanceAgentRunV1 } = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    return { summary: await readTtrpgOpenSituationCandidateSummaryV1({ ...input, runId: summary.runId, requestKey: summary.requestKey }),
      state: (await readInstanceAgentRunV1(input.scope, summary.runId)).projection.state }
  }, { input: f.input, summary: result.summary })
  expect(stopped.state).toBe('cancelled'); expect(stopped.summary.stopped).toBe(true); expect(sends).toHaveLength(1)
})
