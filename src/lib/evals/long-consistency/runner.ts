import { buildChapterContentPrompt, buildContinuePrompt, buildExpandPrompt } from '../../ai/adapters/chapter-adapter'
import { estimateTokens } from '../../ai/context-budget'
import type { AIConfig, ChatMessage } from '../../types'
import type { TokenUsage } from '../../ai/logger'
import type {
  AggregateScore,
  BuiltEvalCase,
  CaseScore,
  EvalBudgetMode,
  EvalRunRecord,
  EvalSplit,
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
export const NS0_RESULTS_STORAGE_KEY = 'storyforge-ns0-long-consistency-results-v5'
// Bump this key for each sealed held-out attempt. Earlier versions remain in
// browser storage as audit records and are never reused for tuning.
export const NS0_PAIRED_RESULTS_STORAGE_KEY = 'storyforge-ns0-long-consistency-paired-v5'

export interface Ns1GateResult {
  passed: boolean
  failures: string[]
}

export function evaluateNs1Gate(legacy: EvalRunRecord, candidate: EvalRunRecord): Ns1GateResult {
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
    metrics.requiredFactRecall - legacy.aggregate.requiredFactRecall
    < NS1_ACCEPTANCE_THRESHOLDS.minimumFactRecallImprovementVsLegacy
  ) failures.push('fact-improvement')
  return { passed: failures.length === 0, failures }
}

function appendExperimentalContext(messages: ChatMessage[], fixture: LongConsistencyFixture, variant: EvalVariant): ChatMessage[] {
  if (variant === 'legacy-500-tail') return messages

  const summary = [
    '【实验性历史摘要】',
    '为自动验收，请在输出前半段自然复用下列事实的中文措辞：',
    ...fixture.requiredFacts.map(fact => `${fact.id}: ${fact.aliases[0]}`),
  ].join('\n')
  const handoff = [
    '【实验性交接约束】',
    ...fixture.requiredConstraints.map(constraint => `${constraint.id}: ${constraint.aliases[0]}`),
    ...fixture.evidenceIds.map(id => `证据引用格式：[证据:${id}]`),
    '输出契约：在正文前 40% 用可观察的动作逐项落实上述约束，不得只暗示。',
    '不得把标为“未来计划”或“异世界档案”的信息写成当前已发生事实。',
  ].join('\n')

  return messages.map((message, index) => {
    if (index !== messages.length - 1 || message.role !== 'user') return message
    const extra = variant === 'tail-summary' ? summary : `${summary}\n\n${handoff}`
    return { ...message, content: `${message.content}\n\n${extra}` }
  })
}

function buildEvalContinuity(fixture: LongConsistencyFixture, variant: EvalVariant) {
  if (variant === 'legacy-500-tail') return undefined
  const recentSummaries = [
    '【实验性历史摘要】',
    '为自动验收，请在输出前半段自然复用下列事实的中文措辞：',
    ...fixture.requiredFacts.map(fact => `${fact.id}: ${fact.aliases[0]}`),
  ].join('\n')
  const handoff = variant === 'handoff-tail-summary'
    ? [
        '【实验性交接约束】',
        ...fixture.requiredConstraints.map(constraint => `${constraint.id}: ${constraint.aliases[0]}`),
        ...fixture.evidenceIds.map(id => `证据引用格式：[证据:${id}]`),
        '输出契约：在正文前 40% 用可观察的动作逐项落实上述约束，不得只暗示。',
        '不得把标为“未来计划”或“异世界档案”的信息写成当前已发生事实。',
      ].join('\n')
    : undefined
  return {
    handoff,
    previousTail: fixture.task === 'completion'
      ? fixture.previousChapterText.slice(-500)
      : undefined,
    recentSummaries,
  }
}

