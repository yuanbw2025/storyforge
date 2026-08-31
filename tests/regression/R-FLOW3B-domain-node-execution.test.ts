import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/ai/client', () => ({
  chat: vi.fn(async () => JSON.stringify({
    field: 'worldOrigin',
    value: '潮汐退去后，第一座城从海床升起。',
  })),
}))

import { chat } from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import {
  AUTHORING_NODE_BY_ID,
  defaultConfigForTemplate,
  emptyAuthoringGraph,
  type AuthoringNodeGraph,
  type AuthoringNodeInstance,
} from '../../src/lib/node-authoring'
import {
  adoptAuthoringCandidate,
  runAuthoringGraph,
} from '../../src/lib/node-authoring/executor'
import type { NodeFlow, Project } from '../../src/lib/types'
import { useNodeFlowStore } from '../../src/stores/node-flow'

const project: Project = {
  id: 73001,
  name: '领域节点执行测试',
  genre: 'fantasy',
  genres: ['fantasy'],
  status: 'drafting',
  description: '',
  targetWordCount: 100_000,
  enableMultiWorld: false,
  createdAt: 1,
  updatedAt: 1,
}

function node(templateId: string, id: string, config: Record<string, unknown> = {}): AuthoringNodeInstance {
  const template = AUTHORING_NODE_BY_ID.get(templateId)
  if (!template) throw new Error(`missing template ${templateId}`)
  return {
    id,
    templateId,
    templateVersion: 1,
    title: template.label,
    x: 0,
    y: 0,
    config: { ...defaultConfigForTemplate(template), ...config },
    inputs: structuredClone(template.inputs),
    outputs: structuredClone(template.outputs),
  }
}

describe('FLOW-3B · 领域节点运行和显式采纳', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.projects.put(project)
    vi.mocked(chat).mockClear()
    useNodeFlowStore.setState({ projectId: null, flows: [], runs: [], loading: false })
  })

  afterEach(() => db.close())

  it('新建图使用 version=2，并保留 FLOW-2 保存兼容', async () => {
    const flowId = await useNodeFlowStore.getState().createFlow(project.id!, null)
    const created = (await db.nodeFlows.get(flowId))!
    expect(JSON.parse(created.graphJson).version).toBe(2)

    await expect(useNodeFlowStore.getState().saveFlow({
      ...created,
      graphJson: JSON.stringify({
        version: 1,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    })).resolves.toBe(flowId)
  })

  it('把控制参数传入共享 AI，先保存候选，确认后才写 Canon', async () => {
    const temperature = node('control.temperature', 'temperature', { value: 0.35 })
    const count = node('control.candidate-count', 'count', { value: 2 })
    const origin = node('world.origin', 'origin')
    const graph: AuthoringNodeGraph = {
      ...emptyAuthoringGraph(),
      nodes: [temperature, count, origin],
      edges: [
        {
          id: 'temperature-origin',
          sourceNodeId: temperature.id,
          sourcePortId: 'value',
          targetNodeId: origin.id,
          targetPortId: 'temperature',
        },
        {
          id: 'count-origin',
          sourceNodeId: count.id,
          sourcePortId: 'value',
          targetNodeId: origin.id,
          targetPortId: 'candidate-count',
        },
      ],
    }
    const now = Date.now()
    const flowId = await db.nodeFlows.add({
      projectId: project.id!,
      worldGroupId: null,
      name: '世界来源闭环',
      description: '',
      graphJson: JSON.stringify(graph),
      createdAt: now,
      updatedAt: now,
    }) as number
    const flow = (await db.nodeFlows.get(flowId)) as NodeFlow

    const outcome = await runAuthoringGraph({ flow })
    expect(outcome.run.status, JSON.stringify(outcome.candidates)).toBe('completed')
    expect(outcome.candidates.origin.output).toContain('第一座城')
    expect(outcome.candidates.origin.variants).toHaveLength(2)
    expect(outcome.snapshots.origin.inputs[0]).toMatchObject({
      semantic: 'control.temperature',
      content: '0.35',
    })
    expect(vi.mocked(chat).mock.calls).toHaveLength(2)
    expect(vi.mocked(chat).mock.calls[0][2]?.configOverrides?.temperature).toBe(0.35)
    expect(await db.worldviews.where('projectId').equals(project.id!).count()).toBe(0)

    const adopted = await adoptAuthoringCandidate({
      flow,
      nodeId: origin.id,
      output: outcome.candidates.origin.output,
    })
    expect(adopted.written).toHaveLength(1)
    expect((await db.worldviews.where('projectId').equals(project.id!).first())?.worldOrigin).toContain('第一座城')
  })
})
