/**
 * CONTEXT_SOURCES(Phase 1.3a) · AI 上下文读取源注册表。
 *
 * 本文件只登记读取源和旧适配器桥接。1.3b 再把生成入口迁移到 assembleContext()。
 */
import { db } from '../db/schema'
import {
  buildCreativeRulesContext,
  buildHistoricalContext,
  buildLocationContext,
  buildMasterInsightContext,
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
import type { Character, Foreshadow, PowerSystem, Worldview } from '../types'
import type { ContextSource } from './types'

function hasExplicitWorldGroupId(input: { worldGroupId?: number | null }): boolean {
  return Object.prototype.hasOwnProperty.call(input, 'worldGroupId')
}

async function readWorldview(projectId: number, worldGroupId?: number | null): Promise<Worldview | null> {
  const rows = await db.worldviews.where('projectId').equals(projectId).toArray()
  if (hasExplicitWorldGroupId({ worldGroupId })) {
    return rows.find(w => (w.worldGroupId ?? null) === (worldGroupId ?? null)) ?? null
  }
  return rows.find(w => (w.worldGroupId ?? null) === null) ?? rows[0] ?? null
}

async function readPowerSystem(projectId: number, worldGroupId?: number | null): Promise<PowerSystem | null> {
  const rows = await db.powerSystems.where('projectId').equals(projectId).toArray()
  if (hasExplicitWorldGroupId({ worldGroupId })) {
    return rows.find(p => (p.worldGroupId ?? null) === (worldGroupId ?? null)) ?? null
  }
  return rows.find(p => (p.worldGroupId ?? null) === null) ?? rows[0] ?? null
}

async function readCharacters(projectId: number, worldGroupId?: number | null): Promise<Character[]> {
  const rows = await db.characters.where('projectId').equals(projectId).toArray()
  if (!hasExplicitWorldGroupId({ worldGroupId })) return rows
  const wg = worldGroupId ?? null
  return rows.filter(c => c.isCrossWorld || (c.homeWorldGroupId ?? null) === wg)
}

async function readForeshadows(projectId: number, chapterId?: number | null): Promise<string> {
  const rows = await db.foreshadows.where('projectId').equals(projectId).toArray()
  const open = rows.filter(f => f.status !== 'resolved')
  if (!open.length) return ''
  const selected = chapterId == null
    ? open.slice(0, 25)
    : open.filter(f => {
      if (f.plantChapterId === chapterId || f.resolveChapterId === chapterId || f.expectedResolveChapterId === chapterId) return true
      try {
        const echoIds: number[] = JSON.parse(f.echoChapterIds || '[]')
        return echoIds.includes(chapterId)
      } catch {
        return false
      }
    })
  if (!selected.length) return ''
  const lines = selected.map((f: Foreshadow) => `- ${f.name}(${f.status}/${f.type}): ${f.description?.slice(0, 120) || ''}`)
  return `【伏笔状态】\n${lines.join('\n')}`
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

export const CONTEXT_SOURCES: ContextSource[] = [
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
    requiresOutlineNodeId: true,
    read: input => readChapterOutline(input.projectId, input.outlineNodeId, input.chapterId),
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
    label: '上一章结尾',
    scope: 'manual',
    layer: 'L1',
    budgetTokens: 500,
    enabled: input => !!input.previousChapterEnding,
    read: async input => input.previousChapterEnding ? `【上一章结尾】\n${input.previousChapterEnding}` : '',
  },
  {
    key: 'worldview',
    label: '世界观',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 2500,
    requiresWorldGroupId: true,
    read: async input => formatWorldviewBlock(await readWorldview(input.projectId, input.worldGroupId)),
  },
  {
    key: 'storyCore',
    label: '故事核心',
    scope: 'project',
    layer: 'L1',
    budgetTokens: 1200,
    read: async input => formatStoryCoreBlock(await db.storyCores.where('projectId').equals(input.projectId).first() ?? null),
  },
  {
    key: 'powerSystem',
    label: '力量体系',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 1200,
    requiresWorldGroupId: true,
    read: async input => formatPowerSystemBlock(await readPowerSystem(input.projectId, input.worldGroupId)),
  },
  {
    key: 'codex',
    label: '设定词条',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 2500,
    requiresWorldGroupId: true,
    read: input => buildCodexContext(input.projectId, input.worldGroupId),
  },
  {
    key: 'characters',
    label: '角色档案',
    scope: 'world',
    layer: 'L2',
    budgetTokens: 2500,
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
    read: input => buildHistoricalContext(input.projectId),
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
    key: 'references',
    label: '引用手法',
    scope: 'project',
    layer: 'L3',
    budgetTokens: 2000,
    enabled: input => !!input.citedReferenceIds?.length,
    read: input => buildRefAnalysisContext(input.citedReferenceIds ?? []),
  },
  {
    key: 'masterInsights',
    label: '大师洞察',
    scope: 'project',
    layer: 'L3',
    budgetTokens: 1800,
    enabled: input => !!input.masterInsightIds?.length,
    read: input => buildMasterInsightContext(input.masterInsightIds ?? []),
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
]

export const CONTEXT_SOURCE_BY_KEY: ReadonlyMap<string, ContextSource> = new Map(
  CONTEXT_SOURCES.map(source => [source.key, source] as const),
)
