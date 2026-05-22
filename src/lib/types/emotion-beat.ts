/**
 * 章节情感节拍卡 — 在写章节前规划情感走向
 * 包括：场景目标、情感弧线、读者感受、角色成长
 */

/** 单条节拍 */
export interface EmotionBeat {
  /** 节拍名（如"开场"、"转折"、"高潮"） */
  label: string
  /** 场景目标：这个节拍要完成什么叙事任务 */
  sceneGoal: string
  /** 情感基调（如"紧张"、"温馨"、"悲伤"） */
  emotionTone: string
  /** 期望的读者感受 */
  readerFeeling: string
  /** 角色变化/成长 */
  characterGrowth: string
}

/** 一章的情感节拍卡 */
export interface EmotionBeatCard {
  id?: number
  projectId: number
  chapterId: number
  /** 章节标题（冗余，方便展示） */
  chapterTitle: string
  /** 整章情感概览 */
  overallArc: string
  /** 节拍列表 */
  beats: EmotionBeat[]
  /** 创建方式：ai / manual */
  source: 'ai' | 'manual'
  createdAt: number
  updatedAt: number
}

/** 安全解析 beats JSON */
export function parseBeats(json: string): EmotionBeat[] {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed
    console.warn('[EmotionBeat] beats 格式异常:', json)
    return []
  } catch (err) {
    console.error('[EmotionBeat] parseBeats 失败:', err)
    return []
  }
}

/** 序列化 beats */
export function stringifyBeats(beats: EmotionBeat[]): string {
  return JSON.stringify(beats)
}
