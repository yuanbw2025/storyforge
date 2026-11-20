import type { ChatMessage } from '../types'
import { referenceRequestTokens, ReferenceServiceWindowError } from './request-capacity'

export interface ReferenceRequestSelectionV1 {
  start: number
  end: number
  sourceLength: number
  /** Every returned model answer remains in its original request evidence. */
  part: string
}
export interface ReferenceObservedAnswerV1 {
  raw: string
  artifactHash?: string
  finishReason?: string
}

export type ReferenceCompletedAnswerV1 = ReferenceObservedAnswerV1 & { selection: ReferenceRequestSelectionV1; requestTokens?: number }

/** Only an explicit context rejection is evidence that a request was not generated. */
export function isReferenceContextRejectionV1(error: unknown): boolean {
  const row = error as { status?: number; message?: string; referenceConfirmedContextRejection?: boolean }
  return (row?.status === 400 || row?.referenceConfirmedContextRejection === true) && /context_length_exceeded|maximum context length|exceeds.*context|context window.*exceed|too many tokens/i.test(row.message ?? '')
}

/** No fixed chunks, layers, output lengths or total call quota. Splitting is lossless. */
export async function runAdaptiveReferenceRequestsV1(input: {
  source: string
  completed?: ReferenceCompletedAnswerV1[]
  validateAnswer?: (answer: ReferenceObservedAnswerV1, selection: ReferenceRequestSelectionV1) => void
  onCheckpoint?: (completed: ReferenceCompletedAnswerV1[]) => Promise<void>
  inputLimit: number | null
  messages: (selection: ReferenceRequestSelectionV1) => ChatMessage[]
  invoke: (messages: ChatMessage[], selection: ReferenceRequestSelectionV1) => Promise<ReferenceObservedAnswerV1>
}): Promise<Array<ReferenceObservedAnswerV1 & { selection: ReferenceRequestSelectionV1; requestTokens?: number }>> {
  const completed = [...(input.completed ?? [])]
  let offset = 0
  for (const answer of completed) {
    const range = answer.selection
    if (range.start !== offset || range.end <= offset || range.end > input.source.length
      || range.sourceLength !== input.source.length || range.part !== input.source.slice(range.start, range.end)) {
      throw new Error('拆书恢复范围或原始资料不匹配。')
    }
    offset = range.end
  }
  const queue = offset < input.source.length ? [{ start: offset, end: input.source.length }] : []
  while (queue.length) {
    const range = queue.shift()!
    const selection = { ...range, sourceLength: input.source.length, part: input.source.slice(range.start, range.end) }
    const messages = input.messages(selection)
    let split = input.inputLimit != null && referenceRequestTokens(messages) >= input.inputLimit
    if (!split) {
      try {
        const answer = await input.invoke(messages, selection)
        if (answer.finishReason === 'content_filter') throw new Error('服务过滤导致回答未完成；原资料与回答已保留，未自动重发。')
        if (!['length', 'max_tokens', 'MAX_TOKENS'].includes(answer.finishReason ?? '')) {
          // Invalid JSON is a protocol failure, never silently transformed into a completed batch.
          const parsed: unknown = JSON.parse(answer.raw)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('拆书结果必须为 JSON 对象。')
          input.validateAnswer?.(answer, selection)
          completed.push({ ...answer, selection, requestTokens: referenceRequestTokens(messages) })
          await input.onCheckpoint?.([...completed])
          continue
        }
        split = true
      } catch (error) {
        if (!(error instanceof ReferenceServiceWindowError) && !isReferenceContextRejectionV1(error)) throw error
        split = true
      }
    }
    if (split) {
      // Split at a Unicode boundary. Never drop a suffix or advance over an unprocessed range.
      let middle = range.start + Math.floor((range.end - range.start) / 2)
      // Prefer a complete sentence/paragraph nearest the balanced split. Fall back
      // to a Unicode boundary only when an individual sentence itself cannot fit.
      for (let distance = 0; distance < range.end - range.start; distance++) {
        const before = middle - distance
        const after = middle + distance
        if (before > range.start && before < range.end && /[。！？\n]/.test(input.source[before - 1])) { middle = before; break }
        if (after > range.start && after < range.end && /[。！？\n]/.test(input.source[after - 1])) { middle = after; break }
      }
      if (middle > range.start && /[\uDC00-\uDFFF]/.test(input.source[middle])) middle--
      if (middle <= range.start || middle >= range.end) {
        throw new Error('实际服务无法容纳最低拆书协议和一个完整字符；原资料与响应已保留，任务未完成。')
      }
      queue.unshift({ start: range.start, end: middle }, { start: middle, end: range.end })
    }
  }
  return completed
}

