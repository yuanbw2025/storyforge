/** 参考书目类型 */
export type ReferenceType = 'story' | 'style' | 'historical'

/** 深度分析深度档位 */
export type ReferenceAnalysisDepth = 'quick' | 'standard' | 'deep'

/** 深度分析状态 */
export type ReferenceAnalysisStatus = 'none' | 'pending' | 'analyzing' | 'done' | 'failed'

/** 参考书目条目 */
export interface Reference {
  id?: number
  projectId: number
  title: string        // 书名 / 文件名
  author: string       // 作者
  type: ReferenceType  // 故事参考 | 风格参考
  note: string         // 备注
  url: string          // 链接（可选）

  /** 从导入解析得到的结构化数据（项目参考模式） */
  importedData?: ImportedReferenceData

  // ── 深度分析字段（整合自 MasterWork） ──────────────
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
  analysisError?: string

  createdAt: number
  updatedAt: number
}

/** 导入到"项目参考"时保存的结构化数据 */
export interface ImportedReferenceData {
  /** 世界观各维度 */
  worldview?: Record<string, string>
  /** 角色列表 */
  characters?: Array<Record<string, unknown>>
  /** 大纲结构 */
  outline?: Array<Record<string, unknown>>
  /** 写作技法分析 */
  writingTechniques?: import('./import-session-data').WritingTechniques
  /** 原始文件名 */
  sourceFilename?: string
  /** 导入时间 */
  importedAt?: number
}

export type CreateReferenceInput = Omit<Reference, 'id' | 'createdAt' | 'updatedAt'>

// ── 八维深度分析（整合原 MasterChunkAnalysis 5 维 + WritingTechniques 12 维） ──

/**
 * 参考作品分块分析 —— 每块一行，8 个维度。
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
  /** 关联的 Reference id */
  referenceId: number
  /** 块序号（0-based） */
  chunkIndex: number
  /** 本块标签（如"第 X 章"或"3/48 块"） */
  label?: string
  /** 原文字符偏移 */
  startOffset?: number
  endOffset?: number

  // ── 八维分析内容（每个维度一段 Markdown 文字） ──
  /** 叙事架构：视角选择、时间线编排、POV 切换技巧 */
  narrativeStructure?: string
  /** 开篇与黄金三章：钩子设计、角色引入、世界展示节奏 */
  openingTechnique?: string
  /** 情节结构与节奏：起承转合、高潮分布、爽点设计、节奏曲线 */
  plotRhythm?: string
  /** 人物塑造：多维人物刻画、弧线设计、标签化、动态变化 */
  characterCraft?: string
  /** 冲突与升级：外在/内在冲突链、压力曲线、升级节奏 */
  conflictEscalation?: string
  /** 伏笔与悬念：伏笔埋设与回收、悬念管理、读者预期操控 */
  foreshadowing?: string
  /** 文笔与对话：修辞手法、句式变化、对话个性化、叙述密度 */
  proseAndDialogue?: string
  /** 世界观构建：设定融入叙事、规则展示、沉浸感营造 */
  worldBuilding?: string

  // ── 历史考证维度（PHASE-H3 历史资料专属） ──
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
 * 十三维分析维度键名列表，用于遍历
 */
export const ANALYSIS_DIMENSIONS = [
  'narrativeStructure',
  'openingTechnique',
  'plotRhythm',
  'characterCraft',
  'conflictEscalation',
  'foreshadowing',
  'proseAndDialogue',
  'worldBuilding',
  // 历史维度
  'historicalContext',
  'socialInstitutions',
  'dailyLife',
  'materialCulture',
  'languageCustoms',
] as const

export type AnalysisDimension = (typeof ANALYSIS_DIMENSIONS)[number]

/** 十三维维度中文标签 */
export const DIMENSION_LABELS: Record<AnalysisDimension, string> = {
  narrativeStructure: '叙事架构',
  openingTechnique: '开篇与黄金三章',
  plotRhythm: '情节结构与节奏',
  characterCraft: '人物塑造',
  conflictEscalation: '冲突与升级',
  foreshadowing: '伏笔与悬念',
  proseAndDialogue: '文笔与对话',
  worldBuilding: '世界观构建',
  // 历史维度
  historicalContext: '历史背景与时代特征',
  socialInstitutions: '社会制度与等级',
  dailyLife: '日常生活细节',
  materialCulture: '物质文化（器物/科技）',
  languageCustoms: '语言习惯与称谓',
}
