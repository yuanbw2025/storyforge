import type { RagDocumentMetadata } from './rag-library'

/** 戏份权重（R1：与阵营正交） */
export type CharacterRoleWeight = 'main' | 'secondary' | 'npc' | 'extra'

/** 阵营九宫格：道德轴 */
export type CharacterMoralAxis = 'good' | 'neutral' | 'evil'

/** 阵营九宫格：秩序轴 */
export type CharacterOrderAxis = 'lawful' | 'neutral' | 'chaotic'

/** 角色在作品规划层的生命周期；变化只能经作者确认候选写入。 */
export type CharacterNarrativeStatus = 'planned' | 'active' | 'inactive' | 'retired' | 'deceased'

/** 角色 */
export interface Character extends RagDocumentMetadata {
  id?: number
  projectId: number
  name: string
  roleWeight: CharacterRoleWeight
  moralAxis: CharacterMoralAxis
  orderAxis: CharacterOrderAxis
  shortDescription: string   // 一句话简介
  appearance: string         // 外貌
  personality: string        // 性格
  background: string         // 背景故事
  motivation: string         // 动机
  abilities: string          // 能力
  relationships: string      // 关系描述（JSON string）
  arc: string                // 角色弧光/成长线

  // ── 扩展角色维度（可选；空=未填。注册于 FIELD_REGISTRY，由 CHARACTER_DIMENSIONS 描述符驱动呈现/生成）──
  identity?: string          // 身份/职业/势力归属
  profile?: string           // 年龄·性别·种族
  values?: string            // 价值观/信念
  strengths?: string         // 优点/长处
  weaknesses?: string        // 缺点/性格弱点
  fears?: string             // 恐惧/软肋/逆鳞
  goals?: string             // 目标（短期+长期）
  innerConflict?: string     // 核心矛盾/内心冲突
  keyEvents?: string         // 关键经历/转折事件
  powerLevel?: string        // 实力定位/境界等级
  speechStyle?: string       // 语言风格/口头禅
  habits?: string            // 习惯/小动作/癖好
  signatureItem?: string     // 标志性物品/形象符号

  // ── v3 §2.1 新字段：路人卡片用 ───────────────────────────────
  /** 常驻地点 / 起始地点 */
  location?: string
  /** 首次出场（章节号或自由文本） */
  firstAppearance?: string
  /** 在故事中扮演的角色作用（v3 §2.1 表格行字段） */
  storyRole?: string
  /** 结局走向 */
  ending?: string

  // ── Phase G2 新字段 ──
  /** 首次出场章节 ID */
  firstAppearChapterId?: number | null
  /** 活跃章节范围描述（如 "1-30, 45-60"） */
  activeChapterRange?: string
  /** 退场/死亡章节 ID */
  exitChapterId?: number | null
  /** 当前规划状态。 */
  narrativeStatus?: CharacterNarrativeStatus
  /** 最近一次状态变化所绑定的章节证据。 */
  statusEvidenceChapterId?: number | null
  /** 最近一次状态变化所绑定的故事线证据。 */
  statusEvidenceStoryArcId?: number | null
  /** 作者可见的状态变化理由。 */
  statusReason?: string
  /** 生成该状态候选的 portable durable contract/candidate provenance。 */
  statusProducerContractHash?: string | null
  statusProducerCandidateHash?: string | null

  // ── Phase 25.4 多世界 ──
  /** 角色原属世界组 ID；null 表示尚未归属，不代表跨世界。 */
  homeWorldGroupId?: number | null
  /** 是否跨世界角色（主角、系统精灵等，在所有世界中可见） */
  isCrossWorld?: boolean

  // ── WORLD-1 修炼/种族结构化关联 ──
  /** 所属种族词条（Codex race）；替代 profile 中不可校验的纯文本种族。 */
  raceEntryId?: number | null
  /** 主修体系；指向 cultivationSystems。 */
  cultivationSystemId?: number | null
  /** 通用力量体系；指向 powerSystems，供非修炼题材建立可校验关联。 */
  powerSystemId?: number | null
  /** 当前设定境界（上游角色卡，不是逐章进度）；指向体系 stages 内的稳定字符串 ID。 */
  cultivationStageId?: string | null
  /** 结构化常驻地点；location 文本仍保留为作者描述。 */
  importantLocationId?: number | null

  createdAt: number
  updatedAt: number
}

// （Faction 接口已随 C2 / DB v29 删除：势力并入「势力」词条。）
