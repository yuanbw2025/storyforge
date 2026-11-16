import type { OutlineReviewTarget } from './review-adoption'
import { executeRegisteredAIEntryV1 } from '../agent/formal-ai-entry'
import { useAIConfigStore } from '../../stores/ai-config'
import type { OutlineNode } from '../types'
import { wholeJSONContainerTextV1 } from '../ai/whole-json-container'

export type ChapterIssueType = 'logic' | 'consistency' | 'plot' | 'character' | 'timeline' | 'other'
export type IssueSeverity = 'low' | 'medium' | 'high'

/** 诊断阶段：只找问题，不生成改写 */
export interface ChapterReviewIssue {
  id: string
  issueType: ChapterIssueType
  severity: IssueSeverity
  description: string
  affectedChapters: number[]
  suggestion: string
}

export interface ChapterReviewResult {
  issues: ChapterReviewIssue[]
  summary: string
  rawOutput?: string
}

export interface ReviewChapter {
  index: number
  title: string
  summary: string
}

/** 智能改写阶段：针对单个问题生成最小化修改 */
export interface ChangeItem {
  id: string
  chapterIndex: number
  chapterTitle: string
  chapterName: string
  before: string
  after: string
  reason: string
}

export interface RewriteResult {
  target?: OutlineReviewTarget
  /** System-owned input snapshot. Model echoes never supply this baseline. */
  baseline: Readonly<ReviewChapter>
  rawOutput: string
  originalSummary: string
  revisedSummary: string
  changes: ChangeItem[]
  summary: string
}

export class ChapterReviewError extends Error {
  constructor(message: string, readonly rawOutput: string | undefined, readonly cause: unknown) {
    super(message)
    this.name = 'ChapterReviewError'
  }
}

// ========== 诊断阶段 ==========

const DIAGNOSE_PROMPT = (chapters: ReviewChapter[], worldContext?: string, userQuestion?: string): string => `
你是一位专业的小说编辑。请仔细阅读以下章节大纲，结合设定背景，诊断潜在问题。

${worldContext ? `【设定背景（用于检查设定一致性）】\n${worldContext.slice(0, 2000)}\n\n` : ''}

【章节大纲】
${chapters.map(ch => `第${ch.index + 1}章：${ch.title}\n${ch.summary}`).join('\n\n')}

${userQuestion ? `\n【用户特别关注】${userQuestion}\n` : ''}

【诊断维度】
1. 跨章节逻辑：角色动机、物品、能力、时间线是否前后一致
2. 设定符合性：是否违反设定背景中的规则/设定
3. 角色合理性：决策、行动是否符合性格和处境
4. 情节连贯：伏笔与回收、因果关系是否清晰
5. 叙事节奏：爽点分布、高潮铺垫是否合理

【输出格式】严格 JSON：

\`\`\`json
{
  "summary": "总体诊断（30-80字）",
  "issues": [
    {
      "id": "issue-1",
      "issueType": "logic",
      "severity": "high",
      "description": "问题描述（30-80字，说清楚哪里矛盾/不合理）",
      "affectedChapters": [0, 1],
      "suggestion": "修改方向（说清楚应该改成什么样，不要写具体改写内容）"
    }
  ]
}
\`\`\`

【字段说明】
- issueType: logic/consistency/plot/character/timeline/other
- severity: low(轻微)/medium(中等)/high(严重)
- affectedChapters: 涉及矛盾的章节 index（从 0 开始，第 1 章的 index 为 0）
- suggestion: 只说修改方向，例如"将倚天剑改为破云剑"，不要生成完整章节摘要

【严格规则】
1. 不要生成 rewrite 字段！改写由后续步骤完成
2. 如果能通过解释解决，说明原因即可，不要列为问题
3. 按严重程度排序
4. 无问题则 issues 返回空数组
`

export async function reviewChapterOutlines(
  chapters: ReviewChapter[],
  userQuestion?: string,
  context?: string,
): Promise<ChapterReviewResult> {
  const config = useAIConfigStore.getState().config

  const processedChapters = chapters.length > 40
    ? compressChapters(chapters)
    : chapters

  const messages = [
    {
      role: 'system' as const,
      content: '你是一位经验丰富的小说编辑，擅长诊断章节大纲的逻辑漏洞和设定冲突。',
    },
    {
      role: 'user' as const,
      content: DIAGNOSE_PROMPT(processedChapters, context, userQuestion),
    },
  ]

  let rawOutput: string | undefined
  try {
    rawOutput = await executeRegisteredAIEntryV1('outline.chapter.review', messages, config, {
      category: 'outline.review',
    })

    return parseDiagnoseResult(rawOutput, chapters)
  } catch (error) {
    throw new ChapterReviewError(`诊断失败：${error instanceof Error ? error.message : '未知错误'}`, rawOutput, error)
  }
}

