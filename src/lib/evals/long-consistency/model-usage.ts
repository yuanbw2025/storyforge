import { assertExactKeys, failSchema, readEnum, readInteger, readNonNegativeNumber, readRecord } from '../../agent/run/schema-utils'
import { estimateTokens } from '../../ai/context-budget'
import { computeCostUsd, knownProviderModelPrice } from '../../ai/usage-log'
import type { AIConfig, ChatMessage } from '../../types'
import type { LongConsistencyModelUsageV1, LongConsistencyUsageProvenanceV1 } from './report-types'

export const PROVIDER_USAGE_POLICY_V1 = 'provider-token-evidence-v1' as const

const usageKeys = ['inputTokens', 'outputTokens', 'durationMs', 'costUsd'] as const
const provenanceKeys = ['input', 'output', 'providerTotalTokens', 'cost'] as const
const sources = ['provider', 'estimated', 'missing'] as const

export function parseLongConsistencyModelUsageV1(value: unknown, path: string): LongConsistencyModelUsageV1 {
  const record = readRecord(value, path)
  assertExactKeys(record, [...usageKeys, 'provenance'], usageKeys, path)
  const usage: LongConsistencyModelUsageV1 = {
    inputTokens: readInteger(record.inputTokens, `${path}.inputTokens`),
    outputTokens: readInteger(record.outputTokens, `${path}.outputTokens`),
    durationMs: readNonNegativeNumber(record.durationMs, `${path}.durationMs`),
    costUsd: readNonNegativeNumber(record.costUsd, `${path}.costUsd`),
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'provenance')) return usage
  const at = `${path}.provenance`
  const raw = readRecord(record.provenance, at)
  assertExactKeys(raw, provenanceKeys, provenanceKeys, at)
  const provenance: LongConsistencyUsageProvenanceV1 = {
    input: readEnum(raw.input, sources, `${at}.input`),
    output: readEnum(raw.output, sources, `${at}.output`),
    providerTotalTokens: raw.providerTotalTokens === null ? null
      : readInteger(raw.providerTotalTokens, `${at}.providerTotalTokens`),
    cost: readEnum(raw.cost, ['catalog-estimate', 'fallback-estimate', 'missing'], `${at}.cost`),
  }
  if (!Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)
    || (provenance.providerTotalTokens !== null && !Number.isSafeInteger(provenance.providerTotalTokens))
    || (provenance.input === 'missing' && usage.inputTokens !== 0)
    || (provenance.output === 'missing' && usage.outputTokens !== 0)
    || (provenance.cost === 'missing' && usage.costUsd !== 0)) {
    failSchema('binding_mismatch', at, '用量来源与保存的数值不匹配')
  }
  return { ...usage, provenance }
}

export function hasProviderUsageEvidenceV1(usage: LongConsistencyModelUsageV1 | null): boolean {
  const provenance = usage?.provenance
  return provenance?.input === 'provider' && provenance.output === 'provider'
    && provenance.providerTotalTokens !== null
}

export function measureLongConsistencyProviderUsageV1(input: {
  tokens?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  config: Pick<AIConfig, 'provider' | 'model'>
  messages: readonly ChatMessage[]
  output: string
  durationMs: number
}): LongConsistencyModelUsageV1 {
  const inputTokens = input.tokens?.inputTokens ?? input.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  const outputTokens = input.tokens?.outputTokens ?? estimateTokens(input.output)
  const price = knownProviderModelPrice(input.config.provider, input.config.model)
  return {
    inputTokens,
    outputTokens,
    durationMs: input.durationMs,
    costUsd: price
      ? (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output
      : computeCostUsd(input.config.model, inputTokens, outputTokens),
    provenance: {
      input: input.tokens?.inputTokens === undefined ? 'estimated' : 'provider',
      output: input.tokens?.outputTokens === undefined ? 'estimated' : 'provider',
      providerTotalTokens: input.tokens?.totalTokens ?? null,
      cost: price ? 'catalog-estimate' : 'fallback-estimate',
    },
  }
}

/** A caller can supply old budget numbers without being able to attest them. */
export function normalizeLongConsistencyCallUsageV1(input: {
  usage?: Partial<LongConsistencyModelUsageV1>
  messages: readonly ChatMessage[]
  output: unknown
  durationMs: number
}): LongConsistencyModelUsageV1 {
  if (input.usage?.provenance !== undefined) {
    return parseLongConsistencyModelUsageV1(input.usage, 'call.usage')
  }
  const hasOutput = typeof input.output === 'string'
  return {
    inputTokens: input.usage?.inputTokens ?? input.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
    outputTokens: input.usage?.outputTokens ?? (typeof input.output === 'string' ? estimateTokens(input.output) : 0),
    durationMs: input.usage?.durationMs ?? input.durationMs,
    costUsd: input.usage?.costUsd ?? 0,
    provenance: {
      input: 'estimated',
      output: input.usage?.outputTokens !== undefined || hasOutput ? 'estimated' : 'missing',
      providerTotalTokens: null,
      cost: input.usage?.costUsd === undefined ? 'missing' : 'fallback-estimate',
    },
  }
}

/** Historical aggregates retain their old interpretation on read, but their
 * counts cannot be used by a newly calculated provider-evidence score. */
export function currentProviderUsageCountsV1<T extends { modelCalls: number; meteredModelCalls: number; unmeteredModelCalls: number }>(
  usage: T,
  policy: typeof PROVIDER_USAGE_POLICY_V1 | undefined,
): T {
  return policy === PROVIDER_USAGE_POLICY_V1 ? usage : {
    ...usage, meteredModelCalls: 0, unmeteredModelCalls: usage.modelCalls,
  }
}
