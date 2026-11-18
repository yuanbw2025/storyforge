import type { AIRequestConfigResolution } from '../ai/client'
import { getModelCapacityV1, prepareModelCapacityV1 } from '../ai/model-capacity'

/** Zero means automatic in settings. Freeze a bounded per-task value without
 * changing the saved provider/route/temperature or global configuration. */
export function boundedQualityResolutionV1(resolution: AIRequestConfigResolution, limit = 16000): AIRequestConfigResolution {
  if (resolution.config.maxTokens > 0) {
    if (resolution.config.maxTokens > limit) throw new Error('当前输出上限超过本轮预算，请调低本次输出上限。')
    return resolution
  }
  const capacity = getModelCapacityV1(resolution.config)
  const maxTokens = Math.min(limit, capacity.outputLimit, capacity.totalWindow ? Math.floor(capacity.totalWindow / 2) : capacity.outputLimit)
  if (maxTokens < 1) throw new Error('当前模型缺少可用的输出预算。')
  return { ...resolution, config: { ...resolution.config, maxTokens } }
}

/** Discover the selected connection before durable request settings are frozen. */
export async function prepareQualityResolutionV1(resolution: AIRequestConfigResolution, limit = 16000): Promise<AIRequestConfigResolution> {
  return boundedQualityResolutionV1({ ...resolution, config: await prepareModelCapacityV1(resolution.config) }, limit)
}
