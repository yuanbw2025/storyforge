import type { AIRequestConfigResolution } from '../ai/client'
import { getModelPreset } from '../ai/context-budget'

/** Zero means automatic in settings. Freeze a bounded per-task value without
 * changing the saved provider/route/temperature or global configuration. */
export function boundedQualityResolutionV1(resolution: AIRequestConfigResolution, limit = 16000): AIRequestConfigResolution {
  if (resolution.config.maxTokens > 0) {
    if (resolution.config.maxTokens > limit) throw new Error('当前输出上限超过本轮预算，请调低本次输出上限。')
    return resolution
  }
  const preset = getModelPreset(resolution.config.provider, resolution.config.model)
  const configuredWindow = resolution.config.contextWindow ?? 0
  const window = configuredWindow > 0 ? configuredWindow : preset.maxContext
  const maxTokens = Math.min(limit, preset.maxOutput, Math.floor(window / 2))
  if (maxTokens < 1) throw new Error('当前模型缺少可用的输出预算。')
  return { ...resolution, config: { ...resolution.config, maxTokens } }
}
