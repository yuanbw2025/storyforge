import type { ContextMaterialAllocationV2, ExplicitAuthorConsumptionConstraintsV2, ModelCapacityFactsV2 } from '../types/agent-run'
import { projectModelCapacityFactsV2 } from './model-capacity'
import { assessCompleteRequestCapacityV2, type CompleteRequestMeasurementV2 } from './context-budget'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from './chapter-memory/text-normalization'
import { freezeNativeCodexAssessmentV2, serializeNativeCodexAssessmentV2, prepareNativeCodexRequestV2, type NativeCodexAssessmentContextV2, type NativePreparedRequestV2Handle } from './codex-transport'
import { referenceServiceOutputLimit } from '../reference-analysis/request-capacity'
import { inheritModelCapacityV1, prepareModelCapacityV1, freezeModelCapacityV1, modelInputBudgetV1 } from './model-capacity'
import { assertGenerationAvailable } from '../showcase/policy'
import { streamCodex, CODEX_BASE_URL, assertModelDispatchGuardV1, modelDispatchWasCancelledV1, ModelDispatchGuardRejectedV1, type CodexRequestRefV1 } from './codex-transport'
import type { CodexTerminalFailureV1 } from './codex-terminal-failure'
import type { AIConfig, ChatMessage } from '../types'
import { AIError, CodexRequestError } from '../types'
import { createLog, updateLog, type TokenUsage } from './logger'
import { recordUsage } from './usage-log'
import { estimateTokens, trimMessagesToFit } from './context-budget'
import { buildOpenAIEndpoint } from './openai-endpoint'
import { getAIConfigPresetApiKeyV1, useAIConfigStore } from '../../stores/ai-config'
import { resolveAIConfigForTask, type AITaskKind } from './task-routing'
import { AICompletionResponseErrorV1, inspectCompletionResponseV1, requireCompletionTextV1 } from './completion-response'
import { allowsSamplingTemperature, targetsOfficialProvider } from './provider-model-lifecycle'
import { supportsAgnesThinkingModeV1 } from './agnes-parameters'

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
  /** Durable callers account for each attempt themselves and forbid hidden transport resends. */
  transportRetryPolicy?: 'none' | 'transient'
}

export function resolveRequestConfig(config: AIConfig, meta?: AICallMeta) {
  const state = useAIConfigStore.getState()
  const resolution = resolveAIConfigForTask({
    category: meta?.category,
    requestedConfig: config,
    globalConfig: state.config,
    presets: state.presets.map(preset => ({
      ...preset,
      config: {
        ...preset.config,
        apiKey: getAIConfigPresetApiKeyV1(preset),
      },
    })),
    routes: state.taskRoutes,
    explicitOverrides: meta?.configOverrides,
  })
  return { ...resolution, config: inheritModelCapacityV1(config, resolution.config) }
}

export type AIRequestConfigResolution = ReturnType<typeof resolveRequestConfig>

export interface AIRequestSettingsV1 {
  version: 'ai-request-settings-v1'
  provider: AIConfig['provider']
  model: string
  transport: 'openai-compatible' | 'codex-bridge'
  stream: boolean
  /** Configured values are distinct from provider-specific transmitted values. */
  requested: { temperature: number | null; maxTokens: number | null }
  modelCapacity?: import('./model-capacity').ModelCapacityV1
  capacityPolicy?: 'reference-service'
  parameters: Record<string, unknown>
}

/** Describe the same request builder used for dispatch, without credentials,
 * endpoint, headers, prompts or user data. The resolution is already frozen. */
export function describeResolvedAIRequestSettingsV1(
  resolution: AIRequestConfigResolution,
  stream: boolean,
  options?: ChatRequestOptions,
  messages: ReadonlyArray<{ role: ChatMessage['role']; content: unknown }> = [],
): AIRequestSettingsV1 {
  const config = resolution.config
  const modelCapacity = freezeModelCapacityV1(config)
  const parameters: Record<string, unknown> = {}
  if (config.provider !== 'codex') {
    const body = JSON.parse(buildRequest(config, messages, stream, options).body) as Record<string, unknown>
    for (const key of ['temperature', 'max_tokens', 'reasoning_effort', 'thinking', 'chat_template_kwargs']) {
      if (body[key] !== undefined) parameters[key] = body[key]
    }
    if (body.response_format && typeof body.response_format === 'object'
      && (body.response_format as { type?: unknown }).type === 'json_object') {
      parameters.response_format = { type: 'json_object' }
    }
  }
  return {
    version: 'ai-request-settings-v1', provider: config.provider, model: config.model,
    transport: config.provider === 'codex' ? 'codex-bridge' : 'openai-compatible', stream,
    requested: { temperature: config.temperature ?? null, maxTokens: config.maxTokens ?? null },
    parameters, modelCapacity, ...(options?.capacityPolicy ? { capacityPolicy: options.capacityPolicy } : {}),
  }
}

function warnRouteFallback(resolved: ReturnType<typeof resolveRequestConfig>, meta?: AICallMeta): void {
  if (resolved.fallbackReason) {
    console.warn(`[AI] task route fallback (${resolved.fallbackReason}): ${meta?.category ?? 'uncategorized'}`)
  }
}

function usageEntry(
  meta: AICallMeta | undefined,
  config: AIConfig,
  taskKind: AITaskKind | null,
  usage: Pick<TokenUsage, 'inputTokens' | 'outputTokens'>,
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
  finishReason?: string
  completion?: 'complete' | 'cancelled' | 'failed' | 'unknown'
}

