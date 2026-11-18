import { discoverModelCapacityV1 } from '../../src/lib/ai/model-capacity'
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
