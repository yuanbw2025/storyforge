import { FICTION_DIMENSIONS, FICTION_DIMENSION_LABELS } from './import-session-data'
import type { RagDocumentMetadata } from './rag-library'
export type { FictionDimension } from './import-session-data'
export { FICTION_DIMENSIONS, FICTION_DIMENSION_LABELS } from './import-session-data'

/** 参考书目类型 */
export type ReferenceType = 'story' | 'style' | 'historical'

/** 作品分析档位:浅层(快速摸底) / 深层(拆成模板) */
export type ReferenceAnalysisDepth = 'quick' | 'deep'

/** 深度分析状态 */
export type ReferenceAnalysisStatus = 'none' | 'pending' | 'analyzing' | 'done' | 'failed'

/** 作者对本次分析材料来源的声明。StoryForge 只记录声明，不代替版权核验。 */
export type ReferenceSourceKind =
  | 'own-work'
  | 'authorized'
  | 'public-domain'
  | 'research'
  | 'unknown'

/** 声明的使用范围；当前版本只消费 analysis-only / creative-reference 的方法论。 */
export type ReferenceUsageScope =
  | 'analysis-only'
  | 'creative-reference'
  | 'continuation-authorized'

export type ReferenceAnalysisRunStatus =
  | 'analyzing'
  | 'ready'
  | 'active'
  | 'superseded'
  | 'failed'
  | 'cancelled'

/** 参考书目条目 */
export interface Reference extends RagDocumentMetadata {
  id?: number
  projectId: number
  workId: number
  title: string        // 书名 / 文件名
  author: string       // 作者
  type: ReferenceType  // 故事参考 | 风格参考
  note: string         // 备注
  url: string          // 链接（可选）

  /** 从导入解析得到的结构化数据（项目参考模式） */
  importedData?: ImportedReferenceData

  // ── 作品分析字段（深层分析用） ──────────────
  /** 作品流派标签（如"玄幻"、"都市"） */
  genre?: string
  /** 原文总字数 */
  totalChars?: number
  /** 原文文件哈希（用于去重 / 关联 importFiles） */
  fileHash?: string
  /** 关联的 ImportSession id（复用导入流水线的原文存储） */
  importSessionId?: number
  /** 分析深度 */
  analysisDepth?: ReferenceAnalysisDepth
  /** 分析状态 */
  analysisStatus?: ReferenceAnalysisStatus
  /** 分析进度 0-100 */
  analysisProgress?: number
  /** 分析失败时的错误信息 */
  analysisError?: string | null
  /** Phase 28.3: AI 全书总结 JSON（各维度 100-200 字精炼总结） */
  analysisSummary?: string
  /** Phase 28.5: AI 聚合去重后的角色卡 JSON（AIMergedCharacter[]，替代正则抠名） */
  mergedCharacters?: string

  createdAt: number
  updatedAt: number
}

/** 导入到"项目参考"时保存的结构化数据 */
export interface ImportedReferenceData {
  /** 世界基础各维度 */
  worldview?: Record<string, string>
  /** 地理与历史保持独立语义分区，不混回世界基础字段。 */
  geography?: { overview?: string }
  history?: { overview?: string }
  /** 角色列表 */
  characters?: Array<Record<string, unknown>>
  /** 大纲结构 */
  outline?: Array<Record<string, unknown>>
  /** 写作技法分析 */
  writingTechniques?: import('./import-session-data').WritingTechniques
  /** Phase 35-c：保留待作者审查的词条候选，不会自动写入当前项目。 */
  codexCandidates?: import('./import-session-data').CodexImportCandidate[]
  /** 原始文件名 */
  sourceFilename?: string
  /** 导入时间 */
  importedAt?: number
}

export type CreateReferenceInput = Omit<Reference, 'id' | 'workId' | 'createdAt' | 'updatedAt'>

// ── 作品分析（13 个小说维度 + 题材自适应历史维度） ──

/**
 * 参考作品分块分析 —— 每块一行，13 维 + 历史维度。
 *
 * 维度设计理念：
 *   1. narrativeStructure  叙事架构 —— 视角、时间线、POV 切换
 *   2. openingTechnique    开篇与黄金三章 —— 钩子、角色引入、世界展示节奏
 *   3. plotRhythm          情节结构与节奏 —— 起承转合、高潮分布、张弛有度
 *   4. characterCraft      人物塑造 —— 多维人物、弧线、标签、动态变化
 *   5. conflictEscalation  冲突与升级 —— 外在/内在冲突链、压力曲线
 *   6. foreshadowing       伏笔与悬念 —— 埋设/回收、悬念管理、读者预期操控
 *   7. proseAndDialogue    文笔与对话 —— 修辞、句式、对话个性化、叙述密度
 *   8. worldBuilding       世界观构建 —— 设定融入、规则展示、沉浸感营造
 */
