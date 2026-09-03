import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useWorkflowStore } from '../../src/stores/workflow'
import type { PromptWorkflow } from '../../src/lib/types/workflow'
import { createLinearWorkflowGraph } from '../../src/lib/workflow/graph'
import {
  parseImportedWorkflows,
  serializeWorkflows,
} from '../../src/lib/workflow/import-export'

function graphWorkflow(name = '可视化工作流'): PromptWorkflow {
  const steps = [
    {
      stepId: 'seed',
      label: '故事种子',
      promptModuleKey: 'story.generate' as const,
      userConfirmRequired: true,
    },
    {
      stepId: 'world',
      label: '世界设定',
      promptModuleKey: 'worldview.dimension' as const,
      userConfirmRequired: true,
    },
    {
      stepId: 'character',
      label: '角色设计',
      promptModuleKey: 'character.generate' as const,
      userConfirmRequired: true,
    },
  ]
  const graph = createLinearWorkflowGraph(steps)
  graph.nodes[0] = { ...graph.nodes[0], x: 137, y: 91 }
  graph.edges = [
    {
      edgeId: 'seed-world',
      sourceStepId: 'seed',
      targetStepId: 'world',
      targetVariable: 'storyCore',
    },
    {
      edgeId: 'seed-character',
      sourceStepId: 'seed',
      targetStepId: 'character',
      targetVariable: 'worldContext',
    },
  ]
  graph.viewport = { x: 10, y: 20, zoom: 1.2 }
  return {
    scope: 'user',
    name,
    description: '持久化测试',
    steps,
    graph,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('FLOW-1 · 工作流图持久化与专用导入导出', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useWorkflowStore.setState({ workflows: [], loaded: false })
  })

  it('保存、刷新和克隆保留节点位置、连线、端口与视口', async () => {
    const originalId = await useWorkflowStore.getState().save(graphWorkflow())
    const stored = await db.promptWorkflows.get(originalId)

    expect(stored?.graph?.nodes[0]).toMatchObject({ stepId: 'seed', x: 137, y: 91 })
    expect(stored?.graph?.edges.map(edge => edge.targetVariable))
      .toEqual(['storyCore', 'worldContext'])
    expect(stored?.graph?.viewport).toEqual({ x: 10, y: 20, zoom: 1.2 })

    const cloneId = await useWorkflowStore.getState().clone(originalId, '图副本')
    const clone = await db.promptWorkflows.get(cloneId)
    expect(clone?.scope).toBe('user')
    expect(clone?.graph).toEqual(stored?.graph)
  })

  it('工作流 JSON 往返保留图，导入强制 user scope 且不携带原 ID', () => {
    const source = { ...graphWorkflow(), id: 777, scope: 'system' as const, isDefault: true }
    const [restored] = parseImportedWorkflows(JSON.parse(serializeWorkflows([source])), 1234)

    expect(restored.id).toBeUndefined()
    expect(restored.scope).toBe('user')
    expect(restored.isDefault).toBe(false)
    expect(restored.graph).toEqual(source.graph)
    expect(restored.createdAt).toBe(1234)
  })

  it('导入环路图在写库前失败，不静默删除坏边', () => {
    const source = graphWorkflow('坏图')
    source.graph!.edges.push({
      edgeId: 'world-seed',
      sourceStepId: 'world',
      targetStepId: 'seed',
      targetVariable: 'worldContext',
    })

    expect(() => parseImportedWorkflows(JSON.parse(serializeWorkflows([source]))))
      .toThrow('环路')
  })

  it('Store 拒绝悬空图且 promptWorkflows 行数保持不变', async () => {
    const source = graphWorkflow('悬空图')
    source.graph!.edges.push({
      edgeId: 'missing',
      sourceStepId: 'not-found',
      targetStepId: 'seed',
      targetVariable: 'worldContext',
    })

    await expect(useWorkflowStore.getState().save(source)).rejects.toThrow('连线来源不存在')
    expect(await db.promptWorkflows.count()).toBe(0)
  })
})
