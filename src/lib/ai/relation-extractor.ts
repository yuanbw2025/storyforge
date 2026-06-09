/**
 * Phase 30.2 — 角色关系自动提取
 *
 * 从大纲摘要 + 章节正文中提取角色关系，
 * 返回结构化的关系数组供 UI 预览和写入。
 */
import { db } from '../db/schema'
import type { Character, ChatMessage, RelationType } from '../types'
import { usePromptStore } from '../../stores/prompt'
import { renderPrompt } from './prompt-engine'

/** AI 返回的原始关系条目 */
export interface ExtractedRelation {
  char1: string
  char2: string
  type: RelationType
  label: string
  description: string
  bidirectional: boolean
}

/** 匹配后的关系条目（附带角色 ID） */
export interface MatchedRelation extends ExtractedRelation {
  fromCharacterId: number
  toCharacterId: number
  /** 是否与已有关系重复 */
  isDuplicate: boolean
}

/**
 * 构建提取用的 prompt messages
 */
export async function buildRelationExtractPrompt(
  projectId: number,
  characters: Character[],
): Promise<ChatMessage[]> {
  // 1. 角色列表
  const characterList = characters
    .map(c => `- ${c.name}（${c.role === 'protagonist' ? '主角' : c.role === 'antagonist' ? '反派' : c.role === 'supporting' ? '重要配角' : c.role === 'minor' ? '次要角色' : '路人'}）${c.shortDescription ? '：' + c.shortDescription : ''}`)
    .join('\n')

  // 2. 大纲摘要
  const outlineNodes = await db.outlineNodes
    .where('projectId').equals(projectId)
    .toArray()
  const outlineSummary = outlineNodes
    .filter(n => n.summary)
    .sort((a, b) => a.order - b.order)
    .map(n => `[${n.title}] ${n.summary}`)
    .join('\n')

  // 3. 章节正文（取前 N 章，控制总 token）
  const chapters = await db.chapters
    .where('projectId').equals(projectId)
    .toArray()
  const sortedChapters = chapters
    .filter(c => c.content && c.content.length > 50)
    .sort((a, b) => a.order - b.order)

  // 限制总字符数在 ~8000 字以内（约 5000 token），优先取前面的章节
  let totalChars = 0
  const MAX_CHARS = 8000
  const contentParts: string[] = []
  for (const ch of sortedChapters) {
    const snippet = ch.content.slice(0, 2000)
    if (totalChars + snippet.length > MAX_CHARS) break
    contentParts.push(`[${ch.title}]\n${snippet}`)
    totalChars += snippet.length
  }
  const chapterContent = contentParts.join('\n\n')

  // 4. 获取项目名
  const project = await db.projects.get(projectId)
  const projectName = project?.name || '未命名项目'

  // 5. 渲染 prompt
  const tpl = usePromptStore.getState().getActive('relation.extract')
  const { messages } = renderPrompt(tpl, {
    projectName,
    characterList,
    outlineSummary: outlineSummary || '',
    chapterContent: chapterContent || '',
  })
  return messages
}

/**
 * 解析 AI 输出的 JSON 关系数组
 */
export function parseRelationOutput(output: string): ExtractedRelation[] {
  // 尝试从输出中提取 JSON 数组
  let jsonStr = output.trim()

  // 去除 markdown code block
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim()
  }

  // 尝试找到 JSON 数组
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/)
  if (!arrayMatch) return []

  try {
    const parsed = JSON.parse(arrayMatch[0])
    if (!Array.isArray(parsed)) return []

    const VALID_TYPES = new Set<string>([
      'family', 'lover', 'friend', 'rival', 'enemy',
      'master', 'student', 'ally', 'subordinate', 'other',
    ])

    return parsed
      .filter((item: Record<string, unknown>) =>
        item.char1 && item.char2 && item.type && VALID_TYPES.has(String(item.type))
      )
      .map((item: Record<string, unknown>) => ({
        char1: String(item.char1),
        char2: String(item.char2),
        type: String(item.type) as RelationType,
        label: String(item.label || ''),
        description: String(item.description || ''),
        bidirectional: item.bidirectional !== false,
      }))
  } catch {
    return []
  }
}

/**
 * 将提取的关系与已有角色名匹配，标记重复
 */
export function matchRelations(
  extracted: ExtractedRelation[],
  characters: Character[],
  existingRelations: { fromCharacterId: number; toCharacterId: number; relationType: string }[],
): MatchedRelation[] {
  // 建立名字 → 角色 ID 的映射（支持模糊匹配）
  const nameMap = new Map<string, number>()
  for (const c of characters) {
    if (c.id != null) {
      nameMap.set(c.name, c.id)
      // 也支持去掉姓氏后的名字匹配（如"张三" → 也匹配 "三"，但仅当名字 >= 2 字）
      if (c.name.length >= 2) {
        nameMap.set(c.name.slice(1), c.id)
      }
    }
  }

  const findCharId = (name: string): number | null => {
    // 精确匹配优先
    if (nameMap.has(name)) return nameMap.get(name)!
    // 包含匹配
    for (const c of characters) {
      if (c.id != null && (c.name.includes(name) || name.includes(c.name))) {
        return c.id
      }
    }
    return null
  }

  // 已有关系的快速查重集合
  const existingSet = new Set(
    existingRelations.map(r => `${Math.min(r.fromCharacterId, r.toCharacterId)}-${Math.max(r.fromCharacterId, r.toCharacterId)}-${r.relationType}`)
  )

  const results: MatchedRelation[] = []

  for (const rel of extracted) {
    const fromId = findCharId(rel.char1)
    const toId = findCharId(rel.char2)
    if (fromId == null || toId == null || fromId === toId) continue

    const dedupKey = `${Math.min(fromId, toId)}-${Math.max(fromId, toId)}-${rel.type}`
    const isDuplicate = existingSet.has(dedupKey)

    results.push({
      ...rel,
      fromCharacterId: fromId,
      toCharacterId: toId,
      isDuplicate,
    })
  }

  return results
}
