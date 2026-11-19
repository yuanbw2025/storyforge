import type { AIConfig } from '../../types'
import { normalizeOpenAIBaseUrl } from '../../ai/openai-endpoint'

export type AtlasImageProtocol = 'agnes' | 'openai-edit' | 'gemini-interactions'
export type AtlasImageCapability = 'unknown' | 'text' | 'vision' | 'text-to-image' | 'reference-image'
export interface AtlasImageConnection {
  presetId: string
  model: string
  protocol: AtlasImageProtocol
  capability: AtlasImageCapability
}
const key = 'storyforge-atlas-image-connection-v1'
export function defaultAtlasImageConnection(config?: AIConfig, presetId = ''): AtlasImageConnection {
  const agnes = config?.provider === 'agnes', gemini = config?.provider === 'gemini'
  return { presetId, protocol: agnes ? 'agnes' : gemini ? 'gemini-interactions' : 'openai-edit',
    model: agnes ? 'agnes-image-2.1-flash' : gemini ? 'gemini-nano-banana-2.1' : '',
    capability: agnes || gemini ? 'reference-image' : 'unknown' }
}
export function readAtlasImageConnection(): AtlasImageConnection {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as AtlasImageConnection
    if (value && typeof value.presetId === 'string' && typeof value.model === 'string'
      && value.model.length <= 200 && ['agnes', 'openai-edit', 'gemini-interactions'].includes(value.protocol)
      && ['unknown', 'text', 'vision', 'text-to-image', 'reference-image'].includes(value.capability)) return value
  } catch { /* A missing preference never prevents native maps. */ }
  return defaultAtlasImageConnection()
}
/** Stores preset identity and image settings only. Credentials remain in the existing preset store. */
export function saveAtlasImageConnection(value: AtlasImageConnection) {
  localStorage.setItem(key, JSON.stringify({ presetId: value.presetId, model: value.model,
    protocol: value.protocol, capability: value.capability }))
}
export function atlasImageConnectionProblem(connection: AtlasImageConnection, config?: AIConfig): string {
  if (!connection.presetId || !config) return '请选择已保存的图片连接预设；程序地图可直接使用。'
  if (connection.capability !== 'reference-image') return ({ unknown: '尚未声明参考图重绘能力。', text: '此连接仅支持文本。',
    vision: '能看图不代表能生成图片。', 'text-to-image': '仅文生图不能重绘当前地图。' })[connection.capability]
    + '可另选支持参考图的图片连接；程序地图不受影响。'
  if (!connection.model.trim()) return '请填写图片模型名称。'
  if (!config.baseUrl.trim() || !config.apiKey.trim()) return '此预设缺少连接地址或可用凭据，请到模型设置中补齐。'
  if (connection.protocol === 'agnes' && !['agnes-image-2.1-flash', 'agnes-image-2.5-flash'].includes(connection.model)) return 'Agnes 请使用已适配的 Image 2.1 或 2.5 Flash。'
  return ''
}
export function atlasImageConfig(connection: AtlasImageConnection, config: AIConfig): AIConfig {
  const problem = atlasImageConnectionProblem(connection, config)
  if (problem) throw Error(problem)
  // A protocol selection is explicit. Never infer another provider or send to another connection.
  return { ...config, provider: connection.protocol === 'agnes' ? 'agnes' : connection.protocol === 'gemini-interactions' ? 'gemini' : 'custom',
    baseUrl: connection.protocol === 'gemini-interactions' ? config.baseUrl.replace(/\/+$/, '') : normalizeOpenAIBaseUrl(config.baseUrl).baseUrl }
}
