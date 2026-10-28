import type { AIConfig } from '../types'
import type { ChatRequestOptions } from '../ai/client'
import { supportsVerifiedJsonObjectResponseForModelV1 } from '../ai/provider-capabilities'
import { resolveStorylineModelEvidenceV1, storylineEvidenceAnchorsV1 } from '../storyline/evidence-anchors'

export const CHAPTER_ORGANIZATION_MODEL_PROMPT_VERSION_V4 = 'chapter-organization-v4' as const
export const CHAPTER_ORGANIZATION_MODEL_ARRAYS_V1 = ['stateDiffs', 'facts', 'inventoryEvents', 'storyEvents', 'relations', 'foreshadowUpdates'] as const

export function chapterOrganizationRequestOptionsV1(config: Pick<AIConfig, 'provider' | 'model'>): ChatRequestOptions {
  return {
    ...(supportsVerifiedJsonObjectResponseForModelV1(config) ? { responseFormat: 'json_object' as const } : {}),
    ...(config.provider === 'agnes' && config.model === 'agnes-2.5-flash' ? { thinkingMode: 'disabled' as const } : {}),
  }
}

/** Decode references from this exact frozen plain text. Legacy literal rows
 * still face the same downstream literal and target checks; no quote repair. */
export function resolveChapterOrganizationModelEvidenceV1(root: Record<string, unknown>, chapterText: string): Record<string, unknown> {
  const allowed = new Set<string>([...CHAPTER_ORGANIZATION_MODEL_ARRAYS_V1, 'storyline'])
  if (Object.keys(root).some(key => !allowed.has(key))) throw new Error('整理本章含未登记的顶层字段。')
  const anchors = new Map(storylineEvidenceAnchorsV1(chapterText).map(row => [row.anchorId, row.quote]))
  const entries = CHAPTER_ORGANIZATION_MODEL_ARRAYS_V1.map(key => {
    const rows = root[key]
    if (!Array.isArray(rows)) throw new Error(`整理本章 ${key} 必须是数组。`)
    return [key, rows.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`整理本章 ${key} 的每条候选必须是对象。`)
      const row = value as Record<string, unknown>
      if (!Object.prototype.hasOwnProperty.call(row, 'anchorId')) return row
      if (Object.prototype.hasOwnProperty.call(row, 'quote') || Object.prototype.hasOwnProperty.call(row, 'sourceQuote')) throw new Error('原文定位编号与手写引文不能同时提供。')
      if (typeof row.anchorId !== 'string' || !anchors.has(row.anchorId)) throw new Error('原文定位编号不属于本次冻结的章节。')
      const { anchorId, ...fields } = row
      return { ...fields, [key === 'facts' ? 'quote' : 'sourceQuote']: anchors.get(anchorId) }
    })]
  })
  // Older complete six-domain responses have no storyline key. They remain
  // readable, while any provided seventh category must be complete and valid.
  const storyline = root.storyline === undefined ? { progress: [], crossings: [], newArcs: [] } : root.storyline
  if (!storyline || typeof storyline !== 'object' || Array.isArray(storyline)
    || Object.keys(storyline).some(key => !['progress', 'crossings', 'newArcs'].includes(key))) throw new Error('整理本章故事线分类必须是闭集对象。')
  return { ...Object.fromEntries(entries), storyline: resolveStorylineModelEvidenceV1(storyline as Record<string, unknown>, chapterText) }
}
