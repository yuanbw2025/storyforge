/** 大纲节点类型 */
export type OutlineNodeType =
  | 'volume'      // 卷
  | 'arc'         // 篇章
  | 'storyBlock'  // 故事块（起承转合/三幕式等）
  | 'chapter'     // 章节

/** 故事结构模板 */
export type StoryStructure = 'three-act' | 'kishotenketsu' | 'jo-ha-kyu' | 'custom'

/** 内置故事结构定义 */
export const STORY_STRUCTURES: Record<StoryStructure, { label: string; blocks: string[] }> = {
  'three-act':      { label: '三幕式',     blocks: ['第一幕：铺垫', '第二幕：对抗', '第三幕：解决'] },
  'kishotenketsu':  { label: '起承转合',   blocks: ['起：引入', '承：发展', '转：转折', '合：收束'] },
  'jo-ha-kyu':      { label: '序破急',     blocks: ['序：缓起', '破：展开', '急：高潮'] },
  'custom':         { label: '自定义',     blocks: [] },
}

/** 大纲节点 */
export interface OutlineNode {
  id?: number
  projectId: number
  parentId: number | null    // null = 顶层
  type: OutlineNodeType
  title: string
  summary: string            // 情节摘要
  order: number              // 排序
  /** 此卷/篇章发生在哪个世界组（Phase 25.4，null = 默认主世界） */
  worldGroupId?: number | null
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
  /** Phase A3: 章节摘要（100-200字），用于三层记忆的 Working Memory */
  summary?: string
  createdAt: number
  updatedAt: number
}
