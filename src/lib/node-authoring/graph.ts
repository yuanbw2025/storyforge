import { AUTHORING_NODE_BY_ID } from './catalog'
import { authoringPortsCompatible } from './compatibility'
import type {
  AuthoringEdge,
  AuthoringNodeGraph,
  AuthoringNodeInstance,
  AuthoringPortDefinition,
} from './contracts'

export interface AuthoringGraphIssue {
  code: string
  message: string
  nodeId?: string
  edgeId?: string
}

export function findAuthoringPort(
  node: AuthoringNodeInstance,
  direction: 'input' | 'output',
  portId: string,
): AuthoringPortDefinition | undefined {
  return (direction === 'input' ? node.inputs : node.outputs).find(port => port.id === portId)
}

export function validateAuthoringGraph(graph: AuthoringNodeGraph): AuthoringGraphIssue[] {
  const issues: AuthoringGraphIssue[] = []
  if (graph.version !== 2) issues.push({ code: 'version', message: '节点图版本必须为 version=2。' })

  const nodes = new Map<string, AuthoringNodeInstance>()
  for (const node of graph.nodes) {
    if (!node.id.trim() || nodes.has(node.id)) {
      issues.push({ code: 'node-id', nodeId: node.id, message: `节点 ID 为空或重复：${node.id}` })
    }
    if (!AUTHORING_NODE_BY_ID.has(node.templateId)) {
      issues.push({ code: 'template', nodeId: node.id, message: `节点模板不存在：${node.templateId}` })
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      issues.push({ code: 'position', nodeId: node.id, message: `节点坐标无效：${node.title}` })
    }
    for (const ports of [node.inputs, node.outputs]) {
      const portIds = new Set<string>()
      for (const port of ports) {
        if (!port.id.trim() || portIds.has(port.id)) {
          issues.push({ code: 'port-id', nodeId: node.id, message: `节点端口 ID 为空或重复：${node.title}.${port.id}` })
        }
        portIds.add(port.id)
      }
    }
    nodes.set(node.id, node)
  }

  const edgeIds = new Set<string>()
  const edgeKeys = new Set<string>()
  const adjacency = new Map(graph.nodes.map(node => [node.id, [] as string[]]))
  for (const edge of graph.edges) {
    if (!edge.id.trim() || edgeIds.has(edge.id)) {
      issues.push({ code: 'edge-id', edgeId: edge.id, message: `连线 ID 为空或重复：${edge.id}` })
    }
    edgeIds.add(edge.id)
    const source = nodes.get(edge.sourceNodeId)
    const target = nodes.get(edge.targetNodeId)
    if (!source || !target) {
      issues.push({ code: 'dangling-edge', edgeId: edge.id, message: '连线引用了不存在的节点。' })
      continue
    }
    if (source.id === target.id) {
      issues.push({ code: 'self-edge', edgeId: edge.id, message: '节点不能连接自己。' })
      continue
    }
    const sourcePort = findAuthoringPort(source, 'output', edge.sourcePortId)
    const targetPort = findAuthoringPort(target, 'input', edge.targetPortId)
    if (!sourcePort || !targetPort) {
      issues.push({ code: 'missing-port', edgeId: edge.id, message: '连线引用了不存在的输入或输出端口。' })
      continue
    }
    if (!authoringPortsCompatible(sourcePort, targetPort)) {
      issues.push({
        code: 'type-mismatch',
        edgeId: edge.id,
        message: `${source.title}.${sourcePort.label} 不能接入 ${target.title}.${targetPort.label}。`,
      })
    }
    const key = `${edge.sourceNodeId}\u0000${edge.sourcePortId}\u0000${edge.targetNodeId}\u0000${edge.targetPortId}`
    if (edgeKeys.has(key)) {
      issues.push({ code: 'duplicate-edge', edgeId: edge.id, message: '存在重复连线。' })
    }
    edgeKeys.add(key)
    adjacency.get(source.id)?.push(target.id)
  }

  const state = new Map<string, 0 | 1 | 2>()
  let cycle = false
  const visit = (nodeId: string) => {
    if (cycle) return
    const current = state.get(nodeId) ?? 0
    if (current === 1) {
      cycle = true
      return
    }
    if (current === 2) return
    state.set(nodeId, 1)
    for (const targetId of adjacency.get(nodeId) ?? []) visit(targetId)
    state.set(nodeId, 2)
  }
  graph.nodes.forEach(node => visit(node.id))
  if (cycle) issues.push({ code: 'cycle', message: '节点图包含循环，已阻止运行。' })

  for (const node of graph.nodes) {
    for (const port of node.inputs) {
      const count = graph.edges.filter(edge => edge.targetNodeId === node.id && edge.targetPortId === port.id).length
      if (port.required && !count) {
        issues.push({ code: 'required-port', nodeId: node.id, message: `节点“${node.title}”缺少必需输入“${port.label}”。` })
      }
      if (!port.multiple && count > 1) {
        issues.push({ code: 'single-port', nodeId: node.id, message: `节点“${node.title}”的输入“${port.label}”只允许一条连线。` })
      }
    }
  }
  return issues
}

