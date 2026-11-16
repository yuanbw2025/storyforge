import type { ProductProductionTaskUsageV1 } from '../product-production/scheduler'

export function readTextOpenWorldObservedTokenPairV1(value: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const usage = value as Record<string, unknown>
  if (!Number.isSafeInteger(usage.inputTokens) || Number(usage.inputTokens) < 0
    || !Number.isSafeInteger(usage.outputTokens) || Number(usage.outputTokens) < 0) return null
  return { inputTokens: Number(usage.inputTokens), outputTokens: Number(usage.outputTokens) }
}

export function addTextOpenWorldTaskUsageV1(
  left: ProductProductionTaskUsageV1,
  right: ProductProductionTaskUsageV1,
): ProductProductionTaskUsageV1 {
  return {
    modelCalls: left.modelCalls + right.modelCalls,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    mediaCalls: left.mediaCalls + right.mediaCalls,
    costUsd: left.costUsd == null || right.costUsd == null ? null : left.costUsd + right.costUsd,
    durationMs: left.durationMs + right.durationMs,
    storageBytes: left.storageBytes + right.storageBytes,
  }
}
