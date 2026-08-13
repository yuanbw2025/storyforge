/**
 * 物品栏提取适配器 — Phase 25.5.2-b
 * 从章节正文中提取各角色的物品获得/消耗事件。
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

/** HARNESS-63: durable extraction receives model-visible baselines only from
 * Context Gateway assemblies; discovered names are evidence from earlier
 * checkpointed calls in the same run. */
export function buildInventoryExtractPromptFromContext(
  chapterTitle: string,
  chapterText: string,
  itemLedgerContext: string,
  characterContext: string,
  discoveredItemNames: string[] = [],
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('inventory.extract')
  return renderPrompt(tpl, {
    chapterTitle,
    chapterText,
    knownItemNames: [
      itemLedgerContext || '【物品流水证据】\n无',
      discoveredItemNames.length ? `【本轮前置分块已发现】\n${discoveredItemNames.join('、')}` : '',
    ].filter(Boolean).join('\n\n'),
    characterNames: characterContext || '【角色档案】\n未提供',
  }).messages
}

export function readInventoryExtractPromptTemplateSnapshotV1() {
  const template = usePromptStore.getState().getActive('inventory.extract')
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

/** Strict durable protocol. Legacy callers keep the tolerant parser below
 * until their own migration unit removes it. */
export function parseInventoryEventsStrictV1(raw: string): ExtractedItemEvent[] {
  let source = raw.trim()
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fenced) source = fenced[1]
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('物品提取输出不是有效 JSON。')
  }
  if (!Array.isArray(parsed)) throw new Error('物品提取输出必须是 JSON 数组。')
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`物品候选 ${index + 1} 不是对象。`)
    }
    const row = value as Record<string, unknown>
    const keys = ['itemName', 'heldByName', 'action', 'quantity', 'note'] as const
    if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key as typeof keys[number]))) {
      throw new Error(`物品候选 ${index + 1} 字段不在允许闭集。`)
    }
    if (
      typeof row.itemName !== 'string' || !row.itemName.trim()
      || typeof row.heldByName !== 'string' || !row.heldByName.trim()
      || (row.action !== 'gain' && row.action !== 'consume')
      || !Number.isInteger(row.quantity) || (row.quantity as number) <= 0
      || typeof row.note !== 'string'
    ) throw new Error(`物品候选 ${index + 1} 字段类型或枚举无效。`)
    return {
      itemName: row.itemName.trim(),
      heldByName: row.heldByName.trim(),
      action: row.action,
      quantity: row.quantity as number,
      note: row.note.trim(),
    }
  })
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
