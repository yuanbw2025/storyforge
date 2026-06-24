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
  summary: string            // 情节摘要（不变量：写入/导入边界保证恒为 string，绝不 undefined）
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

export interface ChapterContinuityHandoff {
  chapterId: number
  sourceTextHash: string
  schemaVersion: number
  extractorVersion: string
  textNormalizationVersion: string
  finalScene: {
    location?: string
    storyTime?: string
    activeCharacters: string[]
    lastAction?: string
  }
  stateChanges: string[]
  knowledgeChanges: string[]
  commitments: string[]
  openLoops: string[]
  immediateNextIntent?: string
  evidenceQuotes: Array<{
    quote: string
    startOffset: number
    endOffset: number
  }>
  generatedAt: number
}

export interface ChapterPlanReconciliationItem {
  text: string
  evidenceQuotes: ChapterContinuityHandoff['evidenceQuotes']
}

export interface ChapterPlanReconciliation {
  chapterId: number
  sourceTextHash: string
  planSourceHash: string
  schemaVersion: number
  extractorVersion: string
  textNormalizationVersion: string
  completedGoals: ChapterPlanReconciliationItem[]
  unfinishedGoals: ChapterPlanReconciliationItem[]
  deviations: ChapterPlanReconciliationItem[]
  newConstraints: ChapterPlanReconciliationItem[]
  nextChapterImpacts: ChapterPlanReconciliationItem[]
  proposedOutlineSummary?: string
  reviewStatus: 'pending' | 'confirmed-constraint' | 'applied-outline' | 'dismissed'
  confirmedActualProgress?: string
  reviewedAt?: number
  generatedAt: number
}

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
  /** NS-1: 下一章直接承接所需的派生记忆；非 Canon。 */
  continuityHandoff?: ChapterContinuityHandoff
  /** NS-1: summary 生成时对应的标准化正文 SHA-256。旧摘要无此字段即 unverified。 */
  summarySourceTextHash?: string
  /** NS-1: summary hash 所用的正文标准化算法版本。 */
  summaryTextNormalizationVersion?: string
  /** NS-2: 原计划 vs 实际正文的证据化派生对账；非 Canon。 */
  planReconciliation?: ChapterPlanReconciliation
  createdAt: number
  updatedAt: number
}
