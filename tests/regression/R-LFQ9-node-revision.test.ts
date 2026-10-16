import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../src/lib/agent/formal-ai-entry', async () => ({ ...await vi.importActual('../../src/lib/agent/formal-ai-entry'), executeRegisteredAIEntryV1: vi.fn() }))
import { executeRegisteredAIEntryV1 } from '../../src/lib/agent/formal-ai-entry'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord, resolveScope } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance, type AuthoringInputEnvelope } from '../../src/lib/node-authoring/contracts'
import { executeDomainNode, adoptDomainCandidate } from '../../src/lib/node-authoring/domain-execution'
import { runAuthoringGraph, reviseAuthoringCandidate, adoptAuthoringCandidate, persistAdoptedAuthoringCandidate, buildAuthoringExecutionPlan } from '../../src/lib/node-authoring/executor'
import { readLatestWholeChapterQualityReviewV1 } from '../../src/lib/agent/run/quality-review-durable'
import { readLatestQualityRevisionV1 } from '../../src/lib/agent/run/quality-revision-durable'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'

const old = useAIConfigStore.getState()
const cfg = { ...old.config, provider: 'ollama' as const, model: 'node-revision', contextWindow: 128000, temperature: 0, maxTokens: 4000 }
function node(templateId: string, config: Record<string, unknown> = {}): AuthoringNodeInstance {
  const t = AUTHORING_NODE_BY_ID.get(templateId)!
  return { id: templateId, templateId, templateVersion: 1, title: t.label, x: templateId.endsWith('revision') ? 300 : 0, y: 0, config: { ...defaultConfigForTemplate(t), chapterTitle: '签字', ...config }, inputs: structuredClone(t.inputs), outputs: structuredClone(t.outputs) }
}
async function seed() {
  const f = await seedCurrentWorkspace('独立节点范围修订')
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', { projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '签字', summary: '保留一百二十元，签字后停笔', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  const content = '<p><strong>金额一百二十元。</strong></p><p>陈禾签字，正文到此结束。</p>'
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', { projectId: f.scope.projectId, outlineNodeId, title: '签字', content, wordCount: 25, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  await executeDomainNode({ node: node('chapter.quality-review'), scope: f.scope, projectId: f.scope.projectId, worldGroupId: null, aiConfig: cfg, inputs: [] })
  const review = (await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId, mode: 'quality' }))!
  const repair = node('chapter.quality-revision', { reportHash: review.report.artifactHash, selectedIssueIds: [review.report.issues[0].id] })
  const reportInput: AuthoringInputEnvelope = { sourceNodeId: 'chapter.quality-review', sourcePortId: 'report', targetPortId: 'report', semantic: 'chapter.quality-review', cardinality: 'one', state: 'candidate', content: JSON.stringify(review.report), tokens: 400 }
  const graph = { ...emptyAuthoringGraph(), nodes: [node('chapter.quality-review'), repair], edges: [{ id: 'report-repair', sourceNodeId: 'chapter.quality-review', sourcePortId: 'report', targetNodeId: repair.id, targetPortId: 'report' }] }
  const flowId = await db.nodeFlows.add(stampNewRecord(f.scope, 'nodeFlows', { projectId: f.scope.projectId, worldGroupId: null, name: '审修链', description: '', graphJson: JSON.stringify(graph), createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  const flow = (await db.nodeFlows.get(flowId))!
  return { ...f, outlineNodeId, chapterId, content, review, repair, reportInput, graph, flow }
}
function args(f: Awaited<ReturnType<typeof seed>>) { return { node: f.repair, inputs: [f.reportInput], projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, aiConfig: cfg } }

describe('LFQ9 · 可组合的范围修订节点', () => {
  beforeEach(async () => {
    const held = new Set<string>()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, _options: unknown, fn: (lock: unknown) => Promise<unknown>) => { if (held.has(name)) return fn(null); held.add(name); try { return await fn({ name }) } finally { held.delete(name) } } } })
    await db.delete(); await db.open(); useAIConfigStore.setState({ config: cfg, taskRoutes: {} })
    vi.mocked(executeRegisteredAIEntryV1).mockReset().mockImplementation(async (id, messages, _config, _metadata, _signal, response) => {
      if (response) { response.finishReason = 'stop'; response.usage = { inputTokens: 100, outputTokens: 100, totalTokens: 200 } }
      if (id === 'prose.chapter.quality-revise') return JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '陈禾签字。' }] })
      if (id === 'prose.review.recheck') {
        const issues = JSON.parse(messages[1].content.match(/【冻结计划 [^\n]+】\n([^\n]+)/)![1])
        return JSON.stringify({ review: { summary: '任务说明已移除', strengths: [], issues: [] }, outcomes: [{ issueId: issues[0].id, status: 'improved', quote: '陈禾签字。', reason: '保留签字且移除任务语言' }] })
      }
      return JSON.stringify({ summary: '结尾混入任务说明', strengths: ['金额保留'], issues: [{ dimension: 'voice', confidence: 'suggestion', quote: '正文到此结束。', start: null, end: null, reason: '任务语言混入', suggestion: '保留签字，移除说明' }] })
    })
  })
  afterEach(() => { useAIConfigStore.setState(old, true); db.close() })

  it('图内复用已审原文，修订和复核各一次；恢复同一候选零模型调用，确认后跨模式回读原格式', async () => {
    const f = await seed(); expect(buildAuthoringExecutionPlan({ graph: f.graph })).toMatchObject({ estimatedAiCalls: 3, estimatedMaxAiCalls: 3 })
    const run = await runAuthoringGraph({ flow: f.flow, targetNodeId: f.repair.id })
    expect(run.run.status).toBe('completed'); expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(3)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.content)
    const restored = await executeDomainNode(args(f))
    expect(restored!.domain).toEqual(run.candidates[f.repair.id].domain); expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(3)
    await adoptAuthoringCandidate({ flow: f.flow, runId: run.run.id!, nodeId: f.repair.id, output: restored!.output })
    await persistAdoptedAuthoringCandidate({ flow: f.flow, runId: run.run.id!, nodeId: f.repair.id, output: restored!.output })
    expect((await db.chapters.get(f.chapterId))!.content).toBe('<p><strong>金额一百二十元。</strong></p><p>陈禾签字。</p>')
    expect((await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId }))!.state).toBe('completed')
    await expect(adoptAuthoringCandidate({ flow: f.flow, runId: run.run.id!, nodeId: f.repair.id, output: restored!.output })).rejects.toThrow('已处理')
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(3)
  })

  it('上游不变时可重新配置下游后另起运行；上游参数或来源变化不能复用', async () => {
    const f = await seed()
    const initialGraph = { ...f.graph, nodes: f.graph.nodes.map(n => n.id === f.repair.id ? { ...n, config: { ...n.config, selectedIssueIds: [] } } : n) }
    await db.nodeFlows.update(f.flow.id!, { graphJson: JSON.stringify(initialGraph) })
    const initialFlow = (await db.nodeFlows.get(f.flow.id!))!
    const base = await runAuthoringGraph({ flow: initialFlow, targetNodeId: 'chapter.quality-review' })
    await db.nodeFlows.update(f.flow.id!, { graphJson: JSON.stringify(f.graph) })
    const selectedFlow = (await db.nodeFlows.get(f.flow.id!))!
    const fresh = await runAuthoringGraph({ flow: selectedFlow, targetNodeId: f.repair.id, baseRunId: base.run.id!, runNodeIds: new Set([f.repair.id]) })
    expect(fresh.run.status).toBe('completed'); expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(3)
    const changedGraph = { ...f.graph, nodes: f.graph.nodes.map(n => n.templateId === 'chapter.quality-review' ? { ...n, config: { ...n.config, request: '改变评审范围' } } : n) }
    await db.nodeFlows.update(f.flow.id!, { graphJson: JSON.stringify(changedGraph) })
    await expect(runAuthoringGraph({ flow: (await db.nodeFlows.get(f.flow.id!))!, targetNodeId: f.repair.id, baseRunId: base.run.id!, runNodeIds: new Set([f.repair.id]) })).rejects.toThrow('上游')
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(3)
  })

  it('节点拒绝处理同一正式候选，原稿不改；禁止修改未经重新复核的节点输出', async () => {
    const f = await seed(); const run = await runAuthoringGraph({ flow: f.flow, targetNodeId: f.repair.id })
    await expect(reviseAuthoringCandidate({ flow: f.flow, runId: run.run.id!, nodeId: f.repair.id, output: '随意改金额' })).rejects.toThrow('只读')
    const candidate = run.candidates[f.repair.id]
    await expect(adoptDomainCandidate({ ...args(f), domain: candidate.domain!, output: '篡改修订稿' })).rejects.toThrow('只读')
    const rejected = await reviseAuthoringCandidate({ flow: f.flow, runId: run.run.id!, nodeId: f.repair.id, reject: true })
    expect(JSON.parse(rejected.nodeResultsJson)[f.repair.id].status).toBe('rejected')
    expect((await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId }))!.state).toBe('cancelled')
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.content)
  })

  it('错误报告、未选问题和变化后的原稿均在修订模型前拒绝', async () => {
    const f = await seed(); const input = args(f)
    await expect(executeDomainNode({ ...input, node: { ...f.repair, config: { ...f.repair.config, reportHash: '错误' } } })).rejects.toThrow('报告已变化')
    await expect(executeDomainNode({ ...input, inputs: [{ ...f.reportInput, content: JSON.stringify({ ...f.review.report, summary: '伪造上游' }) }] })).rejects.toThrow('上游报告')
    await expect(executeDomainNode({ ...input, node: { ...f.repair, config: { ...f.repair.config, selectedIssueIds: [] } } })).rejects.toThrow('明确选择')
    await db.chapters.update(f.chapterId, { content: f.content + '<p>作者新写。</p>' })
    await expect(executeDomainNode(input)).rejects.toThrow('报告已变化')
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(1)
  })

  it('保存候选后变更模型参数不能复用或隐藏重发；上游作品变化拒绝旧候选采纳', async () => {
    const f = await seed(); const result = await executeDomainNode(args(f))
    await expect(executeDomainNode({ ...args(f), aiConfig: { ...cfg, temperature: .9 } })).rejects.toThrow('参数')
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(3)
    await db.works.update(f.scope.workId, { description: '作者改变规则', updatedAt: Date.now() })
    await expect(adoptDomainCandidate({ ...args(f), domain: result!.domain, output: result!.output })).rejects.toThrow('过期')
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.content)
  })

  it('作者补充Prompt进入冻结计划与实际修订请求；改变补充不能复用旧结果', async () => {
    const f = await seed()
    const prompt: AuthoringInputEnvelope = { sourceNodeId: 'prompt', sourcePortId: 'value', targetPortId: 'prompt', semantic: 'control.prompt', cardinality: 'one', state: 'control', content: '保持舒缓，签字后停笔，不增加剧情。', tokens: 20 }
    const input = { ...args(f), inputs: [f.reportInput, prompt] }
    await executeDomainNode(input)
    const writer = vi.mocked(executeRegisteredAIEntryV1).mock.calls.find(row => row[0] === 'prose.chapter.quality-revise')!
    expect(writer[1][1].content).toContain(prompt.content)
    const view = (await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId }))!
    expect(view.draft.plan.authorRequest).toContain(prompt.content)
    await expect(executeDomainNode({ ...input, inputs: [f.reportInput, { ...prompt, content: '改写结尾' }] })).rejects.toThrow('本轮修订已执行')
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(3)
  })

  it('复核失败保留可回读预演，刷新或再次执行不自动发第三次修订请求', async () => {
    const f = await seed()
    vi.mocked(executeRegisteredAIEntryV1).mockReset().mockImplementation(async (id, _messages, _config, _metadata, _signal, response) => {
      if (id === 'prose.review.recheck') throw new Error('断网，结果未知')
      if (response) response.finishReason = 'stop'
      return JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '陈禾签字。' }] })
    })
    await expect(executeDomainNode(args(f))).rejects.toThrow('断网')
    expect((await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId }))!.draft.outputText).toContain('陈禾签字。')
    await expect(executeDomainNode(args(f))).rejects.toThrow('本轮修订已执行')
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(2)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.content)
  })

  it('导入保留历史但不复活旧修订身份，删除副本不影响原稿与候选', async () => {
    const f = await seed(); const run = await runAuthoringGraph({ flow: f.flow, targetNodeId: f.repair.id }); const candidate = run.candidates[f.repair.id]
    const backup = await exportProjectJSON(f.scope.projectId); const importedId = await importProjectJSON(backup); const scope = await resolveScope({ projectId: importedId }); const imported = await db.chapters.where('projectId').equals(importedId).first()
    expect(await readLatestQualityRevisionV1({ scope, chapterId: imported!.id! })).toBeNull()
    await expect(adoptDomainCandidate({ ...args(f), projectId: importedId, scope, domain: candidate.domain!, output: candidate.output })).rejects.toThrow('证据')
    await cascadeDeleteProject(importedId)
    expect((await readLatestQualityRevisionV1({ scope: f.scope, chapterId: f.chapterId }))!.candidate!.durable.candidateHash).toBe((candidate.domain as any).candidateHash)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.content)
  })
})
