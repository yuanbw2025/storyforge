import { getAgentSkillV1, type AgentSkillId, type DomainAgentId } from '../agent/skill-registry'
import { normalizeChapterText } from '../ai/chapter-memory/text-normalization'
import { buildBestChapterByOutlineMap } from '../chapters/selectors'
import { hashCanonicalValue } from '../agent/run/hash'
import type {
  Chapter,
  Character,
  DetailedOutline,
  OutlineNode,
  StoryArc,
  StoryStage,
  StorylineProgress,
  WorkspaceScope,
} from '../types'
import { parseStages } from '../types'
import { readOwnedRows } from '../workspace/scope'
import { walkOutlineChaptersInCanonicalOrder } from './canonical-outline-walk'

export type FutureEvolutionStageIdV1 =
  | 'foundation'
  | 'outline'
  | 'detail'
  | 'prose'
  | 'settlement'

export interface FutureEvolutionSkillContractV1 {
  skillId: AgentSkillId
  agentId: DomainAgentId
  contextSourceKeys: string[]
  writeTargets: Array<{ table: string; fields: string[] }>
  contextGatewayRequired: boolean
}

export interface FutureEvolutionStageV1 {
  id: FutureEvolutionStageIdV1
  label: string
  purpose: string
  dependsOnStageIds: FutureEvolutionStageIdV1[]
  skillContracts: FutureEvolutionSkillContractV1[]
  targetOutlineNodeIds: number[]
  allowedOperations: string[]
  requiresAuthorAdoptionBeforeNext: boolean
  readiness: 'ready' | 'empty-target'
}

export interface FutureOutlineTargetV1 {
  ordinal: number
  outlineNodeId: number
  chapterId: number | null
  title: string
  detailStatus: 'missing' | 'present'
  detailedOutlineId: number | null
}

export interface ProtectedStoryArcV1 {
  arcId: number
  name: string
  currentStageId: string | null
  protectedStageIds: string[]
}

export interface FutureEvolutionPlanV1 {
  version: 1
  scope: WorkspaceScope
  worldGroupId: number | null
  frontier: {
    lastWrittenOrdinal: number
    lastWrittenOutlineNodeId: number | null
    lastWrittenChapterId: number | null
    protectedOutlineNodeIds: number[]
    futureOutlineNodeIds: number[]
  }
  futureTargets: FutureOutlineTargetV1[]
  protectedStoryArcs: ProtectedStoryArcV1[]
  visibleCharacterIds: number[]
  stages: FutureEvolutionStageV1[]
  anomalies: string[]
  basisHash: string
  planHash: string
}

function sameWorldGroup(row: { worldGroupId?: number | null }, worldGroupId: number | null): boolean {
  return (row.worldGroupId ?? null) === worldGroupId
}

function visibleCharacter(character: Character, worldGroupId: number | null): boolean {
  return Boolean(character.isCrossWorld)
    || (character.homeWorldGroupId ?? null) === worldGroupId
}

function skillContract(skillId: AgentSkillId, agentId: DomainAgentId): FutureEvolutionSkillContractV1 {
  const skill = getAgentSkillV1(skillId, agentId)
  return {
    skillId: skill.id as AgentSkillId,
    agentId: skill.agentId,
    contextSourceKeys: [...skill.contextSourceKeys],
    writeTargets: skill.writeTargets.map(target => ({
      table: target.table,
      fields: [...target.fields],
    })),
    contextGatewayRequired: skill.contextGateway?.rollout === 'required',
  }
}

function protectedStages(
  stages: readonly StoryStage[],
  currentStageId: string | null,
): string[] {
  if (!currentStageId) return []
  const index = stages.findIndex(stage => stage.id === currentStageId)
  if (index < 0) return stages.map(stage => stage.id)
  return stages.slice(0, index + 1).map(stage => stage.id)
}

/**
 * Read-only control plan for continuous evolution.  It derives every AI
 * contract from the Skill registry and every row through the shared scope
 * boundary; it neither calls a model nor writes Canon.
 */
