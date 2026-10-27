import { PROVIDER_PRESETS, type AIConfig, type AIProvider } from '../types/ai'
import { AI_PROXY_ENDPOINTS } from './proxy-endpoints'
import { normalizeOpenAIBaseUrl } from './openai-endpoint'

type ModelTarget = Pick<AIConfig, 'provider' | 'baseUrl' | 'model'>

/** A provider label does not establish the identity of a private gateway. */
export function targetsOfficialProvider(config: ModelTarget): boolean {
  const endpoint = AI_PROXY_ENDPOINTS[config.provider]
  const direct = endpoint?.direct ?? PROVIDER_PRESETS[config.provider]?.baseUrl
  if (!direct) return false
  const base = normalizeOpenAIBaseUrl(config.baseUrl).baseUrl
  const proxyPaths = endpoint ? [endpoint.proxy, `/storyforge${endpoint.proxy}`] : []
  if (proxyPaths.includes(base)) return true
  try {
    const actual = new URL(base)
    if (actual.username || actual.password || actual.search || actual.hash) return false
    if (typeof location !== 'undefined' && actual.origin === location.origin && proxyPaths.includes(actual.pathname)) return true
    const official = new URL(direct)
    return actual.origin === official.origin && actual.pathname === official.pathname
  } catch {
    return false
  }
}

const RETIRED_MODELS: ReadonlyArray<{ provider: AIProvider; model: string; retiredOn: string; sourceUrl: string }> = [
  { provider: 'claude', model: 'claude-sonnet-4-20250514', retiredOn: '2026-06-15', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/model-deprecations' },
  { provider: 'gemini', model: 'gemini-2.0-flash', retiredOn: '2026-06-01', sourceUrl: 'https://ai.google.dev/gemini-api/docs/deprecations' },
]

export function getModelRetirement(config: ModelTarget) {
  if (!targetsOfficialProvider(config)) return undefined
  return RETIRED_MODELS.find(item => item.provider === config.provider && item.model === config.model)
}

// Official OpenAI compatibility docs reject custom sampling on these model families.
// Keep older Claude models and private/custom gateways on their existing contracts.
const CLAUDE_FIXED_SAMPLING_MODELS = new Set([
  'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5',
  'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-haiku-5-5',
  'claude-fable-5', 'claude-fable-5-1', 'claude-mythos-preview', 'claude-mythos-5', 'claude-mythos-5-1',
])

export function allowsSamplingTemperature(config: ModelTarget): boolean {
  return !(config.provider === 'claude' && targetsOfficialProvider(config) && CLAUDE_FIXED_SAMPLING_MODELS.has(config.model))
}
