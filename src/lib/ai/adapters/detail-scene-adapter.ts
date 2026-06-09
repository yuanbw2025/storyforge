import type { ChatMessage, AIConfig } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import { aiRestructure } from '../restructure'

/** 细纲场景生成 */
export function buildDetailSceneGeneratePrompt(
  chapterTitle: string,
  chapterSummary: string,
  worldContext: string,
  characters: string,
  previousChapterEnding: string,
  userHint?: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('detail.scene')
  const { messages } = renderPrompt(tpl, {
    chapterTitle,
    chapterSummary,
    worldContext: worldContext || '',
    characters: characters || '',
    previousChapterEnding: previousChapterEnding || '',
    userHint,
  })
  return messages
}

/**
 * Phase D2: 完善细纲 — 生成章节级增强信息
 * 输入：章节大纲 + 前后章摘要 + 世界观 + 角色 + 伏笔
 * 输出：openingHook / endingCliffhanger / sceneLocation / emotionArc / 角色分配 / 伏笔关联
 */
export function buildEnhancedDetailPrompt(
  chapterTitle: string,
  chapterSummary: string,
  prevChapterSummary: string,
  nextChapterSummary: string,
  worldContext: string,
  characterList: string,
  foreshadowList: string,
): ChatMessage[] {
  const systemPrompt = `你是一个小说细纲策划专家。根据章节大纲、前后章摘要和可用资源，为本章生成增强细纲信息。

输出严格 JSON，不要加 markdown 代码块：
{
  "openingHook": "从上一章结尾自然过渡的开头描述（1-2句）",
  "endingCliffhanger": "本章结尾悬念设计（1-2句）",
  "sceneLocation": "本章主要场景地点",
  "emotionArc": "rising|falling|flat|wave|climax",
  "appearingCharacterIds": [1, 2, 3],
  "foreshadowIds": [1, 2],
  "scenes": [
    {
      "title": "场景标题",
      "summary": "一句话概要",
      "location": "地点",
      "conflict": "核心冲突",
      "pace": "slow|medium|fast|climax",
      "characterIds": [1, 2],
      "estimatedWords": 2000
    }
  ]
}

情绪走向说明：
- rising：情绪逐步升温
- falling：情绪逐步降温
- flat：平稳叙事
- wave：起伏波动
- climax：全程高潮

要求：
1. openingHook 要衔接上一章结尾
2. endingCliffhanger 要吸引读者继续阅读
3. 出场角色从提供的角色列表中选取合适的（用 ID）
4. 伏笔关联从伏笔列表中选取本章相关的（用 ID）
5. 拆分 3-6 个场景，每个场景估算合理字数`

  const parts: string[] = [
    `【章节】${chapterTitle}`,
    `【章节大纲】${chapterSummary || '暂无'}`,
  ]
  if (prevChapterSummary) parts.push(`【上一章摘要】${prevChapterSummary}`)
  if (nextChapterSummary) parts.push(`【下一章摘要】${nextChapterSummary}`)
  if (worldContext) parts.push(`【世界观】\n${worldContext.slice(0, 500)}`)
  if (characterList) parts.push(`【可用角色】\n${characterList.slice(0, 600)}`)
  if (foreshadowList) parts.push(`【可用伏笔】\n${foreshadowList.slice(0, 500)}`)

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n\n') + '\n\n请生成增强细纲：' },
  ]
}

/** 解析增强细纲 AI 输出 */
export function parseEnhancedDetailResult(raw: string): {
  openingHook?: string
  endingCliffhanger?: string
  sceneLocation?: string
  emotionArc?: string
  appearingCharacterIds?: number[]
  foreshadowIds?: number[]
  scenes?: Array<{
    title: string
    summary: string
    location: string
    conflict: string
    pace: string
    characterIds: number[]
    estimatedWords: number
  }>
} | null {
  const trimmed = raw.trim()
  let jsonStr = trimmed

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) jsonStr = fenceMatch[1].trim()

  const objStart = jsonStr.indexOf('{')
  const objEnd = jsonStr.lastIndexOf('}')
  if (objStart === -1 || objEnd === -1) return null

  try {
    return JSON.parse(jsonStr.slice(objStart, objEnd + 1))
  } catch {
    return null
  }
}

export type EnhancedDetailResult = NonNullable<ReturnType<typeof parseEnhancedDetailResult>>

const DETAIL_SCHEMA = `目标结构：JSON 对象
{
  "openingHook": "开场钩子",
  "endingCliffhanger": "结尾悬念",
  "sceneLocation": "主要场景地点",
  "emotionArc": "情绪曲线",
  "scenes": [{ "title": "场景标题", "summary": "场景概要", "location": "地点", "conflict": "冲突", "pace": "节奏", "estimatedWords": 字数(整数) }]
}
完整保留原文里的每一个场景，不要遗漏。`

/**
 * 智能解析细纲结果：JSON 优先 → 失败则 AI 重构（不靠正则）。
 * @param config 用于 AI 重构兜底
 */
export async function parseEnhancedDetailSmart(
  raw: string,
  config: AIConfig,
): Promise<EnhancedDetailResult | null> {
  const direct = parseEnhancedDetailResult(raw)
  if (direct) return direct
  // JSON 解析失败 → AI 重构（不降级到正则）
  return await aiRestructure<EnhancedDetailResult>(raw, DETAIL_SCHEMA, config)
}
