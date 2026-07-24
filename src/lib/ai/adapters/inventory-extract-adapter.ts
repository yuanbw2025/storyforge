/**
 * 物品栏提取适配器 — Phase 25.5.2-b
 * 从章节正文中提取主角的物品获得/消耗事件。
 */
import type { ChatMessage, ItemLedgerAction } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

export interface ExtractedItemEvent {
  itemName: string
  heldByName: string
  action: ItemLedgerAction
  quantity: number
  note: string
}

/** 构建提取 prompt（调用方负责分块，禁止静默截断长章） */
export function buildInventoryExtractPrompt(
  chapterTitle: string,
  chapterText: string,
  knownItemNames: string[] = [],
  characterNames: string[] = [],
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('inventory.extract')
  const { messages } = renderPrompt(tpl, {
    chapterTitle,
    chapterText,
    knownItemNames: knownItemNames.join('、') || '无',
    characterNames: characterNames.join('、') || '未提供',
  })
  return messages
}

/** 解析 AI 输出为物品事件数组 */
export function parseInventoryEvents(raw: string): ExtractedItemEvent[] {
  const trimmed = raw.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  let jsonStr = fence ? fence[1].trim() : trimmed
  // 容错：截取第一个 [ 到最后一个 ]
  const start = jsonStr.indexOf('[')
  const end = jsonStr.lastIndexOf(']')
  if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1)
  try {
    const arr = JSON.parse(jsonStr)
    if (!Array.isArray(arr)) return []
    return arr
      .map((e: Record<string, unknown>): ExtractedItemEvent => ({
        itemName: String(e.itemName || '').trim(),
        heldByName: String(e.heldByName || '').trim(),
        action: e.action === 'consume' ? 'consume' : 'gain',
        quantity: Math.max(1, Math.round(Number(e.quantity) || 1)),
        note: String(e.note || '').trim(),
      }))
      .filter(e => e.itemName && e.heldByName)
  } catch {
    return []
  }
}
