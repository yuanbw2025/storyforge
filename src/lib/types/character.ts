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

  // ── Phase G2 新字段 ──
  /** 首次出场章节 ID */
  firstAppearChapterId?: number | null
  /** 活跃章节范围描述（如 "1-30, 45-60"） */
  activeChapterRange?: string
  /** 退场/死亡章节 ID */
  exitChapterId?: number | null

  // ── Phase 25.4 多世界 ──
  /** 角色原属世界组 ID（null = 主角/跨世界角色） */
  homeWorldGroupId?: number | null
  /** 是否跨世界角色（主角、系统精灵等，在所有世界中可见） */
  isCrossWorld?: boolean

  createdAt: number
  updatedAt: number
}

// （Faction 接口已随 C2 / DB v29 删除：势力并入「势力」词条。）
