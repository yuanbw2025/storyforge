import { useAIConfigStore } from '../../stores/ai-config'
import {
  chat,
  chatWithImagesV1,
  resolveRequestConfig,
  type AIRequestConfigResolution,
  type ChatResult,
} from '../ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../ai/config-readiness'
import type { AIConfig, ChatMessage } from '../types'
import { hashProductProductionValueV2 } from './hash'

export interface ProviderBindingReceiptV1 {
  schema: 'storyforge.provider-binding-receipt'
  version: 1
  requirementKey: string
  adapterId: 'configured-text.v1'
  adapterVersion: 1
  provider: string
  model: string
  endpointOrigin: string
  /** Hash of the non-secret request route and generation settings. Formal
   * production uses it to detect route/temperature/context drift between
   * task attempts without persisting a URL path or credential material. */
  executionConfigHash?: string
  executionLocation: 'browser-direct'
  credentialSource: 'existing-ai-config'
  credentialPresent: true
  capabilityHash: string
  boundAt: number
  receiptHash: string
}

interface ResolvedConfiguredTextCapabilityV1 {
  config: AIConfig
  receipt: ProviderBindingReceiptV1
  /** Exact routing result used to create the receipt. The lower chat boundary
   * must reuse this value instead of resolving mutable task routes again. */
  resolution: AIRequestConfigResolution
}

interface CapabilityDependenciesV1 {
  resolveConfig?: (category: string) => AIConfig
  now?: () => number
  runAI?: (
    messages: ChatMessage[],
    config: AIConfig,
    meta: { category: string; projectId: number; maxTokens: number },
    signal?: AbortSignal,
    result?: ChatResult,
  ) => Promise<string>
}

export type ConfiguredProductionTextFailureOutcomeV1 =
  | { kind: 'not-dispatched' }
  | {
      kind: 'response-observed'
      responseStatus: number | null
      usage: { inputTokens: number; outputTokens: number } | null
    }
  | { kind: 'result-unknown' }

/**
 * Explicit delivery outcome for the durable text-open-world production path.
 * The original error is retained for deterministic classification, while the
 * outcome prevents callers from guessing dispatch state from its class/name.
 */
export class ConfiguredProductionTextCallErrorV1 extends Error {
  constructor(
    readonly outcome: ConfiguredProductionTextFailureOutcomeV1,
    readonly originalError: unknown,
  ) {
    super(originalError instanceof Error
      ? originalError.message
      : '[product-production-capability] 文本模型调用失败')
    this.name = 'ConfiguredProductionTextCallErrorV1'
  }
}

function readObservedChatUsage(result: ChatResult): ChatResult['usage'] {
  return result.usage
}

/**
 * Formal text-open-world production is authorized against one shared text
 * capability. Individual Skills remain separate durable Runs, but they must
 * not become independent AI routing categories after the Build has frozen its
 * provider binding.
 */
export const TEXT_OPEN_WORLD_PRODUCTION_TEXT_CATEGORY_V1 = 'product-production'

export function normalizeProductProductionTextCategoryV1(category: string): string {
  const normalized = category.trim()
  return normalized === 'text-open-world.production'
    || normalized.startsWith('text-open-world.production.')
    ? TEXT_OPEN_WORLD_PRODUCTION_TEXT_CATEGORY_V1
    : normalized
}

export interface ConfiguredTextCapabilityReadinessV1 {
  ready: boolean
  provider: string
  model: string
  endpointOrigin: string
  credentialSource: 'existing-ai-config'
  credentialPresent: boolean
  issue: string | null
}

function endpointOrigin(baseUrl: string): string {
  try { return new URL(baseUrl).origin } catch { return 'custom-endpoint' }
}

function normalizedRequestRoute(baseUrl: string): string {
  try {
    const endpoint = new URL(baseUrl)
    const pathname = endpoint.pathname.replace(/\/+$/, '') || '/'
    // Query/fragment changes must invalidate a frozen capability even though
    // Creator preflight rejects them. Userinfo is represented only by a safe
    // marker so credential material never becomes a persisted hash input.
    return `${endpoint.origin}${pathname}${endpoint.search}${endpoint.hash}${
      endpoint.username || endpoint.password ? '|embedded-userinfo' : ''
    }`
  } catch {
    return baseUrl.trim()
  }
}

