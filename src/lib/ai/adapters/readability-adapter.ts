/**
 * 追读力评估适配器 — Phase F3
 *
 * 评估维度：Hook（悬念钩子）、Coolpoint（爽点）、Micropayoff（微兑现）、Pacing（节奏）
 */

export interface ReadabilityDimension {
  dimension: 'hook' | 'coolpoint' | 'micropayoff' | 'pacing'
  score: number  // 0-100
  description: string
  suggestion: string
}

export interface ReadabilityResult {
  overallScore: number
  dimensions: ReadabilityDimension[]
  highlights: string[]  // 亮点
  weaknesses: string[]  // 薄弱环节
}

export const READABILITY_DIMENSION_LABELS: Record<string, { label: string; emoji: string }> = {
  hook:        { label: '悬念钩子', emoji: '🎣' },
  coolpoint:   { label: '爽点/高潮', emoji: '⚡' },
  micropayoff: { label: '微兑现', emoji: '🎁' },
  pacing:      { label: '叙事节奏', emoji: '🎵' },
}
