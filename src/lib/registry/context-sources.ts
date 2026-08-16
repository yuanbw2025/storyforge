/**
 * CONTEXT_SOURCES(Phase 1.3a) · AI 上下文读取源注册表。
 *
 * 本文件只登记读取源和旧适配器桥接。1.3b 再把生成入口迁移到 assembleContext()。
 */
import { db } from '../db/schema'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { getFactPredicate } from './fact-predicate-registry'
import { retrieveChunks, embedQuery, readNarrativeSummaryContext } from '../retrieval/retrieval'
import { isEmbeddingReady, embeddingModelTag } from '../ai/adapters/embedding-adapter'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  buildCreativeRulesContext,
  buildHistoricalContext,
  buildLocationContext,
  buildRefAnalysisContext,
  buildCharacterContext,
  formatPowerSystemBlock,
  formatStoryCoreBlock,
  formatWorldviewBlock,
  getContextMemo,
} from '../ai/context-builder'
import { buildCodexContext } from '../ai/codex-context'
import { buildCultivationContext } from '../ai/cultivation-context'
import { buildWorldRulesContext } from '../ai/world-rules-manifest'
import { formatHandoff } from '../ai/chapter-memory/handoff-format'
import { getChapterDerivedMemoryStatus, normalizeChapterText } from '../ai/chapter-memory/text-normalization'
import { parseStages } from '../types/story-arc'
import { parseFields } from '../types/state-card'
import { parseBeats } from '../types/emotion-beat'
import { buildForeshadowTaskContext } from '../foreshadow/context'
import { formatHeldItemsContext, readProjectHeldItems } from '../consistency/held-items'
import { formatCharacterKnowledgeContext, readProjectCharacterKnowledge } from '../knowledge-ledger/knowledge-ledger'
import { formatCanonAssertionsContext, readCanonAssertions } from '../fact-ledger/setting-assertions'
import { readStorylineProgressContext } from '../storyline/storyline-progress'
import { analyzeEditImpact } from '../consistency/impact-analysis'
import { readCultivationProgressContext } from '../cultivation/progress'
import type { Chapter, Character, OutlineNode, PowerSystem, Worldview } from '../types'
import {
  parseCharacterDrivenPlanArcs,
  parseCharacterDrivenPlotVolumes,
} from '../types/character-driven-plan'
import type { ContextSource } from './types'
import { countWords, htmlToPlainText } from '../utils/html'
import {
  formatStyleCalibrationFeedback,
  formatStyleFewShotPairs,
  parseStyleCalibrationFeedback,
  parseStyleRevisionPairs,
} from '../style/style-learning'
import {
  buildInspirationFusionInput,
  latestInspirationVersion,
  parseInspirationFragments,
  parseInspirationVersions,
} from '../inspiration/workspace'
import {
  readAgentOutlineTree,
  readAgentProjectStatus,
  readAgentSearchResults,
  readAgentWorldGroups,
} from '../agent/read-sources'
import { readRagSelectionContext } from '../retrieval/rag-library'
import { parseSimulationCanonSnapshot, verifySimulationCanonSnapshot } from '../simulation/canon-snapshot'
import { readSimulationState } from '../simulation/runtime'
import type { AssembleContextInput } from './types'

