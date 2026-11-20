import type { AIConfig, ChatMessage } from '../types'
import { estimateTokens } from '../ai/context-budget'
import { getModelCapacityV1 } from '../ai/model-capacity'

export class ReferenceServiceWindowError extends Error {
  constructor(readonly inputLimit: number) {
    super('当前模型服务无法一次承载完整资料；需要继续分批处理。')
  }
}

/** Unknown capability is unknown, not a small provider-default window. */
export function referenceServiceInputLimit(config: AIConfig): number | null {
  const capacity = getModelCapacityV1(config)
  return capacity.confidence === 'fallback' ? null : capacity.inputLimit ?? capacity.totalWindow
}

export function referenceServiceOutputLimit(config: AIConfig, messages: ReadonlyArray<{ content: unknown }>): number | null {
  const capacity = getModelCapacityV1(config)
  if (capacity.confidence === 'fallback') return null
  const input = estimateTokens(JSON.stringify(messages))
  const inputLimit = capacity.inputLimit ?? capacity.totalWindow!
  if (input >= inputLimit) throw new ReferenceServiceWindowError(inputLimit)
  const available = capacity.totalWindow == null ? null : capacity.totalWindow - input
  const independent = capacity.outputLimitSource === 'policy' ? null : capacity.outputLimit
  return independent == null ? available : available == null ? independent : Math.min(available, independent)
}

export function referenceRequestTokens(messages: readonly ChatMessage[]): number {
  return estimateTokens(JSON.stringify(messages))
}