export interface ConfiguredTextExecutionSettingsV1 {
  endpointRouteHash: string
  temperature: number
  configuredMaxTokens: number
  contextWindow: number | null
}

export interface ExpectedConfiguredTextProviderIdentityV1 extends ConfiguredTextExecutionSettingsV1 {
  provider: string
  model: string
  endpointOrigin: string
}

/** Hashes only the non-secret path/query used by the configured endpoint. */
export async function hashConfiguredTextEndpointRouteV1(route: string): Promise<string> {
  return hashProductProductionValueV2({ route })
}

/** Shared bridge between the Creator preflight binding and the provider
 * capability receipt. It lets the service compare two independently hashed
 * contracts without persisting the endpoint path itself. */
export async function hashConfiguredTextExecutionSettingsV1(
  settings: ConfiguredTextExecutionSettingsV1,
): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.configured-text-execution-settings',
    version: 2,
    endpointRouteHash: settings.endpointRouteHash,
    temperature: settings.temperature,
    configuredMaxTokens: settings.configuredMaxTokens,
    contextWindow: settings.contextWindow,
  })
}

export async function createConfiguredTextProviderExecutionIdentityV1(config: AIConfig) {
  const endpointRouteHash = await hashConfiguredTextEndpointRouteV1(
    normalizedRequestRoute(config.baseUrl),
  )
  const executionConfigHash = await hashConfiguredTextExecutionSettingsV1({
    endpointRouteHash,
    temperature: config.temperature,
    configuredMaxTokens: config.maxTokens,
    contextWindow: config.contextWindow == null || config.contextWindow === 0
      ? null : config.contextWindow,
  })
  return {
    adapterId: 'configured-text.v1' as const,
    adapterVersion: 1 as const,
    provider: config.provider,
    model: config.model.trim(),
    endpointOrigin: endpointOrigin(config.baseUrl),
    executionConfigHash,
    executionLocation: 'browser-direct' as const,
    credentialSource: 'existing-ai-config' as const,
    credentialPresent: true as const,
  }
}

/**
 * Safe, read-only preflight for author-facing UI. The result intentionally
 * contains only provider identity and a credential-present boolean, never the
 * credential itself or the complete endpoint path.
 */
export function inspectConfiguredTextCapabilityV1(input: {
  projectId: number
  category: string
}, dependencies: Pick<CapabilityDependenciesV1, 'resolveConfig'> = {}): ConfiguredTextCapabilityReadinessV1 {
  const category = normalizeProductProductionTextCategoryV1(input.category)
  const config = dependencies.resolveConfig?.(category) ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category, projectId: input.projectId },
  ).config
  const credentialPresent = isAIConfigReady(config)
  const identityComplete = Boolean(config.model.trim() && config.baseUrl.trim())
  return {
    ready: credentialPresent && identityComplete,
    provider: config.provider,
    model: config.model.trim(),
    endpointOrigin: endpointOrigin(config.baseUrl),
    credentialSource: 'existing-ai-config',
    credentialPresent,
    issue: !credentialPresent
      ? getAIConfigRequiredMessage(config)
      : !identityComplete ? '现有 AI 配置缺少模型或 Base URL。' : null,
  }
}

/**
 * Resolves the existing global/task-routed text configuration. It never asks
 * for or persists another key and the returned receipt contains no secret.
 */
