import { createAgentContextCompressionSessionV1 } from '../../agent/context-compression'
import { getAgentSkillV1 } from '../../agent/skill-registry'
import { AgentTeamBudgetTracker } from '../../agent/team-budget'
import { estimateTokens } from '../../ai/context-budget'
import { hashCanonicalValue } from '../../agent/run/hash'
import { sha256Text } from '../../ai/chapter-memory/text-normalization'
import { capContextSourceByBudget } from '../../registry/assemble-context'
import type { AIConfig, ChatMessage } from '../../types'
import { scoreOutput } from '../long-consistency/runner'
import type { LongConsistencyFixture } from '../long-consistency/types'
import {
  CONTEXT_COMPRESSION_EVAL_VARIANTS,
  type ContextCompressionEvalAggregateV1,
  type ContextCompressionEvalCallUsageV1,
  type ContextCompressionEvalCaseResultV1,
  type ContextCompressionEvalGateV1,
  type ContextCompressionEvalRecordV1,
  type ContextCompressionEvalVariant,
} from './types'

export const H17_CONTEXT_COMPRESSION_RESULTS_STORAGE_KEY = 'storyforge:h17-context-compression-eval-v1'
export const H17_CONTEXT_COMPRESSION_PROMPT_VERSION = 'h17-context-delivery-eval-v1'

export const H17_CONTEXT_COMPRESSION_THRESHOLDS = {
  maximumRecallRegression: 0.02,
  maximumFutureLeakageRate: 0,
  maximumWrongWorldLeakageRate: 0,
  minimumGenerationInputReduction: 0.25,
  maximumFallbackRate: 0,
} as const

export interface ContextCompressionEvalCallResultV1 {
  output: string
  usage?: ContextCompressionEvalCallUsageV1
}

export type ContextCompressionEvalCallV1 = (
  messages: ChatMessage[],
  config: AIConfig,
  phase: 'compression' | 'generation',
) => Promise<ContextCompressionEvalCallResultV1>

interface CallTotals {
  calls: number
  inputTokens: number
  outputTokens: number
}

function sumMessageTokens(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
}

function measuredUsage(
  messages: readonly ChatMessage[],
  output: string,
  usage?: ContextCompressionEvalCallUsageV1,
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: usage?.inputTokens ?? sumMessageTokens(messages),
    outputTokens: usage?.outputTokens ?? estimateTokens(output),
  }
}

/**
 * The answer labels stay outside the model-visible source. The source is laid
 * out so the registered head cap loses distant continuity while full and
 * semantic variants can still recover it.
 */
export function buildContextCompressionEvalSourceV1(fixture: LongConsistencyFixture): string {
  const [continuity = '', background = ''] = fixture.previousChapterText.split(/\n\n/u, 2)
  return [
    `【已确认世界与信息边界】${fixture.worldContext}`,
    `【已确认角色边界】${fixture.characterContext}`,
    `【长篇历史背景记录】${background}`,
    `【上一章连续性事实】${continuity}`,
  ].join('\n\n')
}

export function buildContextCompressionEvalMessagesV1(input: {
  fixture: LongConsistencyFixture
  deliveredContext: string
}): ChatMessage[] {
  return [{
    role: 'system',
    content: `你是中文长篇小说创作 Agent。严格依据给定的已确认上下文续写当前任务。
标为“未来计划（尚未发生）”的内容不得提前发生；标为“异世界档案”的内容不得混入当前世界。
不得解释规则，不得输出分析，只输出完成任务所需的小说正文。`,
  }, {
    role: 'user',
    content: [
      `【章节】${input.fixture.title}`,
      `【本章目标】${input.fixture.chapterSummary}`,
      `【作者要求】${input.fixture.userHint}`,
      ...(input.fixture.existingContent ? [`【已有正文】${input.fixture.existingContent}`] : []),
      ...(input.fixture.selectedText ? [`【待扩写片段】${input.fixture.selectedText}`] : []),
      '【受治理上下文】',
      input.deliveredContext,
    ].join('\n\n'),
  }]
}

