import type {
  PromptWorkflow,
  PromptWorkflowGraph,
  PromptWorkflowGraphEdge,
  PromptWorkflowStep,
} from '../types/workflow'

export const WORKFLOW_GRAPH_VERSION = 1 as const
export const WORKFLOW_NODE_WIDTH = 240
export const WORKFLOW_NODE_HEIGHT = 164
export const WORKFLOW_CANVAS_PADDING = 48

export interface WorkflowGraphIssue {
  code:
    | 'empty-step-id'
    | 'duplicate-step-id'
    | 'unsupported-version'
    | 'missing-node'
    | 'unknown-node'
    | 'duplicate-node'
    | 'invalid-position'
    | 'empty-edge-id'
    | 'duplicate-edge-id'
    | 'unknown-edge-source'
    | 'unknown-edge-target'
    | 'self-edge'
    | 'empty-target-variable'
    | 'invalid-target-variable'
    | 'duplicate-edge'
    | 'cycle'
  message: string
  stepId?: string
  edgeId?: string
}

export interface CompiledWorkflowGraph {
  graph: PromptWorkflowGraph
  orderedSteps: PromptWorkflowStep[]
  incomingByStep: Map<string, PromptWorkflowGraphEdge[]>
}

export interface WorkflowUpstreamInput {
  sourceStepId: string
  sourceLabel: string
  targetVariable: string
  output: string
}

function defaultNodePosition(index: number): { x: number; y: number } {
  const column = index % 4
  const row = Math.floor(index / 4)
  return {
    x: WORKFLOW_CANVAS_PADDING + column * (WORKFLOW_NODE_WIDTH + 88),
    y: WORKFLOW_CANVAS_PADDING + row * (WORKFLOW_NODE_HEIGHT + 92),
  }
}

function linearTargetVariable(step: PromptWorkflowStep): string {
  return step.inputMapping?.previousOutput?.trim() || 'worldContext'
}

