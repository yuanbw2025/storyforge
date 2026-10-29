import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { prepareStoryArcCopilot, adoptRestoredStoryArcCandidate, parseStoryArcMutationRequestV1, revalidateStoryArcCreativeDraftV1, runStoryArcCreativeReliabilityV1 } from '../../src/lib/agent/story-arc-copilot'
import { adoptGenerationNodeOutput, runGenerationNode } from '../../src/lib/generation/generation-node'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { restoreMasterAgentCandidatesV1, runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'

const original = structuredClone(useAIConfigStore.getState().config)
const target = { id: 'route-stage', title: '核验路标', description: '先测绳再确定通行', keyEvents: ['测绳', '记录', '校核', '报告', '等待批复'], turningPoint: '', authorNote: '不可被模型删除' }
const untouched = { id: 'other-stage', title: '', description: '', keyEvents: [], startVolume: 2, authorNote: '未填写的作者阶段也保留' }
async function fixture(two = false) {
  const f = await seedCurrentWorkspace('阶段事件单一入口')
  const arcId = await db.storyArcs.add(stampNewRecord(f.scope, 'storyArcs', { projectId: f.scope.projectId, name: '探路主线', type: 'main', stages: JSON.stringify(two ? [target, untouched] : [target]), description: '', origin: 'manual', status: 'active', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  return { ...f, arcId }
}
function mutation(arcId: number, kind = 'append', stageId = target.id) {
  return { operation: kind === 'append' ? 'expand' : 'replan', targetArcId: arcId, stageEvents: { version: 1, kind, stageId } } as any
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>, events: string[], kind = 'append', runAI = vi.fn(async () => JSON.stringify({ keyEvents: events }))) {
  const prepared = await prepareStoryArcCopilot({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, authorRequest: '只处理指定阶段事件，其余内容原样保留', mutationRequest: mutation(f.arcId, kind) }, { runAI })
  return { ...prepared, runAI }
}
describe.sequential('STAB · stage-scoped story arc append and exact permutation', () => {
  beforeEach(async () => { await db.delete(); await db.open(); useAIConfigStore.setState({ config: { ...original, provider: 'ollama', model: 'scoped-event-test', baseUrl: 'https://event.invalid/v1', maxTokens: 10000, contextWindow: 128000 } }) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close(); useAIConfigStore.setState({ config: original }) })
  it('单阶段已有5事件仍可追加，其他内容、可选空值及作者扩展字段保留', async () => {
    const f = await fixture(); const events = [...target.keyEvents, '按实测结果封闭危险支路']
    const p = await prepare(f, events); const before = await db.storyArcs.get(f.arcId)
    const generated = await runGenerationNode(p.node, p.prepared)
    expect(generated.gate?.status).toBe('pass'); expect(await db.storyArcs.get(f.arcId)).toEqual(before)
    const adopted = await adoptGenerationNodeOutput(p.node, generated.output)
    expect(adopted.adopted).toBe(true)
    const row = (await db.storyArcs.get(f.arcId))!; expect(row.name).toBe(before!.name); expect(row.description).toBe('')
    expect(JSON.parse(row.stages)).toEqual([{ ...target, keyEvents: events }])
    expect(p.runAI).toHaveBeenCalledTimes(1)
  })
  it('其他空白手工阶段不被补全，刷新式compact候选只采纳所选事件', async () => {
    const f = await fixture(true); const events = [...target.keyEvents, '保留余量']
    const p = await prepare(f, events)
    await adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify({ keyEvents: events }) })
    expect(JSON.parse((await db.storyArcs.get(f.arcId))!.stages)).toEqual([{ ...target, keyEvents: events }, untouched])
  })
  it.each([
    ['覆盖既有事件', ['新改写', ...target.keyEvents.slice(1), '新增']],
    ['重复已有', [...target.keyEvents, '测绳']],
    ['新增超限', [...target.keyEvents, '1', '2', '3', '4', '5', '6']],
    ['错误类型', [...target.keyEvents, 2]],
  ])('%s 拒绝，不写正式故事线', async (_label, events) => {
    const f = await fixture(); const p = await prepare(f, events as string[]); const before = await db.storyArcs.get(f.arcId)
    await expect(adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify({ keyEvents: events }) })).rejects.toThrow()
    expect(await db.storyArcs.get(f.arcId)).toEqual(before)
  })
  it('排序严格保留事件多重集，只调整顺序，不改别的阶段', async () => {
    const f = await fixture(true); const events = [...target.keyEvents].reverse(); const p = await prepare(f, events, 'sort')
    const generated = await runGenerationNode(p.node, p.prepared); expect(generated.gate?.status).toBe('pass')
    await adoptGenerationNodeOutput(p.node, generated.output)
    expect(JSON.parse((await db.storyArcs.get(f.arcId))!.stages)).toEqual([{ ...target, keyEvents: events }, untouched])
  })
  it('排序不得新增、删除、改写事件，运行时伪造其他字段也被gate拒绝', async () => {
    const f = await fixture(); const p = await prepare(f, [...target.keyEvents], 'sort'); const before = await db.storyArcs.get(f.arcId)
    await expect(adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify({ keyEvents: [...target.keyEvents.slice(1), '另一条'] }) })).rejects.toThrow('排序')
    const generated = await runGenerationNode(p.node, p.prepared); generated.output[0].description = '不应改动'
    expect((await adoptGenerationNodeOutput(p.node, generated.output)).adopted).toBe(false)
    expect(await db.storyArcs.get(f.arcId)).toEqual(before)
  })
  it('过期候选和不存在阶段在模型或写入之前拒绝', async () => {
    const f = await fixture(); const events = [...target.keyEvents, '新增']; const p = await prepare(f, events)
    await db.storyArcs.update(f.arcId, { description: '作者新稿' })
    await expect(adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify({ keyEvents: events }) })).rejects.toThrow('变化')
    const runAI = vi.fn(async () => '{}')
    await expect(prepareStoryArcCopilot({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, authorRequest: '阶段事件', mutationRequest: mutation(f.arcId, 'append', 'missing') }, { runAI })).rejects.toThrow('阶段')
    expect(runAI).not.toHaveBeenCalled()
  })
  it('真实生产creative链生成compact候选，作者修订保留原调用证据并严格复核', async () => {
    const f = await fixture(); const events = [...target.keyEvents, '新增']; const p = await prepare(f, events)
    const result = await runStoryArcCreativeReliabilityV1({ prepared: p, qualityMode: 'balanced', budget: new AgentTeamBudgetTracker('balanced') })
    expect(JSON.parse(result.draft)).toEqual({ keyEvents: events })
    expect(result.artifact.status).toBe('ready')
    const invalid = revalidateStoryArcCreativeDraftV1({ draft: JSON.stringify({ keyEvents: ['擅改已有'] }), snapshot: p.snapshot, kind: p.kind, mutation: p.mutation, previousArtifact: result.artifact })
    expect(invalid.status).not.toBe('ready'); expect(invalid.callEvidence).toEqual(result.artifact.callEvidence)
    expect(await db.storyArcs.count()).toBe(1)
  })
  it('durable完整生产、恢复和采纳共用compact解析，并核对精确原记录终态', async () => {
    const f = await fixture(true); const events = [...target.keyEvents, '确认封路']
    const conversation = await getOrCreateAgentConversation({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'master-authoring' })
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ keyEvents: events }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 50, total_tokens: 100 } })))
    vi.stubGlobal('fetch', fetch)
    const run = await runDurableMasterAgentPlanV1({ scope: f.scope, worldGroupId: null, conversationId: conversation.id!, plan: { summary: '只追加事件', tasks: [{ id: 'append-events', agentId: 'outline', skillId: 'outline.story-arcs', instruction: '只追加指定阶段事件', dependsOn: [], storyArcMutationRequest: mutation(f.arcId) }], workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] } }, budget: new AgentTeamBudgetTracker('balanced') })
    expect(run.projection.state).toBe('awaiting_confirmation')
    expect(JSON.parse(run.candidates[0].draft)).toEqual({ keyEvents: events })
    expect(JSON.parse((await db.storyArcs.get(f.arcId))!.stages)).toEqual([target, untouched])
    const restored = await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: run.runId })
    expect(restored.candidates[0].payload.storyArcMutationRequest).toEqual(mutation(f.arcId))
    await commitMasterAgentCandidateAdoptionV1({ scope: f.scope, runId: run.runId, candidateEventId: restored.candidates[0].event.id! })
    expect((await verifyMasterAgentRunV1({ scope: f.scope, runId: run.runId })).accepted).toBe(true)
    expect(JSON.parse((await db.storyArcs.get(f.arcId))!.stages)).toEqual([{ ...target, keyEvents: events }, untouched])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('仅改事件时保留缺失description及原阶段身份字节，不展开旧记录', async () => {
    const f = await fixture(); const id = ' route-stage '
    await db.storyArcs.update(f.arcId, { description: undefined, stages: JSON.stringify([{ ...target, id }]) })
    const before = (await db.storyArcs.get(f.arcId))!
    const request = mutation(f.arcId, 'append', id)
    expect(parseStoryArcMutationRequestV1(request).stageEvents?.stageId).toBe(id)
    const p = await prepareStoryArcCopilot({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, authorRequest: '只追加事件', mutationRequest: request }, { runAI: async () => '{}' })
    await adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify({ keyEvents: [...target.keyEvents, '追加'] }) })
    const after = (await db.storyArcs.get(f.arcId))!
    expect(Object.prototype.hasOwnProperty.call(after, 'description')).toBe(Object.prototype.hasOwnProperty.call(before, 'description'))
    expect(after.description).toBe(before.description); expect(JSON.parse(after.stages)[0].id).toBe(id)
  })
  it('重复事件排序按多重集校验，保持原文字、重复次数与空字符串', async () => {
    const f = await fixture(); const events = ['甲', '甲', '乙', '']
    await db.storyArcs.update(f.arcId, { stages: JSON.stringify([{ ...target, keyEvents: events }]) })
    const p = await prepare(f, [...events].reverse(), 'sort')
    await adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify({ keyEvents: [...events].reverse() }) })
    expect(JSON.parse((await db.storyArcs.get(f.arcId))!.stages)[0].keyEvents).toEqual([...events].reverse())
  })
  it.each([
    { operation: 'create', stageEvents: { version: 1, kind: 'append', stageId: target.id } },
    { operation: 'replan', targetArcId: 1, stageEvents: { version: 1, kind: 'append', stageId: target.id } },
    { operation: 'expand', targetArcId: 1, stageEvents: { version: 2, kind: 'append', stageId: target.id } },
    { operation: 'expand', targetArcId: 1, stageEvents: { version: 1, kind: 'append', stageId: target.id, workId: 999 } },
  ])('错误或含身份字段的范围请求拒绝：%j', request => {
    expect(() => parseStoryArcMutationRequestV1(request)).toThrow()
  })
  it('外作品目标不能借同名阶段启动模型', async () => {
    const a = await fixture(); const b = await fixture(); const runAI = vi.fn(async () => '{}')
    await expect(prepareStoryArcCopilot({ projectId: b.scope.projectId, scope: b.scope, worldGroupId: null, authorRequest: '追加阶段事件', mutationRequest: mutation(a.arcId) }, { runAI })).rejects.toThrow('当前作品')
    expect(runAI).not.toHaveBeenCalled()
  })
  it('局部事件采纳不改整线状态、来源和意图对齐信息', async () => {
    const f = await fixture(); const metadata = { origin: 'import' as const, status: 'deprecated' as const, lastAlignedHash: 'b'.repeat(64) }
    await db.storyArcs.update(f.arcId, metadata)
    const p = await prepare(f, [...target.keyEvents, '只新增计划事件'])
    await adoptRestoredStoryArcCandidate({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, snapshot: p.snapshot, mutation: p.mutation, draft: JSON.stringify({ keyEvents: [...target.keyEvents, '只新增计划事件'] }) })
    expect(await db.storyArcs.get(f.arcId)).toMatchObject(metadata)
    expect((await db.storyArcs.get(f.arcId))?.producerRunId).toBeUndefined()
  })
})
