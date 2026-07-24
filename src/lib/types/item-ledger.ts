/**
 * 物品流水（游戏包裹式物品栏）— Phase 25.5.2-b
 *
 * 下游提取产物：AI 从已写正文中提取主角的物品获得/消耗事件，
 * 聚合为"当前持有数量 + 获得/消耗历程"，像游戏包裹一样。
 *
 * 设计为项目级（不按世界组）：诸天流中主角携带物品跨世界，
 * 物品栏反映的是主角的随身状态，而非某个世界的设定。
 */

/** 物品流水动作 */
export type ItemLedgerAction = 'gain' | 'consume'

export const ITEM_LEDGER_ACTION_LABELS: Record<ItemLedgerAction, string> = {
  gain: '获得',
  consume: '消耗',
}

/** 一条物品流水记录 */
export interface ItemLedgerEntry {
  id?: number
  projectId: number
  /** 物品名称（聚合键） */
  itemName: string
  /** 动作：获得 / 消耗 */
  action: ItemLedgerAction
  /** 数量（正数，符号由 action 决定） */
  quantity: number
  /** 持有人名称（AI 抽取的原文持有者，必填） */
  heldByName: string
  /** 关联角色 ID（能匹配到已知角色则链，否则 null） */
  characterId?: number | null
  /** 关联章节 ID（来源） */
  chapterId?: number | null
  /** 章节标题（冗余存储，便于展示） */
  chapterTitle?: string
  /** 备注：来源 / 用途说明 */
  note?: string
  createdAt: number
}

/** 聚合后的单个物品（用于物品栏展示） */
export interface InventoryItem {
  itemName: string
  /** 当前持有数量 = 获得总和 - 消耗总和 */
  quantity: number
  /** 持有人名称 */
  heldByName: string
  /** 关联角色 ID */
  characterId?: number | null
  /** 该物品的全部流水（按时间/章节排序） */
  entries: ItemLedgerEntry[]
}

/** 把流水聚合为物品栏 */
export function aggregateInventory(entries: ItemLedgerEntry[], characterId?: number | null): InventoryItem[] {
  const filtered = characterId != null
    ? entries.filter(e => (e.characterId ?? null) === (characterId ?? null))
    : entries
  const map = new Map<string, ItemLedgerEntry[]>()
  for (const e of filtered) {
    const key = e.itemName.trim()
    if (!key) continue
    const list = map.get(key) || []
    list.push(e)
    map.set(key, list)
  }
  const result: InventoryItem[] = []
  for (const [itemName, list] of map) {
    const sorted = [...list].sort((a, b) => {
      // 优先按章节，其次按创建时间
      const ca = a.chapterId ?? 0, cb = b.chapterId ?? 0
      if (ca !== cb) return ca - cb
      return a.createdAt - b.createdAt
    })
    const quantity = sorted.reduce((sum, e) => sum + (e.action === 'gain' ? e.quantity : -e.quantity), 0)
    // 取最近一条的持有人作为聚合显示
    const last = sorted[sorted.length - 1]
    result.push({
      itemName,
      quantity,
      heldByName: last.heldByName ?? '',
      characterId: last.characterId ?? null,
      entries: sorted,
    })
  }
  // 当前持有量降序，持有为 0/负的排后面
  return result.sort((a, b) => b.quantity - a.quantity)
}
