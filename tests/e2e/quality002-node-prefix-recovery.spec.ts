import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { serialize } from 'node:v8'
import { openLongformLeaf } from './helpers/longform-navigation'

type Tables = Record<string, unknown[]>
type Mode = 'failed' | 'paused'
const states = new WeakMap<BrowserContext, { blocked: string[]; errors: string[]; requests: string[]; raw: string[] }>()

test.use({ serviceWorkers: 'block', trace: 'on' })
test.beforeEach(async ({ context, page }, info) => {
  const base = info.project.use.baseURL
  if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('Isolated loopback context required')
  const origin = new URL(base).origin
  const state = { blocked: [] as string[], errors: [] as string[], requests: [] as string[], raw: [] as string[] }
  states.set(context, state)
  page.on('pageerror', error => state.errors.push(error.message))
  await context.addInitScript((allowedOrigin: string) => {
    if (location.origin !== allowedOrigin) return
    localStorage.setItem('storyforge_guide_completed', 'quality002-prefix-isolated')
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('quality002-prefix-isolated', { create: true }) })
  }, origin)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && url.pathname === '/storyforge/quality002-model/v1/chat/completions' && request.method() === 'POST') {
      const index = state.requests.length
      state.requests.push(request.postData() ?? '')
      if (index >= 3) {
        state.blocked.push('Unexpected fourth model request')
        await route.abort('blockedbyclient'); return
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{
        message: { content: state.raw[index] ?? 'BROKEN_COMPLETE_THIRD_SLOT_e\u0301🌙' }, finish_reason: 'stop',
      }], usage: { prompt_tokens: 17 + index, completion_tokens: 9 + index, total_tokens: 26 + 2 * index } }) })
    } else if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      state.blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url())
    if (`${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}` !== origin) {
      state.blocked.push(`WEBSOCKET ${url.origin}${url.pathname}`)
      socket.close({ code: 1008, reason: 'Only isolated local server authorized' })
    } else socket.connectToServer()
  })
})
test.afterEach(async ({ context }, info) => {
  const state = states.get(context)!
  await info.attach('002-network-and-errors', { contentType: 'application/json', body: JSON.stringify({ ...state, realModelCalls: 0 }) })
  expect(state.blocked).toEqual([]); expect(state.errors).toEqual([])
})

async function snapshot(page: Page): Promise<{ tables: Tables; storage: Record<string, string | null> }> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const tables: Tables = {}
    for (const table of db.tables) tables[table.name] = await table.toArray()
    return { tables, storage: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])) }
  })
}

