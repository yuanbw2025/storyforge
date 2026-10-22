import { expect, test, type Page } from '@playwright/test'

const endpoint = 'https://hosting-test.invalid/v1/chat/completions'
const companion = JSON.stringify({ goal: '观察港口', method: '调查', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
const kp = JSON.stringify({ paragraphs: [{ text: '你们看清了本次行动留下的结果。', sourceKeys: ['action.receipt'] }] })
/** Real UI/formal entry/network client/native DB with intercepted fixture responses; no live provider. */
async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://hosting-test.invalid/v1',
      model: 'isolated-hosting-test', apiKey: '', temperature: 0, maxTokens: 800, contextWindow: 65536 }))
  })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const fixture = await (await importer('/storyforge/tests/helpers/open-ttrpg-checks.ts')).setupChecksFixtureV1({ cooperative: true })
    return { scope: fixture.f.scope, sessionId: fixture.command.sessionId, viewerKey: fixture.command.viewerKey }
  })
  await page.goto(`./play/session/${f.sessionId}`)
  await page.getByLabel('我的角色', { exact: true }).selectOption(f.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  return f
}
async function begin(page: Page) {
  await page.getByRole('checkbox', { name: '我委托本轮有限主持，保留随时停止和亲自确认风险的决定权。', exact: true }).check()
  await page.getByRole('button', { name: '委托本轮自动主持', exact: true }).click()
}
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated experimental preview required'))

test('one explicit UI delegation completes original action and two safe companions and reloads at the same budget', async ({ page }) => {
  test.setTimeout(process.env.CI ? 240000 : 180000)
  let requests = 0
  await page.route(endpoint, async route => {
    requests++
    const body = route.request().postDataJSON()
    const text = body.messages.some((m: { content: string }) => m.content.includes('storyforge.ttrpg-open-kp-contract')) ? kp : companion
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: text } }] }) })
  })
  const f = await setup(page)
  await begin(page)
  await expect(page.getByRole('button', { name: '继续本轮自动主持', exact: true })).toBeEnabled({ timeout: process.env.CI ? 180000 : 120000 })
  const candidateIssues = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'), { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const calls = (await api.readProductRuntimeState(f.sessionId)).ttrpg.openRun.coordination.calls
    const runs = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).toArray(), rows = []
    for (const call of calls) {
      const owner = runs.find((r: any) => r.contractHash === call.runContractHash)
      const candidate = await api.recoverTtrpgOpenRuntimeCandidateV1({ ...f, runId: owner.id, requestKey: call.requestKey })
      if (candidate?.artifact.status === 'blocked') rows.push({ requestKey: call.requestKey, reservedInputTokens: call.reservedInputTokens,
        usage: call.usage, issues: candidate.artifact.issues.filter((i: any) => i.disposition === 'blocking') })
    }
    return rows
  }, f)
  expect(candidateIssues).toEqual([])
  await expect(page.getByText('本轮已到预算或队友行动上限，交回真人。', { exact: true })).toBeVisible()
  expect(requests).toBe(5)
  const state = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(f.sessionId)
  }, f)
  expect(state.ttrpg.openRun.operations.map((o: any) => o.status)).toEqual(['completed', 'completed', 'completed'])
  expect(state.ttrpg.openRun.narrations).toHaveLength(3); expect(state.ttrpg.openRun.worldTime.worldTurn).toBe(3)
  expect(state.ttrpg.openRun.coordination.epochs).toHaveLength(1)
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption(f.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await page.getByRole('button', { name: '继续本轮自动主持', exact: true }).click()
  await expect(page.getByText('本轮已到预算或队友行动上限，交回真人。', { exact: true })).toBeVisible()
  expect(requests).toBe(5)
})

