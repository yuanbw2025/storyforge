import type { AIConfig, ChatMessage } from '../types'
import { AIError } from '../types'
import { createLog, updateLog, type TokenUsage } from './logger'
import { recordUsage } from './usage-log'
import { estimateTokens, trimMessagesToFit } from './context-budget'
import { buildOpenAIEndpoint } from './openai-endpoint'
import { getAIConfigPresetSessionApiKey, useAIConfigStore } from '../../stores/ai-config'
import { resolveAIConfigForTask, type AITaskKind } from './task-routing'

/** 调用元信息（用于消耗统计分类） */
export interface AICallMeta {
  /** 消耗类型标识（moduleKey 或显式 category，如 'chapter.content'） */
  category?: string
  projectId?: number | null
  /** 调用方显式要求保留的临时生成参数，不参与持久化。 */
  configOverrides?: Partial<AIConfig>
  /**
   * 默认沿用既有生成链的自动裁剪；协议型调用可要求拒绝裁剪，
   * 避免系统指令、用户目标或工具证据被静默移除后继续执行。
   */
  contextOverflowPolicy?: 'trim' | 'reject'
}

export function resolveRequestConfig(config: AIConfig, meta?: AICallMeta) {
  const state = useAIConfigStore.getState()
  return resolveAIConfigForTask({
    category: meta?.category,
    requestedConfig: config,
    globalConfig: state.config,
    presets: state.presets.map(preset => ({
      ...preset,
      config: {
        ...preset.config,
        apiKey: preset.config.apiKey || getAIConfigPresetSessionApiKey(preset.id),
      },
    })),
    routes: state.taskRoutes,
    explicitOverrides: meta?.configOverrides,
  })
}

export type AIRequestConfigResolution = ReturnType<typeof resolveRequestConfig>

function warnRouteFallback(resolved: ReturnType<typeof resolveRequestConfig>, meta?: AICallMeta): void {
  if (resolved.fallbackReason) {
    console.warn(`[AI] task route fallback (${resolved.fallbackReason}): ${meta?.category ?? 'uncategorized'}`)
  }
}

function usageEntry(
  meta: AICallMeta | undefined,
  config: AIConfig,
  taskKind: AITaskKind | null,
  usage: TokenUsage,
) {
  return {
    projectId: meta?.projectId ?? null,
    timestamp: Date.now(),
    category: meta?.category ?? '',
    provider: config.provider,
    model: config.model,
    taskKind,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  }
}

/** 可变容器，streamChat 写入 usage，调用方读取 */
export interface StreamResult {
  usage?: TokenUsage
}

/** 可变容器，chat 写入非流式调用返回的真实 token 用量。 */
export interface ChatResult {
  usage?: TokenUsage
  /** Raw OpenAI-compatible tool_calls; the Agent protocol validates it. */
  toolCalls?: unknown
  toolCallsPresent?: boolean
  finishReason?: string
}

export interface ChatToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}

export interface ChatRequestOptions {
  tools?: readonly ChatToolDefinition[]
  toolChoice?: 'auto'
  responseFormat?: 'json_object'
  jsonSchema?: {
    name: string
    schema: Record<string, unknown>
    strict?: boolean
  }
}

export function estimateChatRequestOptionsTokens(options?: ChatRequestOptions): number {
  if (!options) return 0
  return estimateTokens(JSON.stringify({
    ...(options.tools ? { tools: options.tools, tool_choice: options.toolChoice } : {}),
    ...(options.responseFormat ? { response_format: { type: options.responseFormat } } : {}),
    ...(options.jsonSchema ? {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: options.jsonSchema.name,
          strict: options.jsonSchema.strict ?? true,
          schema: options.jsonSchema.schema,
        },
      },
    } : {}),
  }))
}

/**
 * 根据 provider 构造请求 URL 和 headers
 */
