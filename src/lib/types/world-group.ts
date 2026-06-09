/**
 * Phase 25.4 — 多世界系统类型定义
 */

/** 世界组类型 */
export type WorldGroupType =
  | 'primary'      // 主世界（每项目有且仅有一个）
  | 'traversal'    // 穿越目标（诸天流）
  | 'instance'     // 副本世界（无限流）
  | 'parallel'     // 平行世界
  | 'ascension'    // 上界/高维（修仙多界）
  | 'custom'       // 自定义

/** 世界组 — 一组独立的世界观设定 */
export interface WorldGroup {
  id?: number
  projectId: number
  /** 世界组名称（如"斗破世界"、"遮天世界"） */
  name: string
  /** 世界组描述 */
  description: string
  /** 世界组类型 */
  type: WorldGroupType
  /** 图标 emoji */
  icon?: string
  /** 封面色（hex，用于 UI 区分） */
  color?: string
  /** 排序（穿越顺序 / 副本编号） */
  order: number

  // ── 穿越/进入条件 ──
  /** 进入条件描述 */
  entryCondition?: string
  /** 离开条件描述 */
  exitCondition?: string
  /** 在此世界的预计章节数 */
  plannedChapterCount?: number

  // ── 能力继承规则 ──
  /** 主角进入此世界时的能力限制规则 */
  powerRestriction?: string
  /** 从此世界可带走的能力/物品 */
  takeawayRules?: string

  createdAt: number
  updatedAt: number
}

/** 世界组间关系类型 */
export type WorldGroupLinkType =
  | 'portal'       // 传送门/通道
  | 'ascension'    // 飞升/晋升通道
  | 'summon'       // 召唤/拉入
  | 'branch'       // 分支点（平行世界分叉）
  | 'return'       // 回归通道
  | 'custom'       // 自定义

/** 世界组之间的关联关系 */
export interface WorldGroupLink {
  id?: number
  projectId: number
  /** 源世界组 ID */
  fromGroupId: number
  /** 目标世界组 ID */
  toGroupId: number
  /** 关系类型 */
  linkType: WorldGroupLinkType
  /** 通道/传送门名称 */
  name?: string
  /** 关系描述 */
  description?: string
  /** 是否双向 */
  bidirectional: boolean
  createdAt: number
}

/** 世界组类型标签 */
export const WORLD_GROUP_TYPE_LABELS: Record<WorldGroupType, string> = {
  primary: '主世界',
  traversal: '穿越目标',
  instance: '副本世界',
  parallel: '平行世界',
  ascension: '上界/高维',
  custom: '自定义',
}

/** 世界关系类型标签 */
export const WORLD_LINK_TYPE_LABELS: Record<WorldGroupLinkType, string> = {
  portal: '传送门',
  ascension: '飞升通道',
  summon: '召唤',
  branch: '分支点',
  return: '回归通道',
  custom: '自定义',
}
