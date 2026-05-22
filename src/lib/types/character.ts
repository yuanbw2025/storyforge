/** 角色定位（v3 §2.1 — 扩展 npc / extra 两类） */
export type CharacterRole =
  | 'protagonist'    // 主角
  | 'antagonist'     // 反派
  | 'supporting'     // 重要配角
  | 'minor'          // 次要角色
  | 'npc'            // NPC（紧凑列表展示）
  | 'extra'          // 路人（表格行：姓名/出场时间/章节/作用/结局）

/** 阵营 */
export type CharacterAlignment = 'good' | 'evil'

/** 角色 */
export interface Character {
  id?: number
  projectId: number
  name: string
  role: CharacterRole
  /** 阵营：正派/反派 */
  alignment?: CharacterAlignment
  shortDescription: string   // 一句话简介
  appearance: string         // 外貌
  personality: string        // 性格
  background: string         // 背景故事
  motivation: string         // 动机
  abilities: string          // 能力
  relationships: string      // 关系描述（JSON string）
  arc: string                // 角色弧光/成长线

  // ── v3 §2.1 新字段：路人卡片用 ───────────────────────────────
  /** 常驻地点 / 起始地点 */
  location?: string
  /** 首次出场（章节号或自由文本） */
  firstAppearance?: string
  /** 在故事中扮演的角色作用（v3 §2.1 表格行字段） */
  storyRole?: string
  /** 结局走向 */
  ending?: string

  createdAt: number
  updatedAt: number
}

/** 势力 */
export interface Faction {
  id?: number
  projectId: number
  name: string
  description: string
  leader: string             // 领导者
  members: string            // 核心成员
  goals: string              // 目标
  resources: string          // 资源/实力
  relationships: string      // 与其他势力关系
  createdAt: number
  updatedAt: number
}
