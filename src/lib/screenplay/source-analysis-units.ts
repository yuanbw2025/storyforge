import type { AdaptationSourceUnit } from '../types'

/**
 * A full-text adaptation treats the written manuscript as canon. Outline units
 * are only the fallback source when the selected work has no written chapters.
 */
export function screenplaySourceAnalysisUnitsV1(units: AdaptationSourceUnit[]): AdaptationSourceUnit[] {
  const writtenChapters = units.filter(unit => unit.sourceKind === 'chapter' && unit.wordCount > 0)
  if (writtenChapters.length > 0) return writtenChapters
  return units.filter(unit => unit.sourceKind === 'outline-node' && unit.summary.trim().length > 0)
}

export function screenplaySourceAnalysisUnitLabelV1(unit: AdaptationSourceUnit): string {
  if (unit.sourceKind === 'chapter') return `${unit.label} · 正文 ${unit.wordCount} 字`
  return `${unit.label} · 章纲已填写`
}
