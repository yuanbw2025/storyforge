import type {
  AIConfig,
  AIProvider,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorPriceQuoteV1,
  TextOpenWorldCreatorProductionEstimateV1,
  TextOpenWorldCreatorProductionPreflightConfirmationV1,
  TextOpenWorldCreatorProductionPreflightV1,
  TextOpenWorldCreatorProviderBindingV1,
} from '../types'
import { PROVIDER_PRESETS } from '../types'
import { hashCanonicalValue } from '../agent/run/hash'
import { resolveRequestConfig } from '../ai/client'
import {
  AI_MODEL_PRICE_CATALOG_AS_OF_V1,
  AI_MODEL_PRICE_CATALOG_VERSION_V1,
  knownProviderModelPrice,
} from '../ai/usage-log'
import { isProviderQuotaRejectionV1 } from '../ai/provider-rejection'
import { TEXT_OPEN_WORLD_PRODUCTION_TEXT_CATEGORY_V1 } from '../product-production/capabilities'
import { DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1 } from './product-config'
import { TEXT_OPEN_WORLD_PRODUCTION_MODEL_CALL_BUDGET_V1 } from './production-contract'
import { verifyTextOpenWorldCreatorBriefV1 } from './creator-brief-persistence'
import { getAIConfigPresetSessionApiKey, useAIConfigStore } from '../../stores/ai-config'

export const TEXT_OPEN_WORLD_CREATOR_PRODUCTION_RESOURCE_LIMITS_V1 = Object.freeze({
  maximumDurationMs: 7_200_000,
  maximumStorageBytes: 200_000_000,
})

export type TextOpenWorldCreatorPricingModeV1 = 'catalog' | 'manual' | 'local-zero'

export interface TextOpenWorldCreatorManualPriceV1 {
  inputUsdPerMillionTokens: number | null
  outputUsdPerMillionTokens: number | null
  sourceLabel: string
  asOf: string
}

export interface TextOpenWorldCreatorPricingSelectionV1 {
  mode: TextOpenWorldCreatorPricingModeV1
  manual?: TextOpenWorldCreatorManualPriceV1
}

export interface TextOpenWorldCreatorPreflightAcknowledgementV1 {
  credentialPolicyReviewed: boolean
  providerAndModelReviewed: boolean
  priceAndBudgetReviewed: boolean
  mediaCostBoundaryReviewed: boolean
}

export interface TextOpenWorldProviderFailureDisplayV1 {
  kind: 'insufficient-balance' | 'authorization' | 'rate-limit' | 'timeout' | 'network' | 'unknown-result'
  message: string
  retryHint: string
}

interface SafeCreatorEndpointV1 {
  origin: string
  route: string
  local: boolean
  secureTransport: boolean
  embeddedSensitiveParts: boolean
}