// ========== 改写阶段 ==========

const REWRITE_PROMPT = (
  targetChapter: ReviewChapter,
  surroundingChapters: ReviewChapter[],
  issue: ChapterReviewIssue,
  worldContext?: string,
): string => `
你是一位精准的小说编辑。请针对以下问题，对目标章节的摘要进行最小化修改。

${worldContext ? `【设定背景】\n${worldContext.slice(0, 1500)}\n\n` : ''}

【问题详情】
- 问题类型：${issue.issueType}（${issue.severity}）
- 问题描述：${issue.description}
- 修改方向：${issue.suggestion}

【目标章节（需要修改）】
第${targetChapter.index + 1}章：${targetChapter.title}
原摘要：${targetChapter.summary}

【上下文章节】
${surroundingChapters.map(ch =>
  ch.index === targetChapter.index
    ? `（目标章节，见上方）`
    : `第${ch.index + 1}章：${ch.title}\n${ch.summary}`
).filter(Boolean).join('\n\n')}

【输出格式】严格 JSON：

\`\`\`json
{
  "originalSummary": "原摘要（原文照抄）",
  "revisedSummary": "修改后的完整摘要（保留所有未修改的内容）",
  "changes": [
    {
      "id": "change-1",
      "chapterIndex": ${targetChapter.index},
      "chapterTitle": "${targetChapter.title}",
      "chapterName": "第${targetChapter.index + 1}章",
      "before": "原摘要中需要修改的那段话",
      "after": "修改后的那段话",
      "reason": "为什么这样改"
    }
  ],
  "summary": "修改说明（一句话）"
}
\`\`\`

【严格规则】
1. 只修改必要的部分，保留其他所有内容
2. 本次只改目标章节；其他章节需单独生成候选。chapterIndex 必须是目标章节的 index
3. before/after 要能直接定位到原文中的具体片段
4. revisedSummary 是修改后的完整章节摘要，必须包含所有未修改的内容
5. 如果该问题不应该修改（用户可能忽略），返回空的 changes
`

export async function rewriteChapterOutline(
  allChapters: ReviewChapter[],
  issue: ChapterReviewIssue,
  context?: string,
  customSuggestion?: string,
): Promise<RewriteResult> {
  const config = useAIConfigStore.getState().config

  // 找到第一个需要修改的目标章节
  const targetIndex = issue.affectedChapters[0]
  const sourceChapter = allChapters.find(ch => ch.index === targetIndex)

  if (!sourceChapter) throw new Error('未找到目标章节，请重新诊断。')
  const targetChapter = Object.freeze({ ...sourceChapter })

  // 获取上下文（前后各2章）
  const surroundingChapters = allChapters.filter(ch =>
    ch.index >= targetIndex - 2 && ch.index <= targetIndex + 2
  )

  // 如果用户提供了自定义建议，使用它
  const effectiveIssue = customSuggestion
    ? { ...issue, suggestion: customSuggestion }
    : issue

  const messages = [
    {
      role: 'system' as const,
      content: '你是一位专业的小说编辑，擅长对章节摘要进行精准的最小化修改。',
    },
    {
      role: 'user' as const,
      content: REWRITE_PROMPT(targetChapter, surroundingChapters, effectiveIssue, context),
    },
  ]

  let rawOutput: string | undefined
  try {
    rawOutput = await executeRegisteredAIEntryV1('outline.chapter.rewrite', messages, config, {
      category: 'outline.rewrite',
    })

    return parseRewriteResult(rawOutput, targetChapter)
  } catch (error) {
    throw new ChapterReviewError(`改写失败：${error instanceof Error ? error.message : '未知错误'}`, rawOutput, error)
  }
}

// ========== 工具函数 ==========

function compressChapters(chapters: ReviewChapter[]): ReviewChapter[] {
  const result: ReviewChapter[] = []
  for (let i = 0; i < chapters.length; i += 3) {
    const group = chapters.slice(i, i + 3)
    const combinedSummary = group
      .map(c => `第${c.index + 1}章(${c.title})：${c.summary}`)
      .join(' | ')
    result.push({
      index: i,
      title: `第${i + 1}-${Math.min(i + 3, chapters.length)}章（合并）`,
      summary: combinedSummary,
    })
  }
  return result
}

function parseReportObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(wholeJSONContainerTextV1(raw, '审校报告'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('审校报告必须是 JSON 对象。')
  return parsed as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseDiagnoseResult(rawOutput: string, chapters: ReviewChapter[]): ChapterReviewResult {
  const parsed = parseReportObject(rawOutput)
  if (typeof parsed.summary !== 'string' || !parsed.summary.trim() || !Array.isArray(parsed.issues)) throw new Error('诊断报告缺少 summary 或 issues。')
  const ids = new Set<string>()
  const indices = new Set(chapters.map(chapter => chapter.index))
  const issues = parsed.issues.map((issue: unknown): ChapterReviewIssue => {
    if (!isRecord(issue) || typeof issue.id !== 'string' || !issue.id.trim() || ids.has(issue.id)
      || !['logic', 'consistency', 'plot', 'character', 'timeline', 'other'].includes(String(issue.issueType))
      || !['low', 'medium', 'high'].includes(String(issue.severity))
      || typeof issue.description !== 'string' || !issue.description.trim()
      || typeof issue.suggestion !== 'string' || !issue.suggestion.trim()
      || !Array.isArray(issue.affectedChapters) || !issue.affectedChapters.length
      || issue.affectedChapters.some(index => !Number.isInteger(index) || !indices.has(index))) throw new Error('诊断问题字段或章节定位无效。')
    ids.add(issue.id)
    return { id: issue.id, issueType: issue.issueType as ChapterIssueType, severity: issue.severity as IssueSeverity, description: issue.description, suggestion: issue.suggestion, affectedChapters: issue.affectedChapters }
  })
  return { issues, summary: parsed.summary, rawOutput }
}

function parseRewriteResult(rawOutput: string, baseline: Readonly<ReviewChapter>): RewriteResult {
  const parsed = parseReportObject(rawOutput)
  if (typeof parsed.originalSummary !== 'string' || typeof parsed.revisedSummary !== 'string'
    || typeof parsed.summary !== 'string' || !Array.isArray(parsed.changes)) throw new Error('改写报告字段不完整。')
  const changes = parsed.changes.map((change: unknown): ChangeItem => {
    if (!isRecord(change) || typeof change.id !== 'string' || !change.id.trim()
      || change.chapterIndex !== baseline.index || typeof change.before !== 'string' || !change.before.length
      || typeof change.after !== 'string' || typeof change.reason !== 'string') throw new Error('改写补丁字段或目标章节无效。')
    return { id: change.id, chapterIndex: baseline.index, chapterTitle: baseline.title, chapterName: `第${baseline.index + 1}章`, before: change.before, after: change.after, reason: change.reason }
  })
  const result = { baseline, rawOutput, originalSummary: parsed.originalSummary, revisedSummary: parsed.revisedSummary, changes, summary: parsed.summary }
  applySelectedChapterReviewChanges(result, new Set(changes.map(change => change.id)))
  return result
}

/** Preview and adoption use the exact same ranges against the frozen system input. */
export function applySelectedChapterReviewChanges(rewrite: RewriteResult, selectedIds: ReadonlySet<string>): string {
  const original = rewrite.baseline.summary
  if (rewrite.originalSummary !== original || (rewrite.target && rewrite.target.sourceSummary !== original)) throw new Error('模型原摘要与系统冻结原稿不一致，请重新生成候选。')
  const ids = new Set<string>()
  const ranges = rewrite.changes.map(change => {
    if (ids.has(change.id) || change.chapterIndex !== rewrite.baseline.index) throw new Error('改写补丁身份或目标章节不一致。')
    ids.add(change.id)
    const start = original.indexOf(change.before)
    if (!change.before.length || start < 0 || original.indexOf(change.before, start + 1) >= 0) throw new Error('改写 before 必须逐字唯一定位到系统原稿。')
    return { change, start, end: start + change.before.length }
  }).sort((a, b) => a.start - b.start)
  if ([...selectedIds].some(id => !ids.has(id))) throw new Error('所选修改不属于当前候选。')
  if (ranges.some((range, index) => index > 0 && range.start < ranges[index - 1].end)) throw new Error('改写补丁范围重叠，请重新生成候选。')
  let text = original
  for (const { change, start, end } of ranges.reverse()) {
    if (selectedIds.has(change.id)) text = text.slice(0, start) + change.after + text.slice(end)
  }
  return text
}

export function toReviewChapters(nodes: OutlineNode[]): ReviewChapter[] {
  return nodes
    .filter(n => n.type === 'chapter')
    .sort((a, b) => a.order - b.order)
    .map((n, idx) => ({
      index: idx,
      title: n.title || `第${idx + 1}章`,
      summary: n.summary ?? '',
    }))
}
