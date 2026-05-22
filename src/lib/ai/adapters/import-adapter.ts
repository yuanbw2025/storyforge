import type { AIConfig, ChatMessage } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

export type ImportParseType = 'character' | 'worldview' | 'outline' | 'all'

/**
 * 针对不同解析类型推荐的 maxTokens 上限。
 *
 * 背景：默认 maxTokens=4096 对整部小说统一解析远远不够——
 * 一部成品长篇的世界观 + 全角色 + 章节大纲，AI 输出 JSON 很容易 8K~16K tokens。
 * 截断后 ```json fence 没关闭，前端 extractJSON 直接报 "Unexpected token"。
 */
export const IMPORT_MAX_TOKENS: Record<ImportParseType, number> = {
  all:       16384, // 统一解析（世界观 + 角色 + 大纲）—— 最吃 tokens
  character:  8192, // 仅角色列表
  worldview:  6144, // 仅世界观 12 个字段
  outline:   10240, // 整部大纲树可能章节很多
}

/** 导入解析时临时覆盖的 AI 配置 */
export function buildImportAIConfigOverride(type: ImportParseType): Partial<AIConfig> {
  return { maxTokens: IMPORT_MAX_TOKENS[type] }
}


const KEY_MAP: Record<ImportParseType,
  'import.parse-character' | 'import.parse-worldview' | 'import.parse-outline' | 'import.parse-all'> = {
  character: 'import.parse-character',
  worldview: 'import.parse-worldview',
  outline:   'import.parse-outline',
  all:       'import.parse-all',
}

/** 构造导入解析提示词 */
export function buildImportParsePrompt(
  type: ImportParseType,
  rawDocument: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive(KEY_MAP[type])
  // 文档过长会爆 token — 截断到 60000 字（粗估 15K tokens），统一解析经常吃成品小说
  const MAX = type === 'all' ? 60000 : 30000
  const trimmed = rawDocument.length > MAX
    ? rawDocument.slice(0, MAX) + '\n\n...（文档过长，已截断后半部分）'
    : rawDocument
  const { messages } = renderPrompt(tpl, { rawDocument: trimmed })
  return messages
}

/**
 * 从 AI 输出中抽取 JSON（去掉 ```json 包裹）。
 *
 * 兼容流式输出被截断的情况：
 * 1) 优先匹配完整的 ```json ... ``` 代码块；
 * 2) 匹配不到就退化为"找到第一个 ```json 之后的所有内容"（fence 未闭合 = 被截断）；
 * 3) 再退化为从第一个 `{` / `[` 开始截；
 * 4) 解析失败时抛出包含"是否可能被 maxTokens 截断"提示的错误。
 */
export function extractJSON(aiOutput: string): unknown {
  const input = aiOutput.trim()

  // 1. 完整 fence ```json ... ```
  const fullFence = /```(?:json)?\s*([\s\S]*?)```/i.exec(input)
  if (fullFence) {
    return tryParseWithRepair(fullFence[1].trim())
  }

  // 2. 未闭合 fence —— AI 输出被 maxTokens 截断时常见
  const openFence = /```(?:json)?\s*([\s\S]*)$/i.exec(input)
  if (openFence) {
    return tryParseWithRepair(openFence[1].trim(), true)
  }

  // 3. 直接找 { / [ 起点
  const firstBrace = input.search(/[{[]/)
  if (firstBrace >= 0) {
    return tryParseWithRepair(input.slice(firstBrace), true)
  }

  // 4. 全部失败
  throw new Error('AI 输出里没有找到 JSON 代码块（既没有 ```json 包裹，也没有 { / [ 起点）')
}

/** 尝试解析 JSON，失败时给出更友好的中文提示 */
function tryParseWithRepair(jsonStr: string, mightBeTruncated = false): unknown {
  try {
    return JSON.parse(jsonStr)
  } catch (err) {
    // 尝试"修复"被截断的 JSON：从末尾删到最后一个完整字段
    if (mightBeTruncated) {
      const repaired = repairTruncatedJSON(jsonStr)
      if (repaired) {
        try {
          const obj = JSON.parse(repaired)
          console.warn('[import] JSON 被截断，已自动修复到最后一个完整字段')
          return obj
        } catch { /* 继续抛原始错误 */ }
      }
      throw new Error(
        `AI 输出的 JSON 被截断（${(err as Error).message}）。` +
        `原因通常是 AI 单次输出 token 上限不够——建议：` +
        `1) 缩短上传文档；2) 在设置里把 maxTokens 调到 16384 或更大；3) 改用更强的模型。`,
      )
    }
    throw err
  }
}

/**
 * 极简 JSON 截断修复：逐字符从后往前吃，直到能 JSON.parse 成功。
 * 对 `{ ..., "arc": "从被迫` 这种被截断在字符串中间的情况，返回 null（交给上层报错）。
 */
function repairTruncatedJSON(s: string): string | null {
  // 去掉尾部的 ``` 残留
  let text = s.replace(/```\s*$/, '').trimEnd()

  // 最多尝试切 10000 字符找最后一个能解析的位置
  const maxTrim = Math.min(10000, text.length)
  for (let trim = 0; trim < maxTrim; trim++) {
    const candidate = text.slice(0, text.length - trim)
    // 找最后的 , 或 { 或 [ 切一下，再补齐括号
    const lastComma = candidate.lastIndexOf(',')
    const lastOpen = Math.max(candidate.lastIndexOf('{'), candidate.lastIndexOf('['))
    const cut = Math.max(lastComma, lastOpen)
    if (cut < 0) continue
    let piece = candidate.slice(0, cut)
    // 统计未关闭的 { [ 然后补上
    piece = closeBrackets(piece)
    try {
      JSON.parse(piece)
      return piece
    } catch {
      continue
    }
  }
  return null
}

/** 给可能的未闭合 JSON 补齐右括号 */
function closeBrackets(s: string): string {
  // 忽略字符串内部的括号
  let inStr = false
  let esc = false
  const stack: string[] = []
  for (const ch of s) {
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  // 如果字符串里还没关闭，先加引号
  let out = s
  if (inStr) out += '"'
  // 按栈倒序补右括号
  while (stack.length) {
    const open = stack.pop()!
    out += open === '{' ? '}' : ']'
  }
  return out
}


// 统一解析结果的 TS 结构移到 ../../types/import-session-data.ts 作为共享类型，
// 避免分块流水线跟本 adapter 循环依赖。这里 re-export 以保持旧 import 路径兼容。
export type { UnifiedParseResult } from '../../types/import-session-data'
