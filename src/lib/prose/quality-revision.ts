import type { ChatMessage, WorkspaceScope } from '../types'
import { hashCanonicalValue } from '../agent/run/hash'
import { verifyWholeChapterQualityReviewV1, type QualityReviewArtifactV1 } from './quality-review'
import { SCENE_REVISION_GUIDANCE_V1 } from './scene-craft'

export const QUALITY_REVISION_PROMPT_VERSION_V1 = 'quality-revision-patches-v3'

export interface QualityRevisionSpanV1 {
  id: string
  start: number
  end: number
  text: string
}

/** Ephemeral author plan. The durable service must resolve ownership/freshness
 * again and use the existing chapter candidate/adoption path before any write. */
export interface QualityRevisionPlanV1 {
  version: 1
  type: 'quality-revision-plan'
  portable: false
  scope: Pick<WorkspaceScope, 'projectId' | 'worldId' | 'workId'>
  chapterId: number
  reportRunId: number
  reportHash: string
  targetTextHash: string
  issueIds: string[]
  allowedSpans: QualityRevisionSpanV1[]
  protectedQuotes: string[]
  authorRequest?: string
  budget: { previousCalls: number; maxTotalCalls: 4; maxRevisionCalls: 1; maxRecheckCalls: 1 }
  maxReplacementChars: number
  planHash: string
}

/** The same frozen author selection and original strengths reach the writer. */
export function buildQualityRevisionRequestV1(input: {
  plan: QualityRevisionPlanV1
  report: QualityReviewArtifactV1
  originalText: string
  registeredContext: string
}): ChatMessage[] {
  if (input.report.artifactHash !== input.plan.reportHash) throw new Error('修订的初审报告与冻结计划不一致。')
  const { plan, report } = input
  return [
    { role: 'system', content: `范围修订契约：${QUALITY_REVISION_PROMPT_VERSION_V1}。\n只处理作者明确选中的阅读问题。你只能替换允许范围，不能修改保护文字、其它段落、人物事实、奖励与停笔位置。不要额外改写全文，也不要把范围或任务说明写进小说。\n${SCENE_REVISION_GUIDANCE_V1}\nspanId只能逐字复制允许替换范围中的id，不能使用问题id或评审anchorId。replacement仅替换该范围，范围外原文由系统保留，不得重复附加已扣除的保护文字；修改相关数值时核对本场所有受影响的陈述，不能只改其中一处。\n输出单个JSON：{"edits":[{"spanId":"允许范围的id","replacement":"该范围的替换文字，可为空以删除"}]}。每个spanId最多一次，总替换字符不超过${plan.maxReplacementChars}。` },
    { role: 'user', content: `【完整原稿】\n${input.originalText}\n【作者选中的问题】\n${JSON.stringify(report.issues.filter(issue => plan.issueIds.includes(issue.id)))}\n【初审保留点 · 编辑建议，不是新增事实】\n${JSON.stringify(report.strengths)}\n【允许替换的文字范围】\n${JSON.stringify(plan.allowedSpans)}\n【保护文字】\n${JSON.stringify(plan.protectedQuotes)}\n【登记资料与作者要求】\n${input.registeredContext}${plan.authorRequest ? `\n【本轮作者补充要求 · 只适用于已授权范围】\n${plan.authorRequest}` : ''}` },
  ]
}

function paragraphs(text: string): QualityRevisionSpanV1[] {
  let start = 0
  const spans: QualityRevisionSpanV1[] = []
  for (const line of text.split('\n')) {
    if (line.trim()) spans.push({ id: `p${spans.length + 1}`, start, end: start + line.length, text: line })
    start += line.length + 1
  }
  return spans
}