/** 为新建工作流或数据库升级生成一张显式线性图。 */
export function createLinearWorkflowGraph(steps: PromptWorkflowStep[]): PromptWorkflowGraph {
  return {
    version: WORKFLOW_GRAPH_VERSION,
    nodes: steps.map((step, index) => ({
      stepId: step.stepId,
      ...defaultNodePosition(index),
    })),
    edges: steps.slice(1).map((step, index) => ({
      edgeId: `linear-${steps[index].stepId}-${step.stepId}`,
      sourceStepId: steps[index].stepId,
      targetStepId: step.stepId,
      targetVariable: linearTargetVariable(step),
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

export function workflowGraphFor(workflow: PromptWorkflow): PromptWorkflowGraph {
  return {
    version: workflow.graph.version,
    nodes: workflow.graph.nodes.map(node => ({ ...node })),
    edges: workflow.graph.edges.map(edge => ({ ...edge })),
    viewport: workflow.graph.viewport ? { ...workflow.graph.viewport } : undefined,
  }
}

export function validateWorkflowGraph(workflow: PromptWorkflow): WorkflowGraphIssue[] {
  const graph = workflowGraphFor(workflow)
  const issues: WorkflowGraphIssue[] = []
  const stepIds = new Set<string>()

  for (const step of workflow.steps) {
    if (!step.stepId.trim()) {
      issues.push({ code: 'empty-step-id', message: '工作流包含空 stepId。' })
      continue
    }
    if (stepIds.has(step.stepId)) {
      issues.push({
        code: 'duplicate-step-id',
        stepId: step.stepId,
        message: `步骤 ID 重复：${step.stepId}`,
      })
    }
    stepIds.add(step.stepId)
  }

  if (graph.version !== WORKFLOW_GRAPH_VERSION) {
    issues.push({
      code: 'unsupported-version',
      message: `不支持工作流图版本：${String(graph.version)}`,
    })
  }

  const graphNodeIds = new Set<string>()
  for (const node of graph.nodes) {
    if (!stepIds.has(node.stepId)) {
      issues.push({
        code: 'unknown-node',
        stepId: node.stepId,
        message: `画布节点引用了不存在的步骤：${node.stepId}`,
      })
    }
    if (graphNodeIds.has(node.stepId)) {
      issues.push({
        code: 'duplicate-node',
        stepId: node.stepId,
        message: `画布节点重复：${node.stepId}`,
      })
    }
    graphNodeIds.add(node.stepId)
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      issues.push({
        code: 'invalid-position',
        stepId: node.stepId,
        message: `节点坐标无效：${node.stepId}`,
      })
    }
  }
  for (const stepId of stepIds) {
    if (!graphNodeIds.has(stepId)) {
      issues.push({
        code: 'missing-node',
        stepId,
        message: `步骤缺少画布节点：${stepId}`,
      })
    }
  }

  const edgeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  const adjacency = new Map<string, string[]>()
  for (const stepId of stepIds) adjacency.set(stepId, [])

  for (const edge of graph.edges) {
    if (!edge.edgeId.trim()) {
      issues.push({ code: 'empty-edge-id', edgeId: edge.edgeId, message: '工作流包含空 edgeId。' })
    } else if (edgeIds.has(edge.edgeId)) {
      issues.push({
        code: 'duplicate-edge-id',
        edgeId: edge.edgeId,
        message: `连线 ID 重复：${edge.edgeId}`,
      })
    }
    edgeIds.add(edge.edgeId)

    const hasSource = stepIds.has(edge.sourceStepId)
    const hasTarget = stepIds.has(edge.targetStepId)
    if (!hasSource) {
      issues.push({
        code: 'unknown-edge-source',
        edgeId: edge.edgeId,
        message: `连线来源不存在：${edge.sourceStepId}`,
      })
    }
    if (!hasTarget) {
      issues.push({
        code: 'unknown-edge-target',
        edgeId: edge.edgeId,
        message: `连线目标不存在：${edge.targetStepId}`,
      })
    }
    if (edge.sourceStepId === edge.targetStepId) {
      issues.push({
        code: 'self-edge',
        edgeId: edge.edgeId,
        message: `节点不能连接自己：${edge.sourceStepId}`,
      })
    }

    const targetVariable = edge.targetVariable.trim()
    if (!targetVariable) {
      issues.push({
        code: 'empty-target-variable',
        edgeId: edge.edgeId,
        message: '连线必须声明目标变量。',
      })
    } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(targetVariable)) {
      issues.push({
        code: 'invalid-target-variable',
        edgeId: edge.edgeId,
        message: `目标变量格式无效：${edge.targetVariable}`,
      })
    }

    const edgeKey = `${edge.sourceStepId}\u0000${edge.targetStepId}\u0000${targetVariable}`
    if (edgeKeys.has(edgeKey)) {
      issues.push({
        code: 'duplicate-edge',
        edgeId: edge.edgeId,
        message: `重复连线：${edge.sourceStepId} → ${edge.targetStepId}.${targetVariable}`,
      })
    }
    edgeKeys.add(edgeKey)

    if (hasSource && hasTarget && edge.sourceStepId !== edge.targetStepId) {
      adjacency.get(edge.sourceStepId)!.push(edge.targetStepId)
    }
  }

  const visitState = new Map<string, 0 | 1 | 2>()
  let cycleFound = false
  const visit = (stepId: string) => {
    if (cycleFound) return
    const state = visitState.get(stepId) ?? 0
    if (state === 1) {
      cycleFound = true
      return
    }
    if (state === 2) return
    visitState.set(stepId, 1)
    for (const target of adjacency.get(stepId) ?? []) visit(target)
    visitState.set(stepId, 2)
  }
  for (const stepId of stepIds) visit(stepId)
  if (cycleFound) {
    issues.push({ code: 'cycle', message: '工作流图包含环路，已阻止执行。' })
  }

  return issues
}

function insertByAuthorOrder(queue: string[], stepId: string, order: Map<string, number>) {
  const targetOrder = order.get(stepId) ?? Number.MAX_SAFE_INTEGER
  const index = queue.findIndex(current => (order.get(current) ?? Number.MAX_SAFE_INTEGER) > targetOrder)
  if (index < 0) queue.push(stepId)
  else queue.splice(index, 0, stepId)
}

export function compileWorkflowGraph(workflow: PromptWorkflow): CompiledWorkflowGraph {
  const graph = workflowGraphFor(workflow)
  const issues = validateWorkflowGraph({ ...workflow, graph })
  if (issues.length) {
    throw new Error(issues.map(issue => issue.message).join('\n'))
  }

  const authorOrder = new Map(workflow.steps.map((step, index) => [step.stepId, index]))
  const stepById = new Map(workflow.steps.map(step => [step.stepId, step]))
  const indegree = new Map(workflow.steps.map(step => [step.stepId, 0]))
  const outgoing = new Map(workflow.steps.map(step => [step.stepId, [] as string[]]))
  const incomingByStep = new Map(workflow.steps.map(step => [step.stepId, [] as PromptWorkflowGraphEdge[]]))

  graph.edges.forEach(edge => {
    outgoing.get(edge.sourceStepId)!.push(edge.targetStepId)
    indegree.set(edge.targetStepId, (indegree.get(edge.targetStepId) ?? 0) + 1)
    incomingByStep.get(edge.targetStepId)!.push(edge)
  })
  for (const edges of incomingByStep.values()) {
    edges.sort((a, b) => {
      const bySource = (authorOrder.get(a.sourceStepId) ?? 0) - (authorOrder.get(b.sourceStepId) ?? 0)
      return bySource || a.edgeId.localeCompare(b.edgeId)
    })
  }

  const queue: string[] = []
  workflow.steps.forEach(step => {
    if ((indegree.get(step.stepId) ?? 0) === 0) insertByAuthorOrder(queue, step.stepId, authorOrder)
  })
  const orderedIds: string[] = []
  while (queue.length) {
    const stepId = queue.shift()!
    orderedIds.push(stepId)
    for (const target of outgoing.get(stepId) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) insertByAuthorOrder(queue, target, authorOrder)
    }
  }
  if (orderedIds.length !== workflow.steps.length) {
    throw new Error('工作流图无法完成拓扑排序。')
  }

  return {
    graph,
    orderedSteps: orderedIds.map(stepId => stepById.get(stepId)!),
    incomingByStep,
  }
}

export function collectWorkflowUpstreamInputs(
  compiled: CompiledWorkflowGraph,
  targetStepId: string,
  outputs: Map<string, string>,
): WorkflowUpstreamInput[] {
  const labelById = new Map(compiled.orderedSteps.map(step => [step.stepId, step.label]))
  return (compiled.incomingByStep.get(targetStepId) ?? [])
    .map(edge => ({
      sourceStepId: edge.sourceStepId,
      sourceLabel: labelById.get(edge.sourceStepId) ?? edge.sourceStepId,
      targetVariable: edge.targetVariable,
      output: outputs.get(edge.sourceStepId) ?? '',
    }))
    .filter(input => input.output.trim())
}

export function groupWorkflowInputsByVariable(
  inputs: WorkflowUpstreamInput[],
): Record<string, string> {
  const grouped = new Map<string, string[]>()
  for (const input of inputs) {
    const rows = grouped.get(input.targetVariable) ?? []
    rows.push(`【来自节点：${input.sourceLabel}】\n${input.output}`)
    grouped.set(input.targetVariable, rows)
  }
  return Object.fromEntries([...grouped].map(([key, values]) => [key, values.join('\n\n')]))
}

export function formatWorkflowUpstreamContext(inputs: WorkflowUpstreamInput[]): string {
  return inputs
    .map(input => `【来自节点：${input.sourceLabel} → ${input.targetVariable}】\n${input.output}`)
    .join('\n\n')
}
