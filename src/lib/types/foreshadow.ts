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
  createdAt: number
  updatedAt: number
}
