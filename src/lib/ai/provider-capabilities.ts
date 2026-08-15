import type { AIProvider } from '../types'

export const AI_PROVIDER_CAPABILITY_PROFILE_VERSION_V1 = 'ai-provider-capabilities-v1' as const

export type NativeToolCallsCapabilityV1 = 'supported' | 'unsupported' | 'unverified'
export type JsonObjectResponseCapabilityV1 = 'supported' | 'unsupported' | 'unverified'

export interface AIProviderCapabilityProfileV1 {
  version: typeof AI_PROVIDER_CAPABILITY_PROFILE_VERSION_V1
  provider: AIProvider
  nativeToolCalls: NativeToolCallsCapabilityV1
  parallelNativeToolCalls: false
}

const NATIVE_TOOL_CALLS: Record<AIProvider, NativeToolCallsCapabilityV1> = {
  openai: 'supported',
  deepseek: 'unverified',
  qwen: 'unverified',
  doubao: 'unverified',
  minimax: 'unverified',
  glm: 'unverified',
  wenxin: 'unsupported',
  gemini: 'unsupported',
  poe: 'unsupported',
  kimi: 'unverified',
  claude: 'unverified',
  modelscope: 'unverified',
  nvidia: 'unverified',
  agnes: 'unverified',
  longcat: 'unverified',
  opencode: 'unverified',
  ollama: 'unverified',
  custom: 'unverified',
}

/**
 * Keep response-format evidence separate from native tool-call evidence: an
 * OpenAI-compatible provider can support JSON object mode without supporting
 * StoryForge's closed native-tool protocol. Only transports exercised by a
 * StoryForge contract/eval are enabled here; every other provider remains on
 * the strict text parser until it gains equivalent evidence.
 */
const JSON_OBJECT_RESPONSE: Record<AIProvider, JsonObjectResponseCapabilityV1> = {
  openai: 'supported',
  deepseek: 'unverified',
  qwen: 'unverified',
  doubao: 'supported',
  minimax: 'unverified',
  glm: 'unverified',
  wenxin: 'unsupported',
  gemini: 'unsupported',
  poe: 'unsupported',
  kimi: 'unverified',
  claude: 'unverified',
  modelscope: 'unverified',
  nvidia: 'unverified',
  agnes: 'supported',
  longcat: 'unverified',
  opencode: 'unverified',
  ollama: 'unverified',
  custom: 'unverified',
}

/**
 * This matrix records transports StoryForge has verified, not every feature a
 * provider may advertise. Unknown/model-dependent endpoints stay on the text
 * protocol until they gain provider-specific contract evidence.
 */
export function getAIProviderCapabilityProfileV1(
  provider: AIProvider,
): AIProviderCapabilityProfileV1 {
  return {
    version: AI_PROVIDER_CAPABILITY_PROFILE_VERSION_V1,
    provider,
    nativeToolCalls: NATIVE_TOOL_CALLS[provider],
    parallelNativeToolCalls: false,
  }
}

export function getJsonObjectResponseCapabilityV1(
  provider: AIProvider,
): JsonObjectResponseCapabilityV1 {
  return JSON_OBJECT_RESPONSE[provider]
}

export function supportsVerifiedJsonObjectResponseV1(provider: AIProvider): boolean {
  return getJsonObjectResponseCapabilityV1(provider) === 'supported'
}
