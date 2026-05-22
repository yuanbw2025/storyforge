import type { CharacterRole } from '../types'
import type { AIConfig } from '../types'
import { chat } from './client'

/** 解析结果 —— 对应 Character 可写字段 */
export interface ParsedCharacter {
  name: string
  role: CharacterRole
  shortDescription: string
  appearance: string
  personality: string
  background: string
  motivation: string
  abilities: string
  relationships: string
  arc: string
}

/** 角色定位中文 → CharacterRole */
const ROLE_MAP: Record<string, CharacterRole> = {
  '主角':    'protagonist',
  '男主':    'protagonist',
  '女主':    'protagonist',
  '主人公':  'protagonist',
  '反派':    'antagonist',
  '大反派':  'antagonist',
  '配角':    'supporting',
  '重要配角':'supporting',
  '次要':    'minor',
  '次要角色':'minor',
  'npc':     'npc',
  'NPC':     'npc',
  '路人':    'extra',
}

function parseRole(text: string): CharacterRole {
  for (const [cn, role] of Object.entries(ROLE_MAP)) {
    if (text.includes(cn)) return role
  }
  return 'supporting'
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
  "role": "定位，只能是以下之一：protagonist / antagonist / supporting / minor / npc / extra",
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
- role 字段必须是英文枚举值之一，根据原文定位描述来判断
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
    )

    // 从响应中提取 JSON（防止模型多输出前后文）
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, string>

    return {
      name:             parsed.name             || 'AI 生成角色',
      role:             parseRole(parsed.role || '') || (parsed.role as CharacterRole) || 'supporting',
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
