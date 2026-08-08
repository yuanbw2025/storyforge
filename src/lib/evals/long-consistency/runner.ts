import { buildChapterContentPrompt, buildContinuePrompt, buildExpandPrompt } from '../../ai/adapters/chapter-adapter'
import { estimateTokens } from '../../ai/context-budget'
import type { ChatMessage } from '../../types'
import type {
  AggregateScore,
  BuiltEvalCase,
  CaseScore,
  EvalRunRecord,
  EvalVariant,
  LongConsistencyFixture,
} from './types'

export const NS1_ACCEPTANCE_THRESHOLDS = Object.freeze({
  futureLeakageRate: 0,
  wrongWorldLeakageRate: 0,
  minimumRequiredFactRecall: 0.85,
  minimumConstraintRecall: 0.85,
  minimumEvidenceCitationRecall: 0.9,
  maximumEstimatedInputTokenMultiplierVsLegacy: 1.6,
  minimumFactRecallImprovementVsLegacy: 0.1,
})

export const NS0_FIXED_MAX_TOKENS = 1200

export interface Ns1GateResult {
  passed: boolean
  failures: string[]
}

export function evaluateNs1Gate(
  legacy: EvalRunRecord,
  candidate: EvalRunRecord,
  options: { requireFactImprovement?: boolean } = {},
): Ns1GateResult {
  const failures: string[] = []
  const metrics = candidate.aggregate
  if (metrics.futureLeakageRate > NS1_ACCEPTANCE_THRESHOLDS.futureLeakageRate) failures.push('future-leakage')
  if (metrics.wrongWorldLeakageRate > NS1_ACCEPTANCE_THRESHOLDS.wrongWorldLeakageRate) failures.push('wrong-world-leakage')
  if (metrics.requiredFactRecall < NS1_ACCEPTANCE_THRESHOLDS.minimumRequiredFactRecall) failures.push('fact-recall')
  if (metrics.constraintRecall < NS1_ACCEPTANCE_THRESHOLDS.minimumConstraintRecall) failures.push('constraint-recall')
  if (
    metrics.evidenceCitationRecall != null
    && metrics.evidenceCitationRecall < NS1_ACCEPTANCE_THRESHOLDS.minimumEvidenceCitationRecall
  ) failures.push('evidence-citation')
  if (
    metrics.estimatedInputTokens
    > legacy.aggregate.estimatedInputTokens * NS1_ACCEPTANCE_THRESHOLDS.maximumEstimatedInputTokenMultiplierVsLegacy
  ) failures.push('input-cost')
  if (
    options.requireFactImprovement !== false
    &&
    metrics.requiredFactRecall - legacy.aggregate.requiredFactRecall
    < NS1_ACCEPTANCE_THRESHOLDS.minimumFactRecallImprovementVsLegacy
  ) failures.push('fact-improvement')
  return { passed: failures.length === 0, failures }
}

/**
 * 候选变体喂给模型的"历史记忆"——由生产抽取器从【上一章真实正文】现抽，
 * 绝不注入夹具的 requiredFacts/requiredConstraints（那是评分答案）。
 * 这样 A/B 测的才是"从正文抽 handoff/摘要到底有没有把该带的事实带过去"，
 * 而不是"把答案抄给模型它会不会复述"。
 */
export interface ExtractedEvalMemory {
  handoffText: string
  summaryText: string
  extractionInputTokens: number | null
  extractionOutputTokens: number | null
  extractionInputChars: number
  extractionOutputChars: number
}

export const EMPTY_EVAL_MEMORY: ExtractedEvalMemory = {
  handoffText: '',
  summaryText: '',
  extractionInputTokens: null,
  extractionOutputTokens: null,
  extractionInputChars: 0,
  extractionOutputChars: 0,
}

function buildEvalContinuity(fixture: LongConsistencyFixture, variant: EvalVariant, memory: ExtractedEvalMemory) {
  if (variant === 'legacy-500-tail') return undefined
  return {
    handoff: memory.handoffText || undefined,
    previousTail: fixture.task === 'completion'
      ? fixture.previousChapterText.slice(-500)
      : undefined,
    recentSummaries: memory.summaryText
      ? `【当前世界最近已验证章节摘要】\n${memory.summaryText}`
      : undefined,
  }
}

/** expansion 任务的 builder 不吃 continuity 选项，对它把真实抽取记忆追加到末尾（非答案）。 */
function appendRealContinuity(messages: ChatMessage[], memory: ExtractedEvalMemory): ChatMessage[] {
  const extras = [memory.summaryText, memory.handoffText].filter(Boolean)
  if (!extras.length) return messages
  return messages.map((message, index) => {
    if (index !== messages.length - 1 || message.role !== 'user') return message
    return { ...message, content: `${message.content}\n\n【前文连续性记忆】\n${extras.join('\n')}` }
  })
}