/** 可变容器，chat 写入非流式调用返回的真实 token 用量。 */
export interface ChatResult {
  usage?: TokenUsage
  /** Opt in to exact field presence from an ordinary non-streaming provider response. */
  captureProviderTokenUsage?: boolean
  providerTokenUsage?: Partial<TokenUsage>
  /** Local, per-call admission after request preparation, immediately before dispatch. */
  beforeModelDispatch?: () => Promise<void>
  /** Per-call observation; a stopped guard never entered transport. */
  modelDispatchGuardCancelled?: true
  /** Optional durable caller hook. Must finish saving the exact local request
   * reference before its single POST. Failure prevents dispatch; no retry.
   * Opt-in receipts are held until this owner saves and acknowledges them.
   * This is transport metadata only, not candidate or adoption authority. */
  onCodexRequestPrepared?: (request: Readonly<CodexRequestRefV1>) => Promise<void>
  localCodexRequest?: Readonly<CodexRequestRefV1>
  /**
   * Observable transport boundary for callers that must make durable retry
   * and billing decisions. This records only delivery state and HTTP status;
   * it never contains prompts, responses, headers or credentials.
   */
  requestLifecycle?: {
    phase: 'pre-dispatch' | 'request-dispatched' | 'response-observed'
    responseStatus: number | null
  }
  /** Confirmed local turn failure; delivery remains dispatched and never auto-retryable. */
  terminalFailure?: CodexTerminalFailureV1
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
  /** Private prepared channel; never spread into a provider body. */
  preparedRequestV2?: BoundPreparedAIRequestV2

  /** Registered reference executors retain full input and use only evidenced service limits. */
  capacityPolicy?: 'reference-service'