function aggregate(results: readonly ContextCompressionEvalCaseResultV1[]): ContextCompressionEvalAggregateV1 {
  const count = results.length || 1
  const sum = (read: (result: ContextCompressionEvalCaseResultV1) => number): number => (
    results.reduce((total, result) => total + read(result), 0)
  )
  return {
    caseCount: results.length,
    requiredFactRecall: sum(result => result.score.requiredFactRecall) / count,
    constraintRecall: sum(result => result.score.constraintRecall) / count,
    futureLeakageRate: sum(result => Number(result.score.futureLeakage)) / count,
    wrongWorldLeakageRate: sum(result => Number(result.score.wrongWorldLeakage)) / count,
    averageSourceOriginalTokens: Math.round(sum(result => result.sourceOriginalTokens) / count),
    averageDeliveredContextTokens: Math.round(sum(result => result.deliveredContextTokens) / count),
    generationInputTokens: sum(result => result.generationInputTokens),
    generationOutputTokens: sum(result => result.generationOutputTokens),
    compressionInputTokens: sum(result => result.compressionInputTokens),
    compressionOutputTokens: sum(result => result.compressionOutputTokens),
    totalInputTokens: sum(result => result.totalInputTokens),
    totalOutputTokens: sum(result => result.totalOutputTokens),
    modelCalls: sum(result => result.modelCalls),
    fallbackRate: sum(result => Number(result.compression?.outcome === 'fallback')) / count,
    latencyMs: sum(result => result.durationMs),
  }
}

function recordBody(record: ContextCompressionEvalRecordV1): Omit<ContextCompressionEvalRecordV1, 'recordHash'> {
  const { recordHash: _recordHash, ...body } = record
  return body
}

export async function verifyContextCompressionEvalRecordV1(
  record: ContextCompressionEvalRecordV1,
): Promise<boolean> {
  return await hashCanonicalValue(recordBody(record)) === record.recordHash
}