test('stop stays available during a dispatched UI request and persists before local abort and reload', async ({ page }) => {
  test.setTimeout(120000)
  let requests = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(endpoint, async route => {
    requests++
    await gate
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: kp } }] }) }).catch(() => {})
  })
  const f = await setup(page)
  await begin(page)
  await expect(page.getByRole('button', { name: '停止本轮自动主持', exact: true })).toBeEnabled()
  await expect.poll(() => requests, { timeout: 30000 }).toBe(1)
  await expect(page.getByRole('button', { name: '停止本轮自动主持', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '停止本轮自动主持', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '本轮自动主持已停止' }).first()).toBeVisible()
  release()
  await expect.poll(async () => page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const state = await (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(f.sessionId)
    return state.ttrpg.openRun.coordination.calls[0].status
  }, f)).toBe('unknown')
  const stopOrder = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const run = (await (await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')).readProductRuntimeState(f.sessionId)).ttrpg.openRun
    return { stoppedAt: run.coordination.epochs[0].hostingDelegation.stoppedRef.sequence, terminalAt: run.coordination.calls[0].terminalRef.sequence }
  }, f)
  expect(stopOrder.stoppedAt).toBeLessThan(stopOrder.terminalAt)
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption(f.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续本轮自动主持', exact: true })).toHaveCount(0)
  await expect(page.getByText('本轮自动主持已停止。可继续处理已保存的进度；新的自动主持需要明确开始下一轮。', { exact: true })).toBeVisible()
  expect(requests).toBe(1)
})


test('author production and local release lead to a real player action and one bounded UI delegation', async ({ page }) => {
  test.setTimeout(240000)
  let requests = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://hosting-test.invalid/v1',
      model: 'isolated-hosting-test', apiKey: '', temperature: 0, maxTokens: 800, contextWindow: 65536 }))
  })
  await page.route(endpoint, async route => {
    requests++
    const body = route.request().postDataJSON()
    const text = body.messages.some((m: { content: string }) => m.content.includes('storyforge.ttrpg-open-kp-contract')) ? kp : companion
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: text } }] }) })
  })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
    const f = await helper.seedOpenBrowserProductionV1({ cooperative: true })
    await helper.runOpenBrowserProductionV1(f); await helper.runOpenBrowserProductionV1(f, true); await helper.runOpenBrowserProductionV1(f, true)
    return f
  })
  await page.goto(`./ttrpg/release?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  const optIn = page.getByRole('button', { name: '启用本作品的自动制作', exact: true })
  if (await optIn.count()) await optIn.click()
  await page.getByRole('button', { name: '复验并原子发布', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/play/, { timeout: 20000 })
  await page.getByRole('button', { name: /· v1 开新团/ }).click()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('checkbox', { name: '我已了解安全约定和 AI 身份，并确认这是我的角色。', exact: true }).check()
  await page.getByRole('checkbox', { name: '允许 AI 根据我的角色资料提供行动建议。', exact: true }).check()
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await page.getByRole('checkbox', { name: '我确认以上约定，开始这场冒险。', exact: true }).check()
  await page.getByRole('button', { name: '开始冒险', exact: true }).click()
  await page.getByLabel('行动意图', { exact: true }).fill('观察港口，调查眼前线索。')
  await page.getByRole('button', { name: '请 KP 整理行动意图', exact: true }).click()
  await page.getByRole('button', { name: '确认这份行动意图', exact: true }).click()
  await page.getByRole('button', { name: '同意以上风险与代价', exact: true }).click()
  await begin(page)
  await expect(page.getByRole('button', { name: '继续本轮自动主持', exact: true })).toBeEnabled({ timeout: process.env.CI ? 180000 : 120000 })
  await expect(page.getByText('本轮已到预算或队友行动上限，交回真人。', { exact: true })).toBeVisible()
  const saved = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const release = await db.productReleases.where('workId').equals(f.scope.workId).first()
    const session = await db.productRuntimeSessions.where('productReleaseId').equals(release.id).first()
    return { release, session, state: await api.readProductRuntimeState(session.id) }
  }, f)
  expect(saved.session.productBuildId).toBeNull()
  expect(saved.state.ttrpg.openRun.operations.map((o: any) => o.status)).toEqual(['completed', 'completed', 'completed'])
  expect(saved.state.ttrpg.openRun.narrations).toHaveLength(3); expect(saved.state.ttrpg.openRun.worldTime.worldTurn).toBe(3)
  expect(saved.state.ttrpg.openRun.coordination.calls).toHaveLength(6); expect(requests).toBe(6)
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  // Reload revalidates the retained three operations and six original model receipts.
  // Wait for that read-only restore, retaining the exact control and no-extra-send check.
  await expect(page.getByRole('button', { name: '继续本轮自动主持', exact: true })).toBeVisible({ timeout: 30000 })
  expect(requests).toBe(6)
})
