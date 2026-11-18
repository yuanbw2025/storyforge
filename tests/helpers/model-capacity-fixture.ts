import { discoverModelCapacityV1, getModelCapacityV1, parseModelCapacityV1 } from '../../src/lib/ai/model-capacity'
import type { AIConfig } from '../../src/lib/types'

/** Finite, explicit service allocation for transport/recovery fixtures. Uses
 * the real metadata parser; never patches the resolver or contacts a service. */
export async function seedModelAllocationFixtureV1(config: AIConfig, window: number) {
  if (config.provider !== 'custom' && config.provider !== 'ollama') throw new Error('Service fixture needs an explicit local provider')
  const metadata = config.provider === 'custom'
    ? { models: [{ type: 'llm', key: config.model, loaded_instances: [{ config: { context_length: window } }] }] }
    : { models: [{ model: config.model, context_length: window }] }
  const result = await discoverModelCapacityV1(config, async (_url, init) => {
    if (init?.method !== 'GET') throw new Error('Capacity fixture cannot dispatch a model request')
    return Response.json(metadata)
  })
  if (result.confidence !== 'service' || result.totalWindow !== window) throw new Error('Finite service fixture was not resolved')
  return result
}

/** Explicit finite allocation at the internal frozen-run boundary, for fake
 * transports (notably Codex bridges without a metadata endpoint) and pure
 * window arithmetic tests. This is synthetic input, never availability proof
 * for a live provider or a replacement for the unknown-connection guard. */
export function syntheticFrozenAllocationV1(config: AIConfig, window: number, output = Math.floor(window / 2)): AIConfig {
  const base = getModelCapacityV1({ ...config, modelCapacity: undefined })
  const modelCapacity = parseModelCapacityV1({ ...base, totalWindow: window, inputLimit: null, outputLimit: output,
    confidence: 'fallback', outputLimitSource: 'policy', source: 'internal-conservative-policy-v1' })
  return { ...config, modelCapacity }
}
