import type { AIConfig } from '../types'
import type { ChatRequestOptions } from '../ai/client'

/** Scoped to the model whose bounded JSON workflow has a verified thinking
 * toggle. No saved route/config change and no retry without the option. */
export function isBoundedAgnesWholeReviewModelV1(config: Pick<AIConfig, 'provider' | 'model'>): boolean {
  return config.provider === 'agnes' && config.model === 'agnes-2.5-flash'
}

export function wholeChapterQualityRequestOptionsV1(config: Pick<AIConfig, 'provider' | 'model'>): ChatRequestOptions {
  return { responseFormat: 'json_object', ...(isBoundedAgnesWholeReviewModelV1(config) ? { thinkingMode: 'disabled' as const } : {}) }
}
