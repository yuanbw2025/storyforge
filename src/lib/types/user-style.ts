/**
 * 自适应文风学习(FB-5 · 段一)
 *
 * 每个项目一份「文风画像」:由 AI 从用户已定稿/润色的章节里总结出用词、句式、
 * 节奏、对话、描写等习惯,作为下游章节生成的上下文源之一。画像可被用户手改。
 *
 * 表生命周期登记在 PROJECT_TABLES(userStyleProfiles);读取走 CONTEXT_SOURCES
 * (userStyleProfile);AI 生成经 prose.style-learn durable Run 确认后采纳。
 */

export interface StyleRevisionPair {
  id: string
  sourceChapterId?: number | null
  chapterTitle: string
  beforeText: string
  afterText: string
  authorNote?: string
  capturedAt: number
}

export type StyleCalibrationVerdict = 'closer' | 'needs-adjustment'

export interface StyleCalibrationFeedback {
  id: string
  verdict: StyleCalibrationVerdict
  note: string
  sourceExcerpt: string
  resultExcerpt: string
  createdAt: number
}

/** 文风画像（每个 Work 单例）。 */
export interface UserStyleProfile {
  id?: number
  projectId: number
  worldId: number
  workId: number
  /** AI 生成的文风画像(markdown 文本,给人看 + 给 AI 读;用户可手改) */
  profile: string
  /** 是否注入下游章节生成(关闭则不进上下文) */
  enabled: boolean
  /** 本次学习采样的章节 id 列表(JSON 字符串,透明留痕) */
  sourceChapterIds: string
  /** 采样章节数 */
  sampleCount: number
  /** 采样总字数 */
  sampleWords: number
  /** FB-5 高级校准：有界改前/改后样本 StyleRevisionPair[] */
  revisionPairs?: string
  /** FB-5 高级校准：互动校准反馈 StyleCalibrationFeedback[] */
  calibrationFeedback?: string
  createdAt: number
  updatedAt: number
}
