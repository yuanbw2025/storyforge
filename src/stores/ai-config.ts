import { create } from 'zustand'
import type { AIConfig, AIProvider } from '../lib/types'
import { PROVIDER_PRESETS } from '../lib/types'

const STORAGE_KEY = 'storyforge-ai-config'

/** 从 localStorage 加载配置 */
function loadConfig(): AIConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    temperature: 0.7,
    maxTokens: 4096,
  }
}

interface AIConfigStore {
  config: AIConfig
  setConfig: (config: Partial<AIConfig>) => void
  switchProvider: (provider: AIProvider) => void
  testConnection: () => Promise<boolean>
}

export const useAIConfigStore = create<AIConfigStore>((set, get) => ({
  config: loadConfig(),

  setConfig: (partial: Partial<AIConfig>) => {
    const newConfig = { ...get().config, ...partial }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig))
    set({ config: newConfig })
  },

  switchProvider: (provider: AIProvider) => {
    const preset = PROVIDER_PRESETS[provider] || {}
    const newConfig: AIConfig = {
      ...get().config,
      provider,
      ...preset,
      apiKey: provider === get().config.provider ? get().config.apiKey : (preset.apiKey || ''),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig))
    set({ config: newConfig })
  },

  testConnection: async () => {
    const { config } = get()
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: '请回复"连接成功"' }],
          max_tokens: 20,
        }),
      })
      return response.ok
    } catch {
      return false
    }
  },
}))
