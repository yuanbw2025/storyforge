import type { AIConfig } from '../types'

/** Keep transport support and its durable parameter evidence in agreement. */
export function supportsAgnesThinkingModeV1(config: Pick<AIConfig, 'provider' | 'model'>): boolean {
  return config.provider === 'agnes' && ['agnes-2.5-flash', 'agnes-3.0-flash'].includes(config.model)
}