export function referenceSelectionContextV1(selection: ReferenceRequestSelectionV1): string {
  return `【实际选读范围 ${selection.start}—${selection.end}/${selection.sourceLength}，字符偏移；不是作品章节边界】\n${selection.part}\n【边界】保留身份、时序因果、跨章线索、反证和解释边界；跨范围无法确认的关系标明未确定。`
}

export const REFERENCE_COMPRESSION_INDEX_INSTRUCTION_V1 = '分批字符偏移、派生层编号不是原块号，不能替换材料已有的原始块号。不要把日常行动自动解释为回避、动机、责任转移或弧线目标。必须区分材料明示事实、材料已有解读与本次归纳，关系解释须有分区证据。局部没有读到不能推翻另一分区的明示事实，已明确的行动不能重新标成未确定。当前只建立跨范围事实/关系索引：每条保留身份、知情先后、交接因果、独立反证与不确定性，用短语而非重复长段议论。不要重复范围声明、任务说明和材料不足套话；原始完整分批分析另行保留，可按来源回看。'

export interface ReferenceGlobalProgressV1 {
  source: string
  completed: ReferenceCompletedAnswerV1[]
}

/** Compression is an additional, sourced analysis. Complete leaf answers are never replaced. */
export async function reviewReferenceAcrossBatchesV1(input: {
  answers: ReferenceCompletedAnswerV1[]
  inputLimit: number | null
  resume?: ReferenceGlobalProgressV1
  messages: (selection: ReferenceRequestSelectionV1) => ChatMessage[]
  invoke: (messages: ChatMessage[], selection: ReferenceRequestSelectionV1) => Promise<ReferenceObservedAnswerV1>
  checkpoint?: (progress: ReferenceGlobalProgressV1) => Promise<void>
}): Promise<string> {
  let source = input.resume?.source ?? JSON.stringify(input.answers.map(answer => ({
    sourceRange: [answer.selection.start, answer.selection.end], analysis: JSON.parse(answer.raw),
  })))
  let completed = input.resume?.completed
  for (;;) {
    const observedFit = input.answers.reduce((largest, answer) => Math.max(largest, answer.requestTokens ?? 0), 0)
    // A requested representation target is derived from this service window (or an
    // actually accepted request), never a permanent output ceiling. Leaf reports
    // remain available in full, including every qualification and counterexample.
    const workingWindow = input.inputLimit ?? (observedFit || null)
    const instruction = REFERENCE_COMPRESSION_INDEX_INSTRUCTION_V1
    const empty = { start: 0, end: 0, sourceLength: source.length, part: '' }
    const emptyMessages = [...input.messages(empty), { role: 'user' as const, content: instruction }]
    const payloadRoom = workingWindow == null ? null : Math.max(0, workingWindow - referenceRequestTokens(emptyMessages))
    const sourceTokens = Math.max(1, referenceRequestTokens([{ role: 'user', content: source }]))
    const reviewed = await runAdaptiveReferenceRequestsV1({ source, inputLimit: input.inputLimit,
      completed, messages: selection => {
        const share = referenceRequestTokens([{ role: 'user', content: selection.part }]) / sourceTokens
        const target = payloadRoom == null ? null : Math.floor(payloadRoom * share)
        return [...input.messages(selection), { role: 'user' as const,
          content: instruction + (target != null && target > 0 ? ` 为使其它分区也能进入下一轮已观测窗口，本分区派生索引目标约 ${target} tokens；这是本轮容纳计划，不是字段/作品/输出上限。保留事实与反证，不要复述原文或重复评论。` : ''),
        }]
      }, invoke: input.invoke,
      onCheckpoint: answers => input.checkpoint?.({ source, completed: answers }) ?? Promise.resolve(),
    })
    if (reviewed.length === 1) return reviewed[0].raw
    const next = JSON.stringify(reviewed.map(answer => ({ sourceRange: [answer.selection.start, answer.selection.end], analysis: JSON.parse(answer.raw) })))
    if (next.length >= source.length) {
      throw new Error('服务窗口内的分层综合没有取得压缩进展；原资料及所有分层回答已保留，整体综合尚未完成。')
    }
    source = next
    completed = undefined
  }
}
