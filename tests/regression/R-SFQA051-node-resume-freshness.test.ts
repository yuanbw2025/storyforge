import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as outlineCopilot from '../../src/lib/agent/outline-copilot'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import * as durableEvents from '../../src/lib/agent/run/event-store'
import { runWholeChapterQualityReviewV1 } from '../../src/lib/agent/run/quality-review-durable'
import { normalizeRichEditorHTMLV1 } from '../../src/lib/editor/rich-editor-schema'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { chat, type ChatResult } from '../../src/lib/ai/client'
import * as usageLog from '../../src/lib/ai/usage-log'
import { estimateTokens } from '../../src/lib/ai/context-budget'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { adoptAuthoringCandidate, runAuthoringGraph } from '../../src/lib/node-authoring/executor'
import * as freshnessApi from '../../src/lib/node-authoring/freshness'
import { CodexRequestError, type NodeFlow, type PromptTemplate } from '../../src/lib/types'
import { buildRagLibrary } from '../../src/lib/retrieval/rag-library'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const OLD = 'SFQA051_OLD_CANON'
const NEW = 'SFQA051_NEW_CANON'
const config = { provider: 'custom' as const, apiKey: 'synthetic-only', model: 'isolated-sfqa051',
  baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 6_000, contextWindow: 128_000 }
let requests: string[]
let responseContent: string
let usageWrites: Promise<unknown>[]

beforeEach(async () => {
  await db.delete(); await db.open()
  requests = []; usageWrites = []; responseContent = ''
  useAIConfigStore.setState({ config, taskRoutes: {} })
  const recordUsage = usageLog.recordUsage
  vi.spyOn(usageLog, 'recordUsage').mockImplementation(input => {
    const write = recordUsage(input)
    usageWrites.push(write)
    return write
  })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
    if (String(url) !== config.baseUrl + '/chat/completions' || options?.method !== 'POST') throw new Error('Unexpected real request in SFQA051')
    requests.push(String(options.body))
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: responseContent }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 29, completion_tokens: 11, total_tokens: 40 } }), { headers: { 'Content-Type': 'application/json' } })
  }))
})

afterEach(async () => {
  await Promise.allSettled(usageWrites)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()
})

