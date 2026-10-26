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

/** Invalid data stays in storage until the author explicitly repairs it. */
export class StateFieldsParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateFieldsParseError'
  }
}

function assertStateFields(value: unknown): asserts value is StateField[] {
  if (!Array.isArray(value)) throw new StateFieldsParseError('状态字段必须是字段列表。')
  value.forEach((field, index) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new StateFieldsParseError(`状态字段第${index + 1}项需要包含字段名和文本值。`)
    }
    if (typeof field.key !== 'string' || typeof field.value !== 'string') {
      throw new StateFieldsParseError(`状态字段第${index + 1}项的字段名和字段值必须是文本。`)
    }
  })
}

/** Strict reader: never convert malformed records into an apparently empty list. */
export function parseFields(fieldsJson: unknown): StateField[] {
  if (typeof fieldsJson !== 'string') throw new StateFieldsParseError('状态字段必须是 JSON 文本。')
  let parsed: unknown
  try { parsed = JSON.parse(fieldsJson) }
  catch { throw new StateFieldsParseError('状态字段不是有效 JSON，请修正后保存。') }
  assertStateFields(parsed)
  return parsed
}

/** Registry write validation also accepts the structured array before JSON storage. */
export function validateStateFields(value: unknown): void {
  if (typeof value === 'string') parseFields(value)
  else assertStateFields(value)
}

/** UI inspection is explicit about corruption; failure never means an empty card. */
export function inspectStateFields(value: unknown):
  | { ok: true; fields: StateField[] }
  | { ok: false; error: string } {
  try { return { ok: true, fields: parseFields(value) } }
  catch (error) {
    if (!(error instanceof StateFieldsParseError)) throw error
    return { ok: false, error: error.message }
  }
}

/** Add identity to recoverable context failures without logging field contents. */
export function readStateCardFields(card: { entityName?: unknown; fields?: unknown }): StateField[] {
  try { return parseFields(card.fields) }
  catch (error) {
    if (!(error instanceof StateFieldsParseError)) throw error
    const name = typeof card.entityName === 'string' ? card.entityName : '未命名'
    throw new StateFieldsParseError(`状态卡「${name}」：${error.message} 请到“状态与物品”修复，原始记录已保留。`)
  }
}

/** 将 StateField[] 序列化为 JSON 字符串 */
export function stringifyFields(fields: StateField[]): string {
  return JSON.stringify(fields)
}
