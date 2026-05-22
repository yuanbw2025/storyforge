/**
 * 作品学习系统（Master Studies）类型定义
 * —— Phase 19-a 地基层
 *
 * 与创作数据物理隔离：这些表独立存，
 * 通过 `projectId` 可选绑定到某项目（null = 全局学习库）。
 *
 * 设计原则（Phase 19 Playbook §2）：
 *   · 用户必须同意法律声明才能进入，声明存 localStorage['sf-master-consent']
 *   · 学习库与创作 19 张表物理隔离，互不污染
 *   · 分析结果必须保留，可整包导出（P19-b 做 ZIP）
 *   · 分析深度分档 quick / standard / deep
 */

/** 分析深度 —— 控制分块大小、AI 调用次数、报告详尽程度 */
export type MasterAnalysisDepth = 'quick' | 'standard' | 'deep'

/** 作品整体分析状态 */
export type MasterWorkStatus = 'pending' | 'analyzing' | 'done' | 'failed'

/**
 * 作品元数据 —— 每本小说一行。
 *
 * `importSessionId` / `fileHash` 用来与 Phase 18 导入流水线衔接，
 * 原文本存在 `importFiles` 表里，跟着 session 走。
 */
export interface MasterWork {
  id?: number
  /** 可选：绑定到某个项目（null = 全局学习库） */
  projectId?: number | null
  title: string
  author?: string
  genre?: string
  totalChars: number
  analysisDepth: MasterAnalysisDepth
  status: MasterWorkStatus
  /** 关联的 ImportSession id（复用 Phase 18 pipeline） */
  importSessionId?: number
  /** 关联的 ImportFileBlob（原文本） */
  fileHash?: string
  /** 完成度百分比（0-100） */
  progress: number
  /** 失败时记一下出错原因，方便 UI 展示 */
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

/** 单块的五维分析（Layer 1 产出，每块一行） */
export interface MasterChunkAnalysis {
  id?: number
  workId: number
  chunkIndex: number
  /** 本块原文 label（如"第 X 章"或"1/48 块"） */
  label?: string
  /** 原文字符偏移区间（用于报告时回看原文） */
  startOffset?: number
  endOffset?: number

  worldviewPattern?: string   // 世界观范式
  characterDesign?: string    // 角色设计手法
  plotRhythm?: string         // 情节节奏规律
  foreshadowing?: string      // 伏笔与悬念
  proseStyle?: string         // 文笔与语言
  rawExcerpt?: string         // 本块引用片段（~200 字）

  createdAt: number
}

/** 章节节奏点类型（Layer 2 产出） */
export type BeatType =
  | 'opening'      // 开场
  | 'conflict'     // 冲突点
  | 'reversal'     // 反转
  | 'climax'       // 爽点 / 高潮
  | 'hook'         // 章末钩子
  | 'foreshadow'   // 伏笔埋设
  | 'relief'       // 松弛 / 调剂

/** 章节节奏点 —— 一章可有多条 */
export interface MasterChapterBeat {
  id?: number
  workId: number
  chapterIndex: number         // 0-based
  chapterLabel?: string
  /** 本节奏点在章节中的相对位置（0-100） */
  position: number
  type: BeatType
  excerpt: string              // 引用原文片段（<100 字）
  note?: string                // AI 点评
}

/** 文体特征 —— 每本作品一行（Layer 2 产出） */
export interface MasterStyleMetrics {
  id?: number
  workId: number
  /** 平均句长（字） */
  avgSentenceLength: number
  /** 句长直方图桶（key = '0-5'/'5-10'/'10-15'/'15-20'/'20-30'/'30+'，value = 条数） */
  sentenceLengthHistogram: Record<string, number>
  /** 对话占比（0-1） */
  dialogRatio: number
  /** 高频词 top 50（去停用词） */
  topWords: { word: string; count: number }[]
  /** 段落密度（每千字段数） */
  paragraphDensity: number
  /** 描写性文字 vs 动作描写占比（AI 估计，0-1） */
  descriptionRatio?: number
  computedAt: number
}

/**
 * 跨作品归纳洞察（Layer 3 产出） —— 可复用到创作 prompt 上下文。
 *
 * 例如："猫腻式插叙节奏法则"、"爽文开场三板斧"。
 */
export interface MasterInsight {
  id?: number
  title: string                // 洞察标题
  genre?: string               // 适用流派
  description: string          // 长说明（Markdown）
  bulletPoints: string[]       // 3-5 条可操作要点
  sourceWorkIds: number[]      // 参考了哪些作品
  createdAt: number
  updatedAt: number
}
