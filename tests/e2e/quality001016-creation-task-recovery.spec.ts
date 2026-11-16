import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import type { MotionDramaSeriesBibleV1, WorkspaceScope } from '../../src/lib/types'

type Medium = 'comic' | 'motion-drama'
interface Fixture {
  scope: WorkspaceScope
  runId: number | null
  unitKey: string
  bible: MotionDramaSeriesBibleV1
  syntheticCalls: number
}
const boundary = new WeakMap<BrowserContext, Array<{ method: string; origin: string; pathname: string }>>()
test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context }, info) => {
  const baseURL = info.project.use.baseURL
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('001/016 requires an isolated loopback app')
  const origin = new URL(baseURL).origin
  const blocked: Array<{ method: string; origin: string; pathname: string }> = []
  boundary.set(context, blocked)
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality001016-isolated'))
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push({ method: request.method(), origin: url.origin, pathname: url.pathname })
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
})
test.afterEach(async ({ context }, info) => {
  const blocked = boundary.get(context) ?? []
  await info.attach('001016-network-boundary', { contentType: 'application/json', body: JSON.stringify({
    blocked, actualExternalHTTPRequests: 0, realModelCalls: 0, profile: 'new ephemeral Playwright context',
  }) })
  expect(blocked).toEqual([])
})

const routeFor = (medium: Medium, workId: number) => `./${medium === 'comic' ? 'comic/facts' : 'motion/series'}?work=${workId}`
const taskId = (medium: Medium, runId: number) => `${medium === 'comic' ? 'comic' : 'motion'}-task-${runId}`

async function openApp(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible({ timeout: 20_000 })
}

async function seed(page: Page, medium: Medium, outcome: 'failed' | 'unknown' | 'candidate' | 'none'): Promise<Fixture> {
  return page.evaluate(async ({ medium, outcome }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const fixtureModule = await importer('/storyforge/tests/helpers/quality001016-creation-fixtures.ts') as typeof import('../helpers/quality001016-creation-fixtures')
    const comic = await importer('/storyforge/src/lib/comic/durable-production.ts') as typeof import('../../src/lib/comic/durable-production')
    const motion = await importer('/storyforge/src/lib/motion-drama/durable-production.ts') as typeof import('../../src/lib/motion-drama/durable-production')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const item = await fixtureModule.createQualityCreationFixture(medium)
    let syntheticCalls = 0; let runId: number | null = null
    const content = JSON.stringify(medium === 'comic' ? [{ stableKey: 'fact_ticket', kind: 'event',
      statement: '合成浏览器候选：检票员决定调查异常车票。', subjectKeys: [], sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1,
    }] : fixtureModule.qualityMotionBible)
    if (outcome !== 'none') {
      const runAI = async () => {
        syntheticCalls += 1
        if (outcome === 'unknown') throw new Error('合成请求结果未知；本测试没有真实供应商调用。')
        return content
      }
      const onTaskCreated = (task: Readonly<{ runId: number; generation: number; lastSequence: number }>) => {
        runId = task.runId
        if (outcome === 'failed') throw new Error('合成运行通知后的准备失败；模型未调用。')
      }
      let failure: unknown
      try {
        if (medium === 'comic') await comic.generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!,
          stage: 'source-analysis', sourceUnitKeys: [item.unit.sourceUnitKey], runAI, onTaskCreated })
        else await motion.generateMotionDramaCandidateV1({ scope: item.scope, stage: 'series-bible', episodeNumber: 1, runAI, onTaskCreated })
      } catch (error) { failure = error }
      if (outcome === 'candidate') { if (failure) throw failure }
      else if (!(failure instanceof Error) || !failure.message.includes('合成')) throw failure ?? new Error('预期的合成故障没有发生')
      if (runId == null || !await db.agentRuns.get(runId)) throw new Error('实际 public Run 没有创建')
    }
    return { scope: item.scope, runId, unitKey: item.unit.sourceUnitKey, bible: fixtureModule.qualityMotionBible, syntheticCalls }
  }, { medium, outcome })
}

async function readRun(page: Page, fixture: Fixture) {
  if (fixture.runId == null) throw new Error('当前夹具没有实际 Run')
  return page.evaluate(async ({ scope, runId }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { readAgentRunV1 } = await importer('/storyforge/src/lib/agent/run/event-store.ts') as typeof import('../../src/lib/agent/run/event-store')
    return readAgentRunV1(scope, runId)
  }, { scope: fixture.scope, runId: fixture.runId })
}

