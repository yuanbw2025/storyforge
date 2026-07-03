import { afterEach, describe, expect, it, vi } from 'vitest'
import { getModelPreset } from '../../src/lib/ai/context-budget'
import { PROVIDER_MODELS, PROVIDER_PRESETS } from '../../src/lib/types'

const CONFIG_KEY = 'storyforge-ai-config'
const SESSION_KEY = 'storyforge-ai-api-key-session'
const REMEMBER_KEY = 'storyforge-ai-api-key-remember'

async function freshStore() {
  vi.resetModules()
  const mod = await import('../../src/stores/ai-config')
  return mod.useAIConfigStore
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.resetModules()
})

describe('R-AI-CONFIG · API Key 存储策略', () => {
  it('默认只把 API Key 存入 sessionStorage,localStorage 配置不落 key', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-session' })

    expect(useAIConfigStore.getState().rememberApiKey).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBe('sk-session')
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').apiKey).toBe('')
    expect(localStorage.getItem(REMEMBER_KEY)).toBe('false')
  })

  it('显式记住本机时才把 API Key 写入 localStorage', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setRememberApiKey(true)
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-local' })

    expect(useAIConfigStore.getState().rememberApiKey).toBe(true)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').apiKey).toBe('sk-local')
    expect(localStorage.getItem(REMEMBER_KEY)).toBe('true')
  })

  it('兼容旧版 localStorage 配置:已有 apiKey 初始化为已记住状态', async () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      provider: 'deepseek',
      apiKey: 'sk-legacy',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      temperature: 0.7,
      maxTokens: 0,
    }))

    const useAIConfigStore = await freshStore()

    expect(useAIConfigStore.getState().rememberApiKey).toBe(true)
    expect(useAIConfigStore.getState().config.apiKey).toBe('sk-legacy')
  })

  it('session-only 模式保存预设时不把当前 API Key 写进预设 localStorage', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-session' })
    useAIConfigStore.getState().saveAsPreset('会话预设')

    const presets = JSON.parse(localStorage.getItem('storyforge-ai-presets') || '[]')
    expect(presets[0].config.apiKey).toBe('')
  })

  it('LongCat provider 使用官方 OpenAI 兼容端点和 1M 上下文预设', async () => {
    expect(PROVIDER_PRESETS.longcat?.baseUrl).toBe('https://api.longcat.chat/openai/v1')
    expect(PROVIDER_PRESETS.longcat?.model).toBe('LongCat-2.0')
    expect(PROVIDER_MODELS.longcat?.[0]?.value).toBe('LongCat-2.0')

    const preset = getModelPreset('longcat', 'LongCat-2.0')
    expect(preset.maxContext).toBe(1_000_000)
    expect(preset.maxOutput).toBe(128_000)

    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().switchProvider('longcat')
    expect(useAIConfigStore.getState().config.baseUrl).toBe('https://api.longcat.chat/openai/v1')
    expect(useAIConfigStore.getState().config.model).toBe('LongCat-2.0')
  })
})
