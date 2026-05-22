/**
 * 提示词模板系统类型定义
 *
 * Phase 1 落地范围：把硬编码 prompts 下沉到 IndexedDB。
 * 详见 docs/09-REDESIGN-INTEGRATION-PLAN.md 第三章 与
 *      docs/playbooks/PHASE-01-prompt-infrastructure.md
 */

/** 提示词模块标识 — Phase 1 当前用到的全集 */
export type PromptModuleKey =
  // 世界观
  | 'worldview.dimension'
  // 角色
  | 'character.generate'
  | 'character.dimension'
  // 大纲
  | 'outline.volume'
  | 'outline.chapter'
  // 章节正文
  | 'chapter.content'
  | 'chapter.continue'
  | 'chapter.polish'
  | 'chapter.expand'
  | 'chapter.de-ai'
  // 伏笔
  | 'foreshadow.generate'
  // 地理 / 概念地图
  | 'geography.concept-map'
  | 'geography.image-map-prompt'
  // —— 后续 Phase 启用 ——
  | 'worldview.generate'
  | 'story.generate'
  | 'rules.generate'
  | 'detail.scene'
  | 'import.parse-character'
  | 'import.parse-worldview'
  | 'import.parse-outline'
  | 'import.parse-all'
  | 'import.parse-chunk'
  | 'import.merge-characters'
  // —— Phase 19 作品学习 ——
  | 'master.analyze-chunk'

/** 模板可调参数定义（Phase 12） */
export interface PromptParameter {
  /** 在模板里用 {{key}} 插入；usesXxx 用于条件块 */
  key: string
  /** UI 显示名 */
  label: string
  /** 类型：select 下拉 / slider 滑块 / number 数字 / text 文本 / boolean 开关 */
  type: 'select' | 'slider' | 'number' | 'text' | 'boolean'
  /** select 类型的可选项（label 与 value 同） */
  options?: string[]
  /** slider/number 范围 */
  min?: number
  max?: number
  step?: number
  /** 默认值（按 type 决定） */
  default: string | number | boolean
  /** 短描述（鼠标悬停或副标题展示） */
  description?: string
  /** 用户是否可关闭（关闭后不传给 AI，对应 {{#if usesXxx}} 条件） */
  optional?: boolean
}

/** 单条示例（Phase 12 加，P15 启用 UI） */
export interface PromptExample {
  id: string
  text: string
  /** 1-5 评分；用户标记的好/坏程度 */
  rating?: number
  source: 'system' | 'ai-generated' | 'user-marked'
  /** 备注 */
  note?: string
  createdAt: number
}

/** 提示词模板表行 */
export interface PromptTemplate {
  id?: number
  scope: 'system' | 'user'
  moduleKey: PromptModuleKey
  promptType: string
  name: string
  description: string
  systemPrompt: string
  userPromptTemplate: string
  variables: string[]
  modelOverride?: {
    temperature?: number
    maxTokens?: number
  }
  parentId?: number
  isActive: boolean

  // ── Phase 12 新增字段（全部可选，向后兼容） ────────────────────────────
  /** 是否标记为"默认推荐" — UI 显示徽章 */
  isDefault?: boolean
  /** 所属题材包（如 ['xuanhuan'] ['yanqing']）；空则为通用包 */
  genres?: string[]
  /** 模板可调参数（滑块 / 选项 / 数字 等） */
  parameters?: PromptParameter[]
  /** 好例子 / 坏例子（few-shot 用，P15 启用 UI） */
  examples?: {
    good?: PromptExample[]
    bad?: PromptExample[]
  }
  /** 短篇模式标识（短篇 / 中篇 / 长篇）— 影响默认参数 */
  lengthMode?: 'short' | 'medium' | 'long'

  createdAt: number
  updatedAt: number
}

/** 渲染时传入的变量字典 — 所有可能用到的字段一次性列出 */
export interface PromptVariableContext {
  // 项目级
  projectName?: string
  genres?: string
  description?: string
  // 世界观
  worldOrigin?: string
  naturalEnv?: string
  humanityEnv?: string
  worldContext?: string
  existingWorldview?: string
  // 故事
  storyCore?: string
  // 角色
  characters?: string
  existingCharacters?: string
  characterName?: string
  characterInfo?: string
  // 创作规则
  rules?: string
  // 大纲
  volumeTitle?: string
  volumeSummary?: string
  prevVolumeSummary?: string
  targetWordCount?: number
  estimatedVolumes?: number
  // 章节
  chapterTitle?: string
  chapterSummary?: string
  previousChapterEnding?: string
  existingContent?: string
  // 编辑/润色
  text?: string
  instruction?: string
  // 伏笔
  existingForeshadows?: string
  // 概念地图
  overview?: string
  locationList?: string
  locationNames?: string
  locationTypes?: string
  imageStyle?: string
  // 通用
  dimension?: string
  userHint?: string
  // 兜底（任意自定义键）
  [extra: string]: string | number | undefined
}
