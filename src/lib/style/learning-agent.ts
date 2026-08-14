import { usePromptStore } from '../../stores/prompt'
import { renderPrompt } from '../ai/prompt-engine'
import type { Chapter, ChatMessage, PromptTemplate, WorkspaceScope } from '../types'
import type { UserStyleProfile } from '../types/user-style'
import { countWords, htmlToPlainText } from '../utils/html'
import { readOwnedRows } from '../world-engine/scope'
import {
  formatStyleCalibrationFeedback,
  formatStyleFewShotPairs,
  parseStyleCalibrationFeedback,
  parseStyleRevisionPairs,
} from './style-learning'

export const STYLE_LEARNING_MAX_CHAPTERS_V1 = 6
export const STYLE_LEARNING_CHAPTER_CHARS_V1 = 2_500
export const STYLE_LEARNING_CONTEXT_LABEL_V1 = '文风学习正式输入基线'

const ELIGIBLE_STATUSES = new Set(['revised', 'polished', 'final'])
const REQUIRED_HEADINGS = ['用词习惯', '句式与节奏', '对话风格', '描写与画面', '标志性表达', '倾向与禁忌'] as const

export interface StyleLearningChapterSnapshotV1 {
  id: number
  title: string
  status: string
  order: number
  sample: string
  sampleWords: number
}

export interface StyleLearningProfileSnapshotV1 {
  present: boolean
  id: number | null
  projectId: number
  worldId: number
  workId: number
  profile: string
  enabled: boolean
  sourceChapterIds: string
  sampleCount: number
  sampleWords: number
  revisionPairs: string | null
  revisionPairsPresent: boolean
  calibrationFeedback: string | null
  calibrationFeedbackPresent: boolean
  createdAt: number | null
  updatedAt: number | null
}

export interface StyleLearningBaselineV1 {
  version: 1
  projectId: number
  worldId: number
  workId: number
  selectedChapterIds: number[]
  chapters: StyleLearningChapterSnapshotV1[]
  profile: StyleLearningProfileSnapshotV1
  sampleCount: number
  sampleWords: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function ownerId(row: Record<string, unknown>, field: 'worldId' | 'workId'): number {
  const value = Number(row[field])
  if (!Number.isInteger(value) || value <= 0) throw new Error(`文风画像缺少有效 ${field} owner。`)
  return value
}

function profileSnapshot(
  scope: WorkspaceScope,
  row: UserStyleProfile | undefined,
): StyleLearningProfileSnapshotV1 {
  if (!row) {
    return {
      present: false,
      id: null,
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      profile: '',
      enabled: false,
      sourceChapterIds: '[]',
      sampleCount: 0,
      sampleWords: 0,
      revisionPairs: null,
      revisionPairsPresent: false,
      calibrationFeedback: null,
      calibrationFeedbackPresent: false,
      createdAt: null,
      updatedAt: null,
    }
  }
  const raw = row as unknown as Record<string, unknown>
  return {
    present: true,
    id: row.id ?? null,
    projectId: row.projectId,
    worldId: scope.worldId,
    workId: ownerId(raw, 'workId'),
    profile: row.profile,
    enabled: row.enabled,
    sourceChapterIds: row.sourceChapterIds,
    sampleCount: row.sampleCount,
    sampleWords: row.sampleWords,
    revisionPairs: Object.prototype.hasOwnProperty.call(row, 'revisionPairs') ? text(row.revisionPairs) : null,
    revisionPairsPresent: Object.prototype.hasOwnProperty.call(row, 'revisionPairs'),
    calibrationFeedback: Object.prototype.hasOwnProperty.call(row, 'calibrationFeedback')
      ? text(row.calibrationFeedback)
      : null,
    calibrationFeedbackPresent: Object.prototype.hasOwnProperty.call(row, 'calibrationFeedback'),
    createdAt: number(row.createdAt),
    updatedAt: number(row.updatedAt),
  }
}

function chapterSnapshot(row: Chapter & { id: number }): StyleLearningChapterSnapshotV1 {
  const sample = htmlToPlainText(row.content).trim().slice(0, STYLE_LEARNING_CHAPTER_CHARS_V1)
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    order: row.order,
    sample,
    sampleWords: countWords(sample),
  }
}

