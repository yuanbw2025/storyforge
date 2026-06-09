/**
 * 上下文窗口预算管理
 *
 * Phase 21.3：
 * - 模型上下文窗口预设（各平台/模型的 maxContext）
 * - Token 估算（中文 ≈ 1.5 token/字）
 * - 分层注入策略（L0 常驻 → L1 核心 → L2 扩展 → L3 增强）
 * - 预算计算与自动裁剪
 */

import type { AIProvider, ChatMessage } from '../types'

// ── 模型上下文窗口预设 ──────────────────────────────

export interface ModelContextPreset {
  label: string
  maxContext: number // 最大上下文 token
  maxOutput: number  // 最大输出 token
}

/**
 * 各模型的上下文窗口大小（单位：token）
 * 键 = provider:model 或 provider（作为该 provider 的默认值）
 */
export const MODEL_CONTEXT_PRESETS: Record<string, ModelContextPreset> = {
  // DeepSeek
  'deepseek': { label: 'DeepSeek 默认', maxContext: 64_000, maxOutput: 8_192 },
  'deepseek:deepseek-v4-flash': { label: 'DeepSeek V4 Flash', maxContext: 128_000, maxOutput: 8_192 },
  'deepseek:deepseek-v4-pro': { label: 'DeepSeek V4 Pro', maxContext: 128_000, maxOutput: 16_384 },
  'deepseek:deepseek-chat': { label: 'DeepSeek Chat', maxContext: 64_000, maxOutput: 8_192 },

  // Gemini
  'gemini': { label: 'Gemini 默认', maxContext: 1_000_000, maxOutput: 8_192 },
  'gemini:gemini-2.5-flash': { label: 'Gemini 2.5 Flash', maxContext: 1_000_000, maxOutput: 65_536 },
  'gemini:gemini-2.5-pro': { label: 'Gemini 2.5 Pro', maxContext: 1_000_000, maxOutput: 65_536 },
  'gemini:gemini-2.0-flash': { label: 'Gemini 2.0 Flash', maxContext: 1_000_000, maxOutput: 8_192 },

  // OpenAI
  'openai': { label: 'OpenAI 默认', maxContext: 128_000, maxOutput: 16_384 },
  'openai:gpt-4o': { label: 'GPT-4o', maxContext: 128_000, maxOutput: 16_384 },
  'openai:gpt-4o-mini': { label: 'GPT-4o Mini', maxContext: 128_000, maxOutput: 16_384 },

  // Claude
  'claude': { label: 'Claude 默认', maxContext: 200_000, maxOutput: 8_192 },
  'claude:claude-sonnet-4-20250514': { label: 'Claude Sonnet 4', maxContext: 200_000, maxOutput: 8_192 },

  // Qwen
  'qwen': { label: 'Qwen 默认', maxContext: 32_000, maxOutput: 8_192 },
  'qwen:qwen-max': { label: 'Qwen Max', maxContext: 32_000, maxOutput: 8_192 },
  'qwen:qwen-plus': { label: 'Qwen Plus', maxContext: 128_000, maxOutput: 8_192 },

  // Kimi (Moonshot)
  'kimi': { label: 'Kimi 默认', maxContext: 8_000, maxOutput: 4_096 },
  'kimi:moonshot-v1-8k': { label: 'Moonshot 8K', maxContext: 8_000, maxOutput: 4_096 },
  'kimi:moonshot-v1-32k': { label: 'Moonshot 32K', maxContext: 32_000, maxOutput: 4_096 },
  'kimi:moonshot-v1-128k': { label: 'Moonshot 128K', maxContext: 128_000, maxOutput: 4_096 },

  // Doubao
  'doubao': { label: '豆包默认', maxContext: 32_000, maxOutput: 4_096 },

  // GLM
  'glm': { label: 'GLM 默认', maxContext: 128_000, maxOutput: 4_096 },
  'glm:glm-4-flash': { label: 'GLM-4 Flash', maxContext: 128_000, maxOutput: 4_096 },

  // MiniMax
  'minimax': { label: 'MiniMax 默认', maxContext: 245_000, maxOutput: 16_384 },

  // ModelScope
  'modelscope': { label: 'ModelScope 默认', maxContext: 32_000, maxOutput: 8_192 },

  // Ollama (本地部署，窗口大小取决于模型)
  'ollama': { label: 'Ollama 默认', maxContext: 8_000, maxOutput: 4_096 },

  // Poe
  'poe': { label: 'Poe 默认', maxContext: 128_000, maxOutput: 4_096 },

  // Wenxin (文心)
  'wenxin': { label: '文心默认', maxContext: 8_000, maxOutput: 4_096 },
}

