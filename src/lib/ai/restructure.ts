/**
 * AI 文本重构工具 — 全局原则：一切文本分析/内容提取用 AI，不用正则。
 *
 * 当 AI 生成的内容不是规整 JSON 时，不降级到正则（准确率低），
 * 而是再调用一次 AI 把它重新整理成干净的 JSON。
 */
import type { AIConfig, ChatMessage } from '../types'
import { chat } from './client'

/** 从文本中尽力提取 JSON（数组或对象）。仅做结构定位，非文本分析。 */
function extractJson<T>(raw: string): T | null {
  const trimmed = raw.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  let s = fence ? fence[1].trim() : trimmed
  // 定位最外层的 [ ] 或 { }
  const arrStart = s.indexOf('['), arrEnd = s.lastIndexOf(']')
  const objStart = s.indexOf('{'), objEnd = s.lastIndexOf('}')
  if (arrStart >= 0 && arrEnd > arrStart && (objStart < 0 || arrStart < objStart)) {
    s = s.slice(arrStart, arrEnd + 1)
  } else if (objStart >= 0 && objEnd > objStart) {
    s = s.slice(objStart, objEnd + 1)
  }
  try { return JSON.parse(s) as T } catch { return null }
}

/**
 * 让 AI 把一段（可能格式不规整的）文本重新整理为符合指定结构的 JSON。
 * @param rawText  原始 AI 输出
 * @param schemaInstruction  目标 JSON 结构与字段说明（中文）
 * @param config  AI 配置
 * @returns 解析后的结构（数组或对象），失败返回 null
 */
export async function aiRestructure<T>(
  rawText: string,
  schemaInstruction: string,
  config: AIConfig,
): Promise<T | null> {
  if (!config.apiKey || !rawText.trim()) return null
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是一个文本结构化助手。把用户提供的内容**完整无损**地整理成符合要求的 JSON。
${schemaInstruction}
要求：
- 只输出 JSON 本身，不要 markdown 代码块，不要任何解释文字
- 完整保留原文的所有条目和信息，不要遗漏、不要合并、不要自行增删内容
- 字段名严格按要求，缺失的可选字段留空字符串或空数组`,
    },
    { role: 'user', content: rawText },
  ]
  try {
    const out = await chat(messages, config)
    return extractJson<T>(out)
  } catch {
    return null
  }
}

export { extractJson }
