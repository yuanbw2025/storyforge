/**
 * QUICKWIN-1 · 本地模型入口文案。
 * 守卫：设置页不再只写 Ollama，而是明确支持 Ollama / LM Studio 等 OpenAI-compatible /v1 本地服务。
 */
import { describe, expect, it } from 'vitest'
import { PROVIDER_OPTIONS } from '../../src/components/settings/AIConfigPanel'

describe('QUICKWIN-1 · 本地模型 provider 文案', () => {
  it('ollama provider 作为“本地模型”入口呈现，并提示 LM Studio /v1 地址', () => {
    const option = PROVIDER_OPTIONS.find(item => item.value === 'ollama')
    expect(option?.label).toContain('本地模型')
    expect(option?.label).toContain('Ollama')
    expect(option?.label).toContain('LM Studio')
    expect(option?.hint).toContain('/v1')
    expect(option?.hint).toContain('11434')
    expect(option?.hint).toContain('1234')
  })
})
