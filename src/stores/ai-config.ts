import { create } from 'zustand'
import type { AIConfig, AIProvider } from '../lib/types'
import { PROVIDER_PRESETS } from '../lib/types'
import { createLog, updateLog } from '../lib/ai/logger'

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

export interface TestResult {
  ok: boolean
  message: string
  statusCode?: number
  duration?: number
}

interface AIConfigStore {
  config: AIConfig
  setConfig: (config: Partial<AIConfig>) => void
  switchProvider: (provider: AIProvider) => void
  testConnection: () => Promise<TestResult>
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

  testConnection: async (): Promise<TestResult> => {
    const { config } = get()
    // 标准化 baseUrl：去除尾部斜杠
    const baseUrl = config.baseUrl.replace(/\/+$/, '')
    const isPoe = config.provider === 'poe' || baseUrl.includes('api.poe.com')

    // Poe 使用不同的 endpoint 格式: baseUrl/model
    // 其他 provider 使用 OpenAI 兼容格式: baseUrl/chat/completions
    const url = isPoe
      ? `${baseUrl}/${config.model}`
      : `${baseUrl}/chat/completions`
    const startTime = Date.now()

    // 创建日志
    const log = createLog({
      type: 'test',
      provider: config.provider,
      url,
      model: config.model,
      status: 'pending',
    })

    try {
      console.log(`[AI Test] 正在测试连接...`, {
        provider: config.provider,
        isPoe,
        baseUrl,
        url,
        model: config.model,
        hasKey: !!config.apiKey,
      })

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(isPoe ? {
          messages: [{ role: 'user', content: '请回复"连接成功"' }],
          max_tokens: 20,
        } : {
          model: config.model,
          messages: [{ role: 'user', content: '请回复"连接成功"' }],
          max_tokens: 20,
        }),
      })

      const duration = Date.now() - startTime
      const bodyText = await response.text()

      console.log(`[AI Test] 收到响应`, { status: response.status, duration, body: bodyText.slice(0, 500) })

      if (response.ok) {
        updateLog(log.id, { status: 'success', statusCode: response.status, duration, responseBody: bodyText.slice(0, 200) })
        return { ok: true, message: '✅ 连接成功', statusCode: response.status, duration }
      }

      // 解析错误信息
      let errorMsg = `HTTP ${response.status}`
      try {
        const errJson = JSON.parse(bodyText)
        if (errJson.error?.message) errorMsg = errJson.error.message
        else if (errJson.message) errorMsg = errJson.message
        else if (errJson.error_msg) errorMsg = errJson.error_msg
      } catch {
        if (bodyText.length < 200) errorMsg += ': ' + bodyText
      }

      // 常见错误友好提示
      if (response.status === 401) errorMsg = 'API Key 无效或已过期'
      if (response.status === 403) errorMsg = 'API Key 权限不足'
      if (response.status === 404) errorMsg = 'API 地址错误，请检查 Base URL'
      if (response.status === 429) errorMsg = '请求频率超限，请稍后再试'

      updateLog(log.id, { status: 'error', statusCode: response.status, duration, errorMessage: errorMsg, responseBody: bodyText.slice(0, 500) })
      return { ok: false, message: `❌ ${errorMsg}`, statusCode: response.status, duration }

    } catch (err: unknown) {
      const duration = Date.now() - startTime
      const error = err as Error
      let errorMsg: string

      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        errorMsg = '网络错误 — 可能原因：1) 网络不通 2) 该平台不支持浏览器直接调用(CORS) 3) Base URL 错误'
      } else if (error.name === 'AbortError') {
        errorMsg = '请求超时'
      } else {
        errorMsg = error.message || '未知错误'
      }

      console.error(`[AI Test] 连接失败`, { error: error.message, duration })
      updateLog(log.id, { status: 'error', duration, errorMessage: errorMsg })
      return { ok: false, message: `❌ ${errorMsg}`, duration }
    }
  },
}))
