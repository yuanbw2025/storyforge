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

/** 可选的写作任务，不要求每场景使用同一公式或必须发生冲突。 */
export const DETAILED_SCENE_TASK_FIELDS = [
  { key: 'entryState', label: '进入状态' },
  { key: 'goal', label: '本场目标' },
  { key: 'keyChoice', label: '关键选择' },
  { key: 'outcome', label: '行动后果' },
  { key: 'exitState', label: '退出状态' },
  { key: 'sceneFunction', label: '场景功能与读者期待' },
] as const

export type DetailedSceneTaskV1 = Partial<Record<typeof DETAILED_SCENE_TASK_FIELDS[number]['key'], string>>

/** 缺失仍为缺失；不补旧记录、不裁剪作者原文。 */
export function parseDetailedSceneTaskFieldsV1(value: Record<string, unknown>): DetailedSceneTaskV1 {
  const result: DetailedSceneTaskV1 = {}
  for (const { key, label } of DETAILED_SCENE_TASK_FIELDS) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'string') throw new Error(`场景${label}必须是文本，允许留白`)
    if (value[key].length > 8000) throw new Error(`场景${label}超过 8000 字符`)
    result[key] = value[key]
  }
  return result
}

/** 场景 */
export interface DetailedScene extends DetailedSceneTaskV1 {
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

/** 当前结构读取边界：场景必须已经是数组，不接受旧字符串或损坏项。 */
export function normalizeDetailedScenes(value: unknown): DetailedScene[] {
  if (!Array.isArray(value)) {
    throw new Error('细纲 scenes 必须是当前结构的数组')
  }
  if (value.some(scene => !scene || typeof scene !== 'object' || Array.isArray(scene))) {
    throw new Error('细纲 scenes 包含非法场景项')
  }
  value.forEach(scene => parseDetailedSceneTaskFieldsV1(scene))
  return value as DetailedScene[]
}

/** 保存记录不等于完成规划；默认场景标题或空壳都不能冒充已规划。 */
export function hasDetailedOutlinePlanV1(detail?: Pick<DetailedOutline, 'scenes'>): boolean {
  return detail?.scenes.some(scene => [scene.summary, scene.conflict, scene.notes, ...DETAILED_SCENE_TASK_FIELDS.map(({ key }) => scene[key])].some(value => typeof value === 'string' && value.trim().length > 0)) ?? false
}

/** 情绪走向 */
export type EmotionArc = 'rising' | 'falling' | 'flat' | 'wave' | 'climax'

/** 细纲表行 */
export interface DetailedOutline {
  id?: number
  projectId: number
  /** 当前表由 Work owner 门盖章。 */
  workId?: number
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
