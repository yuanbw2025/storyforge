import type { AIRequestSettingsV1 } from '../ai/client'
import type { ChatMessage } from '../types'

export interface ProseRenderedRequestV1 {
  version: 'prose-rendered-request-v1'
  messages: ChatMessage[]
  settings: AIRequestSettingsV1
}

/** No endpoint, credentials or arbitrary configuration may enter durable prose evidence. */
export function parseProseRequestSettingsV1(value: unknown): AIRequestSettingsV1 {
  const row = value as AIRequestSettingsV1
  const exact = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === keys.sort().join('|')
  if (!exact(row, ['version', 'provider', 'model', 'transport', 'stream', 'requested', 'parameters'])
    || row.version !== 'ai-request-settings-v1' || typeof row.provider !== 'string' || !row.provider || row.provider.length > 100
    || typeof row.model !== 'string' || !row.model || row.model.length > 300
    || !['openai-compatible', 'codex-bridge'].includes(row.transport) || typeof row.stream !== 'boolean'
    || !exact(row.requested, ['temperature', 'maxTokens'])
    || !row.parameters || typeof row.parameters !== 'object' || Array.isArray(row.parameters)) throw new Error('正文模型参数证据无效。')
  for (const [key, number] of Object.entries(row.requested)) {
    if (number !== null && (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || (key === 'maxTokens' && !Number.isSafeInteger(number)))) throw new Error('正文要求参数无效。')
  }
  for (const [key, value] of Object.entries(row.parameters)) {
    if (key === 'temperature' || key === 'max_tokens') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key === 'max_tokens' && !Number.isSafeInteger(value))) throw new Error('正文发送参数无效。')
    } else if (key === 'reasoning_effort') {
      if (!['minimal', 'low', 'medium', 'high'].includes(String(value))) throw new Error('正文推理参数无效。')
    } else if (key === 'thinking') {
      if (!exact(value, ['type']) || !['enabled', 'disabled'].includes(String((value as { type: string }).type))) throw new Error('正文推理模式无效。')
    } else if (key === 'response_format') {
      if (!exact(value, ['type']) || (value as { type: unknown }).type !== 'json_object') throw new Error('正文JSON输出模式无效。')
    } else throw new Error(`正文参数证据禁止保存 ${key}。`)
  }
  if (row.transport === 'codex-bridge' && Object.keys(row.parameters).length) throw new Error('Codex 连接不能冒充 HTTP 参数。')
  return structuredClone(row)
}

export function proseRenderedRequestV1(messages: ChatMessage[], settings: AIRequestSettingsV1): ProseRenderedRequestV1 {
  return { version: 'prose-rendered-request-v1', messages: messages.map(message => ({ ...message })), settings: parseProseRequestSettingsV1(settings) }
}
