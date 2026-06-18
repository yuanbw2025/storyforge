import type { CharacterMoralAxis, CharacterOrderAxis, CharacterRoleWeight } from '../types'
import type { AIConfig } from '../types'
import { chat } from './client'
import { MORAL_AXES, ORDER_AXES, ROLE_WEIGHTS } from '../character/character-axes'

/** 解析结果 —— 对应 Character 可写字段 */
export interface ParsedCharacter {
  name: string
  roleWeight: CharacterRoleWeight
  moralAxis: CharacterMoralAxis
  orderAxis: CharacterOrderAxis
  shortDescription: string
  appearance: string
  personality: string
  background: string
  motivation: string
  abilities: string
  relationships: string
  arc: string
}

const WEIGHT_MAP: Record<string, CharacterRoleWeight> = {
  主要: 'main', 主角: 'main', 反派: 'main', 配角: 'main',
  次要: 'secondary', NPC: 'npc', npc: 'npc', 路人: 'extra',
}

function normalizeEnum<T extends string>(
  raw: string,
  values: readonly T[],
  aliases: Record<string, T>,
  fallback: T,
): T {
  const v = (raw || '').trim().toLowerCase()
  const direct = values.find(item => item === v)
  if (direct) return direct
  for (const [alias, normalized] of Object.entries(aliases)) {
    if (raw.includes(alias)) return normalized
  }
  return fallback
}

/**
 * 调用 AI 将角色描述文本解析为结构化 JSON，填充各字段。
 *
 * @param rawText  AI 生成的原始角色描述（Markdown 格式）
 * @param config   当前 AI 配置（复用用户已配置的 provider/key）
 * @returns        解析后的角色字段，失败时返回 null
 */
export async function parseCharacterOutput(
  rawText: string,
  config: AIConfig,
): Promise<ParsedCharacter | null> {
  const systemPrompt = `你是一个结构化数据提取助手。
用户会给你一段角色设定文本（可能含 Markdown 格式），请从中提取以下字段并以 JSON 格式返回：

{
  "name": "角色姓名（纯文字，不含符号）",
  "roleWeight": "戏份，只能是 main / secondary / npc / extra",
  "moralAxis": "道德轴，只能是 good / neutral / evil",
  "orderAxis": "秩序轴，只能是 lawful / neutral / chaotic",
  "shortDescription": "一句话简介（不超过 50 字）",
  "appearance": "外貌描述（去除 Markdown，纯文字段落）",
  "personality": "性格特点",
  "background": "背景故事",
  "motivation": "核心动机",
  "abilities": "能力/技能",
  "relationships": "人物关系",
  "arc": "角色弧光/成长线"
}

注意：
- 所有字段值都是纯文字，不含 Markdown 标记（不含 **bold**、##标题、- 列表符号等）
- 如果原文没有对应内容，该字段填空字符串 ""
- 原文中的"金手指 / 系统 / 外挂 / 天赋 / 特殊能力 / 宝物能力"等属于角色能力设定时,统一并入 abilities,不要当成角色姓名或 relationships
- roleWeight / moralAxis / orderAxis 必须使用英文枚举；九宫格阵营不可留空
- 只输出 JSON，不要输出其他任何内容`

  const userPrompt = `请从以下角色设定文本中提取结构化数据：

${rawText}`

  try {
    const response = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      config,
      { category: 'character.structure' },
    )

    // 从响应中提取 JSON（防止模型多输出前后文）
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>

    return {
      name:             parsed.name             || 'AI 生成角色',
      roleWeight:       normalizeEnum(parsed.roleWeight || '', ROLE_WEIGHTS, WEIGHT_MAP, 'main'),
      moralAxis:        normalizeEnum(parsed.moralAxis || '', MORAL_AXES, { 善: 'good', 正派: 'good', 中立: 'neutral', 恶: 'evil', 反派: 'evil' }, 'neutral'),
      orderAxis:        normalizeEnum(parsed.orderAxis || '', ORDER_AXES, { 守序: 'lawful', 中立: 'neutral', 混乱: 'chaotic' }, 'neutral'),
      shortDescription: parsed.shortDescription || '',
      appearance:       parsed.appearance       || '',
      personality:      parsed.personality      || '',
      background:       parsed.background       || '',
      motivation:       parsed.motivation       || '',
      abilities:        parsed.abilities        || '',
      relationships:    parsed.relationships    || '',
      arc:              parsed.arc              || '',
    }
  } catch {
    return null
  }
}
