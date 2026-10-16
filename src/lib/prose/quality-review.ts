import type { ChatMessage } from '../types'
import { hashCanonicalValue } from '../agent/run/hash'
import type { AIRequestSettingsV1 } from '../ai/client'
import { parseProseRequestSettingsV1 } from './request-evidence'
import { SCENE_REVIEW_GUIDANCE_V1 } from './scene-craft'

export const QUALITY_REVIEW_PROMPT_VERSION_V1 = 'whole-chapter-quality-review-v7'
const REVIEW_PROMPT_VERSIONS = ['whole-chapter-quality-review-v1', 'whole-chapter-quality-review-v2', 'whole-chapter-quality-review-v3', 'whole-chapter-quality-review-v4', 'whole-chapter-quality-review-v5', 'whole-chapter-quality-review-v6', QUALITY_REVIEW_PROMPT_VERSION_V1] as const

/** Rechecks retain the version of their actual nested review request. */
export function qualityReviewPromptVersionFromMessagesV1(messages: readonly ChatMessage[]): typeof REVIEW_PROMPT_VERSIONS[number] {
  return REVIEW_PROMPT_VERSIONS.find(version => messages[0]?.content.includes(`全文评审契约：${version}。`)) ?? 'whole-chapter-quality-review-v3'
}
export type QualityReviewModeV1 = 'quality' | 'style' | 'readability'
export const QUALITY_REVIEW_DIMENSIONS_V1 = ['expectation', 'agency', 'causality', 'system-payoff', 'voice', 'repetition', 'pace', 'continuity'] as const
export type QualityReviewDimensionV1 = typeof QUALITY_REVIEW_DIMENSIONS_V1[number]

export interface QualityReviewIssueV1 {
  id: string
  dimension: QualityReviewDimensionV1
  confidence: 'suggestion' | 'uncertain'
  quote: string
  start: number
  end: number
  paragraph: number
  reason: string
  suggestion: string
}

export interface QualityReviewArtifactV1 {
  version: 1
  type: 'whole-chapter-quality-review'
  mode: QualityReviewModeV1
  targetTextHash: string
  /** Coverage establishes full input delivery, not human or model attention. */
  coverage: { kind: 'whole-input'; start: 0; end: number; utf16Length: number; paragraphs: number; requestHash: string }
  reviewer: { provider: string; model: string; promptVersion: typeof REVIEW_PROMPT_VERSIONS[number]; correlatedJudge: boolean; generatorIdentity: { provider: string; model: string } | null; settings: AIRequestSettingsV1 }
  issues: QualityReviewIssueV1[]
  summary: string
  strengths: string[]
  createdAt: number
  artifactHash: string
}

const labels: Record<QualityReviewModeV1, string> = { quality: '章节阅读质量', style: '表达与重复', readability: '继续阅读的动力' }
const HASH = /^[a-f0-9]{64}$/

/** Exact, bounded spans of the same full input. IDs disambiguate repeated text;
 * the model never has to reproduce punctuation or calculate UTF16 offsets. */
export function qualityReviewAnchorsV1(chapterText: string, promptVersion: typeof REVIEW_PROMPT_VERSIONS[number] = QUALITY_REVIEW_PROMPT_VERSION_V1): { anchorId: string; quote: string; start: number; end: number }[] {
  const anchors: { anchorId: string; quote: string; start: number; end: number }[] = []
  let paragraph = 0
  for (const match of chapterText.matchAll(/[^\n]+/g)) {
    if (!match[0].trim()) continue
    paragraph++
    const limit = match.index! + match[0].length
    // v6 advertised a segment suffix even for short paragraphs. Preserve it
    // only for those historical requests; v7 names an unsplit paragraph directly.
    const paragraphOnlyId = Number(promptVersion.match(/-v(\d+)$/)?.[1]) >= 7 && match[0].length <= 160
    let part = 0
    for (let start = match.index!; start < limit;) {
      let end = Math.min(start + 160, limit)
      const last = chapterText.charCodeAt(end - 1)
      if (end < limit && last >= 0xD800 && last <= 0xDBFF) end--
      part++
      anchors.push({ anchorId: paragraphOnlyId ? `p${paragraph}` : `p${paragraph}-${part}`, quote: chapterText.slice(start, end), start, end })
      start = end
    }
  }
  return anchors
}