async function prepare(page: Page, mode: Mode) {
  await page.goto('./long?module=outline')
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByLabel('新长篇名称').fill(`002 ${mode} 已付双版本恢复`)
  await page.getByRole('button', { name: '选择项目文件夹', exact: true }).click()
  await expect(page.getByText(/已选择：/)).toBeVisible()
  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  return page.evaluate(async mode => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const Dexie = db.constructor as typeof import('dexie').default
    const { useProjectStore } = await load('/storyforge/src/stores/project.ts') as typeof import('../../src/stores/project')
    const { resolveScopeLike } = await load('/storyforge/src/lib/workspace/scope.ts') as typeof import('../../src/lib/workspace/scope')
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts') as typeof import('../../src/stores/ai-config')
    const { useWorldviewStore } = await load('/storyforge/src/stores/worldview.ts') as typeof import('../../src/stores/worldview')
    const { useNodeFlowStore } = await load('/storyforge/src/stores/node-flow.ts') as typeof import('../../src/stores/node-flow')
    const { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } = await load('/storyforge/src/lib/node-authoring/catalog.ts') as typeof import('../../src/lib/node-authoring/catalog')
    const { emptyAuthoringGraph } = await load('/storyforge/src/lib/node-authoring/contracts.ts') as typeof import('../../src/lib/node-authoring/contracts')
    const { runAuthoringGraph, reviseAuthoringCandidate } = await load('/storyforge/src/lib/node-authoring/executor.ts') as typeof import('../../src/lib/node-authoring/executor')
    const { readAgentRunV1 } = await load('/storyforge/src/lib/agent/run/event-store.ts') as typeof import('../../src/lib/agent/run/event-store')
    const { readLatestVerifiedAgentRunCheckpointV1 } = await load('/storyforge/src/lib/agent/run/checkpoint.ts') as typeof import('../../src/lib/agent/run/checkpoint')
    if (!navigator.locks?.request) throw new Error('FIXTURE_READINESS: actual Chromium Web Locks required')
    const projectId = useProjectStore.getState().currentProjectId
    if (projectId == null) throw new Error('FIXTURE_READINESS: real wizard Project missing')
    const scope = await resolveScopeLike(projectId)
    useAIConfigStore.getState().setConfig({ provider: 'custom', apiKey: 'synthetic-node-prefix-e2e', model: 'isolated-node-model',
      baseUrl: `${location.origin}/storyforge/quality002-model/v1`, temperature: .5, maxTokens: 8_000, contextWindow: 128_000 })
    await useWorldviewStore.getState().loadAll(scope, null)
    await useWorldviewStore.getState().saveWorldview({ projectId, worldGroupId: null,
      worldOrigin: '原作品世界起源，恢复保存结果不能改写。' }, scope)
    await useWorldviewStore.getState().saveStoryCore({ projectId, theme: '原主题', centralConflict: '原冲突', plotPattern: '线性' }, scope)
    const template = AUTHORING_NODE_BY_ID.get(mode === 'failed' ? 'world.origin' : 'story.theme')
    if (!template) throw new Error('FIXTURE_READINESS: registered field template missing')
    const flowId = await useNodeFlowStore.getState().createFlow(projectId, null, { name: '002 双版本只读恢复', graph: {
      ...emptyAuthoringGraph(), nodes: [{ id: 'field', templateId: template.id, templateVersion: 1, title: template.label, x: 30, y: 30,
        config: { ...defaultConfigForTemplate(template), candidateCount: 3 }, inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }],
    } })
    const flow = await db.nodeFlows.get(flowId)
    if (!flow) throw new Error('FIXTURE_READINESS: real public Flow missing')
    const tables = async () => {
      const rows: Tables = {}; for (const table of db.tables) rows[table.name] = await table.toArray(); return rows
    }
    const beforeGenerate = await tables(), controller = new AbortController()
    const commits: { runId: number; stores: string[]; committed: boolean }[] = []
    const onCandidate = (_key: unknown, event: { type: string; runId: number }) => {
      if (event.type !== 'candidate.persisted') return
      const tx = Dexie.currentTransaction
      if (!tx?.idbtrans || tx.idbtrans.mode !== 'readwrite') throw new Error('FIXTURE_READINESS: actual native RW commit required')
      const entry = { runId: event.runId, stores: [...tx.idbtrans.objectStoreNames], committed: false }
      commits.push(entry)
      tx.on('complete', () => { entry.committed = true; if (mode === 'paused' && commits.length === 2) controller.abort('paused') })
    }
    db.agentRunEvents.hook('creating', onCandidate)
    let result: Awaited<ReturnType<typeof runAuthoringGraph>>
    try { result = await runAuthoringGraph({ flow, signal: controller.signal }) }
    finally { db.agentRunEvents.hook('creating').unsubscribe(onCandidate) }
    const producers = await db.agentRuns.filter(row => row.nodeRunId === result.run.id).sortBy('nodeProducerVariantIndex')
    const readers = []
    for (const producer of producers) readers.push({ producer, view: await readAgentRunV1(scope, producer.id!),
      checkpoint: await readLatestVerifiedAgentRunCheckpointV1(scope, producer.id!) })
    const afterGenerate = await tables()
    const authorDraft = '作者原来保存的主稿；查看第二版本也不能覆盖这段文字 e\u0301🌙。'
    // Native public Node draft revision prepares a saved author draft/choice;
    // it does not emit a formal confirmation, adoption or validation event.
    const revised = await reviseAuthoringCandidate({ flow, runId: result.run.id!, nodeId: 'field', selectedVariantIndex: 1, output: authorDraft })
    return { scope, flowId, templateId: template.id, run: result.run, candidate: JSON.parse(revised.nodeResultsJson).field,
      readers, commits, aborted: controller.signal.aborted, authorDraft, beforeGenerate, afterGenerate }
  }, mode)
}

