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
  toneAndMood: string          // 基调和氛围
  prohibitions: string         // 禁止事项（JSON string[]）
  consistencyRules: string     // 一致性规则（JSON string[]）
  specialRequirements: string  // 特殊创作要求
  referenceWorks: string       // 参考作品（JSON string[]）
  createdAt: number
  updatedAt: number
}