function node(templateId: string, id: string, config: Record<string, unknown> = {}): AuthoringNodeInstance {
  const template = AUTHORING_NODE_BY_ID.get(templateId)
  if (!template) throw new Error(`Missing registered template ${templateId}`)
  return { id, templateId, templateVersion: 1, title: template.label, x: 0, y: 0,
    config: { ...defaultConfigForTemplate(template), ...config }, inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
}

async function pauseAt(flow: NodeFlow, nodeId: string) {
  const stop = new AbortController()
  const paused = await runAuthoringGraph({ flow, signal: stop.signal, onUpdate: update => {
    if (update.candidates[nodeId]) stop.abort('paused')
  } })
  expect(paused.run.status).toBe('paused')
  return paused
}

async function makeFlow(projectId: number, nodes: AuthoringNodeInstance[], edges: AuthoringNodeGraph['edges']) {
  const graph = { ...emptyAuthoringGraph(), nodes, edges }
  const id = await useNodeFlowStore.getState().createFlow(projectId, null, { graph })
  return (await db.nodeFlows.get(id))!
}

async function seedChapter(body = OLD) {
  const fixture = await seedCurrentWorkspace('051隔离长篇节点恢复')
  const title = '051当前章节'
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', {
    projectId: fixture.scope.projectId, parentId: null, type: 'chapter', title, summary: '仅合成章节', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(fixture.scope, 'chapters', {
    projectId: fixture.scope.projectId, outlineNodeId, title, content: `<p>${body}</p>`, status: 'draft', wordCount: body.length,
    order: 0, notes: '', createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  return { fixture, chapterId, title }
}

async function pauseAfterCanonicalRead(formal: boolean, throughCompose = false, body = OLD) {
  const { fixture, chapterId, title } = await seedChapter(body)
  const source = node('source.project-context', 'source', { sourceKeys: ['chapterContent'], chapterTitle: title })
  const consumer = formal
    ? node('world.origin', 'consumer', { request: '基于作者已保存的章稿形成世界起源。' })
    : node('processor.free-generation', 'consumer', { instruction: '使用当前资料形成实验草稿。' })
  const compose = node('processor.compose', 'compose', { template: '资料原文：{{context}}' })
  const flow = await makeFlow(fixture.scope.projectId, [source, ...(throughCompose ? [compose] : []), consumer], [
    { id: 'source-context', sourceNodeId: source.id, sourcePortId: 'context', targetNodeId: throughCompose ? compose.id : consumer.id, targetPortId: 'context' },
    ...(throughCompose ? [{ id: 'composed-context', sourceNodeId: compose.id, sourcePortId: 'text', targetNodeId: consumer.id, targetPortId: 'context' }] : []),
  ])
  const paused = await pauseAt(flow, throughCompose ? compose.id : source.id)
  expect(paused.candidates[source.id].output).toContain(OLD)
  expect(requests).toHaveLength(0)
  responseContent = formal ? JSON.stringify({ field: 'worldOrigin', value: '合成正式世界起源候选。' }) : '合成实验草稿。'
  return { fixture, flow, chapterId, source, compose, consumer, paused }
}

async function pauseAfterPromptBinding() {
  const fixture = await seedCurrentWorkspace(OLD)
  const template: PromptTemplate = {
    scope: 'user', moduleKey: 'story.core', promptType: 'custom', name: '051绑定夹具', description: '',
    systemPrompt: '使用已经确认的作品名称。', userPromptTemplate: '作品名称：{{workTitle}}', variables: ['workTitle'],
    variableBindings: [{ variable: 'workTitle', label: '作品名称', workField: 'title', required: true }],
    isActive: true, createdAt: 1, updatedAt: 1,
  }
  const prompt = node('control.prompt', 'prompt', { promptSnapshot: template })
  const writer = node('processor.free-generation', 'writer', { instruction: '依当前模板形成草稿。' })
  const flow = await makeFlow(fixture.scope.projectId, [prompt, writer], [
    { id: 'bound-prompt', sourceNodeId: prompt.id, sourcePortId: 'value', targetNodeId: writer.id, targetPortId: 'prompt' },
  ])
  const paused = await pauseAt(flow, prompt.id)
  expect(paused.candidates[prompt.id].output).toContain(OLD)
  expect(requests).toHaveLength(0)
  responseContent = '合成模板草稿。'
  return { fixture, flow, prompt, paused }
}

describe('SFQA051: resume must verify the completed source prefix before downstream AI', () => {
  it.each(['unchanged', 'retitled'] as const)('preserves the frozen input of a completed fact node (%s) on resume', async revision => {
    const { fixture, chapterId, title } = await seedChapter('阿明拾起航海图。')
    const fact = node('continuity.fact', 'fact', { chapterTitle: title })
    const verify = node('processor.validate', 'verify')
    const flow = await makeFlow(fixture.scope.projectId, [fact, verify], [{
      id: 'validate-facts', sourceNodeId: fact.id, sourcePortId: fact.outputs[0].id, targetNodeId: verify.id, targetPortId: 'candidate',
    }])
    responseContent = JSON.stringify({ facts: [] })
    const paused = await pauseAt(flow, fact.id)
    expect(requests).toHaveLength(1)
    const saved = await db.nodeRuns.get(paused.run.id!)
    if (revision === 'retitled') await db.chapters.update(chapterId, { title: '作者修改的章节标题' })
    // Capture an actual native promise before Dexie installs its transaction-scoped Promise.
    const NativePromise = globalThis.Promise
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((...args) => {
      const computed = digest(...args)
      return new NativePromise<ArrayBuffer>((resolve, reject) => {
        computed.then(value => setTimeout(() => resolve(value), 5), reject)
      })
    })
    const resume = runAuthoringGraph({ flow, resumeRunId: paused.run.id! })
    if (revision === 'retitled') {
      await expect(resume).rejects.toThrow(/旧断点已保留/)
      expect(await db.nodeRuns.get(paused.run.id!)).toEqual(saved)
    } else {
      expect((await resume).run.status).toBe('completed')
    }
    expect(requests).toHaveLength(1)
  })

  for (const formal of [false, true]) {
    const lane = formal ? 'formal world-origin' : 'experimental free generation'
    it(`${lane} resumes an unchanged saved source with exactly one downstream request`, async () => {
      const f = await pauseAfterCanonicalRead(formal)
      const result = await runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })
      expect(result.run.id).toBe(f.paused.run.id)
      expect(result.run.status).toBe('completed')
      expect(requests).toHaveLength(1)
      expect(requests[0]).toContain(OLD)
      expect(requests[0]).not.toContain(NEW)
      if (formal) expect(result.candidates[f.consumer.id].domain?.kind).toBe('worldview-field')
      expect(await db.worldviews.count()).toBe(0)
    })

    it(`${lane} refuses a changed Canon source before any request or run mutation`, async () => {
      const f = await pauseAfterCanonicalRead(formal)
      await db.chapters.update(f.chapterId, { content: `<p>${NEW}</p>`, updatedAt: 2 })
      const freshness = await freshnessApi.inspectAuthoringGraphFreshness({ flow: f.flow, scope: f.fixture.scope,
        snapshots: f.paused.snapshots, candidates: f.paused.candidates })
      expect(freshness[f.source.id]).toMatchObject({ status: 'stale', reasons: expect.arrayContaining(['source-updated']) })
      const before = await db.nodeRuns.get(f.paused.run.id!)
      const error = await runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })
        .then(() => null, (cause: unknown) => cause)
      expect(requests.map(body => ({ old: body.includes(OLD), current: body.includes(NEW) }))).toEqual([])
      expect(error).toBeInstanceOf(Error)
      expect(await db.nodeRuns.get(f.paused.run.id!)).toEqual(before)
      expect(await db.worldviews.count()).toBe(0)
    })
  }

  it('reuses unchanged composed input while keeping the completed local prefix and single downstream call', async () => {
    const f = await pauseAfterCanonicalRead(false, true)
    expect(f.paused.candidates[f.compose.id].output).toContain(OLD)
    const resumed = await runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })
    expect(resumed.run.status).toBe('completed')
    expect(resumed.snapshots[f.source.id]).toEqual(f.paused.snapshots[f.source.id])
    expect(resumed.snapshots[f.compose.id]).toEqual(f.paused.snapshots[f.compose.id])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain(OLD)
  })

  it('blocks a deleted Canon source behind an already completed compose node', async () => {
    const f = await pauseAfterCanonicalRead(false, true)
    await db.chapters.delete(f.chapterId)
    const before = await db.nodeRuns.get(f.paused.run.id!)
    await expect(runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })).rejects.toThrow('旧断点已保留')
    expect(requests).toHaveLength(0)
    expect(await db.nodeRuns.get(f.paused.run.id!)).toEqual(before)
  })

  it('allows an unchanged bound Prompt with exactly one downstream call', async () => {
    const f = await pauseAfterPromptBinding()
    const result = await runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })
    expect(result.run.status).toBe('completed')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain(OLD)
  })

  it('refuses a Prompt whose bound Work title changed without changing the graph', async () => {
    const f = await pauseAfterPromptBinding()
    await db.works.update(f.fixture.scope.workId, { title: NEW, updatedAt: 2 })
    const before = await db.nodeRuns.get(f.paused.run.id!)
    await expect(runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })).rejects.toThrow('旧断点已保留')
    expect(requests).toHaveLength(0)
    expect(await db.nodeRuns.get(f.paused.run.id!)).toEqual(before)
  })

  it('keeps the original adopted receipt but blocks downstream after the author changes its Canon target', async () => {
    const fixture = await seedCurrentWorkspace('051已采纳上游')
    const source = node('world.origin', 'adopted-source', { request: '形成当前世界起源。' })
    const writer = node('processor.free-generation', 'writer', { instruction: '基于世界起源创作。' })
    const flow = await makeFlow(fixture.scope.projectId, [source, writer], [
      { id: 'adopted-input', sourceNodeId: source.id, sourcePortId: 'candidate', targetNodeId: writer.id, targetPortId: 'context' },
    ])
    responseContent = JSON.stringify({ field: 'worldOrigin', value: '已采纳的原始世界起源。' })
    const paused = await pauseAt(flow, source.id)
    await adoptAuthoringCandidate({ flow, runId: paused.run.id!, nodeId: source.id, output: paused.candidates[source.id].output })
    const before = (await db.nodeRuns.get(paused.run.id!))!
    expect(JSON.parse(before.nodeResultsJson)[source.id]).toMatchObject({ status: 'adopted', canonReceipt: expect.any(Object) })
    const worldview = await db.worldviews.where('projectId').equals(fixture.scope.projectId).first()
    expect(worldview?.worldOrigin).toBe('已采纳的原始世界起源。')
    await db.worldviews.update(worldview!.id!, { worldOrigin: '作者手动重写的世界起源。', updatedAt: Date.now() + 1 })
    await expect(runAuthoringGraph({ flow, resumeRunId: paused.run.id! })).rejects.toThrow('旧断点已保留')
    expect(requests).toHaveLength(1)
    expect(await db.nodeRuns.get(paused.run.id!)).toEqual(before)
    expect((await db.worldviews.get(worldview!.id!))?.worldOrigin).toBe('作者手动重写的世界起源。')
  })

  it('retains a concurrent checkpoint update and refuses to claim the old readback', async () => {
    const f = await pauseAfterCanonicalRead(false)
    const before = (await db.nodeRuns.get(f.paused.run.id!))!
    const inspect = freshnessApi.inspectAuthoringGraphFreshness
    vi.spyOn(freshnessApi, 'inspectAuthoringGraphFreshness').mockImplementationOnce(async (...args) => {
      const proof = await inspect(...args)
      await db.nodeRuns.update(before.id!, { updatedAt: before.updatedAt + 1 })
      return proof
    })
    await expect(runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })).rejects.toThrow('原断点、节点图或作品已变化')
    expect(requests).toHaveLength(0)
    expect(await db.nodeRuns.get(before.id!)).toEqual({ ...before, updatedAt: before.updatedAt + 1 })
  })

  it('does not treat a legacy missing source fingerprint as fresh evidence', async () => {
    const f = await pauseAfterCanonicalRead(false)
    const snapshots = structuredClone(f.paused.snapshots)
    delete snapshots[f.source.id].sourceHash
    await db.nodeRuns.update(f.paused.run.id!, { inputSnapshotsJson: JSON.stringify(snapshots) })
    const before = await db.nodeRuns.get(f.paused.run.id!)
    await expect(runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })).rejects.toThrow('旧断点已保留')
    expect(requests).toHaveLength(0)
    expect(await db.nodeRuns.get(f.paused.run.id!)).toEqual(before)
  })

  it('refuses to resume a saved prefix under another Work owner', async () => {
    const f = await pauseAfterCanonicalRead(true)
    const other = await seedCurrentWorkspace('051另一个隔离作品')
    const before = await db.nodeRuns.get(f.paused.run.id!)
    await expect(runAuthoringGraph({ flow: { ...f.flow, projectId: other.scope.projectId }, resumeRunId: f.paused.run.id! }))
      .rejects.toThrow('不属于当前作品')
    expect(requests).toHaveLength(0)
    expect(await db.nodeRuns.get(f.paused.run.id!)).toEqual(before)
  })

  it.each(['experimental', 'formal'] as const)('%s refuses a Canon write racing the real freshness read without any change to Run or Flow', async lane => {
    const fixture = await seedCurrentWorkspace('051隔离来源并发')
    const worldviewId = await db.worldviews.add(stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.scope.projectId, worldGroupId: null, worldOrigin: OLD, createdAt: 1, updatedAt: 1,
    }, { owner: 'world' })) as number
    const source = node('source.project-context', 'source', { sourceKeys: ['worldview'] })
    const consumer = lane === 'formal' ? node('world.origin', 'consumer', { request: '核对当前世界来源。' })
      : node('processor.free-generation', 'consumer', { instruction: '根据当前世界来源创作实验草稿。' })
    const flow = await makeFlow(fixture.scope.projectId, [source, consumer], [
      { id: 'source-context', sourceNodeId: source.id, sourcePortId: 'context', targetNodeId: consumer.id, targetPortId: 'context' },
    ])
    const paused = await pauseAt(flow, source.id)
    expect(paused.candidates[source.id].output).toContain(OLD)
    const beforeRun = await db.nodeRuns.get(paused.run.id!), beforeFlow = await db.nodeFlows.get(flow.id!)
    const inspect = freshnessApi.inspectAuthoringGraphFreshness
    vi.spyOn(freshnessApi, 'inspectAuthoringGraphFreshness').mockImplementationOnce(async (...args) => {
      const proof = await inspect(...args)
      expect(proof[source.id].status).toBe('fresh')
      await db.worldviews.update(worldviewId, { worldOrigin: NEW, updatedAt: 2 })
      return proof
    })
    responseContent = lane === 'formal' ? JSON.stringify({ field: 'worldOrigin', value: '并发场景中的合成候选。' }) : '并发场景中的合成草稿。'
    const failure = await runAuthoringGraph({ flow, resumeRunId: paused.run.id! }).then(() => null, (cause: unknown) => cause)
    expect(requests.map(body => ({ old: body.includes(OLD), current: body.includes(NEW) }))).toEqual([])
    expect(failure).toBeInstanceOf(Error)
    expect(await db.nodeRuns.get(paused.run.id!)).toEqual(beforeRun)
    expect(await db.nodeFlows.get(flow.id!)).toEqual(beforeFlow)
    expect((await db.worldviews.get(worldviewId))?.worldOrigin).toBe(NEW)
  })

  it('resumes an unchanged long Canon source with the original default clipping budget', async () => {
    const body = OLD + '潮水越过东岸堤坝，守夜人收起铜铃。'.repeat(1100)
    expect(estimateTokens(body)).toBeGreaterThan(12_000)
    expect(estimateTokens(body)).toBeLessThan(48_000)
    const f = await pauseAfterCanonicalRead(false, false, body)
    expect(f.source.config.contextBudget).toBeUndefined()
    const atomicReadSets: string[][] = []
    const inspect = freshnessApi.inspectAuthoringGraphFreshness
    vi.spyOn(freshnessApi, 'inspectAuthoringGraphFreshness').mockImplementation(async (...args) => {
      const transaction = Dexie.currentTransaction
      if (transaction?.mode === 'readwrite') atomicReadSets.push([...transaction.storeNames])
      return inspect(...args)
    })
    const resumed = await runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })
    expect(resumed.run.id).toBe(f.paused.run.id)
    expect(resumed.run.status).toBe('completed')
    expect(resumed.snapshots[f.source.id]).toEqual(f.paused.snapshots[f.source.id])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain(OLD)
    expect(atomicReadSets).toHaveLength(1)
    expect(atomicReadSets[0]).toEqual(expect.arrayContaining(['chapters', 'worldviews', 'works', 'promptTemplates', 'nodeFlows', 'nodeRuns']))
    console.info(`[SFQA051] exact resume proof transaction: ${atomicReadSets[0].length} registered tables`)
  })

  it('resumes an unchanged exact RAG field selection with the original fingerprint and one downstream request', async () => {
    const fixture = await seedCurrentWorkspace('051隔离精确资料恢复')
    await db.worldviews.add(stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.scope.projectId, worldGroupId: null, worldOrigin: OLD, createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', {
      projectId: fixture.scope.projectId, parentId: null, type: 'chapter', title: '已写章', summary: '', order: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' })) as number
    await db.chapters.add(stampNewRecord(fixture.scope, 'chapters', {
      projectId: fixture.scope.projectId, outlineNodeId, title: '已写章', content: '<p>隔离章稿原文。</p>',
      summary: '已有章稿摘要。', status: 'draft', wordCount: 7, order: 0, notes: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const entries = await buildRagLibrary({ projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: null })
    const entry = entries.find(item => item.tableName === 'worldviews' && item.fieldKey === 'worldOrigin' && item.content === OLD)
    if (!entry) throw new Error('Expected a genuine registered RAG field key')
    const source = node('source.project-context', 'source', { sourceKeys: ['ragSelection'], ragEntryKeys: [entry.key] })
    const consumer = node('processor.free-generation', 'consumer', { instruction: '依据作者绑定的精确资料创作。' })
    const flow = await makeFlow(fixture.scope.projectId, [source, consumer], [
      { id: 'exact-selection', sourceNodeId: source.id, sourcePortId: 'context', targetNodeId: consumer.id, targetPortId: 'context' },
    ])
    const paused = await pauseAt(flow, source.id)
    expect(paused.candidates[source.id].output).toContain(OLD)
    expect(requests).toHaveLength(0)
    responseContent = '保留精确资料的实验草稿。'
    const resumed = await runAuthoringGraph({ flow, resumeRunId: paused.run.id! })
    expect(resumed.run.id).toBe(paused.run.id)
    expect(resumed.run.status).toBe('completed')
    expect(resumed.snapshots[source.id]).toEqual(paused.snapshots[source.id])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain(OLD)
  })

  it.each(['experimental', 'formal'] as const)('%s refuses a Canon change after the running claim and before consumption', async lane => {
    const fixture = await seedCurrentWorkspace('051隔离恢复后并发')
    const worldviewId = await db.worldviews.add(stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.scope.projectId, worldGroupId: null, worldOrigin: OLD, createdAt: 1, updatedAt: 1,
    }, { owner: 'world' })) as number
    const source = node('source.project-context', 'source', { sourceKeys: ['worldview'] })
    const consumer = lane === 'formal' ? node('world.origin', 'consumer', { request: '核对当前世界来源。' })
      : node('processor.free-generation', 'consumer', { instruction: '依据当前世界来源形成草稿。' })
    const flow = await makeFlow(fixture.scope.projectId, [source, consumer], [
      { id: 'after-claim-input', sourceNodeId: source.id, sourcePortId: 'context', targetNodeId: consumer.id, targetPortId: 'context' },
    ])
    const paused = await pauseAt(flow, source.id)
    expect(paused.candidates[source.id].output).toContain(OLD)
    const before = await db.nodeRuns.get(paused.run.id!)
    let writer: Promise<unknown> | undefined
    responseContent = lane === 'formal' ? JSON.stringify({ field: 'worldOrigin', value: '合成恢复后的正式候选。' }) : '合成实验草稿。'
    const failure = await runAuthoringGraph({ flow, resumeRunId: paused.run.id!, onUpdate: update => {
      if (update.run.status !== 'running' || writer) return
      // Hold the actual Work read boundary while changing only the source.
      // Both consumers must await that read before any registered request.
      writer = db.transaction('rw', [db.worldviews, db.works], () => db.worldviews.update(worldviewId, { worldOrigin: NEW, updatedAt: 2 }))
    } }).then(() => null, (cause: unknown) => cause)
    expect(writer).toBeDefined()
    await writer
    expect(requests.map(body => ({ old: body.includes(OLD), current: body.includes(NEW) }))).toEqual([])
    expect(failure).toBeInstanceOf(Error)
    expect(await db.nodeRuns.get(paused.run.id!)).toEqual(before)
    expect((await db.worldviews.get(worldviewId))?.worldOrigin).toBe(NEW)
  })

  it('refuses a formal source change after durable request preparation and records pre-dispatch evidence', async () => {
    const f = await pauseAfterCanonicalRead(true)
    const append = durableEvents.appendAgentRunEventV1
    let changed = false
    vi.spyOn(durableEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
      const snapshot = await append(input)
      if (input.type === 'model.requested' && !changed) {
        changed = true
        await db.chapters.update(f.chapterId, { content: `<p>${NEW}</p>`, updatedAt: 2 })
      }
      return snapshot
    })
    const resumed = await runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })
    expect(changed).toBe(true)
    expect(requests.map(body => ({ old: body.includes(OLD), current: body.includes(NEW) }))).toEqual([])
    expect(resumed.run.status).toBe('failed')
    expect(resumed.candidates[f.source.id]).toEqual(f.paused.candidates[f.source.id])
    expect(resumed.candidates[f.consumer.id].errors?.join()).toContain('来源、候选或证据已变化')
    expect((await db.chapters.get(f.chapterId))?.content).toContain(NEW)
    const runs = await db.agentRuns.filter(row => row.nodeRunId === resumed.run.id).toArray()
    expect(runs).toHaveLength(1)
    const saved = await durableEvents.readAgentRunV1(f.fixture.scope, runs[0].id!)
    expect(saved.projection.state).toBe('paused')
    expect(saved.events.some(event => event.type === 'model.responded' || event.type === 'candidate.persisted')).toBe(false)
    const evidence = saved.events.filter(event => event.type === 'evidence.artifact.recorded')
    expect(evidence.map(event => event.payload.artifactKind)).toContain('rendered-request')
    expect(evidence.map(event => event.payload.artifactKind)).not.toContain('raw-response')
    const observation = evidence.find(event => event.payload.artifactKind === 'tool-result')
    expect(observation).toBeDefined()
    const body = await readAgentRunArtifactExactV1({ projectId: f.fixture.scope.projectId,
      artifactKind: 'tool-result', contentHash: observation!.payload.contentHash })
    expect(JSON.parse(body)).toMatchObject({ version: 'creation-model-observation-v1',
      observation: { outcome: 'unavailable', usage: null, requestLifecycle: { phase: 'pre-dispatch', responseStatus: null } } })
  })

  it('refuses a real volume-outline request when its saved Canon changes during formal preparation', async () => {
    const f = await pauseAfterCanonicalRead(false)
    const consumer = node('outline.volume', 'outline', { request: '规划本书第一卷的卷纲。' })
    const flow = await makeFlow(f.fixture.scope.projectId, [f.source, consumer], [
      { id: 'volume-context', sourceNodeId: f.source.id, sourcePortId: 'context', targetNodeId: consumer.id, targetPortId: 'context' },
    ])
    const paused = await pauseAt(flow, f.source.id)
    expect(paused.candidates[f.source.id].output).toContain(OLD)
    responseContent = JSON.stringify([{ title: '第一卷：潮门', summary: '主角发现海床城门并踏入旧文明。' }])
    const prepare = outlineCopilot.prepareOutlineCopilot
    let changed = false
    vi.spyOn(outlineCopilot, 'prepareOutlineCopilot').mockImplementation(async (...args) => {
      const prepared = await prepare(...args)
      expect(prepared.prepared.messages.map(message => message.content).join()).toContain(OLD)
      await db.chapters.update(f.chapterId, { content: `<p>${NEW}</p>`, updatedAt: 2 })
      changed = true
      return prepared
    })
    const resumed = await runAuthoringGraph({ flow, resumeRunId: paused.run.id! })
    expect(changed).toBe(true)
    expect(requests.map(body => ({ old: body.includes(OLD), current: body.includes(NEW) }))).toEqual([])
    expect(resumed.run.status).toBe('failed')
    expect(resumed.candidates[f.source.id]).toEqual(paused.candidates[f.source.id])
  })


  it('keeps the first outline response without claiming a repair call blocked before dispatch', async () => {
    const f = await pauseAfterCanonicalRead(false)
    const consumer = node('outline.volume', 'outline', { request: '规划本书第一卷的卷纲。' })
    const flow = await makeFlow(f.fixture.scope.projectId, [f.source, consumer], [
      { id: 'volume-context', sourceNodeId: f.source.id, sourcePortId: 'context', targetNodeId: consumer.id, targetPortId: 'context' },
    ])
    const paused = await pauseAt(flow, f.source.id)
    responseContent = '051已返回但非JSON的原始卷纲候选。'
    const syntheticFetch = fetch
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
      const response = await syntheticFetch(url, options)
      if (requests.length === 1) await db.chapters.update(f.chapterId, { content: `<p>${NEW}</p>`, updatedAt: 2 })
      return response
    }))
    const resumed = await runAuthoringGraph({ flow, resumeRunId: paused.run.id! })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain(OLD)
    expect(resumed.run.status).toBe('failed')
    const artifact = resumed.candidates[consumer.id].creativeArtifacts?.[0]
    expect(artifact?.originalText).toBe(responseContent)
    expect(artifact?.callEvidence.map(call => call.purpose)).toEqual(['generate'])
    expect(artifact?.repair).toBeNull()
    expect(artifact?.issues.some(issue => issue.message.includes('未发送'))).toBe(true)
  })

  it('resumes a legitimate completed whole-chapter review without repeating its formal request', async () => {
    const f = await pauseAfterCanonicalRead(false)
    const review = node('chapter.quality-review', 'review', { chapterTitle: '051当前章节' })
    const consumer = node('processor.free-generation', 'consumer', { instruction: '总结隔离报告。' })
    const flow = await makeFlow(f.fixture.scope.projectId, [review, consumer], [
      { id: 'current-review', sourceNodeId: review.id, sourcePortId: 'report', targetNodeId: consumer.id, targetPortId: 'context' },
    ])
    responseContent = JSON.stringify({ summary: '051合法隔离全文评审', strengths: [], issues: [] })
    const paused = await pauseAt(flow, review.id)
    expect(paused.candidates[review.id]).toMatchObject({ status: 'candidate', domain: { kind: 'quality-review' } })
    expect(requests).toHaveLength(1)
    responseContent = '恢复后的实验草稿。'
    const resumed = await runAuthoringGraph({ flow, resumeRunId: paused.run.id! })
    expect(resumed.run.status).toBe('completed')
    expect(resumed.candidates[review.id]).toEqual(paused.candidates[review.id])
    expect(requests).toHaveLength(2)
    expect(requests[1]).toContain('051合法隔离全文评审')
  })

  it('resumes a legitimate completed quality revision without repeating review, revision or recheck', async () => {
    const f = await pauseAfterCanonicalRead(false)
    const locks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    const held = new Set<string>()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) => {
        if (held.has(name)) return run(null)
        held.add(name)
        try { return await run({ name }) } finally { held.delete(name) }
      },
    } })
    try {
      const chapter = (await db.chapters.get(f.chapterId))!
      const sourceHtml = normalizeRichEditorHTMLV1('<p><strong>余额三点，金额一百二十。</strong></p><p>陈禾签下名字，正文到此结束。</p>')
      await db.chapters.update(f.chapterId, { content: sourceHtml, updatedAt: 2 })
      const review = await runWholeChapterQualityReviewV1({
        scope: f.fixture.scope, chapterId: f.chapterId, outlineNodeId: chapter.outlineNodeId, worldGroupId: null,
        mode: 'quality', configOverride: config, call: async (_messages, _resolution, result) => {
          result.completion = 'complete'; result.finishReason = 'stop'
          return JSON.stringify({ summary: '停笔处有任务说明', strengths: ['金额和余额明确'], issues: [
            { dimension: 'voice', confidence: 'suggestion', anchorId: 'p2', reason: '任务语言进入正文', suggestion: '移除任务说明，保留签字动作' },
          ] })
        },
      })
      const reviewNode = node('chapter.quality-review', 'review', { chapterTitle: chapter.title })
      const revision = node('chapter.quality-revision', 'revision', { chapterTitle: chapter.title,
        reportHash: review.report.artifactHash, selectedIssueIds: [review.report.issues[0].id] })
      const consumer = node('processor.free-generation', 'consumer', { instruction: '总结隔离修订候选。' })
      const flow = await makeFlow(f.fixture.scope.projectId, [reviewNode, revision, consumer], [
        { id: 'selected-report', sourceNodeId: reviewNode.id, sourcePortId: 'report', targetNodeId: revision.id, targetPortId: 'report' },
        { id: 'revision-output', sourceNodeId: revision.id, sourcePortId: 'candidate', targetNodeId: consumer.id, targetPortId: 'context' },
      ])
      const syntheticFetch = fetch
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
        responseContent = requests.length === 0
          ? JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '陈禾签下名字。' }] })
          : requests.length === 1
            ? JSON.stringify({ review: { summary: '任务说明已移除，仍需作者判断', strengths: ['保留签字'], issues: [] },
              outcomes: [{ issueId: review.report.issues[0].id, status: 'improved', anchorId: 'p2', reason: '签字事件保留且没有任务说明' }] })
            : '恢复后的实验草稿。'
        return syntheticFetch(url, options)
      }))
      const paused = await pauseAt(flow, revision.id)
      expect(paused.candidates[revision.id]).toMatchObject({ status: 'candidate', domain: { kind: 'quality-revision' } })
      expect(requests).toHaveLength(2)
      const resumed = await runAuthoringGraph({ flow, resumeRunId: paused.run.id! })
      expect(resumed.run.status).toBe('completed')
      expect(resumed.candidates[revision.id]).toEqual(paused.candidates[revision.id])
      expect(requests).toHaveLength(3)
      expect(requests[2]).toContain('陈禾签下名字。')
      expect((await db.chapters.get(f.chapterId))?.content).toBe(sourceHtml)
    } finally {
      if (locks) Object.defineProperty(navigator, 'locks', locks)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })

  it('refuses an ordinary field dispatch when the source changes during the actual frozen entry digest', async () => {
    const f = await pauseAfterCanonicalRead(true)
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let changed = false
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((...args) => {
      const pending = digest(...args)
      if (changed || !new Error().stack?.includes('executeFrozenFormalAIEntryV1')) return pending
      changed = true
      return pending.then(async result => {
        await db.chapters.update(f.chapterId, { content: `<p>${NEW}</p>`, updatedAt: 2 })
        return result
      })
    })
    const resumed = await runAuthoringGraph({ flow: f.flow, resumeRunId: f.paused.run.id! })
    expect(changed).toBe(true)
    expect((await db.chapters.get(f.chapterId))?.content).toContain(NEW)
    expect(requests.map(body => ({ old: body.includes(OLD), current: body.includes(NEW) }))).toEqual([])
    expect(resumed.run.status).toBe('failed')
    const runs = await db.agentRuns.filter(row => row.nodeRunId === resumed.run.id).toArray()
    const saved = await durableEvents.readAgentRunV1(f.fixture.scope, runs[0].id!)
    expect(saved.projection.state).toBe('paused')
    expect(saved.events.some(event => event.type === 'model.responded' || event.type === 'candidate.persisted')).toBe(false)
  })

  it.each(['outline', 'experimental', 'field', 'repair', 'cancel-repair', 'pause-repair'] as const)('refuses a stale %s request after the real Codex status barrier', async lane => {
    const f = await pauseAfterCanonicalRead(lane === 'field')
    const stopped = lane === 'cancel-repair' || lane === 'pause-repair'
    const repair = lane === 'repair' || stopped
    const outline = lane === 'outline' || repair
    const cancellation = new AbortController()
    const release = AgentTeamBudgetTracker.prototype.releaseUnsentCall
    const releases: Array<{ before: number; after: number; tokensPreserved: boolean }> = []
    if (repair) vi.spyOn(AgentTeamBudgetTracker.prototype, 'releaseUnsentCall').mockImplementation(function (this: AgentTeamBudgetTracker, reservation) {
      const before = this.snapshot()
      release.call(this, reservation)
      const after = this.snapshot()
      releases.push({ before: before.calls, after: after.calls, tokensPreserved: before.usedTokens === after.usedTokens })
    })
    const consumer = outline ? node('outline.volume', 'outline', { request: '规划本书第一卷的卷纲。' }) : f.consumer
    const flow = outline ? await makeFlow(f.fixture.scope.projectId, [f.source, consumer], [
      { id: 'volume-context', sourceNodeId: f.source.id, sourcePortId: 'context', targetNodeId: consumer.id, targetPortId: 'context' },
    ]) : f.flow
    const paused = outline ? await pauseAt(flow, f.source.id) : f.paused
    const base = '/storyforge/local-codex/v1', model = 'isolated-codex-review'
    useAIConfigStore.setState({ config: { ...config, provider: 'codex', model, baseUrl: base, apiKey: '' }, presets: [], taskRoutes: {} })
    vi.stubGlobal('location', { hostname: 'localhost' })
    const phases: string[] = []
    const posted: string[] = []
    let wireId = ''
    let statusChecks = 0
    const firstRaw = '051第一次 Codex 卷纲原文，暂不符合 JSON。'
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
      if (String(url) === base + '/status' && options?.method === 'GET') {
        phases.push('status-entered')
        statusChecks += 1
        if (!repair || statusChecks === 2) {
          if (stopped) {
            cancellation.abort(lane === 'pause-repair' ? 'paused' : new DOMException('作者停止本次修复', 'AbortError'))
            phases.push('author-cancelled')
          } else {
            await db.chapters.update(f.chapterId, { content: `<p>${NEW}</p>`, updatedAt: 2 })
            phases.push('author-save-committed')
          }
        }
        return Response.json({ state: 'ready' })
      }
      if (String(url) === base + '/requests' && options?.method === 'POST') {
        const body = String(options.body)
        phases.push('generation-post')
        posted.push(body)
        wireId = JSON.parse(body).id
        return Response.json({ id: wireId }, { status: 202 })
      }
      if (wireId && String(url) === base + '/requests/' + wireId && options?.method === 'GET') {
        return Response.json({ id: wireId, model, status: 'completed', dispatched: true,
          text: repair ? firstRaw
            : outline ? JSON.stringify([{ title: '第一卷：潮门', summary: '主角发现海床城门并踏入旧文明。' }]) : responseContent,
          usage: { inputTokens: 29, outputTokens: 11, totalTokens: 40 } })
      }
      throw new Error('Unexpected transport in SFQA051 Codex barrier')
    }))
    const resumed = await runAuthoringGraph({ flow, resumeRunId: paused.run.id!, signal: cancellation.signal })
    const sent = posted.map(body => ({ old: body.includes(OLD), current: body.includes(NEW) }))
    if (repair) {
      expect(phases).toEqual(['status-entered', 'generation-post', 'status-entered', stopped ? 'author-cancelled' : 'author-save-committed'])
      expect(sent).toEqual([{ old: true, current: false }])
      expect(releases).toEqual([{ before: 2, after: 1, tokensPreserved: true }])
      const artifact = resumed.candidates[consumer.id].creativeArtifacts?.[0]
      expect(artifact?.originalText).toBe(firstRaw)
      expect(artifact?.callEvidence.map(item => item.purpose)).toEqual(['generate'])
      expect(artifact?.repair).toBeNull()
      expect(usageWrites).toHaveLength(1)
    } else {
      expect(phases).toEqual(['status-entered', 'author-save-committed'])
      expect(sent).toEqual([])
      expect(usageWrites).toHaveLength(0)
    }
    if (lane === 'field') {
      const rows = await db.agentRuns.filter(row => row.nodeRunId === resumed.run.id).toArray()
      expect(rows).toHaveLength(1)
      const saved = await durableEvents.readAgentRunV1(f.fixture.scope, rows[0].id!)
      expect(saved.projection.state).toBe('paused')
      expect(saved.events.some(event => event.type === 'model.responded' || event.type === 'candidate.persisted')).toBe(false)
      const bodies = await Promise.all(saved.events.flatMap(event => event.type === 'evidence.artifact.recorded'
        && event.payload.artifactKind === 'tool-result' ? [readAgentRunArtifactExactV1({
          projectId: f.fixture.scope.projectId, artifactKind: 'tool-result', contentHash: event.payload.contentHash,
        })] : []))
      expect(bodies.map(body => JSON.parse(body))).toEqual(expect.arrayContaining([
        expect.objectContaining({ version: 'node-field-codex-request-v1' }),
        expect.objectContaining({ version: 'creation-model-observation-v1', observation: expect.objectContaining({
          usage: null, requestLifecycle: { phase: 'pre-dispatch', responseStatus: null },
        }) }),
      ]))
    }
    expect(resumed.run.status).toBe(lane === 'cancel-repair' ? 'cancelled' : lane === 'pause-repair' ? 'paused' : 'failed')
    expect((await db.nodeRuns.get(paused.run.id!))?.status).toBe(resumed.run.status)
    expect(resumed.candidates[f.source.id]).toEqual(paused.candidates[f.source.id])
    expect((await db.chapters.get(f.chapterId))?.content).toContain(stopped ? OLD : NEW)
  })

  it('blocks the actual registered quality review transport after a bound Prompt source changes', async () => {
    const f = await pauseAfterCanonicalRead(false)
    const template: PromptTemplate = {
      scope: 'user', moduleKey: 'story.core', promptType: 'custom', name: '051质量绑定', description: '',
      systemPrompt: '使用已经确认的作品名称。', userPromptTemplate: '作品名称：{{workTitle}}', variables: ['workTitle'],
      variableBindings: [{ variable: 'workTitle', label: '作品名称', workField: 'title', required: true }],
      isActive: true, createdAt: 1, updatedAt: 1,
    }
    const prompt = node('control.prompt', 'prompt', { promptSnapshot: template })
    const review = node('chapter.quality-review', 'review', { chapterTitle: '051当前章节' })
    const flow = await makeFlow(f.fixture.scope.projectId, [prompt, review], [
      { id: 'review-prompt', sourceNodeId: prompt.id, sourcePortId: 'value', targetNodeId: review.id, targetPortId: 'prompt' },
    ])
    const paused = await pauseAt(flow, prompt.id)
    const base = '/storyforge/local-codex/v1'
    useAIConfigStore.setState({ config: { ...config, provider: 'codex', model: 'isolated-quality-codex', baseUrl: base, apiKey: '' },
      presets: [], taskRoutes: {} })
    vi.stubGlobal('location', { hostname: 'localhost' })
    let statuses = 0
    const posts: string[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
      if (String(url) === base + '/status' && options?.method === 'GET') {
        statuses += 1
        await db.works.update(f.fixture.scope.workId, { title: NEW, updatedAt: 2 })
        return Response.json({ state: 'ready' })
      }
      if (options?.method === 'POST') posts.push(String(url))
      throw new Error('Unexpected quality review request')
    }))
    const resumed = await runAuthoringGraph({ flow, resumeRunId: paused.run.id! })
    expect(statuses).toBe(1)
    expect(posts).toEqual([])
    expect(usageWrites).toHaveLength(0)
    expect(resumed.run.status).toBe('failed')
    expect(resumed.candidates[review.id].errors?.join()).toContain('来源、候选或证据已变化')
    expect(resumed.candidates[prompt.id]).toEqual(paused.candidates[prompt.id])
    expect((await db.works.get(f.fixture.scope.workId))?.title).toBe(NEW)
  })

  it('preserves the exact caller AbortError during the final Codex guard', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' })
    const baseUrl = '/storyforge/local-codex/v1'
    const phases: string[] = []
    const controller = new AbortController()
    const abort = new DOMException('author stopped during freshness check', 'AbortError')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
      phases.push(init?.method + ' ' + String(url))
      if (String(url) === baseUrl + '/status' && init?.method === 'GET') return Response.json({ state: 'ready' })
      throw new Error('Unexpected POST or network request')
    }))
    const result: ChatResult = { beforeModelDispatch: async () => {
      phases.push('guard-entered')
      await Promise.resolve()
      controller.abort(abort)
    } }
    const error = await chat([{ role: 'user', content: 'isolated synthetic probe' }],
      { ...config, provider: 'codex', baseUrl, apiKey: '', model: 'isolated-codex-cancel-review' },
      undefined, controller.signal, result).then(() => null, (cause: unknown) => cause)
    expect(phases).toEqual(['GET ' + baseUrl + '/status', 'guard-entered'])
    expect(error).toBe(abort)
    expect(result.requestLifecycle).toEqual({ phase: 'pre-dispatch', responseStatus: null })
    expect(usageWrites).toHaveLength(0)
  })

  it('does not use a cancelled guard observation for a later unguarded Codex call', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' })
    const baseUrl = '/storyforge/local-codex/v1'
    const ai = { ...config, provider: 'codex' as const, baseUrl, apiKey: '', model: 'isolated-codex-result-reuse' }
    const messages = [{ role: 'user' as const, content: 'synthetic probe' }]
    const controller = new AbortController()
    const abort = new DOMException('author stopped', 'AbortError')
    const result: ChatResult = { beforeModelDispatch: async () => { controller.abort(abort) } }
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
      calls.push(init?.method + ' ' + String(url))
      if (String(url) === baseUrl + '/status' && init?.method === 'GET') {
        return Response.json(calls.length === 1 ? { state: 'ready' } : { state: 'wrong-auth', message: 'bridge auth changed' })
      }
      throw new Error('Unexpected POST or network')
    }))
    await expect(chat(messages, ai, undefined, controller.signal, result)).rejects.toBe(abort)
    expect(result.modelDispatchGuardCancelled).toBe(true)
    delete result.beforeModelDispatch
    await expect(chat(messages, ai, undefined, undefined, result)).rejects.toBeInstanceOf(CodexRequestError)
    expect(calls).toEqual(['GET ' + baseUrl + '/status', 'GET ' + baseUrl + '/status'])
    expect(result.modelDispatchGuardCancelled).toBeUndefined()
    expect(usageWrites).toHaveLength(0)
  })
})
