import type { NarrativeDomainMetadataV1, NarrativeDomainFieldsV1 } from './narrative-domain'
/**
 * 全局故事线 — Phase B
 * 给全书一条从开篇到结局的主线剧情锚点
 */

/** 故事线类型 */
export type StoryArcType = 'main' | 'sub'
export type StoryArcOrigin = 'manual' | 'ai' | 'import'
export type StoryArcStatus = 'active' | 'deprecated'

/** 故事阶段 */
export interface StoryStage {
  id: string              // nanoid
  title: string           // "起：初入江湖"
  description: string     // 这个阶段发生什么
  startVolume?: number    // 对应卷起始
  endVolume?: number      // 对应卷结束
  keyEvents: string[]     // 关键事件
  turningPoint?: string   // 转折点
}

/** 故事线 */
type StoryArcNarrativeFieldsV1 = NarrativeDomainMetadataV1 & Pick<NarrativeDomainFieldsV1, 'narrativeDevelopmentsV1'>

export interface StoryArc extends StoryArcNarrativeFieldsV1 {
  id?: number
  projectId: number
  /** Existing Work ownership stamp; legacy absence must not be inferred. */
  workId?: number
  /** 多世界作用域；null 表示单世界/默认主世界。 */
  worldGroupId?: number | null
  name: string            // "主线" / "感情线" / "复仇线"
  type: StoryArcType
  /** JSON 序列化的 StoryStage[] */
  stages: string
  description?: string    // 故事线整体描述
  /** STORY-1: this record is a one-way executable projection, never the story intent itself. */
  origin?: StoryArcOrigin
  status?: StoryArcStatus
  sourceStoryCoreId?: number
  sourceStoryCoreRevision?: number
  sourceStoryCoreHash?: string
  lastAlignedHash?: string
  producerRunId?: number
  producerCandidateHash?: string
  createdAt: number
  updatedAt: number
}

// ── 工具函数 ──

export type StoryStagesInspection =
  | { valid: true; stages: StoryStage[] }
  | { valid: false; error: string }

/** Validate stored data without coercing, filtering or rewriting author fields. */
export function inspectStages(stagesJson: string): StoryStagesInspection {
  try {
    const parsed: unknown = JSON.parse(stagesJson)
    if (!Array.isArray(parsed)) return { valid: false, error: '阶段数据必须是 JSON 数组。' }
    const ids = new Set<string>()
    for (const [index, stage] of parsed.entries()) {
      const prefix = `阶段 ${index + 1}`
      if (stage == null || typeof stage !== 'object' || Array.isArray(stage)) {
        return { valid: false, error: `${prefix}必须是对象。` }
      }
      if (typeof stage.id !== 'string' || !stage.id.trim() || ids.has(stage.id)) {
        return { valid: false, error: `${prefix}的 ID 必须是非空且不重复的文本。` }
      }
      ids.add(stage.id)
      if (typeof stage.title !== 'string' || typeof stage.description !== 'string') {
        return { valid: false, error: `${prefix}的标题和描述必须是文本。` }
      }
      if (!Array.isArray(stage.keyEvents) || !stage.keyEvents.every((event: unknown) => typeof event === 'string')) {
        return { valid: false, error: `${prefix}的关键事件必须是文本数组；没有事件时请填写 []。` }
      }
      if (stage.turningPoint !== undefined && typeof stage.turningPoint !== 'string') {
        return { valid: false, error: `${prefix}的转折点必须是文本或省略该字段。` }
      }
      for (const field of ['startVolume', 'endVolume'] as const) {
        if (stage[field] !== undefined && (typeof stage[field] !== 'number' || !Number.isFinite(stage[field]))) {
          return { valid: false, error: `${prefix}的卷范围必须是数字或省略该字段。` }
        }
      }
    }
    // Retain IDs and unknown extension fields. This is a read boundary, not a migration.
    return { valid: true, stages: parsed }
  } catch {
    return { valid: false, error: '阶段数据不是有效 JSON。' }
  }
}

/** Safe projection for consumers; editing/recovery must distinguish invalid data via inspectStages. */
export function parseStages(stagesJson: string): StoryStage[] {
  const result = inspectStages(stagesJson)
  return result.valid ? result.stages : []
}

export function stringifyStages(stages: StoryStage[]): string {
  return JSON.stringify(stages)
}

export function validateAuthorStoryStagesV1(value: unknown): asserts value is StoryStage[] {
  if (!Array.isArray(value)) throw new Error('故事阶段必须是完整数组，原始内容已保留。')
  const ids = new Set<string>()
  for (const item of Array.from(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)
      || typeof item.title !== 'string' || typeof item.description !== 'string' || !Array.isArray(item.keyEvents)
      || Array.from(item.keyEvents).some(event => typeof event !== 'string')
      || (item.turningPoint !== undefined && typeof item.turningPoint !== 'string')
      || [item.startVolume, item.endVolume].some(volume => volume !== undefined && (!Number.isSafeInteger(volume) || volume < 1))
      || (item.startVolume !== undefined && item.endVolume !== undefined && item.startVolume > item.endVolume)) throw new Error('故事阶段结构异常或标识重复，原始内容已保留。')
    ids.add(item.id)
  }
}

export function parseAuthorStoryStagesV1(raw: unknown): StoryStage[] {
  if (typeof raw !== 'string') throw new Error('故事阶段JSON格式异常，原始内容已保留。')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('故事阶段JSON损坏，原始内容已保留。') }
  validateAuthorStoryStagesV1(value)
  return value
}
