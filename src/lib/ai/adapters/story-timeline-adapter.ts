/**
 * 故事进程年表提取适配器 — Phase 25.5.2-a
 * 从章节正文提取剧情大事。
 */
import type { ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

export interface ExtractedStoryEvent {
  title: string
  storyTime: string
  importance: number
  description: string
}

export function buildStoryTimelinePrompt(chapterTitle: string, chapterText: string): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('story-timeline.extract')
  const { messages } = renderPrompt(tpl, { chapterTitle, chapterText })
  return messages
}

export function readStoryTimelinePromptTemplateSnapshotV1() {
  const template = usePromptStore.getState().getActive('story-timeline.extract')
  return {
    moduleKey: template.moduleKey,
    systemPrompt: template.systemPrompt,
    userPromptTemplate: template.userPromptTemplate,
    variables: template.variables,
    modelOverride: template.modelOverride ?? null,
    examples: template.examples ?? null,
    parameters: template.parameters ?? null,
  }
}

/** HARNESS-64 durable protocol: exact keys and exact types; legacy callers keep
 * the tolerant parser below until their own migration removes it. */
export function parseStoryEventsStrictV1(raw: string): ExtractedStoryEvent[] {
  let source = raw.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('故事年表提取输出不是有效 JSON。')
  }
  if (!Array.isArray(parsed)) throw new Error('故事年表提取输出必须是 JSON 数组。')
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`故事年表候选 ${index + 1} 不是对象。`)
    }
    const row = value as Record<string, unknown>
    const keys = ['title', 'storyTime', 'importance', 'description'] as const
    if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key as typeof keys[number]))) {
      throw new Error(`故事年表候选 ${index + 1} 字段不在允许闭集。`)
    }
    if (
      typeof row.title !== 'string' || !row.title.trim()
      || typeof row.storyTime !== 'string'
      || !Number.isInteger(row.importance) || (row.importance as number) < 1 || (row.importance as number) > 3
      || typeof row.description !== 'string'
    ) throw new Error(`故事年表候选 ${index + 1} 字段类型或重要度无效。`)
    return {
      title: row.title.trim(),
      storyTime: row.storyTime.trim(),
      importance: row.importance as number,
      description: row.description.trim(),
    }
  })
}

export function parseStoryEvents(raw: string): ExtractedStoryEvent[] {
  const trimmed = raw.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  let jsonStr = fence ? fence[1].trim() : trimmed
  const start = jsonStr.indexOf('[')
  const end = jsonStr.lastIndexOf(']')
  if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1)
  try {
    const arr = JSON.parse(jsonStr)
    if (!Array.isArray(arr)) return []
    return arr
      .map((e: Record<string, unknown>): ExtractedStoryEvent => {
        let imp = Math.round(Number(e.importance) || 2)
        if (imp < 1) imp = 1
        if (imp > 3) imp = 3
        return {
          title: String(e.title || '').trim(),
          storyTime: String(e.storyTime || '').trim(),
          importance: imp,
          description: String(e.description || '').trim(),
        }
      })
      .filter(e => e.title)
  } catch {
    return []
  }
}
