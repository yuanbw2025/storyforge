/** 伏笔状态 */
export type ForeshadowStatus =
  | 'planned'     // 计划中
  | 'planted'     // 已埋设
  | 'echoed'      // 已呼应
  | 'resolved'    // 已回收

/** 伏笔类型 */
export type ForeshadowType =
  | 'chekhov'       // 契诃夫之枪
  | 'prophecy'      // 预言暗示
  | 'symbol'        // 象征伏笔
  | 'character'     // 角色伏笔
  | 'dialogue'      // 对话伏笔
  | 'environment'   // 环境伏笔
  | 'timeline'      // 时间线伏笔
  | 'red-herring'   // 红鲱鱼（误导）
  | 'parallel'      // 平行伏笔
  | 'callback'      // 回调伏笔

/** 伏笔 */
export interface Foreshadow {
  id?: number
  projectId: number
  name: string               // 伏笔名称
  type: ForeshadowType
  status: ForeshadowStatus
  description: string        // 伏笔描述
  plantChapterId: number | null    // 埋设章节
  echoChapterIds: string           // 呼应章节（JSON array string）
  resolveChapterId: number | null  // 回收章节
  notes: string              // 备注

  // ── v3 §4.2 新字段：用于时间线视图 ─────────────────────────────
  /** 时间线位置：相对于全文的归一化进度（0-1），由前端按埋设/呼应/回收章节自动算 */
  timelinePosition?: number

  createdAt: number
  updatedAt: number
}