export function formatQualityReviewAnchorsV1(chapterText: string, promptVersion: typeof REVIEW_PROMPT_VERSIONS[number] = QUALITY_REVIEW_PROMPT_VERSION_V1): string {
  return JSON.stringify(qualityReviewAnchorsV1(chapterText, promptVersion).map(({ anchorId, quote }) => ({ anchorId, text: quote })))
}

function paragraphNumber(text: string, start: number, promptVersion: typeof REVIEW_PROMPT_VERSIONS[number]): number {
  if (promptVersion === 'whole-chapter-quality-review-v1' || promptVersion === 'whole-chapter-quality-review-v2') return text.slice(0, start).split(/\n\s*\n/).length
  const lines = text.slice(0, start).split('\n')
  lines.pop()
  return lines.filter(line => line.trim()).length + 1
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象。`)
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, expected: string[], label: string) {
  if (Object.keys(value).sort().join('|') !== [...expected].sort().join('|')) throw new Error(`${label} 字段不符合报告契约。`)
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} 必须是有效文本。`)
  return value
}

export function qualityReviewSystemGuidanceV1(mode: QualityReviewModeV1): string {
  return `全文评审契约：${QUALITY_REVIEW_PROMPT_VERSION_V1}。
你提供${labels[mode]}的编辑建议。阅读下方完整正文，并尊重作者的场景任务、文风和停笔位置。
维度：${QUALITY_REVIEW_DIMENSIONS_V1.join('|')}。检查期待、主动选择、因果、系统边界与兑现、声线、重复、节奏和连续性。
优先核对关键过程与结果：交付、验收、付款、调整、试验、签字是否跳过必要行动；前态—动作—后态的数量、时间、资源和状态是否相互吻合；结尾是否混入写作要求、停笔说明或任务自评。必须区分角色的有意隐瞒、推测与叙述事实，无法确定则标为uncertain。
先处理会改变读者对事件理解的问题，再考虑表达细节。表达建议需要说明具体影响，不为求变化修改有效动作或强行填满留白。
${SCENE_REVIEW_GUIDANCE_V1}
缓冲、安静、留白、角色有意隐瞒和舒缓叙述不自动构成问题。不强制每章高潮、冲突或悬念，不将高频词等同于机器写作，不输出AI概率、平台合格结论或未校准的质量分。
每个问题选择下方定位目录里对应的anchorId。编号绑定当前正文的确切片段，代码取得原文与UTF16位置；不要另写quote、start或end，不得编造或改写编号。跨片段问题选择其中一个作为定位锚点，其余依据写在reason里；没有合适原文依据则不列问题。无法确定问题则confidence=uncertain。问题是阅读建议；事实冲突的正式阻断由已有证据型审修处理。
章纲、细纲与作者要求是计划，不能据此认定正文已经完成动作或兑现。以正文实际描写为准；记账、总结或系统提示不能自动替代应有的关键过程。`
}

export async function buildWholeChapterQualityReviewRequestV1(input: {
  mode: QualityReviewModeV1
  chapterTitle: string
  chapterText: string
  registeredContext: string
  authorRequest?: string
}): Promise<{ messages: ChatMessage[]; targetTextHash: string }> {
  if (!Object.prototype.hasOwnProperty.call(labels, input.mode)) throw new Error('评审模式无效。')
  if (!input.chapterText.trim()) throw new Error('正文为空，不能进行全文评审。')
  if (input.authorRequest && input.authorRequest.length > 16000) throw new Error('本次评审要求过长，请精简后再开始。')
  const targetTextHash = await hashCanonicalValue(input.chapterText)
  const system = `${qualityReviewSystemGuidanceV1(input.mode)}
输出一个JSON对象，不要围栏或解释：
{"summary":"本章的阅读情况及不确定性","strengths":["保留的有效写法"],"issues":[{"dimension":"上述维度之一","confidence":"suggestion|uncertain","anchorId":"定位目录中的编号","reason":"问题及影响","suggestion":"只针对该问题的建议"}]}
没有证据不要编造问题；空issues不是文学达标或整章无错的认证。不得把本段指令写进故事。`
  return { targetTextHash, messages: [
    { role: 'system', content: system },
    { role: 'user', content: `【章节】${input.chapterTitle}\n【完整正文 · hash ${targetTextHash} · UTF16长度 ${input.chapterText.length}】\n${input.chapterText}\n【正文结束】\n【当前正文定位目录 · 只从这里选择anchorId】\n${formatQualityReviewAnchorsV1(input.chapterText)}\n\n【登记的作品资料、场景任务与作者意图】\n${input.registeredContext || '（暂无）'}${input.authorRequest?.trim() ? `\n\n【本次作者评审要求 · 不属于故事事实】\n${input.authorRequest.trim()}` : ''}` },
  ] }
}

