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
import { usePromptStore } from '../../stores/prompt'
import { renderPrompt } from './prompt-engine'
import { extractJSON } from './adapters/import-adapter'

// ── 类型 ────────────────────────────────────────────────────────────────

export interface ReverseWorldview {
  worldOrigin: string
  powerHierarchy: string
  continentLayout: string
  climateByRegion: string
  races: string
  factionLayout: string
}

export interface ReverseHistory {
  overview: string
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
  history: ReverseHistory
  storyCore: ReverseStoryCore
  characters: ReverseCharacter[]
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
  historyOverview: string
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
}

const VALID_WG_TYPES: WorldGroupType[] = ['primary', 'traversal', 'instance', 'parallel', 'ascension', 'custom']
const VALID_WEIGHTS: CharacterRoleWeight[] = ['main', 'secondary', 'npc', 'extra']
const VALID_MORAL: CharacterMoralAxis[] = ['good', 'neutral', 'evil']
const VALID_ORDER: CharacterOrderAxis[] = ['lawful', 'neutral', 'chaotic']

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return String(item)
      const record = item as Record<string, unknown>
      const name = typeof record.name === 'string' ? record.name : ''
      const details = Object.entries(record)
        .filter(([key]) => key !== 'name')
        .map(([key, child]) => `${key}：${asText(child)}`)
        .filter(entry => !entry.endsWith('：'))
        .join('；')
      return [name, details].filter(Boolean).join('（') + (name && details ? '）' : '')
    }).filter(Boolean).join('；')
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${key}：${asText(child)}`)
      .filter(entry => !entry.endsWith('：'))
      .join('；')
  }
  return String(value)
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
      logline: asText(p.storyCore?.logline),
      theme: asText(p.storyCore?.theme),
      centralConflict: asText(p.storyCore?.centralConflict),
      plotPattern: asText(p.storyCore?.plotPattern),
      mainPlot: asText(p.storyCore?.mainPlot),
    }
    const worlds: ReverseWorld[] = Array.isArray(p.worlds)
      ? p.worlds.map((w: Record<string, unknown>): ReverseWorld => ({
          name: asText(w.name) || '未命名世界',
          type: VALID_WG_TYPES.includes(w.type as WorldGroupType) ? (w.type as WorldGroupType) : 'traversal',
          worldOrigin: asText(w.worldOrigin),
          powerHierarchy: asText(w.powerHierarchy),
          continentLayout: asText(w.continentLayout),
          climateByRegion: asText(w.climateByRegion),
          historyOverview: asText(w.historyOverview),
          races: asText(w.races),
          factionLayout: asText(w.factionLayout),
          entryCondition: asText(w.entryCondition),
          powerRestriction: asText(w.powerRestriction),
        }))
      : []
    const characters: ReverseCharacterMW[] = Array.isArray(p.characters)
      ? p.characters.map((c: Record<string, unknown>): ReverseCharacterMW => ({
          name: asText(c.name),
          ...parseAxes(c),
          shortDescription: asText(c.shortDescription),
          personality: asText(c.personality),
          background: asText(c.background),
          motivation: asText(c.motivation),
          arc: asText(c.arc),
          homeWorld: asText(c.homeWorld),
          isCrossWorld: Boolean(c.isCrossWorld),
        }))
      : []
    if (worlds.length === 0) return null
    return { storyCore, worlds, characters }
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
      worldOrigin: asText(parsed.worldview?.worldOrigin),
      powerHierarchy: asText(parsed.worldview?.powerHierarchy),
      continentLayout: asText(parsed.worldview?.continentLayout),
      climateByRegion: asText(parsed.worldview?.climateByRegion),
      races: asText(parsed.worldview?.races),
      factionLayout: asText(parsed.worldview?.factionLayout),
    }

    const history: ReverseHistory = {
      overview: asText(parsed.history?.overview),
    }

    const storyCore: ReverseStoryCore = {
      logline: asText(parsed.storyCore?.logline),
      theme: asText(parsed.storyCore?.theme),
      centralConflict: asText(parsed.storyCore?.centralConflict),
      plotPattern: asText(parsed.storyCore?.plotPattern),
      mainPlot: asText(parsed.storyCore?.mainPlot),
    }

    const characters: ReverseCharacter[] = Array.isArray(parsed.characters)
      ? parsed.characters.map((c: Record<string, unknown>) => ({
          name: asText(c.name),
          ...parseAxes(c),
          shortDescription: asText(c.shortDescription),
          personality: asText(c.personality),
          background: asText(c.background),
          motivation: asText(c.motivation),
          arc: asText(c.arc),
        }))
      : []

    return { worldview, history, storyCore, characters }
  } catch {
    return null
  }
}