async function readSimulationRuntimeContext(input: AssembleContextInput): Promise<string> {
  if (input.simulationSessionId == null) return ''
  const session = await db.simulationSessions.get(input.simulationSessionId)
  if (!session || session.projectId !== input.projectId) return ''
  if (input.worldGroupId !== undefined && (session.worldGroupId ?? null) !== (input.worldGroupId ?? null)) return ''
  const snapshot = parseSimulationCanonSnapshot(session.canonSnapshotJson)
  if (!snapshot || !(await verifySimulationCanonSnapshot(snapshot))) {
    throw new Error('冻结运行时 Canon 快照校验失败。')
  }
  const state = await readSimulationState(session.id!)
  const sourceLines = snapshot.sources.slice(0, 120).map(source => (
    `- ${source.sourceKey}｜${source.kind}｜${source.name}${source.summary ? `｜${source.summary}` : ''}`
  ))
  const entityLines = Object.values(state.entities).slice(0, 120).map(entity => {
    const attributes = Object.entries(entity.attributes)
      .slice(0, 16)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ')
    return `- ${entity.entityKey}｜${entity.kind}｜${entity.name}｜地点=${entity.locationKey ?? '无'}｜生命周期=${entity.lifecycleStatus}${attributes ? `｜属性=${attributes}` : ''}`
  })
  const memoryLines = state.memories.slice(-80).map(memory => (
    `- ${memory.subjectKey}｜${memory.status}｜${memory.content}`
  ))
  const narrativeLines = state.narratives.slice(-40).map(item => `- #${item.eventSequence} ${item.text}`)
  const ttrpg = state.ttrpg
  const ttrpgLines = ttrpg ? [
    `- 场景=${ttrpg.scene?.title ?? '未开始'}｜状态=${ttrpg.scene?.status ?? '无'}｜地点=${ttrpg.scene?.locationKey ?? '无'}`,
    `- 回合=${ttrpg.round}｜当前行动者=${ttrpg.activeActorKey ?? '无'}｜顺序=${ttrpg.turnOrder.join(' → ') || '无'}`,
    ...ttrpg.actions.slice(-20).map(action => `- 动作 #${action.eventSequence}｜${action.actorKey}｜${action.text}`),
    ...ttrpg.checks.slice(-20).map(check => (
      `- 检定 #${check.eventSequence}｜${check.actorKey}｜${check.skill}｜${check.expression}=${check.total} vs DC ${check.dc}｜${check.success ? '成功' : '失败'}`
    )),
    ...(ttrpg.attacks ?? []).slice(-20).map(attack => (
      `- 攻击｜${attack.actorKey} → ${attack.targetKey}｜${attack.attackExpression}=${attack.attackTotal} vs AC ${attack.armorClass}｜${attack.hit ? `命中，${attack.resourceKey} ${attack.damageTotal}` : '未命中'}`
    )),
    ...(ttrpg.encounter ? [
      `- 遭遇=${ttrpg.encounter.title}｜状态=${ttrpg.encounter.status}｜战斗回合=${ttrpg.encounter.round}｜当前=${ttrpg.encounter.activeActorKey ?? '无'}`,
      ...ttrpg.encounter.turnOrder.map(key => {
        const combatant = ttrpg.encounter?.combatants[key]
        if (!combatant) return `- 参与者=${key}`
        const resources = Object.entries(combatant.resources).map(([name, resource]) => `${name}=${resource.current}/${resource.maximum}`).join(', ')
        const conditions = combatant.conditions.map(condition => `${condition.name}${condition.stacks > 1 ? `×${condition.stacks}` : ''}`).join('、') || '无'
        return `- 战斗参与者=${key}｜先攻=${combatant.initiative}｜AC=${combatant.armorClass}｜资源=${resources}｜状态=${conditions}`
      }),
    ] : []),
    ...(ttrpg.campaign ? [
      `- 长期战役摘要=${ttrpg.campaign.summary || '暂无'}`,
      ...ttrpg.campaign.quests.slice(-40).map(quest => (
        `- 任务=${quest.questId}｜${quest.title}｜状态=${quest.status}｜优先级=${quest.priority}${quest.dueClock == null ? '' : `｜期限=${quest.dueClock}`}${quest.description ? `｜${quest.description}` : ''}`
      )),
      ...ttrpg.campaign.npcSchedules.slice(-40).map(schedule => (
        `- NPC日程=${schedule.scheduleId}｜${schedule.entityKey}｜${schedule.startClock}-${schedule.endClock ?? '持续'}｜地点=${schedule.locationKey ?? '无'}｜${schedule.activity}｜重复=${schedule.recurrence}`
      )),
    ] : []),
  ] : []
  const chat = state.chat
  const chatLines = chat ? [
    `- 角色=${chat.characterKey}｜用户=${chat.identity.name}${chat.identity.description ? `｜身份=${chat.identity.description}` : ''}`,
    `- 场景=${chat.scene.title}${chat.scene.description ? `｜${chat.scene.description}` : ''}`,
    ...chat.messages
      .filter(message => message.supersededBySequence == null)
      .slice(-24)
      .map(message => `- ${message.role === 'user' ? chat.identity.name : (state.entities[message.speakerKey ?? '']?.name ?? message.speakerKey ?? '角色')}｜${message.text}`),
  ] : []
  return [
    `【冻结运行时会话】${session.title}｜类型=${session.kind}｜逻辑时间=${state.clock}｜事件序号=${state.lastSequence}`,
    `【冻结世界】${snapshot.worldLabel}｜worldGroupId=${snapshot.worldGroupId ?? 'null'}｜快照=${snapshot.snapshotHash.slice(0, 16)}`,
    '【冻结 Canon 来源（只读）】',
    ...(sourceLines.length ? sourceLines : ['- 暂无冻结来源']),
    '【运行时实体（只读）】',
    ...(entityLines.length ? entityLines : ['- 暂无运行时实体']),
    '【运行时记忆（只读）】',
    ...(memoryLines.length ? memoryLines : ['- 暂无记忆']),
    '【最近运行时叙事（只读）】',
    ...(narrativeLines.length ? narrativeLines : ['- 暂无叙事']),
    ...(ttrpgLines.length ? ['【跑团场景与回合（只读）】', ...ttrpgLines] : []),
    ...(chatLines.length ? ['【角色聊天状态（只读）】', ...chatLines] : []),
  ].join('\n')
}

async function readWorldview(projectId: number, worldGroupId?: number | null): Promise<Worldview | null> {
  const rows = await db.worldviews.where('projectId').equals(projectId).toArray()
  if (worldGroupId != null) {
    return rows.find(w => w.worldGroupId === worldGroupId) ?? null
  }
  return rows.find(w => (w.worldGroupId ?? null) === null) ?? rows[0] ?? null
}

async function readPowerSystem(projectId: number, worldGroupId?: number | null): Promise<PowerSystem | null> {
  const rows = await db.powerSystems.where('projectId').equals(projectId).toArray()
  if (worldGroupId != null) {
    return rows.find(p => p.worldGroupId === worldGroupId) ?? null
  }
  return rows.find(p => (p.worldGroupId ?? null) === null) ?? rows[0] ?? null
}

async function readCharacters(projectId: number, worldGroupId?: number | null): Promise<Character[]> {
  const rows = await db.characters.where('projectId').equals(projectId).toArray()
  if (worldGroupId === undefined) return rows
  const wg = worldGroupId ?? null
  return rows.filter(c => c.isCrossWorld || (c.homeWorldGroupId ?? null) === wg)
}

async function readForeshadows(projectId: number, chapterId?: number | null): Promise<string> {
  const [rows, chapters, outlineNodes] = await Promise.all([
    db.foreshadows.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
  ])
  return buildForeshadowTaskContext(rows, {
    currentChapterId: chapterId ?? null,
    chapters,
    outlineNodes,
  })
}

/** FB-5:作者文风画像。仅当画像存在且 enabled 时返回,否则空串(不进上下文)。 */
async function readUserStyleProfile(projectId: number): Promise<string> {
  const profile = await db.userStyleProfiles.where('projectId').equals(projectId).first()
  if (!profile || !profile.enabled || !profile.profile.trim()) return ''
  const pairExamples = formatStyleFewShotPairs(parseStyleRevisionPairs(profile.revisionPairs))
  const feedback = formatStyleCalibrationFeedback(
    parseStyleCalibrationFeedback(profile.calibrationFeedback),
  )
  return [
    '【作者文风偏好】',
    '请在本次写作中贴合作者一贯的表达习惯，但不要照搬样本中的剧情、人物名、地点名或专有名词。',
    profile.profile.trim(),
    pairExamples ? `【作者改稿对照（仅学习改写方向）】\n${pairExamples}` : '',
    feedback ? `【最近校准反馈】\n${feedback}` : '',
  ].filter(Boolean).join('\n\n')
}

async function readInspirationWorkspaceContext(
  projectId: number,
  selectedIds: string[] | undefined,
  mode: 'single' | 'multiworld' = 'single',
): Promise<string> {
  if (!selectedIds?.length) return ''
  const workspace = await db.inspirationWorkspaces.where('projectId').equals(projectId).first()
  if (!workspace) return ''
  const fragments = parseInspirationFragments(workspace.fragments)
  const versions = parseInspirationVersions(workspace.versions)
  return buildInspirationFusionInput({
    fragments,
    selectedIds: new Set(selectedIds),
    previousVersion: latestInspirationVersion(versions, mode),
  })
}