  tools?: readonly ChatToolDefinition[]
  toolChoice?: 'auto'
  responseFormat?: 'json_object'
  /** Explicit mode for bounded extraction on DeepSeek and documented Agnes Flash models. */
  thinkingMode?: 'enabled' | 'disabled'
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
  messages: ReadonlyArray<{ role: ChatMessage['role']; content: unknown }>,
  stream: boolean,
  options?: ChatRequestOptions,
  preparedOutputV2?: { tokens: number | null },
) {
  // 基础请求体：所有 provider 都需要的字段
  const capacity = preparedOutputV2 ? undefined : freezeModelCapacityV1(config)
  config = { ...config, maxTokens: preparedOutputV2 ? preparedOutputV2.tokens ?? 0 : options?.capacityPolicy === 'reference-service'
    ? referenceServiceOutputLimit(config, messages) ?? 0
    : modelInputBudgetV1(capacity!, config.maxTokens).outputBudget }
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
  // Retain legacy exclusions for private/unknown targets. Current official Poe
  // and Gemini OpenAI compatibility contracts support requesting stream usage.
  const NO_STREAM_OPTIONS: Set<string> = new Set(['glm', 'wenxin', 'poe', 'gemini', 'ollama', 'longcat'])
  const officialUsageTarget = (config.provider === 'poe' || config.provider === 'gemini') && targetsOfficialProvider(config)
  if (stream && (!NO_STREAM_OPTIONS.has(config.provider) || officialUsageTarget)) {
    body.stream_options = { include_usage: true }
  }

  // Preserve Poe sampling/default behavior and private gateway contracts.
  // The official API supports an explicitly configured positive output limit.
  if (config.provider === 'poe') {
    if (officialUsageTarget && config.maxTokens && config.maxTokens > 0) body.max_tokens = config.maxTokens
  } else if (config.provider === 'deepseek') {
    const isThinkingModel = options?.thinkingMode
      ? options.thinkingMode === 'enabled' : config.model.includes('v4-pro')
    if (isThinkingModel) {
      body.thinking = { type: 'enabled' }
      body.reasoning_effort = 'high'
    } else {
      if (options?.thinkingMode === 'disabled') body.thinking = { type: 'disabled' }
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
    // Agnes documents this boolean extension for 2.5/3.0 Flash. Keep it
    // opt-in so ordinary calls and other providers retain their own defaults.
    if (options?.thinkingMode && supportsAgnesThinkingModeV1(config)) {
      body.chat_template_kwargs = { enable_thinking: options.thinkingMode === 'enabled' }
    }
    if (config.temperature !== undefined && allowsSamplingTemperature(config)) body.temperature = config.temperature
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

export interface ChatImageInputV1 {
  label: string
  dataUrl: string
  detail: 'low' | 'high'
}

function parseChatImageInputV1(input: ChatImageInputV1, index: number): ChatImageInputV1 {
  if (!input.label.trim() || input.label.length > 500) {
    throw new Error(`[AI] images[${index}].label 无效`)
  }
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.dataUrl)
    || input.dataUrl.length > 24_000_000) {
    throw new Error(`[AI] images[${index}].dataUrl 不是受支持且有界的图片`)
  }
  if (input.detail !== 'low' && input.detail !== 'high') {
    throw new Error(`[AI] images[${index}].detail 无效`)
  }
  return { label: input.label.trim(), dataUrl: input.dataUrl, detail: input.detail }
}

/**
 * Non-streaming OpenAI-compatible vision request. Text is budgeted and trimmed
 * before image parts are attached; image bytes are never written to request
 * logs or returned in receipts.
 */
export async function chatWithImagesV1(
  messages: ChatMessage[],
  images: ChatImageInputV1[],
  config: AIConfig,
  meta?: AICallMeta,
  signal?: AbortSignal,
  result?: ChatResult,
  options?: ChatRequestOptions,
  frozenResolution?: AIRequestConfigResolution,
): Promise<string> {
  assertGenerationAvailable()
  if (!images.length || images.length > 12) throw new Error('[AI] 多模态请求必须包含 1–12 张图片')
  const parsedImages = images.map(parseChatImageInputV1)
  const resolved = frozenResolution ?? resolveRequestConfig(config, meta)
  warnRouteFallback(resolved, meta)
  config = await prepareModelCapacityV1(resolved.config)
  if (config.provider === 'codex') throw new CodexRequestError('Codex 本机连接目前只支持文本；图片审查请选择支持图片的 API 提供商。')
  const imageTokenReserve = parsedImages.reduce((sum, image) => sum + (image.detail === 'high' ? 1_200 : 300), 0)
  const trimmed = trimMessagesToFit(
    messages, config.provider, config.model, config.maxTokens, undefined,
    estimateChatRequestOptionsTokens(options) + imageTokenReserve, config.modelCapacity,
  )
  if (trimmed.trimmed && meta?.contextOverflowPolicy === 'reject') {
    throw new Error(
      `当前模型上下文窗口不足以容纳完整多模态请求（${trimmed.totalInputTokens}/${trimmed.inputBudget} tokens）；已拒绝静默裁剪。`,
    )
  }
  if (!trimmed.protectedEnvelopePreserved) {
    throw new Error('当前模型上下文窗口无法容纳最低多模态审查保护块。')
  }
  let userIndex = -1
  for (let index = trimmed.messages.length - 1; index >= 0; index--) {
    if (trimmed.messages[index].role === 'user') { userIndex = index; break }
  }
  if (userIndex < 0) throw new Error('[AI] 多模态请求缺少 user 消息')
  const requestMessages: Array<{ role: ChatMessage['role']; content: unknown }> = trimmed.messages.map(message => ({ ...message }))
  requestMessages[userIndex] = {
    role: 'user',
    content: [
      { type: 'text', text: trimmed.messages[userIndex].content },
      ...parsedImages.flatMap(image => [
        { type: 'text', text: `图片标签：${image.label}` },
        { type: 'image_url', image_url: { url: image.dataUrl, detail: image.detail } },
      ]),
    ],
  }
  const req = buildRequest(config, requestMessages, false, options)
  const response = await fetch(req.url, {
    method: 'POST', headers: req.headers, body: req.body, signal,
  })
  if (!response.ok) throw new AIError(response.status, await response.text())
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
  if (result && typeof choice?.finish_reason === 'string') result.finishReason = choice.finish_reason
  return typeof choice?.message?.content === 'string' ? choice.message.content : ''
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
  frozenResolution?: AIRequestConfigResolution,
): AsyncGenerator<string> {
  assertGenerationAvailable()
  const resolved = frozenResolution ?? resolveRequestConfig(config, meta)
  warnRouteFallback(resolved, meta)
  config = await prepareModelCapacityV1(resolved.config)
  const trimmed = trimMessagesToFit(messages, config.provider, config.model, config.maxTokens, undefined, 0, config.modelCapacity)
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
  if (config.provider === 'codex') {
    yield* loggedCodex(trimmed.messages, config, resolved.taskKind, meta, signal, result)
    if (result) result.completion = signal?.aborted ? 'cancelled' : 'complete'
    return
  }
  if (result) {
    delete result.usage
    delete result.finishReason
    delete result.completion
  }
  const req = buildRequest(config, trimmed.messages, true)

  const log = createLog({
    type: 'stream',
    provider: config.provider,
    url: req.url,
    model: config.model,
    status: 'pending',
  }, {
    sensitiveValues: [config.apiKey],
    baseUrl: config.baseUrl,
  })

  const startTime = Date.now()
  let usage: TokenUsage | undefined
  let finishReason: string | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let terminalObserved = false

  try {
    // 自动重试：遇到 429（频率限制）或 503（服务不可用）时，最多重试 2 次
    let response: Response | null = null
    const MAX_RETRIES = meta?.transportRetryPolicy === 'none' ? 0 : 2
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

    reader = response!.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

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
            terminalObserved = true
            if (result) result.completion = 'complete'
            updateLog(log.id, { status: 'success', statusCode: response!.status, duration: Date.now() - startTime })
            return
          }
          let json: unknown
          try { json = JSON.parse(data) } catch { continue }
          if (!json || typeof json !== 'object' || Array.isArray(json)) continue
          const chunk = json as {
            choices?: Array<{ finish_reason?: unknown; delta?: { content?: unknown } }>
            usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
          }
          const inputTokens = chunk.usage?.prompt_tokens
          const outputTokens = chunk.usage?.completion_tokens
          const totalTokens = chunk.usage?.total_tokens
          // Capture the provider snapshot before yielding: a consumer may return
          // immediately after this delta. Missing/malformed fields stay unknown.
          if (typeof inputTokens === 'number' && Number.isSafeInteger(inputTokens) && inputTokens >= 0
            && typeof outputTokens === 'number' && Number.isSafeInteger(outputTokens) && outputTokens >= 0
            && typeof totalTokens === 'number' && Number.isSafeInteger(totalTokens) && totalTokens >= 0) {
            usage = { inputTokens, outputTokens, totalTokens }
            if (result) result.usage = { ...usage }
          }
          if (typeof chunk.choices?.[0]?.finish_reason === 'string') {
            finishReason = chunk.choices[0].finish_reason
            if (result) result.finishReason = finishReason
          }
          const content = chunk.choices?.[0]?.delta?.content
          if (typeof content === 'string' && content) yield content
        }
      }
    }

    terminalObserved = true
    const completion = signal?.aborted ? 'cancelled' : finishReason ? 'complete' : 'unknown'
    if (result) result.completion = completion
    updateLog(log.id, { status: completion === 'complete' ? 'success' : 'error', statusCode: response!.status, duration: Date.now() - startTime })
  } catch (err) {
    terminalObserved = true
    if (result) result.completion = signal?.aborted || (err instanceof Error && err.name === 'AbortError') ? 'cancelled' : 'failed'
    if (err instanceof AIError) throw err
    const duration = Date.now() - startTime
    updateLog(log.id, { status: 'error', duration, errorMessage: (err as Error).message })
    throw err
  } finally {
    if (!terminalObserved) {
      if (result) result.completion = 'cancelled'
      updateLog(log.id, { status: 'error', duration: Date.now() - startTime, errorMessage: '流已由调用方停止' })
    }
    // Exactly one best-effort aggregate write for this generator. Durable
    // callers still own run/step/attempt receipts and cross-refresh accounting.
    if (usage) {
      if (result) result.usage = { ...usage }
      updateLog(log.id, { usage: { ...usage } })
      void recordUsage(usageEntry(meta, config, resolved.taskKind, usage))
    }
    if (reader) {
      try { void reader.cancel().catch(() => {}); reader.releaseLock() }
      catch { /* Cleanup must not replace the original transport error. */ }
    }
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
  if (options?.preparedRequestV2) return dispatchPreparedRequestV2(messages, config, meta, signal, result, options, frozenResolution)
  if (options?.capacityPolicy === 'reference-service' && !['reference.analysis', 'reference.summary', 'reference.characters'].includes(meta?.category ?? '')) {
    throw new Error('服务容量策略只适用于已登记的拆书请求。')
  }
  if (result?.captureProviderTokenUsage) result.providerTokenUsage = {}
  if (result) delete result.modelDispatchGuardCancelled
  assertGenerationAvailable()
  if (result) {
    result.requestLifecycle = { phase: 'pre-dispatch', responseStatus: null }
    delete result.terminalFailure
  }
  const resolved = frozenResolution ?? resolveRequestConfig(config, meta)
  warnRouteFallback(resolved, meta)
  config = await prepareModelCapacityV1(resolved.config)
  const trimmed = options?.capacityPolicy === 'reference-service'
    ? { messages, trimmed: false, protectedEnvelopePreserved: true, totalInputTokens: estimateTokens(JSON.stringify(messages)), inputBudget: estimateTokens(JSON.stringify(messages)) }
    : trimMessagesToFit(
    messages,
    config.provider,
    config.model,
    config.maxTokens,
    undefined,
    estimateChatRequestOptionsTokens(options), config.modelCapacity,
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
  if (config.provider === 'codex') {
    if (options?.tools?.length) throw new CodexRequestError('Codex 连接不支持原生 tool_calls；请使用 StoryForge 文本 Agent 协议。')
    let text = ''
    for await (const delta of loggedCodex(trimmed.messages, config, resolved.taskKind, meta, signal, result, options?.jsonSchema?.schema, options?.responseFormat, options?.capacityPolicy)) text += delta
    if (options?.responseFormat === 'json_object') {
      try { const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object') }
      catch { throw new CodexRequestError('Codex 没有返回有效 JSON 对象；保留请求记录，未自动重发。') }
    }
    return text
  }
  const req = buildRequest(config, trimmed.messages, false, options)
  const startedAt = Date.now()
  const log = createLog(
    { type: 'chat', provider: config.provider, model: config.model, url: req.url, status: 'pending' },
    { sensitiveValues: [config.apiKey], baseUrl: config.baseUrl },
  )
  try {
    if (result?.beforeModelDispatch) await assertModelDispatchGuardV1(result, signal)
    if (result) {
      result.requestLifecycle = { phase: 'request-dispatched', responseStatus: null }
    }
    const response = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      signal,
    })
    if (result) {
      result.requestLifecycle = { phase: 'response-observed', responseStatus: response.status }
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new AIError(response!.status, errorText)
    }

    let json
    try { json = await response.json() } catch {
      throw new AICompletionResponseErrorV1('invalid-json', '无法读取 chat/completions 响应。')
    }
    const responseSummary = inspectCompletionResponseV1(json).summary
    updateLog(log.id, { statusCode: response.status, responseSummary })
    if (result?.captureProviderTokenUsage && json?.usage && typeof json.usage === 'object' && !Array.isArray(json.usage)) {
      const reported = result.providerTokenUsage!
      for (const [wireKey, tokenKey] of [
        ['prompt_tokens', 'inputTokens'], ['completion_tokens', 'outputTokens'], ['total_tokens', 'totalTokens'],
      ] as const) {
        const value: unknown = json.usage[wireKey]
        if (Object.prototype.hasOwnProperty.call(json.usage, wireKey)
          && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) reported[tokenKey] = value
      }
    }
    if (json?.usage) {
      const usage = {
        inputTokens: json.usage.prompt_tokens ?? 0,
        outputTokens: json.usage.completion_tokens ?? 0,
        totalTokens: json.usage.total_tokens ?? 0,
      }
      if (result) result.usage = usage
      updateLog(log.id, { usage })
      void recordUsage(usageEntry(meta, config, resolved.taskKind, usage))
    }
    const choice = json?.choices?.[0]
    if (result && choice?.message && typeof choice.message === 'object'
      && Object.prototype.hasOwnProperty.call(choice.message, 'tool_calls')) {
      result.toolCallsPresent = true
      result.toolCalls = choice.message.tool_calls
    }
    if (result && typeof choice?.finish_reason === 'string') {
      result.finishReason = choice.finish_reason
    }
    const content = requireCompletionTextV1(json, Boolean(options?.tools?.length && result))
    updateLog(log.id, { status: 'success', duration: Date.now() - startedAt })
    return content
  } catch (error) {
    updateLog(log.id, {
      status: 'error', duration: Date.now() - startedAt,
      ...(error instanceof AIError ? { statusCode: error.status } : {}),
      errorMessage: error instanceof AICompletionResponseErrorV1 || error instanceof ModelDispatchGuardRejectedV1 ? error.message
        : error instanceof AIError ? `模型服务返回 HTTP ${error.status}` : '模型请求失败或连接中断',
    })
    throw error
  }
}

