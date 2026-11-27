import { seedModelAllocationFixtureV1 } from '../helpers/model-capacity-fixture'
import { describe, expect, it } from 'vitest'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { resolveRequestConfig, describeResolvedAIRequestSettingsV1 } from '../../src/lib/ai/client'
import { boundedQualityResolutionV1 } from '../../src/lib/prose/quality-request-budget'

describe('LFQ8 · 评审输出跟随服务容量', () => {
  it('自动值不再注入Skill上限，旧API配置不影响新请求，温度保持不变', async () => {
    const saved = { ...useAIConfigStore.getState().config, provider: 'agnes' as const, model: 'agnes-2.5-flash', baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0, maxTokens: 0, contextWindow: 524288 }
    const bound = boundedQualityResolutionV1(resolveRequestConfig(saved))
    expect(bound.config.maxTokens).toBe(0)
    expect(bound.config.temperature).toBe(0)
    expect(saved.maxTokens).toBe(0)
    expect(describeResolvedAIRequestSettingsV1(bound, false, { responseFormat: 'json_object' }).parameters.max_tokens).toBe(65_500)
    const local = { ...saved, provider: 'ollama' as const, model: 'local-budget-fixture', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '' }
    await seedModelAllocationFixtureV1(local, 8192)
    expect(boundedQualityResolutionV1(resolveRequestConfig(local)).config.maxTokens).toBe(0)
    expect(boundedQualityResolutionV1(resolveRequestConfig({ ...saved, maxTokens: 20000 })).config.maxTokens).toBe(0)
  })
})
