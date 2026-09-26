export { assertVoiceTransport } from '../agent/limited-ai-transport'

export interface VoiceService {
  baseUrl: string
  model: string
  apiKey: string
  voice: string
}
export interface CompanionPreferences {
  visible: boolean
  portrait: string
  inputMode: 'browser' | 'service'
  outputMode: 'browser' | 'service'
  inputDeviceId: string
  outputDeviceId: string
  browserVoice: string
  autoRead: boolean
  input: VoiceService
  output: VoiceService
}
export const DEFAULT_COMPANION: CompanionPreferences = {
  visible: true, portrait: '', inputMode: 'browser', outputMode: 'browser',
  inputDeviceId: '', outputDeviceId: '', browserVoice: '', autoRead: false,
  input: { baseUrl: '', model: '', apiKey: '', voice: '' },
  output: { baseUrl: '', model: '', apiKey: '', voice: '' },
}
export const VOICE_MAX_TEXT = 2000
export const VOICE_MAX_BYTES = 8 * 1024 * 1024
export const VOICE_MAX_RECORDING_MS = 60_000

export function voiceEndpoint(config: VoiceService, operation: 'transcriptions' | 'speech'): string {
  let url: URL
  try { url = new URL(config.baseUrl.trim()) } catch { throw new Error('请在助手设置中填写语音服务地址。') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new Error('语音服务地址须为 HTTPS 或本机 HTTP，不能包含密钥、查询参数或片段。')
  }
  if (!config.model.trim()) throw new Error('请填写语音模型名称。')
  if (operation === 'speech' && !config.voice.trim()) throw new Error('请填写服务支持的音色 ID。')
  return url.href.replace(/\/+$/, '') + '/audio/' + operation
}

export function speechText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>]/g, '').trim().slice(0, VOICE_MAX_TEXT)
}