export function normalizeStyleLearningChapterIdsV1(ids: readonly number[]): number[] {
  if (!Array.isArray(ids) || ids.length > STYLE_LEARNING_MAX_CHAPTERS_V1) {
    throw new Error(`文风学习每次最多选择 ${STYLE_LEARNING_MAX_CHAPTERS_V1} 章。`)
  }
  const normalized = [...new Set(ids)]
  if (normalized.length !== ids.length || normalized.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new Error('文风学习章节选择包含重复或无效 ID。')
  }
  return normalized
}

export async function readStyleLearningBaselineV1(input: {
  scope: WorkspaceScope
  chapterIds: readonly number[]
}): Promise<StyleLearningBaselineV1> {
  const selectedChapterIds = normalizeStyleLearningChapterIdsV1(input.chapterIds)
  const [chapters, profiles] = await Promise.all([
    readOwnedRows<Chapter>(input.scope, 'chapters', { owner: 'work' }),
    readOwnedRows<UserStyleProfile>(input.scope, 'userStyleProfiles', { owner: 'work' }),
  ])
  if (profiles.length > 1) throw new Error('当前 Work 存在多份文风画像，无法安全学习。')
  const byId = new Map(chapters.flatMap(chapter => chapter.id == null ? [] : [[chapter.id, chapter] as const]))
  const selected = selectedChapterIds.map(id => {
    const chapter = byId.get(id)
    if (!chapter || !ELIGIBLE_STATUSES.has(chapter.status) || !chapter.content.trim()) {
      throw new Error('文风学习章节不存在、不属于当前 Work、状态不合格或正文为空。')
    }
    return chapterSnapshot(chapter as Chapter & { id: number })
  })
  const profile = profileSnapshot(input.scope, profiles[0])
  const revisionPairs = parseStyleRevisionPairs(profile.revisionPairs ?? undefined)
  if (selected.length === 0 && revisionPairs.length === 0) {
    throw new Error('文风学习至少需要一章合格正文或一组已保存改稿对照。')
  }
  return {
    version: 1,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    selectedChapterIds,
    chapters: selected,
    profile,
    sampleCount: selected.length,
    sampleWords: selected.reduce((sum, chapter) => sum + chapter.sampleWords, 0),
  }
}

/** Exact registered text delivered to the model. Existing generated profile is excluded. */
export function formatStyleLearningBaselineV1(baseline: StyleLearningBaselineV1): string {
  const samples = baseline.chapters.map((chapter, index) => [
    `【样本 ${index + 1}·${chapter.title}】`,
    chapter.sample,
    chapter.sample.length >= STYLE_LEARNING_CHAPTER_CHARS_V1 ? '（……本章节选，后略）' : '',
  ].filter(Boolean).join('\n')).join('\n\n────────\n\n')
  const revisionPairs = formatStyleFewShotPairs(parseStyleRevisionPairs(baseline.profile.revisionPairs ?? undefined))
  const feedback = formatStyleCalibrationFeedback(
    parseStyleCalibrationFeedback(baseline.profile.calibrationFeedback ?? undefined),
  )
  return [
    '【文风学习正式输入基线】',
    samples ? `═══ 章节样本 ═══\n${samples}\n（共 ${baseline.sampleCount} 章、约 ${baseline.sampleWords} 字）` : '',
    revisionPairs
      ? `═══ 作者改稿对照 ═══\n${revisionPairs}\n只学习改前到改后的表达变化，不得把样本剧情、人物名或专有名词写进画像。`
      : '',
    feedback ? `═══ 最近互动校准反馈 ═══\n${feedback}` : '',
  ].filter(Boolean).join('\n\n')
}

export async function readStyleLearningBaselineContextV1(input: {
  scope: WorkspaceScope
  chapterIds: readonly number[]
}): Promise<string> {
  return formatStyleLearningBaselineV1(await readStyleLearningBaselineV1(input))
}