async function runVariantCase(input: {
  fixture: LongConsistencyFixture
  variant: ContextCompressionEvalVariant
  contextTargetTokens: number
  generationConfig: AIConfig
  call: ContextCompressionEvalCallV1
}): Promise<ContextCompressionEvalCaseResultV1> {
  const startedAt = performance.now()
  const sourceText = buildContextCompressionEvalSourceV1(input.fixture)
  const sourceOriginalTokens = estimateTokens(sourceText)
  if (sourceOriginalTokens <= input.contextTargetTokens) {
    throw new Error(`H17 fixture ${input.fixture.id} 未超过上下文压缩目标，无法形成有效对照`)
  }
  let deliveredContext = sourceText
  let delivery: ContextCompressionEvalCaseResultV1['delivery'] = 'full'
  let compression: ContextCompressionEvalCaseResultV1['compression']
  const compressionTotals: CallTotals = { calls: 0, inputTokens: 0, outputTokens: 0 }
  const budget = new AgentTeamBudgetTracker('expanded')

  if (input.variant === 'deterministic-truncation') {
    const capped = capContextSourceByBudget(sourceText, input.contextTargetTokens)
    if (!capped.truncated) throw new Error(`H17 fixture ${input.fixture.id} 未触发确定性截断`)
    deliveredContext = capped.content
    delivery = 'truncated'
  } else if (input.variant === 'semantic-compression') {
    const skill = getAgentSkillV1('prose.generate', 'prose')
    const session = createAgentContextCompressionSessionV1({
      policy: skill.contextCompression,
      config: input.generationConfig,
      projectId: 1,
      authorRequest: input.fixture.userHint,
      routingCategory: 'eval.h17',
      runtime: {
        budget,
        requiredFutureModelCalls: 1,
        complete: async (messages, request) => {
          const response = await input.call(messages, {
            ...input.generationConfig,
            maxTokens: request.maxOutputTokens,
            temperature: request.temperature,
          }, 'compression')
          const usage = measuredUsage(messages, response.output, response.usage)
          compressionTotals.calls += 1
          compressionTotals.inputTokens += usage.inputTokens
          compressionTotals.outputTokens += usage.outputTokens
          return response.output
        },
      },
    })
    const transformed = await session.sourceTransformer({
      source: {
        key: 'worldview',
        label: 'H17 合成世界上下文',
        layer: 'L2',
        budgetTokens: input.contextTargetTokens,
        protectedFromTrim: false,
      },
      content: sourceText,
      originalTokens: sourceOriginalTokens,
      sourceBudgetTokens: input.contextTargetTokens,
      inputBudgetTokens: Math.max(sourceOriginalTokens, input.contextTargetTokens),
    })
    if (!transformed?.content || !transformed.delivery) {
      throw new Error(`H17 fixture ${input.fixture.id} 语义压缩未交付可比较上下文`)
    }
    deliveredContext = transformed.content
    delivery = transformed.delivery === 'compressed' ? 'compressed' : 'full'
    compression = transformed.compression
  }

  const messages = buildContextCompressionEvalMessagesV1({ fixture: input.fixture, deliveredContext })
  const reservation = budget.reserveCall({
    label: `H17 ${input.variant} 生成`,
    messages,
    maxOutputTokens: input.generationConfig.maxTokens,
  })
  let generated: ContextCompressionEvalCallResultV1
  try {
    generated = await input.call(messages, input.generationConfig, 'generation')
    budget.settleCall(reservation, generated.output)
  } catch (error) {
    budget.settleFailedCall(reservation)
    throw error
  }
  const generationUsage = measuredUsage(messages, generated.output, generated.usage)
  const score = scoreOutput(input.fixture, generated.output)
  const sourceHash = await sha256Text(sourceText)
  const deliveredContextHash = await sha256Text(deliveredContext)
  const outputHash = await sha256Text(generated.output)
  const traceBody = {
    version: 1,
    promptVersion: H17_CONTEXT_COMPRESSION_PROMPT_VERSION,
    fixtureId: input.fixture.id,
    variant: input.variant,
    sourceHash,
    deliveredContextHash,
    outputHash,
    compression,
    score,
    generationUsage,
    compressionTotals,
  }
  return {
    fixtureId: input.fixture.id,
    variant: input.variant,
    sourceHash,
    deliveredContextHash,
    outputHash,
    traceHash: await hashCanonicalValue(traceBody),
    sourceOriginalTokens,
    deliveredContextTokens: estimateTokens(deliveredContext),
    generationInputTokens: generationUsage.inputTokens,
    generationOutputTokens: generationUsage.outputTokens,
    compressionInputTokens: compressionTotals.inputTokens,
    compressionOutputTokens: compressionTotals.outputTokens,
    totalInputTokens: generationUsage.inputTokens + compressionTotals.inputTokens,
    totalOutputTokens: generationUsage.outputTokens + compressionTotals.outputTokens,
    modelCalls: 1 + compressionTotals.calls,
    durationMs: Math.round(performance.now() - startedAt),
    delivery,
    compression,
    score,
  }
}

export async function runContextCompressionEvalVariantV1(input: {
  fixtures: LongConsistencyFixture[]
  variant: ContextCompressionEvalVariant
  split: 'development' | 'held-out'
  contextTargetTokens: number
  generationMaxTokens: number
  config: AIConfig
  call: ContextCompressionEvalCallV1
  onProgress?: (completed: number, total: number) => void
}): Promise<ContextCompressionEvalRecordV1> {
  const generationConfig = {
    ...input.config,
    temperature: 0.2,
    maxTokens: input.generationMaxTokens,
  }
  const results: ContextCompressionEvalCaseResultV1[] = []
  for (const fixture of input.fixtures) {
    results.push(await runVariantCase({
      fixture,
      variant: input.variant,
      contextTargetTokens: input.contextTargetTokens,
      generationConfig,
      call: input.call,
    }))
    input.onProgress?.(results.length, input.fixtures.length)
  }
  const provisional: ContextCompressionEvalRecordV1 = {
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    provider: input.config.provider,
    model: input.config.model,
    split: input.split,
    variant: input.variant,
    contextTargetTokens: input.contextTargetTokens,
    generationMaxTokens: input.generationMaxTokens,
    fixtureIds: input.fixtures.map(fixture => fixture.id),
    results,
    aggregate: aggregate(results),
    recordHash: '0'.repeat(64),
  }
  return { ...provisional, recordHash: await hashCanonicalValue(recordBody(provisional)) }
}

