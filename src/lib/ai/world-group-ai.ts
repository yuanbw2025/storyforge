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

export const WORLDVIEW_EXPAND_FIELDS_V1 = [
  'worldOrigin',
  'powerHierarchy',
  'continentLayout',
  'climateByRegion',
  'historyLine',
  'races',
  'factionLayout',
] as const

export const WORLDVIEW_EXPAND_PROMPT_VERSION_V1 = 'worldview-expand-v1' as const

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

/** HARNESS-67: all model-visible project data has already passed through the
 * Context Gateway. The adapter adds no database reads or hidden defaults. */
export function buildWorldExpandPromptFromRegisteredContextV1(contextText: string): ChatMessage[] {
  return buildWorldExpandPrompt({
    worldName: '',
    worldType: '',
    draft: `【经过登记的当前世界资料】\n${contextText || '（登记来源为空）'}`,
    otherWorlds: '',
    storyCore: '',
    userHint: '只依据上方登记资料生成；严格输出既定七字段且每字段非空，不得输出 Markdown、解释或额外字段。',
  })
}

export function readWorldExpandPromptTemplateSnapshotV1(): ChatMessage[] {
  return buildWorldExpandPromptFromRegisteredContextV1('{{REGISTERED_CONTEXT}}')
}

/** Strict parser for the governed route. The legacy parser above remains only
 * for historical callers until their migrations are completed. */
export function parseWorldExpandOutputStrictV1(output: string): ExpandedWorldview {
  const input = output.trim()
  if (!input) throw new Error('世界扩写候选为空。')
  if (/^```|```$/.test(input)) throw new Error('世界扩写候选不得包含 Markdown 代码围栏。')
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { throw new Error('世界扩写候选不是有效的严格 JSON 对象。') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('世界扩写候选必须是 JSON 对象。')
  }
  const source = parsed as Record<string, unknown>
  const actual = Object.keys(source).sort()
  const expected = [...WORLDVIEW_EXPAND_FIELDS_V1].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`世界扩写候选只能包含 ${expected.join('、')}。`)
  }
  const result = {} as Record<(typeof WORLDVIEW_EXPAND_FIELDS_V1)[number], string>
  for (const field of WORLDVIEW_EXPAND_FIELDS_V1) {
    const value = source[field]
    if (typeof value !== 'string' || value.trim().length < 2 || value.length > 30_000) {
      throw new Error(`世界扩写候选 ${field} 必须是 2-30000 字符的非空文本。`)
    }
    result[field] = value.trim()
  }
  return result
}
