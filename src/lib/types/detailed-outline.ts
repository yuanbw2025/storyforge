/**
 * 细纲（DetailedOutline）— v3 §2.1 创作区新模块
 *
 * 大纲（OutlineNode）→ 细纲（DetailedOutline）→ 章节正文（Chapter）
 *
 * 一个章节大纲展开为若干场景（scene），每个场景包含人物、地点、冲突、节奏。
 */

/** 场景节奏标签（用于 AI 写正文时判断笔墨分配） */
export type ScenePace =
  | 'slow'      // 慢节奏：心理/环境描写多
  | 'medium'    // 中节奏：对话/铺垫
  | 'fast'      // 快节奏：冲突/动作
  | 'climax'    // 高潮：决战/反转

/** 场景 */
export interface DetailedScene {
  /** UUID（前端生成） */
  sceneId: string
  title: string
  summary: string             // 一句话场景概要
  characterIds: number[]      // 涉及的角色 id（指向 characters 表）
  location: string            // 发生地点（自由文本，可与正式地理地点关联）
  conflict: string            // 本场景的核心冲突
  pace: ScenePace
  estimatedWords: number      // 估算字数
  notes: string               // 作者备注
}

/**
 * 归一化场景列表（CF-20260630-2 数据红线）。
 * 历史 bug：FIELD_REGISTRY 曾把 `detailedOutlines.scenes` 登记为 `json`，adopt() 会 JSON.stringify
 * 成字符串入库，导致渲染端 `scenes.reduce/.map` 崩溃（"scenes.reduce is not a function"）。
 * 读取时统一回数组、best-effort 自愈旧字符串数据（不动 DB、刷新即正常）。
 */
export function normalizeDetailedScenes(value: unknown): DetailedScene[] {
  const arr = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => { try { const p = JSON.parse(value || '[]'); return Array.isArray(p) ? p : [] } catch { return [] } })()
      : []
  return arr.filter((s): s is DetailedScene => !!s && typeof s === 'object' && !Array.isArray(s))
}

/** 情绪走向 */
export type EmotionArc = 'rising' | 'falling' | 'flat' | 'wave' | 'climax'

/** 细纲表行 */
export interface DetailedOutline {
  id?: number
  projectId: number
  /** 关联的章节大纲节点（对应 outlineNodes 表中 type='chapter' 的节点） */
  outlineNodeId: number
  /** 场景列表（按顺序） */
  scenes: DetailedScene[]

  // ── Phase D2 新字段 ──────────────────────────────────────────
  /** 开头衔接（从上一章结尾自然过渡） */
  openingHook?: string
  /** 结尾悬念 */
  endingCliffhanger?: string
  /** 本章主要场景地点 */
  sceneLocation?: string
  /** 出场角色 ID 列表 */
  appearingCharacterIds?: number[]
  /** 关联伏笔 ID 列表 */
  foreshadowIds?: number[]
  /** 情绪走向 */
  emotionArc?: EmotionArc
  /** 章纲工坊确认的不可写清单，供正文生成回注。 */
  prohibitions?: string[]

  // ── Phase 30.3 大纲-细纲同步检测 ──────────────────────────────
  /** 生成细纲时所用的章节大纲摘要快照，用于检测大纲变更后提示用户 */
  lastUsedSummary?: string

  createdAt: number
  updatedAt: number
}
