import { create } from 'zustand'
import type { AIConfig, AIProvider } from '../lib/types'
import { PROVIDER_PRESETS } from '../lib/types'
import { createLog, updateLog } from '../lib/ai/logger'

const STORAGE_KEY = 'storyforge-ai-config'

/** 根据 HTTP 状态码和英文错误信息，返回中文解释 */
function getChineseExplanation(status: number, msg: string): string {
  const lower = msg.toLowerCase()

  // 按 HTTP 状态码
  if (status === 401) return 'API Key 无效或已过期'
  if (status === 402) return '账户余额不足，请充值后使用'
  if (status === 403) return 'API Key 权限不足，无权访问该模型'
  if (status === 404) return 'API 地址或模型名称错误，请检查 Base URL 和模型名'
  if (status === 429) return '请求频率超限，请稍后再试'
  if (status === 500) return '服务器内部错误，请稍后重试'
  if (status === 502) return '网关错误，服务暂时不可用'
  if (status === 503) return '服务暂时不可用，可能正在维护'

  // 按错误信息关键词匹配
  if (lower.includes('insufficient balance') || lower.includes('insufficient_balance'))
    return '账户余额不足，请充值'
  if (lower.includes('invalid api key') || lower.includes('invalid_api_key'))
    return 'API Key 无效，请检查是否填写正确'
  if (lower.includes('authentication') || lower.includes('unauthorized'))
    return '认证失败，API Key 无效或已过期'
  if (lower.includes('rate limit') || lower.includes('rate_limit'))
    return '请求频率超限，请稍后再试'
  if (lower.includes('model not found') || lower.includes('model_not_found'))
    return '模型不存在，请检查模型名称是否正确'
  if (lower.includes('context length') || lower.includes('context_length'))
    return '输入内容超过模型最大上下文长度'
  if (lower.includes('quota exceeded') || lower.includes('quota_exceeded'))
    return '配额已用完'
  if (lower.includes('server error') || lower.includes('internal error'))
    return '服务器内部错误'
  if (lower.includes('timeout'))
    return '请求超时'
  if (lower.includes('bad request'))
    return '请求格式错误，请检查参数'
  if (lower.includes('not found'))
    return '接口不存在，请检查 Base URL'
  if (lower.includes('permission denied'))
    return '权限不足'
  if (lower.includes('billing') || lower.includes('payment'))
    return '账单/付款问题，请检查账户'
  if (lower.includes('overloaded') || lower.includes('capacity'))
    return '服务过载，请稍后重试'
  if (lower.includes('thinking') && lower.includes('budget'))
    return '思考模式参数冲突，请不要手动传 thinking 相关参数'

  return ''
}

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
    maxTokens: 0,
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
    const url = `${baseUrl}/chat/completions`
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
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: '请回复"连接成功"' }],
        }),
      })

      const duration = Date.now() - startTime
      const bodyText = await response.text()

      if (response.ok) {
        updateLog(log.id, { status: 'success', statusCode: response.status, duration, responseBody: bodyText.slice(0, 200) })
        return { ok: true, message: '✅ 连接成功', statusCode: response.status, duration }
      }

      // 解析错误信息
      let rawErrorMsg = `HTTP ${response.status}`
      try {
        const errJson = JSON.parse(bodyText)
        if (errJson.error?.message) rawErrorMsg = errJson.error.message
        else if (errJson.message) rawErrorMsg = errJson.message
        else if (errJson.error_msg) rawErrorMsg = errJson.error_msg
      } catch {
        if (bodyText.length < 200) rawErrorMsg += ': ' + bodyText
      }

      // 常见英文错误 → 中文翻译映射
      const cnExplanation = getChineseExplanation(response.status, rawErrorMsg)

      // HTTP 402 = 余额不足，但说明连接和认证都成功了
      if (response.status === 402) {
        const msg = `${rawErrorMsg}（${cnExplanation}）`
        updateLog(log.id, { status: 'success', statusCode: response.status, duration, responseBody: bodyText.slice(0, 200) })
        return { ok: true, message: `✅ 连接成功 — ${msg}`, statusCode: response.status, duration }
      }

      const errorMsg = cnExplanation ? `${rawErrorMsg}（${cnExplanation}）` : rawErrorMsg

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

      updateLog(log.id, { status: 'error', duration, errorMessage: errorMsg })
      return { ok: false, message: `❌ ${errorMsg}`, duration }
    }
  },
}))