const STYLE_LEARNING_STRICT_PROTOCOL_V1 = `

【HARNESS-76 严格输出协议】
只输出 Markdown 文风画像正文，不得使用代码围栏、JSON、前后客套或复述输入。必须依次且各仅一次包含“## 用词习惯”“## 句式与节奏”“## 对话风格”“## 描写与画面”“## 标志性表达”“## 倾向与禁忌”六个标题；每节 1～5 条具体要点。样本不足时明确写“样本中体现不明显”，不得把样本中的剧情、人物名、地点名或专有名词当作文风规则。`

export function readStyleLearningPromptTemplateV1(): PromptTemplate {
  return usePromptStore.getState().getActive('style.learn')
}

export function readStyleLearningPromptTemplateSnapshotV1(
  template: PromptTemplate = readStyleLearningPromptTemplateV1(),
) {
  return {
    moduleKey: template.moduleKey,
    systemPrompt: template.systemPrompt,
    userPromptTemplate: template.userPromptTemplate,
    variables: template.variables,
    modelOverride: template.modelOverride ?? null,
    examples: template.examples ?? null,
    parameters: template.parameters ?? null,
    strictProtocol: STYLE_LEARNING_STRICT_PROTOCOL_V1,
  }
}

export function buildStyleLearningAgentMessagesV1(input: {
  registeredContext: string
  template?: PromptTemplate
}): ChatMessage[] {
  const template = input.template ?? readStyleLearningPromptTemplateV1()
  const rendered = renderPrompt(template, {
    samples: input.registeredContext,
    sampleCount: 0,
    sampleWords: 0,
    revisionPairs: '',
    calibrationFeedback: '',
    userHint: '',
  }).messages
  const systemIndex = rendered.findIndex(message => message.role === 'system')
  if (systemIndex >= 0) {
    rendered[systemIndex] = {
      ...rendered[systemIndex],
      content: `${rendered[systemIndex].content}${STYLE_LEARNING_STRICT_PROTOCOL_V1}`,
    }
  } else {
    rendered.unshift({ role: 'system', content: STYLE_LEARNING_STRICT_PROTOCOL_V1.trim() })
  }
  return rendered
}

export function parseStyleLearningResultStrictV1(raw: string): string {
  const result = raw.trim()
  if (!result || result.length < 120 || result.length > 24_000 || result.includes('\u0000')) {
    throw new Error('文风学习输出为空、过短、过长或包含非法字符。')
  }
  if (result.includes('```')) throw new Error('文风学习输出不得使用代码围栏。')
  let cursor = -1
  for (const heading of REQUIRED_HEADINGS) {
    const marker = `## ${heading}`
    const matches = result.match(new RegExp(`^##\\s+${heading}\\s*$`, 'gm')) ?? []
    const next = result.indexOf(marker, cursor + 1)
    if (matches.length !== 1 || next <= cursor) throw new Error(`文风学习输出缺少、重复或打乱“${marker}”。`)
    cursor = next
  }
  return result
}

export function styleLearningTargetStateV1(profile: StyleLearningProfileSnapshotV1) {
  return {
    present: profile.present,
    id: profile.id,
    profile: profile.profile,
    enabled: profile.enabled,
    sourceChapterIds: profile.sourceChapterIds,
    sampleCount: profile.sampleCount,
    sampleWords: profile.sampleWords,
  }
}

export function styleLearningSourceStateV1(baseline: StyleLearningBaselineV1) {
  return {
    version: baseline.version,
    projectId: baseline.projectId,
    worldId: baseline.worldId,
    workId: baseline.workId,
    selectedChapterIds: baseline.selectedChapterIds,
    chapters: baseline.chapters,
    revisionPairs: baseline.profile.revisionPairs,
    revisionPairsPresent: baseline.profile.revisionPairsPresent,
    calibrationFeedback: baseline.profile.calibrationFeedback,
    calibrationFeedbackPresent: baseline.profile.calibrationFeedbackPresent,
  }
}