export interface ReferenceChunkAnalysis {
  id?: number
  projectId?: number
  workId?: number | null
  /** 关联的 Reference id */
  referenceId: number
  /** 所属分析版本。 */
  analysisRunId: number
  /** 块序号（0-based） */
  chunkIndex: number
  /** 本块标签（如"第 X 章"或"3/48 块"） */
  label?: string
  /** 原文字符偏移 */
  startOffset?: number
  endOffset?: number

  // ── 13 个小说维度（每个维度一段 Markdown 文字；key 与 WritingTechniques 统一） ──
  /** 叙事视角与手法 */
  narrativeStyle?: string
  /** 开篇技法 / 黄金三章 */
  openingTechnique?: string
  /** 情节结构与套路 */
  plotStructure?: string
  /** 节奏控制 */
  pacingControl?: string
  /** 高潮设计 */
  climaxDesign?: string
  /** 冲突设计与升级 */
  conflictEscalation?: string
  /** 人物塑造 */
  characterCraft?: string
  /** 对话技巧 */
  dialogueTechnique?: string
  /** 文笔风格 */
  proseStyle?: string
  /** 爽点 / 情绪节拍 */
  emotionalBeats?: string
  /** 伏笔与回收 */
  foreshadowing?: string
  /** 世界观构建 */
  worldBuilding?: string
  /** 其他值得学习的技巧 */
  otherTechniques?: string

  // ── 历史考证维度（PHASE-H3 历史资料专属；仅 type==='historical' 分析/展示） ──
  /** 历史背景与时代特征：时代大势、历史转折点、政治气候 */
  historicalContext?: string
  /** 社会制度与等级：官制、科举、法律、阶层划分、社会流动性 */
  socialInstitutions?: string
  /** 日常生活细节：衣食住行、岁时节日、娱乐消遣、民间信仰 */
  dailyLife?: string
  /** 物质文化：器物、工具、建筑、科技水平、生产工艺 */
  materialCulture?: string
  /** 语言习惯与称谓：时代特色词汇、避讳、人际称谓、书面/口语风格 */
  languageCustoms?: string

  /** 本块引用的精彩片段（~200 字） */
  rawExcerpt?: string

  createdAt: number
}

/**
 * IDEA-1 参考资料分析版本。
 *
 * 新分析先写入独立 run，只有作者激活后才会进入引用手法上下文。来源声明绑定
 * fileHash + version，不会因后来重新上传而改写旧版本的语义。
 */
export interface ReferenceAnalysisRun {
  id?: number
  projectId: number
  workId: number
  referenceId: number
  version: number
  status: ReferenceAnalysisRunStatus
  depth: ReferenceAnalysisDepth
  sourceFilename: string
  fileHash: string
  totalChars: number
  sourceKind: ReferenceSourceKind
  usageScope: ReferenceUsageScope
  rightsNote: string
  /** 是否由作者在 UI 中显式确认。 */
  rightsConfirmed: boolean
  rightsDeclaredAt: number
  expectedChunks: number
  completedChunks: number
  progress: number
  error?: string | null
  analysisSummary?: string
  mergedCharacters?: string
  completedAt?: number
  activatedAt?: number
  createdAt: number
  updatedAt: number
}

/** 本地断点续跑用原文，不随项目 JSON 导出。 */
export interface ReferenceAnalysisSource {
  /** 与 ReferenceAnalysisRun.id 相同，作为主键。 */
  analysisRunId: number
  projectId: number
  workId: number
  filename: string
  fileHash: string
  chunks: Array<{
    index: number
    startChar: number
    endChar: number
    charCount: number
    label?: string
    text: string
  }>
  createdAt: number
}

/** 5 个历史考证维度（仅历史题材参考分析/展示） */
export const HISTORY_DIMENSIONS = [
  'historicalContext',
  'socialInstitutions',
  'dailyLife',
  'materialCulture',
  'languageCustoms',
] as const

export type HistoryDimension = (typeof HISTORY_DIMENSIONS)[number]

/**
 * 全部分析维度键名 = 13 小说维度 + 5 历史维度（用于遍历）。
 * 小说题材只用前 13;历史题材两段都用。
 */
export const ANALYSIS_DIMENSIONS = [
  ...FICTION_DIMENSIONS,
  ...HISTORY_DIMENSIONS,
] as const

export type AnalysisDimension = (typeof ANALYSIS_DIMENSIONS)[number]

/** 维度中文标签（13 小说 + 5 历史） */
export const DIMENSION_LABELS: Record<AnalysisDimension, string> = {
  ...FICTION_DIMENSION_LABELS,
  historicalContext: '历史背景与时代特征',
  socialInstitutions: '社会制度与等级',
  dailyLife: '日常生活细节',
  materialCulture: '物质文化（器物/科技）',
  languageCustoms: '语言习惯与称谓',
}
