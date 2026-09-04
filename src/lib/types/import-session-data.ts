/**
 * 统一解析结果结构 —— 跨 session / chunk 共享。
 *
 * 独立成文件避免 import-session.ts 与 import-adapter.ts 循环依赖。
 */
export interface UnifiedParseResult {
  worldview?: Record<string, string>
  geography?: { overview?: string }
  history?: { overview?: string }
  characters?: Array<Record<string, unknown>>
  outline?: Array<Record<string, unknown>>
  /**
   * Phase 35-c：AI 只生成待作者审查的词条候选。
   * categoryRef 是稳定分类引用，不是数据库 categoryId。
   */
  codexCandidates?: CodexImportCandidate[]
  /** 写作技法分析（项目参考模式核心价值） */
  writingTechniques?: WritingTechniques
}

export interface CodexImportEvidence {
  /** 0-based 原文分块序号，由本地解析器盖章，不接受 AI 自报。 */
  chunkIndex: number
  /** 必须能在对应分块原文中逐字找到。 */
  quote: string
}

export interface CodexImportCandidate {
  /** builtin:<builtInKey> 或 custom:<domain>:<deterministic-token>。 */
  categoryRef: string
  name: string
  summary: string
  description: string
  /** 只允许所属分类 schema 中的普通字段；ref/FK 由作者后续维护。 */
  fields: Record<string, string>
  tags: string[]
  confidence: number
  evidence: CodexImportEvidence[]
}

/** 写作技法分析结构 */
export interface WritingTechniques {
  /** 叙事视角与手法 */
  narrativeStyle?: string
  /** 文笔风格（语言特色、修辞手法、节奏感） */
  proseStyle?: string
  /** 开篇技法 / 黄金三章分析 */
  openingTechnique?: string
  /** 情节结构与套路（起承转合、伏笔回收、悬念设置） */
  plotStructure?: string
  /** 高潮设计（上架高潮、卷末高潮、全书高潮） */
  climaxDesign?: string
  /** 节奏控制（快慢交替、张弛有度） */
  pacingControl?: string
  /** 人物塑造手法 */
  characterCraft?: string
  /** 对话技巧 */
  dialogueTechnique?: string
  /** 冲突设计与升级模式 */
  conflictEscalation?: string
  /** 爽点 / 情绪节拍设计 */
  emotionalBeats?: string
  /** 伏笔与回收 */
  foreshadowing?: string
  /** 世界观构建（设定融入叙事、规则展示、沉浸感营造）—— 统一作品分析吸收自原八维 */
  worldBuilding?: string
  /** 其他值得学习的写作技巧 */
  otherTechniques?: string
}

/**
 * 统一作品分析的 13 个「小说维度」key（= WritingTechniques 全部字段）。
 * 历史题材参考额外再分析 5 个历史维度(见 reference.ts HISTORY_DIMENSIONS)。
 * 这一份是 canonical 维度顺序,UI / 分析 / AI 上下文都按它遍历。
 */
export const FICTION_DIMENSIONS = [
  'narrativeStyle',
  'openingTechnique',
  'plotStructure',
  'pacingControl',
  'climaxDesign',
  'conflictEscalation',
  'characterCraft',
  'dialogueTechnique',
  'proseStyle',
  'emotionalBeats',
  'foreshadowing',
  'worldBuilding',
  'otherTechniques',
] as const

export type FictionDimension = (typeof FICTION_DIMENSIONS)[number]

/** 13 个小说维度中文标签 */
export const FICTION_DIMENSION_LABELS: Record<FictionDimension, string> = {
  narrativeStyle: '叙事视角与手法',
  openingTechnique: '开篇技法 / 黄金三章',
  plotStructure: '情节结构与套路',
  pacingControl: '节奏控制',
  climaxDesign: '高潮设计',
  conflictEscalation: '冲突设计与升级',
  characterCraft: '人物塑造',
  dialogueTechnique: '对话技巧',
  proseStyle: '文笔风格',
  emotionalBeats: '爽点 / 情绪节拍',
  foreshadowing: '伏笔与回收',
  worldBuilding: '世界观构建',
  otherTechniques: '其他值得学习的技巧',
}
