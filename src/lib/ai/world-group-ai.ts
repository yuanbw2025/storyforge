/**
 * Phase 25.4 — 多世界 AI 适配器
 * 世界建议（suggest）+ 世界扩写（expand）的 prompt 构建与输出解析
 */
import type { ChatMessage, WorldGroupType } from '../types'
import { usePromptStore } from '../../stores/prompt'
import { renderPrompt } from './prompt-engine'

// ── 世界建议 ────────────────────────────────────────────────────────────

export interface SuggestedWorld {
  name: string
  type: WorldGroupType
  description: string
  entryCondition: string
  powerRestriction: string
  plannedChapterCount: number
}

const VALID_TYPES: WorldGroupType[] = ['primary', 'traversal', 'instance', 'parallel', 'ascension', 'custom']

export function buildWorldSuggestPrompt(args: {
  projectName: string
  genres: string
  concept: string
  existingWorlds: string
  userHint?: string
}): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('world-group.suggest')
  const { messages } = renderPrompt(tpl, {
    projectName: args.projectName,
    genres: args.genres,
    concept: args.concept,
    existingWorlds: args.existingWorlds,
    userHint: args.userHint || '',
  })
  return messages
}

export function parseWorldSuggestOutput(output: string): SuggestedWorld[] {
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : output.trim()
  try {
    const parsed = JSON.parse(jsonStr)
    const arr = Array.isArray(parsed) ? parsed : (parsed.worlds || [])
    return arr.map((w: Record<string, unknown>): SuggestedWorld => ({
      name: String(w.name || '未命名世界'),
      type: VALID_TYPES.includes(w.type as WorldGroupType) ? (w.type as WorldGroupType) : 'traversal',
      description: String(w.description || ''),
      entryCondition: String(w.entryCondition || ''),
      powerRestriction: String(w.powerRestriction || ''),
      plannedChapterCount: Number(w.plannedChapterCount) || 0,
    })).filter((w: SuggestedWorld) => w.name && w.name !== '未命名世界' || w.description)
  } catch {
    return []
  }
}

// ── 世界扩写 ────────────────────────────────────────────────────────────

export interface ExpandedWorldview {
  worldOrigin: string
  powerHierarchy: string
  continentLayout: string
  climateByRegion: string
  historyLine: string
  races: string
  factionLayout: string
}

export function buildWorldExpandPrompt(args: {
  worldName: string
  worldType: string
  draft: string
  otherWorlds: string
  storyCore?: string
  userHint?: string
}): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('world-group.expand')
  const { messages } = renderPrompt(tpl, {
    worldName: args.worldName,
    worldType: args.worldType,
    draft: args.draft,
    otherWorlds: args.otherWorlds,
    storyCore: args.storyCore || '',
    userHint: args.userHint || '',
  })
  return messages
}

export function parseWorldExpandOutput(output: string): ExpandedWorldview | null {
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : output.trim()
  try {
    const p = JSON.parse(jsonStr)
    return {
      worldOrigin: String(p.worldOrigin || ''),
      powerHierarchy: String(p.powerHierarchy || ''),
      continentLayout: String(p.continentLayout || ''),
      climateByRegion: String(p.climateByRegion || ''),
      historyLine: String(p.historyLine || ''),
      races: String(p.races || ''),
      factionLayout: String(p.factionLayout || ''),
    }
  } catch {
    return null
  }
}