for (const mode of ['failed', 'paused'] as const) test(`saved ${mode} two-slot prefix survives reload and readonly version inspection without sending`, async ({ page, context }, info) => {
  const state = states.get(context)!
  const field = mode === 'failed' ? 'worldOrigin' : 'theme'
  state.raw = [1, 2].map(index => '\r\n  ' + JSON.stringify({ field, value: `封存第${index}版本：测潮人必须为打开古城的决定承担代价 e\u0301🌙。` }, null, 3) + '\n\t ')
  const fixture = await prepare(page, mode)
  await info.attach('002-native-generation', { contentType: 'application/octet-stream', body: serialize(fixture) })
  expect(fixture.run.status).toBe(mode)
  expect(fixture.candidate.creativeArtifacts.map((value: { callEvidence: { totalTokens: number | null }[] }) => value.callEvidence[0]?.totalTokens)).toEqual([26, 28])
  expect(fixture.commits).toHaveLength(2); expect(fixture.commits.every(entry => entry.committed)).toBe(true)
  expect(fixture.aborted).toBe(mode === 'paused')
  expect(state.requests).toHaveLength(mode === 'failed' ? 3 : 2)
  for (const value of fixture.readers.slice(0, 2)) {
    expect(value.view.projection.state).toBe('awaiting_confirmation'); expect(value.checkpoint).not.toBeNull()
  }
  const operational = new Set(['nodeRuns', 'agentRuns', 'agentRunEvents', 'agentRunArtifacts', 'agentRunCheckpoints', 'aiUsageLog'])
  for (const name of Object.keys(fixture.beforeGenerate)) if (!operational.has(name)) expect(fixture.afterGenerate[name], name).toEqual(fixture.beforeGenerate[name])
  await openLongformLeaf(page, '节点模式'); await page.reload()
  await expect(page.getByLabel('节点图名称')).toHaveValue('002 双版本只读恢复')
  await page.locator(`[data-authoring-node-template="${fixture.templateId}"]`).click()
  const textarea = page.getByLabel('候选输出'), select = page.getByLabel('选择候选版本')
  await expect(textarea).toHaveValue(fixture.authorDraft)
  // Node selection deliberately saves lastOpenedAt. Establish the native
  // commit + existing visible saved state before the zero-write view window.
  await expect.poll(async () => page.evaluate(async flowId => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const stored = await db.nodeFlows.get(flowId)
    const graph = JSON.parse(stored?.graphJson ?? '{}') as { nodes?: { id: string; lastOpenedAt?: number }[] }
    return graph.nodes?.find(value => value.id === 'field')?.lastOpenedAt ?? 0
  }, fixture.flowId)).toBeGreaterThan(0)
  await expect(page.locator('.node-workspace-header > span')).toHaveText('已保存')
  const beforeRecovery = await snapshot(page), sends = state.requests.length
  await page.getByRole('button', { name: '恢复已保存结果', exact: true }).click()
  await expect(page.getByText('已恢复保存的结果；没有重新调用模型。', { exact: true })).toBeVisible()
  const afterRecovery = await snapshot(page)
  for (const name of Object.keys(beforeRecovery.tables)) if (name !== 'nodeRuns') expect(afterRecovery.tables[name], name).toEqual(beforeRecovery.tables[name])
  await expect(textarea).toHaveValue(fixture.authorDraft); await expect(textarea).toHaveAttribute('readonly', '')
  await expect(select).toHaveValue('1'); await expect(select).toBeDisabled()
  await expect(page.getByRole('button', { name: '只读核对', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '拒绝候选', exact: true })).toBeDisabled()
  await expect(page.getByText('已保存候选只读核对；来源是否仍有效尚未核验，未写入作品。', { exact: true })).toBeVisible()
  await expect(page.getByText(/点击“本地校验并采纳”/)).toHaveCount(0)
  const beforeView = await snapshot(page)
  await page.getByText('展开原始候选对照（2 个版本）', { exact: true }).click()
  for (let index = 0; index < 2; index++) {
    const article = page.getByRole('article', { name: `封存候选版本 ${index + 1}，只读`, exact: true })
    await expect(article.locator('pre')).toBeVisible()
    expect(await article.locator('pre').textContent()).toBe(fixture.candidate.variants[index])
    await expect(article.getByRole('region', { name: '创作产物状态', exact: true })).toContainText(`1 次模型调用 · ${26 + 2 * index} tokens`)
    await expect(article.getByText('当前只读；以下为该版本的原封存产物证据。', { exact: true })).toBeVisible()
  }
  const summaries = page.getByRole('region', { name: '创作产物状态', exact: true })
  await expect(summaries).toHaveCount(3)
  for (const summary of await summaries.all()) {
    await expect(summary.locator('strong')).toHaveText('已保存，仅供核对')
    await expect(summary).not.toContainText('可直接采纳')
  }
  const afterView = await snapshot(page)
  await info.attach('002-full-native-recovery-and-view', { contentType: 'application/octet-stream', body: serialize({ beforeRecovery, afterRecovery, beforeView, afterView }) })
  expect(afterView).toEqual(beforeView)
  await expect(textarea).toHaveValue(fixture.authorDraft); await expect(select).toHaveValue('1')
  expect(state.requests).toHaveLength(sends)
})
