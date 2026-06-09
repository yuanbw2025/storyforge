import type { ChatMessage, ForeshadowType } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

export interface RunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
}

export function buildForeshadowSuggestPrompt(
  projectName: string,
  genre: string,
  worldContext: string,
  characterContext: string,
  existingForeshadows: string,
  options?: RunOptions,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('foreshadow.generate')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres: genre,
    worldContext,
    characters: characterContext,
    existingForeshadows,
    hasNoForeshadows: existingForeshadows ? '' : '1',
  }, options)
  return messages
}

// ── 把 AI 自由文本建议结构化为可入库的伏笔条目（用 AI 解析，不用正则） ──

const VALID_FORESHADOW_TYPES: ForeshadowType[] = [
  'chekhov', 'prophecy', 'symbol', 'character', 'dialogue',
  'environment', 'timeline', 'red-herring', 'parallel', 'callback',
]

export interface StructuredForeshadow {
  name: string
  type: ForeshadowType
  description: string
}

/** 构建"把伏笔建议文本拆成结构化 JSON"的二次解析 prompt */
export function buildForeshadowStructurePrompt(text: string): ChatMessage[] {
  const system = `你是一个文本结构化助手。用户提供了一段 AI 生成的伏笔建议文本，请把其中每一个伏笔拆分为结构化条目，输出纯 JSON 数组（不要 markdown 代码块，不要解释）：
[{ "name": "伏笔名称", "type": "类型代码", "description": "伏笔描述（含埋设方式与回收建议，尽量完整保留原文要点）" }]

type 只能是以下之一（按伏笔性质选最贴切的）：
chekhov(契诃夫之枪/早埋后用的关键物品或信息) / prophecy(预言暗示) / symbol(象征意象) / character(角色伏笔) / dialogue(对话伏笔) / environment(环境伏笔) / timeline(时间线伏笔) / red-herring(红鲱鱼误导) / parallel(平行伏笔) / callback(回调呼应)
无法判断时用 chekhov。

请完整提取文本中的每一个伏笔，不要遗漏，不要合并。`
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ]
}

/** 解析结构化输出 */
export function parseForeshadowStructured(raw: string): StructuredForeshadow[] {
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
      .map((f: Record<string, unknown>): StructuredForeshadow => ({
        name: String(f.name || '').trim(),
        type: VALID_FORESHADOW_TYPES.includes(f.type as ForeshadowType) ? (f.type as ForeshadowType) : 'chekhov',
        description: String(f.description || '').trim(),
      }))
      .filter(f => f.name)
  } catch {
    return []
  }
}