export async function readActiveCharacterDrivenPlanContext(projectId: number): Promise<string> {
  const project = await db.projects.get(projectId)
  const activeId = project?.activeCharacterDrivenPlanId
  if (activeId == null) return ''

  const plan = await db.characterDrivenPlans.get(activeId)
  if (!plan || plan.projectId !== projectId) return ''

  const [characters, arcs] = await Promise.all([
    db.characters.where('projectId').equals(projectId).toArray(),
    Promise.resolve(parseCharacterDrivenPlanArcs(plan.arcs)),
  ])
  const byId = new Map(characters.flatMap(character =>
    character.id == null ? [] : [[character.id, character] as const],
  ))
  const lines = [
    `【当前生效的角色驱动方案】${plan.name}（v${plan.version}，${plan.status}）`,
  ]
  if (plan.userHint.trim()) lines.push(`作者要求：${plan.userHint.trim()}`)
  for (const arc of arcs) {
    const current = arc.characterId == null ? null : byId.get(arc.characterId)
    const identity = current
      ? `${current.name}${current.name !== arc.name ? `（方案快照名：${arc.name}）` : ''}`
      : `${arc.name}（原角色已删除，仅保留方案快照）`
    lines.push(
      `- ${identity}｜${arc.role || '未标注身份'}：${arc.initialState || '未填写'} → ${arc.targetState || '未填写'}`,
    )
  }
  const volumes = parseCharacterDrivenPlotVolumes(plan.generatedVolumes)
  for (const volume of volumes) {
    lines.push(`卷：${volume.volumeTitle}｜${volume.volumeSummary}`)
    if (volume.characterArcs) lines.push(`  弧光：${volume.characterArcs}`)
    for (const chapter of volume.chapters) {
      lines.push(`  - ${chapter.title}：${chapter.summary}${chapter.arcProgress ? `；弧光推进：${chapter.arcProgress}` : ''}`)
    }
  }
  return lines.join('\n')
}

async function readStoryArcs(projectId: number): Promise<string> {
  try {
    const arcs = await db.storyArcs.where('projectId').equals(projectId).toArray()
    if (!arcs.length) return ''
    
    const parts = ['【全局故事线】\n⚠️ 注意：若与"故事核心"冲突，以"故事核心"为准。']
    
    for (const arc of arcs.slice(0, 5)) {
      // 防御性检查
      if (!arc || typeof arc !== 'object') continue
      
      const stages = parseStages(arc.stages || '[]')
      if (stages.length === 0) continue
      
      const typeLabel = arc.type === 'main' ? '主线' : '支线'
      const arcName = arc.name || '未命名'
      
      // 智能截取描述：防御性处理
      const arcDesc = arc.description 
        ? smartTruncate(arc.description, 150) 
        : ''
      parts.push(`\n[${typeLabel}] ${arcName}${arcDesc ? `：${arcDesc}` : ''}`)
      
      // 只抓取前 5 个阶段（避免过长）
      const stagesToShow = stages.slice(0, 5)
      const isLastStage = stages.length > 5 ? '(仅显示前5个阶段)' : ''
      
      for (let i = 0; i < stagesToShow.length; i++) {
        const stage = stagesToShow[i]
        // 防御性检查
        if (!stage) continue
        
        const stageTitle = stage.title || `阶段 ${i + 1}`
        
        // 智能截取阶段描述：防御性处理
        const stageDesc = stage.description 
          ? smartTruncate(stage.description, 100) 
          : '(无描述)'
        
        // 完整展示关键事件（最多 5 个）：防御性处理
        const events = Array.isArray(stage.keyEvents) 
          ? stage.keyEvents.slice(0, 5).filter((e: string) => e && e.trim())
          : []
        const eventsStr = events.length > 0 
          ? ` | 关键事件：${events.join(' → ')}` 
          : ''
        
        // 完整展示转折点（如果有）：防御性处理
        const tpStr = stage.turningPoint && stage.turningPoint.trim()
          ? ` | ⚡ 转折点：${smartTruncate(stage.turningPoint, 80)}` 
          : ''
        
        parts.push(`  ${i + 1}. ${stageTitle}：${stageDesc}${eventsStr}${tpStr}`)
      }
      
      if (isLastStage) {
        parts.push(`  ... ${isLastStage}`)
      }
    }
    
    return parts.join('\n')
  } catch (error) {
    console.warn('[readStoryArcs] 读取失败：', error)
    return ''  // 防御性返回空，而不是崩溃
  }
}

/**
 * 智能截断函数：保留首尾，避免丢失反转信息
 * @param text 原始文本
 * @param maxChars 最大字符数
 * @returns 截断后的文本
 */
function smartTruncate(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text || ''
  
  // 保留首段（通常是铺垫）
  const headSize = Math.floor(maxChars * 0.6)
  // 保留尾段（通常是反转/结果）
  const tailSize = Math.floor(maxChars * 0.4) - 5
  
  const head = text.slice(0, headSize)
  const tail = text.slice(-tailSize)
  
  return `${head}...${tail}`
}

async function readEmotionBeats(projectId: number, chapterId?: number | null): Promise<string> {
  if (chapterId == null) return ''
  const rows = await db.emotionBeatCards.where('projectId').equals(projectId).toArray()
  const card = rows.find(c => c.chapterId === chapterId)
  if (!card) return ''
  const beats = parseBeats(String(card.beats || '[]'))
  if (!beats.length) return ''
  return [
    '【本章情感节拍规划】',
    card.overallArc ? `整体弧线:${card.overallArc}` : '',
    ...beats.map(b => `- ${b.label}${b.sceneGoal ? `: ${b.sceneGoal}` : ''}`),
  ].filter(Boolean).join('\n')
}

/** FLOW-3D：只读的一致性影响摘要，供节点图接线查看，不产生任何写回。 */
async function readConsistencyReport(projectId: number, chapterId?: number | null): Promise<string> {
  if (chapterId == null) return ''
  const impact = await analyzeEditImpact(projectId, chapterId)
  const staleFacts = impact.factsFromChapter.filter(fact => ['stale', 'source-missing', 'invalid-range'].includes(fact.status))
  const lines = [
    `【一致性影响报告】当前章节来源事实 ${impact.factsFromChapter.length} 条；后续可能受影响章节 ${impact.downstreamChapterIds.length} 个。`,
    staleFacts.length ? `【待复核事实】${staleFacts.map(fact => `${fact.subjectName}/${fact.predicate}=${fact.value}`).join('；')}` : '【待复核事实】暂无已标记失效事实。',
  ]
  return lines.join('\n')
}

