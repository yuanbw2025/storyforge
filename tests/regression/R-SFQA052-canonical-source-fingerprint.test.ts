import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { adoptFactCandidates, confirmFactCandidate } from '../../src/lib/fact-ledger/fact-ledger'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { runAuthoringGraph, type AuthoringRunUpdate } from '../../src/lib/node-authoring/executor'
import { inspectAuthoringGraphFreshness } from '../../src/lib/node-authoring/freshness'
import type { NodeFlow } from '../../src/lib/types'

const config = { provider: 'custom' as const, model: '052-synthetic', baseUrl: 'http://127.0.0.1:9/v1',
  apiKey: 'synthetic-only', temperature: 0, maxTokens: 4000, contextWindow: 128_000 }
const title = '052港口来信'
const manuscript = '<p>阿明在港口拾起铜钥匙，右手被钥匙划伤。</p>'
const fact = { subject: '阿明', predicate: 'healthStatus', value: '受伤', quote: '右手被钥匙划伤' }
const response = { stateDiffs: [], facts: [fact], inventoryEvents: [], storyEvents: [], relations: [], foreshadowUpdates: [] }
let duringHttp: (() => Promise<void>) | undefined

beforeEach(async () => {
  await db.delete(); await db.open()
  duringHttp = undefined
  useAIConfigStore.setState({ config, taskRoutes: {} })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
    if (String(url) !== config.baseUrl + '/chat/completions' || options?.method !== 'POST') throw new Error('Unexpected model transport')
    await duringHttp?.()
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(response) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 29, completion_tokens: 11, total_tokens: 40 } }), { headers: { 'Content-Type': 'application/json' } })
  }))
})
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()
})

function node(templateId: string, extra: Record<string, unknown> = {}): AuthoringNodeInstance {
  const t = AUTHORING_NODE_BY_ID.get(templateId)!
  return { id: templateId, templateId, templateVersion: 1, title: t.label, x: 0, y: 0,
    config: { ...defaultConfigForTemplate(t), ...extra }, inputs: structuredClone(t.inputs), outputs: structuredClone(t.outputs) }
}