async function readControls(page: Page, fixture: Fixture) {
  return page.evaluate(async ({ scope, runId }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { readOwnedRows } = await importer('/storyforge/src/lib/workspace/scope.ts') as typeof import('../../src/lib/workspace/scope')
    return (await readOwnedRows<import('../../src/lib/types').AgentEvent>(scope, 'agentEvents', { owner: 'work' }))
      .filter(row => row.kind === 'task' && row.durableRunId === runId)
  }, { scope: fixture.scope, runId: fixture.runId })
}

async function readAdoptedDomain(page: Page, medium: Medium, fixture: Fixture) {
  return page.evaluate(async ({ medium, scope }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    if (medium === 'comic') {
      const { getAdaptationForWork } = await importer('/storyforge/src/lib/adaptation/source-manifest.ts') as typeof import('../../src/lib/adaptation/source-manifest')
      const adaptation = await getAdaptationForWork(scope.workId)
      if (!adaptation?.id || adaptation.medium !== 'comic') throw new Error('漫画领域读取缺少实际改编根')
      const { listAdaptationAnalysisV1 } = await importer('/storyforge/src/lib/adaptation/analysis.ts') as typeof import('../../src/lib/adaptation/analysis')
      const analysis = await listAdaptationAnalysisV1({ scope, adaptationProjectId: adaptation.id, manifestVersion: adaptation.activeSourceManifestVersion })
      return { kind: 'comic' as const, adaptation, facts: analysis.facts }
    }
    const { loadMotionDramaStudioV1 } = await importer('/storyforge/src/lib/motion-drama/service.ts') as typeof import('../../src/lib/motion-drama/service')
    const snapshot = await loadMotionDramaStudioV1(scope)
    return { kind: 'motion-drama' as const, scope: snapshot.scope, adaptation: snapshot.adaptation,
      production: snapshot.production, bible: snapshot.seriesBibleRecord }
  }, { medium, scope: fixture.scope })
}