async function readStateCards(projectId: number, referenceText?: string, extraIds?: number[]): Promise<string> {
  const rows = await db.stateCards.where('projectId').equals(projectId).toArray()
  if (!rows.length) return ''
  const extra = new Set(extraIds ?? [])
  const text = referenceText || ''
  const selected = text
    ? rows.filter(c => extra.has(c.id!) || text.includes(c.entityName))
    : rows.slice(0, 40)
  if (!selected.length) return ''
  const lines = selected.map(c => {
    const fields = parseFields(c.fields).slice(0, 8).map(f => `${f.key}:${f.value}`).join(' | ')
    return `- ${c.category}/${c.entityName}: ${fields}`
  })
  return `【当前状态表】\n${lines.join('\n')}`
}

async function readChapterOutline(projectId: number, outlineNodeId?: number | null, chapterId?: number | null): Promise<string> {
  let nodeId = outlineNodeId ?? null
  if (nodeId == null && chapterId != null) {
    const chapter = await db.chapters.get(chapterId)
    nodeId = chapter?.outlineNodeId ?? null
  }
  if (nodeId == null) return ''
  const node = await db.outlineNodes.get(nodeId)
  if (!node || node.projectId !== projectId) return ''
  return `【当前章节大纲】\n${node.title}${node.summary ? `\n${node.summary}` : ''}`
}

async function readExistingVolumeOutlines(projectId: number): Promise<string> {
  const rows = await db.outlineNodes.where('projectId').equals(projectId).toArray()
  const volumes = rows
    .filter(node => node.type === 'volume' && node.parentId == null)
    .sort((a, b) => a.order - b.order)
  if (!volumes.length) return ''
  return [
    '【已有卷大纲（必须接续，禁止重复）】',
    ...volumes.map((volume, index) => (
      `${index + 1}. ${volume.title}${volume.summary ? `\n   ${volume.summary}` : '\n   （尚未填写卷纲）'}`
    )),
  ].join('\n')
}

function findVolumeAncestor(nodeId: number, nodesById: Map<number, OutlineNode>): OutlineNode | null {
  let current = nodesById.get(nodeId) ?? null
  const visited = new Set<number>()
  while (current) {
    if (current.type === 'volume') return current
    if (current.parentId == null || visited.has(current.id ?? -1)) return null
    if (current.id != null) visited.add(current.id)
    current = nodesById.get(current.parentId) ?? null
  }
  return null
}

function excerptChapterText(chapter: Chapter, maxChars = 360): string {
  const text = normalizeChapterText(chapter.content || '')
  if (!text) return ''
  if (text.length <= maxChars) return text
  const edge = Math.max(100, Math.floor(maxChars / 2))
  return `${text.slice(0, edge)}\n...\n${text.slice(-edge)}`
}

async function summarizeWrittenChapterForOutline(entry: {
  ordinal: number
  chapter: Chapter
  outlineNode: OutlineNode | null
}): Promise<string> {
  const title = entry.outlineNode?.title ?? entry.chapter.title
  const plain = normalizeChapterText(entry.chapter.content || '')
  const words = Math.max(entry.chapter.wordCount || 0, countWords(htmlToPlainText(entry.chapter.content || '').trim()))
  const lines = [`第 ${entry.ordinal} 章 ${title}（已写正文，约 ${words} 字）`]

  const memory = await getChapterDerivedMemoryStatus(entry.chapter)
  if (entry.chapter.summary?.trim() && memory.summary === 'verified') {
    lines.push(`章节记忆:${entry.chapter.summary.trim()}`)
  } else if (entry.outlineNode?.summary?.trim()) {
    lines.push(`原章纲:${entry.outlineNode.summary.trim()}`)
  }

  if (entry.chapter.continuityHandoff && memory.handoff === 'verified') {
    const handoffLines = formatHandoff(entry.chapter.continuityHandoff).slice(0, 8)
    if (handoffLines.length) lines.push(`结尾交接:${handoffLines.join('；')}`)
  }

  const reconciliation = entry.chapter.planReconciliation
  if (reconciliation?.confirmedActualProgress?.trim()) {
    lines.push(`作者确认实际进展:${reconciliation.confirmedActualProgress.trim()}`)
  } else if (reconciliation) {
    const deltas = [
      ...reconciliation.deviations.map(item => `实际偏移:${item.text}`),
      ...reconciliation.newConstraints.map(item => `新增约束:${item.text}`),
      ...reconciliation.nextChapterImpacts.map(item => `后续影响:${item.text}`),
    ].slice(0, 6)
    if (deltas.length) lines.push(`计划-正文对账:${deltas.join('；')}`)
  }

  if (plain && !entry.chapter.summary?.trim()) {
    lines.push(`正文短摘:${excerptChapterText(entry.chapter)}`)
  }

  return `- ${lines.join('\n  ')}`
}

async function readWrittenChapterProgress(
  projectId: number,
  outlineNodeId?: number | null,
  worldGroupId?: number | null,
): Promise<string> {
  if (outlineNodeId == null) return ''
  const [outlineNodes, chapters] = await Promise.all([
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
  ])
  const nodesById = new Map(outlineNodes.filter(node => node.id != null).map(node => [node.id!, node]))
  const target = nodesById.get(outlineNodeId)
  if (!target) return ''
  const targetVolume = target.type === 'volume' ? target : findVolumeAncestor(outlineNodeId, nodesById)
  if (!targetVolume?.id) return ''

  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const written = sequence
    .filter(entry => entry.outlineNode && findVolumeAncestor(entry.outlineNode.id!, nodesById)?.id === targetVolume.id)
    .filter(entry => worldGroupId === undefined || entry.worldGroupId === (worldGroupId ?? null))
    .filter(entry => normalizeChapterText(entry.chapter.content || '').length > 0)
    .slice(0, 40)

  if (!written.length) return ''

  const lines = await Promise.all(written.map((entry, index) => summarizeWrittenChapterForOutline({
    ordinal: sequence.findIndex(item => item.chapter === entry.chapter) + 1 || index + 1,
    chapter: entry.chapter,
    outlineNode: entry.outlineNode,
  })))

  return [
    `【本卷已写正文进度 · ${targetVolume.title}】`,
    '以下内容来自已保存章节正文/章节记忆，是补卷纲或章纲时必须尊重的事实边界；不要改写、否认、重排这些已写内容。',
    ...lines,
  ].join('\n')
}