async function generate(templateId: 'continuity.fact' | 'chapter.organize', options: {
  budget?: number
  duringHttp?: (chapterId: number) => Promise<void>
} = {}) {
  const f = await seedCurrentWorkspace('052来源指纹')
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
    projectId: f.scope.projectId, parentId: null, type: 'chapter', title, summary: '阿明在港口拾起铜钥匙。', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', {
    projectId: f.scope.projectId, outlineNodeId, title, content: manuscript, status: 'draft', wordCount: 22, order: 0, notes: '', createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const target = node(templateId, { chapterTitle: title })
  const graph = emptyAuthoringGraph()
  graph.nodes.push(target)
  if (templateId === 'chapter.organize') {
    // This public API supports selecting only one node in a valid graph. The
    // organizer resolves the saved Canon chapter; no prose generation is run.
    const upstream = node('chapter.prose', { chapterTitle: title })
    graph.nodes.push(upstream)
    graph.edges.push({ id: 'saved-chapter', sourceNodeId: upstream.id, sourcePortId: 'candidate', targetNodeId: target.id, targetPortId: 'chapter' })
  }
  const runNodeIds = new Set([target.id])
  if (options.budget) {
    const budget = node('control.context-budget', { value: options.budget })
    graph.nodes.push(budget)
    graph.edges.push({ id: 'actual-budget', sourceNodeId: budget.id, sourcePortId: 'value',
      targetNodeId: target.id, targetPortId: target.inputs.find(port => port.semantic === 'control.context-budget')!.id })
    runNodeIds.add(budget.id)
  }
  const flowId = await db.nodeFlows.add(stampNewRecord(f.scope, 'nodeFlows', {
    projectId: f.scope.projectId, worldGroupId: null, name: '052正式来源', description: '', graphJson: JSON.stringify(graph), createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const flow = (await db.nodeFlows.get(flowId))! as NodeFlow
  duringHttp = options.duringHttp ? () => options.duringHttp!(chapterId) : undefined
  const generated = await runAuthoringGraph({ flow, runNodeIds })
  expect(generated.run.status).toBe('completed')
  expect(generated.candidates[target.id].status).toBe('candidate')
  expect(generated.candidates[target.id].domain?.kind).toBe(templateId === 'continuity.fact' ? 'facts' : 'chapter-organization')
  expect(fetch).toHaveBeenCalledTimes(1)
  await expect.poll(() => db.aiUsageLog.count()).toBe(1)
  expect(await db.temporalFacts.count()).toBe(0)
  if (!options.duringHttp) expect((await db.chapters.get(chapterId))?.content).toBe(manuscript)
  return { ...f, chapterId, outlineNodeId, flow, target, generated }
}

function freshness(f: Awaited<ReturnType<typeof generate>>, generated: AuthoringRunUpdate = f.generated) {
  return inspectAuthoringGraphFreshness({ flow: f.flow, scope: f.scope, snapshots: generated.snapshots, candidates: generated.candidates })
}

it.each(['continuity.fact', 'chapter.organize'] as const)('unchanged %s uses the same canonical source fingerprint without another model call', async templateId => {
  const f = await generate(templateId)
  const before = (await db.nodeRuns.get(f.generated.run.id!))!
  const report = await freshness(f)
  expect(report[f.target.id]).toMatchObject({ status: 'fresh', reasons: [] })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect((await db.nodeRuns.get(before.id!))?.inputSnapshotsJson).toBe(before.inputSnapshotsJson)
})

it.each(['continuity.fact', 'chapter.organize'] as const)('changed manuscript keeps %s stale without rewriting the frozen candidate', async templateId => {
  const f = await generate(templateId)
  const before = (await db.nodeRuns.get(f.generated.run.id!))!
  await db.chapters.update(f.chapterId, { content: '<p>作者已把来信和铜钥匙锁进抽屉。</p>' })
  expect((await freshness(f))[f.target.id]).toMatchObject({ status: 'stale', reasons: ['source-updated'] })
  const after = (await db.nodeRuns.get(before.id!))!
  expect(after.inputSnapshotsJson).toBe(before.inputSnapshotsJson)
  expect(after.nodeResultsJson).toBe(before.nodeResultsJson)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['continuity.fact', 'chapter.organize'] as const)('a changed chapter title sent to the model invalidates %s', async templateId => {
  const f = await generate(templateId)
  await db.chapters.update(f.chapterId, { title: '改名后的原章节' })
  expect((await freshness(f))[f.target.id]).toMatchObject({ status: 'stale', reasons: ['source-updated'] })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([['continuity.fact', 'fresh'], ['chapter.organize', 'stale']] as const)('a new known item only invalidates the node that reads it: %s', async (templateId, expected) => {
  const f = await generate(templateId)
  await db.itemLedger.add(stampNewRecord(f.scope, 'itemLedger', {
    projectId: f.scope.projectId, itemName: '作者新登记的航海图', action: 'gain', quantity: 1, heldByName: '阿明', createdAt: 1,
  }, { owner: 'work' }))
  expect((await freshness(f))[f.target.id].status).toBe(expected)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['continuity.fact', 'chapter.organize'] as const)('unread chapter metadata does not invalidate %s', async templateId => {
  const f = await generate(templateId)
  await db.chapters.update(f.chapterId, { notes: '作者自己的非输入备忘', updatedAt: Date.now() })
  expect((await freshness(f))[f.target.id]).toMatchObject({ status: 'fresh', reasons: [] })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['continuity.fact', 'chapter.organize'] as const)('deleted original chapter cannot certify %s against another source', async templateId => {
  const f = await generate(templateId)
  await db.chapters.delete(f.chapterId)
  expect((await freshness(f))[f.target.id]).toMatchObject({ status: 'stale', reasons: ['source-missing'] })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['continuity.fact', 'chapter.organize'] as const)('another Work cannot read the old %s source as its own', async templateId => {
  const f = await generate(templateId)
  const other = await createWorldWork(f.scope.projectId, { title: '052另一作品', kind: 'novel', novelProfile: 'long' })
  const otherScope = await switchActiveWork(f.scope.projectId, other.id!)
  const report = await inspectAuthoringGraphFreshness({ flow: f.flow, scope: otherScope,
    snapshots: f.generated.snapshots, candidates: f.generated.candidates })
  expect(report[f.target.id]).toMatchObject({ status: 'stale', reasons: ['source-missing'] })
  expect((await db.chapters.get(f.chapterId))?.content).toBe(manuscript)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['continuity.fact', 'chapter.organize'] as const)('actual upstream budget and route are frozen for %s instead of taking later defaults', async templateId => {
  const f = await generate(templateId, { budget: 12_000 })
  expect(f.generated.snapshots[f.target.id].sourceEvidence?.canonicalContext).toMatchObject({
    scheme: 'registered-chapter-context-v2', inputBudgetTokens: 12_000, provider: config.provider, model: config.model,
  })
  useAIConfigStore.setState({ config: { ...config, model: 'later-route', contextWindow: 2000 } })
  expect((await freshness(f))[f.target.id]).toMatchObject({ status: 'fresh', reasons: [] })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['continuity.fact', 'chapter.organize'] as const)('legacy %s without original policy evidence stays stale and is never re-signed', async templateId => {
  const f = await generate(templateId)
  const legacy = structuredClone(f.generated.snapshots)
  delete legacy[f.target.id].sourceEvidence!.canonicalContext
  const oldJson = JSON.stringify(legacy)
  await db.nodeRuns.update(f.generated.run.id!, { inputSnapshotsJson: oldJson })
  const stored = (await db.nodeRuns.get(f.generated.run.id!))!
  const report = await freshness(f, { ...f.generated, snapshots: JSON.parse(stored.inputSnapshotsJson) })
  expect(report[f.target.id]).toMatchObject({ status: 'stale', reasons: ['source-missing'] })
  expect((await db.nodeRuns.get(stored.id!))?.inputSnapshotsJson).toBe(oldJson)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not certify a candidate paired with another snapshot', async () => {
  const f = await generate('continuity.fact')
  const candidates = structuredClone(f.generated.candidates)
  candidates[f.target.id].signature!.sourceHash = 'different-original-source'
  const report = await freshness(f, { ...f.generated, candidates })
  expect(report[f.target.id]).toMatchObject({ status: 'stale', reasons: ['source-missing'] })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['registered-chapter-context-v1', 'unknown-v9'])('incomplete or unsupported fingerprint scheme %s is never upgraded in place', async scheme => {
  const f = await generate('continuity.fact')
  const maps = JSON.parse(JSON.stringify(f.generated.snapshots))
  maps[f.target.id].sourceEvidence.canonicalContext.scheme = scheme
  const oldJson = JSON.stringify(maps)
  await db.nodeRuns.update(f.generated.run.id!, { inputSnapshotsJson: oldJson })
  expect((await freshness(f, { ...f.generated, snapshots: maps }))[f.target.id]).toMatchObject({ status: 'stale', reasons: ['source-missing'] })
  expect((await db.nodeRuns.get(f.generated.run.id!))?.inputSnapshotsJson).toBe(oldJson)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('source edits while the HTTP result is in flight do not certify the newer manuscript', async () => {
  const newer = '<p>作者在生成期间写好的新版本。</p>'
  const f = await generate('continuity.fact', { duringHttp: async chapterId => {
    await db.chapters.update(chapterId, { content: newer })
  } })
  expect((await freshness(f))[f.target.id]).toMatchObject({ status: 'stale', reasons: ['source-updated'] })
  expect((await db.chapters.get(f.chapterId))?.content).toBe(newer)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['continuity.fact', 'chapter.organize'] as const)('a newly confirmed Canon fact invalidates the captured %s sources', async templateId => {
  const f = await generate(templateId)
  const adopted = await adoptFactCandidates({ projectId: f.scope.projectId, scope: f.scope,
    sourceChapterId: f.chapterId, worldGroupId: null,
    candidates: [{ subjectName: '阿明', predicate: 'healthStatus', factKind: 'state', value: '受伤', sourceQuote: fact.quote }] })
  expect(adopted.written).toBe(1)
  const row = (await db.temporalFacts.toArray())[0]
  expect((await confirmFactCandidate(row.id!)).confirmed).toBe(true)
  expect((await freshness(f))[f.target.id]).toMatchObject({ status: 'stale', reasons: ['source-updated'] })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('real backup roundtrip preserves source policy and checks the restored Canon without model dispatch', async () => {
  const f = await generate('continuity.fact', { budget: 12_000 })
  const policy = structuredClone(f.generated.snapshots[f.target.id].sourceEvidence!.canonicalContext)
  const backup = await exportProjectJSON(f.scope.projectId)
  const before = JSON.stringify(backup)
  await db.delete(); await db.open()
  const projectId = await importProjectJSON(backup)
  const scope = await resolveWorkspaceScope(projectId)
  const flow = (await db.nodeFlows.where('projectId').equals(projectId).first())! as NodeFlow
  const run = (await db.nodeRuns.where('flowId').equals(flow.id!).first())!
  const snapshots = JSON.parse(run.inputSnapshotsJson) as AuthoringRunUpdate['snapshots']
  const candidates = JSON.parse(run.nodeResultsJson) as AuthoringRunUpdate['candidates']
  expect(snapshots[f.target.id].sourceEvidence?.canonicalContext).toEqual(policy)
  expect((await inspectAuthoringGraphFreshness({ flow, scope, snapshots, candidates }))[f.target.id]).toMatchObject({ status: 'fresh', reasons: [] })
  expect(JSON.stringify(backup)).toBe(before)
  expect(fetch).toHaveBeenCalledTimes(1)
})
