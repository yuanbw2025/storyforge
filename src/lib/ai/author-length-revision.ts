import type { TaskLengthPlanV1 } from '../types/agent-run'
import { countWords, htmlToPlainText } from '../utils/html'
import { describeTaskLengthPlanV1, parseTaskLengthPlanV1 } from './author-length-intent'

export interface AuthorLengthObservationV1 {
  version: 1
  countingVersion: 'non-whitespace-utf16-v1'
  mode: TaskLengthPlanV1['mode']
  basis: TaskLengthPlanV1['basis']
  representation: 'plain-text' | 'editor-html'
  candidateKind: 'complete-replacement' | 'additional-fragment'
  textWords: number
  baselineWords: number
  finalWords: number
  additionalWords: number
  measuredWords: number
  status: 'automatic' | 'within' | 'short' | 'long'
  distance: number | null
}
export interface AuthorLengthRoundV1 {
  resultHash: string
  observation: AuthorLengthObservationV1
}
function readable(text: string, representation: 'plain-text' | 'editor-html'): string {
  if (typeof text !== 'string') throw new Error('待计数内容必须是字符串。')
  if (!['plain-text', 'editor-html'].includes(representation)) throw new Error('计数表示无效。')
  return representation === 'editor-html' ? htmlToPlainText(text) : text
}
function lengthState(plan: TaskLengthPlanV1, measured: number): Pick<AuthorLengthObservationV1, 'status' | 'distance'> {
  if (plan.mode === 'automatic') return { status: 'automatic', distance: null }
  const { minWords, maxWords } = plan.intent.acceptance
  if (minWords !== null && measured < minWords) return { status: 'short', distance: minWords - measured }
  if (maxWords !== null && measured > maxWords) return { status: 'long', distance: measured - maxWords }
  return { status: 'within', distance: 0 }
}
export function observeAuthorLengthV1(input: {
  plan: TaskLengthPlanV1; text: string; representation: 'plain-text' | 'editor-html'
  candidateKind: 'complete-replacement' | 'additional-fragment'
  baseline?: { text: string; representation: 'plain-text' | 'editor-html' }
}): AuthorLengthObservationV1 {
  const plan = parseTaskLengthPlanV1(input.plan)
  if (!['plain-text', 'editor-html'].includes(input.representation)
    || !['complete-replacement', 'additional-fragment'].includes(input.candidateKind)) throw new Error('计数表示或候选范围无效。')
  if (plan.basis === 'additional-text' && input.candidateKind === 'complete-replacement' && !input.baseline) throw new Error('完整替换稿的净新增计数需要冻结原稿。')
  const textWords = countWords(readable(input.text, input.representation))
  const baselineWords = input.baseline ? countWords(readable(input.baseline.text, input.baseline.representation)) : 0
  const finalWords = input.candidateKind === 'additional-fragment' ? baselineWords + textWords : textWords
  const additionalWords = input.candidateKind === 'additional-fragment' ? textWords : Math.max(0, textWords - baselineWords)
  const measuredWords = plan.basis === 'additional-text' ? additionalWords : finalWords
  return { version: 1, countingVersion: 'non-whitespace-utf16-v1', mode: plan.mode, basis: plan.basis,
    representation: input.representation, candidateKind: input.candidateKind,
    textWords, baselineWords, finalWords, additionalWords, measuredWords, ...lengthState(plan, measuredWords) }
}
function verifyRound(plan: TaskLengthPlanV1, round: AuthorLengthRoundV1): void {
  const row = round.observation
  const keys = ['version', 'countingVersion', 'mode', 'basis', 'representation', 'candidateKind', 'textWords', 'baselineWords', 'finalWords', 'additionalWords', 'measuredWords', 'status', 'distance']
  if (Object.keys(row).sort().join('|') !== keys.sort().join('|')
    || !['plain-text', 'editor-html'].includes(row.representation)
    || !['complete-replacement', 'additional-fragment'].includes(row.candidateKind)) throw new Error('修订计数范围无效。')
  if (!/^[a-f0-9]{64}$/.test(round.resultHash) || row.version !== 1 || row.countingVersion !== plan.countingVersion
    || row.mode !== plan.mode || row.basis !== plan.basis
    || [row.textWords, row.baselineWords, row.finalWords, row.additionalWords, row.measuredWords].some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('修订计数证据无效。')
  const expectedFinal = row.candidateKind === 'additional-fragment' ? row.baselineWords + row.textWords : row.textWords
  const expectedAdditional = row.candidateKind === 'additional-fragment' ? row.textWords : Math.max(0, row.textWords - row.baselineWords)
  if (row.finalWords !== expectedFinal || row.additionalWords !== expectedAdditional) throw new Error('修订计数的全文与净新增不一致。')
  const derived = lengthState(plan, row.measuredWords)
  if (row.status !== derived.status || row.distance !== derived.distance
    || row.measuredWords !== (plan.basis === 'additional-text' ? row.additionalWords : row.finalWords)) throw new Error('修订计数与作者目标不一致。')
}
export type AuthorLengthRevisionDecisionV1 = {
  action: 'ready' | 'revise-length' | 'continue-incomplete' | 'continue-task' | 'needs-attention' | 'cancelled' | 'stale'
  reason: string
  bestResultHash: string | null
}
export function planAuthorLengthRevisionV1(input: {
  plan: TaskLengthPlanV1; current: AuthorLengthRoundV1; priorValidRounds?: readonly AuthorLengthRoundV1[]
  completion: 'complete' | 'incomplete' | 'failed' | 'unknown'
  structuralValid: boolean; semanticComplete: boolean | null
  semanticProgress: 'advanced' | 'stalled' | 'unknown'
  cancelled?: boolean; stale?: boolean; explicitConsumptionReached?: boolean
}): AuthorLengthRevisionDecisionV1 {
  const plan = parseTaskLengthPlanV1(input.plan)
  const prior = input.priorValidRounds ?? []
  verifyRound(plan, input.current)
  prior.forEach(round => verifyRound(plan, round))
  const currentEligible = input.structuralValid && input.completion === 'complete'
  const valid = [...prior, ...(currentEligible ? [input.current] : [])]
  const best = plan.mode === 'explicit'
    ? valid.reduce<AuthorLengthRoundV1 | null>((best, round) => !best || round.observation.distance! <= best.observation.distance! ? round : best, null)
    : currentEligible && (prior.length === 0 || input.semanticComplete === true || input.semanticProgress === 'advanced')
      ? input.current : prior[prior.length - 1] ?? null
  const decision = (action: AuthorLengthRevisionDecisionV1['action'], reason: string): AuthorLengthRevisionDecisionV1 => ({ action, reason, bestResultHash: best?.resultHash ?? null })
  if (input.cancelled) return decision('cancelled', '作者已停止；保留可得原答。')
  if (input.stale) return decision('stale', '来源或目标已变化；不继续派发。')
  if (input.explicitConsumptionReached) return decision('needs-attention', '已达到作者明确消费约束。')
  if (input.completion === 'unknown' || input.completion === 'failed') return decision('needs-attention', '派发结果不可靠；不自动重发。')
  if (!input.structuralValid) return decision('needs-attention', '沿现有结构/来源修复通道处理，不能借长度校正重置次数。')
  const repeated = prior.some(round => round.resultHash === input.current.resultHash)
  if (repeated) return decision('needs-attention', '结果重复，停止自动循环并保留稿件。')
  if (input.completion === 'incomplete') return input.semanticProgress === 'advanced'
    ? decision('continue-incomplete', '按已验证完成范围继续未完成内容，不重放已接受片段。')
    : decision('needs-attention', '不完整回答缺少可确认进展。')
  if (plan.mode === 'explicit') {
    if (input.current.observation.distance === 0) return input.semanticComplete === true
      ? decision('ready', '字数和内容职责均已满足。') : decision('needs-attention', '字数已满足，内容职责仍需核对。')
    const preceding = prior[prior.length - 1]
    if (preceding && input.current.observation.distance! >= preceding.observation.distance!) return decision('needs-attention', '与上一完整修订相比没有更接近目标。')
    return decision('revise-length', describeTaskLengthPlanV1(plan))
  }
  if (input.semanticComplete === true) return decision('ready', '自动安排的内容职责已完成。')
  return input.semanticComplete === false && input.semanticProgress === 'advanced'
    ? decision('continue-task', '按尚未完成的内容职责继续，不把参考字数当上限。')
    : decision('needs-attention', '没有可验证内容进展，保留已有稿件。')
}
export function authorLengthRevisionInstructionV1(plan: TaskLengthPlanV1, observation: AuthorLengthObservationV1): string {
  if (plan.mode !== 'explicit' || observation.distance === null || observation.distance === 0) throw new Error('没有待校正的明确字数偏差。')
  return `${describeTaskLengthPlanV1(plan)}当前计入${observation.measuredWords}字，${observation.status === 'short' ? '请补齐必要细节' : '请精炼重复表述'}，保留全部已确认事实、人物与任务边界。交付完整目标候选；程序不会截稿或填充凑字。`
}