export async function runContextCompressionEvalMatrixV1(input: {
  fixtures: LongConsistencyFixture[]
  split: 'development' | 'held-out'
  contextTargetTokens?: number
  generationMaxTokens?: number
  config: AIConfig
  call: ContextCompressionEvalCallV1
  onVariantComplete?: (record: ContextCompressionEvalRecordV1, completed: number, total: number) => void
  onCaseProgress?: (variantIndex: number, variantTotal: number, completed: number, total: number) => void
  persist?: boolean
}): Promise<ContextCompressionEvalRecordV1[]> {
  const records: ContextCompressionEvalRecordV1[] = []
  for (let index = 0; index < CONTEXT_COMPRESSION_EVAL_VARIANTS.length; index += 1) {
    const variant = CONTEXT_COMPRESSION_EVAL_VARIANTS[index]
    const record = await runContextCompressionEvalVariantV1({
      fixtures: input.fixtures,
      variant,
      split: input.split,
      contextTargetTokens: input.contextTargetTokens ?? 900,
      generationMaxTokens: input.generationMaxTokens ?? 1_200,
      config: input.config,
      call: input.call,
      onProgress: (completed, total) => input.onCaseProgress?.(
        index,
        CONTEXT_COMPRESSION_EVAL_VARIANTS.length,
        completed,
        total,
      ),
    })
    records.push(record)
    input.onVariantComplete?.(record, records.length, CONTEXT_COMPRESSION_EVAL_VARIANTS.length)
  }
  if (input.persist !== false) {
    localStorage.setItem(H17_CONTEXT_COMPRESSION_RESULTS_STORAGE_KEY, JSON.stringify(records))
  }
  return records
}

export function evaluateContextCompressionNonInferiorityV1(input: {
  full: ContextCompressionEvalRecordV1
  semantic: ContextCompressionEvalRecordV1
}): ContextCompressionEvalGateV1 {
  const failures: string[] = []
  const full = input.full
  const semantic = input.semantic
  if (
    full.variant !== 'full-source'
    || semantic.variant !== 'semantic-compression'
    || full.provider !== semantic.provider
    || full.model !== semantic.model
    || full.contextTargetTokens !== semantic.contextTargetTokens
    || full.generationMaxTokens !== semantic.generationMaxTokens
    || JSON.stringify(full.fixtureIds) !== JSON.stringify(semantic.fixtureIds)
  ) failures.push('comparison-contract-mismatch')
  const factRegression = full.aggregate.requiredFactRecall - semantic.aggregate.requiredFactRecall
  const constraintRegression = full.aggregate.constraintRecall - semantic.aggregate.constraintRecall
  if (factRegression > H17_CONTEXT_COMPRESSION_THRESHOLDS.maximumRecallRegression) {
    failures.push('required-fact-noninferiority')
  }
  if (constraintRegression > H17_CONTEXT_COMPRESSION_THRESHOLDS.maximumRecallRegression) {
    failures.push('constraint-noninferiority')
  }
  if (semantic.aggregate.futureLeakageRate > H17_CONTEXT_COMPRESSION_THRESHOLDS.maximumFutureLeakageRate) {
    failures.push('future-leakage')
  }
  if (semantic.aggregate.wrongWorldLeakageRate > H17_CONTEXT_COMPRESSION_THRESHOLDS.maximumWrongWorldLeakageRate) {
    failures.push('wrong-world-leakage')
  }
  const generationInputReduction = full.aggregate.generationInputTokens > 0
    ? 1 - semantic.aggregate.generationInputTokens / full.aggregate.generationInputTokens
    : 0
  if (generationInputReduction < H17_CONTEXT_COMPRESSION_THRESHOLDS.minimumGenerationInputReduction) {
    failures.push('generation-input-reduction')
  }
  if (semantic.aggregate.fallbackRate > H17_CONTEXT_COMPRESSION_THRESHOLDS.maximumFallbackRate) {
    failures.push('compression-fallback')
  }
  return {
    passed: failures.length === 0,
    failures,
    generationInputReduction,
    totalInputMultiplier: full.aggregate.totalInputTokens > 0
      ? semantic.aggregate.totalInputTokens / full.aggregate.totalInputTokens
      : 0,
  }
}
