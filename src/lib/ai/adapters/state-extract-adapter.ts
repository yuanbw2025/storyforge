/**
 * 状态提取适配器 — 章节完成后提取实体状态变更
 * 输入：当前状态表 + 章节正文
 * 输出：JSON 格式的 StateDiffItem[]
 */
import type { ChatMessage } from '../../types'

/**
 * 构建状态提取 prompt
 * @param stateContext 当前状态表文本（来自 buildStateContext）
 * @param chapterTitle 章节标题
 * @param chapterText 章节正文（纯文本）
 * @param maxChars 章节文本最大截取长度
 */
export function buildStateExtractPrompt(
  stateContext: string,
  chapterTitle: string,
  chapterText: string,
  maxChars = 6000,
): ChatMessage[] {
  const trimmedText = chapterText.length > maxChars
    ? chapterText.slice(0, maxChars) + '\n…（后文省略）'
    : chapterText

  const systemPrompt = `你是一个小说状态追踪器。你的任务是阅读章节内容，对比当前状态表，提取所有发生变化的实体状态。

规则：
1. 只提取本章中**明确发生变化**的状态，不要重复已有状态
2. 如果出现**新实体**（新角色、新地点、新物品等），也要列出其初始状态
3. category 必须是以下之一：character / location / item / faction / event
4. field 用简短中文词汇，如：位置、状态、持有物、目标、关系、控制者、用途
5. oldValue 填变化前的值（从状态表中读取），新实体填 null
6. 如果本章没有任何状态变化，返回空数组 []

输出格式：严格 JSON 数组，不要加 markdown 代码块，不要加任何解释文字。
示例：
[{"entityName":"李明远","category":"character","field":"位置","oldValue":"长安","newValue":"洛阳"},{"entityName":"残破令牌","category":"item","field":"持有者","oldValue":"李明远","newValue":"萧寒"}]`

  const userPrompt = `${stateContext ? stateContext + '\n\n' : '（状态表为空，这是第一章）\n\n'}【章节标题】${chapterTitle}\n\n【章节内容】\n${trimmedText}\n\n请提取本章的状态变更：`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}

/**
 * 从 AI 输出中解析 StateDiffItem[]
 * 容错处理：尝试多种格式
 */
export function parseStateDiffs(raw: string): {
  diffs: Array<{
    entityName: string
    category: string
    field: string
    oldValue: string | null
    newValue: string
  }>
  error: string | null
} {
  const trimmed = raw.trim()

  // 去除可能的 markdown 代码块
  let jsonStr = trimmed
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim()
  }

  // 尝试找到 JSON 数组
  const arrStart = jsonStr.indexOf('[')
  const arrEnd = jsonStr.lastIndexOf(']')
  if (arrStart === -1 || arrEnd === -1 || arrEnd <= arrStart) {
    console.warn('[StateExtract] 未找到 JSON 数组:', jsonStr.slice(0, 200))
    return { diffs: [], error: '未能从 AI 输出中解析到 JSON 数组' }
  }

  jsonStr = jsonStr.slice(arrStart, arrEnd + 1)

  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) {
      console.error('[StateExtract] 解析结果不是数组:', typeof parsed)
      return { diffs: [], error: '解析结果不是数组' }
    }

    // 验证每个 item 的必要字段
    const validCategories = new Set(['character', 'location', 'item', 'faction', 'event'])
    const valid = parsed.filter((item: Record<string, unknown>) => {
      if (!item.entityName || !item.category || !item.field || item.newValue === undefined) {
        console.warn('[StateExtract] 跳过不完整的 diff item:', item)
        return false
      }
      if (!validCategories.has(item.category as string)) {
        console.warn('[StateExtract] 无效的 category:', item.category)
        return false
      }
      return true
    })

    console.log(`[StateExtract] 解析成功：${valid.length}/${parsed.length} 条有效`)
    return { diffs: valid, error: null }
  } catch (err) {
    console.error('[StateExtract] JSON 解析失败:', err, jsonStr.slice(0, 300))
    // 尝试修复截断的 JSON
    try {
      const repaired = jsonStr.slice(0, jsonStr.lastIndexOf('}') + 1) + ']'
      const parsed = JSON.parse(repaired)
      if (Array.isArray(parsed)) {
        console.log('[StateExtract] JSON 修复成功，解析到', parsed.length, '条')
        return { diffs: parsed, error: null }
      }
    } catch {
      // 修复也失败了
    }
    return { diffs: [], error: `JSON 解析失败：${(err as Error).message}` }
  }
}
