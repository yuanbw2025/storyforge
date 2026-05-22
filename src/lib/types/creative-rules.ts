/** 叙事视角 */
export type NarrativePOV =
  | 'first-person'         // 第一人称
  | 'third-limited'        // 第三人称有限
  | 'third-omniscient'     // 第三人称全知
  | 'multi-pov'            // 多视角

/** 创作规则约束 */
export interface CreativeRules {
  id?: number
  projectId: number
  writingStyle: string         // 写作风格描述
  narrativePOV: NarrativePOV   // 叙事视角
  toneAndMood: string          // 基调和氛围（旧字段；v3 重命名为 atmosphere，保留兼容）
  prohibitions: string         // 禁止事项（JSON string[]）
  consistencyRules: string     // 一致性规则（JSON string[]）
  specialRequirements: string  // 特殊创作要求
  referenceWorks: string       // 参考作品（旧：JSON string；v3 改为 ReferenceWork[] 存于 referenceWorksV2，迁移在 P5）

  // ── v3 §4.2 新字段 ───────────────────────────────────────────
  /** 基调和氛围（v3 命名，与 toneAndMood 同义；P5 迁移后弃用 toneAndMood） */
  atmosphere?: string
  /** 结构化参考作品列表（v3 取代 references 表 + 旧 referenceWorks 字符串） */
  referenceWorksV2?: import('./reference-work').ReferenceWork[]

  // ── Phase 20 —— 引用手法 ──────────────────────────────────────
  /** 选中的参考作品 ID 列表，其深度分析结果会注入 AI prompt 上下文 */
  citedReferenceIds?: string   // JSON number[]

  createdAt: number
  updatedAt: number
}
