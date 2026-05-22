/**
 * 神明设定（嵌入 Worldview.divineDesign）
 */
export interface DivineDesign {
  hasDivinity: boolean       // 是否存在神明
  divineRank: string         // 神明层级体系（自由文本）
  divineNames: string        // 主要神明列表（自由文本）
  divineRules: string        // 神明的规则/限制
}

/** 自然资源类目 */
export interface NaturalResources {
  rareCreatures: string      // 珍禽异兽
  herbs: string              // 灵药/草药
  minerals: string           // 矿石
  others: string             // 其他特产
}

/** 世界观（v3 §2.1 — 三大块结构：世界起源 + 自然环境 + 人文环境） */
export interface Worldview {
  id?: number
  projectId: number
  // ── 旧字段（P5 改 panel 时迁移到下方新结构后删） ─────────────────────────
  geography: string       // 地理环境
  history: string         // 历史年表
  society: string         // 社会结构
  culture: string         // 文化宗教
  economy: string         // 经济体系
  rules: string           // 世界规则/物理法则
  summary: string         // 世界观精华摘要（AI 上下文）

  // ── v3 §2.1 新字段（全部可选，渐进填充） ─────────────────────────────────
  // 世界起源
  worldOrigin?: string                    // 世界来源（创世神话/科技起源等）
  powerHierarchy?: string                 // 力量层次（替代独立 powerSystems 表）
  divineDesign?: DivineDesign             // 神明设定

  // 自然环境
  worldStructure?: string                 // 世界结构（星球/大陆/多重天）
  worldDimensions?: string                // 世界尺寸（自由文本，长 × 宽 等）
  continentLayout?: string                // 大陆分布
  regionDimensions?: string               // 区域面积
  mountainsRivers?: string                // 山川河流
  climateByRegion?: string                // 分区域气候
  naturalResources?: NaturalResources

  // 人文环境
  historyLine?: string                    // 世界历史线
  worldEvents?: string                    // 世界大事记
  races?: string                          // 种族设定
  factionLayout?: string                  // 势力分布（替代独立 factions 表）
  politicsEconomyCulture?: string         // 政治/经济/文化设计
  internalConflicts?: string              // 矛盾冲突设计
  itemDesign?: string                     // 道具设计（替代独立 itemSystems 表）

  createdAt: number
  updatedAt: number
}

/** 故事核心（v3 §2.1 — 加 logline / concept / subPlots） */
export interface StoryCore {
  id?: number
  projectId: number
  theme: string                // 主题
  centralConflict: string      // 核心冲突
  plotPattern: string          // 情节模式
  storyLines: string           // 故事线（旧字段；v3 重命名为 mainPlot，保留兼容）

  // ── v3 §2.1 新字段 ────────────────────────────────────────
  logline?: string             // 一句话故事
  concept?: string             // 故事概念
  mainPlot?: string            // 故事主线（替代 storyLines 的语义）
  subPlots?: string            // 故事复线
  createdAt: number
  updatedAt: number
}

/** 力量体系 */
export interface PowerSystem {
  id?: number
  projectId: number
  name: string            // 体系名称
  description: string     // 体系描述
  levels: string          // 等级列表（JSON string）
  rules: string           // 体系规则
  createdAt: number
  updatedAt: number
}
