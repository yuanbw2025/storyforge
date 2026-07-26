/**
 * Phase 26.4 — 灵感反推
 *
 * 用户写碎片灵感 → AI 反向生成世界观草稿、故事核心、初始角色卡
 */

import type {
  ChatMessage,
  CharacterMoralAxis,
  CharacterOrderAxis,
  CharacterRoleWeight,
} from '../types'
import type {
  FactionType,
  FactionStatus,
  FactionRelationType,
} from '../types/faction'
import { usePromptStore } from '../../stores/prompt'
import { renderPrompt } from './prompt-engine'
import { extractJSON } from './adapters/import-adapter'

// ── 类型 ────────────────────────────────────────────────────────────────

export interface ReverseWorldview {
  worldOrigin: string
  powerHierarchy: string
  continentLayout: string
  climateByRegion: string
  historyLine: string
  races: string
  factionLayout: string
}

export interface ReverseStoryCore {
  logline: string
  theme: string
  centralConflict: string
  plotPattern: string
  mainPlot: string
}

export interface ReverseCharacter {
  name: string
  roleWeight: CharacterRoleWeight
  moralAxis: CharacterMoralAxis
  orderAxis: CharacterOrderAxis
  shortDescription: string
  personality: string
  background: string
  motivation: string
  arc: string
}

export interface ReverseResult {
  worldview: ReverseWorldview
  storyCore: ReverseStoryCore
  characters: ReverseCharacter[]
  // 势力模块（v38 扩展，向下兼容：老反推无此字段时为空数组）
  factions: ReverseFaction[]
  factionRelations: ReverseFactionRelation[]
}

export interface ReverseFaction {
  name: string
  type: FactionType
  ideology: string
  leader: string
  memberNames: string[]
  baseLocation: string
  power: string
  resources: string
  secret: string
  status: FactionStatus
}

export interface ReverseFactionRelation {
  fromFactionName: string
  toFactionName: string
  relationType: FactionRelationType
  label: string
  description: string
  isBidirectional: boolean
  intensity: number
}

// ── 多世界版类型 ─────────────────────────────────────────────────────────

import type { WorldGroupType } from '../types'

export interface ReverseWorld {
  name: string
  type: WorldGroupType
  // 与 Worldview 实际字段严格对齐（v3 字段名）
  worldOrigin: string
  powerHierarchy: string
  continentLayout: string
  climateByRegion: string
  historyLine: string
  races: string
  factionLayout: string
  entryCondition: string
  powerRestriction: string
}

export interface ReverseCharacterMW extends ReverseCharacter {
  /** 所属世界名称（空 = 跨世界） */
  homeWorld: string
  isCrossWorld: boolean
}

export interface ReverseMultiWorldResult {
  storyCore: ReverseStoryCore
  worlds: ReverseWorld[]
  characters: ReverseCharacterMW[]
  // 势力模块（v38 扩展，向下兼容：老反推无此字段时为空数组）
  factions: ReverseFaction[]
  factionRelations: ReverseFactionRelation[]
}

const VALID_WG_TYPES: WorldGroupType[] = ['primary', 'traversal', 'instance', 'parallel', 'ascension', 'custom']
const VALID_WEIGHTS: CharacterRoleWeight[] = ['main', 'secondary', 'npc', 'extra']
const VALID_MORAL: CharacterMoralAxis[] = ['good', 'neutral', 'evil']
const VALID_ORDER: CharacterOrderAxis[] = ['lawful', 'neutral', 'chaotic']

// 势力枚举校验（与 faction.ts 保持一致）
const VALID_FACTION_TYPES: FactionType[] = ['nation', 'sect', 'guild', 'clan', 'organization', 'military', 'religion', 'merchant', 'other']
const VALID_FACTION_STATUSES: FactionStatus[] = ['rising', 'peak', 'declining', 'destroyed', 'hidden']
const VALID_RELATION_TYPES: FactionRelationType[] = ['alliance', 'hostile', 'vassal', 'trade', 'covert', 'rival', 'neutral']

function parseFactions(raw: unknown): ReverseFaction[] {
  if (!Array.isArray(raw)) return []
  return raw.map((f: Record<string, unknown>): ReverseFaction => ({
    name: String(f.name || '').trim(),
    type: VALID_FACTION_TYPES.includes(f.type as FactionType) ? (f.type as FactionType) : 'other',
    ideology: String(f.ideology || '').trim(),
    leader: String(f.leader || '').trim(),
    memberNames: Array.isArray(f.memberNames)
      ? f.memberNames.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n: string) => n.trim())
      : [],
    baseLocation: String(f.baseLocation || '').trim(),
    power: String(f.power || '').trim(),
    resources: String(f.resources || '').trim(),
    secret: String(f.secret || '').trim(),
    status: VALID_FACTION_STATUSES.includes(f.status as FactionStatus) ? (f.status as FactionStatus) : 'rising',
  })).filter(f => f.name)
}

function parseFactionRelations(raw: unknown): ReverseFactionRelation[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r: Record<string, unknown>): ReverseFactionRelation => ({
    fromFactionName: String(r.fromFactionName || '').trim(),
    toFactionName: String(r.toFactionName || '').trim(),
    relationType: VALID_RELATION_TYPES.includes(r.relationType as FactionRelationType)
      ? (r.relationType as FactionRelationType) : 'neutral',
    label: String(r.label || '').trim(),
    description: String(r.description || '').trim(),
    isBidirectional: Boolean(r.isBidirectional),
    intensity: typeof r.intensity === 'number'
      ? Math.max(0, Math.min(100, Math.round(r.intensity)))
      : 50,
  })).filter(r => r.fromFactionName && r.toFactionName)
}