export async function resolveConfiguredTextCapabilityV1(input: {
  projectId: number
  category: string
  requirementKey: string
  expectedCapabilityHash?: string
  expectedProviderIdentity?: ExpectedConfiguredTextProviderIdentityV1
}, dependencies: CapabilityDependenciesV1 = {}): Promise<ResolvedConfiguredTextCapabilityV1> {
  const category = normalizeProductProductionTextCategoryV1(input.category)
  const resolution: AIRequestConfigResolution = dependencies.resolveConfig
    ? {
        config: dependencies.resolveConfig(category),
        taskKind: null,
        presetId: null,
      }
    : resolveRequestConfig(
        useAIConfigStore.getState().config,
        { category, projectId: input.projectId },
      )
  const config = resolution.config
  if (!isAIConfigReady(config)) throw new Error(getAIConfigRequiredMessage(config))
  if (!config.model.trim() || !config.baseUrl.trim()) throw new Error('现有 AI 配置缺少模型或 Base URL。')
  const identity = await createConfiguredTextProviderExecutionIdentityV1(config)
  if (input.expectedProviderIdentity) {
    const expectedExecutionConfigHash = await hashConfiguredTextExecutionSettingsV1(
      input.expectedProviderIdentity,
    )
    if (identity.provider !== input.expectedProviderIdentity.provider
      || identity.model !== input.expectedProviderIdentity.model
      || identity.endpointOrigin !== input.expectedProviderIdentity.endpointOrigin
      || identity.executionConfigHash !== expectedExecutionConfigHash) {
      throw new Error('[product-production-capability] 当前文本 provider 身份与 Creator 授权快照不一致')
    }
  }
  const capabilityHash = await hashProductProductionValueV2({
    requirementKey: input.requirementKey,
    ...identity,
  })
  if (input.expectedCapabilityHash && capabilityHash !== input.expectedCapabilityHash) {
    throw new Error('[product-production-capability] 文本 provider binding 与授权 capability 不一致')
  }
  const body = {
    schema: 'storyforge.provider-binding-receipt' as const,
    version: 1 as const,
    requirementKey: input.requirementKey,
    ...identity,
    capabilityHash,
    boundAt: dependencies.now?.() ?? Date.now(),
  }
  const receipt = { ...body, receiptHash: await hashProductProductionValueV2(body) }
  if (/api[-_]?key|authorization|bearer/i.test(JSON.stringify(receipt))) {
    throw new Error('[product-production-capability] provider receipt 含敏感字段')
  }
  return { config, receipt, resolution }
}

/** Lower provider boundary; callers must create a durable production Run first. */
export async function runConfiguredProductionTextV1(input: {
  projectId: number
  category: string
  requirementKey: string
  expectedCapabilityHash?: string
  messages: ChatMessage[]
  maximumOutputTokens: number
  signal?: AbortSignal
  result?: ChatResult
  responseFormat?: 'json_object'
}, dependencies: CapabilityDependenciesV1 = {}): Promise<{
  output: string
  bindingReceipt: ProviderBindingReceiptV1
}> {
  if (!Number.isInteger(input.maximumOutputTokens) || input.maximumOutputTokens < 1) {
    throw new Error('[product-production-capability] maximumOutputTokens 无效')
  }
  const category = normalizeProductProductionTextCategoryV1(input.category)
  const resolved = await resolveConfiguredTextCapabilityV1({ ...input, category }, dependencies)
  let output: string
  if (dependencies.runAI) {
    if (input.result) {
      input.result.requestLifecycle = { phase: 'request-dispatched', responseStatus: null }
    }
    output = await dependencies.runAI(input.messages, resolved.config, {
      category, projectId: input.projectId, maxTokens: input.maximumOutputTokens,
    }, input.signal, input.result)
    if (input.result) {
      input.result.requestLifecycle = { phase: 'response-observed', responseStatus: 200 }
    }
  } else {
    const frozenResolution: AIRequestConfigResolution = {
      ...resolved.resolution,
      config: {
        ...resolved.config,
        maxTokens: input.maximumOutputTokens,
      },
    }
    output = await chat(input.messages, resolved.config, {
      category: normalizeProductProductionTextCategoryV1(input.category),
      projectId: input.projectId,
      configOverrides: { maxTokens: input.maximumOutputTokens },
      contextOverflowPolicy: 'reject',
    }, input.signal, input.result, input.responseFormat ? { responseFormat: input.responseFormat } : undefined,
    frozenResolution)
  }
  return { output, bindingReceipt: resolved.receipt }
}

