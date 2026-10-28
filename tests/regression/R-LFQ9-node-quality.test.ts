import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../src/lib/agent/formal-ai-entry', async () => ({ ...await vi.importActual('../../src/lib/agent/formal-ai-entry'), executeRegisteredAIEntryV1: vi.fn() }))
import { executeRegisteredAIEntryV1 } from '../../src/lib/agent/formal-ai-entry'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord, resolveScope } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance, type AuthoringInputEnvelope } from '../../src/lib/node-authoring/contracts'
import { authoringDomainActionBindingV1 } from '../../src/lib/node-authoring/domain-action-registry'
import { authoringPortsCompatible } from '../../src/lib/node-authoring/compatibility'
import { executeDomainNode, adoptDomainCandidate } from '../../src/lib/node-authoring/domain-execution'
import { runAuthoringGraph, reviseAuthoringCandidate, buildAuthoringExecutionPlan } from '../../src/lib/node-authoring/executor'
import { readLatestWholeChapterQualityReviewV1 } from '../../src/lib/agent/run/quality-review-durable'
import { isQualityAuthoringReportCurrentV1 } from '../../src/lib/node-authoring/quality-execution'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'

const old = useAIConfigStore.getState()
const cfg = { ...old.config, provider: 'ollama' as const, model: 'node-quality', contextWindow: 128000, temperature: .7, maxTokens: 4000 }
const template = AUTHORING_NODE_BY_ID.get('chapter.quality-review')!
const node = (): AuthoringNodeInstance => ({ id: 'review', templateId: template.id, templateVersion: 1, title: template.label, x: 0, y: 0, config: { ...defaultConfigForTemplate(template), chapterTitle: '签字' }, inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) })
async function seed() {
  const f = await seedCurrentWorkspace('节点与分步骤共用审修')
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', { projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '签字', summary: '保留一百二十元，签字处停笔', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  const content = '<p>金额一百二十元。</p><p>陈禾签字，正文到此结束。</p>'
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', { projectId: f.scope.projectId, outlineNodeId, title: '签字', content, wordCount: 25, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  return { ...f, outlineNodeId, chapterId, content }
}
function args(f: Awaited<ReturnType<typeof seed>>, n = node(), inputs: AuthoringInputEnvelope[] = []) { return { node: n, scope: f.scope, projectId: f.scope.projectId, worldGroupId: null, aiConfig: cfg, inputs } }
function control(semantic: AuthoringInputEnvelope['semantic'], content: string): AuthoringInputEnvelope { return { sourceNodeId: semantic, sourcePortId: 'value', targetPortId: semantic, semantic, state: 'control', cardinality: 'one', content, tokens: 8 } }

