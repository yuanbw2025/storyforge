/** 大纲节点类型 */
export type OutlineNodeType =
  | 'volume'    // 卷
  | 'arc'       // 篇章
  | 'chapter'   // 章节

/** 大纲节点 */
export interface OutlineNode {
  id?: number
  projectId: number
  parentId: number | null    // null = 顶层
  type: OutlineNodeType
  title: string
  summary: string            // 情节摘要
  order: number              // 排序
  createdAt: number
  updatedAt: number
}

/** 章节状态 */
export type ChapterStatus =
  | 'outline'      // 仅有大纲
  | 'draft'        // 初稿
  | 'revised'      // 已修改
  | 'polished'     // 已润色
  | 'final'        // 定稿

/** 章节 */
export interface Chapter {
  id?: number
  projectId: number
  outlineNodeId: number      // 关联的大纲节点
  title: string
  content: string            // 正文内容
  wordCount: number
  status: ChapterStatus
  order: number
  notes: string              // 作者笔记
  createdAt: number
  updatedAt: number
}
