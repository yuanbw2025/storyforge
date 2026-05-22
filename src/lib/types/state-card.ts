/**
 * 状态表 — 跟踪角色/地点/物品/势力的当前状态
 * 每个实体一张状态卡，包含多个字段（key-value）
 * 章节完成后可 AI 自动提取变更 diff，用户审核后写入
 */

export type StateCategory = 'character' | 'location' | 'item' | 'faction' | 'event'

export const STATE_CATEGORY_LABELS: Record<StateCategory, string> = {
  character: '角色',
  location:  '地点',
  item:      '物品',
  faction:   '势力',
  event:     '事件',
}

/** 状态卡的单个字段 */
export interface StateField {
  key: string    // 如"位置"、"状态"、"持有物"
  value: string  // 如"长安"、"受伤"、"残破令牌"
}

/** 一张实体状态卡 */
export interface StateCard {
  id?: number
  projectId: number
  category: StateCategory
  entityName: string
  /** JSON 序列化的 StateField[]，DB 存储为字符串 */
  fields: string
  /** 最后修改此卡的章节 ID */
  lastChapterId?: number
  createdAt: number
  updatedAt: number
}

/** Diff 单条变更（不持久化，仅用于 UI 审核） */
export interface StateDiffItem {
  entityName: string
  category: StateCategory
  field: string
  oldValue: string | null
  newValue: string
}

// ── 工具函数 ──

/** 安全解析 StateCard.fields JSON */
export function parseFields(fieldsJson: string): StateField[] {
  try {
    const parsed = JSON.parse(fieldsJson)
    if (Array.isArray(parsed)) return parsed
    console.warn('[StateCard] fields 格式异常，预期数组:', fieldsJson)
    return []
  } catch (err) {
    console.error('[StateCard] parseFields JSON 解析失败:', err, fieldsJson)
    return []
  }
}

/** 将 StateField[] 序列化为 JSON 字符串 */
export function stringifyFields(fields: StateField[]): string {
  return JSON.stringify(fields)
}
