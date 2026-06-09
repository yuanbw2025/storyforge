/**
 * 故事进程年表 — Phase 25.5.2-a
 *
 * 下游提取产物：AI 从已写正文中提取剧情大事，按故事进程排列。
 * 与「历史年表（世界背景）」严格区分——这是正文里发生过的剧情。
 * 与「故事线（剧情结构起承转合）」区分——这是具体事件的时间轴。
 */

/** 事件重要度 */
export type StoryEventImportance = 1 | 2 | 3  // 1=次要 2=重要 3=关键

export const STORY_IMPORTANCE_LABELS: Record<number, string> = {
  1: '次要',
  2: '重要',
  3: '关键',
}

/** 一条故事进程事件 */
export interface StoryTimelineEvent {
  id?: number
  projectId: number
  /** 事件标题 */
  title: string
  /** 故事内时间（自由文本，如"开元三年春"、"穿越后第7天"） */
  storyTime?: string
  /** 重要度 1-3 */
  importance: number
  /** 事件描述 */
  description?: string
  /** 来源章节 ID */
  chapterId?: number | null
  /** 章节标题（冗余，便于展示） */
  chapterTitle?: string
  /** 排序（按章节进程） */
  order: number
  createdAt: number
}