async function* loggedCodex(
  messages: ChatMessage[], config: AIConfig, taskKind: AITaskKind | null,
  meta?: AICallMeta, signal?: AbortSignal, result?: ChatResult, schema?: Record<string, unknown>, responseFormat?: 'json_object', capacityPolicy?: 'reference-service', preparedRequestV2?: NativePreparedRequestV2Handle,
): AsyncGenerator<string> {
  assertGenerationAvailable()
  if (meta?.category?.startsWith('eval.')) throw new CodexRequestError('Codex 订阅暂不支持当前带 API 金额统计的模型评测；请显式选择 API 评测预设。')
  const startedAt = Date.now()
  const receipt = result ?? {}
  let refusedBeforeDispatch = false
  const log = createLog({ type: 'chat', provider: 'codex', model: config.model, url: CODEX_BASE_URL, status: 'pending' })
  try {
    yield* streamCodex(messages, config.model, signal, receipt, schema, responseFormat, capacityPolicy, preparedRequestV2)
    updateLog(log.id, { status: 'success', duration: Date.now() - startedAt, usage: receipt.usage })
  } catch (error) {
    updateLog(log.id, { status: 'error', duration: Date.now() - startedAt, errorMessage: error instanceof Error ? error.message : 'Codex 连接失败' })
    if (error instanceof ModelDispatchGuardRejectedV1 || modelDispatchWasCancelledV1(receipt)) {
      refusedBeforeDispatch = true
      throw error
    }
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new CodexRequestError(error instanceof Error ? error.message : 'Codex 连接失败')
  } finally {
    if (!refusedBeforeDispatch && receipt.usage) void recordUsage(usageEntry(meta, config, taskKind, receipt.usage))
  }
}

