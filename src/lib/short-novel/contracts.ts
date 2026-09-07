import {
  SHORT_NOVEL_MAX_WORDS,
  SHORT_NOVEL_MIN_WORDS,
} from '../workspace/work-kind'
import type {
  ShortNovelBriefV1,
  ShortNovelChapterDraftV1,
  ShortNovelChapterPlanV1,
  ShortNovelReviewV1,
  ShortNovelStoryDesignV1,
} from '../types'

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[short-novel] ${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`[short-novel] ${label} 字段不在允许闭集`)
  }
}

function text(value: unknown, label: string, max = 4_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`[short-novel] ${label} 必须是非空文本`)
  return value.trim()
}

function strings(value: unknown, label: string, max = 20): string[] {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`[short-novel] ${label} 必须是非空文本数组`)
  }
  return value.map(item => item.trim())
}

const BRIEF_KEYS = ['version', 'premise', 'coreChange', 'dominantEmotion', 'pointOfView', 'tense', 'audience', 'storyPromise', 'mustKeep', 'forbidden', 'targetWordCount', 'chapterCount'] as const
const DESIGN_KEYS = ['version', 'protagonist', 'desire', 'pressure', 'escalation', 'irreversibleTurn', 'climaxChoice', 'endingImage', 'aftertaste', 'thematicQuestion'] as const
const PLAN_KEYS = ['stableKey', 'order', 'title', 'purpose', 'viewpoint', 'openingPressure', 'conflict', 'turn', 'exitState', 'targetWordCount'] as const
const REVIEW_KEYS = ['version', 'summary', 'strengths', 'issues'] as const
const ISSUE_KEYS = ['stableKey', 'severity', 'category', 'chapterKeys', 'evidence', 'problem', 'suggestion', 'status'] as const
const DRAFT_KEYS = ['version', 'chapterKey', 'title', 'content'] as const

export function parseShortNovelBriefV1(value: unknown): ShortNovelBriefV1 {
  const row = record(value, 'Brief'); exact(row, BRIEF_KEYS, 'Brief')
  if (row.version !== 1) throw new Error('[short-novel] Brief.version 必须为 1')
  const pointOfView = row.pointOfView
  const tense = row.tense
  if (!['first-person', 'third-limited', 'third-omniscient'].includes(String(pointOfView))) throw new Error('[short-novel] Brief.pointOfView 无效')
  if (!['past', 'present'].includes(String(tense))) throw new Error('[short-novel] Brief.tense 无效')
  if (!Number.isInteger(row.targetWordCount) || Number(row.targetWordCount) < SHORT_NOVEL_MIN_WORDS || Number(row.targetWordCount) > SHORT_NOVEL_MAX_WORDS) throw new Error('[short-novel] Brief 目标字数必须为 5,000～25,000')
  if (!Number.isInteger(row.chapterCount) || Number(row.chapterCount) < 3 || Number(row.chapterCount) > 8) throw new Error('[short-novel] Brief 章节数必须为 3～8')
  return {
    version: 1,
    premise: text(row.premise, 'Brief.premise'),
    coreChange: text(row.coreChange, 'Brief.coreChange'),
    dominantEmotion: text(row.dominantEmotion, 'Brief.dominantEmotion'),
    pointOfView: pointOfView as ShortNovelBriefV1['pointOfView'],
    tense: tense as ShortNovelBriefV1['tense'],
    audience: text(row.audience, 'Brief.audience'),
    storyPromise: text(row.storyPromise, 'Brief.storyPromise'),
    mustKeep: strings(row.mustKeep, 'Brief.mustKeep'),
    forbidden: strings(row.forbidden, 'Brief.forbidden'),
    targetWordCount: Number(row.targetWordCount),
    chapterCount: Number(row.chapterCount),
  }
}

export function parseShortNovelStoryDesignV1(value: unknown): ShortNovelStoryDesignV1 {
  const row = record(value, 'StoryDesign'); exact(row, DESIGN_KEYS, 'StoryDesign')
  if (row.version !== 1) throw new Error('[short-novel] StoryDesign.version 必须为 1')
  return {
    version: 1,
    protagonist: text(row.protagonist, 'StoryDesign.protagonist'),
    desire: text(row.desire, 'StoryDesign.desire'),
    pressure: text(row.pressure, 'StoryDesign.pressure'),
    escalation: strings(row.escalation, 'StoryDesign.escalation', 8),
    irreversibleTurn: text(row.irreversibleTurn, 'StoryDesign.irreversibleTurn'),
    climaxChoice: text(row.climaxChoice, 'StoryDesign.climaxChoice'),
    endingImage: text(row.endingImage, 'StoryDesign.endingImage'),
    aftertaste: text(row.aftertaste, 'StoryDesign.aftertaste'),
    thematicQuestion: text(row.thematicQuestion, 'StoryDesign.thematicQuestion'),
  }
}

