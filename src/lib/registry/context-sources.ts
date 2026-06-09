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
]

export const CONTEXT_SOURCE_BY_KEY: ReadonlyMap<string, ContextSource> = new Map(
  CONTEXT_SOURCES.map(source => [source.key, source] as const),
)