export interface FrozenRequestAssessmentContextV2 { readonly requestAssessmentV2: unique symbol }
export interface PreparedAIRequestV2Handle { readonly preparedRequestV2: unique symbol }
export interface BoundPreparedAIRequestV2 { readonly boundPreparedRequestV2: unique symbol }
export interface PublicAIResponseV2 {
  text: string
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'unknown' | null
  usage: Partial<TokenUsage>
  completion: 'complete' | 'incomplete' | 'failed' | 'unknown'
  responseStatus: number | null
  wireDigest: string | null
}
export interface PreparedRequestObserverV2 {
  beforeDispatch: () => Promise<void>
  onPublicResponse: (response: PublicAIResponseV2) => Promise<void>
  onPublicDelta?: (delta: string) => Promise<void>
  onTerminal?: (completion: PublicAIResponseV2['completion']) => Promise<void>
}
export interface AIRequestEvidenceV2 {
  version: 'ai-request-evidence-v2'
  profile: 'task-request-v2'
  routeHash: string
  capacity: ModelCapacityFactsV2
  materialAllocationHash: string
  messagesHash: string
  optionsHash: string
  wireBodyHash: string
  requestHash: string
  policyHash: string
  inputMeasurement: CompleteRequestMeasurementV2
  wireOutputTokens: number | null
  forecastOutputTokens: number
  wireOutputBasis: 'evidenced-output-limit' | 'evidenced-shared-window' | 'explicit-author-constraint' | 'provider-managed'
  forecastBasis: 'source-token-estimate-v1'
  sentParameters: Record<string, unknown>
}
export class PreparedRequestStoppedV2 extends Error {
  constructor(readonly visibleObservation: PublicAIResponseV2, readonly cause: unknown) {
    super('冻结请求已停止；保留已观察原答与持久化前缀，不自动重发。')
    this.name = 'PreparedRequestStoppedV2'
  }
}
export interface RequestAssessmentV2 {
  decision: 'fit' | 'proved-overflow' | 'uncertain'
  reason: string
  inputMeasurement: CompleteRequestMeasurementV2
  wireOutputTokens: number | null
  wireOutputBasis: AIRequestEvidenceV2['wireOutputBasis']
  sentParameters: Record<string, unknown>
  /** Host memory only; the public descriptor contains only its exact digest. */
  wire: string
}
type CompleteRequestMeterV2 = (wire: string, messages: readonly ChatMessage[], options: ChatRequestOptions) => CompleteRequestMeasurementV2
interface AssessmentStateV2 {
  resolution: AIRequestConfigResolution
  capacity: ModelCapacityFactsV2
  routeHash: string
  native?: NativeCodexAssessmentContextV2
  meter: CompleteRequestMeterV2
  now: number
}
interface PreparedStateV2 {
  lengthPlan: import('../types/agent-run').TaskLengthPlanV1 | null
  assessment: AssessmentStateV2
  messages: ChatMessage[]
  options: ChatRequestOptions
  wire: string
  output: number | null
  native?: NativePreparedRequestV2Handle
  nativeBinding?: Readonly<CodexRequestRefV1>
  evidence: AIRequestEvidenceV2
  observer?: PreparedRequestObserverV2
  guard?: () => Promise<void>
  currentCheck?: () => void
  attempted: boolean
}
const assessmentsV2 = new WeakMap<FrozenRequestAssessmentContextV2, AssessmentStateV2>()
const preparedRequestsV2 = new WeakMap<PreparedAIRequestV2Handle, PreparedStateV2>()
const boundRequestsV2 = new WeakMap<BoundPreparedAIRequestV2, PreparedStateV2>()
function requestOpaqueV2<T extends object>(): T {
  return Object.freeze(Object.defineProperty(Object.create(null), 'toJSON', {
    value: () => { throw new Error('准备请求的本机句柄不得序列化。') },
  })) as T
}
function requestGuardV2(resolution: AIRequestConfigResolution): string {
  // Local-only comparison. Never persist or print this value.
  return canonicalStringify({ taskKind: resolution.taskKind, presetId: resolution.presetId,
    fallbackReason: resolution.fallbackReason ?? null, config: { ...resolution.config, modelCapacity: undefined } })
}
function plainOptionsV2(options: ChatRequestOptions): ChatRequestOptions {
  if (options.preparedRequestV2 || options.capacityPolicy) throw new Error('冻结请求不能混入旧服务策略或另一准备句柄。')
  const allowed = ['tools','toolChoice','responseFormat','thinkingMode','jsonSchema']
  if (Object.keys(options).some(key => !allowed.includes(key))) throw new Error('冻结请求选项含未登记字段。')
  return structuredClone(options)
}
/** Metadata preparation is outside fits. The existing capacity discovery and
 * routing remain the only source; no inference probe is performed. */
