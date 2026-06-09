/**
 * 作品学习模型解析器
 *
 * 从 master settings 中读取模型覆盖配置，
 * 如果用户选了专用模型就用专用的，否则跟随全局 AI 配置。
 * 这样可以让用户在全局用 deepseek-v4-pro 写作，
 * 但在作品分析时自动切到更便宜的 flash 模型。
 */
import { useAIConfigStore } from '../../stores/ai-config'
import { PROVIDER_PRESETS } from '../types/ai'
import type { AIConfig } from '../types'

interface MasterModelOverride {
  provider: string
  model: string
}

interface MasterSettings {
  modelOverride?: MasterModelOverride
}

const SETTINGS_KEY = 'sf-master-settings'

/**
 * 获取作品学习的 AI 配置。
 * 如果用户在学习设置中配了专用模型，则覆盖 provider/model/baseUrl，
 * 但保留全局的 apiKey（同 provider 才能共享 key）和 temperature。
 */
export function getMasterAIConfig(maxTokens?: number): AIConfig {
  const baseConfig = useAIConfigStore.getState().config

  let settings: MasterSettings | null = null
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) settings = JSON.parse(raw)
  } catch { /* ignore */ }

  const override = settings?.modelOverride

  // 没有覆盖配置 或 provider 为 'global' → 直接用全局
  if (!override || override.provider === 'global') {
    return { ...baseConfig, maxTokens: maxTokens ?? baseConfig.maxTokens }
  }

  // 有覆盖配置 → 基于 provider preset 构建
  const preset = PROVIDER_PRESETS[override.provider] || {}

  const config: AIConfig = {
    provider: override.provider as AIConfig['provider'],
    model: override.model || preset.model || baseConfig.model,
    baseUrl: preset.baseUrl || baseConfig.baseUrl,
    // 如果覆盖 provider 和全局相同，复用 apiKey；否则用 preset 的（通常为空，需用户自己填）
    apiKey: override.provider === baseConfig.provider
      ? baseConfig.apiKey
      : (preset.apiKey || baseConfig.apiKey),
    temperature: baseConfig.temperature,
    maxTokens: maxTokens ?? baseConfig.maxTokens,
  }

  if (!config.apiKey) {
    throw new Error(
      `作品学习配置了 ${override.provider} 模型，但未找到对应的 API Key。` +
      `请在「系统设置 → AI 配置」中填写，或在「学习设置」中切回全局模型。`
    )
  }

  return config
}

/**
 * 估算分析费用（粗略）
 *
 * 各主流模型的输入/输出价格（每百万 token，单位：元）
 * 数据来源：各平台官方定价页面，2026-05-27 核实
 *   DeepSeek: https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 *   Gemini:   https://ai.google.dev/gemini-api/docs/pricing (USD×7.2)
 *   OpenAI:   https://developers.openai.com/api/docs/pricing (USD×7.2)
 *   Claude:   https://platform.claude.com/docs/en/docs/about-claude/models (USD×7.2)
 *   Qwen:     https://help.aliyun.com/zh/model-studio/model-pricing
 *   Kimi:     https://platform.kimi.com/docs/pricing/chat-v1
 *   GLM:      https://bigmodel.cn/pricing
 *   MiniMax:  https://platform.minimaxi.com/docs/guides/pricing-paygo
 *   豆包:      https://www.volcengine.com/docs/82379/1544106
 *   文心:      https://ai.baidu.com/ai-doc/WENXINWORKSHOP/Ym1908cg6
 */
