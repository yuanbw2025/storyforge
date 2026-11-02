import { db } from '../../src/lib/db/schema'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { useWorldviewStore } from '../../src/stores/worldview'
import { seedCurrentWorkspace } from './current-workspace'

export type QualityNodeFieldFamily = 'world' | 'story'

/** Real registered authoring data;transport and timing remain owned by each test. */
export async function createQualityNodeFieldFlow(family: QualityNodeFieldFamily, count = 2) {
  const { scope } = await seedCurrentWorkspace(`002 ${family} author lifecycle`)
  await useWorldviewStore.getState().loadAll(scope, null)
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: null,
    worldOrigin: '原世界以潮汐为界，作者保留原版本。' }, scope)
  await useWorldviewStore.getState().saveStoryCore({ projectId: scope.projectId,
    theme: '原主题', logline: '林舟必须履行渡海的旧约。', centralConflict: '原冲突', plotPattern: '线性' }, scope)
  const template = AUTHORING_NODE_BY_ID.get(family === 'world' ? 'world.origin' : 'story.theme')!
  const node: AuthoringNodeInstance = { id: 'field', templateId: template.id, templateVersion: 1,
    title: template.label, x: 0, y: 0, config: { ...defaultConfigForTemplate(template), candidateCount: count },
    inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
  const id = await useNodeFlowStore.getState().createFlow(scope.projectId, null,
    { graph: { ...emptyAuthoringGraph(), nodes: [node] } })
  const flow = await db.nodeFlows.get(id), project = await db.projects.get(scope.projectId)
  if (!flow || !project) throw new Error('Fixture requires actual Work-owned Flow and Project')
  return { scope, flow, project, node, count, field: family === 'world' ? 'worldOrigin' : 'theme',
    table: family === 'world' ? 'worldviews' as const : 'storyCores' as const }
}

export function qualityNodeFieldRaw(field: string, index: number) {
  return '\r\n  ' + JSON.stringify({ field, value: `版本${index + 1}：e\u0301🌙，必须承担这一次选择的代价。` }, null, 3) + '\n\t '
}
