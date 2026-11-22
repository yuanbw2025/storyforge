import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { AIConfig } from '../types'
import { targetsOfficialProvider } from './provider-model-lifecycle'
import { normalizeOpenAIBaseUrl } from './openai-endpoint'
import type { CapacityFactV2, ModelCapacityFactsV2 } from '../types/agent-run'

/** Private connection identities are hashed; receipts never contain endpoints or credentials. */
export interface ModelCapacityV1 {
  version: 1
  bindingHash: string
  provider: AIConfig['provider']
  model: string
  totalWindow: number | null
  inputLimit: number | null
  outputLimit: number
  confidence: 'service' | 'official' | 'fallback'
  outputLimitSource: 'service' | 'official' | 'policy'
  source: string
  verifiedAt: number
  expiresAt: number
}
type Limits = Pick<ModelCapacityV1, 'totalWindow' | 'inputLimit' | 'outputLimit'>
const VERIFIED = Date.parse('2026-11-18T00:00:00Z')
const EXPIRES = Date.parse('2026-12-18T00:00:00Z')
/** Exact models only. Provider defaults and third-party aliases are not capacity evidence. */
const OFFICIAL: Record<string, Limits & { source: string; expiresAt?: number }> = {
  'agnes:agnes-2.5-flash': { totalWindow: 512000, inputLimit: null, outputLimit: 65500, source: 'https://agnes-ai.com/en/docs/agnes-25-flash' },
  'openai:gpt-4o': { totalWindow: 128000, inputLimit: null, outputLimit: 16384, source: 'https://developers.openai.com/api/docs/models/gpt-4o' },
  'openai:gpt-4o-mini': { totalWindow: 128000, inputLimit: null, outputLimit: 16384, source: 'https://developers.openai.com/api/docs/models/gpt-4o-mini' },
  'gemini:gemini-2.5-flash': { expiresAt: Date.parse('2026-12-01T00:00:00Z'), totalWindow: null, inputLimit: 1048576, outputLimit: 65536, source: 'https://aistudio.google.com/docs/models/gemini-2.5-flash' },
  'gemini:gemini-3.5-flash': { totalWindow: null, inputLimit: 1048576, outputLimit: 65536, source: 'https://aistudio.google.com/docs/models/gemini-3.5-flash' },
  'deepseek:deepseek-flash': { totalWindow: 1000000, inputLimit: null, outputLimit: 393216, source: 'https://api-docs.deepseek.com/api/create-chat-completion/' },
  'deepseek:deepseek-v4-flash': { totalWindow: 1000000, inputLimit: null, outputLimit: 393216, source: 'https://api-docs.deepseek.com/quick_start/pricing/' },
  'deepseek:deepseek-v4-pro': { totalWindow: 1000000, inputLimit: null, outputLimit: 393216, source: 'https://api-docs.deepseek.com/quick_start/pricing/' },
}
const cache = new Map<string, ModelCapacityV1>()
const pending = new Map<string, Promise<ModelCapacityV1>>()
const revisions = new Map<string, number>()
let generation = 0
let pinned = new WeakMap<AIConfig, ModelCapacityV1>()
let durablePins = new WeakSet<AIConfig>()
function identity(config: AIConfig): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([
    config.provider, normalizeOpenAIBaseUrl(config.baseUrl).baseUrl, config.model, config.apiKey,
  ]))))
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000
}
export function parseModelCapacityV1(value: unknown): ModelCapacityV1 {
  const row = record(value)
  const keys = ['version','bindingHash','provider','model','totalWindow','inputLimit','outputLimit','confidence','outputLimitSource','source','verifiedAt','expiresAt']
  if (Object.keys(row).sort().join('|') !== keys.sort().join('|') || row.version !== 1
    || typeof row.bindingHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.bindingHash)
    || typeof row.provider !== 'string' || typeof row.model !== 'string' || row.model.length > 500
    || !['service','official','fallback'].includes(String(row.confidence))
    || !['service','official','policy'].includes(String(row.outputLimitSource))
    || !(row.totalWindow === null || positive(row.totalWindow)) || !(row.inputLimit === null || positive(row.inputLimit))
    || (!positive(row.totalWindow) && !positive(row.inputLimit)) || !positive(row.outputLimit)
    || typeof row.verifiedAt !== 'number' || !Number.isSafeInteger(row.verifiedAt)
    || typeof row.expiresAt !== 'number' || !Number.isSafeInteger(row.expiresAt) || row.expiresAt <= row.verifiedAt
    || typeof row.source !== 'string' || !(['internal-conservative-policy-v1', 'https://ai.google.dev/api/models', 'https://docs.ollama.com/api/ps', 'https://lmstudio.ai/docs/developer/rest/list', ...Object.values(OFFICIAL).map(item => item.source)]).includes(row.source)) {
    throw new Error('模型能力快照无效。')
  }
  return structuredClone(value) as ModelCapacityV1
}
function bound(config: AIConfig, capacity: ModelCapacityV1 | undefined): capacity is ModelCapacityV1 {
  return !!capacity && capacity.version === 1 && capacity.bindingHash === identity(config)
    && capacity.model === config.model && capacity.provider === config.provider
    && positive(capacity.outputLimit) && (positive(capacity.totalWindow) || positive(capacity.inputLimit))
}
export function getModelCapacityV1(config: AIConfig, now = Date.now()): ModelCapacityV1 {
  const implicit = pinned.get(config)
  const frozen = config.modelCapacity ?? (implicit && (durablePins.has(config) || implicit.expiresAt > now) ? implicit : undefined)
  if (bound(config, frozen)) return frozen
  const key = identity(config), cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached
  const candidate = targetsOfficialProvider(config) ? OFFICIAL[`${config.provider}:${config.model}`] : undefined
  const official = candidate && now < Math.min(EXPIRES, candidate.expiresAt ?? EXPIRES) ? candidate : undefined
  return Object.freeze({ version: 1, bindingHash: key, provider: config.provider, model: config.model,
    ...(official ?? { totalWindow: config.provider === 'codex' ? 32768 : config.provider === 'ollama' || config.provider === 'custom' ? 4096 : 8000, inputLimit: null, outputLimit: config.provider === 'codex' ? 8192 : config.provider === 'ollama' || config.provider === 'custom' ? 2048 : 4000 }),
    confidence: official ? 'official' : 'fallback', outputLimitSource: official ? 'official' : 'policy', source: official?.source ?? 'internal-conservative-policy-v1',
    verifiedAt: official ? VERIFIED : now, expiresAt: official ? Math.min(EXPIRES, official.expiresAt ?? EXPIRES) : now + 60_000,
  })
}
export function getModelCapacityLimitsV1(config: AIConfig) {
  const capacity = getModelCapacityV1(config)
  return { maxContext: capacity.totalWindow ?? capacity.inputLimit!, maxOutput: capacity.outputLimit }
}
/** Durable preparation may freeze a conservative decision. Later cache refreshes cannot enlarge that request. */
export function freezeModelCapacityV1(config: AIConfig): ModelCapacityV1 {
  const result = getModelCapacityV1(config)
  pinned.set(config, result)
  durablePins.add(config)
  return result
}
export function inheritModelCapacityV1(source: AIConfig, target: AIConfig): AIConfig {
  const implicit = pinned.get(source)
  const snapshot = source.modelCapacity ?? (implicit && (durablePins.has(source) || implicit.expiresAt > Date.now()) ? implicit : undefined)
  return bound(target, snapshot) ? { ...target, modelCapacity: snapshot } : { ...target, modelCapacity: undefined }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function serviceWindow(window: number): Limits {
  return { totalWindow: window, inputLimit: null, outputLimit: Math.floor(window / 2) }
}
async function discover(config: AIConfig, fetchImpl: typeof fetch, now: number): Promise<ModelCapacityV1> {
  const fallback = getModelCapacityV1({ ...config, modelCapacity: undefined }, now)
  const base = normalizeOpenAIBaseUrl(config.baseUrl).baseUrl
  if (config.provider === 'codex') return fallback
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  async function read(url: string, gemini = false): Promise<Record<string, unknown>> {
    const response = await fetchImpl(url, { method: 'GET', signal: controller.signal, redirect: 'error',
      headers: config.apiKey ? gemini ? { 'x-goog-api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` } : undefined })
    if (!response.ok) throw new Error('metadata-unavailable')
    return record(await response.json())
  }
  try {
    let limits: Limits | undefined, source = ''
    if (config.provider === 'gemini' && targetsOfficialProvider(config)) {
      const data = await read(`${base.replace(/\/openai$/, '')}/models/${encodeURIComponent(config.model)}`, true)
      if (data.name === `models/${config.model}` && positive(data.inputTokenLimit) && positive(data.outputTokenLimit)) {
        limits = { totalWindow: null, inputLimit: data.inputTokenLimit, outputLimit: data.outputTokenLimit }
        source = 'https://ai.google.dev/api/models'
      }
    } else if (config.provider === 'ollama') {
      const data = await read(`${base.replace(/\/v1$/, '')}/api/ps`)
      const rows = Array.isArray(data.models) ? data.models.map(record).filter(row => row.name === config.model || row.model === config.model) : []
      const windows = rows.map(row => row.context_length).filter(positive)
      if (windows.length) { limits = serviceWindow(Math.min(...windows)); source = 'https://docs.ollama.com/api/ps' }
    } else if (config.provider === 'custom') {
      // LM Studio documents configured loaded-instance limits separately from theoretical max_context_length.
      const data = await read(`${base.replace(/\/v1$/, '')}/api/v1/models`)
      const row = Array.isArray(data.models) ? data.models.map(record).find(row => row.key === config.model && row.type === 'llm') : undefined
      const windows = Array.isArray(row?.loaded_instances) ? row.loaded_instances.map(record).map(instance => record(instance.config).context_length).filter(positive) : []
      if (windows.length) { limits = serviceWindow(Math.min(...windows)); source = 'https://lmstudio.ai/docs/developer/rest/list' }
    }
    if (!limits) return fallback
    return Object.freeze({ version: 1, bindingHash: identity(config), provider: config.provider, model: config.model,
      ...limits, confidence: 'service', outputLimitSource: config.provider === 'gemini' ? 'service' : 'policy', source, verifiedAt: now, expiresAt: now + 5 * 60_000 })
  } catch { return fallback } finally { clearTimeout(timer) }
}
/** Only the selected service is queried. No search service, model call or unbounded probing. */
export async function discoverModelCapacityV1(config: AIConfig, fetchImpl: typeof fetch = fetch): Promise<ModelCapacityV1> {
  config = { ...config, modelCapacity: undefined }
  const key = identity(config), now = Date.now(), hit = cache.get(key)
  if (hit && hit.expiresAt > now) return hit
  const existing = pending.get(key)
  if (existing) return existing
  const revision = revisions.get(key) ?? 0, startedGeneration = generation
  const operation = discover(config, fetchImpl, now).then(result => {
    if (generation === startedGeneration && (revisions.get(key) ?? 0) === revision) {
      if (cache.size >= 256) cache.delete(cache.keys().next().value!)
      cache.set(key, result)
    }
    return result
  }).finally(() => { if (pending.get(key) === operation) pending.delete(key) })
  pending.set(key, operation)
  return operation
}
export async function prepareModelCapacityV1(config: AIConfig): Promise<AIConfig> {
  const implicit = pinned.get(config)
  const snapshot = config.modelCapacity ?? (implicit && (durablePins.has(config) || implicit.expiresAt > Date.now()) ? implicit : undefined)
  const capacity = bound(config, snapshot) ? snapshot : await discoverModelCapacityV1(config)
  pinned.set(config, capacity)
  return { ...config, modelCapacity: capacity }
}
export function invalidateModelCapacityV1(config: AIConfig): void { const key = identity(config); cache.delete(key); pending.delete(key); revisions.set(key, (revisions.get(key) ?? 0) + 1) }
export function resetModelCapacityForTestsV1(): void { generation++; cache.clear(); pending.clear(); revisions.clear(); pinned = new WeakMap(); durablePins = new WeakSet() }
/** Shared by source assembly and final transmission. maxTokens=0 remains automatic. */
export function modelInputBudgetV1(capacity: ModelCapacityV1, requestedOutput = 0): { inputBudget: number; outputBudget: number; safetyMargin: number } {
  const outputBudget = Math.min(requestedOutput > 0 ? requestedOutput : capacity.outputLimitSource === 'policy' ? Math.min(8192, capacity.outputLimit) : capacity.outputLimit, capacity.outputLimit, capacity.totalWindow ? Math.floor(capacity.totalWindow / 2) : Infinity)
  if (!positive(outputBudget) || outputBudget > capacity.outputLimit) throw new Error('本次输出上限超过当前模型支持的范围，请降低输出长度后重试。')
  const physicalInput = Math.min(capacity.inputLimit ?? Infinity, capacity.totalWindow ? capacity.totalWindow - outputBudget : Infinity)
  const safetyMargin = Math.max(128, Math.ceil(physicalInput * 0.05))
  const inputBudget = Math.floor(physicalInput - safetyMargin)
  if (inputBudget < 1) throw new Error('本次输出预留后没有足够输入空间，请降低输出长度后重试。')
  return { inputBudget, outputBudget, safetyMargin }
}

/** Project the existing connection-bound facts without turning its conservative
 * policy into service evidence. No discovery, IO or cache mutation occurs here. */
export function projectModelCapacityFactsV2(
  config: AIConfig, routeHash: string, now = Date.now(),
): ModelCapacityFactsV2 {
  if (!/^[a-f0-9]{64}$/.test(routeHash)) throw new Error('请求路由身份无效。')
  const snapshot = getModelCapacityV1(config, now)
  const valid = bound(config, snapshot) && snapshot.expiresAt > now && snapshot.verifiedAt <= now
  const basis = valid && snapshot.confidence === 'service' ? 'service'
    : valid && snapshot.confidence === 'official' && targetsOfficialProvider(config) ? 'official-endpoint' : null
  const fact = (tokens: number | null, evidenced = true): CapacityFactV2 =>
    basis && evidenced && positive(tokens) ? Object.freeze({ tokens, basis,
      sourceId: snapshot.source, verifiedAt: snapshot.verifiedAt, expiresAt: snapshot.expiresAt }) : null
  // A matching catalog name on a proxy is a declaration only. It cannot prove
  // that proxy's configured window, and never inherits policy output values.
  const declared = !basis && !targetsOfficialProvider(config) ? OFFICIAL[`${config.provider}:${config.model}`] : undefined
  const declarationExpiry = declared ? Math.min(EXPIRES, declared.expiresAt ?? EXPIRES) : 0
  const declaredFact = (tokens: number | null): CapacityFactV2 => declared && declarationExpiry > now && positive(tokens)
    ? Object.freeze({ tokens, basis: 'declared-model', sourceId: declared.source, verifiedAt: VERIFIED, expiresAt: declarationExpiry }) : null
  return Object.freeze({ version: 2, routeHash,
    contextTokens: fact(snapshot.totalWindow) ?? declaredFact(declared?.totalWindow ?? null),
    inputTokens: fact(snapshot.inputLimit) ?? declaredFact(declared?.inputLimit ?? null),
    outputTokens: fact(snapshot.outputLimit, snapshot.outputLimitSource !== 'policy') ?? declaredFact(declared?.outputLimit ?? null),
  })
}

/** Historical parsing checks representation; freshness is a dispatch decision. */
export function parseModelCapacityFactsV2(value: unknown): ModelCapacityFactsV2 {
  const row = record(value)
  if (Object.keys(row).sort().join('|') !== ['contextTokens','inputTokens','outputTokens','routeHash','version'].sort().join('|')
    || row.version !== 2 || typeof row.routeHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.routeHash)) throw new Error('逐维模型能力证据无效。')
  const parse = (value: unknown): CapacityFactV2 => {
    if (value === null) return null
    const item = record(value)
    if (Object.keys(item).sort().join('|') !== ['tokens','basis','sourceId','verifiedAt','expiresAt'].sort().join('|')
      || !positive(item.tokens) || !['service','official-endpoint','declared-model'].includes(String(item.basis))
      || typeof item.sourceId !== 'string' || !item.sourceId || item.sourceId.length > 2000
      || !Number.isSafeInteger(item.verifiedAt) || !Number.isSafeInteger(item.expiresAt)
      || Number(item.expiresAt) <= Number(item.verifiedAt)) throw new Error('逐维模型能力事实无效。')
    return { tokens: item.tokens, basis: item.basis as NonNullable<CapacityFactV2>['basis'],
      sourceId: item.sourceId, verifiedAt: Number(item.verifiedAt), expiresAt: Number(item.expiresAt) }
  }
  return { version: 2, routeHash: row.routeHash,
    contextTokens: parse(row.contextTokens), inputTokens: parse(row.inputTokens), outputTokens: parse(row.outputTokens) }
}