export async function freezeAIRequestAssessmentContextV2(
  resolution: AIRequestConfigResolution,
  meter: CompleteRequestMeterV2 = wire => ({ tokens: estimateTokens(wire), method: 'storyforge-json-estimate', version: '1', reliability: 'estimate' }),
): Promise<FrozenRequestAssessmentContextV2> {
  const resolved = structuredClone(resolution)
  resolved.config = await prepareModelCapacityV1(resolved.config)
  const connection = freezeModelCapacityV1(resolved.config)
  const routeHash = await hashCanonicalValue({ bindingHash: connection.bindingHash, provider: resolved.config.provider,
    model: resolved.config.model, taskKind: resolved.taskKind, presetId: resolved.presetId, fallbackReason: resolved.fallbackReason ?? null })
  const now = Date.now()
  const context = requestOpaqueV2<FrozenRequestAssessmentContextV2>()
  assessmentsV2.set(context, { resolution: resolved, routeHash, now, meter,
    capacity: projectModelCapacityFactsV2(resolved.config, routeHash, now),
    ...(resolved.config.provider === 'codex' ? { native: await freezeNativeCodexAssessmentV2(resolved.config.model) } : {}),
  })
  return context
}
function sentParametersV2(wire: string): Record<string, unknown> {
  const body = JSON.parse(wire) as Record<string, unknown>
  return Object.fromEntries(['model','temperature','max_tokens','thinking','reasoning_effort','chat_template_kwargs','responseFormat','receiptRetention']
    .filter(key => body[key] !== undefined).map(key => [key, structuredClone(body[key])]))
}
export function createAIRequestAssessorV2(context: FrozenRequestAssessmentContextV2) {
  const state = assessmentsV2.get(context)
  if (!state) throw new Error('完整请求评估身份无效。')
  return { assess(messages: readonly ChatMessage[], rawOptions: ChatRequestOptions,
    constraints: ExplicitAuthorConsumptionConstraintsV2 | null = null): RequestAssessmentV2 {
    const options = plainOptionsV2(rawOptions)
    const fact = state.capacity.outputTokens
    const knownOutput = fact && fact.basis !== 'declared-model' && fact.expiresAt > state.now ? fact.tokens : null
    const explicit = constraints?.maxOutputTokens ?? null
    if (!(explicit === null || Number.isSafeInteger(explicit) && explicit > 0)) throw new Error('作者输出消费约束无效。')
    // A forecast or config default is never converted into the wire limit.
    let output = knownOutput === null ? explicit : explicit === null ? knownOutput : Math.min(knownOutput, explicit)
    let outputBasis: AIRequestEvidenceV2['wireOutputBasis'] = explicit !== null && output === explicit ? 'explicit-author-constraint'
      : output !== null ? 'evidenced-output-limit' : 'provider-managed'
    if (state.native && options.tools?.length) throw new Error('本机 Codex 不支持原生 tool_calls。')
    let wire = state.native
      ? serializeNativeCodexAssessmentV2(state.native, messages, options.jsonSchema?.schema, options.responseFormat)
      : buildRequest(state.resolution.config, messages, false, options, { tokens: output }).body
    let measured = state.meter(wire, messages, options)
    const shared = state.capacity.contextTokens
    if (!state.native && output !== null && measured.reliability === 'exact' && shared
      && shared.basis !== 'declared-model' && shared.expiresAt > state.now) {
      let remaining = shared.tokens - measured.tokens
      while (remaining > 0 && output > remaining) {
        output = remaining
        outputBasis = 'evidenced-shared-window'
        wire = buildRequest(state.resolution.config, messages, false, options, { tokens: output }).body
        measured = state.meter(wire, messages, options)
        remaining = shared.tokens - measured.tokens
      }
    }
    const decision = assessCompleteRequestCapacityV2({ capacity: state.capacity, measurement: measured, wireOutputTokens: state.native ? null : output, now: state.now })
    const parameters = sentParametersV2(wire)
    return { ...decision, inputMeasurement: structuredClone(measured), wire,
      wireOutputTokens: typeof parameters.max_tokens === 'number' ? parameters.max_tokens : null,
      wireOutputBasis: typeof parameters.max_tokens === 'number' ? outputBasis : 'provider-managed', sentParameters: parameters }
  } }
}
export async function prepareAIRequestV2(input: {
  resolution: AIRequestConfigResolution
  assessmentContext: FrozenRequestAssessmentContextV2
  messages: readonly ChatMessage[]
  stream: false
  options: ChatRequestOptions
  contextMaterial: ContextMaterialAllocationV2
  lengthPlan: import('../types/agent-run').TaskLengthPlanV1 | null
  explicitConstraints: ExplicitAuthorConsumptionConstraintsV2 | null
}): Promise<{ handle: PreparedAIRequestV2Handle; evidence: AIRequestEvidenceV2 }> {
  const state = assessmentsV2.get(input.assessmentContext)
  if (!state || requestGuardV2(state.resolution) !== requestGuardV2(input.resolution)
    || input.stream !== false) throw new Error('准备请求的路由或产品模式不匹配。')
  const lengthPlan = input.lengthPlan === null ? null
    : (await import('./author-length-intent')).parseTaskLengthPlanV1(input.lengthPlan)
  const options = plainOptionsV2(input.options), messages = structuredClone([...input.messages])
  const material = structuredClone(input.contextMaterial)
  const { allocationHash, ...materialBody } = material
  const materialKeys = ['version','authorityHash','capturedSourceHashes','selectedSourceHashes','readPlanHash','inputTokenForecast','captureProtocolVersion','allocationHash']
  const hashes = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0
    && value.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) && new Set(value).size === value.length
  if (Object.keys(material).sort().join('|') !== materialKeys.sort().join('|')
    || material.version !== 'context-material-allocation-v2' || material.captureProtocolVersion !== 'registered-host-full-v2'
    || !/^[a-f0-9]{64}$/.test(material.authorityHash) || !/^[a-f0-9]{64}$/.test(material.readPlanHash)
    || !hashes(material.capturedSourceHashes) || !hashes(material.selectedSourceHashes)
    || material.selectedSourceHashes.some(hash => !material.capturedSourceHashes.includes(hash))
    || !Number.isSafeInteger(material.inputTokenForecast) || material.inputTokenForecast < 0
    || !/^[a-f0-9]{64}$/.test(allocationHash) || await hashCanonicalValue(materialBody) !== allocationHash) throw new Error('完整来源分配身份无效。')
  const assessed = createAIRequestAssessorV2(input.assessmentContext).assess(messages, options, input.explicitConstraints)
  if (assessed.decision === 'proved-overflow') throw new Error('已证完整请求超过服务容量，请先规划未完成范围。')
  const native = state.native ? await prepareNativeCodexRequestV2(state.native, messages, options.jsonSchema?.schema, options.responseFormat) : undefined
  if (native && native.wire !== assessed.wire) throw new Error('本机冻结请求字节发生变化。')
  const wireBodyHash = await sha256Text(assessed.wire)
  const evidence: AIRequestEvidenceV2 = {
    version: 'ai-request-evidence-v2', profile: 'task-request-v2', routeHash: state.routeHash,
    capacity: structuredClone(state.capacity), materialAllocationHash: material.allocationHash,
    messagesHash: await hashCanonicalValue(messages), optionsHash: await hashCanonicalValue(options), wireBodyHash,
    requestHash: await hashCanonicalValue({ routeHash: state.routeHash, wireBodyHash }),
    policyHash: await hashCanonicalValue({ profile: 'task-request-v2', materialAllocationHash: material.allocationHash,
      lengthPlan, explicitConstraints: input.explicitConstraints }),
    inputMeasurement: assessed.inputMeasurement, wireOutputTokens: assessed.wireOutputTokens,
    forecastOutputTokens: estimateTokens(JSON.stringify(messages)), wireOutputBasis: assessed.wireOutputBasis,
    forecastBasis: 'source-token-estimate-v1', sentParameters: assessed.sentParameters,
  }
  const handle = requestOpaqueV2<PreparedAIRequestV2Handle>()
  preparedRequestsV2.set(handle, { lengthPlan, assessment: state, messages, options, wire: assessed.wire,
    output: assessed.wireOutputTokens, ...(native ? { native: native.handle, nativeBinding: native.binding } : {}), evidence: structuredClone(evidence), attempted: false })
  return { handle, evidence }
}
export function bindPreparedRequestObserversV2(
  handle: PreparedAIRequestV2Handle, observer: PreparedRequestObserverV2,
): BoundPreparedAIRequestV2 {
  const state = preparedRequestsV2.get(handle)
  if (!state || state.observer || state.attempted || typeof observer.beforeDispatch !== 'function'
    || typeof observer.onPublicResponse !== 'function' || state.native && typeof observer.onPublicDelta !== 'function') throw new Error('准备请求必须且只能绑定一次持久化观察器。')
  state.observer = Object.freeze({ ...observer })
  state.guard = async () => { await state.observer!.beforeDispatch(); state.currentCheck?.() }
  const bound = requestOpaqueV2<BoundPreparedAIRequestV2>()
  boundRequestsV2.set(bound, state)
  return bound
}
/** Return the same guard object used by the transport; callers may not replace
 * it with an independently invoked second before-dispatch callback. */