/**
 * FB-9 修复:读取本章「场景细纲」(detailedOutlines)。
 * 细纲此前只是 DB 表(写得进、删得掉),但从未登记成上下文源 → AI 生成读不到它。
 * 这里按当前章节节点读出场景拆解(开头衔接/逐场景:标题·概要·冲突·地点/结尾悬念),
 * 供正文等下游生成时注入,实现"用细纲指导正文",小上下文也能写出贴合的文字。
 */
async function readDetailedOutline(projectId: number, outlineNodeId?: number | null, chapterId?: number | null): Promise<string> {
  let nodeId = outlineNodeId ?? null
  if (nodeId == null && chapterId != null) {
    const chapter = await db.chapters.get(chapterId)
    nodeId = chapter?.outlineNodeId ?? null
  }
  if (nodeId == null) return ''
  const rows = await db.detailedOutlines.where('projectId').equals(projectId).toArray()
  const detail = rows.find(d => d.outlineNodeId === nodeId)
  if (!detail || !Array.isArray(detail.scenes) || detail.scenes.length === 0) return ''
  const parts: string[] = ['【本章细纲(场景拆解)】']
  if (detail.openingHook) parts.push(`开头衔接:${detail.openingHook}`)
  detail.scenes.forEach((s, i) => {
    const bits = [s.summary, s.conflict ? `冲突:${s.conflict}` : '', s.location ? `地点:${s.location}` : '']
      .filter(Boolean).join(' / ')
    parts.push(`场景${i + 1} ${s.title || ''}: ${bits}`)
  })
  if (detail.prohibitions?.length) {
    parts.push(`不可写清单:${detail.prohibitions.join('；')}`)
  }
  if (detail.endingCliffhanger) parts.push(`结尾悬念:${detail.endingCliffhanger}`)
  return parts.join('\n')
}

