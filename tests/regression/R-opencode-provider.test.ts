import { describe, expect, it } from 'vitest'
import { PROVIDER_MODELS, PROVIDER_PRESETS, type AIProvider } from '../../src/lib/types/ai'
import { getModelPreset } from '../../src/lib/ai/context-budget'

describe('R-OPENCODE · OpenCode Go provider', () => {
  it('provider preset points to the OpenCode Go OpenAI-compatible base URL', () => {
    const preset = PROVIDER_PRESETS.opencode
    expect(preset.baseUrl).toBe('https://opencode.ai/zen/go/v1')
    expect(preset.model).toBe('kimi-k2.7-code')
  })

  it('model list only exposes chat/completions-compatible models for the current client', () => {
    const models = PROVIDER_MODELS.opencode?.map(item => item.value)
    expect(models).toContain('kimi-k2.7-code')
    expect(models).toContain('deepseek-v4-pro')
    expect(models).not.toContain('qwen3.7-max')
    expect(models).not.toContain('minimax-m3')
  })

  it('context budget has a provider fallback and exact model preset', () => {
    const fallback = getModelPreset('opencode' as AIProvider, 'unknown-model')
    const exact = getModelPreset('opencode' as AIProvider, 'kimi-k2.7-code')
    expect(fallback.maxContext).toBe(128_000)
    expect(exact.label).toBe('Kimi K2.7 Code')
    expect(exact.maxContext).toBe(128_000)
  })
})
