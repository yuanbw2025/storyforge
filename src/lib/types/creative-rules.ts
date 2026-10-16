/** 叙事视角 */
export type NarrativePOV =
  | 'first-person'         // 第一人称
  | 'third-limited'        // 第三人称有限
  | 'third-omniscient'     // 第三人称全知
  | 'multi-pov'            // 多视角

/** 作者确认的系统文写作意图；不是角色现状或已兑现奖励的第二份 Canon。 */
export interface SystemFictionElementsV1 {
  version: 1
  enabled: boolean
  protagonistIntent: string
  systemMechanism: string
  rewardGrowth: string
  limitsCosts: string
  oppositionRelations: string
}

/** 创作规则约束 */
export interface CreativeRules {
  id?: number
  projectId: number
  /** 当前数据由统一 Work owner 门盖章，旧类型调用可在保存前尚未携带。 */
  workId?: number
  writingStyle: string         // 写作风格描述
  narrativePOV: NarrativePOV   // 叙事视角
  atmosphere: string           // 基调和氛围
  prohibitions: string         // 禁止事项（JSON string[]）
  consistencyRules: string     // 一致性规则（JSON string[]）
  specialRequirements: string  // 特殊创作要求
  /** 缺失时沿用旧作品行为；停用保留草稿，不自动更换全局 Prompt。 */
  systemFictionElements?: SystemFictionElementsV1

  // ── Phase 20 —— 引用手法 ──────────────────────────────────────
  /** 选中的参考作品 ID 列表，其深度分析结果会注入 AI prompt 上下文 */
  citedReferenceIds?: string   // JSON number[]

  // ── Phase 19-d —— 大师洞察注入 ──────────────────────────────
  /** 选中的大师洞察 ID 列表，其方法论会注入 AI prompt 上下文 */
  citedInsightIds?: string     // JSON number[]

  createdAt: number
  updatedAt: number
}