function buildRequest(
  config: AIConfig,
  messages: ChatMessage[],
  stream: boolean,
  options?: ChatRequestOptions,
) {
  // 基础请求体：所有 provider 都需要的字段
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream,
  }
  if (options?.tools) {
    body.tools = options.tools
    body.tool_choice = options.toolChoice
  }
  if (options?.responseFormat && options.jsonSchema) {
    throw new Error('ChatRequestOptions 不能同时声明 json_object 与 json_schema')
  }
  if (options?.responseFormat) body.response_format = { type: options.responseFormat }
  if (options?.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.jsonSchema.name,
        strict: options.jsonSchema.strict ?? true,
        schema: options.jsonSchema.schema,
      },
    }
  }

  // 流式请求时要求返回 token 用量
  // stream_options 仅 OpenAI / DeepSeek / Qwen 等兼容 provider 支持
  // 智谱 GLM / 文心 / Poe / Gemini 等不支持，传了会报参数错误
  const NO_STREAM_OPTIONS: Set<string> = new Set(['glm', 'wenxin', 'poe', 'gemini', 'ollama', 'longcat'])
  if (stream && !NO_STREAM_OPTIONS.has(config.provider)) {
    body.stream_options = { include_usage: true }
  }

  // Poe 官方文档明确只需 model + messages，不要传额外参数
  // （Claude 模型在 Poe 上自动启用 thinking，传 max_tokens/temperature 会冲突报 400）
  if (config.provider === 'poe') {
    // Poe: 不传额外参数
  } else if (config.provider === 'deepseek') {
    const isThinkingModel = config.model.includes('v4-pro')
    if (isThinkingModel) {
      body.thinking = { type: 'enabled' }
      body.reasoning_effort = 'high'
    } else {
      if (config.temperature !== undefined) body.temperature = config.temperature
    }
    // maxTokens > 0 才传，0 = 不限制（由模型自身决定）
    if (config.maxTokens && config.maxTokens > 0) body.max_tokens = config.maxTokens
  } else if (config.provider === 'glm') {
    // 智谱 GLM：temperature 范围 (0, 1]，超出会报 1210
    if (config.temperature !== undefined) {
      body.temperature = Math.min(Math.max(config.temperature, 0.01), 1.0)
    }
    if (config.maxTokens && config.maxTokens > 0) body.max_tokens = config.maxTokens
  } else if (config.provider === 'longcat') {
    // LongCat OpenAI 兼容端点：temperature 范围 0~1，且不声明 stream_options。
    if (config.temperature !== undefined) {
      body.temperature = Math.min(Math.max(config.temperature, 0), 1.0)
    }
    if (config.maxTokens && config.maxTokens > 0) body.max_tokens = config.maxTokens
  } else {
    if (config.temperature !== undefined) body.temperature = config.temperature
    // maxTokens > 0 才传，0 = 不限制（由模型自身决定）
    if (config.maxTokens && config.maxTokens > 0) body.max_tokens = config.maxTokens
  }

  return {
    url: buildOpenAIEndpoint(config.baseUrl, 'chat/completions'),
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  }
}

/**
 * 统一的流式聊天接口
 * 使用 AsyncGenerator 逐块 yield 文本内容
 */