function safeEndpoint(baseUrl: string): SafeCreatorEndpointV1 | null {
  try {
    const parsed = new URL(baseUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    if (parsed.origin.length > 2_000) return null
    return {
      // URL.origin excludes username, password, path, query and fragment.
      origin: parsed.origin,
      // Kept only in ephemeral memory so different same-origin gateways cannot
      // silently reuse a confirmation. Only its hash leaves this function.
      route: `${parsed.origin}${pathname}`,
      local,
      secureTransport: parsed.protocol === 'https:' || local,
      embeddedSensitiveParts: Boolean(parsed.username || parsed.password || parsed.search || parsed.hash),
    }
  } catch {
    return null
  }
}

function officialCatalogRoute(provider: AIProvider): string | null {
  const configured = PROVIDER_PRESETS[provider]?.baseUrl
  return typeof configured === 'string' ? safeEndpoint(configured)?.route ?? null : null
}

function catalogPricingEligible(provider: AIProvider, endpoint: SafeCreatorEndpointV1 | null): boolean {
  const official = officialCatalogRoute(provider)
  return Boolean(official && endpoint?.secureTransport && !endpoint.embeddedSensitiveParts
    && endpoint.route === official)
}

export function safeTextOpenWorldCreatorEndpointOriginV1(baseUrl: string): string | null {
  return safeEndpoint(baseUrl)?.origin ?? null
}

export function isTextOpenWorldCreatorLocalEndpointV1(baseUrl: string): boolean {
  return safeEndpoint(baseUrl)?.local === true
}

export function defaultTextOpenWorldCreatorPricingModeV1(
  config: AIConfig,
  projectId: number,
): TextOpenWorldCreatorPricingModeV1 {
  const resolved = resolveRequestConfig(config, {
    category: TEXT_OPEN_WORLD_PRODUCTION_TEXT_CATEGORY_V1,
    projectId,
  }).config
  const endpoint = safeEndpoint(resolved.baseUrl)
  if (['ollama', 'custom'].includes(resolved.provider) && endpoint?.local) return 'local-zero'
  return knownProviderModelPrice(resolved.provider, resolved.model)
    && catalogPricingEligible(resolved.provider, endpoint) ? 'catalog' : 'manual'
}

function safeManualSourceLabel(value: string): string | null {
  const label = value.trim()
  if (!label || label.length > 100 || /[\u0000-\u001f\u007f]|:\/\/|[?#@=&]/.test(label)) return null
  return label
}

function containsCredentialMaterial(value: string, credential: string): boolean {
  const secret = credential.trim()
  if (!secret) return false
  const candidates = new Set([secret, encodeURIComponent(secret)])
  try { candidates.add(decodeURIComponent(secret)) } catch { /* malformed percent encoding */ }
  let decodedValue = value
  try { decodedValue = decodeURIComponent(value) } catch { /* inspect the raw value only */ }
  return [...candidates].some(candidate => candidate.length > 0
    && (value.includes(candidate) || decodedValue.includes(candidate)))
}

function containsCredentialLikeText(value: string): boolean {
  return /(?:\bBearer\s+\S{6,}|\bsk-[A-Za-z0-9_-]{8,}|\bapi[_ -]?key\s*[:=]\s*\S{4,})/i.test(value)
}

function assertCredentialFreeText(
  values: readonly string[],
  credential: string,
  label: string,
): void {
  if (values.some(value => containsCredentialMaterial(value, credential)
    || containsCredentialLikeText(value))) {
    preflightFail(`${label} 疑似包含凭证内容`)
  }
}

function validRate(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000
}

async function createPriceQuote(input: {
  provider: AIProvider
  model: string
  endpointIsLocal: boolean
  catalogPricingEligible: boolean
  credentialValue: string
  pricing: TextOpenWorldCreatorPricingSelectionV1
  blockers: string[]
}): Promise<TextOpenWorldCreatorPriceQuoteV1 | null> {
  let body: Omit<TextOpenWorldCreatorPriceQuoteV1, 'quoteHash'> | null = null
  if (input.pricing.mode === 'catalog') {
    const price = knownProviderModelPrice(input.provider, input.model)
    if (!price || !input.catalogPricingEligible) {
      input.blockers.push('当前提供商、模型与商业端点没有可验证的内置价格，请录入供应商报价快照。')
      return null
    }
    body = {
      schema: 'storyforge.text-open-world-creator-price-quote', version: 1,
      provider: input.provider, model: input.model,
      source: 'storyforge-catalog',
      sourceLabel: 'StoryForge 内置工程估价表',
      catalogVersion: AI_MODEL_PRICE_CATALOG_VERSION_V1,
      asOf: AI_MODEL_PRICE_CATALOG_AS_OF_V1,
      currency: 'USD',
      inputUsdPerMillionTokens: price.input,
      outputUsdPerMillionTokens: price.output,
    }
  } else if (input.pricing.mode === 'local-zero') {
    if (!input.endpointIsLocal || !['ollama', 'custom'].includes(input.provider)) {
      input.blockers.push('零 token 费用只允许用于 localhost/127.0.0.1/::1 上的 Ollama 或自定义本地服务。')
      return null
    }
    body = {
      schema: 'storyforge.text-open-world-creator-price-quote', version: 1,
      provider: input.provider, model: input.model,
      source: 'author-confirmed-local-zero',
      sourceLabel: '作者确认的本地自托管 token 费用',
      catalogVersion: null,
      asOf: 'local-runtime',
      currency: 'USD', inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0,
    }
  } else {
    const manual = input.pricing.manual
    const rawLabel = manual?.sourceLabel ?? ''
    const label = containsCredentialMaterial(rawLabel, input.credentialValue)
      || containsCredentialLikeText(rawLabel) ? null : safeManualSourceLabel(rawLabel)
    const asOf = manual?.asOf.trim() ?? ''
    const inputRate = manual?.inputUsdPerMillionTokens
    const outputRate = manual?.outputUsdPerMillionTokens
    if (!validRate(inputRate) || !validRate(outputRate) || inputRate + outputRate <= 0) {
      input.blockers.push('请填写非负且不同时为零的输入、输出 token 单价。')
    }
    if (!label) input.blockers.push('请用不含 URL、查询参数或任何凭证内容的短文字注明人工报价来源。')
    if (!isCalendarDate(asOf)) input.blockers.push('请填写真实有效的人工报价核对日期（YYYY-MM-DD）。')
    if (!validRate(inputRate) || !validRate(outputRate) || inputRate + outputRate <= 0
      || !label || !isCalendarDate(asOf)) return null
    body = {
      schema: 'storyforge.text-open-world-creator-price-quote', version: 1,
      provider: input.provider, model: input.model,
      source: 'author-provided', sourceLabel: label, catalogVersion: null, asOf,
      currency: 'USD', inputUsdPerMillionTokens: inputRate,
      outputUsdPerMillionTokens: outputRate,
    }
  }
  return { ...body, quoteHash: await hashCanonicalValue(body) }
}

function normalizedGenerationNumber(value: number, fallback: number, maximum: number): number {
  return Number.isFinite(value) && value >= 0 && value <= maximum ? value : fallback
}

const MAXIMUM_TEMPERATURE_V1 = 2
const MINIMUM_EXPLICIT_MAX_TOKENS_V1 = 1_024
const MAXIMUM_EXPLICIT_MAX_TOKENS_V1 = 65_536
const MAXIMUM_CONTEXT_WINDOW_V1 = 1_000_000_000

function validExplicitMaxTokens(value: number): boolean {
  return Number.isSafeInteger(value)
    && (value === 0 || (value >= MINIMUM_EXPLICIT_MAX_TOKENS_V1
      && value <= MAXIMUM_EXPLICIT_MAX_TOKENS_V1))
}

function validContextWindow(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAXIMUM_CONTEXT_WINDOW_V1
}

const PREFLIGHT_HASH = /^[a-f0-9]{64}$/
const PREFLIGHT_STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const PREFLIGHT_PROVIDERS = new Set<AIProvider>([
  'deepseek', 'openai', 'qwen', 'doubao', 'minimax', 'glm', 'wenxin', 'gemini',
  'poe', 'kimi', 'claude', 'modelscope', 'nvidia', 'agnes', 'longcat', 'opencode',
  'ollama', 'custom',
])

function preflightFail(message: string): never {
  throw new Error(`[text-open-world-preflight] ${message}`)
}

function runtimeRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) preflightFail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    preflightFail(`${label} 字段不精确`)
  }
}

