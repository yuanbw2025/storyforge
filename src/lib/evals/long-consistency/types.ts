import type { ChatMessage } from '../../types'

export type LongConsistencyTask = 'completion' | 'continuation' | 'expansion'
export type EvalSplit = 'development' | 'held-out'

export interface LongConsistencyFixture {
  id: string
  split: EvalSplit
  task: LongConsistencyTask
  title: string
  chapterSummary: string
  worldContext: string
  characterContext: string
  previousChapterText: string
  existingContent: string
  selectedText: string
  userHint: string
  requiredFacts: Array<{ id: string; aliases: string[] }>
  requiredConstraints: Array<{ id: string; aliases: string[] }>
  forbiddenFutureFacts: Array<{ id: string; aliases: string[] }>
  forbiddenForeignWorldFacts: Array<{ id: string; aliases: string[] }>
  evidenceIds: string[]
}

export type EvalVariant = 'baseline-500-tail' | 'tail-summary' | 'handoff-tail-summary'
export type EvalBudgetMode = 'fixed' | 'natural'

export interface BuiltEvalCase {
  fixtureId: string
  variant: EvalVariant
  messages: ChatMessage[]
  inputChars: number
  productionSnapshot: {
    task: LongConsistencyTask
    previousTailChars: number
    builder: 'chapter.content' | 'chapter.continue' | 'chapter.expand'
  }
}

export interface CaseScore {
  fixtureId: string
  requiredFactRecall: number
  constraintRecall: number
  futureLeakage: boolean
  wrongWorldLeakage: boolean
  evidenceCitationRecall: number | null
  matchedRequiredFacts: string[]
  matchedConstraints: string[]
  leakedFutureFacts: string[]
  leakedForeignWorldFacts: string[]
  citedEvidenceIds: string[]
}

export interface EvalRunRecord {
  schemaVersion: 1
  runId: string
  createdAt: string
  provider: string
  model: string
  variant: EvalVariant
  split: EvalSplit
  budgetMode: EvalBudgetMode
  configuredMaxTokens: number
  results: Array<{
    fixtureId: string
    messages: ChatMessage[]
    productionSnapshot: BuiltEvalCase['productionSnapshot']
    output: string
    inputChars: number
    outputChars: number
    inputTokens: number | null
    outputTokens: number | null
    durationMs: number
    score: CaseScore
  }>
  aggregate: AggregateScore
}

export interface AggregateScore {
  caseCount: number
  requiredFactRecall: number
  constraintRecall: number
  futureLeakageRate: number
  wrongWorldLeakageRate: number
  evidenceCitationRecall: number | null
  estimatedInputTokens: number
  estimatedOutputTokens: number
}