export async function buildFutureEvolutionPlanV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
}): Promise<FutureEvolutionPlanV1> {
  const [outlines, chapters, details, arcs, progress, characters] = await Promise.all([
    readOwnedRows<OutlineNode>(input.scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(input.scope, 'chapters', { owner: 'work' }),
    readOwnedRows<DetailedOutline>(input.scope, 'detailedOutlines', { owner: 'work' }),
    readOwnedRows<StoryArc>(input.scope, 'storyArcs', { owner: 'work' }),
    readOwnedRows<StorylineProgress>(input.scope, 'storylineProgress', { owner: 'work' }),
    readOwnedRows<Character>(input.scope, 'characters', { owner: 'world' }),
  ])
  const walk = walkOutlineChaptersInCanonicalOrder(outlines)
  const sequence = walk.chapters.filter(item => item.worldGroupId === input.worldGroupId)
  const chapterByOutline = buildBestChapterByOutlineMap(chapters)
  const detailByOutline = new Map(
    details
      .filter(detail => sequence.some(item => item.outlineNode.id === detail.outlineNodeId))
      .map(detail => [detail.outlineNodeId, detail]),
  )
  let lastWrittenIndex = -1
  for (let index = 0; index < sequence.length; index += 1) {
    const outlineId = sequence[index].outlineNode.id
    const chapter = outlineId == null ? undefined : chapterByOutline.get(outlineId)
    if (chapter && normalizeChapterText(chapter.content || '').length > 0) lastWrittenIndex = index
  }
  const protectedSequence = sequence.slice(0, lastWrittenIndex + 1)
  const futureSequence = sequence.slice(lastWrittenIndex + 1)
  const futureTargets: FutureOutlineTargetV1[] = futureSequence.flatMap(item => {
    const outlineId = item.outlineNode.id
    if (outlineId == null) return []
    const chapter = chapterByOutline.get(outlineId)
    const detail = detailByOutline.get(outlineId)
    return [{
      ordinal: item.ordinal,
      outlineNodeId: outlineId,
      chapterId: chapter?.id ?? null,
      title: item.outlineNode.title,
      detailStatus: detail ? 'present' as const : 'missing' as const,
      detailedOutlineId: detail?.id ?? null,
    }]
  })
  const relevantArcs = arcs.filter(arc => arc.id != null && sameWorldGroup(arc, input.worldGroupId))
  const progressByArc = new Map(progress.map(item => [item.arcId, item]))
  const protectedStoryArcs = relevantArcs.map(arc => {
    const current = progressByArc.get(arc.id!)
    const currentStageId = current?.currentStageId ?? null
    return {
      arcId: arc.id!,
      name: arc.name,
      currentStageId,
      protectedStageIds: protectedStages(parseStages(arc.stages), currentStageId),
    }
  })
  const visibleCharacters = characters.filter(character => (
    character.id != null && visibleCharacter(character, input.worldGroupId)
  ))
  const lastWritten = lastWrittenIndex < 0
    ? null
    : protectedSequence[protectedSequence.length - 1] ?? null
  const lastWrittenOutlineId = lastWritten?.outlineNode.id ?? null
  const lastWrittenChapter = lastWrittenOutlineId == null
    ? null
    : chapterByOutline.get(lastWrittenOutlineId) ?? null
  const nextProseTarget = futureTargets.find(target => target.detailStatus === 'present')
    ?? futureTargets[0]

  const stages: FutureEvolutionStageV1[] = [
    {
      id: 'foundation',
      label: '未来故事线与新角色',
      purpose: '只新增或扩展未来故事阶段与角色候选；已推进阶段、已有角色和已写历史保持只读。',
      dependsOnStageIds: [],
      skillContracts: [
        skillContract('outline.story-arcs', 'outline'),
        skillContract('character.create', 'character'),
      ],
      targetOutlineNodeIds: [],
      allowedOperations: ['create-story-arc', 'expand-story-arc', 'create-character'],
      requiresAuthorAdoptionBeforeNext: true,
      readiness: 'ready',
    },
    {
      id: 'outline',
      label: '未来章纲',
      purpose: '在最后已写章之后追加或调整未写章纲；不得重写保护区。',
      dependsOnStageIds: ['foundation'],
      skillContracts: [skillContract('outline.chapters', 'outline')],
      targetOutlineNodeIds: futureTargets.map(target => target.outlineNodeId),
      allowedOperations: ['append-after-written-frontier', 'edit-unwritten-outline'],
      requiresAuthorAdoptionBeforeNext: true,
      readiness: 'ready',
    },
    {
      id: 'detail',
      label: '未来细纲',
      purpose: '只为未写章节生成或增强场景细纲。',
      dependsOnStageIds: ['outline'],
      skillContracts: [skillContract('outline.details', 'outline')],
      targetOutlineNodeIds: futureTargets.map(target => target.outlineNodeId),
      allowedOperations: ['create-unwritten-detail', 'enhance-unwritten-detail'],
      requiresAuthorAdoptionBeforeNext: true,
      readiness: futureTargets.length ? 'ready' : 'empty-target',
    },
    {
      id: 'prose',
      label: '下一章正文',
      purpose: '基于已采纳章纲与细纲生成下一未写章候选。',
      dependsOnStageIds: ['detail'],
      skillContracts: [skillContract('prose.generate', 'prose')],
      targetOutlineNodeIds: nextProseTarget ? [nextProseTarget.outlineNodeId] : [],
      allowedOperations: ['generate-next-unwritten-chapter'],
      requiresAuthorAdoptionBeforeNext: true,
      readiness: nextProseTarget ? 'ready' : 'empty-target',
    },
    {
      id: 'settlement',
      label: '章后结算与重新规划',
      purpose: '采纳正文后更新七域候选、派生记忆和影响计划，再以新 Canon 重算下一轮。',
      dependsOnStageIds: ['prose'],
      skillContracts: [skillContract('prose.organize', 'prose')],
      targetOutlineNodeIds: nextProseTarget ? [nextProseTarget.outlineNodeId] : [],
      allowedOperations: ['post-adoption-organization', 'rebuild-derived-memory', 'recompute-future-plan'],
      requiresAuthorAdoptionBeforeNext: true,
      readiness: nextProseTarget ? 'ready' : 'empty-target',
    },
  ]
  const basis = {
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    outlines: outlines.map(row => ({
      id: row.id, parentId: row.parentId, type: row.type, title: row.title,
      summary: row.summary, order: row.order, worldGroupId: row.worldGroupId ?? null,
      updatedAt: row.updatedAt,
    })),
    chapters: chapters.map(row => ({
      id: row.id, outlineNodeId: row.outlineNodeId, content: row.content, updatedAt: row.updatedAt,
    })),
    details: details.map(row => ({
      id: row.id, outlineNodeId: row.outlineNodeId, scenes: row.scenes, updatedAt: row.updatedAt,
    })),
    arcs: relevantArcs.map(row => ({ id: row.id, stages: row.stages, status: row.status, updatedAt: row.updatedAt })),
    progress: progress.filter(row => relevantArcs.some(arc => arc.id === row.arcId)),
    characters: visibleCharacters.map(row => ({
      id: row.id, narrativeStatus: row.narrativeStatus, updatedAt: row.updatedAt,
    })),
  }
  const basisHash = await hashCanonicalValue(basis)
  const planWithoutHash = {
    version: 1 as const,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    frontier: {
      lastWrittenOrdinal: lastWritten?.ordinal ?? 0,
      lastWrittenOutlineNodeId: lastWrittenOutlineId,
      lastWrittenChapterId: lastWrittenChapter?.id ?? null,
      protectedOutlineNodeIds: protectedSequence.flatMap(item => item.outlineNode.id == null ? [] : [item.outlineNode.id]),
      futureOutlineNodeIds: futureTargets.map(target => target.outlineNodeId),
    },
    futureTargets,
    protectedStoryArcs,
    visibleCharacterIds: visibleCharacters.flatMap(character => character.id == null ? [] : [character.id]),
    stages,
    anomalies: walk.anomalies.map(anomaly => `${anomaly.kind}:${anomaly.detail}`),
    basisHash,
  }
  return {
    ...planWithoutHash,
    planHash: await hashCanonicalValue(planWithoutHash),
  }
}

export async function assertFutureEvolutionPlanFreshV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  expectedPlanHash: string
}): Promise<FutureEvolutionPlanV1> {
  const current = await buildFutureEvolutionPlanV1(input)
  if (current.planHash !== input.expectedPlanHash) {
    throw new Error('未来演化计划所依据的 Canon 已变化；必须在最新正式内容上重新规划。')
  }
  return current
}