function runtimeText(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string') preflightFail(`${label} 必须是字符串`)
  const normalized = value.trim().normalize('NFC')
  if ((!allowEmpty && !normalized) || normalized.length > maximum) preflightFail(`${label} 为空或过长`)
  return normalized
}

function runtimeHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !PREFLIGHT_HASH.test(value)) preflightFail(`${label} 必须是 SHA-256`)
  return value
}

function runtimeBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') preflightFail(`${label} 必须是布尔值`)
  return value
}

function runtimeFinite(value: unknown, label: string, minimum = 0, maximum = 1_000_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    preflightFail(`${label} 必须是有界有限数值`)
  }
  return value
}

function runtimeInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = runtimeFinite(value, label, 0, maximum)
  if (!Number.isSafeInteger(parsed)) preflightFail(`${label} 必须是安全整数`)
  return parsed
}

function runtimeHashList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 50) preflightFail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => runtimeText(item, `${label}[${index}]`, 2_000))
  if (new Set(result).size !== result.length) preflightFail(`${label} 不得重复`)
  return result
}

function runtimeProvider(value: unknown, label: string): AIProvider {
  const provider = runtimeText(value, label, 40) as AIProvider
  if (!PREFLIGHT_PROVIDERS.has(provider)) preflightFail(`${label} 不受支持`)
  return provider
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

async function parseProviderBinding(
  value: unknown,
): Promise<TextOpenWorldCreatorProviderBindingV1> {
  const row = runtimeRecord(value, 'providerBinding')
  exactKeys(row, [
    'schema', 'version', 'provider', 'model', 'endpointOrigin', 'credentialMode',
    'endpointRouteHash', 'catalogPricingEligible', 'credentialPresent', 'credentialReady',
    'temperature', 'maxTokens', 'contextWindow', 'bindingHash',
  ], 'providerBinding')
  if (row.schema !== 'storyforge.text-open-world-creator-provider-binding' || row.version !== 1) {
    preflightFail('providerBinding schema/version 无效')
  }
  const provider = runtimeProvider(row.provider, 'providerBinding.provider')
  const model = runtimeText(row.model, 'providerBinding.model', 500, true)
  const endpointOrigin = runtimeText(row.endpointOrigin, 'providerBinding.endpointOrigin', 2_000, true)
  if (endpointOrigin) {
    const endpoint = safeEndpoint(endpointOrigin)
    if (!endpoint || endpoint.origin !== endpointOrigin) preflightFail('providerBinding endpoint 不是安全 origin')
  }
  const endpointRouteHash = runtimeHash(row.endpointRouteHash, 'providerBinding.endpointRouteHash')
  const catalogEligible = runtimeBoolean(
    row.catalogPricingEligible,
    'providerBinding.catalogPricingEligible',
  )
  if (!['session', 'remembered-browser', 'local-no-key', 'missing'].includes(String(row.credentialMode))) {
    preflightFail('providerBinding credentialMode 无效')
  }
  const credentialMode = row.credentialMode as TextOpenWorldCreatorProviderBindingV1['credentialMode']
  const credentialPresent = runtimeBoolean(row.credentialPresent, 'providerBinding.credentialPresent')
  const credentialReady = runtimeBoolean(row.credentialReady, 'providerBinding.credentialReady')
  const temperature = runtimeFinite(
    row.temperature,
    'providerBinding.temperature',
    0,
    MAXIMUM_TEMPERATURE_V1,
  )
  const maxTokens = runtimeInteger(
    row.maxTokens,
    'providerBinding.maxTokens',
    MAXIMUM_EXPLICIT_MAX_TOKENS_V1,
  )
  if (!validExplicitMaxTokens(maxTokens)) preflightFail('providerBinding.maxTokens 超出设置合同')
  const contextWindow = row.contextWindow == null
    ? null : runtimeInteger(row.contextWindow, 'providerBinding.contextWindow', MAXIMUM_CONTEXT_WINDOW_V1)
  if (contextWindow != null && !validContextWindow(contextWindow)) {
    preflightFail('providerBinding.contextWindow 超出设置合同')
  }
  const localNoKey = !credentialPresent && ['ollama', 'custom'].includes(provider)
    && isTextOpenWorldCreatorLocalEndpointV1(endpointOrigin)
  const expectedMode: TextOpenWorldCreatorProviderBindingV1['credentialMode'] = credentialPresent
    ? (credentialMode === 'remembered-browser' ? 'remembered-browser' : 'session')
    : localNoKey ? 'local-no-key' : 'missing'
  if (credentialMode !== expectedMode || credentialReady !== (credentialPresent || localNoKey)) {
    preflightFail('providerBinding 凭证状态自相矛盾')
  }
  const bindingHash = runtimeHash(row.bindingHash, 'providerBinding.bindingHash')
  const body = {
    schema: row.schema, version: row.version, provider, model, endpointOrigin,
    endpointRouteHash, catalogPricingEligible: catalogEligible,
    credentialMode, credentialPresent, credentialReady, temperature, maxTokens, contextWindow,
  }
  if (await hashCanonicalValue(body) !== bindingHash) preflightFail('模型绑定 Hash 不匹配')
  return { ...body, bindingHash } as TextOpenWorldCreatorProviderBindingV1
}

async function parsePriceQuote(
  value: unknown,
  binding: TextOpenWorldCreatorProviderBindingV1,
  credentialValue: string,
): Promise<TextOpenWorldCreatorPriceQuoteV1 | null> {
  if (value == null) return null
  const row = runtimeRecord(value, 'priceQuote')
  exactKeys(row, [
    'schema', 'version', 'provider', 'model', 'source', 'sourceLabel', 'catalogVersion',
    'asOf', 'currency', 'inputUsdPerMillionTokens', 'outputUsdPerMillionTokens', 'quoteHash',
  ], 'priceQuote')
  if (row.schema !== 'storyforge.text-open-world-creator-price-quote' || row.version !== 1
    || row.currency !== 'USD') preflightFail('priceQuote schema/version/currency 无效')
  const provider = runtimeProvider(row.provider, 'priceQuote.provider')
  const model = runtimeText(row.model, 'priceQuote.model', 500, true)
  if (provider !== binding.provider || model !== binding.model) preflightFail('价格快照与模型绑定不一致')
  if (!['storyforge-catalog', 'author-provided', 'author-confirmed-local-zero'].includes(String(row.source))) {
    preflightFail('priceQuote source 无效')
  }
  const source = row.source as TextOpenWorldCreatorPriceQuoteV1['source']
  const sourceLabel = runtimeText(row.sourceLabel, 'priceQuote.sourceLabel', 100)
  const catalogVersion = row.catalogVersion == null
    ? null : runtimeText(row.catalogVersion, 'priceQuote.catalogVersion', 200)
  const asOf = runtimeText(row.asOf, 'priceQuote.asOf', 40)
  const inputRate = runtimeFinite(row.inputUsdPerMillionTokens, 'priceQuote.inputRate', 0, 1_000_000)
  const outputRate = runtimeFinite(row.outputUsdPerMillionTokens, 'priceQuote.outputRate', 0, 1_000_000)
  if (source === 'storyforge-catalog') {
    const known = knownProviderModelPrice(provider, model)
    if (!binding.catalogPricingEligible || !known
      || catalogVersion !== AI_MODEL_PRICE_CATALOG_VERSION_V1
      || asOf !== AI_MODEL_PRICE_CATALOG_AS_OF_V1
      || sourceLabel !== 'StoryForge 内置工程估价表'
      || inputRate !== known.input || outputRate !== known.output) {
      preflightFail('内置价格快照与当前版本化目录不一致')
    }
  } else if (source === 'author-provided') {
    if (catalogVersion !== null || inputRate + outputRate <= 0
      || safeManualSourceLabel(sourceLabel) !== sourceLabel
      || containsCredentialMaterial(sourceLabel, credentialValue)
      || containsCredentialLikeText(sourceLabel)
      || !isCalendarDate(asOf)) {
      preflightFail('作者价格快照不符合人工报价合同')
    }
  } else if (catalogVersion !== null || asOf !== 'local-runtime'
    || sourceLabel !== '作者确认的本地自托管 token 费用'
    || inputRate !== 0 || outputRate !== 0
    || !['ollama', 'custom'].includes(provider)
    || !isTextOpenWorldCreatorLocalEndpointV1(binding.endpointOrigin)) {
    preflightFail('本地零费用快照不符合本地服务合同')
  }
  const quoteHash = runtimeHash(row.quoteHash, 'priceQuote.quoteHash')
  const body = {
    schema: row.schema, version: row.version, provider, model, source, sourceLabel,
    catalogVersion, asOf, currency: 'USD' as const,
    inputUsdPerMillionTokens: inputRate, outputUsdPerMillionTokens: outputRate,
  }
  if (await hashCanonicalValue(body) !== quoteHash) preflightFail('价格快照 Hash 不匹配')
  return { ...body, quoteHash } as TextOpenWorldCreatorPriceQuoteV1
}

async function parseEstimate(value: unknown): Promise<TextOpenWorldCreatorProductionEstimateV1> {
  const row = runtimeRecord(value, 'estimate')
  exactKeys(row, [
    'schema', 'version', 'recommendedModelCalls', 'maximumModelCalls', 'reservedInputTokens',
    'reservedOutputTokens', 'estimatedTextCostUsd', 'maximumCostUsd', 'maximumDurationMs',
    'maximumStorageBytes', 'mediaCostPolicy', 'estimateHash',
  ], 'estimate')
  if (row.schema !== 'storyforge.text-open-world-creator-production-estimate' || row.version !== 1
    || row.mediaCostPolicy !== 'deferred-until-media-plan') preflightFail('estimate schema/version/policy 无效')
  const body = {
    schema: 'storyforge.text-open-world-creator-production-estimate' as const,
    version: 1 as const,
    recommendedModelCalls: runtimeInteger(row.recommendedModelCalls, 'estimate.recommendedModelCalls'),
    maximumModelCalls: runtimeInteger(row.maximumModelCalls, 'estimate.maximumModelCalls'),
    reservedInputTokens: runtimeInteger(row.reservedInputTokens, 'estimate.reservedInputTokens'),
    reservedOutputTokens: runtimeInteger(row.reservedOutputTokens, 'estimate.reservedOutputTokens'),
    estimatedTextCostUsd: row.estimatedTextCostUsd == null
      ? null : runtimeFinite(row.estimatedTextCostUsd, 'estimate.estimatedTextCostUsd'),
    maximumCostUsd: runtimeFinite(row.maximumCostUsd, 'estimate.maximumCostUsd'),
    maximumDurationMs: runtimeInteger(row.maximumDurationMs, 'estimate.maximumDurationMs'),
    maximumStorageBytes: runtimeInteger(row.maximumStorageBytes, 'estimate.maximumStorageBytes'),
    mediaCostPolicy: row.mediaCostPolicy,
  }
  const estimateHash = runtimeHash(row.estimateHash, 'estimate.estimateHash')
  if (await hashCanonicalValue(body) !== estimateHash) preflightFail('生产预算 Hash 不匹配')
  return { ...body, estimateHash } as TextOpenWorldCreatorProductionEstimateV1
}

export interface TextOpenWorldCreatorPreflightRuntimeV1 {
  projectId: number
  aiConfig: AIConfig
  rememberApiKey: boolean
}

function resolvedCredentialMode(input: {
  credentialPresent: boolean
  localNoKey: boolean
  presetId: string | null
  rememberApiKey: boolean
}): TextOpenWorldCreatorProviderBindingV1['credentialMode'] {
  if (!input.credentialPresent) return input.localNoKey ? 'local-no-key' : 'missing'
  if (input.presetId) {
    const state = useAIConfigStore.getState()
    const preset = state.presets.find(item => item.id === input.presetId)
    if (preset?.config.apiKey.trim()) return 'remembered-browser'
    if (getAIConfigPresetSessionApiKey(input.presetId).trim()) return 'session'
    // A routed preset may intentionally borrow the global Key when its
    // provider connection is identical. In that case the global policy owns
    // the persistence label.
    return state.rememberApiKey ? 'remembered-browser' : 'session'
  }
  return input.rememberApiKey ? 'remembered-browser' : 'session'
}

async function currentProviderBinding(input: TextOpenWorldCreatorPreflightRuntimeV1): Promise<{
  binding: TextOpenWorldCreatorProviderBindingV1
  endpoint: SafeCreatorEndpointV1 | null
  credentialValue: string
  blockers: string[]
}> {
  const resolution = resolveRequestConfig(input.aiConfig, {
    category: TEXT_OPEN_WORLD_PRODUCTION_TEXT_CATEGORY_V1,
    projectId: input.projectId,
  })
  const aiConfig = resolution.config
  const blockers: string[] = []
  const credentialValue = aiConfig.apiKey.trim()
  const credentialInEndpoint = containsCredentialMaterial(aiConfig.baseUrl, credentialValue)
    || containsCredentialLikeText(aiConfig.baseUrl)
  const inspectedEndpoint = safeEndpoint(aiConfig.baseUrl)
  const endpoint = credentialInEndpoint ? null : inspectedEndpoint
  const rawModel = aiConfig.model.trim().normalize('NFC')
  const credentialInModel = containsCredentialMaterial(rawModel, credentialValue)
    || containsCredentialLikeText(rawModel)
  const model = rawModel.length <= 500 && !credentialInModel ? rawModel : ''
  const credentialPresent = Boolean(credentialValue)
  const localNoKey = !credentialPresent && endpoint?.local === true
    && ['ollama', 'custom'].includes(aiConfig.provider)
  const credentialMode = resolvedCredentialMode({
    credentialPresent,
    localNoKey,
    presetId: resolution.presetId,
    rememberApiKey: input.rememberApiKey,
  })
  const temperature = normalizedGenerationNumber(
    aiConfig.temperature,
    0,
    MAXIMUM_TEMPERATURE_V1,
  )
  const maxTokens = validExplicitMaxTokens(aiConfig.maxTokens) ? aiConfig.maxTokens : 0
  const contextWindow = aiConfig.contextWindow == null || aiConfig.contextWindow === 0
    ? null
    : validContextWindow(aiConfig.contextWindow) ? aiConfig.contextWindow : null
  if (credentialInEndpoint) {
    blockers.push('模型服务地址疑似包含凭证内容；已拒绝写入检查快照，请在设置中清理地址。')
  } else if (!endpoint) blockers.push('模型服务地址无效；请在设置中填写有效的 HTTP(S) 地址。')
  if (endpoint && !endpoint.secureTransport) {
    blockers.push('远程模型必须使用 HTTPS；HTTP 只允许本机 loopback 服务。')
  }
  if (inspectedEndpoint?.embeddedSensitiveParts) {
    blockers.push('模型服务基地址不能包含用户名、密码、查询参数或 fragment。')
  }
  if (credentialInModel) blockers.push('模型名称包含凭证内容；已拒绝写入检查快照。')
  else if (!model) blockers.push(rawModel ? '模型名称过长；请填写不超过 500 个字符的模型 ID。' : '模型名称为空；请先在设置中选择或填写模型。')
  if (!credentialPresent && !localNoKey) blockers.push('当前远程模型没有可用 API Key。')
  if (!Number.isFinite(aiConfig.temperature) || aiConfig.temperature < 0
    || aiConfig.temperature > MAXIMUM_TEMPERATURE_V1) blockers.push('模型温度配置无效。')
  if (!validExplicitMaxTokens(aiConfig.maxTokens)) blockers.push('模型输出上限配置无效。')
  if (aiConfig.contextWindow != null && aiConfig.contextWindow !== 0
    && !validContextWindow(aiConfig.contextWindow)) {
    blockers.push('模型上下文窗口配置无效。')
  }
  const endpointRouteHash = await hashCanonicalValue({
    route: endpoint?.route ?? '',
  })
  const providerBindingBody = {
    schema: 'storyforge.text-open-world-creator-provider-binding' as const,
    version: 1 as const,
    provider: aiConfig.provider,
    model,
    endpointOrigin: endpoint?.origin ?? '',
    endpointRouteHash,
    catalogPricingEligible: catalogPricingEligible(aiConfig.provider, endpoint),
    credentialMode,
    credentialPresent,
    credentialReady: credentialPresent || localNoKey,
    temperature,
    maxTokens,
    contextWindow,
  }
  const binding: TextOpenWorldCreatorProviderBindingV1 = {
    ...providerBindingBody,
    bindingHash: await hashCanonicalValue(providerBindingBody),
  }
  return { binding, endpoint, credentialValue, blockers }
}

/**
 * Builds a no-write production readiness snapshot from the confirmed Creator
 * Brief and the current global AI configuration. Secrets are inspected only as
 * a boolean and are never copied into the return value or any hash input.
 */
export async function createTextOpenWorldCreatorProductionPreflightV1(input: {
  brief: TextOpenWorldCreatorBriefV1
  projectId: number
  aiConfig: AIConfig
  rememberApiKey: boolean
  pricing: TextOpenWorldCreatorPricingSelectionV1
}): Promise<TextOpenWorldCreatorProductionPreflightV1> {
  const brief = await verifyTextOpenWorldCreatorBriefV1(input.brief)
  const current = await currentProviderBinding(input)
  const blockers: string[] = [...current.blockers]
  const warnings: string[] = []
  const providerBinding = current.binding
  const provider = providerBinding.provider
  const model = providerBinding.model
  const priceQuote = await createPriceQuote({
    provider,
    model,
    endpointIsLocal: current.endpoint?.local === true,
    catalogPricingEligible: providerBinding.catalogPricingEligible,
    credentialValue: current.credentialValue,
    pricing: input.pricing, blockers,
  })
  const budget = DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1.aiBudget.production
  const estimatedTextCostUsd = priceQuote == null ? null
    : budget.maximumInputTokens / 1_000_000 * priceQuote.inputUsdPerMillionTokens
      + budget.maximumOutputTokens / 1_000_000 * priceQuote.outputUsdPerMillionTokens
  const estimateBody = {
    schema: 'storyforge.text-open-world-creator-production-estimate' as const,
    version: 1 as const,
    recommendedModelCalls: TEXT_OPEN_WORLD_PRODUCTION_MODEL_CALL_BUDGET_V1.recommended,
    maximumModelCalls: budget.maximumCalls,
    reservedInputTokens: budget.maximumInputTokens,
    reservedOutputTokens: budget.maximumOutputTokens,
    estimatedTextCostUsd,
    maximumCostUsd: budget.maximumEstimatedCostUsd,
    maximumDurationMs: TEXT_OPEN_WORLD_CREATOR_PRODUCTION_RESOURCE_LIMITS_V1.maximumDurationMs,
    maximumStorageBytes: TEXT_OPEN_WORLD_CREATOR_PRODUCTION_RESOURCE_LIMITS_V1.maximumStorageBytes,
    mediaCostPolicy: 'deferred-until-media-plan' as const,
  }
  const estimate = { ...estimateBody, estimateHash: await hashCanonicalValue(estimateBody) }
  if (estimate.recommendedModelCalls > estimate.maximumModelCalls) {
    blockers.push('完整生产 DAG 的推荐调用数已经超过产品硬上限。')
  }
  if (estimatedTextCostUsd != null && estimatedTextCostUsd > budget.maximumEstimatedCostUsd) {
    blockers.push(`当前文本模型预估上限 $${estimatedTextCostUsd.toFixed(2)} 超过单 Build $${budget.maximumEstimatedCostUsd.toFixed(2)} 硬保护。`)
  }
  if (priceQuote?.source === 'storyforge-catalog') {
    warnings.push('内置价格是版本化工程估算，不是供应商账单；开始生产前仍需作者核对。')
  } else if (priceQuote?.source === 'author-provided') {
    warnings.push('人工价格由作者负责核对，StoryForge 不会把它冒充供应商实时账单。')
  } else if (priceQuote?.source === 'author-confirmed-local-zero') {
    warnings.push('零 token 费用不包含本地硬件、电力或托管基础设施成本。')
  }
  warnings.push('当前估算只覆盖文本模型；头像、背景等媒资在 G5-08 形成实际排产后必须单独报价确认。')
  if (providerBinding.credentialMode === 'remembered-browser') {
    warnings.push('当前 Key 由作者选择保存在浏览器本地；默认会话存储更适合共享设备。')
  }
  const body = {
    schema: 'storyforge.text-open-world-creator-production-preflight' as const,
    version: 1 as const,
    productInstanceKey: brief.productInstanceKey,
    briefHash: brief.briefHash,
    sourceBindingHash: brief.sourceBindingHash,
    providerBinding,
    priceQuote,
    estimate,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    ready: blockers.length === 0,
  }
  return { ...body, preflightHash: await hashCanonicalValue(body) }
}

export async function verifyTextOpenWorldCreatorProductionPreflightV1(
  value: unknown,
  expected: TextOpenWorldCreatorPreflightRuntimeV1 & { brief: unknown },
): Promise<TextOpenWorldCreatorProductionPreflightV1> {
  const row = runtimeRecord(value, 'preflight')
  exactKeys(row, [
    'schema', 'version', 'productInstanceKey', 'briefHash', 'sourceBindingHash',
    'providerBinding', 'priceQuote', 'estimate', 'blockers', 'warnings', 'ready',
    'preflightHash',
  ], 'preflight')
  if (row.schema !== 'storyforge.text-open-world-creator-production-preflight' || row.version !== 1) {
    preflightFail('preflight schema/version 无效')
  }
  const productInstanceKey = runtimeText(row.productInstanceKey, 'preflight.productInstanceKey', 200)
  if (!PREFLIGHT_STABLE_KEY.test(productInstanceKey)) preflightFail('productInstanceKey 无效')
  const briefHash = runtimeHash(row.briefHash, 'preflight.briefHash')
  const sourceBindingHash = runtimeHash(row.sourceBindingHash, 'preflight.sourceBindingHash')
  const current = await currentProviderBinding(expected)
  const providerBinding = await parseProviderBinding(row.providerBinding)
  const priceQuote = await parsePriceQuote(
    row.priceQuote,
    providerBinding,
    current.credentialValue,
  )
  const estimate = await parseEstimate(row.estimate)
  const blockers = runtimeHashList(row.blockers, 'preflight.blockers')
  const warnings = runtimeHashList(row.warnings, 'preflight.warnings')
  assertCredentialFreeText(blockers, current.credentialValue, 'preflight.blockers')
  assertCredentialFreeText(warnings, current.credentialValue, 'preflight.warnings')
  const ready = runtimeBoolean(row.ready, 'preflight.ready')
  const preflightHash = runtimeHash(row.preflightHash, 'preflight.preflightHash')
  const body = {
    schema: row.schema,
    version: row.version,
    productInstanceKey,
    briefHash,
    sourceBindingHash,
    providerBinding,
    priceQuote,
    estimate,
    blockers,
    warnings,
    ready,
  }
  if (await hashCanonicalValue(body) !== preflightHash) {
    preflightFail('生产前检查快照 Hash 不匹配')
  }
  const budget = DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1.aiBudget.production
  if (estimate.recommendedModelCalls !== TEXT_OPEN_WORLD_PRODUCTION_MODEL_CALL_BUDGET_V1.recommended
    || estimate.maximumModelCalls !== budget.maximumCalls
    || estimate.reservedInputTokens !== budget.maximumInputTokens
    || estimate.reservedOutputTokens !== budget.maximumOutputTokens
    || estimate.maximumCostUsd !== budget.maximumEstimatedCostUsd
    || estimate.maximumDurationMs !== TEXT_OPEN_WORLD_CREATOR_PRODUCTION_RESOURCE_LIMITS_V1.maximumDurationMs
    || estimate.maximumStorageBytes !== TEXT_OPEN_WORLD_CREATOR_PRODUCTION_RESOURCE_LIMITS_V1.maximumStorageBytes) {
    preflightFail('生产预算不符合当前产品硬保护')
  }
  if (priceQuote) {
    const expectedCost = estimate.reservedInputTokens / 1_000_000
      * priceQuote.inputUsdPerMillionTokens
      + estimate.reservedOutputTokens / 1_000_000
      * priceQuote.outputUsdPerMillionTokens
    if (estimate.estimatedTextCostUsd == null
      || Math.abs(estimate.estimatedTextCostUsd - expectedCost) > 1e-9) {
      preflightFail('文本费用估算与冻结单价不一致')
    }
  } else if (estimate.estimatedTextCostUsd != null) {
    preflightFail('未知价格不能形成费用数值')
  }
  const endpoint = providerBinding.endpointOrigin ? safeEndpoint(providerBinding.endpointOrigin) : null
  const structurallyReady = blockers.length === 0
    && modelIdentityReady(providerBinding)
    && endpoint?.secureTransport === true
    && priceQuote != null
    && providerBinding.credentialReady
    && estimate.recommendedModelCalls <= estimate.maximumModelCalls
    && estimate.estimatedTextCostUsd != null
    && estimate.estimatedTextCostUsd <= estimate.maximumCostUsd
  if (ready !== structurallyReady) {
    preflightFail('ready 与模型、端点、凭证、报价和预算事实不一致')
  }
  const brief = await verifyTextOpenWorldCreatorBriefV1(expected.brief)
  if (productInstanceKey !== brief.productInstanceKey || briefHash !== brief.briefHash
    || sourceBindingHash !== brief.sourceBindingHash) {
    preflightFail('预检与已确认 Creator Brief 不一致')
  }
  if (current.binding.bindingHash !== providerBinding.bindingHash) {
    preflightFail('当前任务路由、模型、端点或凭证状态已变化')
  }
  if (current.blockers.some(blocker => !blockers.includes(blocker))) {
    preflightFail('当前模型配置的强制阻断项缺失')
  }
  return { ...body, preflightHash } as TextOpenWorldCreatorProductionPreflightV1
}

function modelIdentityReady(binding: TextOpenWorldCreatorProviderBindingV1): boolean {
  return Boolean(binding.model && binding.endpointOrigin)
}

export async function confirmTextOpenWorldCreatorProductionPreflightV1(input: {
  brief: TextOpenWorldCreatorBriefV1
  preflight: TextOpenWorldCreatorProductionPreflightV1
  projectId: number
  aiConfig: AIConfig
  rememberApiKey: boolean
  acknowledgement: TextOpenWorldCreatorPreflightAcknowledgementV1
  confirmedAt?: number
}): Promise<TextOpenWorldCreatorProductionPreflightConfirmationV1> {
  const preflight = await verifyTextOpenWorldCreatorProductionPreflightV1(
    input.preflight,
    {
      brief: input.brief,
      projectId: input.projectId,
      aiConfig: input.aiConfig,
      rememberApiKey: input.rememberApiKey,
    },
  )
  if (!preflight.ready || preflight.blockers.length || !preflight.priceQuote) {
    throw new Error('[text-open-world-preflight] 当前模型、凭证、价格或预算尚未通过检查')
  }
  const acknowledgement = runtimeRecord(input.acknowledgement, 'acknowledgement')
  exactKeys(acknowledgement, [
    'credentialPolicyReviewed', 'providerAndModelReviewed', 'priceAndBudgetReviewed',
    'mediaCostBoundaryReviewed',
  ], 'acknowledgement')
  if (Object.values(acknowledgement).some(value => value !== true)) {
    throw new Error('[text-open-world-preflight] 必须逐项确认凭证、模型、价格预算与媒资费用边界')
  }
  const body = {
    schema: 'storyforge.text-open-world-creator-production-preflight-confirmation' as const,
    version: 1 as const,
    productInstanceKey: preflight.productInstanceKey,
    briefHash: preflight.briefHash,
    providerBindingHash: preflight.providerBinding.bindingHash,
    priceQuoteHash: preflight.priceQuote.quoteHash,
    estimateHash: preflight.estimate.estimateHash,
    acknowledgement: {
      credentialPolicyReviewed: true as const,
      providerAndModelReviewed: true as const,
      priceAndBudgetReviewed: true as const,
      mediaCostBoundaryReviewed: true as const,
    },
    confirmedAt: input.confirmedAt ?? Date.now(),
  }
  return { ...body, confirmationHash: await hashCanonicalValue(body) }
}

export async function verifyTextOpenWorldCreatorProductionPreflightConfirmationV1(input: {
  brief: unknown
  preflight: unknown
  confirmation: unknown
  projectId: number
  aiConfig: AIConfig
  rememberApiKey: boolean
}): Promise<TextOpenWorldCreatorProductionPreflightConfirmationV1> {
  const brief = await verifyTextOpenWorldCreatorBriefV1(input.brief)
  const preflight = await verifyTextOpenWorldCreatorProductionPreflightV1(
    input.preflight,
    {
      brief,
      projectId: input.projectId,
      aiConfig: input.aiConfig,
      rememberApiKey: input.rememberApiKey,
    },
  )
  const row = runtimeRecord(input.confirmation, 'confirmation')
  exactKeys(row, [
    'schema', 'version', 'productInstanceKey', 'briefHash', 'providerBindingHash',
    'priceQuoteHash', 'estimateHash', 'acknowledgement', 'confirmedAt', 'confirmationHash',
  ], 'confirmation')
  if (row.schema !== 'storyforge.text-open-world-creator-production-preflight-confirmation'
    || row.version !== 1) preflightFail('confirmation schema/version 无效')
  const acknowledgement = runtimeRecord(row.acknowledgement, 'confirmation.acknowledgement')
  exactKeys(acknowledgement, [
    'credentialPolicyReviewed', 'providerAndModelReviewed', 'priceAndBudgetReviewed',
    'mediaCostBoundaryReviewed',
  ], 'confirmation.acknowledgement')
  if (Object.values(acknowledgement).some(value => value !== true)) {
    preflightFail('confirmation 作者确认项不完整')
  }
  const body = {
    schema: 'storyforge.text-open-world-creator-production-preflight-confirmation' as const,
    version: 1 as const,
    productInstanceKey: runtimeText(row.productInstanceKey, 'confirmation.productInstanceKey', 200),
    briefHash: runtimeHash(row.briefHash, 'confirmation.briefHash'),
    providerBindingHash: runtimeHash(row.providerBindingHash, 'confirmation.providerBindingHash'),
    priceQuoteHash: runtimeHash(row.priceQuoteHash, 'confirmation.priceQuoteHash'),
    estimateHash: runtimeHash(row.estimateHash, 'confirmation.estimateHash'),
    acknowledgement: {
      credentialPolicyReviewed: true as const,
      providerAndModelReviewed: true as const,
      priceAndBudgetReviewed: true as const,
      mediaCostBoundaryReviewed: true as const,
    },
    confirmedAt: runtimeInteger(row.confirmedAt, 'confirmation.confirmedAt'),
  }
  const confirmationHash = runtimeHash(row.confirmationHash, 'confirmation.confirmationHash')
  if (await hashCanonicalValue(body) !== confirmationHash) {
    preflightFail('生产前确认 Hash 不匹配')
  }
  if (!preflight.ready || !preflight.priceQuote
    || body.productInstanceKey !== preflight.productInstanceKey
    || body.productInstanceKey !== brief.productInstanceKey
    || body.briefHash !== preflight.briefHash
    || body.providerBindingHash !== preflight.providerBinding.bindingHash
    || body.priceQuoteHash !== preflight.priceQuote.quoteHash
    || body.estimateHash !== preflight.estimate.estimateHash) {
    preflightFail('Brief、模型、价格或预算已经变化，请重新确认')
  }
  return { ...body, confirmationHash }
}

function failureStatus(cause: unknown): { status: number; message: string; name: string } {
  if (!cause || typeof cause !== 'object') return { status: 0, message: '', name: '' }
  const row = cause as { status?: unknown; body?: unknown; message?: unknown; name?: unknown }
  return {
    status: typeof row.status === 'number' ? row.status : 0,
    message: [row.message, row.body].filter(value => typeof value === 'string').join(' '),
    name: typeof row.name === 'string' ? row.name : '',
  }
}

/** Safe, credential-free provider failure copy shared by creator UI and G6. */
export function describeTextOpenWorldProviderFailureV1(cause: unknown): TextOpenWorldProviderFailureDisplayV1 {
  const failure = failureStatus(cause)
  if (isProviderQuotaRejectionV1({ status: failure.status, message: failure.message })) return {
    kind: 'insufficient-balance',
    message: '模型服务余额不足或配额已经用完，生产已暂停，没有隐藏重发。',
    retryHint: '补足余额或额度后，从原检查点显式继续。',
  }
  if ([401, 403].includes(failure.status)) return {
    kind: 'authorization',
    message: '模型服务拒绝了当前凭证或模型权限，生产已暂停。',
    retryHint: '在设置中更换 Key 或模型并重新完成生产前确认。',
  }
  if (failure.status === 429) return {
    kind: 'rate-limit',
    message: '模型服务触发了频率限制，本次状态保持可恢复。',
    retryHint: '等待限流窗口恢复后显式重试。',
  }
  if (failure.name === 'AbortError' || /timeout|超时/i.test(failure.message)) return {
    kind: 'timeout', message: '模型请求超时，结果状态未被假定为成功。',
    retryHint: '先核对运行记录的交付状态，再决定是否重试。',
  }
  if (failure.name === 'TypeError' || /failed to fetch|network|断网|网络/i.test(failure.message)) return {
    kind: 'network', message: '模型服务网络不可用，生产已停在可恢复边界。',
    retryHint: '恢复网络后从检查点显式继续。',
  }
  return {
    kind: 'unknown-result', message: '模型请求失败或结果状态未知，系统不会隐藏重发。',
    retryHint: '查看安全运行证据并由作者决定继续方式。',
  }
}
