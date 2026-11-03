import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { serialize } from 'node:v8'
import type { NodeRunRecord } from '../../src/lib/types'
import { openLongformLeaf } from './helpers/longform-navigation'

type Family = 'world' | 'story'
type Tables = Record<string, unknown[]>
const states = new WeakMap<BrowserContext, { requests: string[]; blocked: string[]; errors: string[]; field: string }>()
test.use({ serviceWorkers: 'block', trace: 'on' })
test.beforeEach(async ({ context, page }, info) => {
  const base = info.project.use.baseURL
  if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('Isolated loopback browser required')
  const origin = new URL(base).origin, state = { requests: [] as string[], blocked: [] as string[], errors: [] as string[], field: '' }
  states.set(context, state); page.on('pageerror', error => state.errors.push(error.message))
  await context.addInitScript((allowedOrigin: string) => {
    if (location.origin !== allowedOrigin) return
    localStorage.setItem('storyforge_guide_completed', 'quality002-adoption-isolated')
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('quality002-adoption-isolated', { create: true }) })
  }, origin)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && url.pathname === '/storyforge/quality002-adoption-model/v1/chat/completions' && request.method() === 'POST') {
      const index = state.requests.length; state.requests.push(request.postData() ?? '')
      if (index >= 2) { state.blocked.push('Unexpected paid request resend'); await route.abort('blockedbyclient'); return }
      const raw = '\r\n  ' + JSON.stringify({ field: state.field, value: `封存版本${index + 1} e\u0301🌙：渡海者必须兑现旧约。` }, null, 3) + '\n\t '
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 17 + index, completion_tokens: 9 + index, total_tokens: 26 + 2 * index } }) })
    } else if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      state.blocked.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url())
    if (`${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}` !== origin) {
      state.blocked.push(`WEBSOCKET ${url.origin}${url.pathname}`); socket.close({ code: 1008, reason: 'Only isolated local server authorized' })
    } else socket.connectToServer()
  })
})
test.afterEach(async ({ context }, info) => {
  const state = states.get(context)!
  await info.attach('002-author-network', { contentType: 'application/json', body: JSON.stringify({ ...state, realModelCalls: 0 }) })
  expect(state.blocked).toEqual([]); expect(state.errors).toEqual([])
})

async function prepare(page: Page, family: Family) {
  await page.goto('./long?module=outline')
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByLabel('新长篇名称').fill(`002 ${family} 作者正式采纳`)
  await page.getByRole('button', { name: '选择项目文件夹', exact: true }).click()
  await expect(page.getByText(/已选择：/)).toBeVisible()
  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  return page.evaluate(async family => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { useProjectStore } = await load('/storyforge/src/stores/project.ts') as typeof import('../../src/stores/project')
    const { resolveScopeLike } = await load('/storyforge/src/lib/workspace/scope.ts') as typeof import('../../src/lib/workspace/scope')
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts') as typeof import('../../src/stores/ai-config')
    const { useWorldviewStore } = await load('/storyforge/src/stores/worldview.ts') as typeof import('../../src/stores/worldview')
    const { useNodeFlowStore } = await load('/storyforge/src/stores/node-flow.ts') as typeof import('../../src/stores/node-flow')
    const { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } = await load('/storyforge/src/lib/node-authoring/catalog.ts') as typeof import('../../src/lib/node-authoring/catalog')
    const { emptyAuthoringGraph } = await load('/storyforge/src/lib/node-authoring/contracts.ts') as typeof import('../../src/lib/node-authoring/contracts')
    if (!navigator.locks?.request) throw new Error('Actual Chromium Web Locks required')
    const projectId = useProjectStore.getState().currentProjectId
    if (projectId == null) throw new Error('Actual wizard Project required')
    const scope = await resolveScopeLike(projectId)
    useAIConfigStore.getState().setConfig({ provider: 'custom', apiKey: 'synthetic-node-adoption-e2e', model: 'isolated-node-model',
      baseUrl: `${location.origin}/storyforge/quality002-adoption-model/v1`, temperature: .5, maxTokens: 8_000, contextWindow: 128_000 })
    await useWorldviewStore.getState().loadAll(scope, null)
    await useWorldviewStore.getState().saveWorldview({ projectId, worldGroupId: null, worldOrigin: '原世界起源。' }, scope)
    await useWorldviewStore.getState().saveStoryCore({ projectId, theme: '原主题', centralConflict: '原冲突', plotPattern: '线性' }, scope)
    const template = AUTHORING_NODE_BY_ID.get(family === 'world' ? 'world.origin' : 'story.theme')!
    const flowId = await useNodeFlowStore.getState().createFlow(projectId, null, { name: '002 作者选版与正式采纳', graph: {
      ...emptyAuthoringGraph(), nodes: [{ id: 'field', templateId: template.id, templateVersion: 1, title: template.label,
        x: 30, y: 30, config: { ...defaultConfigForTemplate(template), candidateCount: 2 },
        inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }],
    } })
    return { scope, flowId, templateId: template.id, field: family === 'world' ? 'worldOrigin' : 'theme' }
  }, family)
}