export function parseShortNovelChapterPlanV1(value: unknown): ShortNovelChapterPlanV1[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 8) throw new Error('[short-novel] 章节计划必须包含 3～8 章')
  const result = value.map((item, index) => {
    const row = record(item, `ChapterPlan[${index}]`); exact(row, PLAN_KEYS, `ChapterPlan[${index}]`)
    if (row.stableKey !== `chapter-${index + 1}` || row.order !== index) throw new Error('[short-novel] 章节计划 stableKey/order 必须连续且可移植')
    if (!Number.isInteger(row.targetWordCount) || Number(row.targetWordCount) < 500) throw new Error('[short-novel] 章节计划字数预算无效')
    return {
      stableKey: row.stableKey,
      order: index,
      title: text(row.title, `ChapterPlan[${index}].title`, 160),
      purpose: text(row.purpose, `ChapterPlan[${index}].purpose`),
      viewpoint: text(row.viewpoint, `ChapterPlan[${index}].viewpoint`, 300),
      openingPressure: text(row.openingPressure, `ChapterPlan[${index}].openingPressure`),
      conflict: text(row.conflict, `ChapterPlan[${index}].conflict`),
      turn: text(row.turn, `ChapterPlan[${index}].turn`),
      exitState: text(row.exitState, `ChapterPlan[${index}].exitState`),
      targetWordCount: Number(row.targetWordCount),
    }
  })
  return result
}

export function parseShortNovelReviewV1(value: unknown): ShortNovelReviewV1 {
  const row = record(value, 'Review'); exact(row, REVIEW_KEYS, 'Review')
  if (row.version !== 1 || !Array.isArray(row.issues) || row.issues.length > 40) throw new Error('[short-novel] Review 结构无效')
  const seen = new Set<string>()
  const issues = row.issues.map((item, index) => {
    const issue = record(item, `Review.issues[${index}]`); exact(issue, ISSUE_KEYS, `Review.issues[${index}]`)
    const stableKey = text(issue.stableKey, `Review.issues[${index}].stableKey`, 160)
    if (seen.has(stableKey)) throw new Error('[short-novel] Review issue stableKey 重复')
    seen.add(stableKey)
    if (!['critical', 'major', 'minor'].includes(String(issue.severity))) throw new Error('[short-novel] Review issue severity 无效')
    if (!['causality', 'character', 'continuity', 'pacing', 'point-of-view', 'promise-payoff', 'prose'].includes(String(issue.category))) throw new Error('[short-novel] Review issue category 无效')
    if (issue.status !== 'open') throw new Error('[short-novel] AI 新审校问题只能以 open 状态进入候选')
    return {
      stableKey,
      severity: issue.severity as ShortNovelReviewV1['issues'][number]['severity'],
      category: issue.category as ShortNovelReviewV1['issues'][number]['category'],
      chapterKeys: strings(issue.chapterKeys, `Review.issues[${index}].chapterKeys`, 8),
      evidence: text(issue.evidence, `Review.issues[${index}].evidence`),
      problem: text(issue.problem, `Review.issues[${index}].problem`),
      suggestion: text(issue.suggestion, `Review.issues[${index}].suggestion`),
      status: 'open' as const,
    }
  })
  return { version: 1, summary: text(row.summary, 'Review.summary'), strengths: strings(row.strengths, 'Review.strengths', 12), issues }
}

export function parseShortNovelChapterDraftV1(value: unknown): ShortNovelChapterDraftV1 {
  const row = record(value, 'ChapterDraft'); exact(row, DRAFT_KEYS, 'ChapterDraft')
  if (row.version !== 1 || !/^chapter-[1-8]$/.test(String(row.chapterKey))) throw new Error('[short-novel] ChapterDraft identity 无效')
  return { version: 1, chapterKey: String(row.chapterKey), title: text(row.title, 'ChapterDraft.title', 160), content: text(row.content, 'ChapterDraft.content', 120_000) }
}

export const SHORT_NOVEL_CONTRACT_KEYS = { BRIEF_KEYS, DESIGN_KEYS, PLAN_KEYS, REVIEW_KEYS, ISSUE_KEYS, DRAFT_KEYS }
