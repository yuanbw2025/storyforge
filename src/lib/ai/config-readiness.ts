import type { AIConfig, AIProvider } from '../types'

const EMPTY_KEY_COMPATIBLE_PROVIDERS = new Set<AIProvider>(['ollama', 'custom'])

export function aiProviderAllowsEmptyKey(provider: AIProvider): boolean {
  return EMPTY_KEY_COMPATIBLE_PROVIDERS.has(provider)
}

export function isAIConfigReady(config: Pick<AIConfig, 'apiKey' | 'provider'>): boolean {
  return Boolean(config.apiKey || aiProviderAllowsEmptyKey(config.provider))
}

export function getAIConfigRequiredMessage(config: Pick<AIConfig, 'provider'>): string {
  return aiProviderAllowsEmptyKey(config.provider)
    ? '请先在「设置」中配置模型服务地址和模型名称。'
    : '请先在「设置」中配置 AI API Key。'
}
