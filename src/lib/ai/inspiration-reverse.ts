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
}

const VALID_WG_TYPES: WorldGroupType[] = ['primary', 'traversal', 'instance', 'parallel', 'ascension', 'custom']
const VALID_WEIGHTS: CharacterRoleWeight[] = ['main', 'secondary', 'npc', 'extra']
const VALID_MORAL: CharacterMoralAxis[] = ['good', 'neutral', 'evil']
const VALID_ORDER: CharacterOrderAxis[] = ['lawful', 'neutral', 'chaotic']

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
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : output.trim()
  try {
    const p = JSON.parse(jsonStr)
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
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : output.trim()

  try {
    const parsed = JSON.parse(jsonStr)

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

    return { worldview, storyCore, characters }
  } catch {
    return null
  }
}