describe('LFQ9 · 节点复用正式全文评审', () => {
  beforeEach(async () => {
    await db.delete(); await db.open(); useAIConfigStore.setState({ config: cfg, taskRoutes: {} })
    vi.mocked(executeRegisteredAIEntryV1).mockReset().mockImplementation(async (_id, _messages, _config, _metadata, _signal, result) => {
      if (result) result.finishReason = 'stop'
      return JSON.stringify({ summary: '结尾混入任务说明', strengths: ['金额保留'], issues: [{ dimension: 'voice', confidence: 'suggestion', quote: '正文到此结束。', start: null, end: null, reason: '任务语言进入正文', suggestion: '保留签字，移除任务说明' }] })
    })
  })
  afterEach(() => { useAIConfigStore.setState(old, true); db.close() })

  it('正文端口只接受Canon，报告只读且不是正文；合同复用正式Skill', () => {
    expect(authoringDomainActionBindingV1(template)).toMatchObject({ skillId: 'prose.quality-review', adoptionBoundary: 'read-only-report' })
    expect(template.writes).toBeUndefined()
    const input = template.inputs.find(row => row.id === 'chapter')!
    expect(authoringPortsCompatible({ ...input, state: 'candidate' }, input)).toBe(false)
    expect(authoringPortsCompatible(template.outputs[0], input)).toBe(false)
    expect(buildAuthoringExecutionPlan({ graph: { ...emptyAuthoringGraph(), nodes: [node()] } })).toMatchObject({ estimatedAiCalls: 1, estimatedMaxAiCalls: 1 })
  })

  it('节点请求保留零温度、输出控制和作者Prompt，分步骤回读同一报告；默认不重复调用', async () => {
    const f = await seed(); const n = node()
    const inputs = [control('control.temperature', '0'), control('control.max-tokens', '2400')]
    const result = await executeDomainNode(args(f, n, inputs))
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(1)
    expect(vi.mocked(executeRegisteredAIEntryV1).mock.calls[0][2]).toMatchObject({ temperature: 0, maxTokens: 2400 })
    const step = await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode: 'quality' })
    expect(JSON.parse(result!.output)).toEqual(step!.report)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.content)
    await executeDomainNode(args(f, n, inputs)); expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(1)
    await executeDomainNode(args(f, n, [...inputs, control('control.prompt', '保持舒缓，不强制悬念')]))
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(2)
    expect(vi.mocked(executeRegisteredAIEntryV1).mock.calls[1][1].some(message => message.content.includes('保持舒缓，不强制悬念'))).toBe(true)
    await executeDomainNode(args(f, n, [...inputs, control('control.prompt', '保持舒缓，不强制悬念')]))
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(2)
    await expect(adoptDomainCandidate({ ...args(f), domain: result!.domain, output: result!.output })).rejects.toThrow('只读')
  })

  it('缺失、重复或错误目标及未采纳上游正文在发模型前拒绝，原稿保留', async () => {
    const f = await seed(); const n = node(); n.config.chapterTitle = '不存在'
    await expect(executeDomainNode(args(f, n))).rejects.toThrow('未回退')
    const incoming: AuthoringInputEnvelope = { sourceNodeId: 'prose', sourcePortId: 'candidate', targetPortId: 'chapter', semantic: 'chapter.prose', cardinality: 'one', state: 'candidate', content: '未确认稿', tokens: 5 }
    await expect(executeDomainNode(args(f, node(), [incoming]))).rejects.toThrow('请先确认')
    const other = await seedCurrentWorkspace('其它作品')
    await expect(executeDomainNode({ ...args(f), projectId: other.scope.projectId, scope: other.scope })).rejects.toThrow('未回退')
    await db.chapters.add(stampNewRecord(f.scope, 'chapters', { ...(await db.chapters.get(f.chapterId))!, id: undefined }, { owner: 'work' }))
    await expect(executeDomainNode(args(f))).rejects.toThrow('唯一')
    expect(executeRegisteredAIEntryV1).not.toHaveBeenCalled()
  })

  it('Agnes使用同一冻结思考参数匹配缓存，分步骤报告回读后再次运行节点不重复调用', async () => {
    const f = await seed(); const aiConfig = { ...cfg, provider: 'agnes' as const, model: 'agnes-2.5-flash', apiKey: 'isolated-test-token' }
    const input = { ...args(f), aiConfig }
    const first = await executeDomainNode(input)
    expect(vi.mocked(executeRegisteredAIEntryV1).mock.calls[0][6]).toEqual({ responseFormat: 'json_object', thinkingMode: 'disabled' })
    const report = await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode: 'quality' })
    expect(report?.report.reviewer.settings.parameters.chat_template_kwargs).toEqual({ enable_thinking: false })
    const second = await executeDomainNode(input)
    expect(JSON.parse(second!.output)).toEqual(JSON.parse(first!.output))
    expect(executeRegisteredAIEntryV1).toHaveBeenCalledTimes(1)
  })

  it('节点图刷新记录只保存报告证据；作品变更即过期，导入历史不能恢复旧回执或写正文', async () => {
    const f = await seed(); const graph = { ...emptyAuthoringGraph(), nodes: [node()] }
    const id = await db.nodeFlows.add(stampNewRecord(f.scope, 'nodeFlows', { projectId: f.scope.projectId, worldGroupId: null, name: '审修', description: '', graphJson: JSON.stringify(graph), createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
    const flow = (await db.nodeFlows.get(id))!
    const run = await runAuthoringGraph({ flow })
    expect(run.run.status).toBe('completed')
    await expect(reviseAuthoringCandidate({ flow, runId: run.run.id!, nodeId: 'review', output: '伪造建议' })).rejects.toThrow('只读')
    const reportHash = JSON.parse(run.candidates.review.output).artifactHash
    expect(await isQualityAuthoringReportCurrentV1({ projectId: f.scope.projectId, worldGroupId: null, node: node(), mode: 'quality', reportHash })).toBe(true)
    const backup = await exportProjectJSON(f.scope.projectId); const importedId = await importProjectJSON(backup); const importedScope = await resolveScope({ projectId: importedId }); const importedChapter = await db.chapters.where('projectId').equals(importedId).first()
    expect(await readLatestWholeChapterQualityReviewV1({ scope: importedScope, chapterId: importedChapter!.id!, mode: 'quality' })).toBeNull()
    await cascadeDeleteProject(importedId)
    expect((await db.chapters.get(f.chapterId))!.content).toBe(f.content)
    await db.works.update(f.scope.workId, { description: '作者修改场景方向', updatedAt: Date.now() })
    expect(await isQualityAuthoringReportCurrentV1({ projectId: f.scope.projectId, worldGroupId: null, node: node(), mode: 'quality', reportHash })).toBe(false)
  })
})
