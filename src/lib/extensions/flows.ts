import { db } from '../db/schema'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeGraph } from '../node-authoring/contracts'
import { validateAuthoringGraph } from '../node-authoring/graph'
import { assertOfficialAuthoringGraphUsesFormalActionsV1 } from '../node-authoring/domain-action-registry'
import { useNodeFlowStore } from '../../stores/node-flow'
import { checkActiveProfile } from './store'
import type { ExtensionFlow, ExtensionReviewRequest } from './types'

export function compileExtensionFlow(flow: ExtensionFlow): AuthoringNodeGraph {
  const graph = emptyAuthoringGraph()
  graph.nodes = flow.nodes.map((node, index) => {
    const template = AUTHORING_NODE_BY_ID.get(node.templateId)
    if (!template) throw new Error(`当前宿主不支持流程节点 ${node.templateId}`)
    // Portable templates cannot smuggle local record identities or provider secrets into a new work.
    for (const key of Object.keys(node.config)) {
      if (/(?:record|project|world|work|chapter|outline)(?:Id|Ids)$|api.?key|secret|access.?token|baseurl/i.test(key)) throw new Error(`流程模板不能携带本地绑定或连接设置：${key}`)
      const parameter = template.parameters?.find(parameter => parameter.key === key)
      if (!parameter) throw new Error(`节点 ${node.templateId} 未声明参数 ${key}`)
      const value = node.config[key]
      if (parameter.type === 'number' && (typeof value !== 'number' || value < (parameter.min ?? -Infinity) || value > (parameter.max ?? Infinity))) throw new Error(`节点参数 ${key} 数值越界`)
      if (parameter.type === 'boolean' && typeof value !== 'boolean') throw new Error(`节点参数 ${key} 需要布尔值`)
      if ((parameter.type === 'text' || parameter.type === 'select') && typeof value !== 'string') throw new Error(`节点参数 ${key} 需要文本`)
      if (parameter.type === 'select' && !parameter.options?.includes(String(value))) throw new Error(`节点参数 ${key} 不是有效选项`)
    }
    return { id: node.id, templateId: node.templateId, templateVersion: template.version, title: template.label, x: 80 + index * 340, y: 120, config: { ...defaultConfigForTemplate(template), ...node.config }, inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
  })
  graph.edges = flow.edges.map((edge, index) => ({ id: `plugin-edge-${index}`, sourceNodeId: edge.source, targetNodeId: edge.target, sourcePortId: edge.sourcePort, targetPortId: edge.targetPort, mapping: { mode: 'full', missingPolicy: 'block', refreshPolicy: 'live' } }))
  assertOfficialAuthoringGraphUsesFormalActionsV1({ templateId: flow.id, nodes: graph.nodes, catalog: AUTHORING_NODE_BY_ID })
  const issues = validateAuthoringGraph(graph)
  if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
  return graph
}
/** A host confirmation creates an editable copy; model execution still requires the node workbench's Start action. */
export async function createExtensionFlow(request: ExtensionReviewRequest): Promise<number> {
  const profile = await db.extensionProfiles.get(request.profileId ?? -1)
  if (!profile || profile.digest !== request.digest || profile.pluginId !== request.pluginId) throw new Error('插件流程版本已变化')
  await checkActiveProfile(profile)
  const project = await db.projects.get(profile.projectId), work = await db.works.get(profile.workId ?? -1)
  if (!project || !work || project.activeWorkId !== work.id || work.kind !== 'novel' || work.novelProfile !== 'long') throw new Error('流程目前接入分步骤长篇，请先在长篇工作台切换到此作品')
  const contract = await db.extensionContracts.where('[profileId+digest]').equals([profile.id!, profile.digest]).first()
  const flow = contract?.manifest.flows?.find(flow => flow.id === request.flowId)
  if (!flow) throw new Error('插件流程契约不存在')
  const graph = compileExtensionFlow(flow)
  return useNodeFlowStore.getState().createFlow(profile.projectId, null, { name: flow.name, description: `来自 ${profile.pluginId}@${profile.version}；包 SHA-256 ${profile.digest}；流程 ${flow.id}。这是冻结模板的作品副本；停用插件不删除此图或运行证据。`, graph })
}