export function buildEvalCase(
  fixture: LongConsistencyFixture,
  variant: EvalVariant,
  memory: ExtractedEvalMemory = EMPTY_EVAL_MEMORY,
): BuiltEvalCase {
  let messages: ChatMessage[]
  let builder: BuiltEvalCase['productionSnapshot']['builder']
  let previousTailChars = 0

  if (fixture.task === 'completion') {
    const previousTail = fixture.previousChapterText.slice(-500)
    previousTailChars = previousTail.length
    builder = 'chapter.content'
    messages = buildChapterContentPrompt(
      fixture.title,
      fixture.chapterSummary,
      fixture.worldContext,
      fixture.characterContext,
      previousTail,
      '',
      fixture.userHint,
      {
        parameterValues: { chapterLength: 800, pace: '中', tone: '严肃' },
        continuity: buildEvalContinuity(fixture, variant, memory),
        continuityBudgetTokens: 3000,
        skipContinuityEnvelope: variant === 'legacy-500-tail',
      },
    )
  } else if (fixture.task === 'continuation') {
    builder = 'chapter.continue'
    messages = buildContinuePrompt(
      fixture.existingContent,
      fixture.chapterSummary,
      `${fixture.worldContext}\n\n涉及角色：\n${fixture.characterContext}`,
      fixture.userHint,
      {
        parameterValues: { continueLength: 800, pace: '中', tone: '严肃' },
        continuity: buildEvalContinuity(fixture, variant, memory),
        continuityBudgetTokens: 3000,
        skipContinuityEnvelope: variant === 'legacy-500-tail',
      },
    )
  } else {
    builder = 'chapter.expand'
    messages = buildExpandPrompt(
      fixture.selectedText,
      fixture.userHint,
      { parameterValues: { expandRatio: '1.5x', addType: '动作细节' } },
    )
  }

  const finalMessages = fixture.task === 'expansion' && variant !== 'legacy-500-tail'
    ? appendRealContinuity(messages, memory)
    : messages
  return {
    fixtureId: fixture.id,
    variant,
    messages: finalMessages,
    inputChars: finalMessages.reduce((sum, message) => sum + message.content.length, 0),
    productionSnapshot: {
      task: fixture.task,
      previousTailChars,
      builder,
    },
  }
}

function findMatches(text: string, entries: Array<{ id: string; aliases: string[] }>): string[] {
  const normalized = text.toLocaleLowerCase()
  return entries
    .filter(entry => entry.aliases.some(alias => normalized.includes(alias.toLocaleLowerCase())))
    .map(entry => entry.id)
}

export function scoreOutput(fixture: LongConsistencyFixture, output: string): CaseScore {
  const matchedRequiredFacts = findMatches(output, fixture.requiredFacts)
  const matchedConstraints = findMatches(output, fixture.requiredConstraints)
  const leakedFutureFacts = findMatches(output, fixture.forbiddenFutureFacts)
  const leakedForeignWorldFacts = findMatches(output, fixture.forbiddenForeignWorldFacts)
  const citedEvidenceIds = fixture.evidenceIds.filter(id => output.includes(`[证据:${id}]`))

  return {
    fixtureId: fixture.id,
    requiredFactRecall: fixture.requiredFacts.length === 0 ? 1 : matchedRequiredFacts.length / fixture.requiredFacts.length,
    constraintRecall: fixture.requiredConstraints.length === 0 ? 1 : matchedConstraints.length / fixture.requiredConstraints.length,
    futureLeakage: leakedFutureFacts.length > 0,
    wrongWorldLeakage: leakedForeignWorldFacts.length > 0,
    evidenceCitationRecall: fixture.evidenceIds.length === 0 ? null : citedEvidenceIds.length / fixture.evidenceIds.length,
    matchedRequiredFacts,
    matchedConstraints,
    leakedFutureFacts,
    leakedForeignWorldFacts,
    citedEvidenceIds,
  }
}

export function aggregateScores(
  results: EvalRunRecord['results'],
): AggregateScore {
  const evidenceScores = results
    .map(result => result.score.evidenceCitationRecall)
    .filter((value): value is number => value !== null)
  const count = results.length || 1

  return {
    caseCount: results.length,
    requiredFactRecall: results.reduce((sum, result) => sum + result.score.requiredFactRecall, 0) / count,
    constraintRecall: results.reduce((sum, result) => sum + result.score.constraintRecall, 0) / count,
    futureLeakageRate: results.filter(result => result.score.futureLeakage).length / count,
    wrongWorldLeakageRate: results.filter(result => result.score.wrongWorldLeakage).length / count,
    evidenceCitationRecall: evidenceScores.length === 0
      ? null
      : evidenceScores.reduce((sum, value) => sum + value, 0) / evidenceScores.length,
    estimatedInputTokens: results.reduce(
      (sum, result) => sum + (result.inputTokens ?? Math.round(result.inputChars * 0.75)),
      0,
    ),
    estimatedOutputTokens: results.reduce(
      (sum, result) => sum + (result.outputTokens ?? estimateTokens(result.output)),
      0,
    ),
  }
}