/** A local run validates its ancestors; unfinished unrelated branches remain editable. */
export function authoringExecutionSubgraph(graph: AuthoringNodeGraph, targetNodeId?: string | null): AuthoringNodeGraph {
  if (!targetNodeId) return graph
  if (!graph.nodes.some(node => node.id === targetNodeId)) throw new Error('要运行的节点不存在。')
  const included = new Set<string>()
  const collect = (nodeId: string) => {
    if (included.has(nodeId)) return
    included.add(nodeId)
    graph.edges.filter(edge => edge.targetNodeId === nodeId).forEach(edge => collect(edge.sourceNodeId))
  }
  collect(targetNodeId)
  return { ...graph, nodes: graph.nodes.filter(node => included.has(node.id)), edges: graph.edges.filter(edge => included.has(edge.targetNodeId)) }
}

export function topologicalAuthoringOrder(
  graph: AuthoringNodeGraph,
  targetNodeId?: string | null,
): AuthoringNodeInstance[] {
  const selected = authoringExecutionSubgraph(graph, targetNodeId)
  const issues = validateAuthoringGraph(selected)
  if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
  const included = new Set(selected.nodes.map(node => node.id))

  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  graph.nodes.filter(node => included.has(node.id)).forEach(node => {
    indegree.set(node.id, 0)
    outgoing.set(node.id, [])
  })
  graph.edges.filter(edge => included.has(edge.sourceNodeId) && included.has(edge.targetNodeId)).forEach(edge => {
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1)
    outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId)
  })
  const queue = graph.nodes.filter(node => included.has(node.id) && indegree.get(node.id) === 0)
  const ordered: AuthoringNodeInstance[] = []
  while (queue.length) {
    const node = queue.shift()!
    ordered.push(node)
    for (const targetId of outgoing.get(node.id) ?? []) {
      const next = (indegree.get(targetId) ?? 0) - 1
      indegree.set(targetId, next)
      if (next === 0) queue.push(graph.nodes.find(node => node.id === targetId)!)
    }
  }
  return ordered
}

export function downstreamAuthoringNodeIds(
  graph: AuthoringNodeGraph,
  sourceNodeId: string,
): Set<string> {
  const outgoing = new Map<string, string[]>()
  graph.edges.forEach(edge => {
    const values = outgoing.get(edge.sourceNodeId) ?? []
    values.push(edge.targetNodeId)
    outgoing.set(edge.sourceNodeId, values)
  })
  const downstream = new Set<string>()
  const visit = (nodeId: string) => {
    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (downstream.has(targetId)) continue
      downstream.add(targetId)
      visit(targetId)
    }
  }
  visit(sourceNodeId)
  return downstream
}

export function removeAuthoringNode(
  graph: AuthoringNodeGraph,
  nodeId: string,
): AuthoringNodeGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter(node => node.id !== nodeId),
    edges: graph.edges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
  }
}

export function addAuthoringEdge(graph: AuthoringNodeGraph, edge: AuthoringEdge): AuthoringNodeGraph {
  return { ...graph, edges: [...graph.edges, edge] }
}
