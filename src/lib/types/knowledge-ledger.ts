/**
 * CONSISTENCY-2 · 角色认知事件账本。
 *
 * temporalFacts 记录作品世界中的 Canon 真相；本表记录角色在某章节时点的认知变化。
 * 两者分表，避免角色误认污染 currentFacts。
 */
export type KnowledgeAction = 'learn' | 'mislearn' | 'forget' | 'correct'
export type KnowledgeSourceType = 'chapter' | 'manual' | 'import'
export type KnowledgeEventStatus =
  | 'candidate'
  | 'confirmed'
  | 'rejected'
  | 'source-missing'
  | 'invalid-range'

export interface KnowledgeLedgerEntry {
  id?: number
  projectId: number
  workId?: number | null
  worldGroupId?: number | null

  /** 角色删除时置空但保留 characterName 和事件，避免静默丢记录。 */
  characterId?: number | null
  characterName: string

  /** 同一知识命题的稳定身份；AI 只能从作者确认的闭集 key 中选择。 */
  knowledgeKey: string
  /** 命题的 Canon 文本。 */
  statement: string
  /** 可选关联到 temporalFacts 中的权威事实。 */
  factId?: number | null

  action: KnowledgeAction
  /** mislearn 时角色实际相信的错误内容。 */
  belief?: string | null

  sourceType: KnowledgeSourceType
  sourceChapterId?: number | null
  sourceQuote?: string
  status: KnowledgeEventStatus

  createdAt: number
  updatedAt: number
}