export async function* streamChat(
  messages: ChatMessage[],
  config: AIConfig,
  signal?: AbortSignal,
  result?: StreamResult,
  meta?: AICallMeta,
): AsyncGenerator<string> {
  const resolved = resolveRequestConfig(config, meta)
  warnRouteFallback(resolved, meta)
  config = resolved.config
  const trimmed = trimMessagesToFit(messages, config.provider, config.model, config.maxTokens, config.contextWindow)
  if (trimmed.trimmed && meta?.contextOverflowPolicy === 'reject') {
    throw new Error(
      `当前模型上下文窗口不足以容纳完整请求（${trimmed.totalInputTokens}/${trimmed.inputBudget} tokens）；已拒绝静默裁剪。`,
    )
  }
  if (trimmed.trimmed) {
    console.warn(`[AI] request messages trimmed to fit context window: ${trimmed.totalInputTokens}/${trimmed.inputBudget} tokens`)
  }
  if (!trimmed.protectedEnvelopePreserved) {
    throw new Error('当前模型上下文窗口无法容纳最低连续性保护块；请降低输出长度或改用更大上下文模型。')
  }
  const req = buildRequest(config, trimmed.messages, true)

  const log = createLog({
    type: 'stream',
    provider: config.provider,
    url: req.url,
    model: config.model,
    status: 'pending',
  })

  const startTime = Date.now()

  try {
    // 自动重试：遇到 429（频率限制）或 503（服务不可用）时，最多重试 2 次
    let response: Response | null = null
    const MAX_RETRIES = 2
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
        signal,
      })

      if (response.ok) break

      // 429/503 可重试
      if ((response!.status === 429 || response!.status === 503) && attempt < MAX_RETRIES) {
        const wait = (attempt + 1) * 2000 // 2s, 4s
        console.warn(`[AI] HTTP ${response!.status}，${wait / 1000}s 后重试（${attempt + 1}/${MAX_RETRIES}）`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }

      break
    }

    if (!response!.ok) {
      const errorText = await response!.text()
      const duration = Date.now() - startTime
      updateLog(log.id, { status: 'error', statusCode: response!.status, duration, errorMessage: errorText.slice(0, 200) })
      throw new AIError(response!.status, errorText)
    }

    const reader = response!.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let usage: TokenUsage | undefined

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') {
            const logUpdate: Record<string, unknown> = { status: 'success', statusCode: response!.status, duration: Date.now() - startTime }
            if (usage) logUpdate.usage = usage
            if (result && usage) result.usage = usage
            updateLog(log.id, logUpdate)
            if (usage) void recordUsage(usageEntry(meta, config, resolved.taskKind, usage))
            return
          }
          try {
            const json = JSON.parse(data)
            const content = json.choices?.[0]?.delta?.content
            if (content) yield content
            // 提取 token 用量（通常在最后一个 chunk 中）
            if (json.usage) {
              usage = {
                inputTokens: json.usage.prompt_tokens ?? 0,
                outputTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }

    const logUpdate: Record<string, unknown> = { status: 'success', statusCode: response!.status, duration: Date.now() - startTime }
    if (usage) logUpdate.usage = usage
    if (result && usage) result.usage = usage
    updateLog(log.id, logUpdate)
    if (usage) void recordUsage(usageEntry(meta, config, resolved.taskKind, usage))
  } catch (err) {
    if (err instanceof AIError) throw err
    const duration = Date.now() - startTime
    updateLog(log.id, { status: 'error', duration, errorMessage: (err as Error).message })
    throw err
  }
}

/**
 * 非流式聊天（用于简单调用如测试连接）
 */
export async function chat(
  messages: ChatMessage[],
  config: AIConfig,
  meta?: AICallMeta,
  signal?: AbortSignal,
  result?: ChatResult,
  options?: ChatRequestOptions,
  frozenResolution?: AIRequestConfigResolution,
): Promise<string> {
  const resolved = frozenResolution ?? resolveRequestConfig(config, meta)
  warnRouteFallback(resolved, meta)
  config = resolved.config
  const trimmed = trimMessagesToFit(
    messages,
    config.provider,
    config.model,
    config.maxTokens,
    config.contextWindow,
    estimateChatRequestOptionsTokens(options),
  )
  if (trimmed.trimmed && meta?.contextOverflowPolicy === 'reject') {
    throw new Error(
      `当前模型上下文窗口不足以容纳完整请求（${trimmed.totalInputTokens}/${trimmed.inputBudget} tokens）；已拒绝静默裁剪。`,
    )
  }
  if (trimmed.trimmed) {
    console.warn(`[AI] request messages trimmed to fit context window: ${trimmed.totalInputTokens}/${trimmed.inputBudget} tokens`)
  }
  if (!trimmed.protectedEnvelopePreserved) {
    throw new Error('当前模型上下文窗口无法容纳最低连续性保护块；请降低输出长度或改用更大上下文模型。')
  }
  const req = buildRequest(config, trimmed.messages, false, options)

  const response = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    signal,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new AIError(response!.status, errorText)
  }

  const json = await response.json()
  if (json.usage) {
    const usage = {
      inputTokens: json.usage.prompt_tokens ?? 0,
      outputTokens: json.usage.completion_tokens ?? 0,
      totalTokens: json.usage.total_tokens ?? 0,
    }
    if (result) result.usage = usage
    void recordUsage(usageEntry(meta, config, resolved.taskKind, usage))
  }
  const choice = json.choices?.[0]
  if (result && choice?.message && typeof choice.message === 'object'
    && Object.prototype.hasOwnProperty.call(choice.message, 'tool_calls')) {
    result.toolCallsPresent = true
    result.toolCalls = choice.message.tool_calls
  }
  if (result && typeof choice?.finish_reason === 'string') {
    result.finishReason = choice.finish_reason
  }
  return typeof choice?.message?.content === 'string' ? choice.message.content : ''
}
