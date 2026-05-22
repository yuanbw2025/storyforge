import type { AIConfig, ChatMessage } from '../types'
import { AIError } from '../types'
import { createLog, updateLog, type TokenUsage } from './logger'

/** 可变容器，streamChat 写入 usage，调用方读取 */
export interface StreamResult {
  usage?: TokenUsage
}

/**
 * 根据 provider 构造请求 URL 和 headers
 */
function buildRequest(config: AIConfig, messages: ChatMessage[], stream: boolean) {
  // 标准化 baseUrl：去除尾部斜杠
  const baseUrl = config.baseUrl.replace(/\/+$/, '')

  // 基础请求体：所有 provider 都需要的字段
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream,
  }

  // 流式请求时要求返回 token 用量
  // stream_options 仅 OpenAI / DeepSeek / Qwen 等兼容 provider 支持
  // 智谱 GLM / 文心 / Poe / Gemini 等不支持，传了会报参数错误
  const NO_STREAM_OPTIONS: Set<string> = new Set(['glm', 'wenxin', 'poe', 'gemini', 'ollama'])
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
  } else {
    if (config.temperature !== undefined) body.temperature = config.temperature
    // maxTokens > 0 才传，0 = 不限制（由模型自身决定）
    if (config.maxTokens && config.maxTokens > 0) body.max_tokens = config.maxTokens
  }

  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
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
): AsyncGenerator<string> {
  const req = buildRequest(config, messages, true)

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
): Promise<string> {
  const req = buildRequest(config, messages, false)

  const response = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new AIError(response!.status, errorText)
  }

  const json = await response.json()
  return json.choices?.[0]?.message?.content || ''
}
