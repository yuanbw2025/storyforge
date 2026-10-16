/**
 * 章节审校适配器 — Phase F1
 *
 * AI 审校五个维度：逻辑一致性、人物行为、世界观、伏笔衔接、情节节奏
 */

export interface ReviewIssue {
  dimension: 'logic' | 'character' | 'worldview' | 'foreshadow' | 'pacing'
  severity: 'info' | 'warning' | 'critical'
  description: string
  quote?: string
  suggestion: string
}

export interface ReviewResult {
  overallScore: number
  issues: ReviewIssue[]
  suggestions: string[]
}