/** 获取模型的上下文窗口预设 */
export function getModelPreset(provider: AIProvider, model: string): ModelContextPreset {
  // 先精确匹配 provider:model
  const exact = MODEL_CONTEXT_PRESETS[`${provider}:${model}`]
  if (exact) return exact
  // 再用 provider 默认
  const fallback = MODEL_CONTEXT_PRESETS[provider]
  if (fallback) return fallback
  // 兜底
  return { label: '未知模型', maxContext: 8_000, maxOutput: 4_096 }
}

// ── Token 估算 ──────────────────────────────────────

/**
 * 估算中文文本的 token 数
 * 中文约 1.5 token/字（BPE 编码特性），英文约 1.3 token/word
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  // 粗略区分中英文
  const cjkCount = (text.match(/[一-鿿㐀-䶿]/g) || []).length
  const otherLen = text.length - cjkCount
  // CJK: ~1.5 token/字; ASCII: ~0.25 token/char (4 chars ≈ 1 token)
  return Math.round(cjkCount * 1.5 + otherLen * 0.25)
}

// ── 上下文分层策略 ──────────────────────────────────

/**
 * 注入层级定义：
 * - L0 常驻：system prompt 基础指令（不可裁剪）
 * - L1 核心：故事核心 + 当前章节细纲 + 上一章结尾
 * - L2 扩展：世界观 + 角色 + 伏笔
 * - L3 增强：参考作品风格 + few-shot 示例 + 记忆系统
 */
export type ContextLayer = 'L0' | 'L1' | 'L2' | 'L3'

export interface ContextSegment {
  /** 段落标签（显示用） */
  label: string
  /** 注入层级 */
  layer: ContextLayer
  /** 内容文本 */
  content: string
  /** 估算的 token 数 */
  tokens: number
  /** 是否可裁剪 */
  trimmable: boolean
}

/** 从 prompt messages 解析上下文段 */
export function analyzeContextSegments(
  parts: { label: string; content: string; layer: ContextLayer }[],
): ContextSegment[] {
  return parts.map(p => ({
    ...p,
    tokens: estimateTokens(p.content),
    trimmable: p.layer !== 'L0',
  }))
}

/** 上下文预算计算结果 */
export interface ContextBudget {
  /** 模型最大上下文 */
  maxContext: number
  /** 模型最大输出 */
  maxOutput: number
  /** 可用于输入的 token（= maxContext - maxOutput - 安全边际） */
  inputBudget: number
  /** 各段的 token 占用 */
  segments: ContextSegment[]
  /** 总输入 token */
  totalInputTokens: number
  /** 使用率 (0-1) */
  usageRatio: number
  /** 是否超窗口 */
  overBudget: boolean
  /** 安全边际 token（预留 5%） */
  safetyMargin: number
}

/** 计算上下文预算 */
export function calculateBudget(
  provider: AIProvider,
  model: string,
  segments: ContextSegment[],
): ContextBudget {
  const preset = getModelPreset(provider, model)
  const safetyMargin = Math.round(preset.maxContext * 0.05) // 5% 安全边际
  const inputBudget = preset.maxContext - preset.maxOutput - safetyMargin
  const totalInputTokens = segments.reduce((sum, s) => sum + s.tokens, 0)

  return {
    maxContext: preset.maxContext,
    maxOutput: preset.maxOutput,
    inputBudget,
    segments,
    totalInputTokens,
    usageRatio: inputBudget > 0 ? totalInputTokens / inputBudget : 0,
    overBudget: totalInputTokens > inputBudget,
    safetyMargin,
  }
}

