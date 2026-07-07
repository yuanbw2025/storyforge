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
import { buildWorldRulesContext } from '../ai/world-rules-manifest'
import { parseStages } from '../types/story-arc'
import { parseFields } from '../types/state-card'
import { parseBeats } from '../types/emotion-beat'
import { buildForeshadowTaskContext } from '../foreshadow/context'
import { formatHeldItemsContext, readProjectHeldItems } from '../consistency/held-items'
import type { Character, PowerSystem, Worldview } from '../types'
import type { ContextSource } from './types'
import { htmlToPlainText } from '../utils/html'

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
  return `【作者文风偏好】\n请在本次写作中尽量贴合作者一贯的文风习惯:\n${profile.profile.trim()}`
}

async function readStoryArcs(projectId: number): Promise<string> {
  const arcs = await db.storyArcs.where('projectId').equals(projectId).toArray()
  if (!arcs.length) return ''
  const parts = ['【全局故事线】']
  for (const arc of arcs.slice(0, 8)) {
    const stages = parseStages(arc.stages)
    parts.push(`[${arc.type}] ${arc.name}${arc.description ? `:${arc.description.slice(0, 120)}` : ''}`)
    for (const stage of stages.slice(0, 6)) {
      parts.push(`- ${stage.title}: ${stage.description.slice(0, 120)}`)
    }
  }
  return parts.join('\n')
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
  if (detail.endingCliffhanger) parts.push(`结尾悬念:${detail.endingCliffhanger}`)
  return parts.join('\n')
}

async function readItemLedger(projectId: number): Promise<string> {
  const rows = await db.itemLedger.where('projectId').equals(projectId).toArray()
  if (!rows.length) return ''
  return [
    '【物品流水证据】',
    ...rows.slice(-120).map(row =>
      `#${row.id ?? 0} ${row.chapterTitle ?? `章节#${row.chapterId ?? '?'}`}：${row.action === 'gain' ? '获得' : '消耗'} ${row.itemName} ×${row.quantity}${row.note ? `（${row.note}）` : ''}`),
  ].join('\n')
}

async function readHeldItems(projectId: number, chapterId?: number | null, worldGroupId?: number | null): Promise<string> {
  if (chapterId == null) return ''
  return formatHeldItemsContext(await readProjectHeldItems(projectId, chapterId, worldGroupId))
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

async function readCharacterRelations(projectId: number): Promise<string> {
  const [rows, characters] = await Promise.all([
    db.characterRelations.where('projectId').equals(projectId).toArray(),
    db.characters.where('projectId').equals(projectId).toArray(),
  ])
  if (!rows.length) return ''
  const names = new Map(characters.filter(item => item.id != null).map(item => [item.id!, item.name]))
  return [
    '【角色关系证据】',
    ...rows.slice(0, 160).map(row =>
      `#${row.id ?? 0} ${names.get(row.fromCharacterId) ?? `角色#${row.fromCharacterId}`} → ${names.get(row.toCharacterId) ?? `角色#${row.toCharacterId}`}：${row.label}${row.description ? `（${row.description}）` : ''}`),
  ].join('\n')
}

/**
 * NS-4 · 当前有效事实投影（事实账本 → 生成上下文）。
 * 只注入 confirmed（Canon）事实，按【规范章序】实时解析 validFrom/To（绝不缓存 order）判定"截止本章是否有效"，
 * 并按当前世界（∪ 默认 null 世界）过滤。这是事实账本改善长期一致性的回报通道。
 */
async function readCurrentFacts(projectId: number, chapterId?: number | null, worldGroupId?: number | null): Promise<string> {
  if (chapterId == null) return ''
  const [facts, outlineNodes, chapters] = await Promise.all([
    db.temporalFacts.where('projectId').equals(projectId).filter(f => f.status === 'confirmed').toArray(),
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
    key: 'currentFacts',
    label: '当前有效事实(事实账本投影)',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 2000,
    requiresChapterId: true,
    read: input => readCurrentFacts(input.projectId, input.chapterId, input.worldGroupId),
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
    key: 'powerSystem',
    label: '力量体系',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 4000, // 放宽:容下完整力量体系(描述/等级/规则)
    requiresWorldGroupId: true,
    read: async input => formatPowerSystemBlock(await readPowerSystem(input.projectId, input.worldGroupId)),
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
    read: input => readItemLedger(input.projectId),
  },
  {
    key: 'heldItems',
    label: '当前已持有物品',
    scope: 'chapter',
    layer: 'L1',
    budgetTokens: 1000,
    protectedFromTrim: true,
    requiresChapterId: true,
    read: input => readHeldItems(input.projectId, input.chapterId, input.worldGroupId),
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
    read: input => readCharacterRelations(input.projectId),
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
    budgetTokens: 700,
    read: input => readUserStyleProfile(input.projectId),
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