export async function freezeQualityRevisionPlanV1(input: {
  scope: WorkspaceScope
  chapterId: number
  reportRunId: number
  report: QualityReviewArtifactV1
  reviewMessages: ChatMessage[]
  reviewCurrent: boolean
  originalText: string
  selectedIssueIds: string[]
  additionalParagraphs?: number[]
  protectedQuotes?: string[]
  authorRequest?: string
  previousCalls: number
}): Promise<QualityRevisionPlanV1> {
  if (!input.reviewCurrent || !await verifyWholeChapterQualityReviewV1(input.report, input.originalText, input.reviewMessages)) throw new Error('评审或原稿已变化，不能使用旧问题修订。')
  if (input.authorRequest != null && (typeof input.authorRequest !== 'string' || input.authorRequest.length > 16000)) throw new Error('本次修订要求无效或过长。')
  for (const id of [input.scope.projectId, input.scope.worldId, input.scope.workId, input.chapterId, input.reportRunId]) {
    if (!Number.isSafeInteger(id) || id! < 1) throw new Error('修订计划缺少明确作品和章节身份。')
  }
  if (!Number.isSafeInteger(input.previousCalls) || input.previousCalls < 0 || input.previousCalls > 2) throw new Error('本轮没有初稿、初审之后的修订与复核预算。')
  if (!input.selectedIssueIds.length || new Set(input.selectedIssueIds).size !== input.selectedIssueIds.length) throw new Error('请明确选择本轮要处理的问题。')
  const selected = input.selectedIssueIds.map(id => input.report.issues.find(issue => issue.id === id))
  if (selected.some(issue => !issue)) throw new Error('所选问题不属于当前报告。')
  const sourceSpans = paragraphs(input.originalText)
  const additional = input.additionalParagraphs ?? []
  if (additional.some(value => !Number.isSafeInteger(value) || value < 1 || value > sourceSpans.length)) throw new Error('可改段落不属于当前原稿。')
  const requested = sourceSpans.filter((span, index) => additional.includes(index + 1)
    || selected.some(issue => issue!.start < span.end && issue!.end > span.start))
  const protectedQuotes = [...new Set(input.protectedQuotes ?? [])]
  const protectedRanges = protectedQuotes.map(quote => {
    const start = input.originalText.indexOf(quote)
    if (!quote.trim() || start < 0 || input.originalText.indexOf(quote, start + 1) >= 0) throw new Error('保护文字必须是原稿中的唯一引文。')
    return { start, end: start + quote.length }
  }).sort((a, b) => a.start - b.start)
  if (protectedRanges.some((range, index) => index > 0 && range.start < protectedRanges[index - 1].end)) throw new Error('保护文字范围不能重叠。')
  const allowedSpans: QualityRevisionSpanV1[] = []
  for (const span of requested) {
    let start = span.start
    let part = 0
    const push = (end: number) => {
      if (end > start) allowedSpans.push({ id: `${span.id}.${++part}`, start, end, text: input.originalText.slice(start, end) })
    }
    for (const protectedRange of protectedRanges.filter(range => range.start < span.end && range.end > span.start)) {
      push(Math.max(start, protectedRange.start))
      start = Math.min(span.end, protectedRange.end)
    }
    push(span.end)
  }
  if (!allowedSpans.length) throw new Error('所选段落已全部保护，没有授权的可改文字。')
  const body: Omit<QualityRevisionPlanV1, 'planHash'> = {
    version: 1, type: 'quality-revision-plan', portable: false,
    scope: { projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId },
    chapterId: input.chapterId, reportRunId: input.reportRunId, reportHash: input.report.artifactHash,
    targetTextHash: input.report.targetTextHash, issueIds: [...input.selectedIssueIds], allowedSpans, protectedQuotes,
    budget: { previousCalls: input.previousCalls, maxTotalCalls: 4, maxRevisionCalls: 1, maxRecheckCalls: 1 },
    maxReplacementChars: Math.max(800, Math.ceil(input.originalText.length * 1.25)),
    ...(input.authorRequest?.trim() ? { authorRequest: input.authorRequest.trim() } : {}),
  }
  return { ...body, planHash: await hashCanonicalValue(body) }
}

/** Deterministic reconstruction preserves every unselected/protected code unit.
 * This is text-scope validation, not a semantic fact or literature certificate. */
export async function applyQualityRevisionPatchesV1(input: {
  plan: QualityRevisionPlanV1
  originalText: string
  raw: string
}): Promise<{ outputText: string; changedSpanIds: string[] }> {
  const { planHash, ...body } = input.plan
  if (planHash !== await hashCanonicalValue(body) || input.plan.targetTextHash !== await hashCanonicalValue(input.originalText)) throw new Error('修订计划或原稿版本已变化。')
  const received = input.raw.trim()
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*)\r?\n```$/.exec(received)
  const parsed = JSON.parse(fence ? fence[1].trim() : received)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).join('|') !== 'edits'
    || !Array.isArray(parsed.edits) || !parsed.edits.length) throw new Error('修订只能返回明确范围的 edits。')
  const seen = new Set<string>()
  let replacementChars = 0
  const edits = parsed.edits.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('修订项格式无效。')
    const row = value as Record<string, unknown>
    if (Object.keys(row).sort().join('|') !== 'replacement|spanId' || typeof row.spanId !== 'string' || typeof row.replacement !== 'string') throw new Error('修订项只允许 spanId 与 replacement。')
    const span = input.plan.allowedSpans.find(span => span.id === row.spanId)
    if (!span || seen.has(span.id) || input.originalText.slice(span.start, span.end) !== span.text) throw new Error('修订试图越过授权范围或重复修改。')
    seen.add(span.id)
    replacementChars += row.replacement.length
    return { ...span, replacement: row.replacement }
  })
  if (replacementChars > input.plan.maxReplacementChars) throw new Error('本轮修订超出冻结篇幅预算。')
  let outputText = input.originalText
  for (const edit of edits.sort((a: QualityRevisionSpanV1, b: QualityRevisionSpanV1) => b.start - a.start)) {
    outputText = outputText.slice(0, edit.start) + edit.replacement + outputText.slice(edit.end)
  }
  return { outputText, changedSpanIds: [...seen] }
}
