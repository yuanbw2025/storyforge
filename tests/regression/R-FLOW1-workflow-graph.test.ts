import { describe, expect, it } from 'vitest'
import type { PromptWorkflow, PromptWorkflowGraphEdge, PromptWorkflowStep } from '../../src/lib/types/workflow'
import {
  collectWorkflowUpstreamInputs,
  compileWorkflowGraph,
  createLinearWorkflowGraph,
  formatWorkflowUpstreamContext,
  groupWorkflowInputsByVariable,
  validateWorkflowGraph,
} from '../../src/lib/workflow/graph'

function step(stepId: string, label = stepId): PromptWorkflowStep {
  return {
    stepId,
    label,
    promptModuleKey: 'story.generate',
  }
}

function workflow(steps: PromptWorkflowStep[], edges?: PromptWorkflowGraphEdge[]): PromptWorkflow {
  const graph = createLinearWorkflowGraph(steps)
  return {
    scope: 'user',
    name: 'FLOW-1 测试',
    description: '',
    steps,
    graph: edges ? { ...graph, edges } : graph,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('FLOW-1 · 可视化工作流图', () => {
  it('显式线性图保持相邻步骤顺序与变量语义', () => {
    const rows = [
      step('a', '故事核心'),
      { ...step('b', '世界起源'), inputMapping: { previousOutput: 'storyCore' } },
      step('c', '角色'),
    ]
    const linear: PromptWorkflow = {
      scope: 'user',
      name: '线性工作流',
      description: '',
      steps: rows,
      graph: createLinearWorkflowGraph(rows),
      createdAt: 1,
      updatedAt: 1,
    }

    const compiled = compileWorkflowGraph(linear)

    expect(compiled.orderedSteps.map(item => item.stepId)).toEqual(['a', 'b', 'c'])
    expect(compiled.graph.edges).toMatchObject([
      { sourceStepId: 'a', targetStepId: 'b', targetVariable: 'storyCore' },
      { sourceStepId: 'b', targetStepId: 'c', targetVariable: 'worldContext' },
    ])
    expect(linear.graph.nodes).toHaveLength(3)
  })

  it('分叉和汇合使用作者步骤顺序做稳定拓扑排序', () => {
    const rows = [step('seed'), step('world'), step('character'), step('merge')]
    const compiled = compileWorkflowGraph(workflow(rows, [
      { edgeId: 'e1', sourceStepId: 'seed', targetStepId: 'world', targetVariable: 'seed' },
      { edgeId: 'e2', sourceStepId: 'seed', targetStepId: 'character', targetVariable: 'seed' },
      { edgeId: 'e3', sourceStepId: 'world', targetStepId: 'merge', targetVariable: 'worldContext' },
      { edgeId: 'e4', sourceStepId: 'character', targetStepId: 'merge', targetVariable: 'characters' },
    ]))

    expect(compiled.orderedSteps.map(item => item.stepId))
      .toEqual(['seed', 'world', 'character', 'merge'])
    expect(compiled.incomingByStep.get('merge')?.map(edge => edge.edgeId)).toEqual(['e3', 'e4'])
  })

  it.each([
    {
      label: '悬空来源',
      edges: [{ edgeId: 'bad', sourceStepId: 'missing', targetStepId: 'b', targetVariable: 'x' }],
      code: 'unknown-edge-source',
    },
    {
      label: '自环',
      edges: [{ edgeId: 'bad', sourceStepId: 'a', targetStepId: 'a', targetVariable: 'x' }],
      code: 'self-edge',
    },
    {
      label: '空变量',
      edges: [{ edgeId: 'bad', sourceStepId: 'a', targetStepId: 'b', targetVariable: ' ' }],
      code: 'empty-target-variable',
    },
    {
      label: '非法变量',
      edges: [{ edgeId: 'bad', sourceStepId: 'a', targetStepId: 'b', targetVariable: 'bad-key' }],
      code: 'invalid-target-variable',
    },
  ])('$label 在模型调用前被确定性拒绝', ({ edges, code }) => {
    const target = workflow([step('a'), step('b')], edges)
    expect(validateWorkflowGraph(target).map(issue => issue.code)).toContain(code)
    expect(() => compileWorkflowGraph(target)).toThrow()
  })

  it('重复边和有向环不会被静默排序', () => {
    const target = workflow([step('a'), step('b'), step('c')], [
      { edgeId: 'e1', sourceStepId: 'a', targetStepId: 'b', targetVariable: 'worldContext' },
      { edgeId: 'e2', sourceStepId: 'a', targetStepId: 'b', targetVariable: 'worldContext' },
      { edgeId: 'e3', sourceStepId: 'b', targetStepId: 'c', targetVariable: 'worldContext' },
      { edgeId: 'e4', sourceStepId: 'c', targetStepId: 'a', targetVariable: 'worldContext' },
    ])
    const codes = validateWorkflowGraph(target).map(issue => issue.code)

    expect(codes).toContain('duplicate-edge')
    expect(codes).toContain('cycle')
    expect(() => compileWorkflowGraph(target)).toThrow('环路')
  })

  it('汇合节点只获得显式入边，并按目标变量分组', () => {
    const target = workflow(
      [step('seed', '故事种子'), step('world', '世界设定'), step('merge', '合并')],
      [
        { edgeId: 'e1', sourceStepId: 'seed', targetStepId: 'merge', targetVariable: 'storyCore' },
        { edgeId: 'e2', sourceStepId: 'world', targetStepId: 'merge', targetVariable: 'worldContext' },
      ],
    )
    const compiled = compileWorkflowGraph(target)
    const inputs = collectWorkflowUpstreamInputs(
      compiled,
      'merge',
      new Map([
        ['seed', '失忆侦探发现自己是凶手'],
        ['world', '记忆可以买卖的雾港'],
      ]),
    )

    expect(inputs).toHaveLength(2)
    expect(groupWorkflowInputsByVariable(inputs)).toEqual({
      storyCore: '【来自节点：故事种子】\n失忆侦探发现自己是凶手',
      worldContext: '【来自节点：世界设定】\n记忆可以买卖的雾港',
    })
    expect(formatWorkflowUpstreamContext(inputs)).toContain('故事种子 → storyCore')
    expect(formatWorkflowUpstreamContext(inputs)).toContain('世界设定 → worldContext')
  })
})
