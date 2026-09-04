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
const SUGGESTED_TYPES: WorldGroupType[] = ['traversal', 'instance', 'parallel', 'ascension', 'custom']

export const WORLD_SUGGEST_FIELDS_V1 = [
  'name',
  'type',
  'description',
  'entryCondition',
  'powerRestriction',
  'plannedChapterCount',
] as const

export const WORLD_SUGGEST_PROMPT_VERSION_V1 = 'world-suggest-v1' as const

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

/** HARNESS-68: all model-visible project data has already passed through the
 * Context Gateway. The prompt adapter adds no database reads or hidden data. */
export function buildWorldSuggestPromptFromRegisteredContextV1(contextText: string): ChatMessage[] {
  return buildWorldSuggestPrompt({
    projectName: '',
    genres: '',
    concept: `【经过登记的世界规划资料】\n${contextText || '（登记来源为空）'}`,
    existingWorlds: '',
    userHint: '只依据上方登记资料建议 2-4 个尚不存在的新世界；严格输出既定六字段 JSON 数组，不得输出 Markdown、解释、主世界类型或额外字段。',
  })
}

export function readWorldSuggestPromptTemplateSnapshotV1(): ChatMessage[] {
  return buildWorldSuggestPromptFromRegisteredContextV1('{{REGISTERED_CONTEXT}}')
}

export function parseWorldSuggestOutputStrictV1(output: string): SuggestedWorld[] {
  const input = output.trim()
  if (!input) throw new Error('世界建议候选为空。')
  if (/^```|```$/.test(input)) throw new Error('世界建议候选不得包含 Markdown 代码围栏。')
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { throw new Error('世界建议候选不是有效的严格 JSON 数组。') }
  if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > 4) {
    throw new Error('世界建议候选必须包含 2-4 个世界。')
  }
  const names = new Set<string>()
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`世界建议候选第 ${index + 1} 项必须是 JSON 对象。`)
    }
    const row = value as Record<string, unknown>
    const actual = Object.keys(row).sort()
    const expected = [...WORLD_SUGGEST_FIELDS_V1].sort()
    if (actual.length !== expected.length || actual.some((key, keyIndex) => key !== expected[keyIndex])) {
      throw new Error(`世界建议候选只能包含 ${expected.join('、')}。`)
    }
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const description = typeof row.description === 'string' ? row.description.trim() : ''
    const entryCondition = typeof row.entryCondition === 'string' ? row.entryCondition.trim() : ''
    const powerRestriction = typeof row.powerRestriction === 'string' ? row.powerRestriction.trim() : ''
    if (name.length < 2 || name.length > 80) throw new Error(`世界建议候选第 ${index + 1} 项名称必须为 2-80 字符。`)
    const nameKey = name.toLocaleLowerCase()
    if (names.has(nameKey)) throw new Error(`世界建议候选存在重复名称“${name}”。`)
    names.add(nameKey)
    if (!SUGGESTED_TYPES.includes(row.type as WorldGroupType)) {
      throw new Error(`世界建议候选“${name}”的 type 不在允许闭集。`)
    }
    if (description.length < 2 || description.length > 2_000) throw new Error(`世界建议候选“${name}”的描述必须为 2-2000 字符。`)
    if (entryCondition.length < 2 || entryCondition.length > 1_000) throw new Error(`世界建议候选“${name}”的进入条件必须为 2-1000 字符。`)
    if (powerRestriction.length < 2 || powerRestriction.length > 1_000) throw new Error(`世界建议候选“${name}”的能力限制必须为 2-1000 字符。`)
    if (!Number.isInteger(row.plannedChapterCount) || Number(row.plannedChapterCount) < 1 || Number(row.plannedChapterCount) > 10_000) {
      throw new Error(`世界建议候选“${name}”的预计章节数必须为 1-10000 的整数。`)
    }
    return {
      name,
      type: row.type as WorldGroupType,
      description,
      entryCondition,
      powerRestriction,
      plannedChapterCount: Number(row.plannedChapterCount),
    }
  })
}

// ── 世界扩写 ────────────────────────────────────────────────────────────

export interface ExpandedWorldview {
  worldOrigin: string
  powerHierarchy: string
  continentLayout: string
  climateByRegion: string
  races: string
  factionLayout: string
}

export const WORLDVIEW_EXPAND_FIELDS_V1 = [
  'worldOrigin',
  'powerHierarchy',
  'continentLayout',
  'climateByRegion',
  'races',
  'factionLayout',
] as const

export const WORLDVIEW_EXPAND_PROMPT_VERSION_V1 = 'worldview-expand-v2' as const

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

/** HARNESS-67: all model-visible project data has already passed through the
 * Context Gateway. The adapter adds no database reads or hidden defaults. */
export function buildWorldExpandPromptFromRegisteredContextV1(contextText: string): ChatMessage[] {
  return buildWorldExpandPrompt({
    worldName: '',
    worldType: '',
    draft: `【经过登记的当前世界资料】\n${contextText || '（登记来源为空）'}`,
    otherWorlds: '',
    storyCore: '',
    userHint: '只依据上方登记资料生成；严格输出既定六字段且每字段非空，不得输出 Markdown、解释或额外字段。',
  })
}

export function readWorldExpandPromptTemplateSnapshotV1(): ChatMessage[] {
  return buildWorldExpandPromptFromRegisteredContextV1('{{REGISTERED_CONTEXT}}')
}

/** 正式世界基础扩写路由的唯一输出解析器。 */
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