async function readState(page: Page, flowId: number) {
  return page.evaluate(async flowId => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { resolveScopeLike } = await load('/storyforge/src/lib/workspace/scope.ts') as typeof import('../../src/lib/workspace/scope')
    const { readAgentRunV1, verifyRecordedMemorySettlementV1 } = await load('/storyforge/src/lib/agent/run/event-store.ts') as typeof import('../../src/lib/agent/run/event-store')
    const { prepareNodeFieldAdoptionCompletionV1 } = await load('/storyforge/src/lib/node-authoring/field-adoption.ts') as typeof import('../../src/lib/node-authoring/field-adoption')
    const flow = await db.nodeFlows.get(flowId)
    if (!flow) throw new Error('Original native Flow missing')
    const scope = await resolveScopeLike(flow.projectId)
    const runs = await db.nodeRuns.where('flowId').equals(flowId).sortBy('startedAt'), run = runs[runs.length - 1]
    if (!run?.id) throw new Error('Original native NodeRun missing')
    const candidate = JSON.parse(run.nodeResultsJson).field
    const producers = await db.agentRuns.filter(row => row.nodeRunId === run.id).sortBy('nodeProducerVariantIndex')
    const views = []
    for (const row of producers) views.push(await readAgentRunV1(scope, row.id!))
    let receipt = null, settlement = null
    if (views[1]?.projection.state === 'completed') {
      const prepared = await prepareNodeFieldAdoptionCompletionV1({ scope, flow, runId: run.id, nodeId: 'field',
        selectedVariantIndex: candidate.selectedVariantIndex, draft: candidate.output })
      receipt = prepared.receipt
      settlement = await verifyRecordedMemorySettlementV1({ scope, snapshot: views[1] })
    }
    const tables: Tables = {}; for (const table of db.tables) tables[table.name] = await table.toArray()
    return { run, candidate, views, receipt, settlement, tables }
  }, flowId)
}
async function selectAndAwaitSaved(page: Page, flowId: number, templateId: string) {
  await page.locator(`[data-authoring-node-template="${templateId}"]`).click()
  await expect(page.getByLabel('候选输出')).toBeVisible()
  await expect.poll(async () => page.evaluate(async flowId => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const flow = await db.nodeFlows.get(flowId)
    return JSON.parse(flow!.graphJson).nodes[0].lastOpenedAt ?? 0
  }, flowId)).toBeGreaterThan(0)
  await expect(page.locator('.node-workspace-header > span')).toHaveText('已保存')
}

