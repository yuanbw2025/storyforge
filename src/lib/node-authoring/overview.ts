import { AUTHORING_NODE_CATALOG, AUTHORING_NODE_BY_ID } from './catalog'
import { authoringPortsCompatible } from './compatibility'
import { emptyAuthoringGraph, type AuthoringNodeGraph, type AuthoringNodeInstance } from './contracts'
import { hashAuthoringText } from './bindings'
import { buildRagLibrary } from '../retrieval/rag-library'

const TABLE_SEMANTICS: Record<string, AuthoringNodeInstance['outputs'][number]['semantic']> = {
  importantLocations: 'world.location',
  chapters: 'chapter.prose',
  foreshadows: 'continuity.foreshadow',
  itemLedger: 'continuity.item',
  histories: 'world.history',
  characterRelations: 'character.relation',
  storyArcs: 'story.arc',
}

const CANON_SOURCE_TEMPLATE_BY_TABLE: Readonly<Record<string, string>> = {
  geographies: 'source.world-geography',
  importantLocations: 'source.world-geography',
  histories: 'source.world-history',
  historicalTimelineEvents: 'source.world-history',
  historicalKeywords: 'source.world-history',
  worldRulesProfiles: 'source.world-rules',
  canonAssertions: 'source.world-rules',
}

function templateForEntry(tableName: string, fieldKey: string) {
  return AUTHORING_NODE_CATALOG.find(template => (
    template.writes?.target === tableName && template.writes.fields?.length === 1 && template.writes.fields[0] === fieldKey
  ))
}

function nodeForEntry(entry: Awaited<ReturnType<typeof buildRagLibrary>>[number], index: number): AuthoringNodeInstance {
  const writeTemplate = templateForEntry(entry.tableName, entry.fieldKey)
  const sourceTemplateId = CANON_SOURCE_TEMPLATE_BY_TABLE[entry.tableName] ?? 'source.project-context'
  const template = writeTemplate ?? AUTHORING_NODE_BY_ID.get(sourceTemplateId)!
  const semantic = templateForEntry(entry.tableName, entry.fieldKey)?.outputs[0]?.semantic
    ?? TABLE_SEMANTICS[entry.tableName]
    ?? 'any'
  return {
    id: `overview-${hashAuthoringText(entry.key)}`,
    templateId: template.id,
    templateVersion: template.version,
    title: writeTemplate
      ? `${template.label} · ${entry.title}`
      : `${entry.fieldLabel} · ${entry.title}`,
    x: 80 + (index % 4) * 360,
    y: 80 + Math.floor(index / 4) * 210,
    config: {
      sourceKeys: ['ragSelection'],
      ragEntryKeys: [entry.key],
      contextBudget: Math.min(entry.tokenCap, 12_000),
    },
    inputs: structuredClone(template.inputs),
    outputs: template.outputs.map(port => ({ ...port, semantic, state: 'canon' as const })),
    binding: {
      mode: 'live',
      ref: { documentId: entry.documentId, fieldKey: entry.fieldKey, target: entry.tableName },
      sourceHash: hashAuthoringText(`${entry.key}:${entry.content}`),
      capturedAt: Date.now(),
    },
    collapsed: true,
  }
}

function connectRecommended(graph: AuthoringNodeGraph): AuthoringNodeGraph {
  const nodesByTemplate = new Map<string, AuthoringNodeInstance[]>()
  graph.nodes.forEach(node => {
    const values = nodesByTemplate.get(node.templateId) ?? []
    values.push(node)
    nodesByTemplate.set(node.templateId, values)
  })
  const edges = []
  const edgeKeys = new Set<string>()
  for (const source of graph.nodes) {
    const template = AUTHORING_NODE_BY_ID.get(source.templateId)
    const output = source.outputs[0]
    if (!template || !output) continue
    for (const targetTemplateId of template.recommendedAfter ?? []) {
      const target = nodesByTemplate.get(targetTemplateId)?.find(item => item.id !== source.id)
      const input = target?.inputs.find(port => authoringPortsCompatible(output, port))
      if (!target || !input) continue
      const key = `${source.id}:${output.id}:${target.id}:${input.id}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edges.push({
        id: `overview-edge-${hashAuthoringText(key)}`,
        sourceNodeId: source.id,
        sourcePortId: output.id,
        targetNodeId: target.id,
        targetPortId: input.id,
        mapping: { mode: 'full' as const, missingPolicy: 'block' as const, refreshPolicy: 'live' as const },
      })
    }
  }
  return { ...graph, edges }
}

export interface AuthoringOverviewResult {
  graph: AuthoringNodeGraph
  entryCount: number
  omittedCount: number
}

/** Build a read-only, live-bound overview without copying Canon into graph JSON. */
export async function buildAuthoringOverviewGraph(input: {
  projectId: number
  worldGroupId: number | null
}): Promise<AuthoringOverviewResult> {
  const entries = await buildRagLibrary(input)
  const nodes = entries.map((entry, index) => nodeForEntry(entry, index))
  const graph = connectRecommended({ ...emptyAuthoringGraph(), nodes })
  return { graph, entryCount: entries.length, omittedCount: 0 }
}
