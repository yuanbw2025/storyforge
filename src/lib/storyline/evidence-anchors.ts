import { qualityReviewAnchorsV1 } from '../prose/quality-review'

/** Reuse the proven physical-text locator, pinned independently of future review prompts. */
export function storylineEvidenceAnchorsV1(chapterContent: string) {
  return qualityReviewAnchorsV1(chapterContent, 'whole-chapter-quality-review-v12')
}

/** Old exact-quote wire output stays readable. New anchors resolve only from
 * this frozen chapter; never normalize, splice or guess a model quotation. */
export function resolveStorylineModelEvidenceV1(root: Record<string, unknown>, chapterContent: string): Record<string, unknown> {
  const anchors = new Map(storylineEvidenceAnchorsV1(chapterContent).map(row => [row.anchorId, row.quote]))
  const entries = ['progress', 'crossings', 'newArcs'].map(key => {
    const rows = root[key]
    if (!Array.isArray(rows)) throw new Error('故事线映射的三个分类都必须是数组。')
    return [key, rows.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, 'anchorId')) return value
      const row = value as Record<string, unknown>
      if (Object.prototype.hasOwnProperty.call(row, 'quote') || Object.prototype.hasOwnProperty.call(row, 'evidenceQuote')) throw new Error('定位编号与手写引文不能同时提供。')
      if (typeof row.anchorId !== 'string' || !anchors.has(row.anchorId)) throw new Error('原文定位编号不属于当前章节，不能猜测替代。')
      const { anchorId, ...fields } = row
      return { ...fields, quote: anchors.get(anchorId) }
    })]
  })
  return Object.fromEntries(entries)
}
