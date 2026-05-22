/**
 * 参考作品（ReferenceWork）— v3 §4.2 数据模型迁移
 *
 * 将作为 CreativeRules.referenceWorks 字段的元素类型，
 * 替代旧的独立 `references` 表（旧表 P5 改 panel 时迁移并删除）。
 */

/** 参考类型 */
export type ReferenceWorkType =
  | 'inspiration'    // 灵感来源（想模仿）
  | 'avoid'          // 反面案例（想避开）
  | 'style'          // 文风借鉴
  | 'world'          // 世界观借鉴
  | 'character'      // 角色塑造借鉴
  | 'plot'           // 情节借鉴

/** 参考作品 */
export interface ReferenceWork {
  /** UUID（前端生成） */
  refId: string
  title: string
  author: string
  type: ReferenceWorkType
  /** 想从这部作品借鉴/避开的具体点 */
  takeaway: string
  /** 链接（可选） */
  url?: string
  /** 用户备注 */
  note?: string
}
