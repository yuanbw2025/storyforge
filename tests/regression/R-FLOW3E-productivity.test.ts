import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  AUTHORING_NODE_BY_ID,
  AUTHORING_OFFICIAL_TEMPLATES,
  autoLayoutAuthoringGraph,
  buildAuthoringExecutionPlan,
  buildOfficialAuthoringTemplate,
  compareAuthoringGraphs,
  copyAuthoringSubgraph,
  groupAuthoringNodes,
  parseAuthoringGraph,
  runAuthoringGraph,
  type AuthoringNodeGraph,
} from '../../src/lib/node-authoring'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { putCurrentWorkspaceFixtureV1 } from '../helpers/current-workspace'

const project = {
  id: 73100,
  workspaceUid: generateWorkspaceUid(),
  workspacePurpose: 'independent-work' as const,
  name: 'FLOW-3E 大图效率测试',
  enableMultiWorld: false,
  activeWorldId: 73100,
  activeWorkId: 73100,
  createdAt: 1,
  updatedAt: 1,
}

function simpleGraph(): AuthoringNodeGraph {
  const input = AUTHORING_NODE_BY_ID.get('input.manual-text')!
  const compose = AUTHORING_NODE_BY_ID.get('processor.compose')!
  const node = (template: typeof input, id: string, config: Record<string, unknown>) => ({
    id,
    templateId: template.id,
    templateVersion: template.version,
    title: template.label,
    x: 0,
    y: 0,
    config,
    inputs: structuredClone(template.inputs),
    outputs: structuredClone(template.outputs),
  })
  const nodes = [
    node(input, 'input', { text: '海潮退去后，第一座城从海床升起。' }),
    node(compose, 'compose', { template: '【设定】\n{{context}}' }),
    node(compose, 'output', { template: '【复核】\n{{context}}' }),
  ]
  return {
    version: 2,
    nodes,
    edges: [
      { id: 'input-compose', sourceNodeId: 'input', sourcePortId: 'text', targetNodeId: 'compose', targetPortId: 'context' },
      { id: 'compose-output', sourceNodeId: 'compose', sourcePortId: 'text', targetNodeId: 'output', targetPortId: 'context' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    groups: [],
  }
}

describe('FLOW-3E · 大图效率、模板与可恢复执行', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await putCurrentWorkspaceFixtureV1(project)
  })

  afterEach(() => db.close())

  it('六个官方模板都只由显式节点组成且合同可校验', () => {
    expect(AUTHORING_OFFICIAL_TEMPLATES).toHaveLength(6)
    for (const template of AUTHORING_OFFICIAL_TEMPLATES) {
      const graph = buildOfficialAuthoringTemplate(template.id)
      expect(parseAuthoringGraph(JSON.stringify(graph))).toMatchObject({ version: 2 })
      expect(graph.nodes.some(node => node.templateId === 'source.project-context')).toBe(true)
      expect(graph.nodes.every(node => AUTHORING_NODE_BY_ID.has(node.templateId))).toBe(true)
      expect(graph.nodes.some(node => node.templateId === 'output.review-adopt')).toBe(false)
    }
  })

  it('百节点自动布局、框选辅助操作和子图复制保持稳定', () => {
    const base = simpleGraph()
    const many = {
      ...base,
      nodes: Array.from({ length: 120 }, (_, index) => ({
        ...structuredClone(base.nodes[0]),
        id: `node-${index}`,
        x: 0,
        y: 0,
      })),
      edges: [],
    }
    const started = performance.now()
    const laidOut = autoLayoutAuthoringGraph(many)
    expect(performance.now() - started).toBeLessThan(500)
    expect(laidOut.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true)

    const selected = new Set(['input', 'compose'])
    const copied = copyAuthoringSubgraph(base, selected)
    expect(copied.copiedNodeIds).toHaveLength(2)
    expect(copied.graph.edges).toHaveLength(3)
    const grouped = groupAuthoringNodes(base, selected, '证据组')
    expect(grouped.groups?.[0].title).toBe('证据组')
    expect(grouped.nodes.filter(node => node.groupId === grouped.groups?.[0].id)).toHaveLength(2)
    expect(compareAuthoringGraphs(base, copied.graph)).toMatchObject({ nodesAdded: 2, edgesAdded: 1 })
  })

  it('执行计划冻结调用上限，不把 API 配置或密钥写入计划', () => {
    const graph = buildOfficialAuthoringTemplate('short-novel')
    const plan = buildAuthoringExecutionPlan({ graph })
    expect(plan.estimatedAiCalls).toBeGreaterThan(0)
    expect(plan.estimatedMaxAiCalls).toBeGreaterThanOrEqual(plan.estimatedAiCalls)
    expect(plan.estimatedMaxOutputTokens).toBeGreaterThan(0)
    expect(JSON.stringify(plan)).not.toContain('apiKey')
    expect(JSON.stringify(plan)).not.toContain('sk-')
  })

  it('暂停后可从同一 nodeRuns 记录恢复，不重复执行已完成节点', async () => {
    const graph = simpleGraph()
    const now = Date.now()
    const flowId = await db.nodeFlows.add({
      projectId: project.id,
      worldGroupId: null,
      name: '可恢复图',
      description: '',
      graphJson: JSON.stringify(graph),
      createdAt: now,
      updatedAt: now,
    }) as number
    await finalizeCurrentFixtureV1(project.id)
    const flow = (await db.nodeFlows.get(flowId))!
    const controller = new AbortController()
    controller.abort('paused')
    const paused = await runAuthoringGraph({ flow, signal: controller.signal })
    expect(paused.run.status).toBe('paused')
    expect(paused.run.executionPlanJson).toContain('pendingNodeIds')
    const resumed = await runAuthoringGraph({ flow, resumeRunId: paused.run.id })
    expect(resumed.run.status).toBe('completed')
    expect(resumed.candidates.output?.output).toContain('海潮退去')
    expect(await db.nodeRuns.count()).toBe(1)
    expect(JSON.parse((await db.nodeRuns.get(paused.run.id!))!.executionPlanJson!).pendingNodeIds).toEqual([])
  })

  it('运行计划和图快照随项目往返迁移，便携数据不含 API 密钥', async () => {
    const graph = simpleGraph()
    graph.nodes[0].config.apiKey = 'sk-test-secret'
    const now = Date.now()
    const flowId = await db.nodeFlows.add({
      projectId: project.id,
      worldGroupId: null,
      name: '可迁移图',
      description: '',
      graphJson: JSON.stringify(graph),
      createdAt: now,
      updatedAt: now,
    }) as number
    await finalizeCurrentFixtureV1(project.id)
    const flow = (await db.nodeFlows.get(flowId))!
    const result = await runAuthoringGraph({ flow })
    const exported = await exportProjectJSON(project.id)
    expect(JSON.stringify(exported)).not.toContain('sk-test-secret')

    const importedProjectId = await importProjectJSON(exported)
    const importedFlow = await db.nodeFlows.where('projectId').equals(importedProjectId).first()
    const importedRun = await db.nodeRuns.where('projectId').equals(importedProjectId).first()
    expect(importedFlow?.graphJson).toContain('redacted')
    expect(importedRun?.executionPlanJson).toContain('completedNodeIds')
    expect(importedRun?.graphSnapshotJson).toContain('redacted')
    expect(importedRun?.executionPlanJson).not.toContain('sk-test-secret')
    expect(importedRun?.graphSnapshotJson).not.toContain('sk-test-secret')
    expect(result.run.executionPlanJson).toContain('orderedNodeIds')
  })
})
