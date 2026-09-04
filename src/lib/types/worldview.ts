import type { RagDocumentMetadata } from './rag-library'

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

/** 世界观：世界起源、自然环境与人文环境的当前语义表。 */
export interface Worldview extends RagDocumentMetadata {
  id?: number
  projectId: number

  // 全部语义字段可渐进填充。
  // 世界起源
  worldOrigin?: string                    // 世界来源（创世神话/科技起源等）
  powerHierarchy?: string                 // 世界观中的力量层级概述
  divineDesign?: DivineDesign             // 神明设定

  // 自然环境
  worldStructure?: string                 // 世界结构（星球/大陆/多重天）
  worldDimensions?: string                // 世界尺寸（自由文本，长 × 宽 等）
  continentLayout?: string                // 大陆分布
  regionDimensions?: string               // 区域面积
  mountainsRivers?: string                // 山川河流
  climateByRegion?: string                // 分区域气候
  naturalResourceOverview?: string        // 自然资源·全貌(整体概述;具体矿物/灵植/灵兽走词条)
  naturalResources?: NaturalResources

  // 人文环境
  races?: string                          // 种族设定
  factionLayout?: string                  // 势力分布
  politicsOverview?: string               // 政治制度与权力结构概述
  economyOverview?: string                // 经济、货币、产业与贸易概述
  cultureOverview?: string                // 文化、宗教、语言与风俗概述
  internalConflicts?: string              // 矛盾冲突设计
  itemDesign?: string                     // 道具与器物体系概述

  /** 所属世界组 ID（null/undefined = 默认主世界） */
  worldGroupId?: number | null

  createdAt: number
  updatedAt: number
}

/** 故事核心：作者确认的七项故事意图。 */
export interface StoryCore extends RagDocumentMetadata {
  id?: number
  projectId: number
  theme: string                // 主题
  centralConflict: string      // 核心冲突
  plotPattern: string          // 情节模式
  logline?: string             // 一句话故事
  concept?: string             // 故事概念
  mainPlot?: string            // 故事主线
  subPlots?: string            // 故事副线
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
  /** 所属世界组 ID（Phase 25.4） */
  worldGroupId?: number | null
  createdAt: number
  updatedAt: number
}