for (const family of ['world', 'story'] as const) test(`${family} actual author selects, edits, adopts and reloads without model resend`, async ({ page, context }, info) => {
  const state = states.get(context)!, f = await prepare(page, family); state.field = f.field
  await openLongformLeaf(page, '节点模式')
  await expect(page.getByLabel('节点图名称')).toHaveValue('002 作者选版与正式采纳')
  await page.getByRole('button', { name: '运行全部', exact: true }).click()
  await expect.poll(() => state.requests.length).toBe(2)
  await expect(page.getByRole('button', { name: '运行全部', exact: true })).toBeVisible()
  await selectAndAwaitSaved(page, f.flowId, f.templateId)
  const textarea = page.getByLabel('候选输出'), select = page.getByLabel('选择候选版本')
  await expect(select).toBeEnabled(); await select.selectOption('1')
  const pastedDraft = '\r\n ' + JSON.stringify({ field: f.field, value: '作者第二版终稿 e\u0301🌙：保留选择并承担代价。' }, null, 4) + '\n\t '
  const authorDraft = pastedDraft.replace(/\r\n?/g, '\n')
  await textarea.fill(pastedDraft)
  await expect(textarea).toHaveValue(authorDraft)
  const original = await readState(page, f.flowId)
  if (family === 'world') await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const failOnce = (mods: Partial<NodeRunRecord>) => {
      if (typeof mods.nodeResultsJson !== 'string' || JSON.parse(mods.nodeResultsJson).field.status !== 'adopted') return
      db.nodeRuns.hook('updating').unsubscribe(failOnce)
      throw new Error('E2E_NODE_PROJECTION_INTERRUPTED')
    }
    db.nodeRuns.hook('updating', failOnce)
  })
  await page.getByRole('button', { name: '本地校验并采纳', exact: true }).click()
  if (family === 'world') {
    await expect(page.getByText(/E2E_NODE_PROJECTION_INTERRUPTED/)).toBeVisible()
    const interrupted = await readState(page, f.flowId)
    await info.attach('002-native-interrupted-after-business', { contentType: 'application/octet-stream', body: serialize(interrupted) })
    expect(interrupted.views[1].projection.state).toBe('running')
    expect(interrupted.views[1].events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
    expect(interrupted.views[1].events.some(event => event.type === 'verification.accepted')).toBe(false)
    expect(interrupted.candidate.output).toBe(authorDraft)
    await page.reload(); await selectAndAwaitSaved(page, f.flowId, f.templateId)
    await expect(textarea).toHaveValue(authorDraft); await expect(textarea).toHaveAttribute('readonly', '')
    await expect(select).toHaveValue('1'); await expect(select).toBeDisabled()
    await expect(page.getByRole('button', { name: '拒绝候选', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '继续完成采纳', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '已采纳', exact: true })).toBeDisabled()
  const adopted = await readState(page, f.flowId)
  expect(adopted.candidate).toMatchObject({ status: 'adopted', selectedVariantIndex: 1, output: authorDraft })
  expect(adopted.views[0].projection.state).toBe('awaiting_confirmation')
  expect(adopted.views[1].projection.state).toBe('completed')
  expect(adopted.receipt?.receiptHash).toBe(adopted.views[1].projection.terminalReceiptHash)
  expect(adopted.settlement?.receipt.state).toBe('settled')
  expect(adopted.candidate.creativeArtifacts.map((value: { callEvidence: { totalTokens: number }[] }) => value.callEvidence[0].totalTokens)).toEqual([26, 28])
  const artifacts = adopted.tables.agentRunArtifacts as { id: number }[]
  for (const row of original.tables.agentRunArtifacts as { id: number }[]) expect(artifacts.find(value => value.id === row.id)).toEqual(row)
  expect(adopted.tables.aiUsageLog).toEqual(original.tables.aiUsageLog)
  await page.reload(); await selectAndAwaitSaved(page, f.flowId, f.templateId)
  await expect(page.getByRole('button', { name: '已采纳', exact: true })).toBeDisabled()
  await expect(textarea).toHaveValue(authorDraft); await expect(select).toHaveValue('1')
  const beforeView = await readState(page, f.flowId)
  await page.getByText('展开原始候选对照（2 个版本）', { exact: true }).click()
  for (let index = 0; index < 2; index++) {
    const article = page.getByRole('article', { name: `封存候选版本 ${index + 1}，只读`, exact: true })
    await expect(article.locator('pre')).toBeVisible()
    expect(await article.locator('pre').textContent()).toBe(adopted.candidate.variants[index])
    await expect(article.getByRole('region', { name: '创作产物状态', exact: true })).toContainText(`1 次模型调用 · ${26 + 2 * index} tokens`)
  }
  const afterView = await readState(page, f.flowId)
  expect(afterView).toEqual(beforeView); expect(state.requests).toHaveLength(2)
  await info.attach('002-native-original-adopted-and-cold-read', { contentType: 'application/octet-stream', body: serialize({ original, adopted, beforeView, afterView }) })
})