const PRICE_TABLE: Record<string, { input: number; output: number; label: string }> = {
  // DeepSeek（官方定价）
  'deepseek:deepseek-v4-flash': { input: 1, output: 2, label: 'DeepSeek V4 Flash' },
  'deepseek:deepseek-v4-pro':   { input: 3, output: 6, label: 'DeepSeek V4 Pro' }, // 2.5折优惠→长期价
  'deepseek:deepseek-chat':     { input: 1, output: 2, label: 'DeepSeek Chat' },
  // Gemini 付费层（免费层不计费；USD×7.2 折算）
  'gemini:gemini-2.5-flash':    { input: 2.16, output: 18, label: 'Gemini 2.5 Flash' },
  'gemini:gemini-2.5-flash-lite': { input: 0.72, output: 2.88, label: 'Gemini 2.5 Flash-Lite' },
  'gemini:gemini-2.5-pro':      { input: 9, output: 72, label: 'Gemini 2.5 Pro' }, // ≤200K prompt
  'gemini:gemini-2.0-flash':    { input: 0.72, output: 2.88, label: 'Gemini 2.0 Flash' },
  // OpenAI（USD×7.2 折算）
  'openai:gpt-4o':              { input: 18, output: 72, label: 'GPT-4o' },
  'openai:gpt-4o-mini':         { input: 1.08, output: 4.32, label: 'GPT-4o Mini' },
  // Claude（USD×7.2 折算）
  'claude:claude-sonnet-4-20250514': { input: 21.6, output: 108, label: 'Claude Sonnet 4' },
  // Qwen（官方定价，限时优惠价）
  'qwen:qwen-max':              { input: 2.5, output: 10, label: 'Qwen Max' }, // ≤32K 区间
  'qwen:qwen-plus':             { input: 0.8, output: 4.8, label: 'Qwen Plus' },
  // Kimi（官方定价）
  'kimi:moonshot-v1-8k':        { input: 2, output: 10, label: 'Moonshot 8K' },
  'kimi:moonshot-v1-32k':       { input: 5, output: 20, label: 'Moonshot 32K' },
  'kimi:moonshot-v1-128k':      { input: 10, output: 30, label: 'Moonshot 128K' },
  // GLM（官方免费）
  'glm:glm-4-flash':            { input: 0, output: 0, label: 'GLM-4 Flash (免费)' },
  // 豆包（官方定价，≤32K 区间）
  'doubao:doubao-pro-32k':      { input: 3.2, output: 16, label: '豆包 Seed 2.0 Pro' },
  // MiniMax（官方定价）
  'minimax:MiniMax-Text-01':    { input: 2.1, output: 8.4, label: 'MiniMax-Text-01' },
  // 文心（官方定价）
  'wenxin:ernie-4.0-8k':        { input: 30, output: 60, label: 'ERNIE 4.0 Turbo' },
  // ModelScope（免费）
  'modelscope:Qwen/Qwen3-235B-A22B': { input: 0, output: 0, label: 'ModelScope Qwen3 (免费)' },
}

export interface CostEstimate {
  provider: string
  model: string
  label: string
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedCostYuan: number | null // null = 无法估算
  isFree: boolean
}

/**
 * 估算分析成本
 * @param totalChars 总字数
 * @param chunkCount 分块数
 * @param maxTokensPerChunk 每块最大输出 token
 */
export function estimateCost(
  totalChars: number,
  chunkCount: number,
  maxTokensPerChunk: number,
): CostEstimate {
  const config = getMasterAIConfig()
  const key = `${config.provider}:${config.model}`

  // 输入 token 估算：每个 chunk ≈ chunkChars * 1.5 + system prompt ~500 tokens
  const avgChunkChars = totalChars / chunkCount
  const inputTokensPerChunk = Math.round(avgChunkChars * 1.5 + 500)
  const totalInput = inputTokensPerChunk * chunkCount
  const totalOutput = maxTokensPerChunk * chunkCount

  const price = PRICE_TABLE[key]
  let cost: number | null = null
  let isFree = false

  if (price) {
    cost = (totalInput / 1_000_000) * price.input + (totalOutput / 1_000_000) * price.output
    isFree = price.input === 0 && price.output === 0
  }

  return {
    provider: config.provider,
    model: config.model,
    label: price?.label || `${config.provider}/${config.model}`,
    estimatedInputTokens: totalInput,
    estimatedOutputTokens: totalOutput,
    estimatedCostYuan: cost,
    isFree,
  }
}