/**
 * 自动裁剪：从 L3 → L2 逐层删除，直到 fit
 * 返回新的 segments 列表（不修改原数组）
 */
export function autoTrimToFit(
  budget: ContextBudget,
): { segments: ContextSegment[]; trimmedLayers: ContextLayer[] } {
  if (!budget.overBudget) {
    return { segments: budget.segments, trimmedLayers: [] }
  }

  const trimmedLayers: ContextLayer[] = []
  let remaining = [...budget.segments]
  let total = budget.totalInputTokens

  // L3 → L2 → L1 按优先级裁剪
  for (const layer of ['L3', 'L2', 'L1'] as ContextLayer[]) {
    if (total <= budget.inputBudget) break
    const layerSegments = remaining.filter(s => s.layer === layer && s.trimmable)
    if (layerSegments.length > 0) {
      const trimmedTokens = layerSegments.reduce((sum, s) => sum + s.tokens, 0)
      remaining = remaining.filter(s => s.layer !== layer || !s.trimmable)
      total -= trimmedTokens
      trimmedLayers.push(layer)
    }
  }

  return { segments: remaining, trimmedLayers }
}

export interface TrimmedMessagesResult {
  messages: ChatMessage[]
  trimmed: boolean
  totalInputTokens: number
  inputBudget: number
}

/** True request-side trimming used before fetch, not only for the UI budget preview. */
export function trimMessagesToFit(
  messages: ChatMessage[],
  provider: AIProvider,
  model: string,
  maxOutput?: number,
): TrimmedMessagesResult {
  const preset = getModelPreset(provider, model)
  const safetyMargin = Math.round(preset.maxContext * 0.05)
  const inputBudget = preset.maxContext - (maxOutput && maxOutput > 0 ? maxOutput : preset.maxOutput) - safetyMargin
  const copy = messages.map(message => ({ ...message }))
  let total = copy.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  let trimmed = false

  let guard = 0
  while (total > inputBudget && guard++ < copy.length * 3) {
    const index = copy.findIndex(message =>
      message.role !== 'system' && message.content !== '（此段因上下文窗口限制已裁剪）')
    if (index < 0) break
    const tokens = estimateTokens(copy[index].content)
    const overflow = total - inputBudget
    if (tokens <= overflow + 128) {
      copy[index].content = '（此段因上下文窗口限制已裁剪）'
    } else {
      const keepTokens = Math.max(64, tokens - overflow - 128)
      copy[index].content = trimTextToApproxTokens(copy[index].content, keepTokens)
    }
    total = copy.reduce((sum, message) => sum + estimateTokens(message.content), 0)
    trimmed = true
  }

  return { messages: copy, trimmed, totalInputTokens: total, inputBudget }
}

function trimTextToApproxTokens(text: string, keepTokens: number): string {
  if (estimateTokens(text) <= keepTokens) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = text.slice(text.length - mid)
    if (estimateTokens(candidate) <= keepTokens) lo = mid
    else hi = mid - 1
  }
  return `（前文因上下文窗口限制已裁剪）\n${text.slice(text.length - lo)}`
}

/** 格式化 token 数为人类可读 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** 获取使用率对应的颜色等级 */
export function getBudgetColorClass(ratio: number): string {
  if (ratio >= 0.95) return 'text-error'
  if (ratio >= 0.8) return 'text-warning'
  if (ratio >= 0.6) return 'text-yellow-400'
  return 'text-success'
}

export function getBudgetBgClass(ratio: number): string {
  if (ratio >= 0.95) return 'bg-error'
  if (ratio >= 0.8) return 'bg-warning'
  if (ratio >= 0.6) return 'bg-yellow-400'
  return 'bg-success'
}