/** Reject invented or ambiguous anchors. No subjective issue can block Canon adoption. */
export async function parseWholeChapterQualityReviewV1(input: {
  raw: string
  mode: QualityReviewModeV1
  chapterText: string
  targetTextHash: string
  messages: ChatMessage[]
  responseCompletion: 'complete' | 'length' | 'unknown'
  settings: AIRequestSettingsV1
  generatorIdentity?: { provider: string; model: string }
  createdAt?: number
  promptVersion?: typeof REVIEW_PROMPT_VERSIONS[number]
}): Promise<QualityReviewArtifactV1> {
  if (!Object.prototype.hasOwnProperty.call(labels, input.mode)) throw new Error('评审模式无效。')
  if (input.responseCompletion !== 'complete') throw new Error('评审响应未完成，不能显示全文报告。')
  if (!input.messages.some(message => message.content.includes(input.chapterText))) throw new Error('实际评审请求缺少完整正文。')
  if (!HASH.test(input.targetTextHash) || input.targetTextHash !== await hashCanonicalValue(input.chapterText)) throw new Error('报告目标正文已变化。')
  const promptVersion = input.promptVersion ?? QUALITY_REVIEW_PROMPT_VERSION_V1
  if (!REVIEW_PROMPT_VERSIONS.includes(promptVersion)) throw new Error('评审请求版本无效。')
  // Only strip a complete enclosing JSON fence. Never extract guessed fields,
  // repair quotations, remove prose, or dispatch another model request.
  const received = input.raw.trim()
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*)\r?\n```$/.exec(received)
  const raw = fence ? fence[1].trim() : received
  let decoded: unknown
  try { decoded = JSON.parse(raw) } catch { throw new Error('评审响应格式不完整或无效，不能形成报告。') }
  const root = record(decoded, '评审结果')
  keys(root, ['summary', 'strengths', 'issues'], '评审结果')
  const summary = text(root.summary, 'summary', 3000)
  if (!Array.isArray(root.strengths) || root.strengths.length > 20 || !Array.isArray(root.issues) || root.issues.length > 40) throw new Error('评审列表超出范围或格式无效。')
  const strengths = root.strengths.map(value => text(value, 'strength', 1000))
  const anchors = new Map(qualityReviewAnchorsV1(input.chapterText, promptVersion).map(anchor => [anchor.anchorId, anchor]))
  const issues = root.issues.map((value, index): QualityReviewIssueV1 => {
    const row = record(value, `issues[${index}]`)
    const anchored = ['whole-chapter-quality-review-v6', QUALITY_REVIEW_PROMPT_VERSION_V1].includes(promptVersion) && Object.prototype.hasOwnProperty.call(row, 'anchorId')
    keys(row, anchored ? ['dimension', 'confidence', 'anchorId', 'reason', 'suggestion'] : ['dimension', 'confidence', 'quote', 'start', 'end', 'reason', 'suggestion'], `issues[${index}]`)
    if (!QUALITY_REVIEW_DIMENSIONS_V1.includes(row.dimension as QualityReviewDimensionV1) || !['suggestion', 'uncertain'].includes(String(row.confidence))) throw new Error('问题维度或不确定性标识无效。')
    const anchor = anchored && typeof row.anchorId === 'string' ? anchors.get(row.anchorId) : undefined
    if (anchored && !anchor) throw new Error('问题定位编号不属于当前正文，不能猜测引文。')
    const quote = anchor?.quote ?? text(row.quote, 'quote', 1000)
    let start = anchor?.start ?? row.start; let end = anchor?.end ?? row.end
    if (start === null && end === null) {
      const occurrence = input.chapterText.indexOf(quote)
      if (occurrence < 0 || input.chapterText.indexOf(quote, occurrence + 1) >= 0) throw new Error('引文不存在或重复，不能猜测问题位置。')
      start = occurrence; end = occurrence + quote.length
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) < 0 || (end as number) <= (start as number)
      || (end as number) > input.chapterText.length || input.chapterText.slice(start as number, end as number) !== quote) throw new Error('问题引文与正文位置不一致。')
    return { id: `${input.targetTextHash.slice(0, 12)}:${index + 1}`, dimension: row.dimension as QualityReviewDimensionV1, confidence: row.confidence as 'suggestion' | 'uncertain', quote, start: start as number, end: end as number,
      paragraph: paragraphNumber(input.chapterText, start as number, promptVersion),
      reason: text(row.reason, 'reason', 2000), suggestion: text(row.suggestion, 'suggestion', 2000) }
  })
  const settings = parseProseRequestSettingsV1(input.settings)
  if (input.generatorIdentity) {
    const generator = record(input.generatorIdentity, '生成模型身份')
    keys(generator, ['provider', 'model'], '生成模型身份')
    text(generator.provider, 'generator.provider', 100)
    text(generator.model, 'generator.model', 300)
  }
  const createdAt = input.createdAt ?? Date.now()
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error('评审时间无效。')
  const body: Omit<QualityReviewArtifactV1, 'artifactHash'> = {
    version: 1, type: 'whole-chapter-quality-review', mode: input.mode, targetTextHash: input.targetTextHash,
    coverage: { kind: 'whole-input', start: 0, end: input.chapterText.length, utf16Length: input.chapterText.length, paragraphs: input.chapterText.split(promptVersion === 'whole-chapter-quality-review-v1' || promptVersion === 'whole-chapter-quality-review-v2' ? /\n\s*\n/ : /\n+/).filter(value => value.trim()).length, requestHash: await hashCanonicalValue(input.messages) },
    reviewer: { provider: settings.provider, model: settings.model, promptVersion,
      correlatedJudge: !input.generatorIdentity || (input.generatorIdentity.provider === settings.provider && input.generatorIdentity.model === settings.model), generatorIdentity: input.generatorIdentity ? { ...input.generatorIdentity } : null, settings },
    issues, summary, strengths, createdAt,
  }
  return { ...body, artifactHash: await hashCanonicalValue(body) }
}

export async function verifyWholeChapterQualityReviewV1(artifact: QualityReviewArtifactV1, chapterText: string, messages: ChatMessage[]): Promise<boolean> {
  try {
    const { artifactHash, ...body } = artifact
    if (artifact.version !== 1 || artifact.type !== 'whole-chapter-quality-review' || artifactHash !== await hashCanonicalValue(body)
      || artifact.targetTextHash !== await hashCanonicalValue(chapterText) || artifact.coverage.start !== 0 || artifact.coverage.end !== chapterText.length || artifact.coverage.utf16Length !== chapterText.length) return false
    const raw = JSON.stringify({ summary: artifact.summary, strengths: artifact.strengths, issues: artifact.issues.map(({ dimension, confidence, quote, start, end, reason, suggestion }) => ({ dimension, confidence, quote, start, end, reason, suggestion })) })
    const reparsed = await parseWholeChapterQualityReviewV1({ raw, mode: artifact.mode, chapterText, targetTextHash: artifact.targetTextHash, messages, responseCompletion: 'complete', settings: artifact.reviewer.settings, promptVersion: artifact.reviewer.promptVersion, ...(artifact.reviewer.generatorIdentity ? { generatorIdentity: artifact.reviewer.generatorIdentity } : {}), createdAt: artifact.createdAt })
    return reparsed.artifactHash === artifact.artifactHash
  } catch { return false }
}
