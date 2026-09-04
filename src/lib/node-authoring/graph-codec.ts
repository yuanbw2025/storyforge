import {
  AUTHORING_GRAPH_VERSION,
  emptyAuthoringGraph,
  isAuthoringSemantic,
  type AuthoringNodeGraph,
  type AuthoringNodeInstance,
  type AuthoringPortDefinition,
} from './contracts'

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象。`)
  }
}

function parseAuthoringPort(value: unknown, label: string): AuthoringPortDefinition {
  assertObject(value, label)
  if (typeof value.id !== 'string' || typeof value.label !== 'string') {
    throw new Error(`${label} 缺少 ID 或名称。`)
  }
  if (!isAuthoringSemantic(value.semantic)) throw new Error(`${label} 使用未知语义。`)
  if (value.cardinality !== 'one' && value.cardinality !== 'many') throw new Error(`${label} 基数无效。`)
  if (!['canon', 'draft', 'candidate', 'control', 'any'].includes(String(value.state))) {
    throw new Error(`${label} 状态无效。`)
  }
  return value as unknown as AuthoringPortDefinition
}

/** Decode only the current domain-node graph contract and reject every other shape. */
export function parseAuthoringGraph(value: string | null | undefined): AuthoringNodeGraph {
  if (!value?.trim()) return emptyAuthoringGraph()
  const parsed = JSON.parse(value) as unknown
  assertObject(parsed, '节点图')
  if (parsed.version !== AUTHORING_GRAPH_VERSION) {
    throw new Error(`不支持的节点图版本：${String(parsed.version)}`)
  }
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('领域节点图缺少 nodes 或 edges。')
  }
  const viewport = parsed.viewport && typeof parsed.viewport === 'object'
    ? parsed.viewport as Record<string, unknown>
    : { x: 0, y: 0, zoom: 1 }
  return {
    version: AUTHORING_GRAPH_VERSION,
    nodes: parsed.nodes.map((raw, index) => {
      assertObject(raw, `nodes[${index}]`)
      if (
        typeof raw.id !== 'string'
        || typeof raw.templateId !== 'string'
        || typeof raw.title !== 'string'
        || typeof raw.x !== 'number'
        || typeof raw.y !== 'number'
        || !Array.isArray(raw.inputs)
        || !Array.isArray(raw.outputs)
      ) {
        throw new Error(`nodes[${index}] 结构无效。`)
      }
      return {
        ...raw,
        templateVersion: 1,
        config: raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
          ? raw.config as Record<string, unknown>
          : {},
        inputs: raw.inputs.map((port, portIndex) => parseAuthoringPort(port, `nodes[${index}].inputs[${portIndex}]`)),
        outputs: raw.outputs.map((port, portIndex) => parseAuthoringPort(port, `nodes[${index}].outputs[${portIndex}]`)),
      } as AuthoringNodeInstance
    }),
    edges: parsed.edges.map((raw, index) => {
      assertObject(raw, `edges[${index}]`)
      if (
        typeof raw.id !== 'string'
        || typeof raw.sourceNodeId !== 'string'
        || typeof raw.sourcePortId !== 'string'
        || typeof raw.targetNodeId !== 'string'
        || typeof raw.targetPortId !== 'string'
      ) {
        throw new Error(`edges[${index}] 结构无效。`)
      }
      return raw as unknown as AuthoringNodeGraph['edges'][number]
    }),
    viewport: {
      x: typeof viewport.x === 'number' ? viewport.x : 0,
      y: typeof viewport.y === 'number' ? viewport.y : 0,
      zoom: typeof viewport.zoom === 'number' ? viewport.zoom : 1,
    },
    groups: Array.isArray(parsed.groups) ? parsed.groups as AuthoringNodeGraph['groups'] : [],
  }
}