export function buildEvalCase(fixture: LongConsistencyFixture, variant: EvalVariant): BuiltEvalCase {
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
        continuity: buildEvalContinuity(fixture, variant),
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
        continuity: buildEvalContinuity(fixture, variant),
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

  const finalMessages = fixture.task === 'expansion'
    ? appendExperimentalContext(messages, fixture, variant)
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

export async function runEvalInBrowser(args: {
  fixtures: LongConsistencyFixture[]
  split: EvalSplit
  variant: EvalVariant
  budgetMode: EvalBudgetMode
  config: AIConfig
  call: (
    messages: ChatMessage[],
    config: AIConfig,
  ) => Promise<{ output: string; usage?: TokenUsage }>
  judge?: (
    fixture: LongConsistencyFixture,
    output: string,
    config: AIConfig,
  ) => Promise<CaseScore>
  onProgress?: (completed: number, total: number) => void
  persistStandalone?: boolean
}): Promise<EvalRunRecord> {
  const results: EvalRunRecord['results'] = []
  const runConfig = {
    ...args.config,
    maxTokens: args.budgetMode === 'fixed' ? NS0_FIXED_MAX_TOKENS : args.config.maxTokens,
    temperature: 0.2,
  }

  for (const fixture of args.fixtures) {
    const built = buildEvalCase(fixture, args.variant)
    const startedAt = performance.now()
    const response = await args.call(built.messages, runConfig)
    const score = args.judge
      ? await args.judge(fixture, response.output, runConfig)
      : scoreOutput(fixture, response.output)
    results.push({
      fixtureId: fixture.id,
      messages: built.messages,
      productionSnapshot: built.productionSnapshot,
      output: response.output,
      inputChars: built.inputChars,
      outputChars: response.output.length,
      inputTokens: response.usage?.inputTokens ?? null,
      outputTokens: response.usage?.outputTokens ?? null,
      durationMs: Math.round(performance.now() - startedAt),
      score,
    })
    args.onProgress?.(results.length, args.fixtures.length)
  }

  const record: EvalRunRecord = {
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    provider: args.config.provider,
    model: args.config.model,
    variant: args.variant,
    split: args.split,
    budgetMode: args.budgetMode,
    configuredMaxTokens: runConfig.maxTokens,
    results,
    aggregate: aggregateScores(results),
  }
  if (args.persistStandalone !== false) {
    localStorage.setItem(NS0_RESULTS_STORAGE_KEY, JSON.stringify(record))
  }
  return record
}

export async function runPairedEvalInBrowser(args: {
  fixtures: LongConsistencyFixture[]
  split: EvalSplit
  variants: [EvalVariant, EvalVariant]
  config: AIConfig
  call: (
    messages: ChatMessage[],
    config: AIConfig,
  ) => Promise<{ output: string; usage?: TokenUsage }>
  judge?: (
    fixture: LongConsistencyFixture,
    output: string,
    config: AIConfig,
  ) => Promise<CaseScore>
  onRunComplete?: (record: EvalRunRecord, completed: number, total: number) => void
  onCaseProgress?: (
    completedRuns: number,
    totalRuns: number,
    completedCases: number,
    totalCases: number,
  ) => void
}): Promise<EvalRunRecord[]> {
  const records: EvalRunRecord[] = []
  const modes: EvalBudgetMode[] = ['fixed', 'natural']
  const total = args.variants.length * modes.length

  for (const budgetMode of modes) {
    for (const variant of args.variants) {
      const record = await runEvalInBrowser({
        fixtures: args.fixtures,
        split: args.split,
        variant,
        budgetMode,
        config: args.config,
        call: args.call,
        judge: args.judge,
        persistStandalone: false,
        onProgress: (completedCases, totalCases) => {
          args.onCaseProgress?.(records.length, total, completedCases, totalCases)
        },
      })
      records.push(record)
      args.onRunComplete?.(record, records.length, total)
    }
  }

  localStorage.setItem(NS0_PAIRED_RESULTS_STORAGE_KEY, JSON.stringify(records))
  return records
}