async function readItemLedger(projectId: number, characterId?: number | null): Promise<string> {
  const rows = await db.itemLedger.where('projectId').equals(projectId).toArray()
  const filtered = characterId != null
    ? rows.filter(r => (r.characterId ?? null) === (characterId ?? null))
    : rows
  if (!filtered.length) return ''
  return [
    '【物品流水证据】',
    ...filtered.slice(-120).map(row =>
      `#${row.id ?? 0} ${row.chapterTitle ?? `章节#${row.chapterId ?? '?'}`}：${row.action === 'gain' ? '获得' : '消耗'} ${row.itemName} ×${row.quantity}${row.heldByName ? `（${row.heldByName}）` : ''}${row.note ? ` ${row.note}` : ''}`),
  ].join('\n')
}

async function readHeldItems(
  projectId: number,
  chapterId?: number | null,
  worldGroupId?: number | null,
  characterId?: number | null,
  outlineNodeId?: number | null,
): Promise<string> {
  if (chapterId == null && outlineNodeId == null) return ''
  return formatHeldItemsContext(await readProjectHeldItems(
    projectId,
    chapterId,
    worldGroupId,
    characterId,
    outlineNodeId,
  ))
}

async function readStoryTimeline(projectId: number): Promise<string> {
  const rows = await db.storyTimelineEvents.where('projectId').equals(projectId).sortBy('order')
  if (!rows.length) return ''
  return [
    '【故事年表证据】',
    ...rows.slice(-120).map(row =>
      `#${row.id ?? 0} ${row.storyTime ? `${row.storyTime} · ` : ''}${row.title}${row.description ? `：${row.description}` : ''}（${row.chapterTitle ?? `章节#${row.chapterId ?? '?'}`}）`),
  ].join('\n')
}

async function readCharacterRelations(projectId: number, worldGroupId?: number | null): Promise<string> {
  const [rows, characters] = await Promise.all([
    db.characterRelations.where('projectId').equals(projectId).toArray(),
    db.characters.where('projectId').equals(projectId).toArray(),
  ])
  const visibleCharacters = worldGroupId === undefined
    ? characters
    : characters.filter(character => (
        character.isCrossWorld || (character.homeWorldGroupId ?? null) === (worldGroupId ?? null)
      ))
  const names = new Map(visibleCharacters.filter(item => item.id != null).map(item => [item.id!, item.name]))
  const visibleRows = worldGroupId === undefined
    ? rows
    : rows.filter(row => names.has(row.fromCharacterId) && names.has(row.toCharacterId))
  if (!visibleRows.length) return ''
  return [
    '【角色关系证据】',
    ...visibleRows.slice(0, 160).map(row =>
      `#${row.id ?? 0} ${names.get(row.fromCharacterId) ?? `角色#${row.fromCharacterId}`} → ${names.get(row.toCharacterId) ?? `角色#${row.toCharacterId}`}：${row.label}${row.description ? `（${row.description}）` : ''}`),
  ].join('\n')
}

/**
 * NS-4 · 当前有效事实投影（事实账本 → 生成上下文）。
 * 注入当前有效的 confirmed，以及在目标时点仍有效的 superseded 历史 Canon。
 * 按【规范章序】实时解析 validFrom/To（绝不缓存 order）判定"截止本章是否有效"，
 * 并按当前世界（∪ 默认 null 世界）过滤。这是事实账本改善长期一致性的回报通道。
 */
async function readCurrentFacts(projectId: number, chapterId?: number | null, worldGroupId?: number | null): Promise<string> {
  if (chapterId == null) return ''
  const [facts, outlineNodes, chapters] = await Promise.all([
    db.temporalFacts.where('projectId').equals(projectId)
      .filter(f => f.status === 'confirmed' || f.status === 'superseded')
      .toArray(),
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
  ])
  if (!facts.length) return ''
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const orderOf = new Map<number, number>()
  sequence.forEach((entry, i) => { if (entry.chapter.id != null) orderOf.set(entry.chapter.id, i) })
  const currentOrder = orderOf.get(chapterId)
  if (currentOrder == null) return ''

  const validNow = facts.filter(fact => {
    if (fact.worldGroupId != null && fact.worldGroupId !== (worldGroupId ?? null)) return false // 世界隔离
    const from = fact.validFromChapterId != null ? orderOf.get(fact.validFromChapterId) : -1
    if (from == null || from > currentOrder) return false   // 引用不存在的章 / 尚未生效
    if (fact.validToChapterId != null) {
      const to = orderOf.get(fact.validToChapterId)
      if (to != null && to <= currentOrder) return false     // 已失效
    }
    return true
  })
  if (!validNow.length) return ''
  const lines = validNow.slice(0, 80).map(fact => {
    const spec = getFactPredicate(fact.predicate)
    return `- ${fact.subjectName}｜${spec?.label ?? fact.predicate}：${fact.value}`
  })
  return ['【当前有效事实（截止本章·已确认，请勿与之矛盾）】', ...lines].join('\n')
}

/**
 * NS-5 · 相关前文召回（叙事感知混合检索的回报通道）。
 * 按本章涉及的实体召回历史块（关键词通道，未来章硬过滤、世界隔离、按时间重组），
 * 解决"几百章前的远距离细节/伏笔"被遗忘导致的矛盾。
 */
async function readRetrievedPassages(projectId: number, chapterId?: number | null, outlineNodeId?: number | null, worldGroupId?: number | null): Promise<string> {
  if (chapterId == null) return ''
  const [characters, node] = await Promise.all([
    db.characters.where('projectId').equals(projectId).toArray(),
    outlineNodeId != null ? db.outlineNodes.get(outlineNodeId) : Promise.resolve(undefined),
  ])
  const charNames = characters.map(c => c.name).filter(n => n && n.length >= 2)
  const summary = node?.summary || ''
  const mentioned = charNames.filter(n => summary.includes(n))
  const queryTerms = mentioned.length ? mentioned : charNames // 摘要没提具体角色 → 用全部角色作宽召回
  if (!queryTerms.length) {
    return await readNarrativeSummaryContext({ projectId, currentChapterId: chapterId, worldGroupId })
  }

  // NS-5：若启用 embedding，按"章纲摘要 + 涉及角色"嵌一次查询向量 → 混合检索（失败自动退回关键词）
  const embCfg = useAIConfigStore.getState().embedding
  const queryEmbedding = isEmbeddingReady(embCfg)
    ? await embedQuery([summary, ...queryTerms].filter(Boolean).join(' ').slice(0, 1000), embCfg, projectId)
    : null

  const got = await retrieveChunks({
    projectId, currentChapterId: chapterId, worldGroupId, queryTerms, queryEmbedding,
    queryEmbeddingModel: queryEmbedding ? embeddingModelTag(embCfg) : null, topK: 6,
  })
  const hierarchy = await readNarrativeSummaryContext({ projectId, currentChapterId: chapterId, worldGroupId })
  if (!got.length) return hierarchy
  const chapters = await db.chapters.where('projectId').equals(projectId).toArray()
  const titleOf = new Map(chapters.filter(c => c.id != null).map(c => [c.id!, c.title]))
  const lines = got.map(r => `〖${titleOf.get(r.chunk.sourceChapterId) ?? '前文'}〗${r.chunk.text}`)
  return [hierarchy, '【相关前文召回（防止远距离细节/伏笔矛盾，仅供参考）】', ...lines].filter(Boolean).join('\n\n')
}

/**
 * C2 反向哺喂 · 某角色的「已确认事实」证据。
 * 取事实账本里 subjectName == 该角色名 的 confirmed 事实（按当前世界 ∪ null 过滤），
 * 不依赖章节——补全角色设定时要的是 TA 在全书已被确认的客观事实。
 */
async function readCharacterFacts(projectId: number, name?: string, worldGroupId?: number | null): Promise<string> {
  const subject = name?.trim()
  if (!subject) return ''
  const facts = await db.temporalFacts.where('projectId').equals(projectId)
    .filter(f => f.status === 'confirmed' && f.subjectName === subject).toArray()
  const scoped = facts.filter(f => f.worldGroupId == null || f.worldGroupId === (worldGroupId ?? null))
  if (!scoped.length) return ''
  const lines = scoped.slice(0, 60).map(fact => {
    const spec = getFactPredicate(fact.predicate)
    return `- ${spec?.label ?? fact.predicate}：${fact.value}`
  })
  return [`【「${subject}」在剧情中已确认的事实（补全须与之一致，勿矛盾）】`, ...lines].join('\n')
}

/**
 * C2 反向哺喂 · 某角色的「正文表现」证据。
 * 关键词扫描全书 retrievalChunks（提到该角色名的块，当前世界 ∪ null），按章序取靠后的若干段，
 * 让补全贴合 TA 真正写出来的样子。不依赖 currentChapterId（要全书证据，不做未来章过滤）。
 */
async function readCharacterPassages(projectId: number, name?: string, worldGroupId?: number | null): Promise<string> {
  const subject = name?.trim()
  if (!subject || subject.length < 2) return ''
  const [chunks, chapters] = await Promise.all([
    db.retrievalChunks.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
  ])
  const hits = chunks
    .filter(c => (c.worldGroupId == null || c.worldGroupId === (worldGroupId ?? null)) && c.text.includes(subject))
    .sort((a, b) => (b.sourceChapterId ?? 0) - (a.sourceChapterId ?? 0))
    .slice(0, 6)
  if (!hits.length) return ''
  const titleOf = new Map(chapters.filter(c => c.id != null).map(c => [c.id!, c.title]))
  const lines = hits.map(c => `〖${titleOf.get(c.sourceChapterId) ?? '正文'}〗${c.text}`)
  return [`【「${subject}」在正文中的真实表现（补全须符合，勿编造与正文矛盾的设定）】`, ...lines].join('\n\n')
}

export const CONTEXT_SOURCES: ContextSource[] = [
  {
    // SIM-1C: NPC 演进只读冻结快照与事件回放，不读取可变 Canon 表。
    key: 'simulationRuntime',
    label: '冻结运行时状态',
    scope: 'runtime',
    layer: 'L0',
    budgetTokens: 8000,
    protectedFromTrim: true,
    requiresSimulationSessionId: true,
    read: readSimulationRuntimeContext,
  },
  {
    // AGENT-1: 对话副驾只读工具使用的紧凑项目摘要，不返回整表原始数据。
    key: 'projectStatus',
    label: '项目概况',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1200,
    read: readAgentProjectStatus,
  },
  {
    // AGENT-1: 世界组与连接关系的有界目录。
    key: 'worldGroups',
    label: '世界组目录',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1500,
    read: readAgentWorldGroups,
  },
  {
    // AGENT-1: 按当前执行世界过滤的有界大纲树。
    key: 'outlineTree',
    label: '大纲树',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 6000,
    requiresWorldGroupId: true,
    read: readAgentOutlineTree,
  },
  {
    // AGENT-1: 零网络、零 embedding 的本地包含匹配，仅返回短摘。
    key: 'searchResults',
    label: '项目内搜索结果',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 2200,
    requiresWorldGroupId: true,
    enabled: input => !!input.searchQuery?.trim(),
    read: readAgentSearchResults,
  },
  {
    // RAG-1: 作者在可见资料库/节点中精确选择的记录字段。正文仍实时读取 Canon，
    // 稳定选择键和实际纳入证据分别由源记录元数据与节点运行快照保存。
    key: 'ragSelection',
    label: '作者选择的资料字段',
    scope: 'manual',
    layer: 'L0',
    budgetTokens: 100_000,
    enabled: input => !!input.ragEntryKeys?.length,
    read: input => readRagSelectionContext({
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      entryKeys: input.ragEntryKeys,
      inputBudgetTokens: input.inputBudgetTokens,
      trace: input.ragSelectionTrace,
    }),
  },
  {
    key: 'manualText',
    label: '用户指定内容',
    scope: 'manual',
    layer: 'L0',
    budgetTokens: 100_000,
    read: async input => input.manualSourceText || '',
  },
  {
    key: 'chapterContent',
    label: '章节正文',
    scope: 'chapter',
    layer: 'L0',
    budgetTokens: 100_000,
    requiresChapterId: true,
    read: async input => {
      const chapter = await db.chapters.get(input.chapterId!)
      if (!chapter || chapter.projectId !== input.projectId) return ''
      return htmlToPlainText(chapter.content || '')
    },
  },
  {
    key: 'contextMemo',
    label: '上下文快照',
    scope: 'project',
    layer: 'L3',
    budgetTokens: 1500,
    read: async input => getContextMemo(input.projectId),
  },
  {
    key: 'chapterOutline',
    label: '当前章节大纲',
    scope: 'node',
    layer: 'L1',
    budgetTokens: 800,
    protectedFromTrim: true,
    requiresOutlineNodeId: true,
    read: input => readChapterOutline(input.projectId, input.outlineNodeId, input.chapterId),
  },
  {
    key: 'existingVolumeOutlines',
    label: '已有卷大纲',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 2400,
    read: input => readExistingVolumeOutlines(input.projectId),
  },
  {
    key: 'writtenChapterProgress',
    label: '本卷已写正文进度',
    scope: 'node',
    layer: 'L1',
    budgetTokens: 3000,
    protectedFromTrim: true,
    requiresOutlineNodeId: true,
    read: input => readWrittenChapterProgress(input.projectId, input.outlineNodeId, input.worldGroupId),
  },
  {
    key: 'currentFacts',
    label: '当前有效事实(事实账本投影)',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 2000,
    requiresChapterId: true,
    read: input => readCurrentFacts(input.projectId, input.chapterId, input.worldGroupId),
  },
  {
    key: 'canonAssertions',
    label: '世界宪法(已确认设定断言)',
    scope: 'world',
    layer: 'L1',
    budgetTokens: 1800,
    protectedFromTrim: true,
    requiresWorldGroupId: true,
    read: async input => formatCanonAssertionsContext(
      await readCanonAssertions(input.projectId, input.worldGroupId),
    ),
  },
  {
    key: 'characterKnowledge',
    label: '角色认知边界(认知账本投影)',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1600,
    protectedFromTrim: true,
    requiresChapterId: true,
    acceptsOutlineNodeAsChapterBoundary: true,
    read: async input => formatCharacterKnowledgeContext(await readProjectCharacterKnowledge(
      input.projectId,
      input.chapterId,
      input.worldGroupId,
      input.characterId,
      input.outlineNodeId,
    )),
  },
  {
    key: 'retrievedPassages',
    label: '相关前文召回(NS-5 混合检索)',
    scope: 'chapter',
    layer: 'L2',
    budgetTokens: 2500,
    requiresChapterId: true,
    read: input => readRetrievedPassages(input.projectId, input.chapterId, input.outlineNodeId, input.worldGroupId),
  },
  {
    key: 'consistencyReport',
    label: '一致性报告',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1800,
    protectedFromTrim: true,
    requiresChapterId: true,
    acceptsOutlineNodeAsChapterBoundary: true,
    read: input => readConsistencyReport(input.projectId, input.chapterId),
  },
  {
    key: 'detailedOutline',
    label: '本章细纲(场景拆解)',
    scope: 'node',
    layer: 'L1',
    budgetTokens: 1500,
    requiresOutlineNodeId: true,
    read: input => readDetailedOutline(input.projectId, input.outlineNodeId, input.chapterId),
  },
  {
    key: 'previousChapterEnding',
    label: '全局直接前驱原文尾部',
    scope: 'manual',
    layer: 'L1',
    budgetTokens: 1800,
    protectedFromTrim: true,
    enabled: input => !!(input.continuitySnapshot?.previousTailText || input.previousChapterEnding),
    read: async input => input.continuitySnapshot?.previousTailText
      || (input.previousChapterEnding ? `【上一章结尾】\n${input.previousChapterEnding}` : ''),
  },
  {
    key: 'chapterContinuityHandoff',
    label: '全局直接前驱连续性交接',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1600,
    protectedFromTrim: true,
    requiresChapterId: true,
    read: async input => input.continuitySnapshot?.handoffText || '',
  },
  {
    key: 'previousPlanReconciliation',
    label: '前章计划正文对账',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1400,
    protectedFromTrim: true,
    requiresChapterId: true,
    read: async input => input.continuitySnapshot?.planReconciliationText || '',
  },
  {
    key: 'recentChapterSummaries',
    label: '当前世界最近已验证摘要',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 2200,
    requiresChapterId: true,
    read: async input => input.continuitySnapshot?.recentSummariesText || '',
  },
  {
    key: 'worldview',
    label: '世界观',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 8000, // 放宽:容下完整世界观设定,超大才软截断(并配合总窗口软裁)
    requiresWorldGroupId: true,
    read: async input => formatWorldviewBlock(await readWorldview(input.projectId, input.worldGroupId)),
  },
  {
    key: 'storyCore',
    label: '故事核心',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 4000, // 放宽:容下完整故事核心(主线/复线)
    read: async input => formatStoryCoreBlock(await db.storyCores.where('projectId').equals(input.projectId).first() ?? null),
  },
  {
    key: 'characterDrivenPlan',
    label: '当前生效角色驱动方案',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 5000,
    protectedFromTrim: true,
    read: input => readActiveCharacterDrivenPlanContext(input.projectId),
  },
  {
    key: 'powerSystem',
    label: '力量体系',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 4000, // 放宽:容下完整力量体系(描述/等级/规则)
    requiresWorldGroupId: true,
    read: async input => {
      const [foundation, cultivation] = await Promise.all([
        readPowerSystem(input.projectId, input.worldGroupId)
          .then(formatPowerSystemBlock),
        buildCultivationContext(input.projectId, input.worldGroupId),
      ])
      return [foundation, cultivation].filter(Boolean).join('\n')
    },
  },
  {
    key: 'codex',
    label: '设定词条',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 6000, // 放宽:容下更多设定词条
    requiresWorldGroupId: true,
    read: input => buildCodexContext(input.projectId, input.worldGroupId),
  },
  {
    key: 'characters',
    label: '角色档案',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 8000, // 放宽:容下完整角色档案(核心角色不再被砍残)
    requiresWorldGroupId: true,
    read: async input => buildCharacterContext(await readCharacters(input.projectId, input.worldGroupId)),
  },
  {
    key: 'creativeRules',
    label: '创作规则',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 1000,
    read: async input => buildCreativeRulesContext(await db.creativeRules.where('projectId').equals(input.projectId).first() ?? null),
  },
  {
    key: 'worldRules',
    label: '真实与幻想规则',
    scope: 'world',
    layer: 'L1',
    budgetTokens: 1200,
    requiresWorldGroupId: true,
    read: input => buildWorldRulesContext(input.projectId, input.worldGroupId),
  },
  {
    key: 'historical',
    label: '历史时间线',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 1800,
    requiresWorldGroupId: true,
    read: input => buildHistoricalContext(input.projectId, input.worldGroupId),
  },
  {
    key: 'locations',
    label: '重要地点',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1200,
    read: input => buildLocationContext(input.projectId),
  },
  {
    key: 'foreshadows',
    label: '伏笔状态',
    scope: 'chapter',
    layer: 'L2',
    budgetTokens: 1200,
    read: input => readForeshadows(input.projectId, input.chapterId),
  },
  {
    key: 'storyArcs',
    label: '故事线',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1500,
    read: input => readStoryArcs(input.projectId),
  },
  {
    key: 'storylineProgress',
    label: '作者确认的故事线进度与交汇',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 1400,
    protectedFromTrim: true,
    read: input => readStorylineProgressContext(input.projectId, input.chapterId),
  },
  {
    key: 'cultivationProgress',
    label: '作者确认的正文修炼进度',
    scope: 'world',
    layer: 'L1',
    budgetTokens: 1000,
    protectedFromTrim: true,
    requiresWorldGroupId: true,
    read: input => readCultivationProgressContext(
      input.projectId,
      input.worldGroupId,
      input.chapterId,
      input.outlineNodeId,
    ),
  },
  {
    key: 'emotionBeats',
    label: '情感节拍',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1000,
    requiresChapterId: true,
    read: input => readEmotionBeats(input.projectId, input.chapterId),
  },
  {
    key: 'stateCards',
    label: '状态卡',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1800,
    read: input => readStateCards(input.projectId, input.stateReferenceText, input.extraStateIds),
  },
  {
    key: 'itemLedger',
    label: '物品流水',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 2400,
    read: input => readItemLedger(input.projectId, input.characterId),
  },
  {
    key: 'heldItems',
    label: '当前已持有物品',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1000,
    protectedFromTrim: true,
    requiresChapterId: true,
    acceptsOutlineNodeAsChapterBoundary: true,
    read: input => readHeldItems(
      input.projectId,
      input.chapterId,
      input.worldGroupId,
      input.characterId,
      input.outlineNodeId,
    ),
  },
  {
    key: 'storyTimeline',
    label: '故事年表',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 2600,
    read: input => readStoryTimeline(input.projectId),
  },
  {
    key: 'characterRelations',
    label: '角色关系',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 2200,
    read: input => readCharacterRelations(input.projectId, input.worldGroupId),
  },
  {
    key: 'references',
    label: '引用手法',
    scope: 'project',
    layer: 'L3',
    budgetTokens: 2000,
    enabled: input => !!input.citedReferenceIds?.length,
    read: input => buildRefAnalysisContext(input.citedReferenceIds ?? []),
  },
  {
    // FB-5 自适应文风学习:作者文风画像(enabled=true 才注入)。
    key: 'userStyleProfile',
    label: '我的文风',
    scope: 'project',
    layer: 'L2',
    budgetTokens: 1800,
    read: input => readUserStyleProfile(input.projectId),
  },
  {
    // CM-1:只读取作者本次明确勾选的短灵感和同模式最近确认版本。
    key: 'inspirationWorkspace',
    label: '增量灵感工作区',
    scope: 'project',
    layer: 'L0',
    budgetTokens: 11_000,
    enabled: input => !!input.inspirationFragmentIds?.length,
    read: input => readInspirationWorkspaceContext(
      input.projectId,
      input.inspirationFragmentIds,
      input.inspirationMode,
    ),
  },
  {
    // C2 反向哺喂：某角色在剧情里已确认的事实（需 subjectCharacterName）。
    key: 'characterFacts',
    label: '该角色的剧情事实',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 1500,
    enabled: input => !!input.subjectCharacterName?.trim(),
    read: input => readCharacterFacts(input.projectId, input.subjectCharacterName, input.worldGroupId),
  },
  {
    // C2 反向哺喂：某角色在正文里的真实表现（需 subjectCharacterName）。
    key: 'characterPassages',
    label: '该角色的正文表现',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 2500,
    enabled: input => !!input.subjectCharacterName?.trim(),
    read: input => readCharacterPassages(input.projectId, input.subjectCharacterName, input.worldGroupId),
  },
]

export const CONTEXT_SOURCE_BY_KEY: ReadonlyMap<string, ContextSource> = new Map(
  CONTEXT_SOURCES.map(source => [source.key, source] as const),
)
