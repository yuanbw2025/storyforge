import { useAIConfigStore } from '../../stores/ai-config'
import { chat, resolveRequestConfig, type ChatResult } from '../ai/client'
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

function safeIdentity(config: AIConfig) {
  return {
    adapterId: 'configured-text.v1' as const,
    adapterVersion: 1 as const,
    provider: config.provider,
    model: config.model.trim(),
    endpointOrigin: endpointOrigin(config.baseUrl),
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
  const config = dependencies.resolveConfig?.(input.category) ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: input.category, projectId: input.projectId },
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
}, dependencies: CapabilityDependenciesV1 = {}): Promise<ResolvedConfiguredTextCapabilityV1> {
  const config = dependencies.resolveConfig?.(input.category) ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: input.category, projectId: input.projectId },
  ).config
  if (!isAIConfigReady(config)) throw new Error(getAIConfigRequiredMessage(config))
  if (!config.model.trim() || !config.baseUrl.trim()) throw new Error('现有 AI 配置缺少模型或 Base URL。')
  const identity = safeIdentity(config)
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
  return { config, receipt }
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
  const resolved = await resolveConfiguredTextCapabilityV1(input, dependencies)
  const output = dependencies.runAI
    ? await dependencies.runAI(input.messages, resolved.config, {
        category: input.category, projectId: input.projectId, maxTokens: input.maximumOutputTokens,
      }, input.signal, input.result)
    : await chat(input.messages, resolved.config, {
        category: input.category,
        projectId: input.projectId,
        configOverrides: { maxTokens: input.maximumOutputTokens },
        contextOverflowPolicy: 'reject',
      }, input.signal, input.result, input.responseFormat ? { responseFormat: input.responseFormat } : undefined)
  return { output, bindingReceipt: resolved.receipt }
}