export interface ConfiguredProductionVisionImageV1 {
  artifactKey: string
  contentHash: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: ArrayBuffer
  detail: 'low' | 'high'
}

function mediaDataUrlV1(image: ConfiguredProductionVisionImageV1): string {
  if (!/^[a-f0-9]{64}$/.test(image.contentHash) || image.data.byteLength < 1 || image.data.byteLength > 16_000_000) {
    throw new Error(`[product-production-capability] 视觉审查图片无效:${image.artifactKey}`)
  }
  const bytes = new Uint8Array(image.data)
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000))))
  }
  return `data:${image.mimeType};base64,${btoa(chunks.join(''))}`
}

/**
 * Uses the already-authorized configured model through a bounded image-input
 * request. The returned binding receipt is still the frozen configured-text
 * identity; the task Run Contract and input Artifact hashes prove which
 * product-owned images were disclosed.
 */
export async function runConfiguredProductionVisionV1(input: {
  projectId: number
  category: string
  requirementKey: string
  expectedCapabilityHash?: string
  messages: ChatMessage[]
  images: ConfiguredProductionVisionImageV1[]
  maximumOutputTokens: number
  signal?: AbortSignal
  result?: ChatResult
  responseFormat?: 'json_object'
}, dependencies: CapabilityDependenciesV1 = {}): Promise<{
  output: string
  bindingReceipt: ProviderBindingReceiptV1
}> {
  if (!Number.isInteger(input.maximumOutputTokens) || input.maximumOutputTokens < 1) {
    throw new Error('[product-production-capability] maximumOutputTokens 无效')
  }
  if (!input.images.length || input.images.length > 12
    || input.images.reduce((sum, image) => sum + image.data.byteLength, 0) > 32_000_000
    || new Set(input.images.map(image => image.artifactKey)).size !== input.images.length) {
    throw new Error('[product-production-capability] 视觉审查图片集合无效')
  }
  const resolved = await resolveConfiguredTextCapabilityV1(input, dependencies)
  const output = await chatWithImagesV1(
    input.messages,
    input.images.map(image => ({
      label: `${image.artifactKey} / sha256:${image.contentHash}`,
      dataUrl: mediaDataUrlV1(image), detail: image.detail,
    })),
    resolved.config,
    {
      category: input.category, projectId: input.projectId,
      configOverrides: { maxTokens: input.maximumOutputTokens }, contextOverflowPolicy: 'reject',
    },
    input.signal,
    input.result,
    input.responseFormat ? { responseFormat: input.responseFormat } : undefined,
  )
  return { output, bindingReceipt: resolved.receipt }
}

/**
 * Durable-call wrapper used by text-open-world production. It converts the
 * observable lower transport boundary into an exact, secret-free outcome and
 * leaves the legacy configured-text callers unchanged.
 */
export async function runConfiguredProductionTextWithOutcomeV1(
  input: Parameters<typeof runConfiguredProductionTextV1>[0],
  dependencies: CapabilityDependenciesV1 = {},
): ReturnType<typeof runConfiguredProductionTextV1> {
  const result = input.result ?? {}
  delete result.usage
  result.requestLifecycle = { phase: 'pre-dispatch', responseStatus: null }
  try {
    return await runConfiguredProductionTextV1({ ...input, result }, dependencies)
  } catch (error) {
    const lifecycle = result.requestLifecycle
    const usage = readObservedChatUsage(result)
    const outcome: ConfiguredProductionTextFailureOutcomeV1 = lifecycle?.phase === 'response-observed'
      ? {
          kind: 'response-observed',
          responseStatus: lifecycle.responseStatus,
          usage: usage
            ? {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
              }
            : null,
        }
      : lifecycle?.phase === 'request-dispatched'
        ? { kind: 'result-unknown' }
        : { kind: 'not-dispatched' }
    throw new ConfiguredProductionTextCallErrorV1(outcome, error)
  }
}
