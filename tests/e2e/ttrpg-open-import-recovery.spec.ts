import { expect, test, type Page } from '@playwright/test'
const endpoint = 'https://import-recovery.invalid/v1/chat/completions'
async function setup(page: Page, unknown = false) {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://import-recovery.invalid/v1',
    model: 'isolated-import-recovery', apiKey: '', temperature: 0, maxTokens: 800, contextWindow: 65536 })))
  await page.goto('./')
  const copy = await page.evaluate(async unknown => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const h = await importer('/storyforge/tests/helpers/open-ttrpg-portability.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const io = await importer('/storyforge/src/lib/export/json-export.ts'), { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const table = await importer('/storyforge/src/lib/ttrpg/open-table-service.ts'), env = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const f = await h.preparePortableOpenRequestV1('跨本机编号恢复', undefined, async (ready: any) => {
      await table.startTtrpgOpenTableV1({ scope: ready.scope, sessionId: ready.sessionId, viewerKey: env.OPEN_HUMAN_VIEWER, acceptedItemKeys: [] })
    })
    if (unknown) {
      const request = { runId: f.prepared.runId, requestKey: f.prepared.requestKey, viewerKey: f.input.viewerKey }
      await api.dispatchTtrpgOpenModelCallV1({ ...await env.openEnvelopeV1(f.sessionId, 'import.dispatch'), ...request })
      await api.finishTtrpgOpenModelCallV1({ ...await env.openEnvelopeV1(f.sessionId, 'import.unknown'), ...request, status: 'unknown', responseArtifactHash: null,
        terminalReason: 'simulated-unknown-transport', usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null } })
    }
    const original = await api.readProductRuntimeState(f.sessionId), projectId = await io.importProjectJSON(await io.exportProjectJSON(f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    if (session.id === f.sessionId) throw new Error('native test did not collide local IDs')
    return { sessionId: session.id, originalSessionId: f.sessionId, original, viewerKey: f.input.viewerKey, requestKey: f.prepared.requestKey }
  }, unknown)
  await page.goto(`./play/session/${copy.sessionId}`)
  await page.getByLabel('我的角色', { exact: true }).selectOption(copy.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  return copy
}
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated experimental preview required'))
test('native import retains historical evidence, explicitly cancels unsent work and sends only a newly authorized request', async ({ page }, testInfo) => {
  test.setTimeout(120000)
  let sends = 0
  await page.route(endpoint, async route => { sends++; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content:
    JSON.stringify({ goal: '调查河港', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) } }] }) }) })
  const f = await setup(page)
  expect(sends).toBe(0)
  await page.getByRole('button', { name: '查看最近一次上下文记录', exact: true }).click()
  await expect(page.getByLabel('实际上下文记录')).toContainText('这是导入前的原始记录')
  await page.getByLabel('实际上下文记录').screenshot({ path: testInfo.outputPath('imported-context.png') })
  await page.getByRole('button', { name: '取消尚未发送的请求', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消尚未发送的请求', exact: true })).toHaveCount(0)
  expect(sends).toBe(0)
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption(f.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await page.getByRole('button', { name: '结束本轮主持，准备下一次行动', exact: true }).click()
  await page.getByLabel('行动意图', { exact: true }).fill('调查河港')
  await page.getByRole('button', { name: '请 KP 整理行动意图', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认这份行动意图', exact: true })).toBeVisible({ timeout: 30000 })
  expect(sends).toBe(1)
  const result = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    return { original: await api.readProductRuntimeState(f.originalSessionId), copy: await api.readProductRuntimeState(f.sessionId) }
  }, f)
  expect(result.original).toEqual(f.original)
  expect(result.copy.ttrpg.openRun.coordination.calls.map((call: any) => call.status)).toEqual(['failed', 'succeeded'])
  expect(result.copy.ttrpg.openRun.coordination.calls[0].dispatchRef).toBeNull()
})
test('native import keeps unknown transport visible and offers no unsent-cancellation shortcut', async ({ page }) => {
  let sends = 0
  await page.route(endpoint, async route => { sends++; await route.abort() })
  const f = await setup(page, true)
  await expect(page.getByText(/发送结果未知，请先核对原请求/)).toBeVisible()
  await expect(page.getByRole('button', { name: '取消尚未发送的请求', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('行动意图', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '查看最近一次上下文记录', exact: true }).click()
  await expect(page.getByLabel('实际上下文记录')).toContainText('这是导入前的原始记录')
  expect(sends).toBe(0)
  const status = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(f.sessionId)).ttrpg.openRun.coordination.calls[0].status
  }, f)
  expect(status).toBe('unknown')
})
