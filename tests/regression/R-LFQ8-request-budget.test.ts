import { describe, expect, it } from 'vitest'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { resolveRequestConfig, describeResolvedAIRequestSettingsV1 } from '../../src/lib/ai/client'
import { boundedQualityResolutionV1 } from '../../src/lib/prose/quality-request-budget'

describe('LFQ8 · 自动输出上限的本轮预算', () => {
  it('自动值按真实模型窗口与Skill预算冻结；不改保存配置或作者显式温度', () => {
    const saved = { ...useAIConfigStore.getState().config, provider: 'agnes' as const, model: 'agnes-2.5-flash', temperature: 0, maxTokens: 0, contextWindow: 524288 }
    const bound = boundedQualityResolutionV1(resolveRequestConfig(saved))
    expect(bound.config.maxTokens).toBe(16000)
    expect(bound.config.temperature).toBe(0)
    expect(saved.maxTokens).toBe(0)
    expect(describeResolvedAIRequestSettingsV1(bound, false, { responseFormat: 'json_object' }).parameters.max_tokens).toBe(16000)
    expect(boundedQualityResolutionV1(resolveRequestConfig({ ...saved, provider: 'ollama', contextWindow: 8192 })).config.maxTokens).toBeLessThanOrEqual(4096)
    expect(() => boundedQualityResolutionV1(resolveRequestConfig({ ...saved, maxTokens: 20000 }))).toThrow('预算')
  })
})
