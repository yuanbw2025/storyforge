/**
 * 统一解析结果结构 —— 跨 session / chunk 共享。
 *
 * 独立成文件避免 import-session.ts 与 import-adapter.ts 循环依赖。
 */
export interface UnifiedParseResult {
  worldview?: Record<string, string>
  characters?: Array<Record<string, unknown>>
  outline?: Array<Record<string, unknown>>
  /** 写作技法分析（项目参考模式核心价值） */
  writingTechniques?: WritingTechniques
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
  /** 其他值得学习的写作技巧 */
  otherTechniques?: string
}
