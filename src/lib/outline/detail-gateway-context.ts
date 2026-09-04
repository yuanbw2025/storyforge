import { db } from '../db/schema'
import { assembleContextGatewayPacketV1, projectContextGatewayInputStateV1 } from '../agent/context-gateway-input'
import { resolveAgentContextPolicy, type AgentContextProfile } from '../agent/context-policy'
import { resolveAgentSkillV1 } from '../agent/skill-registry'
import { executeContextGatewayV1, type ContextGatewayExecutionV1 } from '../context-gateway/execution'
import type { AssembleContextResult } from '../registry/types'
import type { AIConfig, OutlineNode, WorkspaceScope } from '../types'
import { parseStages } from '../types/story-arc'
import { readOwnedRows, resolveScope } from '../workspace/scope'
import { assertDetailedOutlineTargetsUnwrittenFutureV1 } from './future-boundary'

type StableRow = {
  id?: number
  ragDocumentId?: string
  worldGroupId?: number | null
  updatedAt?: number
  [key: string]: unknown
}

export interface DetailedOutlineGatewayAssemblyV1 extends AssembleContextResult {
  contextGatewayExecution: ContextGatewayExecutionV1
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function inWorld(row: StableRow, worldGroupId: number | null): boolean {
  return (row.worldGroupId ?? null) === worldGroupId
}

function originalOutlineKeys(row: (OutlineNode & StableRow) | undefined): string[] {
  if (!row?.ragDocumentId) return []
  return ['title', 'summary']
    .filter(field => typeof row[field] === 'string' && String(row[field]).trim())
    .map(field => `outline-node:${row.ragDocumentId}:field:${field}`)
}

export function detailedOutlineGatewayExecutionFromAssemblyV1(
  assembled: AssembleContextResult,
): ContextGatewayExecutionV1 | null {
  const execution = (assembled as Partial<DetailedOutlineGatewayAssemblyV1>).contextGatewayExecution
  return execution?.version === 'context-gateway-execution-v1' ? execution : null
}

/** DETAIL-1 shared context authority for single and batch scene planning. */
export async function prepareDetailedOutlineGatewayAssemblyV1(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  outlineNodeId: number
  operation: 'scenes' | 'enhanced'
  authorRequest: string
  config: AIConfig
  contextProfile?: AgentContextProfile
  signal?: AbortSignal
}): Promise<DetailedOutlineGatewayAssemblyV1> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  await assertDetailedOutlineTargetsUnwrittenFutureV1({
    scope,
    worldGroupId: input.worldGroupId,
    outlineNodeId: input.outlineNodeId,
  })
  const skill = resolveAgentSkillV1('outline', 'outline.details')
  if (skill.contextGateway?.rollout !== 'required') {
    throw new Error('outline.details 尚未进入 required Context Gateway。')
  }
  const policy = resolveAgentContextPolicy(skill.contextTaskKind, input.contextProfile ?? 'full')
  const budget = Math.min(policy.maxInputTokens, skill.contextGateway.maxRetrievedTokens)
  const [outlines, details, arcs, progress, chapters, facts, modules, nodes, beats, choices, work] = await Promise.all([
    readOwnedRows<OutlineNode & StableRow>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'detailedOutlines', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'storyArcs', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'storylineProgress', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'temporalFacts', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeModules', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeNodes', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeBeats', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeChoices', { owner: 'work' }),
    db.works.get(scope.workId),
  ])
  const worldOutlines = outlines.filter(row => inWorld(row, input.worldGroupId))
  const target = worldOutlines.find(row => row.id === input.outlineNodeId)
  if (!target?.ragDocumentId) throw new Error('细纲目标章缺少稳定资源身份。')
  const siblings = worldOutlines
    .filter(row => row.type === 'chapter' && (row.parentId ?? null) === (target.parentId ?? null))
    .sort((left, right) => left.order - right.order || Number(left.id ?? 0) - Number(right.id ?? 0))
  const targetIndex = siblings.findIndex(row => row.id === target.id)
  const adjacent = targetIndex < 0
    ? []
    : [siblings[targetIndex - 1], siblings[targetIndex + 1]].filter((row): row is OutlineNode & StableRow => Boolean(row))
  const targetRecord = `outline-node:${target.ragDocumentId}`
  const adjacentRecords = adjacent.flatMap(row => row.ragDocumentId ? [`outline-node:${row.ragDocumentId}`] : [])
  const outlineOriginals = unique([originalOutlineKeys(target), ...adjacent.map(originalOutlineKeys)].flat())

  const currentDetail = details.find(row => row.outlineNodeId === input.outlineNodeId)
  const detailKeys = currentDetail?.ragDocumentId
    ? [`detailed-outline:${currentDetail.ragDocumentId}`]
    : []
  const detailOriginalKeys = currentDetail?.ragDocumentId && Array.isArray(currentDetail.scenes) && currentDetail.scenes.length
    ? [`detailed-outline:${currentDetail.ragDocumentId}:field:scenes`]
    : []

  const currentArcs = arcs.filter(row => inWorld(row, input.worldGroupId) && row.ragDocumentId)
  const arcKeys = currentArcs.map(row => `story-arc:${row.ragDocumentId}`)
  const arcStageOriginals = currentArcs
    .filter(row => typeof row.stages === 'string' && row.stages.trim())
    .map(row => `story-arc:${row.ragDocumentId}:field:stages`)
  const stageKeys = currentArcs.flatMap(row => typeof row.stages === 'string'
    ? parseStages(row.stages).map(stage => `story-arc:${row.ragDocumentId}:stage:${encodeURIComponent(stage.id)}`)
    : [])
  const progressKeys = progress
    .filter(row => row.ragDocumentId && currentArcs.some(arc => arc.id === row.arcId))
    .map(row => `storyline-progress:${row.ragDocumentId}`)

  const outlineById = new Map(worldOutlines.flatMap(row => row.id == null ? [] : [[row.id, row]]))
  const writtenChapterIds = new Set<number>()
  const writtenBoundaryKeys = chapters.flatMap(chapter => {
    const outline = typeof chapter.outlineNodeId === 'number' ? outlineById.get(chapter.outlineNodeId) : undefined
    if (!chapter.ragDocumentId || typeof chapter.content !== 'string' || !chapter.content.trim() || !outline) return []
    if (typeof chapter.id === 'number') writtenChapterIds.add(chapter.id)
    return [`chapter:${chapter.ragDocumentId}:written-boundary`]
  })
  const writtenFactKeys = facts
    .filter(row => inWorld(row, input.worldGroupId)
      && row.ragDocumentId
      && row.status === 'confirmed'
      && (row.sourceChapterId == null || writtenChapterIds.has(Number(row.sourceChapterId))))
    .map(row => `fact:${row.ragDocumentId}`)

  const activeModuleId = work?.activeNarrativeModuleId ?? null
  const activeModule = activeModuleId == null ? undefined : modules.find(row => row.id === activeModuleId)
  if (activeModuleId != null && !activeModule?.ragDocumentId) {
    throw new Error('当前激活叙事蓝图缺少稳定资源身份。')
  }
  const blueprintKeys = activeModule?.ragDocumentId ? [
    `narrative-blueprint:${activeModule.ragDocumentId}`,
    ...nodes.filter(row => row.moduleId === activeModuleId && row.ragDocumentId)
      .map(row => `narrative-blueprint:${row.ragDocumentId}`),
    ...beats.filter(row => row.moduleId === activeModuleId && row.ragDocumentId)
      .map(row => `narrative-blueprint:${row.ragDocumentId}`),
    ...choices.filter(row => row.moduleId === activeModuleId && row.ragDocumentId)
      .map(row => `narrative-blueprint:${row.ragDocumentId}`),
  ] : []

  const mandatoryOriginalResourceKeys = unique([
    ...outlineOriginals,
    ...detailOriginalKeys,
    ...arcStageOriginals,
  ])
  const mandatoryFullResourceKeys = unique([
    targetRecord,
    ...adjacentRecords,
    ...detailKeys,
    ...arcKeys,
    ...stageKeys,
    ...progressKeys,
    ...writtenBoundaryKeys,
    ...writtenFactKeys,
    ...blueprintKeys,
  ])
  const mandatoryResourceKeys = unique([...mandatoryOriginalResourceKeys, ...mandatoryFullResourceKeys])
  const execution = await executeContextGatewayV1({
    skill,
    scope,
    worldGroupId: input.worldGroupId,
    query: [
      input.authorRequest,
      `为目标章规划${input.operation === 'scenes' ? '场景' : '增强细纲'}；遵守当前故事线阶段、进度、已写事实、相邻章与叙事蓝图。`,
    ].join('\n'),
    budgetTokens: budget,
    mandatoryResourceKeys,
    mandatoryFullResourceKeys,
    mandatoryOriginalResourceKeys,
    targetResourceKeys: unique([targetRecord, ...detailKeys, ...progressKeys, ...arcKeys]),
    additionalReadsEnabled: false,
    signal: input.signal,
  })
  const assembled = assembleContextGatewayPacketV1(execution, budget)
  // Prove that logical empty/partial/complete state is derived from SourceRefs,
  // not from a second direct-read authority.
  projectContextGatewayInputStateV1(skill, execution, assembled)
  return { ...assembled, contextGatewayExecution: execution }
}
