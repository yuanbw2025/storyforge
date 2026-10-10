import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../src/lib/ai/client', () => ({ chat: vi.fn(async () => JSON.stringify({ field: 'worldOrigin', value: '模型起源' })) }))
import { db } from '../../src/lib/db/schema'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { adoptAuthoringCandidate, persistAdoptedAuthoringCandidate, reviseAuthoringCandidate, runAuthoringGraph } from '../../src/lib/node-authoring/executor'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

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
  beforeEach(async () => { await db.delete(); await db.open(); projectId = (await seedCurrentWorkspace('节点候选验收')).project.id! })
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
})
