import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../src/lib/ai/client', () => ({ chat: vi.fn(async () => JSON.stringify({ field: 'worldOrigin', value: '模型起源' })) }))
import { db } from '../../src/lib/db/schema'
import { chat } from '../../src/lib/ai/client'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { adoptAuthoringCandidate, persistAdoptedAuthoringCandidate, reviseAuthoringCandidate, runAuthoringGraph } from '../../src/lib/node-authoring/executor'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { buildAuthoringCreationChainGraph } from '../../src/lib/node-authoring/creation-chain'
import { inspectAuthoringGraphFreshness } from '../../src/lib/node-authoring/freshness'
import { resolveScopeLike, stampNewRecord } from '../../src/lib/workspace/scope'

function node(templateId: string, id: string): AuthoringNodeInstance {
  const template = AUTHORING_NODE_BY_ID.get(templateId)!
  return { id, templateId, templateVersion: 1, title: template.label, x: 0, y: 0, config: defaultConfigForTemplate(template), inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
}
let projectId: number
async function setup(extra = false, candidateCount = 1) {
  const origin = node('world.origin', 'origin')
  origin.config.candidateCount = candidateCount
  const id = await useNodeFlowStore.getState().createFlow(projectId, null, { graph: { ...emptyAuthoringGraph(), nodes: [origin, ...(extra ? [node('outline.chapter', 'unfinished')] : [])] } })
  return (await db.nodeFlows.get(id))!
}
describe('NODE-2 candidate recovery and local authoring', () => {
  beforeEach(async () => { vi.clearAllMocks(); await db.delete(); await db.open(); projectId = (await seedCurrentWorkspace('节点候选验收')).project.id! })
  afterEach(() => db.close())
  it('runs a selected branch with an unfinished sibling, while whole-graph execution fails before a model call', async () => {
    const flow = await setup(true)
    await expect(runAuthoringGraph({ flow })).rejects.toThrow('缺少必需输入')
    const result = await runAuthoringGraph({ flow, targetNodeId: 'origin' })
    expect(result.run.status).toBe('completed')
    expect(Object.keys(result.candidates)).toEqual(['origin'])
  })
  it('retains author revisions, original model evidence and selected version across backup and restore', async () => {
    const flow = await setup(false, 2)
    const result = await runAuthoringGraph({ flow })
    const output = JSON.stringify({ field: 'worldOrigin', value: '作者修订起源' })
    const revised = await reviseAuthoringCandidate({ flow, runId: result.run.id!, nodeId: 'origin', selectedVariantIndex: 1, output })
    const candidate = JSON.parse(revised.nodeResultsJson).origin
    expect(candidate.output).toBe(output)
    expect(candidate.variants[0]).toContain('模型起源')
    expect(candidate.domain).toEqual(result.candidates.origin.domain)
    expect(candidate.status).toBe('draft')
    expect(candidate.selectedVariantIndex).toBe(1)
    expect(candidate.variants).toHaveLength(2)
    const exported = await exportProjectJSON(projectId)
    const restored = await importProjectJSON(exported)
    const restoredRuns = await db.nodeRuns.where('projectId').equals(restored).toArray()
    expect(JSON.parse(restoredRuns[0].nodeResultsJson).origin.output).toBe(output)
    expect(restoredRuns[0].flowId).not.toBe(flow.id)
    expect(JSON.parse(restoredRuns[0].nodeResultsJson).origin.selectedVariantIndex).toBe(1)
  })
  it('adopts the revised value into the same formal field and prevents re-adoption and post-adoption edits', async () => {
    const flow = await setup(); const result = await runAuthoringGraph({ flow })
    const output = JSON.stringify({ field: 'worldOrigin', value: '作者确认版本' })
    await reviseAuthoringCandidate({ flow, runId: result.run.id!, nodeId: 'origin', output })
    await adoptAuthoringCandidate({ flow, runId: result.run.id, nodeId: 'origin', output })
    await persistAdoptedAuthoringCandidate({ flow, runId: result.run.id!, nodeId: 'origin', output })
    expect((await db.worldviews.where('projectId').equals(projectId).first())?.worldOrigin).toBe('作者确认版本')
    await expect(adoptAuthoringCandidate({ flow, runId: result.run.id, nodeId: 'origin', output })).rejects.toThrow('已处理')
    await expect(reviseAuthoringCandidate({ flow, runId: result.run.id!, nodeId: 'origin', output: '覆盖' })).rejects.toThrow('已处理')
  })
  it('rejects persistently without writing Canon and refuses a candidate after its target configuration changes', async () => {
    const flow = await setup(); const result = await runAuthoringGraph({ flow })
    const changed = JSON.parse(flow.graphJson); changed.nodes[0].config.request = '修改后的方向'
    await expect(adoptAuthoringCandidate({ flow: { ...flow, graphJson: JSON.stringify(changed) }, runId: result.run.id, nodeId: 'origin', output: result.candidates.origin.output })).rejects.toThrow('参数或写入目标已变化')
    const rejected = await reviseAuthoringCandidate({ flow, runId: result.run.id!, nodeId: 'origin', reject: true })
    expect(JSON.parse(rejected.nodeResultsJson).origin.status).toBe('rejected')
    await expect(adoptAuthoringCandidate({ flow, runId: result.run.id, nodeId: 'origin', output: result.candidates.origin.output })).rejects.toThrow('已处理')
    expect(await db.worldviews.where('projectId').equals(projectId).count()).toBe(0)
  })
  it('presentation edits preserve a paused checkpoint but execution edits invalidate it', async () => {
    const flow = await setup(); const controller = new AbortController(); controller.abort('paused')
    const paused = await runAuthoringGraph({ flow, signal: controller.signal })
    const graph = JSON.parse(flow.graphJson); graph.nodes[0].x = 900; graph.nodes[0].favorite = true; graph.viewport.zoom = 0.5
    const resumed = await runAuthoringGraph({ flow: { ...flow, graphJson: JSON.stringify(graph) }, resumeRunId: paused.run.id })
    expect(resumed.run.status).toBe('completed')
    const pausedAgain = await runAuthoringGraph({ flow, signal: controller.signal })
    graph.nodes[0].config.request = '新的创作方向'
    await expect(runAuthoringGraph({ flow: { ...flow, graphJson: JSON.stringify(graph) }, resumeRunId: pausedAgain.run.id })).rejects.toThrow('图已变化')
  })
  it('cannot revise a run owned by another work', async () => {
    const flow = await setup(); const result = await runAuthoringGraph({ flow })
    const other = await seedCurrentWorkspace('隔离作品')
    await expect(reviseAuthoringCandidate({ flow: { ...flow, projectId: other.project.id! }, runId: result.run.id!, nodeId: 'origin', output: '串写' })).rejects.toThrow('不属于当前作品')
  })
  it('cannot mint an adopted flag without the real governed write', async () => {
    const flow = await setup(); const result = await runAuthoringGraph({ flow })
    await expect(persistAdoptedAuthoringCandidate({ flow, runId: result.run.id!, nodeId: 'origin', output: result.candidates.origin.output })).rejects.toThrow('尚未通过正式采纳')
    expect(await db.worldviews.where('projectId').equals(projectId).count()).toBe(0)
    expect(JSON.parse((await db.nodeRuns.get(result.run.id!))!.nodeResultsJson).origin.status).toBe('candidate')
  })
  it('continues from confirmed Canon, rereads current sources without another upstream model call and preserves generation evidence', async () => {
    const { graph, nodeIds } = buildAuthoringCreationChainGraph()
    const id = await useNodeFlowStore.getState().createFlow(projectId, null, { graph })
    const flow = (await db.nodeFlows.get(id))!
    const first = await runAuthoringGraph({ flow, targetNodeId: nodeIds.world })
    const generationSignature = structuredClone(first.candidates[nodeIds.world].signature)
    const generationSnapshot = structuredClone(first.snapshots[nodeIds.world])
    await adoptAuthoringCandidate({ flow, runId: first.run.id!, nodeId: nodeIds.world, output: first.candidates[nodeIds.world].output })
    const confirmed = await persistAdoptedAuthoringCandidate({ flow, runId: first.run.id!, nodeId: nodeIds.world, output: first.candidates[nodeIds.world].output })
    expect(JSON.parse(confirmed.nodeResultsJson)[nodeIds.world].canonReceipt.records[0].documentId).toMatch(/^res:v1:worldview:/)
    vi.mocked(chat).mockResolvedValueOnce(JSON.stringify({ field: 'concept', value: '古城中成长的故事。' }))
    const second = await runAuthoringGraph({ flow, targetNodeId: nodeIds.concept, baseRunId: first.run.id!, runNodeIds: new Set([nodeIds.concept]) })
    expect(second.run.status).toBe('completed')
    expect(chat).toHaveBeenCalledTimes(2)
    expect(second.candidates[nodeIds.context].output).toContain('模型起源')
    expect(second.snapshots[nodeIds.concept].inputs.some(value => value.sourceNodeId === nodeIds.context && value.content.includes('模型起源'))).toBe(true)
    expect(second.candidates[nodeIds.world].signature).toEqual(generationSignature)
    expect(second.snapshots[nodeIds.world]).toEqual(generationSnapshot)
    const restoredId = await importProjectJSON(await exportProjectJSON(projectId))
    const restoredFlow = (await db.nodeFlows.where('projectId').equals(restoredId).first())!
    const restoredRun = (await db.nodeRuns.where('projectId').equals(restoredId).toArray()).sort((a, b) => b.startedAt - a.startedAt)[0]
    const freshness = await inspectAuthoringGraphFreshness({ flow: restoredFlow, candidates: JSON.parse(restoredRun.nodeResultsJson), snapshots: JSON.parse(restoredRun.inputSnapshotsJson) })
    expect(freshness[nodeIds.world].status).toBe('fresh')
    expect(chat).toHaveBeenCalledTimes(2)
  })
  it('rejects a reused confirmed node after its Canon was edited, deleted, or its links changed before any downstream model call', async () => {
    const { graph, nodeIds } = buildAuthoringCreationChainGraph()
    const id = await useNodeFlowStore.getState().createFlow(projectId, null, { graph })
    const flow = (await db.nodeFlows.get(id))!
    const first = await runAuthoringGraph({ flow, targetNodeId: nodeIds.world })
    await adoptAuthoringCandidate({ flow, runId: first.run.id!, nodeId: nodeIds.world, output: first.candidates[nodeIds.world].output })
    const worldview = (await db.worldviews.where('projectId').equals(projectId).first())!
    const continueRun = () => runAuthoringGraph({ flow, targetNodeId: nodeIds.concept, baseRunId: first.run.id!, runNodeIds: new Set([nodeIds.concept]) })
    await db.worldviews.update(worldview.id!, { worldOrigin: '作者在分步骤中改了起源。' })
    await expect(continueRun()).rejects.toThrow('上游')
    await db.worldviews.put(worldview)
    const changed = { ...graph, edges: graph.edges.filter(edge => !(edge.targetNodeId === nodeIds.world && edge.sourceNodeId === nodeIds.context)) }
    await expect(runAuthoringGraph({ flow: { ...flow, graphJson: JSON.stringify(changed) }, targetNodeId: nodeIds.concept, baseRunId: first.run.id!, runNodeIds: new Set([nodeIds.concept]) })).rejects.toThrow('上游')
    await db.worldviews.delete(worldview.id!)
    await expect(continueRun()).rejects.toThrow('上游')
    expect(chat).toHaveBeenCalledTimes(1)
  })
  it('does not rebase an unadopted upstream candidate when a current source read changes', async () => {
    const { graph, nodeIds } = buildAuthoringCreationChainGraph()
    const id = await useNodeFlowStore.getState().createFlow(projectId, null, { graph })
    const flow = (await db.nodeFlows.get(id))!
    const first = await runAuthoringGraph({ flow, targetNodeId: nodeIds.world })
    const scope = await resolveScopeLike(projectId)
    await db.worldviews.add(stampNewRecord(scope, 'worldviews', { projectId, worldGroupId: null, worldOrigin: '在分步骤保存了另一份正式起源。', createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as any)
    await expect(runAuthoringGraph({ flow, targetNodeId: nodeIds.concept, baseRunId: first.run.id!, runNodeIds: new Set([nodeIds.concept]) })).rejects.toThrow('上游')
    expect(chat).toHaveBeenCalledTimes(1)
    expect(JSON.parse((await db.nodeRuns.get(first.run.id!))!.nodeResultsJson)[nodeIds.world].canonReceipt).toBeUndefined()
  })
  it('fails closed on a receipt with another target instead of trusting its adopted marker', async () => {
    const flow = await setup(); const first = await runAuthoringGraph({ flow })
    await adoptAuthoringCandidate({ flow, runId: first.run.id!, nodeId: 'origin', output: first.candidates.origin.output })
    const stored = (await db.nodeRuns.get(first.run.id!))!
    const candidates = JSON.parse(stored.nodeResultsJson)
    candidates.origin.canonReceipt.target = 'storyCores'
    await db.nodeRuns.update(first.run.id!, { nodeResultsJson: JSON.stringify(candidates) })
    await expect(persistAdoptedAuthoringCandidate({ flow, runId: first.run.id!, nodeId: 'origin', output: first.candidates.origin.output })).rejects.toThrow('记录损坏')
    expect(chat).toHaveBeenCalledTimes(1)
  })
})
