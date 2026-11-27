import type { AIRequestConfigResolution } from '../ai/client'
import { prepareModelCapacityV1 } from '../ai/model-capacity'

/** Legacy export name retained for callers. New reviews use service capacity;
 * saved settings and the former per-task limit do not impose output quotas. */
export function boundedQualityResolutionV1(resolution: AIRequestConfigResolution, _legacyLimit?: number): AIRequestConfigResolution {
  return { ...resolution, config: { ...resolution.config, maxTokens: 0 } }
}

/** Discover the selected connection before durable request settings are frozen. */
export async function prepareQualityResolutionV1(resolution: AIRequestConfigResolution, _legacyLimit?: number): Promise<AIRequestConfigResolution> {
  return boundedQualityResolutionV1({ ...resolution, config: await prepareModelCapacityV1(resolution.config) })
}