export function preparedRequestDispatchGuardV2(bound: BoundPreparedAIRequestV2): () => Promise<void> {
  const state = boundRequestsV2.get(bound)
  if (!state?.guard) throw new Error('冻结请求尚未绑定。')
  return state.guard
}
async function dispatchPreparedRequestV2(
  messages: ChatMessage[], config: AIConfig, meta: AICallMeta | undefined, signal: AbortSignal | undefined,
  result: ChatResult | undefined, options: ChatRequestOptions, frozenResolution: AIRequestConfigResolution | undefined,
): Promise<string> {
  const bound = options.preparedRequestV2!, state = boundRequestsV2.get(bound)
  const { preparedRequestV2: _handle, ...actualOptions } = options
  const resolved = frozenResolution ?? resolveRequestConfig(config, meta)
  if (!state || state.attempted || !state.guard || !state.observer || options.capacityPolicy || (meta?.category === 'codex.extract' ? state.lengthPlan !== null
      : meta?.category === 'agent.world-origin.worldview-field.v2'
        ? state.lengthPlan === null || !['setting-field','setting-set','short-field'].includes(state.lengthPlan.taskKind)
        : true)
    || requestGuardV2(resolved) !== requestGuardV2(state.assessment.resolution)
    || canonicalStringify(messages) !== canonicalStringify(state.messages)
    || canonicalStringify(actualOptions) !== canonicalStringify(state.options)
    || result?.beforeModelDispatch && result.beforeModelDispatch !== state.guard) throw new Error('实际请求与冻结准备身份不一致，未发送。')
  if (Object.values(state.assessment.capacity).some(value => value && typeof value === 'object'
    && 'expiresAt' in value && value.expiresAt <= Date.now())) throw new Error('准备请求的能力证据已过期，请保留来源并重新准备未派发任务。')
  assertGenerationAvailable()
  state.currentCheck = () => {
    if (requestGuardV2(resolveRequestConfig(config, meta)) !== requestGuardV2(state.assessment.resolution)
      || canonicalStringify(messages) !== canonicalStringify(state.messages)
      || canonicalStringify(actualOptions) !== canonicalStringify(state.options)) throw new Error('派发前路由或请求已变化，未发送。')
  }
  state.currentCheck()
  const receipt = result ?? {}
  receipt.beforeModelDispatch = state.guard
  receipt.requestLifecycle = { phase: 'pre-dispatch', responseStatus: null }
  delete receipt.modelDispatchGuardCancelled
  state.attempted = true
  const response: PublicAIResponseV2 = { text: '', finishReason: null, usage: {}, completion: 'unknown', responseStatus: null, wireDigest: null }
  let publicObserverInvoked = false
  const startedAt = Date.now()
  const routedConfig = state.assessment.resolution.config
  const accountingMeta = { projectId: meta?.projectId ?? null, category: meta?.category ?? '' }
  const log = state.native ? null : createLog({ type: 'chat', provider: routedConfig.provider, model: routedConfig.model,
    url: buildOpenAIEndpoint(routedConfig.baseUrl, 'chat/completions'), status: 'pending' },
    { sensitiveValues: [routedConfig.apiKey], baseUrl: routedConfig.baseUrl })
  try {
    if (state.native) {
      for await (const delta of loggedCodex(state.messages, state.assessment.resolution.config, resolved.taskKind, meta, signal, receipt,
        state.options.jsonSchema?.schema, state.options.responseFormat, undefined, state.native)) {
        response.text += delta
        await state.observer.onPublicDelta?.(delta)
      }
      response.finishReason = receipt.finishReason === 'stop' ? 'stop' : 'unknown'
      for (const key of ['inputTokens','outputTokens','totalTokens'] as const) {
        const value = receipt.usage?.[key]
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) response.usage[key] = value
      }
      response.responseStatus = receipt.requestLifecycle?.responseStatus ?? null
      response.completion = receipt.finishReason === 'stop' ? 'complete' : 'unknown'
    } else {
      const req = buildRequest(state.assessment.resolution.config, state.messages, false, state.options, { tokens: state.output })
      if (req.body !== state.wire) throw new Error('派发字节与冻结字节不一致。')
      await assertModelDispatchGuardV1(receipt, signal)
      signal?.throwIfAborted()
      receipt.requestLifecycle = { phase: 'request-dispatched', responseStatus: null }
      const http = await fetch(req.url, { method: 'POST', headers: req.headers, body: state.wire, signal })
      receipt.requestLifecycle = { phase: 'response-observed', responseStatus: http.status }
      response.responseStatus = http.status
      let sawPublicText = false, protocolInvalid = false
      const project = async (body: unknown, streaming: boolean) => {
        const root = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
        const choices = Array.isArray(root.choices) ? root.choices : []
        const choice = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {}
        let publicDelta: string | undefined
        const value = streaming ? choice.delta : choice.message
        const message = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
        if (typeof message.content === 'string') {
          sawPublicText = true
          response.text += message.content
          if (streaming && message.content) publicDelta = message.content
        }
        if (typeof choice.finish_reason === 'string') response.finishReason = ['stop','length','content_filter','tool_calls'].includes(choice.finish_reason)
          ? choice.finish_reason as NonNullable<PublicAIResponseV2['finishReason']> : 'unknown'
        const usage = root.usage && typeof root.usage === 'object' && !Array.isArray(root.usage) ? root.usage as Record<string, unknown> : {}
        for (const [wireKey, key] of [['prompt_tokens','inputTokens'],['completion_tokens','outputTokens'],['total_tokens','totalTokens']] as const) {
          const value = usage[wireKey]
          if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) response.usage[key] = value
        }
        if (publicDelta) await state.observer!.onPublicDelta?.(publicDelta)
      }
      if (http.headers.get('content-type')?.includes('text/event-stream') && http.body) {
        // SSE can arrive from a compatible endpoint even for a non-streaming
        // request. Decode only public deltas, flush decoder and final event at
        // EOF, and never store the raw protocol body or cumulative snapshots.
        const reader = http.body.getReader(), decoder = new TextDecoder(), wirePieces: string[] = []
        let pending = '', data: string[] = []
        const event = async () => {
          const value = data.join('\n'); data = []
          if (!value || value === '[DONE]') return
          let decoded: unknown
          try { decoded = JSON.parse(value) } catch { protocolInvalid = true; return }
          await project(decoded, true)
        }
        const line = async (value: string) => {
          if (!value) { await event(); return }
          if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''))
        }
        const consume = async (text: string, eof: boolean) => {
          wirePieces.push(text); pending += text
          let end: number
          while ((end = pending.indexOf('\n')) >= 0) {
            const value = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1)
            await line(value)
          }
          if (eof) { if (pending) await line(pending.replace(/\r$/, '')); pending = ''; await event() }
        }
        try {
          while (true) {
            const part = await reader.read()
            if (part.done) { await consume(decoder.decode(), true); break }
            await consume(decoder.decode(part.value, { stream: true }), false)
          }
          response.wireDigest = await sha256Text(wirePieces.join(''))
        } finally { reader.releaseLock() }
      } else {
        const wire = await http.text()
        response.wireDigest = await sha256Text(wire)
        let body: unknown
        try { body = JSON.parse(wire) } catch { body = null; protocolInvalid = true }
        await project(body, false)
      }
      response.completion = !http.ok ? 'failed' : protocolInvalid ? 'unknown' : response.finishReason === 'length' ? 'incomplete'
        : response.finishReason === 'stop' && sawPublicText ? 'complete' : 'unknown'
    }
    // Only these protocol-visible fields cross into product evidence. No raw
    // HTTP object, endpoint, headers or provider reasoning is exposed.
    publicObserverInvoked = true
    await state.observer.onPublicResponse(structuredClone(response))
    await state.observer.onTerminal?.(response.completion)
    if (log) updateLog(log.id, { status: response.completion === 'complete' ? 'success' : 'error', duration: Date.now() - startedAt })
    if (response.completion !== 'complete') throw new Error('已保留可见原答与真实终态，当前请求尚未完整完成，不会自动重发。')
    return response.text
  } catch (error) {
    // A native failure can still carry observed usage; preserve only measured
    // fields, including zero, and never manufacture missing dimensions.
    if (state.native) for (const key of ['inputTokens','outputTokens','totalTokens'] as const) {
      const value = receipt.usage?.[key]
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) response.usage[key] = value
    }
    let stoppedBy = error
    if (!publicObserverInvoked && receipt.requestLifecycle?.phase !== 'pre-dispatch') {
      publicObserverInvoked = true
      try { await state.observer.onPublicResponse(structuredClone(response)) }
      catch (saveFailure) {
        stoppedBy = Object.defineProperties(new Error('原请求与可见结果保存均停止；不得重发。'), {
          name: { value: 'AggregateError', configurable: true, writable: true },
          errors: { value: [error, saveFailure], configurable: true, writable: true },
        })
      }
    }
    if (log) updateLog(log.id, { status: 'error', duration: Date.now() - startedAt, errorMessage: '冻结请求已停止；请保留原运行与已保存证据。' })
    throw new PreparedRequestStoppedV2(structuredClone(response), stoppedBy)
  } finally {
    // Exactly one HTTP attempt owns accounting, including observer/save errors.
    // Native already accounts in loggedCodex; readonly raw recovery never calls
    // this branch. Existing storage needs both measured dimensions, so partial
    // usage remains exact evidence only rather than becoming a fabricated bill.
    if (log) {
      const { inputTokens, outputTokens, totalTokens } = response.usage
      if (inputTokens !== undefined && outputTokens !== undefined) {
        void recordUsage(usageEntry(accountingMeta, routedConfig, state.assessment.resolution.taskKind, { inputTokens, outputTokens }))
        // The existing connection-log carrier additionally requires totalTokens.
        if (totalTokens !== undefined) updateLog(log.id, { usage: { inputTokens, outputTokens, totalTokens } })
      }
    }
  }
}

/** Exact frame material for the same Run artifact primitive. Headers, endpoint
 * and credentials stay inside the host handle and are never returned. */
export function readPreparedRequestFrameV2(handle: PreparedAIRequestV2Handle) {
  const state = preparedRequestsV2.get(handle)
  if (!state) throw new Error('冻结请求句柄不存在。')
  return { version: 'prepared-ai-request-frame-v2' as const, messages: structuredClone(state.messages),
    options: structuredClone(state.options), wireBody: state.wire, wireBodyHash: state.evidence.wireBodyHash }
}

export function readPreparedNativeRequestRefV2(handle: PreparedAIRequestV2Handle): Readonly<CodexRequestRefV1> | null {
  const state = preparedRequestsV2.get(handle)
  if (!state) throw new Error('冻结请求句柄不存在。')
  return state.nativeBinding ? Object.freeze(structuredClone(state.nativeBinding)) : null
}