function parseAxes(c: Record<string, unknown>): Pick<ReverseCharacter, 'roleWeight' | 'moralAxis' | 'orderAxis'> {
  return {
    roleWeight: VALID_WEIGHTS.includes(c.roleWeight as CharacterRoleWeight)
      ? c.roleWeight as CharacterRoleWeight
      : 'main',
    moralAxis: VALID_MORAL.includes(c.moralAxis as CharacterMoralAxis)
      ? c.moralAxis as CharacterMoralAxis
      : 'neutral',
    orderAxis: VALID_ORDER.includes(c.orderAxis as CharacterOrderAxis)
      ? c.orderAxis as CharacterOrderAxis
      : 'neutral',
  }
}

export function buildInspirationReverseMultiWorldPrompt(
  projectName: string,
  genres: string,
  inspiration: string,
  userHint?: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('inspiration.reverse.multiworld')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres,
    inspiration,
    userHint: userHint || '',
  })
  return messages
}

export function parseReverseMultiWorldOutput(output: string): ReverseMultiWorldResult | null {
  try {
    // 健壮提取：围栏 / 未闭合围栏 / 裸 { 起点 + 截断修复。避免模型带前后文（如"以下是结果："）时
    // 第一遍解析失败、反推结果不显示，用户要重推或退出重进才出来（社区反馈）。
    const p = extractJSON(output) as Record<string, any>
    const storyCore: ReverseStoryCore = {
      logline: String(p.storyCore?.logline || ''),
      theme: String(p.storyCore?.theme || ''),
      centralConflict: String(p.storyCore?.centralConflict || ''),
      plotPattern: String(p.storyCore?.plotPattern || ''),
      mainPlot: String(p.storyCore?.mainPlot || ''),
    }
    const worlds: ReverseWorld[] = Array.isArray(p.worlds)
      ? p.worlds.map((w: Record<string, unknown>): ReverseWorld => ({
          name: String(w.name || '未命名世界'),
          type: VALID_WG_TYPES.includes(w.type as WorldGroupType) ? (w.type as WorldGroupType) : 'traversal',
          worldOrigin: String(w.worldOrigin || ''),
          powerHierarchy: String(w.powerHierarchy || ''),
          continentLayout: String(w.continentLayout || ''),
          climateByRegion: String(w.climateByRegion || ''),
          historyLine: String(w.historyLine || ''),
          races: String(w.races || ''),
          factionLayout: String(w.factionLayout || ''),
          entryCondition: String(w.entryCondition || ''),
          powerRestriction: String(w.powerRestriction || ''),
        }))
      : []
    const characters: ReverseCharacterMW[] = Array.isArray(p.characters)
      ? p.characters.map((c: Record<string, unknown>): ReverseCharacterMW => ({
          name: String(c.name || ''),
          ...parseAxes(c),
          shortDescription: String(c.shortDescription || ''),
          personality: String(c.personality || ''),
          background: String(c.background || ''),
          motivation: String(c.motivation || ''),
          arc: String(c.arc || ''),
          homeWorld: String(c.homeWorld || ''),
          isCrossWorld: Boolean(c.isCrossWorld),
        }))
      : []
    if (worlds.length === 0) return null
    return {
      storyCore, worlds, characters,
      factions: parseFactions(p.factions),
      factionRelations: parseFactionRelations(p.factionRelations),
    }
  } catch {
    return null
  }
}

// ── 构建 Prompt ─────────────────────────────────────────────────────────

export function buildInspirationReversePrompt(
  projectName: string,
  genres: string,
  inspiration: string,
  userHint?: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('inspiration.reverse')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres,
    inspiration,
    userHint: userHint || '',
  })
  return messages
}

// ── 解析输出 ─────────────────────────────────────────────────────────────

export function parseReverseOutput(output: string): ReverseResult | null {
  try {
    // 健壮提取（同上）：模型带前后文/无围栏时也能取到 JSON，第一遍就出结果。
    const parsed = extractJSON(output) as Record<string, any>

    const worldview: ReverseWorldview = {
      worldOrigin: String(parsed.worldview?.worldOrigin || ''),
      powerHierarchy: String(parsed.worldview?.powerHierarchy || ''),
      continentLayout: String(parsed.worldview?.continentLayout || ''),
      climateByRegion: String(parsed.worldview?.climateByRegion || ''),
      historyLine: String(parsed.worldview?.historyLine || ''),
      races: String(parsed.worldview?.races || ''),
      factionLayout: String(parsed.worldview?.factionLayout || ''),
    }

    const storyCore: ReverseStoryCore = {
      logline: String(parsed.storyCore?.logline || ''),
      theme: String(parsed.storyCore?.theme || ''),
      centralConflict: String(parsed.storyCore?.centralConflict || ''),
      plotPattern: String(parsed.storyCore?.plotPattern || ''),
      mainPlot: String(parsed.storyCore?.mainPlot || ''),
    }

    const characters: ReverseCharacter[] = Array.isArray(parsed.characters)
      ? parsed.characters.map((c: Record<string, unknown>) => ({
          name: String(c.name || ''),
          ...parseAxes(c),
          shortDescription: String(c.shortDescription || ''),
          personality: String(c.personality || ''),
          background: String(c.background || ''),
          motivation: String(c.motivation || ''),
          arc: String(c.arc || ''),
        }))
      : []

    return {
      worldview, storyCore, characters,
      factions: parseFactions(parsed.factions),
      factionRelations: parseFactionRelations(parsed.factionRelations),
    }
  } catch {
    return null
  }
}
