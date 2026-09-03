import { db } from '../db/schema'
import { assembleContextGatewayPacketV1, projectContextGatewayInputStateV1 } from '../agent/context-gateway-input'
import { resolveAgentContextPolicy, type AgentContextProfile } from '../agent/context-policy'
import { resolveAgentSkillV1 } from '../agent/skill-registry'
import { executeContextGatewayV1, type ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import type { AssembleContextResult } from '../registry/types'
import type { AIConfig, Chapter, OutlineNode, WorkspaceScope } from '../types'
import { parseStages } from '../types/story-arc'
import { readOwnedRows, resolveScope } from '../workspace/scope'

type StableRow = {
  id?: number
  ragDocumentId?: string
  worldGroupId?: number | null
  status?: string
  updatedAt?: number
  [key: string]: unknown
}

export type ProseGatewayOperationV1 = 'generate' | 'continue' | 'review' | 'revise'

export interface ProseGatewayAssemblyV1 extends AssembleContextResult {
  contextGatewayExecution: ContextGatewayExecutionV1
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function inWorld(row: StableRow, worldGroupId: number | null): boolean {
  return (row.worldGroupId ?? null) === worldGroupId
}

function fieldKeys(prefix: string, row: StableRow | undefined, fields: readonly string[]): string[] {
  if (!row?.ragDocumentId) return []
  return fields
    .filter(field => row[field] != null && String(row[field]).trim() && String(row[field]) !== '[]')
    .map(field => `${prefix}:${row.ragDocumentId}:field:${encodeURIComponent(field)}`)
}

function recordKey(prefix: string, row: StableRow | undefined): string | null {
  return row?.ragDocumentId ? `${prefix}:${row.ragDocumentId}` : null
}

export function proseGatewayExecutionFromAssemblyV1(
  assembled: AssembleContextResult,
): ContextGatewayExecutionV1 | null {
  const execution = (assembled as Partial<ProseGatewayAssemblyV1>).contextGatewayExecution
  return execution?.version === 'context-gateway-execution-v1' ? execution : null
}

/**
 * PROSE-1 shared context authority. Generation, continuation, semantic review,
 * and report-driven revision all call this function; callers may add explicit
 * author text/style instructions, but may not assemble a second Canon packet.
 */
export async function prepareProseGatewayAssemblyV1(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  chapterId?: number | null
  outlineNodeId: number
  operation: ProseGatewayOperationV1
  authorRequest: string
  perspectiveCharacterId?: number | null
  citedReferenceIds?: readonly number[]
  config: AIConfig
  contextProfile?: AgentContextProfile
  /** The step editor requires a confirmed detail. The master Agent may opt in
   * to an outline-only, candidate-only draft; that draft still cannot bypass
   * the normal adoption and stale gates. */
  allowOutlineOnlyAgentDraft?: boolean
  signal?: AbortSignal
}): Promise<ProseGatewayAssemblyV1> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const skill = resolveAgentSkillV1('prose', `prose.${input.operation}`)
  if (skill.contextGateway?.rollout !== 'required') {
    throw new Error(`prose.${input.operation} 尚未进入 required Context Gateway。`)
  }
  const policy = resolveAgentContextPolicy(skill.contextTaskKind, input.contextProfile ?? 'full')
  const budget = Math.min(policy.maxInputTokens, skill.contextGateway.maxRetrievedTokens)
  const [outlines, details, chapters, arcs, progress, facts, knowledge, characters, modules, nodes, beats, choices, references, work] = await Promise.all([
    readOwnedRows<OutlineNode & StableRow>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'detailedOutlines', { owner: 'work' }),
    readOwnedRows<Chapter & StableRow>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'storyArcs', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'storylineProgress', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'temporalFacts', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'knowledgeLedger', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<StableRow>(scope, 'narrativeModules', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeNodes', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeBeats', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'narrativeChoices', { owner: 'work' }),
    readOwnedRows<StableRow>(scope, 'references', { owner: 'work' }),
    db.works.get(scope.workId),
  ])
  const targetChapter = input.chapterId == null
    ? undefined
    : chapters.find(row => row.id === input.chapterId)
  const targetOutline = outlines.find(row => row.id === input.outlineNodeId)
  if (input.chapterId != null
    && (!targetChapter?.ragDocumentId || targetChapter.outlineNodeId !== input.outlineNodeId)) {
    throw new Error('正文目标章节缺失、越界或没有稳定资源身份。')
  }
  if (!targetOutline?.ragDocumentId || !inWorld(targetOutline, input.worldGroupId)) {
    throw new Error('正文目标章纲缺失、越界或没有稳定资源身份。')
  }
  if (!String(targetOutline.summary ?? '').trim()) throw new Error('正文生成前必须先确认目标章纲。')
  const perspectiveCharacterId = input.perspectiveCharacterId === undefined
    ? targetChapter?.perspectiveCharacterId ?? null
    : input.perspectiveCharacterId
  const detail = details.find(row => row.outlineNodeId === input.outlineNodeId)
  if (!detail?.ragDocumentId && input.allowOutlineOnlyAgentDraft !== true) {
    throw new Error('正文生成前必须先建立目标章细纲。')
  }

  const { sequence } = resolveCanonicalChapterSequence(outlines, chapters)
  const outlineSequence = walkOutlineChaptersInCanonicalOrder(outlines).chapters
  const targetIndex = outlineSequence.findIndex(entry => entry.outlineNode.id === input.outlineNodeId)
  if (targetIndex < 0) throw new Error('正文目标章纲不在当前作品规范章序中。')
  const outlineIndex = new Map(outlineSequence.flatMap((entry, index) => (
    entry.outlineNode.id == null ? [] : [[entry.outlineNode.id, index] as const]
  )))
  const chapterOrder = new Map<number, number>()
  sequence.forEach(entry => {
    const index = entry.outlineNode?.id == null ? undefined : outlineIndex.get(entry.outlineNode.id)
    if (entry.chapter.id != null && index != null) chapterOrder.set(entry.chapter.id, index)
  })
  const previous = [...sequence].reverse().find(entry => {
    const index = entry.outlineNode?.id == null ? undefined : outlineIndex.get(entry.outlineNode.id)
    return index != null && index < targetIndex && String(entry.chapter.content ?? '').trim()
  })

  const outlineOriginals = fieldKeys('outline-node', targetOutline, ['title', 'summary'])
  const detailOriginals = fieldKeys('detailed-outline', detail, [
    'scenes', 'openingHook', 'endingCliffhanger', 'prohibitions', 'emotionArc',
  ])
  const detailRecord = recordKey('detailed-outline', detail)
  const targetOutlineRecord = recordKey('outline-node', targetOutline)!
  const previousContinuity = previous?.chapter.ragDocumentId
    ? [`chapter:${previous.chapter.ragDocumentId}:continuity-tail`]
    : []
  const previousOutline = previous?.outlineNode?.ragDocumentId
    ? [`outline-node:${previous.outlineNode.ragDocumentId}`]
    : []

  const worldArcs = arcs.filter(row => inWorld(row, input.worldGroupId) && row.ragDocumentId)
  const arcKeys = worldArcs.map(row => `story-arc:${row.ragDocumentId}`)
  const stageKeys = worldArcs.flatMap(row => typeof row.stages === 'string'
    ? parseStages(row.stages).map(stage => `story-arc:${row.ragDocumentId}:stage:${encodeURIComponent(stage.id)}`)
    : [])
  const progressKeys = progress
    .filter(row => row.ragDocumentId && worldArcs.some(arc => arc.id === row.arcId))
    .map(row => `storyline-progress:${row.ragDocumentId}`)

  const factKeys = facts.filter(row => {
    if (!row.ragDocumentId || !inWorld(row, input.worldGroupId) || row.status !== 'confirmed') return false
    const from = typeof row.validFromChapterId === 'number' ? chapterOrder.get(row.validFromChapterId) : undefined
    const to = typeof row.validToChapterId === 'number' ? chapterOrder.get(row.validToChapterId) : undefined
    return (from == null || from <= targetIndex) && (to == null || targetIndex < to)
  }).map(row => `fact:${row.ragDocumentId}`)

  const perspective = perspectiveCharacterId == null
    ? undefined
    : characters.find(row => row.id === perspectiveCharacterId)
  if (perspectiveCharacterId != null && !perspective?.ragDocumentId) {
    throw new Error('视角角色缺失、越界或没有稳定资源身份。')
  }
  const perspectiveKeys = perspective?.ragDocumentId ? [`character:${perspective.ragDocumentId}`] : []
  const knowledgeKeys = perspectiveCharacterId == null ? [] : knowledge.filter(row => {
    if (!row.ragDocumentId || row.characterId !== perspectiveCharacterId || row.status !== 'confirmed') return false
    const sourceIndex = typeof row.sourceChapterId === 'number' ? chapterOrder.get(row.sourceChapterId) : undefined
    return sourceIndex == null || sourceIndex <= targetIndex
  }).map(row => `fact:${row.ragDocumentId}`)

  const activeModuleId = work?.activeNarrativeModuleId ?? null
  const activeModule = activeModuleId == null ? undefined : modules.find(row => row.id === activeModuleId)
  if (activeModuleId != null && !activeModule?.ragDocumentId) {
    throw new Error('当前激活叙事蓝图缺少稳定资源身份。')
  }
  const moduleNodes = activeModuleId == null ? [] : nodes.filter(row => (
    row.moduleId === activeModuleId
    && row.ragDocumentId
    && (row.sourceOutlineNodeId === input.outlineNodeId || row.key === activeModule?.entryNodeKey)
  ))
  const nodeKeys = new Set(moduleNodes.map(row => row.key).filter((key): key is string => typeof key === 'string'))
  const blueprintKeys = activeModule?.ragDocumentId ? [
    `narrative-blueprint:${activeModule.ragDocumentId}`,
    ...moduleNodes.map(row => `narrative-blueprint:${row.ragDocumentId}`),
    ...beats.filter(row => row.moduleId === activeModuleId && row.ragDocumentId && nodeKeys.has(String(row.nodeKey)))
      .map(row => `narrative-blueprint:${row.ragDocumentId}`),
    ...choices.filter(row => row.moduleId === activeModuleId && row.ragDocumentId && nodeKeys.has(String(row.sourceNodeKey)))
      .map(row => `narrative-blueprint:${row.ragDocumentId}`),
  ] : []

  const dossierKey = targetChapter?.ragDocumentId
    ? `chapter:${targetChapter.ragDocumentId}:consistency-dossier`
    : null
  const citedReferenceKeys = references
    .filter(row => row.ragDocumentId && input.citedReferenceIds?.includes(Number(row.id)))
    .map(row => `reference:${row.ragDocumentId}`)
  const mandatoryOriginalResourceKeys = unique([...outlineOriginals, ...detailOriginals])
  const mandatoryFullResourceKeys = unique([
    targetOutlineRecord,
    ...(detailRecord ? [detailRecord] : []),
    ...previousContinuity,
    ...previousOutline,
    ...arcKeys,
    ...stageKeys,
    ...progressKeys,
    ...perspectiveKeys,
    ...knowledgeKeys,
    ...factKeys,
    ...blueprintKeys,
    ...citedReferenceKeys,
    ...(dossierKey ? [dossierKey] : []),
  ])
  const mandatoryResourceKeys = unique([...mandatoryOriginalResourceKeys, ...mandatoryFullResourceKeys])
  const execution = await executeContextGatewayV1({
    skill,
    scope,
    worldGroupId: input.worldGroupId,
    chapterId: targetChapter?.id ?? null,
    characterId: perspectiveCharacterId,
    query: [
      input.authorRequest,
      `正文${input.operation}：落实本章章纲、细纲和禁止项，遵守当前故事阶段、直接连续性、视角角色认知、已确认事实和激活叙事蓝图；按需召回长尾世界设定、早期伏笔与远章原文。`,
      String(targetOutline.title ?? ''),
      String(targetOutline.summary ?? ''),
    ].filter(Boolean).join('\n'),
    budgetTokens: budget,
    mandatoryResourceKeys,
    mandatoryFullResourceKeys,
    mandatoryOriginalResourceKeys,
    targetResourceKeys: unique([
      targetOutlineRecord,
      ...(detailRecord ? [detailRecord] : []),
      ...(dossierKey ? [dossierKey] : []),
      ...perspectiveKeys,
      ...arcKeys,
    ]),
    entityKeys: perspectiveKeys,
    storyArcKeys: arcKeys,
    ...(targetChapter?.id == null ? {} : { timeRange: { throughChapterId: targetChapter.id } }),
    additionalReadsEnabled: false,
    signal: input.signal,
  })
  const assembled = assembleContextGatewayPacketV1(execution, budget)
  void input.config // provider/model do not affect deterministic Gateway selection.
  const result: ProseGatewayAssemblyV1 = { ...assembled, contextGatewayExecution: execution }
  projectContextGatewayInputStateV1(skill, execution, result)
  return result
}