for (const medium of ['comic', 'motion-drama'] as const) {
  test(`${medium}: failed/unknown tasks remain visible after refresh and two pages stop the same unknown wait once`, async ({ page, context }) => {
    await openApp(page)
    const failed = await seed(page, medium, 'failed')
    expect(failed.syntheticCalls).toBe(0)
    const beforeFailed = await readRun(page, failed)
    await page.goto(routeFor(medium, failed.scope.workId))
    const failedTask = page.getByTestId(taskId(medium, failed.runId!))
    await expect(failedTask).toContainText('运行失败')
    await expect(failedTask).toContainText('合成运行通知后的准备失败')
    await failedTask.getByRole('button', { name: '查看运行证据', exact: true }).click()
    await expect(page.getByText('当前没有可核验的原响应正文。', { exact: false })).toBeVisible()
    await page.reload()
    await expect(page.getByTestId(taskId(medium, failed.runId!))).toContainText('运行失败')
    expect(await readRun(page, failed)).toEqual(beforeFailed)

    const unknown = await seed(page, medium, 'unknown')
    expect(unknown.syntheticCalls).toBe(1)
    const before = await readRun(page, unknown)
    const url = routeFor(medium, unknown.scope.workId)
    await page.goto(url)
    const second = await context.newPage()
    await second.goto(url)
    const firstTask = page.getByTestId(taskId(medium, unknown.runId!))
    const secondTask = second.getByTestId(taskId(medium, unknown.runId!))
    await expect(firstTask).toContainText('原请求结果未确认'); await expect(secondTask).toContainText('原请求结果未确认')
    await expect(firstTask.getByRole('button', { name: '停止等待', exact: true })).toBeEnabled()
    await expect(secondTask.getByRole('button', { name: '停止等待', exact: true })).toBeEnabled()
    await Promise.all([
      firstTask.getByRole('button', { name: '停止等待', exact: true }).evaluate(element => (element as HTMLButtonElement).click()),
      secondTask.getByRole('button', { name: '停止等待', exact: true }).evaluate(element => (element as HTMLButtonElement).click()),
    ])
    await expect(firstTask).toContainText('已停止等待'); await expect(secondTask).toContainText('已停止等待')
    const controls = await readControls(page, unknown)
    expect(controls).toHaveLength(1)
    expect(JSON.parse(controls[0].payload)).toMatchObject({ action: 'stop-waiting', generation: before.projection.generation })
    expect(await readRun(page, unknown)).toEqual(before)
    await Promise.all([page.reload(), second.reload()])
    await expect(page.getByTestId(taskId(medium, unknown.runId!))).toContainText('已停止等待')
    await expect(second.getByTestId(taskId(medium, unknown.runId!))).toContainText('已停止等待')
    expect(await readControls(page, unknown)).toEqual(controls)
    expect(await readRun(page, unknown)).toEqual(before)
    await second.close()
    await page.screenshot({ path: test.info().outputPath(`${medium}-unknown-stopped.png`), fullPage: true })
  })

  test(`${medium}: an actual generate click keeps an already sent synthetic response after stop-waiting`, async ({ page, context }, info) => {
    await openApp(page)
    const fixture = await seed(page, medium, 'none')
    await page.goto(routeFor(medium, fixture.scope.workId))
    if (medium === 'comic') {
      const source = page.getByRole('combobox', { name: '来源分析单元', exact: true })
      await expect(source.locator(`option[value="${fixture.unitKey}"]`)).toHaveCount(1)
      await source.selectOption(fixture.unitKey)
      await expect(source).toHaveValue(fixture.unitKey)
    }
    const baseURL = info.project.use.baseURL!
    const origin = new URL(baseURL).origin
    let release!: () => void
    const response = new Promise<void>(resolve => { release = resolve })
    let syntheticPOSTs = 0
    const marker = '浏览器真实按钮的合成晚到候选'
    const content = JSON.stringify(medium === 'comic' ? [{ stableKey: 'fact_browser_late', kind: 'event', statement: marker,
      subjectKeys: [], sourceUnitKeys: [fixture.unitKey], confidence: 1,
    }] : { ...fixture.bible, titlePromise: marker })
    // Registered last, this exact synthetic endpoint is fulfilled locally.
    // The general boundary continues to block every other HTTP write.
    await context.route(`${origin}/quality001016/v1/chat/completions`, async route => {
      expect(route.request().method()).toBe('POST'); syntheticPOSTs += 1
      await response
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 6, completion_tokens: 7, total_tokens: 13 },
      }) })
    })
    await page.evaluate(async baseUrl => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { useAIConfigStore } = await importer('/storyforge/src/stores/ai-config.ts') as typeof import('../../src/stores/ai-config')
      useAIConfigStore.getState().setConfig({ provider: 'custom', baseUrl, apiKey: '', model: 'quality-synthetic-model', temperature: 0, maxTokens: 1_024, contextWindow: 128_000 })
    }, `${origin}/quality001016/v1`)
    const generate = page.getByRole('button', { name: medium === 'comic' ? '来源事实' : '生成专业候选', exact: medium !== 'comic' })
    try {
      await expect(generate).toBeEnabled(); await generate.click()
      await expect.poll(() => syntheticPOSTs).toBe(1)
      fixture.runId = await page.evaluate(async scope => {
        const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
        const { readOwnedRows } = await importer('/storyforge/src/lib/workspace/scope.ts') as typeof import('../../src/lib/workspace/scope')
        const runs = await readOwnedRows<import('../../src/lib/types').AgentRunRecord>(scope, 'agentRuns', { owner: 'work' })
        if (runs.length !== 1 || !runs[0].id) throw new Error('实际按钮必须创建唯一 Run')
        return runs[0].id
      }, fixture.scope)
      const before = await readRun(page, fixture)
      const task = page.getByTestId(taskId(medium, fixture.runId))
      await expect(task).toContainText('已记录请求 1 次 / 返回 0 次')
      await task.getByRole('button', { name: '停止等待', exact: true }).click()
      await expect(task).toContainText('已停止等待')
      expect(await readRun(page, fixture)).toEqual(before)
    } finally { release() }
    const task = page.getByTestId(taskId(medium, fixture.runId!))
    await expect(task.getByRole('button', { name: '查看晚到候选', exact: true })).toBeEnabled()
    await expect(page.locator(medium === 'comic' ? '.comic-professional-candidate footer' : '.motion-candidate-backdrop .motion-candidate')).toHaveCount(0)
    await task.getByRole('button', { name: '查看晚到候选', exact: true }).click()
    if (medium === 'motion-drama') await expect(page.locator('textarea[aria-label="候选 JSON"]')).toHaveValue(new RegExp(marker))
    else await expect(page.locator('.comic-professional-candidate textarea').last()).toHaveValue(new RegExp(marker))
    expect((await readRun(page, fixture)).projection.state).toBe('awaiting_confirmation')
    expect(syntheticPOSTs).toBe(1)
    await info.attach('001016-synthetic-provider', { contentType: 'application/json', body: JSON.stringify({ syntheticPOSTs, actualProviderRequests: 0, realModelCalls: 0 }) })
  })

  test(`${medium}: an ordinary saved candidate is adopted only through its actual author control`, async ({ page }) => {
    await openApp(page)
    const fixture = await seed(page, medium, 'candidate')
    expect(fixture.syntheticCalls).toBe(1)
    const before = await readRun(page, fixture)
    await page.goto(routeFor(medium, fixture.scope.workId))
    const accept = page.getByRole('button', { name: medium === 'comic' ? '作者确认并采纳' : '确认写入', exact: true })
    await expect(accept).toBeEnabled()
    expect(await readRun(page, fixture)).toEqual(before)
    const beforeDomain = await readAdoptedDomain(page, medium, fixture)
    if (beforeDomain.kind === 'comic') expect(beforeDomain.facts).toEqual([])
    else expect(beforeDomain.bible).toBeNull()
    await accept.click()
    await expect.poll(async () => (await readRun(page, fixture)).projection.state).toBe('completed')
    const completed = await readRun(page, fixture)
    expect(completed.projection.terminalReceiptHash).toBeTruthy()
    const adopted = await readAdoptedDomain(page, medium, fixture)
    expect(adopted.adaptation).toMatchObject({ projectId: fixture.scope.projectId, worldId: fixture.scope.worldId,
      workId: fixture.scope.workId, medium })
    expect(adopted.adaptation.sourceWorkId).not.toBe(fixture.scope.workId)
    if (adopted.kind === 'comic') {
      expect(adopted.facts).toHaveLength(1)
      const fact = adopted.facts[0]
      expect({ stableKey: fact.stableKey, kind: fact.kind, statement: fact.statement,
        subjectKeys: fact.subjectKeys, sourceUnitKeys: fact.sourceUnitKeys, confidence: fact.confidence }).toEqual({
        stableKey: 'fact_ticket', kind: 'event', statement: '合成浏览器候选：检票员决定调查异常车票。',
        subjectKeys: [], sourceUnitKeys: [fixture.unitKey], confidence: 1,
      })
      expect(fact).toMatchObject({ projectId: fixture.scope.projectId, workId: fixture.scope.workId,
        adaptationProjectId: adopted.adaptation.id, manifestVersion: adopted.adaptation.activeSourceManifestVersion,
        authorStatus: 'confirmed' })
    } else {
      expect(adopted.scope).toEqual(fixture.scope)
      expect(adopted.production).toMatchObject({ projectId: fixture.scope.projectId, worldId: fixture.scope.worldId,
        workId: fixture.scope.workId, adaptationProjectId: adopted.adaptation.id })
      expect(adopted.bible).toMatchObject({ projectId: fixture.scope.projectId, workId: fixture.scope.workId,
        adaptationProjectId: adopted.adaptation.id, version: adopted.production.activeSeriesBibleVersion,
        sourceManifestVersion: adopted.adaptation.activeSourceManifestVersion })
      expect(adopted.bible?.bible).toEqual(fixture.bible)
      expect(adopted.bible?.contentHash).toMatch(/^[a-f0-9]{64}$/)
    }
    await page.reload()
    await expect(page.getByTestId(taskId(medium, fixture.runId!))).toContainText('已完成')
    expect(await readRun(page, fixture)).toEqual(completed)
    expect(await readAdoptedDomain(page, medium, fixture)).toEqual(adopted)
    await expect(page.getByRole('button', { name: medium === 'comic' ? '作者确认并采纳' : '确认写入', exact: true })).toHaveCount(0)
  })
}
